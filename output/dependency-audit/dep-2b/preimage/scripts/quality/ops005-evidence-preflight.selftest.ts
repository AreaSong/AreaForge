import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOps005EvidencePreflight } from "../ops/ops005-evidence-preflight";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops005-preflight-"));
const gitCommit = "a".repeat(40);
const now = new Date("2026-07-13T01:00:00.000Z");
const webImageDigest = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;
const migrationImageDigest = `ghcr.io/areasong/areaforge-migration:v0.1.8@sha256:${"d".repeat(64)}`;
const releaseAssetsDir = "release-assets";

try {
  writeBase(false);
  expectStatus("needs_local_implementation");

  writeBase(true);
  expectStatus("needs_signed_release");
  for (const member of [
    "update-center:health:selftest",
    "update-center:request-v2:selftest",
    "update-center:request-guard:selftest",
    "update-agent-request-v2.selftest.ts",
    "update-production-state-lock.selftest.ts",
  ]) {
    expectAggregateMemberRequired(member);
  }

  expectDirtyWorktreeFailsClosed();
  expectGitCommitOverrideMismatchFailsClosed();

  writeReleaseRecord();
  expectStatus("needs_production_evidence");

  const evidencePath = "evidence/ops005-production.txt";
  writeOps005EvidenceFiles("evidence");
  writeText(evidencePath, productionRecord());
  expectStatus("ready_for_ops005_human_review", evidencePath);
  expectEvidenceOnlyCloseoutReady(evidencePath);

  writeText(evidencePath, productionRecord().replace(webImageDigest, `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"9".repeat(64)}`));
  expectStatus("invalid", evidencePath);

  writeText(evidencePath, productionRecord().replace(sourceHash("ops/update-agent/areaforge-update-agent.sh"), `sha256:${"8".repeat(64)}`));
  expectStatus("invalid", evidencePath);

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
    gitHead: gitCommit,
    gitCommit,
    gitWorktreeClean: true,
    releaseRecordPath: "docs/development/release-supply-chain-v0.1.8.md",
    releaseAssetsDir,
    productionEvidencePath,
    releaseSignatureVerifier: () => undefined,
    sourceAtCommit: (commit, file) => {
      if (commit !== gitCommit) return "";
      return readFileSync(path.join(root, file), "utf8");
    },
  });
  if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  if (status === "ready_for_ops005_human_review" &&
    (!result.evidence.productionRejection.exists || !result.evidence.productionRejection.sha256 ||
      !result.evidence.productionDecisionHistory.exists || !result.evidence.productionDecisionHistory.sha256 ||
      !result.evidence.productionOperational.exists || !result.evidence.productionOperational.sha256)) {
    throw new Error(`ready preflight must expose bound production artifact hashes: ${JSON.stringify(result.evidence)}`);
  }
  if (result.safetyFacts.readOnly !== true || result.safetyFacts.networkRequested !== false || result.safetyFacts.productionWriteAttempted !== false) {
    throw new Error("preflight safety facts are invalid");
  }
}

function expectDirtyWorktreeFailsClosed(): void {
  const result = buildOps005EvidencePreflight({
    root,
    now,
    gitHead: gitCommit,
    gitCommit,
    gitWorktreeClean: false,
    releaseRecordPath: "docs/development/release-supply-chain-v0.1.8.md",
  });
  if (result.status !== "needs_signed_release" || result.gitCommit !== null || result.gitWorktreeClean !== false) {
    throw new Error(`dirty worktree must not identify a verified Release commit: ${JSON.stringify(result)}`);
  }
}

function expectGitCommitOverrideMismatchFailsClosed(): void {
  const result = buildOps005EvidencePreflight({
    root,
    now,
    gitHead: gitCommit,
    gitCommit: "b".repeat(40),
    gitWorktreeClean: true,
    releaseRecordPath: "docs/development/release-supply-chain-v0.1.8.md",
    releaseCloseoutBindingEvaluator: (_root, releaseGitCommit, currentGitCommit) => ({
      status: "invalid",
      releaseGitCommit,
      currentGitCommit,
      worktreeClean: true,
      changedPaths: ["apps/web/app.ts"],
      issues: ["non-evidence paths changed after Release: apps/web/app.ts"],
    }),
  });
  if (result.status !== "needs_signed_release" || result.gitCommit !== null || result.gitCommitMatchesHead !== false) {
    throw new Error(`git commit overrides must match HEAD before Release binding: ${JSON.stringify(result)}`);
  }
}

