import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOperationalHandoff,
  buildOperationalHandoffSummary,
  formatOperationalHandoffSummary,
} from "../ops/operational-handoff";
import { protectedPathFiles } from "../ops/operability-status";
import {
  computeAcceptedExceptionBasisHash,
  type ResidualItemV2,
} from "./residual-ledger-common";

const requiredFiles = [
  "README.md",
  "docs/README.md",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/governance-register.json",
  "docs/development/governance-register.md",
  "docs/development/operations-lifecycle.md",
  "docs/development/operations-lifecycle.json",
  "docs/development/post-release-observation-template.json",
  "docs/development/post-release-observation-v0.1.7.json",
  "docs/development/product-experience-review-record-template.md",
  "docs/development/maintenance-cadence.md",
  "docs/development/maintenance-window-record-template.md",
  "docs/development/maintenance-window-index.json",
  "docs/development/incident-index.json",
  "docs/development/rollback-proof-record-template.md",
  "docs/development/operational-readiness.md",
  "docs/development/update-request-expected-before-design.md",
  "docs/development/data-integrity-doctor.md",
  "docs/development/ops-005-expected-before-production-evidence-template.md",
  "docs/development/high-risk-confirmation-packets.md",
  "tasks/active/0019-update-request-expected-before-binding.md",
  "tasks/active/0020-business-state-concurrency.md",
  "tasks/active/0021-attachment-staging-intent.md",
  "tasks/active/0022-updater-phase-journal-hold.md",
  "docs/development/release-v0.1.7-record.md",
  "docs/development/support-bundle-preview.md",
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/validation-matrix.md",
  "workflow/README.md",
  "apps/web/lib/system/update-center.ts",
  "apps/web/app/api/system/update-requests/route.ts",
  "apps/web/lib/system/update-request-v2.ts",
  "ops/update-agent/areaforge-update-agent.sh",
  "ops/update-agent/lib/update-request-v2.sh",
  "ops/update-agent/lib/update-request-state.sh",
  "ops/github-release-updater/areaforge-updater.sh",
  "scripts/quality/update-center-request-v2.selftest.ts",
  "scripts/quality/update-agent-request-v2.selftest.ts",
  "scripts/quality/update-production-state-lock.selftest.ts",
  ".codex/skills-src/README.md",
  ".codex/skills-src/areaforge-operating-loop/SKILL.md",
  ".codex/skills-src/areaforge-sre-ops/SKILL.md",
  ".codex/skills-src/areaforge-observability/SKILL.md",
  ".codex/skills-src/areaforge-residual-ledger/SKILL.md",
  "scripts/ops/operability-status.ts",
  "scripts/quality/operability-status-validate.ts",
  "scripts/quality/operability-status-validate.selftest.ts",
  "scripts/ops/operational-handoff.ts",
  "scripts/quality/operational-handoff-validate.ts",
  "scripts/quality/operational-handoff-validate.selftest.ts",
  "scripts/ops/long-term-operability-live-gate.ts",
  "scripts/ops/long-term-evidence-snapshot.ts",
  "scripts/quality/ops-readonly-side-effect.selftest.ts",
  "scripts/ops/operational-readiness-summary.ts",
  "scripts/ops/operational-evidence-bundle.ts",
  "scripts/ops/support-bundle-preview.ts",
  "scripts/ops/backup-restore-preview.ts",
  "scripts/quality/backup-restore-preview-validate.ts",
  "scripts/quality/backup-restore-preview.selftest.ts",
  "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
  "scripts/quality/release-evidence-redacted-export-validate.ts",
  "scripts/quality/release-evidence-redacted-export.selftest.ts",
  "scripts/ops/release-closeout-audit.ts",
  "scripts/quality/release-closeout-audit-validate.ts",
  "scripts/quality/release-closeout-audit.selftest.ts",
  "scripts/ops/post-release-observation-status.ts",
  "scripts/quality/post-release-observation-status.selftest.ts",
  "scripts/quality/post-release-observation-validate.ts",
  "scripts/quality/product-experience-review-discovery.ts",
  "scripts/quality/product-experience-review-validate.ts",
  "scripts/quality/post-release-observation-validate.selftest.ts",
  "scripts/quality/attachment-reconciliation.ts",
  "scripts/quality/attachment-reconciliation-summary.ts",
  "scripts/quality/attachment-reconciliation-summary.selftest.ts",
  "scripts/ops/data-integrity-doctor.ts",
  "scripts/quality/data-integrity-doctor-validate.ts",
  "scripts/quality/data-integrity-doctor.selftest.ts",
  "scripts/quality/release-evidence-validate.ts",
  "scripts/quality/release-evidence-validate.selftest.ts",
  "scripts/ops/ops001-evidence-preflight.ts",
  "scripts/ops/generate-ops001-fallback-closure.ts",
  "scripts/ops/ops004-alert-evidence-preflight.ts",
  "scripts/ops/ops005-evidence-preflight.ts",
  "scripts/quality/ops005-production-evidence-validate.ts",
  "scripts/ops/sc002-supply-chain-preflight.ts",
  "scripts/quality/github-main-protection-validate.ts",
  "scripts/ops/sc004-main-protection-preflight.ts",
  "scripts/ops/operational-alert-preview.ts",
  "scripts/ops/residual-review-due.ts",
  "scripts/ops/residual-promotion-preview.ts",
  "scripts/ops/generate-maintenance-window-record.ts",
  "scripts/ops/maintenance-window-index.ts",
  "scripts/quality/maintenance-window-index-common.ts",
  "scripts/quality/maintenance-window-index-validate.ts",
  "scripts/quality/maintenance-window-index.selftest.ts",
  "scripts/ops/incident-index.ts",
  "scripts/quality/incident-index-common.ts",
  "scripts/quality/incident-index-validate.ts",
  "scripts/quality/incident-index.selftest.ts",
  "scripts/quality/rollback-proof-record-validate.ts",
  "scripts/quality/rollback-proof-record-validate.selftest.ts",
  "scripts/quality/enterprise-operability-preflight.ts",
  "scripts/quality/residual-ledger-validate.ts",
  "scripts/quality/residual-promotion-preview.selftest.ts",
  "scripts/quality/residual-evidence-preflight.ts",
  "scripts/quality/residual-evidence-preflight.selftest.ts",
  "docs/development/residual-closure-review-template.md",
  "scripts/quality/residual-closure-review-validate.ts",
  "scripts/quality/residual-closure-review-validate.selftest.ts",
  "scripts/quality/operational-handoff.selftest.ts",
  "scripts/quality/long-term-operability-live-gate.selftest.ts",
  "scripts/quality/long-term-evidence-snapshot-validate.ts",
  "scripts/quality/long-term-evidence-snapshot.selftest.ts",
  "scripts/quality/maintenance-window-record.selftest.ts",
  "scripts/quality/maintenance-window-record-validate.ts",
  "scripts/quality/maintenance-window-record-validate.selftest.ts",
  "scripts/quality/support-bundle-preview-validate.ts",
  "scripts/quality/support-bundle-preview.selftest.ts",
  "scripts/quality/ops001-evidence-preflight.selftest.ts",
  "scripts/quality/ops004-alert-evidence-preflight.selftest.ts",
  "scripts/quality/ops005-evidence-preflight.selftest.ts",
  "scripts/quality/ops005-production-evidence-validate.selftest.ts",
  "scripts/quality/sc002-supply-chain-preflight.selftest.ts",
  "scripts/quality/github-main-protection-validate.selftest.ts",
  "scripts/quality/sc004-main-protection-preflight.selftest.ts",
  "scripts/quality/governance-register-validate.ts",
  "scripts/quality/governance-register-validate.selftest.ts",
  "scripts/quality/operations-lifecycle-validate.ts",
  "scripts/quality/operations-lifecycle-validate.selftest.ts",
];

