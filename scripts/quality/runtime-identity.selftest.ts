import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  computeProductExperienceSourceHash,
  currentGitCommit,
} from "../../apps/web/lib/system/product-experience-source";
import {
  createStoredRuntimeIdentity,
  validateStoredRuntimeIdentity,
} from "../../apps/web/lib/system/runtime-identity-core";
import { createDevelopmentRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-development";
import { getRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-runtime-identity-"));
const output = path.join(tempDir, "runtime-identity.json");
const projection = {
  appVersion: "0.1.8",
  gitCommit: "a".repeat(40),
  sourceFingerprintSchema: PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  productExperienceSourceHash: `sha256:${"b".repeat(64)}`,
  buildId: `sha256:${"c".repeat(64)}`,
  runtimeMode: "production-build" as const,
};

try {
  const stored = createStoredRuntimeIdentity(projection);
  assert(validateStoredRuntimeIdentity(stored).identityHash === stored.identityHash, "stored identity must round-trip through validation");
  expectThrow("zero commit rejected", () => createStoredRuntimeIdentity({ ...projection, gitCommit: "0".repeat(40) }));
  expectThrow("zero source hash rejected", () => createStoredRuntimeIdentity({ ...projection, productExperienceSourceHash: `sha256:${"0".repeat(64)}` }));
  expectThrow("invalid build id rejected", () => createStoredRuntimeIdentity({ ...projection, buildId: "invalid" }));

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-runtime-identity.ts", output], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_APP_VERSION: projection.appVersion,
      AREAFORGE_GIT_COMMIT: projection.gitCommit,
      AREAFORGE_UX_SOURCE_FINGERPRINT_SCHEMA: projection.sourceFingerprintSchema,
      AREAFORGE_UX_SOURCE_HASH: projection.productExperienceSourceHash,
      AREAFORGE_BUILD_ID: projection.buildId,
    },
  });
  assert(generated.status === 0, `runtime identity generator failed: ${generated.stderr}`);
  assert(validateStoredRuntimeIdentity(JSON.parse(readFileSync(output, "utf8"))).identityHash === stored.identityHash, "generator output must match pure identity projection");

  const missing = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-runtime-identity.ts", path.join(tempDir, "missing.json")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AREAFORGE_BUILD_ID: "" },
  });
  assert(missing.status === 1 && missing.stderr.includes("is required"), "missing generator inputs must fail closed");

  const developmentStored = createDevelopmentRuntimeIdentity(root);
  const development = getRuntimeIdentity(new Date(), developmentStored);
  assert(development.status === "verified", "development runtime identity must be available");
  assert(development.gitCommit === currentGitCommit(root), "development runtime identity must bind current commit");
  assert(development.productExperienceSourceHash === computeProductExperienceSourceHash(root), "development runtime identity must bind current UX source fingerprint");
  const wrongMode = getRuntimeIdentity(new Date(), stored);
  assert(wrongMode.status === "unavailable", "development adapter must reject a production-build identity");

  console.log("runtime identity selftest passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function expectThrow(label: string, action: () => unknown): void {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`FAIL: ${label}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}
