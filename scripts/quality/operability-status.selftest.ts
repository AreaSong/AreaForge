import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOperabilityStatusProjection,
  buildOperabilityStatusSummary,
  formatOperabilityStatusSummary,
  protectedPathFiles,
} from "../ops/operability-status";
import {
  computeAcceptedExceptionBasisHash,
  type AcceptedExceptionStatus,
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
  "tasks/backlog/0021-attachment-staging-intent.md",
  "tasks/backlog/0022-updater-phase-journal-hold.md",
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
  "scripts/quality/governance-register-validate.ts",
  "scripts/quality/governance-register-validate.selftest.ts",
  "scripts/quality/operations-lifecycle-validate.ts",
  "scripts/quality/operations-lifecycle-validate.selftest.ts",
  "scripts/quality/github-main-protection-validate.selftest.ts",
  "scripts/quality/sc004-main-protection-preflight.selftest.ts",
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
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-operability-status-"));
  try {
    writeFixture(root);
    const projection = buildOperabilityStatusProjection({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(projection.schemaVersion === 1, "schemaVersion should be 1");
    assert(projection.status.controlPlane === "pass", "fixture control plane should pass");
    assert(projection.status.overall === "blocked", "current blocker should block offline overall status");
    assert(projection.status.releaseTrain === "blocked", "current blocker should block release train status");
    assert(/^[a-f0-9]{64}$/.test(projection.sourceSnapshot.controlPlaneSourceHash), "projection should include control-plane source hash");
    assert(
      projection.sourceSnapshot.protectedPathFingerprint.algorithm === "sha256",
      "projection should identify protected path fingerprint algorithm",
    );
    assert(
      projection.sourceSnapshot.protectedPathFingerprint.scope === "read_only_side_effect_guard_inputs",
      "projection should identify protected path fingerprint scope",
    );
    assert(
      /^[a-f0-9]{64}$/.test(projection.sourceSnapshot.protectedPathFingerprint.hash),
      "projection should include protected path fingerprint hash",
    );
    assert(
      JSON.stringify(projection.sourceSnapshot.protectedPathFingerprint.paths) === JSON.stringify([...protectedPathFiles]),
      "projection protected path fingerprint should exactly match the protected path set",
    );
    assert(
      projection.sourceSnapshot.protectedPathFingerprint.doesNotProve.includes("production health"),
      "protected path fingerprint should not claim production health",
    );
    assert(projection.doesNotProve.includes("current production health"), "projection should include explicit non-proof boundary");
    assert(
      projection.doesNotProve.includes("permission to read, print, copy, or commit secrets"),
      "projection should not imply secret handling permission",
    );
    assert(
      projection.boundaryStops.some((stop) =>
        stop.key === "post_update_ops001" && stop.currentBoundary.includes("no secret read/print/copy/commit")
      ),
      "projection should explain no-secret OPS-001 boundary stop",
    );
    assert(
      projection.boundaryStops.some((stop) => stop.key === "release_backup_hashes"),
      "projection should explain release backup hash boundary stop",
    );
    assert(
      projection.boundaryStops.some((stop) =>
        stop.key === "release_backup_hashes" && stop.evidence.includes("releaseEvidenceBundleHash")
      ),
      "projection should include release evidence bundle hash in release boundary stop",
    );
    assert(
      projection.boundaryStops.some((stop) =>
        stop.key === "update_request_expected_before" &&
        stop.currentBoundary.includes("no matching signed Release for the verified V2 checkout") &&
        stop.currentBoundary.includes("no production deployment confirmation")
      ),
      "projection should separate verified expected-before implementation from signed Release and deployment confirmations",
    );
    assert(projection.safetyFacts.readOnly === true, "projection should be read-only");
    assert(projection.safetyFacts.networkRequested === false, "projection should not request network");
    assert(projection.safetyFacts.protectedPathWriteAttempted === false, "projection should not write protected paths");
    assert(projection.safetyFacts.statusProjectionWritten === false, "projection should not write a status file");
    assert(projection.residuals.countsByType["current-blocker"] === 3, "current blocker count should be 3");
    assert(projection.residuals.currentBlockerIds.includes("AF-RISK-OPS-006"), "future current blockers must remain explicit");
    assert(projection.releaseEvidenceGaps.status === "needs_evidence", "release evidence gaps should need evidence");
    assert(
      projection.releaseEvidenceGaps.blockingGaps.some((gap) =>
        gap.key === "releaseEvidenceBundleHash" && gap.gapType === "release_evidence_bundle_hash"
      ),
      "release evidence gaps should include releaseEvidenceBundleHash",
    );
    assert(
      projection.releaseEvidenceGaps.blockingGaps.some((gap) => gap.key === "databaseBackupSha256"),
      "release evidence gaps should include database backup hash",
    );
    assert(
      projection.releaseEvidenceGaps.blockingGaps.some((gap) =>
        gap.key === "attachmentReconciliationSummaryHash" && gap.gapType === "attachment_reconciliation_binding"
      ),
      "release evidence gaps should include attachment reconciliation binding",
    );
    assert(projection.residuals.countsByType["monitoring-gap"] === 0, "monitoring gap count should be 0");
    assert(projection.residuals.countsByReviewStatus.due_soon === 2, "due soon count should be 2");
    assert(
      projection.residuals.executableNowItems.some((item) => item.id === "AF-RISK-OPS-006"),
      "effective executable residual should be projected",
    );
    assert(
      projection.residuals.nonEffectiveAcceptedExceptionItems.some((item) =>
        item.id === "AF-RISK-AI-001" && item.effectiveExceptionStatus === "expired"
      ),
      "non-effective accepted exception should be projected",
    );
    assert(
      !projection.residuals.nonEffectiveAcceptedExceptionItems.some((item) => item.id === "AF-RISK-REL-001"),
      "effective accepted exception should not be projected as attention",
    );
    assert(
      projection.nextActions.some((item) =>
        item.residualRiskId === "AF-RISK-AI-001" && item.reason.startsWith("accepted_exception_expired:")
      ),
      "non-effective accepted exception should be projected into next actions",
    );
    assert(projection.requiredFiles.present.includes("docs/development/support-bundle-preview.md"), "projection should require support bundle preview docs");
    assert(projection.requiredFiles.present.includes("docs/development/operations-lifecycle.json"), "projection should require operations lifecycle source");
    assert(projection.requiredFiles.present.includes("docs/development/governance-register.json"), "projection should require governance register source");
    assert(projection.requiredFiles.present.includes("scripts/quality/operations-lifecycle-validate.ts"), "projection should require operations lifecycle validator");
    assert(projection.requiredFiles.present.includes("docs/development/update-request-expected-before-design.md"), "projection should require expected-before design docs");
    assert(projection.requiredFiles.present.includes("tasks/active/0019-update-request-expected-before-binding.md"), "projection should require expected-before active task");
    assert(projection.requiredFiles.present.includes("scripts/quality/residual-evidence-preflight.ts"), "projection should require residual evidence preflight file");
    assert(projection.requiredFiles.present.includes("scripts/quality/residual-evidence-preflight.selftest.ts"), "projection should require residual evidence preflight selftest file");
    assert(projection.requiredFiles.present.includes("docs/development/residual-closure-review-template.md"), "projection should require residual closure review template");
    assert(projection.requiredFiles.present.includes("scripts/quality/residual-closure-review-validate.ts"), "projection should require residual closure review validator file");
    assert(projection.requiredFiles.present.includes("scripts/quality/residual-closure-review-validate.selftest.ts"), "projection should require residual closure review selftest file");
    assert(projection.requiredFiles.present.includes("scripts/quality/operability-status-validate.ts"), "projection should require operability status validator file");
    assert(projection.requiredFiles.present.includes("scripts/quality/operability-status-validate.selftest.ts"), "projection should require operability status validator selftest file");
    assert(projection.requiredFiles.present.includes("scripts/quality/operational-handoff-validate.ts"), "projection should require operational handoff validator file");
    assert(projection.requiredFiles.present.includes("scripts/quality/operational-handoff-validate.selftest.ts"), "projection should require operational handoff validator selftest file");
    assert(projection.requiredFiles.present.includes("scripts/ops/backup-restore-preview.ts"), "projection should require backup/restore preview script file");
    assert(projection.requiredFiles.present.includes("scripts/quality/backup-restore-preview-validate.ts"), "projection should require backup/restore preview validator file");
    assert(projection.requiredFiles.present.includes("scripts/quality/backup-restore-preview.selftest.ts"), "projection should require backup/restore preview selftest file");
    assert(projection.requiredFiles.present.includes("scripts/ops/data-integrity-doctor.ts"), "projection should require data integrity doctor file");
    assert(projection.requiredFiles.present.includes("scripts/quality/data-integrity-doctor-validate.ts"), "projection should require data integrity doctor validator file");
    assert(projection.requiredFiles.present.includes("ops/update-agent/areaforge-release-evidence-redacted-export.sh"), "projection should require release evidence redacted export helper file");
    assert(projection.requiredFiles.present.includes("scripts/quality/release-evidence-redacted-export-validate.ts"), "projection should require release evidence redacted export validator file");
    assert(projection.requiredFiles.present.includes("scripts/quality/release-evidence-redacted-export.selftest.ts"), "projection should require release evidence redacted export selftest file");
    assert(projection.packageScripts.present.includes("ops:support:bundle-preview"), "projection should require support bundle preview script");
    assert(projection.packageScripts.present.includes("ops:lifecycle:validate"), "projection should require operations lifecycle validation");
    assert(projection.packageScripts.present.includes("governance:register:validate"), "projection should require governance register validation");
    assert(projection.packageScripts.present.includes("ops:lifecycle:selftest"), "projection should require operations lifecycle selftest");
    assert(projection.packageScripts.present.includes("ops:lifecycle:typecheck"), "projection should require operations lifecycle typecheck");
    assert(projection.packageScripts.present.includes("residuals:evidence:preflight"), "projection should require residual evidence preflight script");
    assert(projection.packageScripts.present.includes("residuals:evidence:preflight:selftest"), "projection should require residual evidence preflight selftest script");
    assert(projection.packageScripts.present.includes("residuals:closure:validate"), "projection should require residual closure review validator script");
    assert(projection.packageScripts.present.includes("residuals:closure:selftest"), "projection should require residual closure review selftest script");
    assert(projection.packageScripts.present.includes("ops:status:validate"), "projection should require operability status validator script");
    assert(projection.packageScripts.present.includes("ops:status:validate:selftest"), "projection should require operability status validator selftest script");
    assert(projection.packageScripts.present.includes("ops:handoff:validate"), "projection should require operational handoff validator script");
    assert(projection.packageScripts.present.includes("ops:handoff:validate:selftest"), "projection should require operational handoff validator selftest script");
    assert(projection.packageScripts.present.includes("ops:backup-restore:preview"), "projection should require backup/restore preview script");
    assert(projection.packageScripts.present.includes("ops:backup-restore:preview:validate"), "projection should require backup/restore preview validator script");
    assert(projection.packageScripts.present.includes("ops:backup-restore:preview:selftest"), "projection should require backup/restore preview selftest script");
    assert(projection.packageScripts.present.includes("release:evidence:redacted-export:validate"), "projection should require release evidence redacted export validator script");
    assert(projection.packageScripts.present.includes("release:evidence:redacted-export:selftest"), "projection should require release evidence redacted export selftest script");
    assert(projection.packageScripts.present.includes("release:closeout:audit"), "projection should require release closeout audit script");
    assert(projection.packageScripts.present.includes("release:closeout:audit:validate"), "projection should require release closeout audit validator script");
    assert(projection.packageScripts.present.includes("ops:ops-001:preflight"), "projection should require OPS-001 evidence preflight script");
    assert(projection.packageScripts.present.includes("ops:ops-001:fallback:finalize"), "projection should require OPS-001 fallback finalizer script");
    assert(projection.packageScripts.present.includes("ops:ops-004:preflight"), "projection should require OPS-004 alert evidence preflight script");
    assert(projection.packageScripts.present.includes("ops:ops-005:preflight"), "projection should require OPS-005 expected-before evidence preflight script");
    assert(projection.packageScripts.present.includes("ops:ops-005:evidence:validate"), "projection should require OPS-005 production evidence validator script");
    assert(projection.packageScripts.present.includes("sc:sc-002:preflight"), "projection should require SC-002 supply-chain preflight script");
    assert(projection.packageScripts.present.includes("sc:sc-004:validate"), "projection should require SC-004 evidence validator script");
    assert(projection.packageScripts.present.includes("sc:sc-004:preflight"), "projection should require SC-004 evidence preflight script");
    assert(projection.packageScripts.present.includes("ops:long-term:gate"), "projection should require long-term live evidence gate script");
    assert(projection.packageScripts.present.includes("ops:long-term:snapshot"), "projection should require long-term evidence snapshot script");
    assert(projection.packageScripts.present.includes("ops:readonly-side-effect:selftest"), "projection should require read-only side-effect selftest script");
    assert(projection.packageScripts.present.includes("ops:data-integrity:doctor"), "projection should require data integrity doctor script");
    assert(projection.packageScripts.present.includes("ops:data-integrity:validate"), "projection should require data integrity doctor validator script");
    assert(projection.packageScripts.present.includes("maintenance:window:record"), "projection should require maintenance window record generator");
    assert(projection.packageScripts.present.includes("maintenance:window:validate"), "projection should require maintenance window validator");
    assert(projection.packageScripts.present.includes("maintenance:window:index:validate"), "projection should require maintenance window index validator");
    assert(projection.packageScripts.present.includes("incident:index:validate"), "projection should require incident index validator");
    assert(projection.packageScripts.present.includes("rollback:proof:validate"), "projection should require rollback proof validator");
    assert(projection.commands.daily.includes("pnpm ops:support:bundle-preview"), "daily commands should include support bundle preview");
    assert(projection.commands.daily.includes("pnpm ops:status:validate <operability-status.json>"), "daily commands should include operability status validation");
    assert(projection.commands.daily.includes("pnpm ops:handoff:validate <operational-handoff.json>"), "daily commands should include operational handoff validation");
    assert(projection.commands.daily.includes("pnpm ops:backup-restore:preview"), "daily commands should include backup/restore preview");
    assert(projection.commands.daily.includes("pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>"), "daily commands should include backup/restore preview validation");
    assert(projection.commands.daily.includes("pnpm release:evidence:redacted-export:validate <redacted-export-dir>"), "daily commands should include release evidence redacted export validation");
    assert(projection.commands.daily.includes("pnpm ops:ops-001:preflight"), "daily commands should include OPS-001 evidence preflight");
    assert(projection.commands.daily.some((command: string) => command.includes("ops:ops-001:fallback:finalize")), "daily commands should include OPS-001 fallback finalizer");
    assert(projection.commands.daily.includes("pnpm ops:ops-004:preflight"), "daily commands should include OPS-004 alert evidence preflight");
    assert(projection.commands.daily.includes("pnpm ops:ops-005:preflight"), "daily commands should include OPS-005 expected-before evidence preflight");
    assert(projection.commands.daily.includes("pnpm ops:ops-005:evidence:validate <ops-005-production-evidence-record> <release-record> <release-assets-dir>"), "daily commands should include strict OPS-005 production evidence validation");
    assert(projection.commands.daily.includes("pnpm ops:long-term:snapshot"), "daily commands should include long-term evidence snapshot");
    assert(projection.commands.daily.includes("pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json>"), "daily commands should include long-term evidence snapshot validation");
    assert(projection.commands.daily.includes("pnpm maintenance:window:record"), "daily commands should include maintenance window record generation");
    assert(projection.commands.daily.includes("pnpm maintenance:window:index"), "daily commands should include maintenance window index generation");
    assert(projection.commands.daily.includes("pnpm incident:index"), "daily commands should include incident index generation");
    assert(projection.commands.daily.includes("pnpm residuals:evidence:preflight"), "daily commands should include residual evidence preflight");
    assert(projection.commands.daily.includes("pnpm residuals:closure:validate <residual-closure-review-record>"), "daily commands should include residual closure review validation");
    assert(projection.commands.weekly.includes("pnpm ops:support:bundle-preview:selftest"), "weekly commands should include support bundle preview selftest");
    assert(projection.commands.weekly.includes("pnpm ops:status:validate:selftest"), "weekly commands should include operability status validator selftest");
    assert(projection.commands.weekly.includes("pnpm ops:handoff:validate:selftest"), "weekly commands should include operational handoff validator selftest");
    assert(projection.commands.weekly.includes("pnpm ops:backup-restore:preview:selftest"), "weekly commands should include backup/restore preview selftest");
    assert(projection.commands.weekly.includes("pnpm release:evidence:redacted-export:selftest"), "weekly commands should include release evidence redacted export selftest");
    assert(projection.commands.weekly.includes("pnpm release:closeout:audit:selftest"), "weekly commands should include release closeout audit selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-001:preflight:selftest"), "weekly commands should include OPS-001 evidence preflight selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-001:fallback:finalize:selftest"), "weekly commands should include OPS-001 fallback finalizer selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-004:preflight:selftest"), "weekly commands should include OPS-004 alert evidence preflight selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-005:preflight:selftest"), "weekly commands should include OPS-005 expected-before preflight selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-005:evidence:selftest"), "weekly commands should include OPS-005 production evidence validator selftest");
    assert(projection.commands.weekly.includes("pnpm sc:sc-002:preflight:selftest"), "weekly commands should include SC-002 supply-chain preflight selftest");
    assert(projection.commands.weekly.includes("pnpm ops:long-term:snapshot:selftest"), "weekly commands should include long-term evidence snapshot selftest");
    assert(projection.commands.weekly.includes("pnpm ops:readonly-side-effect:selftest"), "weekly commands should include read-only side-effect selftest");
    assert(projection.commands.weekly.includes("pnpm ops:data-integrity:selftest"), "weekly commands should include data integrity doctor selftest");
    assert(projection.commands.weekly.includes("pnpm residuals:evidence:preflight:selftest"), "weekly commands should include residual evidence preflight selftest");
    assert(projection.commands.weekly.includes("pnpm residuals:closure:selftest"), "weekly commands should include residual closure review selftest");
    assert(projection.commands.weekly.includes("pnpm maintenance:window:record:selftest"), "weekly commands should include maintenance window record selftest");
    assert(projection.commands.weekly.includes("pnpm maintenance:window:index:selftest"), "weekly commands should include maintenance window index selftest");
    assert(projection.commands.weekly.includes("pnpm incident:index:selftest"), "weekly commands should include incident index selftest");
    assert(projection.commands.incident.includes("pnpm incident:index:validate docs/development/incident-index.json"), "incident commands should include saved incident index validation");
    assert(projection.commands.incident.includes("pnpm rollback:proof:validate <record>"), "incident commands should include rollback proof validation");
    assert(projection.commands.release.includes("pnpm sc:sc-002:preflight"), "release commands should include SC-002 supply-chain preflight");
    assert(projection.commands.release.includes("pnpm sc:sc-004:validate <readback.json> <controlled-pr.json>"), "release commands should include SC-004 evidence validation");
    assert(projection.commands.release.includes("pnpm ops:ops-005:preflight"), "release commands should include OPS-005 expected-before preflight");
    assert(projection.commands.release.includes("pnpm ops:long-term:gate"), "release commands should include long-term live evidence gate");
    assert(projection.commands.release.includes("pnpm ops:long-term:snapshot"), "release commands should include long-term evidence snapshot");
    assert(projection.commands.release.some((command) => command.includes("ops:data-integrity:doctor")), "release commands should include data integrity doctor");
    assert(projection.commands.release.includes("pnpm release:evidence:redacted-export:validate <redacted-export-dir>"), "release commands should include release evidence redacted export validation");
    assert(projection.commands.release.includes("pnpm release:closeout:audit -- --version <X.Y.Z>"), "release commands should include release closeout audit");
    assert(projection.commands.release.includes("pnpm release:evidence:redacted-export:selftest"), "release commands should include release evidence redacted export selftest");
    assert(projection.nextActions.some((action) => action.residualRiskId === "AF-RISK-OPS-001"), "next actions should include current blockers even when they are not locally executable");
    assert(projection.nextActions.some((action) => action.residualRiskId === "AF-RISK-OPS-005"), "next actions should include expected-before current blocker");
    assert(projection.residuals.releaseRelevantIds.includes("AF-RISK-OPS-005"), "release-relevant residuals should include expected-before blocker");
    const summary = buildOperabilityStatusSummary(projection);
    const formattedSummary = formatOperabilityStatusSummary(summary);
    assert(summary.title === "AreaForge operability status", "summary should have a stable title");
    assert(summary.offlineOverall === "blocked", "summary should preserve overall status");
    assert(summary.currentBlockers.some((item) => item.includes("AF-RISK-OPS-001")), "summary should include non-executable current blockers");
    assert(summary.currentBlockers.some((item) => item.includes("AF-RISK-OPS-005")), "summary should include expected-before current blocker");
    assert(summary.currentBlockers.some((item) => item.includes("AF-RISK-OPS-006")), "summary should include future current blockers");
    assert(summary.boundaryStops.some((item) => item.includes("post_update_ops001")), "summary should include boundary stops");
    assert(summary.boundaryStops.some((item) => item.includes("update_request_expected_before")), "summary should include expected-before boundary stop");
    assert(summary.releaseEvidenceGaps.some((item) => item.includes("releaseEvidenceBundleHash")), "summary should include release evidence gaps");
    assert(summary.dueResiduals.some((item) => item.includes("AF-RISK-OPS-001")), "summary should include due residual IDs");
    assert(summary.executableNowItems.some((item) => item.includes("AF-RISK-OPS-006")), "summary should include immediately executable residuals");
    assert(summary.nextEvidenceCommands.includes("pnpm ops:handoff --summary"), "summary should include human-readable next evidence commands");
    assert(summary.nextEvidenceCommands.includes("pnpm ops:ops-001:preflight"), "summary should include OPS-001 preflight command");
    assert(summary.nextEvidenceCommands.includes("pnpm ops:ops-006:preflight:strict"), "summary should include OPS-006 strict preflight command");
    assert(summary.nextEvidenceCommands.includes("pnpm sc:sc-004:preflight"), "summary should include SC-004 preflight command");
    assert(summary.nextEvidenceCommands.includes("pnpm sc:sc-004:preflight:selftest"), "summary should include SC-004 preflight selftest command");
    assert(summary.nextEvidenceCommands.includes("pnpm sc:sc-004:validate <readback.json> <controlled-pr.json>"), "summary should include SC-004 validator command");
    assert(summary.nextEvidenceCommands.includes("pnpm attachment:crash-window:selftest"), "summary should include OPS-007 fixture command");
    assert(summary.nextEvidenceCommands.includes("pnpm updater:phase-journal:selftest"), "summary should include OPS-008 fixture command");
    assert(summary.nextEvidenceCommands.includes("pnpm ops:ops-007:preflight:strict"), "summary should include OPS-007 strict preflight");
    assert(summary.nextEvidenceCommands.includes("pnpm ops:ops-008:preflight:strict"), "summary should include OPS-008 strict preflight");
    assert(summary.nextEvidenceCommands.includes("pnpm release:evidence:redacted-export:validate <redacted-export-dir>"), "summary should include release redacted export validation command");
    assert(summary.cannotClaim.includes("current production health"), "summary should include non-proof boundary");
    assert(formattedSummary.includes("AreaForge operability status"), "formatted summary should include title");
    assert(formattedSummary.includes("safetyFacts: readOnly=true"), "formatted summary should include safety facts");

    writeJson(root, "docs/development/residual-risk-ledger.json", {
      schemaVersion: 2,
      source: "docs/development/residual-risk-ledger.md",
      items: [
        residualItem({
          id: "AF-RISK-UX-001",
          type: "closed-evidence",
          reviewAt: "2026-07-10",
          currentImpact: "historical UX evidence requires periodic review",
          closeCondition: "fresh desktop and mobile review",
          requiredEvidence: "validated product experience record",
          ownerSkills: ["areaforge-product-experience", "areaforge-qa-smoke"],
        }),
      ],
    });
    const overdueClosedEvidence = buildOperabilityStatusProjection({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(overdueClosedEvidence.status.overall === "needs_live_evidence", "overdue closed evidence must downgrade offline overall status");
    assert(overdueClosedEvidence.status.releaseTrain === "needs_release_evidence", "overdue closed evidence must downgrade release train status");
    assert(overdueClosedEvidence.residuals.dueItems.some((item) => item.id === "AF-RISK-UX-001" && item.reviewStatus === "overdue"), "overdue evidence must remain visible in due items");
    writeText(root, "docs/development/residual-risk-ledger.json", fixtureLedgerJson());

    const initialProtectedPathHash = projection.sourceSnapshot.protectedPathFingerprint.hash;
    writeText(root, "docs/development/not-protected.txt", "fixture unprotected file\n");
    const unprotectedProjection = buildOperabilityStatusProjection({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(
      unprotectedProjection.sourceSnapshot.protectedPathFingerprint.hash === initialProtectedPathHash,
      "non-protected file changes should not affect protected path fingerprint",
    );

    writeText(root, "README.md", "fixture README changed\n");
    const protectedChangedProjection = buildOperabilityStatusProjection({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(
      protectedChangedProjection.sourceSnapshot.protectedPathFingerprint.hash !== initialProtectedPathHash,
      "protected file changes should affect protected path fingerprint",
    );

    rmSync(path.join(root, "docs/development/operational-readiness.md"));
    const blockedProjection = buildOperabilityStatusProjection({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(blockedProjection.status.controlPlane === "fail", "missing required file should fail control plane");
    assert(blockedProjection.status.overall === "blocked", "missing control plane file should block overall status");

    writeText(root, "docs/development/residual-risk-ledger.json", fixtureLedgerJson().replace('"schemaVersion": 2', '"schemaVersion": 1'));
    assertThrows(
      () => buildOperabilityStatusProjection({ root, asOf: "2026-07-11" }),
      "invalid residual ledger schema V2",
      "V1 ledger must fail closed",
    );
    writeText(root, "docs/development/residual-risk-ledger.json", fixtureLedgerJson().replace('"ownerSkills": [', '"ownerSkills": [null,'));
    assertThrows(
      () => buildOperabilityStatusProjection({ root, asOf: "2026-07-11" }),
      "invalid residual ledger schema V2",
      "invalid residual item must fail closed instead of being filtered",
    );
    rmSync(path.join(root, "docs/development/residual-risk-ledger.json"));
    assertThrows(
      () => buildOperabilityStatusProjection({ root, asOf: "2026-07-11" }),
      "ENOENT",
      "missing ledger must fail closed",
    );

    console.log("PASS operability status selftest");
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
  writeText(root, "tasks/active/0020-business-state-concurrency.md", [
    "```yaml",
    "residualRiskIds:",
    "  - AF-RISK-OPS-006",
    "```",
    "",
  ].join("\n"));
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
  const items: ResidualItemV2[] = [
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
        executableNow: true,
        closeCondition: "additive uniqueness and expected-status CAS pass concurrency validation",
        requiredEvidence: "migration, concurrency fixtures, doctor before/after, and signed release",
        ownerSkills: ["areaforge-security-governance", "areaforge-sre-ops"],
        taskRefs: ["tasks/active/0020-business-state-concurrency.md"],
      }),
      acceptedExceptionItem("AF-RISK-REL-001", "approved", "2026-08-10"),
      acceptedExceptionItem("AF-RISK-AI-001", "expired", "2026-07-10"),
    ];
  return JSON.stringify({
    schemaVersion: 2,
    source: "docs/development/residual-risk-ledger.md",
    items,
  }, null, 2);
}

function residualItem(overrides: Partial<ResidualItemV2> & Pick<ResidualItemV2, "id" | "type" | "reviewAt" | "currentImpact" | "closeCondition" | "requiredEvidence" | "ownerSkills">): ResidualItemV2 {
  return {
    executableNow: false,
    taskRefs: [],
    taskPromotionWaiver: null,
    acceptedException: null,
    ...overrides,
  };
}

function acceptedExceptionItem(id: string, status: AcceptedExceptionStatus, expiresAt: string): ResidualItemV2 {
  const item = residualItem({
    id,
    type: "accepted-exception",
    reviewAt: "2026-09-10",
    currentImpact: `${status} accepted exception fixture`,
    closeCondition: "maintainer reviews the exception",
    requiredEvidence: "accepted exception review record",
    ownerSkills: ["areaforge-release-operator"],
  });
  item.acceptedException = {
    status,
    scope: "fixture scope",
    reason: "fixture reason",
    acceptedBy: "fixture-maintainer",
    acceptedAt: "2026-07-01T00:00:00.000Z",
    expiresAt,
    reopenConditions: ["fixture source changes"],
    basisHash: "",
    sourceRef: "docs/development/residual-risk-ledger.md",
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    supersededBy: null,
  };
  item.acceptedException.basisHash = computeAcceptedExceptionBasisHash(item);
  return item;
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

function assertThrows(action: () => unknown, expected: string, message: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && (error.message.includes(expected) || String(error).includes(expected))) return;
    throw new Error(`${message}: unexpected error ${String(error)}`);
  }
  throw new Error(`${message}: expected an error`);
}

main();
