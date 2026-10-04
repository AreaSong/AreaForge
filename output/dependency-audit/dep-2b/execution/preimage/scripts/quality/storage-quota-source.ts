import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function storageQuotaSourceFingerprint(root = process.cwd()): string {
  const files = ["package.json", "pnpm-lock.yaml", ".env.example", "prisma/schema.prisma", "scripts/quality/tsconfig.storage-quota.json",
    "scripts/quality/admission-runtime-fixture.ts", "scripts/quality/capacity-fixture-control.test.ts",
    "scripts/quality/fixtures/capacity/approved-migration-preimage.json"];
  const groups: Array<[string, RegExp]> = [["scripts/workers", /^data-delete-/], ["scripts/quality", /^storage-quota-/], ["scripts/dev", /^dev-test-/],
    ["packages/core/src", /./], ["packages/db/src", /./], ["packages/storage/src", /./], ["packages/config/src", /./], ["packages/auth/src", /./],
    ["apps/web/lib/study", /./], ["apps/web/lib/auth", /./],
    ["apps/web/lib/workspace", /./], ["apps/web/lib/api", /attachment|storage|resource|data-delete/],
    ["apps/web/lib/system", /data-(export|delete)/], ["apps/web/components", /note-|study-resource|data-delete/]];
  for (const [directory, pattern] of groups) for (const name of readdirSync(path.join(root, directory))) {
    if (pattern.test(name) && /\.(ts|tsx)$/.test(name)) files.push(directory + "/" + name);
  }
  for (const directory of ["prisma/migrations", "apps/web/app/api/attachments", "apps/web/app/api/notes",
    "apps/web/app/api/study-resources", "apps/web/app/api/system/data-deletions"]) {
    if (directoryExists(root, directory)) collect(root, directory, files);
  }
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    const absolute = path.join(root, file); const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("STORAGE_SOURCE_INVALID");
    hash.update(file).update("\0").update(readFileSync(absolute)).update("\0");
  }
  return "sha256:" + hash.digest("hex");
}
function directoryExists(root: string, file: string) {
  try { return lstatSync(path.join(root, file)).isDirectory(); } catch { return false; }
}
function collect(root: string, directory: string, files: string[]) {
  for (const name of readdirSync(path.join(root, directory))) {
    const file = directory + "/" + name; const stat = lstatSync(path.join(root, file));
    if (stat.isSymbolicLink()) throw new Error("STORAGE_SOURCE_INVALID");
    if (stat.isDirectory()) collect(root, file, files); else files.push(file);
  }
}
