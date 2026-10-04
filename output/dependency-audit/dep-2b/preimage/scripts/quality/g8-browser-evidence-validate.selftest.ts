import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cloneFixture,
  cleanupG8SelftestFixture,
  createG8SelftestFixture,
} from "./g8-browser-evidence-selftest-fixture";
import {
  currentG8Binding,
  validateG8BrowserEvidence,
  validateG8BrowserEvidenceFile,
} from "./g8-browser-evidence-validate";
import { findWorkspaceRoot } from "./product-experience-source";

const root = mkdtempSync(path.join(tmpdir(), "areaforge-g8-validator-"));
const fixture = createG8SelftestFixture(root);

try {
  const responsive = validateG8BrowserEvidence(fixture.responsive, fixture.binding);
  expectValid(responsive, "responsive schema dispatch");
  if (responsive.schemaVersion !== "responsive-layout-browser-matrix-v2" || responsive.itemCount !== 343 || responsive.screenshots.length !== 8) {
    throw new Error("FAIL responsive dispatch counts or screenshot inventory");
  }
  assertScreenshotHashes(responsive.screenshots, "responsive screenshots");

  const governance = validateG8BrowserEvidence(fixture.governance, fixture.binding);
  expectValid(governance, "governance schema dispatch");
  if (governance.schemaVersion !== "web-governance-browser-interactions-v2" || governance.itemCount !== 7 || governance.screenshots.length !== 7) {
    throw new Error("FAIL governance dispatch counts or screenshot inventory");
  }
  assertScreenshotHashes(governance.screenshots, "governance screenshots");

  expectValid(
    validateG8BrowserEvidenceFile(path.relative(root, fixture.responsivePath), fixture.binding),
    "responsive safe file dispatch",
  );
  expectValid(
    validateG8BrowserEvidenceFile(path.relative(root, fixture.governancePath), fixture.binding),
    "governance safe file dispatch",
  );

  expectInvalid({ schemaVersion: "unknown-g8-schema" }, "unknown schema fails closed", "must be responsive-layout-browser-matrix-v2 or web-governance-browser-interactions-v2");
  expectInvalid(null, "non-object fails closed", "must be a JSON object");

  const wrongBinding = cloneFixture(fixture.responsive);
  const wrongExpected = { ...fixture.binding, expectedCommit: "c".repeat(40) };
  const wrongBindingResult = validateG8BrowserEvidence(wrongBinding, wrongExpected);
  expectInvalidResult(wrongBindingResult, "current commit binding", "runtimeIdentity.gitCommit");

  const missingBinding = cloneFixture(fixture.responsive);
  delete missingBinding.binding;
  expectInvalid(missingBinding, "artifact binding is mandatory", "binding must be an object");

  const wrongCount = cloneFixture(fixture.responsive);
  (wrongCount.results as unknown[]).pop();
  expectInvalid(wrongCount, "complete route/viewport count", "exactly 343");

  const wrongPool = cloneFixture(fixture.governance);
  delete ((wrongPool.environment as Record<string, unknown>).pool as Record<string, unknown>).generation;
  expectInvalid(wrongPool, "complete pool identity", "environment.pool");

  const stale = cloneFixture(fixture.governance);
  stale.generatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  expectInvalid(stale, "freshness is required", "no more than 24 hours old");

  const future = cloneFixture(fixture.governance);
  future.generatedAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  expectInvalid(future, "future captures are rejected", "five minutes in the future");

  const absolutePath = path.join(root, "output/playwright", "responsive-g8-selftest", "responsive-layout-browser-matrix.json");
  expectInvalidFile(absolutePath, fixture.binding, "absolute evidence path rejected", "canonical");
  expectInvalidFile("../outside.json", fixture.binding, "traversal evidence path rejected", "traversal");

  const invalidUtf8Path = path.join(root, "output/playwright", "invalid-utf8.json");
  writeFileSync(invalidUtf8Path, Buffer.from([0xc3, 0x28]), { mode: 0o600 });
  expectInvalidFile(path.relative(root, invalidUtf8Path), fixture.binding, "invalid UTF-8 rejected", "UTF-8");

  const secretPath = path.join(root, "output/playwright", "redacted.json");
  writeFileSync(secretPath, Buffer.from(JSON.stringify({ schemaVersion: "responsive-layout-browser-matrix-v1", rawResponse: "redacted-secret" })), { mode: 0o600 });
  expectInvalidFile(path.relative(root, secretPath), fixture.binding, "secret-like record rejected", "secret-like");

  const pngPath = path.join(root, "output/playwright", "responsive-g8-selftest", "screenshots", "today-320.png");
  const originalPng = readFileSync(pngPath);
  writeFileSync(pngPath, Buffer.from("not a png"), { mode: 0o600 });
  expectInvalidFile(path.relative(root, fixture.responsivePath), fixture.binding, "PNG/hash evidence rejected", "PNG");
  writeFileSync(pngPath, originalPng, { mode: 0o600 });

  const screenshotHashTamper = cloneFixture(fixture.governance);
  const declared = (screenshotHashTamper.screenshotEvidence as Array<Record<string, unknown>>)[0];
  declared.sha256 = `sha256:${"f".repeat(64)}`;
  expectInvalid(screenshotHashTamper, "declared screenshot hash is bound", "must match the current screenshot bytes");

  const current = currentG8Binding(findWorkspaceRoot());
  if (!/^[a-f0-9]{40}$/.test(current.expectedCommit) || !/^\d+\.\d+\.\d+/.test(current.expectedVersion) || !/^sha256:[a-f0-9]{64}$/.test(current.expectedSourceHash)) {
    throw new Error("FAIL current checkout binding shape");
  }

  console.log("G8 browser evidence unified validator selftest passed.");
} finally {
  cleanupG8SelftestFixture(root);
}

function expectValid(result: { valid: boolean; issues: Array<{ field: string; message: string }> }, label: string): void {
  if (!result.valid) throw new Error(`FAIL ${label}: ${result.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
}

function expectInvalid(value: unknown, label: string, needle: string): void {
  const result = validateG8BrowserEvidence(value, fixture.binding);
  expectInvalidResult(result, label, needle);
}

function expectInvalidResult(result: { valid: boolean; issues: Array<{ field: string; message: string }> }, label: string, needle: string): void {
  if (result.valid || !result.issues.some((issue) => `${issue.field} ${issue.message}`.includes(needle))) {
    throw new Error(`FAIL ${label}: expected issue containing ${needle}`);
  }
}

function expectInvalidFile(relativePath: string, binding: typeof fixture.binding, label: string, needle: string): void {
  const result = validateG8BrowserEvidenceFile(relativePath, binding);
  expectInvalidResult(result, label, needle);
}

function assertScreenshotHashes(screenshots: Array<{ sha256: string }>, label: string): void {
  if (screenshots.some((screenshot) => !/^sha256:[a-f0-9]{64}$/.test(screenshot.sha256))) {
    throw new Error(`FAIL ${label}: screenshot hashes must be sha256 digests`);
  }
}