function expectEvidenceOnlyCloseoutReady(productionEvidencePath: string): void {
  const closeoutHead = "c".repeat(40);
  const result = buildOps005EvidencePreflight({
    root,
    now,
    gitHead: closeoutHead,
    gitCommit,
    gitWorktreeClean: true,
    releaseRecordPath: "docs/development/release-supply-chain-v0.1.8.md",
    releaseAssetsDir,
    productionEvidencePath,
    releaseSignatureVerifier: () => undefined,
    releaseCloseoutBindingEvaluator: (_root, releaseGitCommit, currentGitCommit) => ({
      status: "evidence_only",
      releaseGitCommit,
      currentGitCommit,
      worktreeClean: true,
      changedPaths: ["docs/development/residual-risk-ledger.md"],
      issues: [],
    }),
    sourceAtCommit: (commit, file) => {
      if (commit !== gitCommit) return "";
      return readFileSync(path.join(root, file), "utf8");
    },
  });
  if (result.status !== "ready_for_ops005_human_review" || result.gitCommitMatchesHead !== false || result.closeoutBinding.status !== "evidence_only") {
    throw new Error(`evidence-only closeout should retain Release identity: ${JSON.stringify(result)}`);
  }
}

function expectAggregateMemberRequired(member: string): void {
  const packagePath = path.join(root, "package.json");
  const original = readFileSync(packagePath, "utf8");
  const packageJson = JSON.parse(original) as { scripts: Record<string, string> };
  packageJson.scripts["ops:ops-005:local:selftest"] = packageJson.scripts["ops:ops-005:local:selftest"].replace(member, "removed-member");
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  try {
    expectStatus("needs_local_implementation");
  } finally {
    writeFileSync(packagePath, original);
  }
}

function writeBase(implemented: boolean): void {
  writeText("package.json", JSON.stringify({
    version: "0.1.8",
    scripts: implemented ? {
      "update-center:request-v2:selftest": "tsx scripts/quality/request-v2.selftest.ts",
      "ops:ops-005:local:selftest": "pnpm update-center:health:selftest && pnpm update-center:request-v2:selftest && pnpm update-center:request-guard:selftest && tsx scripts/quality/update-agent-request-v2.selftest.ts && tsx scripts/quality/update-production-state-lock.selftest.ts",
    } : {},
  }, null, 2));
  writeText("docs/development/update-request-expected-before-design.md", "fixture design\n");
  writeText("docs/deployment/keys/areaforge-cosign.pub", "synthetic public key\n");
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
  const manifest = JSON.stringify({
    schemaVersion: 1,
    app: "AreaForge",
    version: "0.1.8",
    channel: "stable",
    gitCommit,
    webImageDigest,
    migrationImageDigest,
    releaseNotesUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.8",
  });
  const assets: Record<string, string> = {
    "areaforge-release-manifest.json": manifest,
    "areaforge-sbom.spdx.json": "{}",
    "areaforge-provenance.json": "{}",
    "docker-compose.prod.yml": "services: {}\n",
  };
  for (const [name, content] of Object.entries(assets)) writeText(`${releaseAssetsDir}/${name}`, content);
  writeText(`${releaseAssetsDir}/SHA256SUMS`, Object.entries(assets)
    .map(([name, content]) => `${createHash("sha256").update(content).digest("hex")}  ${name}`)
    .join("\n") + "\n");
  writeText(`${releaseAssetsDir}/SHA256SUMS.sig`, "synthetic cosign bundle\n");
  writeText("docs/development/release-supply-chain-v0.1.8.md", [
    "recordId: release-supply-chain-v0.1.8",
    "recordedAt: 2026-07-13T00:00:00.000Z",
    "releaseTag: v0.1.8",
    "releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.8",
    "workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/123456789",
    "workflowRunConclusion: success",
    `gitCommit: ${gitCommit}`,
    "channel: stable",
    "packageVersion: 0.1.8",
    "validateJobStatus: pass",
    "auditProdStatus: pass",
    "governancePreflightStatus: pass",
    "actionsPinningStatus: pass",
    "releaseWorkflowStatus: pass",
    `webImageDigest: ${webImageDigest}`,
    `migrationImageDigest: ${migrationImageDigest}`,
    "manifestAsset: areaforge-release-manifest.json",
    "sbomAsset: areaforge-sbom.spdx.json",
    "provenanceAsset: areaforge-provenance.json",
    "sha256SumsAsset: SHA256SUMS",
    "signatureAsset: SHA256SUMS.sig",
    "sha256SumsCovers: areaforge-release-manifest.json,areaforge-sbom.spdx.json,areaforge-provenance.json,docker-compose.prod.yml",
    "checksumVerification: pass",
    "signatureVerification: pass",
    `manifestSha256: ${assetHash(assets["areaforge-release-manifest.json"] ?? "")}`,
    `sbomSha256: ${assetHash(assets["areaforge-sbom.spdx.json"] ?? "")}`,
    `provenanceSha256: ${assetHash(assets["areaforge-provenance.json"] ?? "")}`,
    `composeSha256: ${assetHash(assets["docker-compose.prod.yml"] ?? "")}`,
    "stableSigningRequired: yes",
    "unsignedPlaceholderPresent: no",
    "residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002",
    "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:",
    "  secretsPrinted: no",
    "  productionEnvIncluded: no",
    "  backupIncluded: no",
    "  promptOrRawAiResponseIncluded: no",
    "  attachmentContentIncluded: no",
    "  productionWriteAttempted: no",
    "",
  ].join("\n"));
}

function assetHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function productionRecord(): string {
  return [
    "recordId: ops-005-expected-before-v2-selftest",
    "recordedAt: 2026-07-13T00:00:00.000Z",
    "environment: production",
    "releaseTag: v0.1.8",
    "packageVersion: 0.1.8",
    `gitCommit: ${gitCommit}`,
    `webImageDigest: ${webImageDigest}`,
    `updateAgentScriptSha256: ${sourceHash("ops/update-agent/areaforge-update-agent.sh")}`,
    `updaterScriptSha256: ${sourceHash("ops/github-release-updater/areaforge-updater.sh")}`,
    "localImplementationStatus: pass",
    "localValidationCommands: pnpm ops:ops-005:local:selftest,pnpm ops:ops-005:preflight:selftest,pnpm ops:ops-005:evidence:selftest,pnpm shellcheck:updater,pnpm github-release-updater:preflight,pnpm check",
    "signedReleaseStatus: pass",
    "productionDeploymentStatus: pass",
    "timerPausedBeforeDeployment: yes",
    "legacyMutationQueueDisposition: isolated",
    "webAgentVersionMatch: yes",
    "v2CheckStatus: pass",
    `v2CheckRequestHash: sha256:${"e".repeat(64)}`,
    "expectedBeforeRejectionStatus: pass",
    "expectedBeforeRejectionExecutionAttempted: no",
    `expectedBeforeRejectionRequestHash: sha256:${"f".repeat(64)}`,
    "expectedBeforeRejectionEvidenceFile: expected-before-rejection.json",
    `expectedBeforeRejectionEvidenceHash: ${ops005EvidenceHash(rejectionEvidence())}`,
    "operationalEvidenceFile: operational-evidence.json",
    `operationalEvidenceHash: ${ops005EvidenceHash(operationalEvidence())}`,
    "sharedProductionStateLockStatus: pass",
    "processingReconciliationStatus: pass",
    "autoApply: none",
    "redactedDecisionHistoryFile: decision-history.json",
    `redactedDecisionHistoryHash: ${ops005EvidenceHash(decisionHistoryEvidence())}`,
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

function writeOps005EvidenceFiles(directory: string): void {
  writeText(`${directory}/expected-before-rejection.json`, rejectionEvidence());
  writeText(`${directory}/decision-history.json`, decisionHistoryEvidence());
  writeText(`${directory}/operational-evidence.json`, operationalEvidence());
}

function rejectionEvidence(): string {
  return JSON.stringify({
    schemaVersion: 1,
    mode: "redacted_ops005_expected_before_rejection",
    releaseTag: "v0.1.8",
    packageVersion: "0.1.8",
    gitCommit,
    webImageDigest,
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
    releaseTag: "v0.1.8",
    packageVersion: "0.1.8",
    gitCommit,
    webImageDigest,
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
    releaseTag: "v0.1.8",
    packageVersion: "0.1.8",
    gitCommit,
    webImageDigest,
    autoApply: "none",
    productionDeployment: {
      status: "pass",
      timerPausedBeforeDeployment: true,
      legacyMutationQueueDisposition: "isolated",
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

function ops005EvidenceHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function sourceHash(file: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path.join(root, file), "utf8")).digest("hex")}`;
}

function writeText(file: string, content: string): void {
  const fullPath = path.join(root, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}
