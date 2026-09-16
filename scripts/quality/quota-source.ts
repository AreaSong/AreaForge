import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** 只绑定准入、调用方、验证器与构建来源，不读取私有 fixture 或证据自身。 */
export function quotaSourceFingerprint(root = process.cwd()): string {
  const files = ["package.json", "pnpm-lock.yaml", "prisma/schema.prisma", "packages/core/src/index.ts", "packages/config/src/index.ts",
    "scripts/quality/tsconfig.quota.json", "apps/web/app/(app)/settings/data/page.tsx"];
  const groups: Array<[string, RegExp]> = [
    ["packages/core/src", /^(data-job|data-export-job|ranking-rebuild|workspace-search)/],
    ["packages/db/src", /^(data-job|data-export|ranking-rebuild|workspace-search)/],
    ["apps/web/lib/system", /^(data-lifecycle|data-export|data-job-quota|workspace-search)/],
    ["apps/web/lib/ranking", /\.ts$/], ["apps/web/lib/contracts", /^(data-job|search)/],
    ["apps/web/lib/api", /^(data-lifecycle|data-job-quota|search|ranking)/], ["apps/web/lib/client", /^(operation-gates|data-job|ranking-rebuild|search-index)/],
    ["apps/web/components", /^(data-job-center|ranking-rebuild|search-index)/],
    ["scripts/quality", /^quota-/], ["scripts/dev", /^dev-test-/],
  ];
  for (const [directory, pattern] of groups) for (const name of readdirSync(path.join(root, directory))) {
    if (pattern.test(name) && /\.(ts|tsx)$/.test(name)) files.push(`${directory}/${name}`);
  }
  for (const directory of ["prisma/migrations", "apps/web/app/api/system/data-jobs", "apps/web/app/api/search", "apps/web/app/api/ranking"]) collect(root, directory, files);
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const target = path.join(root, file); const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("QUOTA_SOURCE_INVALID");
    hash.update(file).update("\0").update(readFileSync(target)).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function collect(root: string, directory: string, files: string[]) {
  for (const name of readdirSync(path.join(root, directory))) {
    const file = `${directory}/${name}`; const stat = lstatSync(path.join(root, file));
    if (stat.isSymbolicLink()) throw new Error("QUOTA_SOURCE_INVALID");
    if (stat.isDirectory()) collect(root, file, files); else if (/\.(ts|tsx|sql)$/.test(name)) files.push(file);
  }
}
