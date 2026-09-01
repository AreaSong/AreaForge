import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cloneFixture,
  cleanupG8SelftestFixture,
  createG8SelftestFixture,
} from "./g8-browser-evidence-selftest-fixture";
import {
  validateWebGovernanceBrowserInteractions,
  validateWebGovernanceBrowserInteractionsFile,
} from "./web-governance-browser-interactions-validate";

const root = mkdtempSync(path.join(tmpdir(), "areaforge-governance-g8-validator-"));
const fixture = createG8SelftestFixture(root);

try {
  expectValid(
    validateWebGovernanceBrowserInteractions(fixture.governance, fixture.binding),
    "valid governance value",
  );
  expectValid(
    validateWebGovernanceBrowserInteractionsFile(path.relative(root, fixture.governancePath), fixture.binding),
    "valid governance file",
  );

  const summary = cloneFixture(fixture.governance);
  (summary.summary as Record<string, unknown>).passed = 6;
  expectInvalid(summary, "summary is derived", "summary.passed");

  const telemetry = cloneFixture(fixture.governance);
  ((telemetry.results as Array<Record<string, unknown>>)[0] as Record<string, unknown>).pageErrors = ["unexpected page error"];
  expectInvalid(telemetry, "telemetry is zero", "pageErrors");

  const facts = cloneFixture(fixture.governance);
  const aiFacts = ((facts.results as Array<Record<string, unknown>>)[5] as Record<string, unknown>).facts as Record<string, unknown>;
  aiFacts.visiblePreview = "G8_FIRST_PREVIEW";
  expectInvalid(facts, "scenario facts are contract-bound", "latest-wins");

  const missing409 = cloneFixture(fixture.governance);
  const conflictResult = (missing409.results as Array<Record<string, unknown>>)[4] as Record<string, unknown>;
  conflictResult.expectedErrorResponses = [];
  expectInvalid(missing409, "intentional 409 response is required", "exactly the intercepted 409");

  const unexpected409 = cloneFixture(fixture.governance);
  const currentResult = (unexpected409.results as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  currentResult.expectedErrorResponses = ["409 PATCH http://127.0.0.1:43171/api/study-resources/test-resource-link"];
  expectInvalid(unexpected409, "409 is restricted to conflict scenario", "must be empty outside");

  const wrongCount = cloneFixture(fixture.governance);
  (wrongCount.results as unknown[]).pop();
  expectInvalid(wrongCount, "exactly seven scenarios", "exactly 7 scenarios");

  const wrongBinding = cloneFixture(fixture.governance);
  (wrongBinding.binding as Record<string, unknown>).capturePhase = "before-collection";
  expectInvalid(wrongBinding, "capture phase binding", "capturePhase");

  const missingPool = cloneFixture(fixture.governance);
  delete (missingPool.environment as Record<string, unknown>).pool;
  expectInvalid(missingPool, "pool binding is required", "environment.pool");

  const missingBinding = cloneFixture(fixture.governance);
  delete missingBinding.binding;
  expectInvalid(missingBinding, "artifact binding is required", "binding must be an object");

  const wrongRuntime = cloneFixture(fixture.governance);
  (wrongRuntime.runtimeIdentity as Record<string, unknown>).buildId = `sha256:${"c".repeat(64)}`;
  expectInvalid(wrongRuntime, "runtime build identity", "runtime identity hash mismatch");

  const wrongScreenshotPath = cloneFixture(fixture.governance);
  ((wrongScreenshotPath.results as Array<Record<string, unknown>>)[0] as Record<string, unknown>).screenshots = ["../../outside.png"];
  expectInvalid(wrongScreenshotPath, "canonical screenshot evidence object", "must be a screenshot evidence object");

  const wrongPng = path.join(root, "output/playwright/governance-g8-selftest/screenshots/overlay-window-open.png");
  const originalPng = readFileSync(wrongPng);
  writeFileSync(wrongPng, Buffer.from("not a png"), { mode: 0o600 });
  expectInvalidFile(
    path.relative(root, fixture.governancePath),
    fixture.binding,
    "PNG parser rejects forged screenshot",
    "PNG",
  );
  writeFileSync(wrongPng, originalPng, { mode: 0o600 });

  const extra = path.join(root, "output/playwright/governance-g8-selftest/screenshots/extra.png");
  writeFileSync(extra, Buffer.from("extra"), { mode: 0o600 });
  expectInvalidFile(
    path.relative(root, fixture.governancePath),
    fixture.binding,
    "extra screenshot is rejected",
    "exactly 7 canonical",
  );
  if (!existsSync(extra)) throw new Error("selftest fixture setup failed");

  console.log("web governance browser interactions validator selftest passed.");
} finally {
  cleanupG8SelftestFixture(root);
}

function expectValid(result: { valid: boolean; issues: Array<{ field: string; message: string }> }, label: string): void {
  if (!result.valid) throw new Error(`FAIL ${label}: ${result.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
}

function expectInvalid(value: unknown, label: string, needle: string): void {
  const result = validateWebGovernanceBrowserInteractions(value, fixture.binding);
  if (result.valid || !result.issues.some((issue) => `${issue.field} ${issue.message}`.includes(needle))) {
    throw new Error(`FAIL ${label}: expected issue containing ${needle}`);
  }
}

function expectInvalidFile(relativePath: string, binding: typeof fixture.binding, label: string, needle: string): void {
  const result = validateWebGovernanceBrowserInteractionsFile(relativePath, binding);
  if (result.valid || !result.issues.some((issue) => `${issue.field} ${issue.message}`.includes(needle))) {
    throw new Error(`FAIL ${label}: expected issue containing ${needle}`);
  }
}
