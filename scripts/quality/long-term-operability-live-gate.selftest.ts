import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-long-term-gate-"));
const defaultOps004AlertPreview = "docs/development/ops-004-alert-preview-v0.1.7-20260712.json";
const defaultOps004AlertDrillRecord = "docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt";

try {
  const uxRecord = path.join(tempDir, "product-experience-review.txt");
  writeFileSync(uxRecord, createUxRecord("2026-07-10T00:00:00.000Z"));

  const currentOps004PreviewOnly = runGate({
    AREAFORGE_LONG_TERM_UX_RECORD: uxRecord,
    AREAFORGE_LONG_TERM_GATE_NOW: "2026-07-11T00:00:00.000Z",
  }, 1, {
    clearOps004: false,
  });
  const currentOps004PreviewOnlyJson = parseGateJson(currentOps004PreviewOnly.stdout);
  assert(currentOps004PreviewOnlyJson.status === "needs_live_evidence", "OPS-004 current preview without matching drill should block the gate");
  assertCheckStatus(currentOps004PreviewOnlyJson, "ops004", "missing");

  const missingEvidence = runGate({
    AREAFORGE_LONG_TERM_UX_RECORD: uxRecord,
    AREAFORGE_LONG_TERM_GATE_NOW: "2026-07-11T00:00:00.000Z",
  }, 1);
  const missingJson = parseGateJson(missingEvidence.stdout);
  assert(missingJson.status === "needs_live_evidence", "missing evidence should keep the live gate at needs_live_evidence");
  assertCheckStatus(missingJson, "uxReview", "pass");
  assertCheckStatus(missingJson, "ops001", "missing");
  assertSafetyFacts(missingJson);

  const staleUx = runGate({
    AREAFORGE_LONG_TERM_UX_RECORD: uxRecord,
    AREAFORGE_LONG_TERM_GATE_NOW: "2026-08-10T00:00:00.000Z",
  }, 1);
  const staleJson = parseGateJson(staleUx.stdout);
  assert(staleJson.status === "needs_live_evidence", "stale UX should require fresh evidence");
  assertCheckStatus(staleJson, "uxReview", "stale");

  const invalidEvidence = runGate({
    AREAFORGE_LONG_TERM_UX_RECORD: uxRecord,
    AREAFORGE_LONG_TERM_GATE_NOW: "2026-07-11T00:00:00.000Z",
    AREAFORGE_OPS001_SMOKE_RECORD: path.join(tempDir, "missing-smoke-record.txt"),
  }, 1);
  const invalidJson = parseGateJson(invalidEvidence.stdout);
  assert(invalidJson.status === "invalid", "invalid child preflight should make the live gate invalid");
  assertCheckStatus(invalidJson, "ops001", "invalid");

  const oldVersionUxRecord = path.join(tempDir, "product-experience-review-old-version.txt");
  writeFileSync(oldVersionUxRecord, createUxRecord("2026-07-10T00:00:00.000Z", "0.1.5"));
  const oldVersionUx = runGate({
    AREAFORGE_LONG_TERM_UX_RECORD: oldVersionUxRecord,
    AREAFORGE_LONG_TERM_GATE_NOW: "2026-07-11T00:00:00.000Z",
  }, 1);
  const oldVersionUxJson = parseGateJson(oldVersionUx.stdout);
  assert(oldVersionUxJson.status === "invalid", "old appVersion UX record should not satisfy the current-version gate");
  assertCheckStatus(oldVersionUxJson, "uxReview", "invalid");

  console.log("long-term operability live gate selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function runGate(env: Record<string, string>, expectedStatus: number, options: { clearOps004?: boolean } = {}): ReturnType<typeof spawnSync> {
  const clearOps004 = options.clearOps004 ?? true;
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    AREAFORGE_OPS001_SMOKE_RECORD: "",
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: "",
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: "",
    AREAFORGE_OPS001_CLOSURE_PACKET: "",
    AREAFORGE_SC002_CI_RECORD: "",
    AREAFORGE_SC002_RELEASE_RECORD: "",
    AREAFORGE_LONG_TERM_UX_RECORD: "",
    ...env,
  };
  if (clearOps004) {
    childEnv.AREAFORGE_OPS004_ALERT_PREVIEW = "";
    childEnv.AREAFORGE_OPS004_ALERT_DRILL_RECORD = "";
  } else {
    childEnv.AREAFORGE_OPS004_ALERT_PREVIEW = process.env.AREAFORGE_OPS004_ALERT_PREVIEW ?? defaultOps004AlertPreview;
    childEnv.AREAFORGE_OPS004_ALERT_DRILL_RECORD = process.env.AREAFORGE_OPS004_ALERT_DRILL_RECORD ??
      (existsSync(path.resolve(defaultOps004AlertDrillRecord)) ? defaultOps004AlertDrillRecord : "");
  }

  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/long-term-operability-live-gate.ts"], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
  });
  if (result.status !== expectedStatus) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`expected exit ${expectedStatus}, got ${String(result.status)}`);
  }
  return result;
}

function createUxRecord(reviewedAt: string, appVersion = "0.1.7"): string {
  return [
    "recordId: product-experience-review-selftest",
    `reviewedAt: ${reviewedAt}`,
    "reviewer: AreaForge selftest",
    "environment: local",
    "baseUrl: http://127.0.0.1:3102",
    `appVersion: ${appVersion}`,
    "source: local UX smoke plus browser review",
    "reviewCommand: pnpm smoke:local-ux and playwright desktop/mobile browser review",
    "reviewStatus: pass",
    `reviewResultHash: sha256:${"a".repeat(64)}`,
    "viewports: desktop,mobile",
    "journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center",
    "screenshotEvidence: desktop=output/desktop-dashboard.png; mobile=output/mobile-dashboard.png",
    "nextActionWithin5s: yes",
    "recommendationsExplainWhy: yes",
    "confirmOnlyBoundariesVisible: yes",
    "recoveryPathVisible: yes",
    "mobileReadable: yes",
    "emptyUnauthorizedErrorStatesChecked: yes",
    "residualRiskIds: AF-RISK-UX-001",
    "followUpTasks: none",
    "safetyFacts:",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  destructiveActionAttempted: no",
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "",
  ].join("\n");
}

function parseGateJson(raw: string): JsonRecord {
  const parsed = JSON.parse(raw) as JsonRecord;
  assert(parsed.mode === "read_only_long_term_operability_live_gate", "gate mode missing");
  return parsed;
}

function assertCheckStatus(parsed: JsonRecord, key: string, status: string): void {
  const checks = parsed.checks as JsonRecord[] | undefined;
  const check = checks?.find((item) => item.key === key);
  assert(Boolean(check), `missing check ${key}`);
  assert(check?.status === status, `expected ${key} status ${status}, got ${String(check?.status)}`);
}

function assertSafetyFacts(parsed: JsonRecord): void {
  const safety = parsed.safetyFacts as JsonRecord | undefined;
  assert(Boolean(safety), "safetyFacts missing");
  for (const key of [
    "githubApiCalled",
    "serverCommandAttempted",
    "backupRestoreAttempted",
    "migrationAttempted",
    "productionWriteAttempted",
    "updaterApplyAttempted",
    "residualLedgerUpdated",
    "secretValuePrinted",
  ]) {
    assert(safety?.[key] === false, `safetyFacts.${key} should be false`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
