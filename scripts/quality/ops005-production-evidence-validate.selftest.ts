import { validateOps005ProductionEvidence } from "./ops005-production-evidence-validate";

const now = new Date("2026-07-13T01:00:00.000Z");
const valid = record();
expectPass(valid);
expectFail(valid.replace("autoApply: none", "autoApply: patch"), "autoApply");
expectFail(valid.replace("expectedBeforeRejectionExecutionAttempted: no", "expectedBeforeRejectionExecutionAttempted: yes"), "expectedBeforeRejectionExecutionAttempted");
expectFail(valid.replace("sharedProductionStateLockStatus: pass", "sharedProductionStateLockStatus: fail"), "sharedProductionStateLockStatus");
expectFail(valid.replace("recordedAt: 2026-07-13T00:00:00.000Z", "recordedAt: 2026-07-10T00:00:00.000Z"), "recordedAt");
expectFail(`${valid}\nAI_API_KEY=sk-fakefakefakefakefakefakefake\n`, "record");
console.log("PASS OPS-005 production evidence validator selftest");

function expectPass(raw: string): void {
  const issues = validateOps005ProductionEvidence(raw, { now });
  if (issues.length > 0) throw new Error(`expected pass, got ${JSON.stringify(issues)}`);
}

function expectFail(raw: string, field: string): void {
  const issues = validateOps005ProductionEvidence(raw, { now });
  if (!issues.some((issue) => issue.field === field)) {
    throw new Error(`expected ${field} failure, got ${JSON.stringify(issues)}`);
  }
}

export function record(overrides: Record<string, string> = {}): string {
  const values = {
    recordedAt: "2026-07-13T00:00:00.000Z",
    releaseTag: "v0.1.8",
    packageVersion: "0.1.8",
    gitCommit: "a".repeat(40),
    ...overrides,
  };
  return [
    "recordId: ops-005-expected-before-v2-selftest",
    `recordedAt: ${values.recordedAt}`,
    "environment: production",
    `releaseTag: ${values.releaseTag}`,
    `packageVersion: ${values.packageVersion}`,
    `gitCommit: ${values.gitCommit}`,
    `webImageDigest: ghcr.io/areasong/areaforge-web:${values.releaseTag}@sha256:${"b".repeat(64)}`,
    `updateAgentScriptSha256: sha256:${"c".repeat(64)}`,
    `updaterScriptSha256: sha256:${"d".repeat(64)}`,
    "localImplementationStatus: pass",
    "localValidationCommands: pnpm update-center:request-v2:selftest,pnpm shellcheck:updater,pnpm github-release-updater:preflight,pnpm check",
    "signedReleaseStatus: pass",
    "productionDeploymentStatus: pass",
    "timerPausedBeforeDeployment: yes",
    "legacyMutationQueueDisposition: empty",
    "webAgentVersionMatch: yes",
    "v2CheckStatus: pass",
    `v2CheckRequestHash: sha256:${"e".repeat(64)}`,
    "expectedBeforeRejectionStatus: pass",
    "expectedBeforeRejectionExecutionAttempted: no",
    `expectedBeforeRejectionEvidenceHash: sha256:${"f".repeat(64)}`,
    "sharedProductionStateLockStatus: pass",
    "processingReconciliationStatus: pass",
    "autoApply: none",
    `redactedDecisionHistoryHash: sha256:${"1".repeat(64)}`,
    "evidenceFreshnessMaxAgeHours: 24",
    "residualRiskIds: AF-RISK-OPS-005",
    "doesNotProve: AF-RISK-OPS-005 residual closure,production business write safety beyond scoped V2 check,OPS-001 closure,secrets absence beyond validator scan",
    "safetyFacts:",
    "  secretValuePrinted: no",
    "  productionBusinessDataWritten: no",
    "  residualLedgerUpdated: no",
    "  webRuntimeServerCommandAttempted: no",
    "  productionMutationRequestExecuted: no",
    "  autoApplyPolicyChanged: no",
    "  databaseRestoreAttempted: no",
    "  uploadsRestoreAttempted: no",
    "",
  ].join("\n");
}

