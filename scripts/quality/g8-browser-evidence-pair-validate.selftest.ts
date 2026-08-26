import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cloneFixture,
  cleanupG8SelftestFixture,
  createG8SelftestFixture,
} from "./g8-browser-evidence-selftest-fixture";
import {
  validateG8BrowserEvidencePair,
  validateG8BrowserEvidencePairFiles,
} from "./g8-browser-evidence-pair-validate";

const root = mkdtempSync(path.join(tmpdir(), "areaforge-g8-pair-validator-"));
const fixture = createG8SelftestFixture(root);

try {
  expectValid(
    validateG8BrowserEvidencePair(fixture.responsive, fixture.governance, fixture.binding),
    "valid evidence pair",
  );
  expectValid(
    validateG8BrowserEvidencePairFiles(
      path.relative(root, fixture.responsivePath),
      path.relative(root, fixture.governancePath),
      fixture.binding,
    ),
    "valid evidence pair files",
  );

  const mismatchedBinding = cloneFixture(fixture.governance);
  (mismatchedBinding.binding as Record<string, unknown>).sourceFingerprint = `sha256:${"c".repeat(64)}`;
  expectInvalidPair(mismatchedBinding, "binding source fingerprint must match", "pair.binding.sourceFingerprint");

  const mismatchedCapturePhase = cloneFixture(fixture.governance);
  (mismatchedCapturePhase.binding as Record<string, unknown>).capturePhase = "before-collection";
  expectInvalidPair(mismatchedCapturePhase, "capture phase must match", "pair.binding.capturePhase");

  const mismatchedRuntime = cloneFixture(fixture.governance);
  (mismatchedRuntime.runtimeIdentity as Record<string, unknown>).identityHash = `sha256:${"d".repeat(64)}`;
  expectInvalidPair(mismatchedRuntime, "runtime identity must match", "pair.runtimeIdentity.identityHash");

  const mismatchedPool = cloneFixture(fixture.governance);
  const pool = (mismatchedPool.environment as Record<string, unknown>).pool as Record<string, unknown>;
  pool.generation = Number(pool.generation) + 1;
  expectInvalidPair(mismatchedPool, "test-pool generation must match", "pair.environment.pool.generation");

  const sameRunId = cloneFixture(fixture.governance);
  sameRunId.runId = fixture.responsive.runId;
  expectInvalidPair(sameRunId, "run IDs must be distinct", "pair.runId");

  const oldCapture = cloneFixture(fixture.governance);
  oldCapture.generatedAt = new Date(Date.parse(String(fixture.responsive.generatedAt)) - 48 * 60 * 60 * 1000).toISOString();
  expectInvalidPair(oldCapture, "captures must be temporally close", "within 24 hours");

  const differentPoolUrl = cloneFixture(fixture.governance);
  const differentEnvironment = differentPoolUrl.environment as Record<string, unknown>;
  differentEnvironment.baseUrl = "http://127.0.0.1:43172";
  differentEnvironment.pool = {
    slot: 2,
    container: "areaforge-dev-test-2",
    port: 43172,
    generation: 1_724_454_400_001,
    url: "http://127.0.0.1:43172",
  };
  expectInvalidPair(differentPoolUrl, "base URL and pool must match", "pair.environment.baseUrl");

  const sameFile = validateG8BrowserEvidencePairFiles(
    path.relative(root, fixture.responsivePath),
    path.relative(root, fixture.responsivePath),
    fixture.binding,
  );
  if (sameFile.valid || !sameFile.issues.some((issue) => `${issue.field} ${issue.message}`.includes("paths must be distinct"))) {
    throw new Error("FAIL duplicate evidence paths: expected distinct-path issue");
  }

  console.log("G8 browser evidence pair validator selftest passed.");
} finally {
  cleanupG8SelftestFixture(root);
}

function expectValid(result: { valid: boolean; issues: Array<{ field: string; message: string }> }, label: string): void {
  if (!result.valid) throw new Error(`FAIL ${label}: ${result.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
}

function expectInvalidPair(governance: Record<string, unknown>, label: string, needle: string): void {
  const result = validateG8BrowserEvidencePair(fixture.responsive, governance, fixture.binding);
  if (result.valid || !result.issues.some((issue) => `${issue.field} ${issue.message}`.includes(needle))) {
    throw new Error(`FAIL ${label}: expected issue containing ${needle}`);
  }
}
