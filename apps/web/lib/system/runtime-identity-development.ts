import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  canonicalSha256,
} from "./product-experience-contract";
import {
  computeProductExperienceSourceHash,
  currentGitCommit,
  findWorkspaceRoot,
} from "../../../../scripts/quality/product-experience-source";
import {
  createStoredRuntimeIdentity,
  type StoredRuntimeIdentity,
} from "./runtime-identity-core";

export function createDevelopmentRuntimeIdentity(root = findWorkspaceRoot()): StoredRuntimeIdentity {
  const appVersion = workspaceVersion(root);
  const gitCommit = currentGitCommit(root);
  const productExperienceSourceHash = computeProductExperienceSourceHash(root);
  const buildId = canonicalSha256({
    domain: "areaforge.runtime-build.v1",
    appVersion,
    gitCommit,
    productExperienceSourceHash,
    runtimeMode: "development",
  });
  return createStoredRuntimeIdentity({
    appVersion,
    gitCommit,
    sourceFingerprintSchema: PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
    productExperienceSourceHash,
    buildId,
    runtimeMode: "development",
  });
}

function workspaceVersion(root: string): string {
  const value = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  return value.version ?? "0.1.0";
}
