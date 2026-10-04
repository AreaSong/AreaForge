import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { quotaSourceFingerprint } from "./quota-source";

export function capacitySourceFingerprint(root = process.cwd()): string {
  const files = [".env.example", "packages/db/src/index.ts", "packages/db/src/workspace-member-quota.ts",
    "packages/core/src/capacity-quotas.ts", "scripts/quality/tsconfig.capacity.json", "scripts/quality/admission-runtime-fixture.ts",
    "apps/web/components/invitation-accept-client.tsx", "apps/web/app/invitations/accept/page.tsx",
    "apps/web/lib/study/exam-workspace-service.ts"];
  for (const [directory, pattern] of [["scripts/quality", /^capacity-/], ["packages/auth/src", /./],
    ["packages/core/src", /./], ["packages/db/src", /./], ["packages/storage/src", /./], ["packages/config/src", /./],
    ["apps/web/lib/system", /^account-management/],
    ["apps/web/lib/workspace", /./], ["apps/web/lib/auth", /./], ["apps/web/lib/api", /^workspace-member/]] as const) {
    for (const name of readdirSync(path.join(root, directory))) if (pattern.test(name) && /\.tsx?$/.test(name)) files.push(`${directory}/${name}`);
  }
  for (const directory of ["apps/web/app/api/workspace-invitations", "apps/web/app/api/exam-workspaces", "apps/web/app/api/auth"]) collect(root, directory, files);
  const hash = createHash("sha256").update(quotaSourceFingerprint(root));
  for (const file of [...new Set(files)].sort()) {
    const stat = lstatSync(path.join(root, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("CAPACITY_SOURCE_INVALID");
    hash.update(file).update("\0").update(readFileSync(path.join(root, file))).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function collect(root: string, directory: string, files: string[]) {
  for (const name of readdirSync(path.join(root, directory))) {
    const file = `${directory}/${name}`; const stat = lstatSync(path.join(root, file));
    if (stat.isSymbolicLink()) throw new Error("CAPACITY_SOURCE_INVALID");
    if (stat.isDirectory()) collect(root, file, files); else if (/\.tsx?$/.test(name)) files.push(file);
  }
}
