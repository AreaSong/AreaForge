import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOps005EvidencePreflight } from "../ops/ops005-evidence-preflight";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops005-preflight-"));
const gitCommit = "a".repeat(40);
const now = new Date("2026-07-13T01:00:00.000Z");

try {
  writeBase(false);
  expectStatus("needs_local_implementation");

  writeBase(true);
  expectStatus("needs_signed_release");

  writeReleaseRecord();
  expectStatus("needs_production_evidence");

  const evidencePath = "evidence/ops005-production.txt";
  writeText(evidencePath, productionRecord());
  expectStatus("ready_for_ops005_human_review", evidencePath);

  writeText(evidencePath, productionRecord().replace("autoApply: none", "autoApply: patch"));
  expectStatus("invalid", evidencePath);

  console.log("PASS OPS-005 evidence preflight selftest");
} finally {
  rmSync(root, { force: true, recursive: true });
}

function expectStatus(status: string, productionEvidencePath = ""): void {
  const result = buildOps005EvidencePreflight({
    root,
    now,
    gitCommit,
    releaseRecordPath: "docs/development/release-supply-chain-v0.1.8.md",
    productionEvidencePath,
  });
  if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  if (result.safetyFacts.readOnly !== true || result.safetyFacts.networkRequested !== false || result.safetyFacts.productionWriteAttempted !== false) {
    throw new Error("preflight safety facts are invalid");
  }
}

function writeBase(implemented: boolean): void {
  writeText("package.json", JSON.stringify({
    version: "0.1.8",
    scripts: implemented ? { "update-center:request-v2:selftest": "tsx scripts/quality/request-v2.selftest.ts" } : {},
  }, null, 2));
  writeText("docs/development/update-request-expected-before-design.md", "fixture design\n");
  writeText("tasks/active/0019-update-request-expected-before-binding.md", "fixture task\n");
  writeText(
    "apps/web/lib/system/update-center.ts",
    implemented ? "schemaVersion expectedBefore semanticHash idempotencyKey expiresAt\n" : "legacy request\n",
  );
  writeText(
    "ops/update-agent/areaforge-update-agent.sh",
    implemented
      ? "EXPECTED_BEFORE_MISMATCH LEGACY_MUTATION_UNBOUND needs_reconciliation executionAttempted production-state.lock\n"
      : "legacy agent\n",
  );
  writeText("ops/github-release-updater/areaforge-updater.sh", implemented ? "production-state.lock\n" : "legacy updater\n");
}

function writeReleaseRecord(): void {
  writeText("docs/development/release-supply-chain-v0.1.8.md", [
    "recordId: release-supply-chain-v0.1.8",
    "recordedAt: 2026-07-13T00:00:00.000Z",
    "releaseTag: v0.1.8",
    "workflowRunConclusion: success",
    `gitCommit: ${gitCommit}`,
    "packageVersion: 0.1.8",
    "checksumVerification: pass",
    "signatureVerification: pass",
    "unsignedPlaceholderPresent: no",
    "",
  ].join("\n"));
}

function productionRecord(): string {
  return [
    "recordId: ops-005-expected-before-v2-selftest",
    "recordedAt: 2026-07-13T00:00:00.000Z",
    "environment: production",
    "releaseTag: v0.1.8",
    "packageVersion: 0.1.8",
    `gitCommit: ${gitCommit}`,
    `webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`,
    `updateAgentScriptSha256: sha256:${"c".repeat(64)}`,
    `updaterScriptSha256: sha256:${"d".repeat(64)}`,
    "localImplementationStatus: pass",
    "localValidationCommands: pnpm update-center:request-v2:selftest,pnpm shellcheck:updater,pnpm github-release-updater:preflight,pnpm check",
    "signedReleaseStatus: pass",
    "productionDeploymentStatus: pass",
    "timerPausedBeforeDeployment: yes",
    "legacyMutationQueueDisposition: isolated",
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

function writeText(file: string, content: string): void {
  const fullPath = path.join(root, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

