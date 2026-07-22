import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSc004Preflight } from "../ops/sc004-main-protection-preflight";

const dir = path.join(tmpdir(), `areaforge-sc004-${process.pid}-${Date.now()}`);
mkdirSync(dir);
try {
  const readbackPath = path.join(dir, "readback.json");
  const prPath = path.join(dir, "controlled-pr.json");
  writeFileSync(readbackPath, JSON.stringify(withHash({ schemaVersion: 1, repository: "AreaSong/AreaForge", branch: "main", sourceKind: "ruleset", observedAt: "2026-07-15T11:00:00.000Z", maintenanceWindowId: "mw-sc004", requiredPullRequest: true, requiredApprovingReviewCount: 1, requiredStatusChecks: ["ci / verify"], enforceAdmins: true, allowForcePushes: false, allowDeletions: false, adminBypassActors: [], redaction: { secretsRemoved: true, tokenRemoved: true }, readbackHash: "" }, "readbackHash")));
  writeFileSync(prPath, JSON.stringify(withHash(controlledPrValue("mw-sc004"), "evidenceHash")));
  const validEnv = { AREAFORGE_SC004_READBACK_RECORD: readbackPath, AREAFORGE_SC004_CONTROLLED_PR_RECORD: prPath };
  assertStatus(buildSc004Preflight({}, Date.parse("2026-07-15T12:00:00.000Z")), "needs_remote_readback");
  assertStatus(buildSc004Preflight({ AREAFORGE_SC004_READBACK_RECORD: readbackPath }, Date.parse("2026-07-15T12:00:00.000Z")), "needs_controlled_pr");
  const ready = buildSc004Preflight(validEnv, Date.parse("2026-07-15T12:00:00.000Z"));
  assertStatus(ready, "ready_for_human_review");
  const safety = ready.safetyFacts as Record<string, unknown>;
  for (const key of ["readOnly", "networkRequested", "githubApiCalled", "ghCalled", "curlCalled", "productionWriteAttempted", "secretValuePrinted", "residualLedgerUpdated"]) {
    const expected = key === "readOnly";
    if (safety[key] !== expected) throw new Error(`safetyFacts.${key} mismatch`);
  }
  assertStatus(buildSc004Preflight({ AREAFORGE_SC004_READBACK_RECORD: path.join(dir, "missing.json") }, Date.parse("2026-07-15T12:00:00.000Z")), "invalid");
  const mismatchedPrPath = path.join(dir, "mismatched-pr.json");
  writeFileSync(mismatchedPrPath, JSON.stringify(withHash(controlledPrValue("other-window"), "evidenceHash")));
  assertStatus(buildSc004Preflight({ AREAFORGE_SC004_READBACK_RECORD: readbackPath, AREAFORGE_SC004_CONTROLLED_PR_RECORD: mismatchedPrPath }, Date.parse("2026-07-15T12:00:00.000Z")), "invalid");
  const forbiddenPath = path.join(dir, "token-evidence.json");
  writeFileSync(forbiddenPath, "{}");
  assertStatus(buildSc004Preflight({ AREAFORGE_SC004_READBACK_RECORD: forbiddenPath }, Date.parse("2026-07-15T12:00:00.000Z")), "invalid");
  const readySafety = ready.safetyFacts as Record<string, unknown>;
  for (const key of ["githubWriteAttempted", "tokenRead", "controlledPrCreated", "residualClosed"]) if (readySafety[key] !== false) throw new Error(`safetyFacts.${key} must be false`);
  console.log("sc004 main protection preflight selftest passed.");
} finally { rmSync(dir, { recursive: true, force: true }); }

function assertStatus(value: Record<string, unknown>, expected: string): void {
  if (value.status !== expected) throw new Error(`expected ${expected}, got ${String(value.status)}: ${JSON.stringify(value)}`);
}
function withHash(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const withoutHash = { ...value, [field]: "" };
  return { ...value, [field]: `sha256:${createHash("sha256").update(stableStringify(withoutHash)).digest("hex")}` };
}
function controlledPrValue(maintenanceWindowId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    repository: "AreaSong/AreaForge",
    branch: "main",
    observedAt: "2026-07-15T11:30:00.000Z",
    maintenanceWindowId,
    prUrl: "https://github.com/AreaSong/AreaForge/pull/7",
    prNumber: 7,
    headSha: "1".repeat(40),
    failedRequiredCheck: "ci / verify",
    failedCheckConclusion: "failure",
    failedCheckRunUrl: "https://github.com/AreaSong/AreaForge/actions/runs/100/job/101",
    passingRequiredCheck: "ci / verify",
    passingCheckConclusion: "success",
    passingCheckRunUrl: "https://github.com/AreaSong/AreaForge/actions/runs/102/job/103",
    failureOutcome: "blocked",
    successOutcome: "allowed",
    prMerged: false,
    secretValuesPresent: false,
    evidenceHash: "",
  };
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`; }
  return JSON.stringify(value);
}