const requiredScripts = [
  "ops:status",
  "ops:status:validate",
  "ops:status:validate:selftest",
  "ops:status:selftest",
  "governance:register:validate",
  "governance:register:selftest",
  "ops:lifecycle:validate",
  "ops:lifecycle:selftest",
  "ops:lifecycle:typecheck",
  "ops:handoff",
  "ops:handoff:validate",
  "ops:handoff:validate:selftest",
  "ops:handoff:selftest",
  "ops:readonly-side-effect:selftest",
  "ops:long-term:gate",
  "ops:long-term:gate:selftest",
  "ops:long-term:snapshot",
  "ops:long-term:snapshot:validate",
  "ops:long-term:snapshot:selftest",
  "ops:readiness:summary",
  "ops:evidence:bundle",
  "ops:support:bundle-preview",
  "ops:support:bundle-preview:validate",
  "ops:support:bundle-preview:selftest",
  "ops:backup-restore:preview",
  "ops:backup-restore:preview:validate",
  "ops:backup-restore:preview:selftest",
  "release:evidence:redacted-export:validate",
  "release:evidence:redacted-export:selftest",
  "release:closeout:audit",
  "release:closeout:audit:validate",
  "release:closeout:audit:selftest",
  "release:post-observation:validate",
  "release:post-observation:validate:selftest",
  "release:post-observation:status",
  "release:post-observation:status:selftest",
  "attachment:reconciliation",
  "attachment:reconciliation:summary",
  "attachment:reconciliation:summary:selftest",
  "ops:data-integrity:doctor",
  "ops:data-integrity:validate",
  "ops:data-integrity:selftest",
  "release:evidence:validate",
  "release:evidence:selftest",
  "ops:ops-001:preflight",
  "ops:ops-001:preflight:selftest",
  "ops:ops-001:fallback:finalize",
  "ops:ops-001:fallback:finalize:selftest",
  "ops:ops-004:preflight",
  "ops:ops-004:preflight:selftest",
  "ops:ops-005:preflight",
  "ops:ops-005:preflight:selftest",
  "ops:ops-005:local:selftest",
  "ops:ops-005:evidence:validate",
  "ops:ops-005:evidence:selftest",
  "sc:sc-002:preflight",
  "sc:sc-002:preflight:selftest",
  "sc:sc-004:validate",
  "sc:sc-004:validate:selftest",
  "sc:sc-004:preflight",
  "sc:sc-004:preflight:selftest",
  "ops:alert:preview",
  "enterprise:operability:preflight",
  "maintenance:cadence:preflight",
  "maintenance:window:record",
  "maintenance:window:record:selftest",
  "maintenance:window:validate",
  "maintenance:window:selftest",
  "maintenance:window:index",
  "maintenance:window:index:validate",
  "maintenance:window:index:selftest",
  "incident:index",
  "incident:index:validate",
  "incident:index:selftest",
  "rollback:proof:validate",
  "rollback:proof:selftest",
  "residuals:validate",
  "residuals:evidence:preflight",
  "residuals:evidence:preflight:selftest",
  "residuals:closure:validate",
  "residuals:closure:selftest",
  "residuals:review-due",
  "residuals:review-due:selftest",
  "residuals:promotion-preview",
  "residuals:promotion-preview:selftest",
  "release:train:preflight",
];

