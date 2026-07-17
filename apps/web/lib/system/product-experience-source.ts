import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { productExperienceSourcePaths } from "./product-experience-contract";

export {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  canonicalSha256,
  productExperienceSourcePaths,
} from "./product-experience-contract";

export function findWorkspaceRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml")) && existsSync(path.join(current, "apps/web/package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error("AreaForge workspace root not found");
    current = parent;
  }
}

export function currentGitCommit(root = findWorkspaceRoot()): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

export function computeProductExperienceSourceHash(root = findWorkspaceRoot()): string {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...productExperienceSourcePaths],
    { cwd: root, encoding: "utf8" },
  ).split(/\r?\n/).filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file).update("\0").update(readFileSync(path.resolve(root, file))).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
