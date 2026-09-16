import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** 仅绑定源码，不读取 fixture 私有目录、env 或证据自身。 */
export function searchIndexSourceFingerprint(root = process.cwd()): string {
  const files = ["package.json", "pnpm-lock.yaml", "prisma/schema.prisma", "scripts/quality/tsconfig.search-index.json",
    "apps/web/app/(app)/settings/data/page.tsx", "apps/web/lib/workspace/policy-service.ts", "packages/config/src/index.ts"];
  const groups: Array<[string, RegExp]> = [
    ["packages/core/src", /^(workspace-search|data-job|data-lifecycle|rbac)/],
    ["packages/db/src", /^(workspace-search|data-job|data-delete|data-export-inventory)/],
    ["apps/web/components", /^(search-index|use-workspace-search|workspace-search|dynamic-island)/],
    ["apps/web/lib/api", /^search/], ["apps/web/lib/contracts", /^search/],
    ["apps/web/lib/system", /^(workspace-search|data-export-inventory)/],
    ["apps/web/lib/client", /^(search-index|operation-gates)/], ["scripts/workers", /\.ts$/],
    ["scripts/quality", /^search-index-/], ["scripts/dev", /^dev-test-/],
  ];
  for (const [directory, pattern] of groups) {
    for (const name of readdirSync(path.join(root, directory))) if (pattern.test(name) && /\.(ts|tsx)$/.test(name)) files.push(`${directory}/${name}`);
  }
  for (const directory of ["apps/web/app/api/search", "prisma/migrations"]) collect(root, directory, files);
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const target = path.join(root, file); const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("SEARCH_SOURCE_INVALID");
    hash.update(file).update("\0").update(readFileSync(target)).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function collect(root: string, directory: string, files: string[]) {
  for (const name of readdirSync(path.join(root, directory))) {
    const file = `${directory}/${name}`; const stat = lstatSync(path.join(root, file));
    if (stat.isSymbolicLink()) throw new Error("SEARCH_SOURCE_INVALID");
    if (stat.isDirectory()) collect(root, file, files); else if (/\.(ts|tsx|sql)$/.test(name)) files.push(file);
  }
}
