import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOps005ExpectedIdentity,
  type Ops005ExpectedIdentity,
  validateOps005ProductionEvidence,
  validateOps005ProductionEvidenceBundle,
} from "./ops005-production-evidence-validate";

const now = new Date("2026-07-13T01:00:00.000Z");
const expectedIdentity: Ops005ExpectedIdentity = {
  packageVersion: "0.1.8",
  releaseTag: "v0.1.8",
  gitCommit: "a".repeat(40),
  webImageDigest: `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`,
  updateAgentScriptSha256: `sha256:${"c".repeat(64)}`,
  updaterScriptSha256: `sha256:${"d".repeat(64)}`,
};
const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops005-evidence-"));
try {
  writeEvidenceFiles();
  const valid = record();
  expectPass(valid);
  expectFail(valid.replace("autoApply: none", "autoApply: patch"), "autoApply");
  expectFail(valid.replace("expectedBeforeRejectionExecutionAttempted: no", "expectedBeforeRejectionExecutionAttempted: yes"), "expectedBeforeRejectionExecutionAttempted");
  expectFail(valid.replace("sharedProductionStateLockStatus: pass", "sharedProductionStateLockStatus: fail"), "sharedProductionStateLockStatus");
  expectFail(valid.replace("pnpm ops:ops-005:local:selftest", "pnpm update-center:request-v2:selftest"), "localValidationCommands");
  expectFail(valid.replace("recordedAt: 2026-07-13T00:00:00.000Z", "recordedAt: 2026-07-10T00:00:00.000Z"), "recordedAt");
  expectFail(`${valid}\nAI_API_KEY=sk-fakefakefakefakefakefakefake\n`, "record");
  expectFail(valid.replace(rejectionEvidenceHash(), `sha256:${"9".repeat(64)}`), "expectedBeforeRejectionEvidenceHash");
  expectFail(valid.replace(operationalEvidenceHash(), `sha256:${"8".repeat(64)}`), "operationalEvidenceHash");
  expectFail(valid.replace("expected-before-rejection.json", "../outside.json"), "expectedBeforeRejectionEvidenceFile");
  writeFileSync(path.join(evidenceRoot, "outside.json"), rejectionEvidence());
  symlinkSync(path.join(evidenceRoot, "outside.json"), path.join(evidenceRoot, "rejection-link.json"));
  expectFail(valid.replace("expected-before-rejection.json", "rejection-link.json"), "expectedBeforeRejectionEvidenceFile");
  writeFileSync(path.join(evidenceRoot, "expected-before-rejection.json"), rejectionEvidence().replace('"executionAttempted": false', '"executionAttempted": true'));
  expectFail(record(), "expectedBeforeRejectionEvidenceFile.executionAttempted");
  writeFileSync(path.join(evidenceRoot, "expected-before-rejection.json"), rejectionEvidence());
  writeFileSync(path.join(evidenceRoot, "operational-evidence.json"), operationalEvidence().replace('"mutationOverlapObserved": false', '"mutationOverlapObserved": true'));
  expectFail(record(), "operationalEvidenceFile.sharedProductionStateLock");
  writeFileSync(path.join(evidenceRoot, "operational-evidence.json"), operationalEvidence());
  expectIdentityFail(valid.replace(expectedIdentity.webImageDigest, `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"9".repeat(64)}`), "webImageDigest");
  expectIdentityFail(valid.replace(expectedIdentity.updateAgentScriptSha256, `sha256:${"8".repeat(64)}`), "updateAgentScriptSha256");
  expectIdentityFail(valid.replace(expectedIdentity.updaterScriptSha256, `sha256:${"7".repeat(64)}`), "updaterScriptSha256");
  expectStrictReleaseAssetsRequired(valid);
  testGitObjectBindingIgnoresDirtyWorktree();
  console.log("PASS OPS-005 production evidence validator selftest");
} finally {
  rmSync(evidenceRoot, { recursive: true, force: true });
}

