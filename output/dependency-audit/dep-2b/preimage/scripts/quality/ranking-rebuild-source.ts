import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** 绑定本域实现、共用队列、冻结协议和验收器；不读取env、fixture或证据自身。 */
export function rankingRebuildSourceFingerprint(root = process.cwd()): string {
  const files = ["package.json", "pnpm-lock.yaml", "prisma/schema.prisma", "scripts/quality/tsconfig.ranking-rebuild.json"];
  const groups: Array<[string, RegExp]> = [
    ["packages/core/src", /^(ranking-|data-job|data-lifecycle|ai-draft)/],
    ["packages/db/src", /^(ranking-|data-job|data-delete)/],
    ["apps/web/components", /^ranking-/], ["apps/web/lib/api", /^ranking/],
    ["apps/web/lib/client", /^(ranking-|operation-gates)/], ["scripts/workers", /\.ts$/],
    ["scripts/quality", /^ranking-rebuild-/], ["scripts/dev", /^dev-test-/],
  ];
  for (const [directory, pattern] of groups) {
    for (const name of readdirSync(path.join(root, directory))) if (pattern.test(name) && /\.(ts|tsx)$/.test(name)) files.push(`${directory}/${name}`);
  }
  for (const directory of ["apps/web/lib/ranking", "apps/web/app/api/ranking", "prisma/migrations"]) collect(root, directory, files);
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const target = path.join(root, file); const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("RANKING_SOURCE_INVALID");
    hash.update(file).update("\0").update(readFileSync(target)).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function collect(root: string, directory: string, files: string[]) {
  for (const name of readdirSync(path.join(root, directory))) {
    const file = `${directory}/${name}`; const stat = lstatSync(path.join(root, file));
    if (stat.isSymbolicLink()) throw new Error("RANKING_SOURCE_INVALID");
    if (stat.isDirectory()) collect(root, file, files); else if (/\.(ts|tsx|sql)$/.test(name)) files.push(file);
  }
}
