import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cloneFixture, cleanupG8SelftestFixture, createG8SelftestFixture } from "./g8-browser-evidence-selftest-fixture";
import { validateResponsiveLayoutBrowserMatrix, validateResponsiveLayoutBrowserMatrixFile } from "./responsive-layout-browser-matrix-validate";

const root = mkdtempSync(path.join(tmpdir(), "areaforge-responsive-g8-validator-"));
const fixture = createG8SelftestFixture(root);

try {
  const runnerSource = readFileSync(path.join(process.cwd(), "scripts/ops/responsive-layout-browser-matrix.ts"), "utf8");
  if (!runnerSource.includes('page.route("**/api/study-sessions/start"')) {
    throw new Error("responsive matrix runner must intercept quick-review session start to preserve businessWrites=false");
  }
  expectValid(validateResponsiveLayoutBrowserMatrix(fixture.responsive, fixture.binding), "valid responsive value");
  expectValid(validateResponsiveLayoutBrowserMatrixFile(path.relative(root, fixture.responsivePath), fixture.binding), "valid responsive file");

  const interceptedQuickReview = cloneFixture(fixture.responsive);
  for (const result of interceptedQuickReview.results as Array<Record<string, unknown>>) {
    if (result.templatePath === "/knowledge/reviews/[scheduleId]/run") {
      result.finalPath = "/knowledge/reviews/test-review-schedule/run";
    }
  }
  expectValid(
    validateResponsiveLayoutBrowserMatrix(interceptedQuickReview, fixture.binding),
    "intercepted quick-review route remains admissible",
  );

  const summary = cloneFixture(fixture.responsive);
  (summary.summary as Record<string, unknown>).passed = 342;
  expectInvalid(summary, "summary is derived", "summary.passed");

  const telemetry = cloneFixture(fixture.responsive);
  ((telemetry.results as Array<Record<string, unknown>>)[0] as Record<string, unknown>).consoleErrors = ["unexpected console error"];
  expectInvalid(telemetry, "telemetry is zero", "consoleErrors");

  const wrongCount = cloneFixture(fixture.responsive);
  (wrongCount.results as unknown[]).pop();
  expectInvalid(wrongCount, "exact 343 combinations", "exactly 343");

  const wrongBinding = cloneFixture(fixture.responsive);
  (wrongBinding.binding as Record<string, unknown>).capturePhase = "before-collection";
  expectInvalid(wrongBinding, "capture phase binding", "capturePhase");

  const missingPool = cloneFixture(fixture.responsive);
  delete (missingPool.environment as Record<string, unknown>).pool;
  expectInvalid(missingPool, "pool binding is required", "environment.pool");

  const missingBinding = cloneFixture(fixture.responsive);
  delete missingBinding.binding;
  expectInvalid(missingBinding, "artifact binding is required", "binding must be an object");

  const wrongRuntime = cloneFixture(fixture.responsive);
  (wrongRuntime.runtimeIdentity as Record<string, unknown>).buildId = `sha256:${"c".repeat(64)}`;
  expectInvalid(wrongRuntime, "runtime build identity", "runtime identity hash mismatch");

  const wrongViewport = cloneFixture(fixture.responsive);
  ((wrongViewport.viewports as Array<Record<string, unknown>>)[0] as Record<string, unknown>).width = 321;
  expectInvalid(wrongViewport, "fixed viewport dimensions", "fixed seven-viewport");

  const wrongScreenshotPath = cloneFixture(fixture.responsive);
  const native = wrongScreenshotPath.runId as string;
  ((wrongScreenshotPath.zoom as Record<string, unknown>).results as Array<Record<string, unknown>>)[0].path = "../../outside";
  expectInvalid(wrongScreenshotPath, "canonical zoom route catches path shape", "canonical zoom route");

  const wrongPng = path.join(root, "output/playwright/responsive-g8-selftest/screenshots/today-320.png");
  writeFileSync(wrongPng, Buffer.from("not a png"), { mode: 0o600 });
  expectInvalidFile(path.relative(root, fixture.responsivePath), fixture.binding, "PNG parser rejects forged screenshot", "PNG");
  void native;

  const extra = path.join(root, "output/playwright/responsive-g8-selftest/screenshots/extra.png");
  writeFileSync(extra, Buffer.from("extra"), { mode: 0o600 });
  expectInvalidFile(path.relative(root, fixture.responsivePath), fixture.binding, "extra screenshot is rejected", "exactly 8 canonical");
  if (!existsSync(extra)) throw new Error("selftest fixture setup failed");

  console.log("responsive layout browser matrix validator selftest passed.");
} finally {
  cleanupG8SelftestFixture(root);
}

function expectValid(result: { valid: boolean; issues: Array<{ field: string; message: string }> }, label: string): void {
  if (!result.valid) throw new Error(`FAIL ${label}: ${result.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
}

function expectInvalid(value: unknown, label: string, needle: string): void {
  const result = validateResponsiveLayoutBrowserMatrix(value, fixture.binding);
  if (result.valid || !result.issues.some((issue) => `${issue.field} ${issue.message}`.includes(needle))) {
    throw new Error(`FAIL ${label}: expected issue containing ${needle}`);
  }
}

function expectInvalidFile(relativePath: string, binding: typeof fixture.binding, label: string, needle: string): void {
  const result = validateResponsiveLayoutBrowserMatrixFile(relativePath, binding);
  if (result.valid || !result.issues.some((issue) => `${issue.field} ${issue.message}`.includes(needle))) {
    throw new Error(`FAIL ${label}: expected issue containing ${needle}`);
  }
}