function expectStrictReleaseAssetsRequired(raw: string): void {
  const releaseRecord = [
    `packageVersion: ${expectedIdentity.packageVersion}`,
    `releaseTag: ${expectedIdentity.releaseTag}`,
    `gitCommit: ${expectedIdentity.gitCommit}`,
    `webImageDigest: ${expectedIdentity.webImageDigest}`,
  ].join("\n");
  const issues = validateOps005ProductionEvidenceBundle(raw, releaseRecord, {
    now,
    evidenceBaseDir: evidenceRoot,
    releaseAssetsDir: "",
    sourceAtCommit: (_commit, file) => file.includes("update-agent") ? "agent" : "updater",
  });
  if (!issues.some((issue) => issue.field === "release.assetDir")) {
    throw new Error(`standalone OPS-005 validation must require strict signed Release assets: ${JSON.stringify(issues)}`);
  }
}

function testGitObjectBindingIgnoresDirtyWorktree(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops005-git-object-"));
  const agentPath = "ops/update-agent/areaforge-update-agent.sh";
  const updaterPath = "ops/github-release-updater/areaforge-updater.sh";
  try {
    mkdirSync(path.join(root, path.dirname(agentPath)), { recursive: true });
    mkdirSync(path.join(root, path.dirname(updaterPath)), { recursive: true });
    writeFileSync(path.join(root, agentPath), "committed agent\n");
    writeFileSync(path.join(root, updaterPath), "committed updater\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "ops005@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "OPS005 Selftest"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    writeFileSync(path.join(root, agentPath), "dirty agent\n");
    writeFileSync(path.join(root, updaterPath), "dirty updater\n");
    const identity = buildOps005ExpectedIdentity([
      "packageVersion: 0.1.8",
      "releaseTag: v0.1.8",
      `gitCommit: ${gitCommit}`,
      `webImageDigest: ${expectedIdentity.webImageDigest}`,
    ].join("\n"), root);
    const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
    if (identity.updateAgentScriptSha256 !== hash("committed agent\n") || identity.updaterScriptSha256 !== hash("committed updater\n")) {
      throw new Error("expected identity must read script content from the signed Release commit, not the dirty worktree");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectPass(raw: string): void {
  const issues = validateOps005ProductionEvidence(raw, { now, expectedIdentity, evidenceBaseDir: evidenceRoot });
  if (issues.length > 0) throw new Error(`expected pass, got ${JSON.stringify(issues)}`);
}

function expectIdentityFail(raw: string, field: string): void {
  const issues = validateOps005ProductionEvidence(raw, { now, expectedIdentity, evidenceBaseDir: evidenceRoot });
  if (!issues.some((issue) => issue.field === field && issue.message.includes("signed Release identity"))) {
    throw new Error(`expected bound ${field} failure, got ${JSON.stringify(issues)}`);
  }
}

function expectFail(raw: string, field: string): void {
  const issues = validateOps005ProductionEvidence(raw, { now, evidenceBaseDir: evidenceRoot });
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
    "localValidationCommands: pnpm ops:ops-005:local:selftest,pnpm ops:ops-005:preflight:selftest,pnpm ops:ops-005:evidence:selftest,pnpm shellcheck:updater,pnpm github-release-updater:preflight,pnpm check",
    "signedReleaseStatus: pass",
    "productionDeploymentStatus: pass",
    "timerPausedBeforeDeployment: yes",
    "legacyMutationQueueDisposition: empty",
    "webAgentVersionMatch: yes",
    "v2CheckStatus: pass",
    `v2CheckRequestHash: sha256:${"e".repeat(64)}`,
    "expectedBeforeRejectionStatus: pass",
    "expectedBeforeRejectionExecutionAttempted: no",
    `expectedBeforeRejectionRequestHash: sha256:${"f".repeat(64)}`,
    "expectedBeforeRejectionEvidenceFile: expected-before-rejection.json",
    `expectedBeforeRejectionEvidenceHash: ${rejectionEvidenceHash()}`,
    "operationalEvidenceFile: operational-evidence.json",
    `operationalEvidenceHash: ${operationalEvidenceHash()}`,
    "sharedProductionStateLockStatus: pass",
    "processingReconciliationStatus: pass",
    "autoApply: none",
    "redactedDecisionHistoryFile: decision-history.json",
    `redactedDecisionHistoryHash: ${decisionHistoryHash()}`,
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

function writeEvidenceFiles(): void {
  writeFileSync(path.join(evidenceRoot, "expected-before-rejection.json"), rejectionEvidence());
  writeFileSync(path.join(evidenceRoot, "decision-history.json"), decisionHistoryEvidence());
  writeFileSync(path.join(evidenceRoot, "operational-evidence.json"), operationalEvidence());
}

function rejectionEvidence(): string {
  return JSON.stringify({
    schemaVersion: 1,
    mode: "redacted_ops005_expected_before_rejection",
    releaseTag: expectedIdentity.releaseTag,
    packageVersion: expectedIdentity.packageVersion,
    gitCommit: expectedIdentity.gitCommit,
    webImageDigest: expectedIdentity.webImageDigest,
    requestHash: `sha256:${"f".repeat(64)}`,
    reasonCode: "EXPECTED_BEFORE_MISMATCH",
    decision: "REJECTED",
    executionAttempted: false,
  }, null, 2) + "\n";
}

function decisionHistoryEvidence(): string {
  return JSON.stringify({
    schemaVersion: 1,
    mode: "redacted_ops005_decision_history",
    releaseTag: expectedIdentity.releaseTag,
    packageVersion: expectedIdentity.packageVersion,
    gitCommit: expectedIdentity.gitCommit,
    webImageDigest: expectedIdentity.webImageDigest,
    decisions: [{
      requestHash: `sha256:${"f".repeat(64)}`,
      reasonCode: "EXPECTED_BEFORE_MISMATCH",
      decision: "REJECTED",
      executionAttempted: false,
    }, {
      schemaVersion: 2,
      action: "check",
      requestHash: `sha256:${"e".repeat(64)}`,
      reasonCode: "CHECK_COMPLETED",
      decision: "SUCCEEDED",
      executionAttempted: false,
    }],
  }, null, 2) + "\n";
}

function operationalEvidence(): string {
  return JSON.stringify({
    schemaVersion: 1,
    mode: "redacted_ops005_operational_evidence",
    releaseTag: expectedIdentity.releaseTag,
    packageVersion: expectedIdentity.packageVersion,
    gitCommit: expectedIdentity.gitCommit,
    webImageDigest: expectedIdentity.webImageDigest,
    autoApply: "none",
    productionDeployment: {
      status: "pass",
      timerPausedBeforeDeployment: true,
      legacyMutationQueueDisposition: "empty",
      webAgentVersionMatch: true,
    },
    v2Check: {
      status: "pass",
      schemaVersion: 2,
      action: "check",
      requestHash: `sha256:${"e".repeat(64)}`,
      decision: "SUCCEEDED",
      executionAttempted: false,
    },
    sharedProductionStateLock: {
      status: "pass",
      updaterInheritedLockVerified: true,
      mutationOverlapObserved: false,
    },
    processingReconciliation: {
      status: "pass",
      staleMutationReplayObserved: false,
      blockerProjectionVerified: true,
      readonlyCheckAllowed: true,
    },
  }, null, 2) + "\n";
}

function rejectionEvidenceHash(): string {
  return `sha256:${createHash("sha256").update(rejectionEvidence()).digest("hex")}`;
}

function decisionHistoryHash(): string {
  return `sha256:${createHash("sha256").update(decisionHistoryEvidence()).digest("hex")}`;
}

function operationalEvidenceHash(): string {
  return `sha256:${createHash("sha256").update(operationalEvidence()).digest("hex")}`;
}