function main(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-operational-handoff-"));
  try {
    writeFixture(root);
    const handoff = buildOperationalHandoff({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });

    assert(handoff.schemaVersion === 2, "schemaVersion should be 2");
    assert(handoff.mode === "read_only_operational_handoff", "mode should identify handoff");
    assert(handoff.status.controlPlane === "pass", "fixture control plane should pass");
    assert(handoff.status.offlineOverall === "blocked", "current blocker should block handoff status");
    assert(handoff.status.releaseTrain === "blocked", "current blocker should block release train");
    assert(/^[a-f0-9]{64}$/.test(handoff.source.controlPlaneSourceHash), "handoff should include control-plane source hash");
    assert(handoff.source.protectedPathFingerprint.algorithm === "sha256", "handoff should include protected path fingerprint algorithm");
    assert(
      handoff.source.protectedPathFingerprint.scope === "read_only_side_effect_guard_inputs",
      "handoff should include protected path fingerprint scope",
    );
    assert(
      /^[a-f0-9]{64}$/.test(handoff.source.protectedPathFingerprint.hash),
      "handoff should include protected path fingerprint hash",
    );
    assert(
      JSON.stringify(handoff.source.protectedPathFingerprint.paths) === JSON.stringify([...protectedPathFiles]),
      "handoff protected path fingerprint should exactly match the protected path set",
    );
    assert(
      handoff.source.protectedPathFingerprint.doesNotProve.includes("production health"),
      "handoff protected path fingerprint should preserve non-proof boundary",
    );
    assert(handoff.doesNotProve.includes("updater apply completion"), "handoff should include explicit non-proof boundary");
    assert(
      handoff.doesNotProve.includes("permission to read, print, copy, or commit secrets"),
      "handoff should not imply secret handling permission",
    );
    assert(handoff.evidenceFocus.currentBlockers.some((item) => item.residualRiskId === "AF-RISK-OPS-001"), "handoff should surface non-executable current blockers");
    assert(
      handoff.evidenceFocus.boundaryStops.some((item) =>
        item.key === "post_update_ops001" && item.currentBoundary.includes("no secret read/print/copy/commit")
      ),
      "handoff should surface no-secret OPS-001 boundary stop",
    );
    assert(
      handoff.evidenceFocus.boundaryStops.some((item) => item.key === "release_backup_hashes"),
      "handoff should surface release backup hash boundary stop",
    );
    assert(
      handoff.evidenceFocus.boundaryStops.some((item) =>
        item.key === "release_backup_hashes" && item.evidence.includes("releaseEvidenceBundleHash")
      ),
      "handoff should include release evidence bundle hash in release boundary stop",
    );
    assert(
      handoff.evidenceFocus.boundaryStops.some((item) =>
        item.key === "update_request_expected_before" &&
        item.currentBoundary.includes("no matching signed Release for the verified V2 checkout") &&
        item.currentBoundary.includes("no production deployment confirmation")
      ),
      "handoff should separate verified expected-before implementation from signed Release and deployment confirmations",
    );
    assert(handoff.evidenceFocus.releaseEvidenceGaps.status === "needs_evidence", "handoff should include release evidence gap status");
    assert(handoff.evidenceFocus.uxReview.status === "missing", "handoff must inherit the status projection UX evaluator result");
    assert(
      handoff.evidenceFocus.releaseEvidenceGaps.blockingGaps.some((gap) =>
        gap.key === "attachmentReconciliationSummaryHash" && gap.gapType === "attachment_reconciliation_binding"
      ),
      "handoff should include attachment reconciliation binding gaps",
    );
    assert(
      handoff.evidenceFocus.releaseEvidenceGaps.blockingGaps.some((gap) =>
        gap.key === "releaseEvidenceBundleHash" && gap.gapType === "release_evidence_bundle_hash"
      ),
      "handoff should include releaseEvidenceBundleHash gap",
    );
    assert(handoff.evidenceFocus.currentBlockers.every((item) => item.kind === "current_blocker"), "current blocker focus items should use current_blocker kind");
    assert(handoff.evidenceFocus.immediate.some((item) => item.residualRiskId === "AF-RISK-OPS-009"), "handoff should still surface executable residuals separately");
    assert(handoff.evidenceFocus.currentBlockers.some((item) => item.residualRiskId === "AF-RISK-OPS-005"), "handoff should surface expected-before blocker");
    assert(handoff.evidenceFocus.currentBlockers.some((item) => item.residualRiskId === "AF-RISK-OPS-006"), "handoff should surface future current blockers");
    assert(handoff.evidenceFocus.dueOrSoon.some((item) => item.residualRiskId === "AF-RISK-SC-002"), "handoff should include due release residual");
    assert(handoff.evidenceFocus.releaseRelevantIds.includes("AF-RISK-SC-002"), "handoff should preserve release relevant IDs");
    assert(handoff.claimBoundary.cannotClaim.some((claim) => claim.includes("current production health")), "handoff should forbid production health overclaim");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:support:bundle-preview"), "handoff should include support bundle preview command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:status:validate <operability-status.json>"), "handoff should include operability status validation command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:handoff:validate <operational-handoff.json>"), "handoff should include operational handoff validation command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>"), "handoff should include support bundle preview validation command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:backup-restore:preview"), "handoff should include backup/restore preview command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>"), "handoff should include backup/restore preview validation command");
    assert(handoff.nextCommands.handoff.includes("pnpm incident:index"), "handoff should include resolved incident index generation command");
    assert(handoff.nextCommands.handoff.includes("pnpm incident:index:validate docs/development/incident-index.json"), "handoff should include resolved incident index validation command");
    assert(handoff.nextCommands.handoff.includes("pnpm residuals:evidence:preflight"), "handoff should include residual evidence preflight command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:ops-006:preflight:strict"), "handoff should include OPS-006 strict preflight command");
    assert(handoff.nextCommands.handoff.includes("pnpm sc:sc-004:preflight"), "handoff should include SC-004 preflight command");
    assert(handoff.nextCommands.handoff.includes("pnpm sc:sc-004:preflight:selftest"), "handoff should include SC-004 preflight selftest command");
    assert(handoff.nextCommands.handoff.includes("pnpm attachment:crash-window:selftest"), "handoff should include OPS-007 fixture command");
    assert(handoff.nextCommands.handoff.includes("pnpm updater:phase-journal:selftest"), "handoff should include OPS-008 fixture command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:ops-007:preflight:strict"), "handoff should include OPS-007 strict preflight");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:ops-008:preflight:strict"), "handoff should include OPS-008 strict preflight");
    assert(handoff.nextCommands.handoff.includes("pnpm residuals:closure:validate <residual-closure-review-record>"), "handoff should include residual closure review validation command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm maintenance:window:record"), "handoff should include maintenance window record generation command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:ops-001:preflight"), "handoff should include OPS-001 evidence preflight command");
    assert(handoff.nextCommands.liveEvidence.some((command: string) => command.includes("ops:ops-001:fallback:finalize")), "handoff should include OPS-001 fallback finalizer command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:backup-restore:preview"), "handoff should include backup/restore preview as live evidence prep");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>"), "handoff should include backup/restore preview validation as live evidence prep");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm release:evidence:redacted-export:validate <redacted-export-dir>"), "handoff should include release evidence redacted export validation as live evidence prep");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm sc:sc-004:validate <readback.json> <controlled-pr.json>"), "handoff should include SC-004 evidence validation");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm residuals:evidence:preflight"), "handoff should include residual evidence preflight as live evidence prep");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm residuals:closure:validate <residual-closure-review-record>"), "handoff should include residual closure review validation as live evidence prep");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:evidence:bundle"), "handoff should include evidence bundle command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:long-term:snapshot"), "handoff should include long-term evidence snapshot command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json>"), "handoff should include long-term evidence snapshot validation command");
    assert(handoff.nextCommands.release.includes("pnpm sc:sc-002:preflight"), "handoff should include SC-002 supply-chain preflight command");
    assert(handoff.safetyFacts.readOnly === true, "handoff should be read-only");
    assert(handoff.safetyFacts.networkRequested === false, "handoff should not request network");
    assert(handoff.safetyFacts.protectedPathWriteAttempted === false, "handoff should not write protected paths");
    assert(handoff.safetyFacts.handoffWritten === false, "handoff should not write files");
    const summary = buildOperationalHandoffSummary(handoff);
    const formattedSummary = formatOperationalHandoffSummary(summary);
    assert(summary.uxReview.startsWith("missing:"), "handoff summary must expose the inherited UX evidence status");
    assert(summary.title === "AreaForge operational handoff", "summary should have a stable title");
    assert(summary.currentBlockers.some((item) => item.includes("AF-RISK-OPS-001")), "summary should include non-executable current blockers");
    assert(summary.boundaryStops.some((item) => item.includes("post_update_ops001")), "summary should include boundary stops");
    assert(summary.boundaryStops.some((item) => item.includes("update_request_expected_before")), "summary should include expected-before boundary stop");
    assert(summary.releaseEvidenceGaps.some((item) => item.includes("releaseEvidenceBundleHash")), "summary should include release evidence gaps");
    assert(summary.immediateFocus.some((item) => item.includes("AF-RISK-OPS-009")), "summary should include immediate focus");
    assert(summary.currentBlockers.some((item) => item.includes("AF-RISK-OPS-005")), "summary should include expected-before blocker");
    assert(summary.currentBlockers.some((item) => item.includes("AF-RISK-OPS-006")), "summary should include future current blockers");
    assert(summary.dueOrSoonFocus.some((item) => item.includes("AF-RISK-SC-002")), "summary should include due release residual");
    assert(summary.nextHandoffCommands.includes("pnpm ops:status --summary"), "summary should include human-readable handoff commands");
    assert(summary.nextLiveEvidenceCommands.includes("pnpm ops:ops-001:preflight"), "summary should include live evidence commands");
    assert(summary.nextLiveEvidenceCommands.includes("pnpm ops:backup-restore:preview"), "summary should include backup/restore preview command");
    assert(summary.nextLiveEvidenceCommands.includes("pnpm release:evidence:redacted-export:validate <redacted-export-dir>"), "summary should include release redacted export validation command");
    assert(summary.cannotClaim.some((claim) => claim.includes("current production health")), "summary should preserve claim boundary");
    assert(formattedSummary.includes("AreaForge operational handoff"), "formatted summary should include title");
    assert(formattedSummary.includes("safetyFacts: readOnly=true"), "formatted summary should include safety facts");

    rmSync(path.join(root, "scripts/ops/operational-handoff.ts"));
    const blocked = buildOperationalHandoff({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(blocked.status.controlPlane === "fail", "missing handoff script should fail control plane");
    assert(blocked.status.offlineOverall === "blocked", "missing control-plane file should block handoff status");

    console.log("PASS operational handoff selftest");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function writeFixture(root: string): void {
  const scripts = Object.fromEntries(requiredScripts.map((name) => [name, `fixture ${name}`]));
  writeJson(root, "package.json", {
    name: "@areasong/areaforge",
    version: "0.1.5",
    scripts,
  });
  for (const file of requiredFiles) {
    writeText(root, file, file.endsWith(".json") ? fixtureLedgerJson() : `fixture ${file}\n`);
  }
  writeText(root, "docs/development/release-v0.1.7-record.md", fixtureReleaseRecord());
}

function fixtureReleaseRecord(): string {
  return [
    "releaseTag: v0.1.7",
    "releaseEvidenceBundleHash: pending-redacted-root-only-backup-hash-copy",
    "databaseBackupSha256: not-copied-root-only-update-record",
    "uploadsBackupSha256: not-copied-root-only-update-record",
    "envBackupSha256: not-copied-root-only-update-record",
    "",
  ].join("\n");
}

function fixtureLedgerJson(): string {
  const acceptedException = residualItem({
    id: "AF-RISK-REL-001",
    type: "accepted-exception",
    reviewAt: "2026-08-10",
    currentImpact: "auto apply remains disabled",
    closeCondition: "explicit user confirmation",
    requiredEvidence: "confirmation record",
    ownerSkills: ["areaforge-release-operator"],
  });
  acceptedException.acceptedException = {
    status: "approved",
    scope: "keep automatic apply disabled",
    reason: "production updates remain explicitly confirmed",
    acceptedBy: "fixture-maintainer",
    acceptedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-10T00:00:00.000Z",
    reopenConditions: ["automatic apply policy changes"],
    basisHash: "",
    sourceRef: "docs/development/residual-risk-ledger.md",
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    supersededBy: null,
  };
  acceptedException.acceptedException.basisHash = computeAcceptedExceptionBasisHash(acceptedException);

  return JSON.stringify({
    schemaVersion: 2,
    source: "docs/development/residual-risk-ledger.md",
    items: [
      residualItem({
        id: "AF-RISK-OPS-001",
        type: "current-blocker",
        reviewAt: "2026-07-17",
        currentImpact: "post-version OPS-001 evidence is still missing",
        closeCondition: "current production smoke, update status, evidence bundle, and closure packet pass validators",
        requiredEvidence: "redacted smoke record, update-agent status record, evidence bundle, and closure packet",
        ownerSkills: ["areaforge-sre-ops", "areaforge-qa-smoke"],
      }),
      residualItem({
        id: "AF-RISK-OPS-005",
        type: "current-blocker",
        reviewAt: "2026-07-17",
        currentImpact: "update requests are not bound to expected-before state",
        closeCondition: "V2 contract, release, and production deployment evidence",
        requiredEvidence: "expected-before design, local selftests, signed release, and redacted production evidence",
        ownerSkills: ["areaforge-security-governance", "areaforge-release-operator", "areaforge-sre-ops"],
      }),
      residualItem({
        id: "AF-RISK-OPS-006",
        type: "current-blocker",
        reviewAt: "2026-08-17",
        currentImpact: "business state concurrency controls are not implemented",
        closeCondition: "additive uniqueness and expected-status CAS pass concurrency validation",
        requiredEvidence: "migration, concurrency fixtures, doctor before/after, and signed release",
        ownerSkills: ["areaforge-security-governance", "areaforge-sre-ops"],
      }),
      residualItem({
        id: "AF-RISK-OPS-009",
        type: "monitoring-gap",
        reviewAt: "2026-07-17",
        currentImpact: "production extra smoke needs server configuration",
        executableNow: true,
        closeCondition: "recent read-only smoke record",
        requiredEvidence: "redacted smoke record",
        ownerSkills: ["areaforge-sre-ops", "areaforge-qa-smoke"],
        taskPromotionWaiver: {
          id: "AF-WAIVER-OPS-009",
          scope: "fixture executable monitoring review",
          reason: "fixture has no task tree",
          approvedBy: "fixture-maintainer",
          approvedAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "2026-07-16T00:00:00.000Z",
        },
      }),
      residualItem({
        id: "AF-RISK-SC-002",
        type: "release-follow-up",
        reviewAt: "2026-07-24",
        currentImpact: "next GitHub CI or Release run evidence is missing",
        closeCondition: "next run records actions pinning and audit evidence",
        requiredEvidence: "GitHub Actions run record",
        ownerSkills: ["areaforge-supply-chain", "areaforge-enterprise-governance"],
      }),
      acceptedException,
    ],
  }, null, 2);
}

function residualItem(
  overrides: Partial<ResidualItemV2> & Pick<
    ResidualItemV2,
    "id" | "type" | "reviewAt" | "currentImpact" | "closeCondition" | "requiredEvidence" | "ownerSkills"
  >,
): ResidualItemV2 {
  return {
    executableNow: false,
    taskRefs: [],
    taskPromotionWaiver: null,
    acceptedException: null,
    ...overrides,
  };
}

function writeJson(root: string, file: string, value: unknown): void {
  writeText(root, file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root: string, file: string, content: string): void {
  const fullPath = path.join(root, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

main();
