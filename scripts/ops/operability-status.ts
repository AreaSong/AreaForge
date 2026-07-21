import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  effectiveExceptionStatus,
  effectiveExecutableNow,
  isAcceptedExceptionEffective,
  readResidualLedgerV2,
  type EffectiveExceptionStatus,
  type ResidualItemV2,
  type ResidualLedgerV2,
  type ResidualType,
} from "../quality/residual-ledger-common";
import {
  evaluateProductExperienceEvidence,
  type ProductExperienceEvidenceEvaluation,
} from "../quality/product-experience-review-validate";

type ReviewStatus = "overdue" | "due_today" | "due_soon" | "future";
type OverallStatus = "ready" | "operable_with_residuals" | "needs_live_evidence" | "blocked";
type BoundaryStopKey =
  | "post_update_ops001"
  | "release_backup_hashes"
  | "update_request_expected_before"
  | "business_state_concurrency"
  | "residual_closure";

type ClassifiedResidual = Omit<ResidualItemV2, "executableNow"> & {
  executableNow: boolean;
  effectiveExceptionStatus: EffectiveExceptionStatus;
  acceptedExceptionEffective: boolean;
  daysUntilReview: number;
  reviewStatus: ReviewStatus;
};

type BoundaryStop = {
  key: BoundaryStopKey;
  evidence: string;
  currentBoundary: string[];
  allowedNow: string[];
  requiresFreshConfirmation: string[];
};

type ReleaseEvidenceGapStatus = "root_only" | "missing" | "invalid";
type ReleaseEvidenceGap = {
  key: "releaseEvidenceBundleHash" | "databaseBackupSha256" | "uploadsBackupSha256" | "envBackupSha256" |
    "attachmentReconciliationCsvPath" | "attachmentReconciliationCsvSha256" |
    "attachmentReconciliationSummaryPath" | "attachmentReconciliationSummaryHash" | "attachmentReconciliationStatus";
  gapType: "release_evidence_bundle_hash" | "release_evidence_backup_hash" | "attachment_reconciliation_binding";
  status: ReleaseEvidenceGapStatus;
  sourceRecord: string;
  sourceField: string;
  safeEvidence: string;
  requiredEvidence: string[];
  residualRiskIds: string[];
  blocks: Array<"release_evidence_validator" | "long_term_live_gate" | "maintenance_handoff">;
};

type ReleaseEvidenceGapSummary = {
  sourceRecordPath: string;
  sourceRecordHash: string | null;
  status: "ready" | "needs_evidence" | "blocked" | "missing_record";
  blockingGaps: ReleaseEvidenceGap[];
  doesNotProve: string[];
};

export type OperabilityStatusProjection = {
  schemaVersion: 2;
  generatedAt: string;
  mode: "offline_long_term_operability_status_projection";
  asOf: string;
  app: {
    name: string;
    version: string;
    onlineUrl: "https://forge.areasong.top/";
    releaseTag: string;
    autoApplyDefault: "none";
  };
  sourceBaseline: {
    borrowedMechanisms: string[];
    notBorrowed: string[];
  };
  sourceSnapshot: {
    controlPlaneSourceHash: string;
    files: string[];
    missingFiles: string[];
    protectedPathFingerprint: {
      algorithm: "sha256";
      scope: "read_only_side_effect_guard_inputs";
      paths: string[];
      hash: string;
      doesNotProve: string[];
    };
  };
  status: {
    overall: OverallStatus;
    controlPlane: "pass" | "fail";
    productionHealthClaim: "not_proven_by_offline_projection";
    releaseTrain: "ready_to_decide" | "needs_release_evidence" | "blocked";
  };
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    serverCommandAttempted: false;
    backupRestoreAttempted: false;
    migrationAttempted: false;
    productionWriteAttempted: false;
    protectedPathWriteAttempted: false;
    secretValuePrinted: false;
    statusProjectionWritten: false;
  };
  requiredFiles: {
    present: string[];
    missing: string[];
  };
  packageScripts: {
    present: string[];
    missing: string[];
  };
  residuals: {
    source: string;
    total: number;
    countsByType: Record<ResidualType, number>;
    countsByReviewStatus: Record<ReviewStatus, number>;
    currentBlockerIds: string[];
    dueItems: Array<Pick<ClassifiedResidual, "id" | "type" | "reviewAt" | "reviewStatus" | "daysUntilReview" | "executableNow" | "ownerSkills">>;
    executableNowItems: Array<Pick<ClassifiedResidual, "id" | "type" | "reviewAt" | "reviewStatus" | "currentImpact" | "closeCondition" | "requiredEvidence" | "ownerSkills">>;
    nonEffectiveAcceptedExceptionItems: Array<Pick<ClassifiedResidual, "id" | "reviewAt" | "reviewStatus" | "effectiveExceptionStatus" | "ownerSkills" | "closeCondition" | "requiredEvidence">>;
    releaseRelevantIds: string[];
  };
  uxReview: ProductExperienceEvidenceEvaluation;
  releaseEvidenceGaps: ReleaseEvidenceGapSummary;
  nextActions: Array<{
    residualRiskId: string;
    reason: string;
    requiredEvidence: string;
    ownerSkills: string[];
  }>;
  boundaryStops: BoundaryStop[];
  commands: {
    daily: string[];
    weekly: string[];
    release: string[];
    incident: string[];
  };
  claimDiscipline: {
    statusProjectionIsNotProductionHealth: true;
    requiresLiveEvidenceForProductionHealth: true;
    requiresExplicitConfirmationForProductionWrites: true;
  };
  doesNotProve: string[];
};

export type OperabilityStatusSummary = {
  title: "AreaForge operability status";
  app: string;
  offlineOverall: OverallStatus;
  controlPlane: OperabilityStatusProjection["status"]["controlPlane"];
  releaseTrain: OperabilityStatusProjection["status"]["releaseTrain"];
  productionHealthClaim: OperabilityStatusProjection["status"]["productionHealthClaim"];
  currentBlockers: string[];
  boundaryStops: string[];
  dueResiduals: string[];
  executableNowItems: string[];
  releaseRelevantResiduals: string[];
  releaseEvidenceGaps: string[];
  uxReview: string;
  nextEvidenceCommands: string[];
  cannotClaim: string[];
  safetyFacts: Pick<
    OperabilityStatusProjection["safetyFacts"],
    "readOnly" | "networkRequested" | "serverCommandAttempted" | "productionWriteAttempted" | "secretValuePrinted"
    | "protectedPathWriteAttempted"
  >;
};

type BuildOptions = {
  root?: string;
  asOf?: string;
  generatedAt?: string;
  uxReviewEvaluation?: ProductExperienceEvidenceEvaluation;
};

type ProjectionFacts = {
  asOf: string;
  packageJson: {
    name?: string;
    version?: string;
    scripts?: Record<string, string>;
  };
  ledger: ResidualLedgerV2;
  residuals: ClassifiedResidual[];
  presentFiles: string[];
  missingFiles: string[];
  presentScripts: string[];
  missingScripts: string[];
  releaseRelevantItems: ClassifiedResidual[];
  overall: OverallStatus;
  controlPlaneSourceHash: string;
  protectedPathFingerprint: OperabilityStatusProjection["sourceSnapshot"]["protectedPathFingerprint"];
  releaseEvidenceGaps: ReleaseEvidenceGapSummary;
  uxReview: ProductExperienceEvidenceEvaluation;
};

const residualTypes: ResidualType[] = [
  "current-blocker",
  "deferred-work",
  "accepted-exception",
  "monitoring-gap",
  "release-follow-up",
  "historical-reference",
  "template-marker",
  "closed-evidence",
];
const reviewStatuses: ReviewStatus[] = ["overdue", "due_today", "due_soon", "future"];
const ledgerPath = "docs/development/residual-risk-ledger.json";
const releaseEvidenceRecordPath = "docs/development/release-v0.1.7-record.md";
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
  releaseEvidenceRecordPath,
  "docs/development/support-bundle-preview.md",
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/validation-matrix.md",
  "workflow/README.md",
  "apps/web/lib/system/update-center.ts",
  "apps/web/app/api/system/update-requests/route.ts",
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
  "scripts/ops/ops004-alert-evidence-preflight.ts",
  "scripts/ops/ops005-evidence-preflight.ts",
  "scripts/quality/ops005-production-evidence-validate.ts",
  "apps/web/lib/system/update-request-v2.ts",
  "ops/update-agent/areaforge-update-agent.sh",
  "ops/update-agent/lib/update-request-v2.sh",
  "ops/update-agent/lib/update-request-state.sh",
  "ops/github-release-updater/areaforge-updater.sh",
  "scripts/quality/update-center-request-v2.selftest.ts",
  "scripts/quality/update-agent-request-v2.selftest.ts",
  "scripts/quality/update-production-state-lock.selftest.ts",
  "scripts/ops/sc002-supply-chain-preflight.ts",
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
];
const requiredPackageScripts = [
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
  "ops:ops-005:evidence:validate",
  "ops:ops-005:evidence:selftest",
  "ops:ops-005:local:selftest",
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
const controlPlaneSourceFiles = ["package.json", ...requiredFiles];
export const protectedPathFiles = [
  "README.md",
  "package.json",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/governance-register.json",
  "docs/development/governance-register.md",
  "docs/development/operations-lifecycle.md",
  "docs/development/operations-lifecycle.json",
  "docs/development/post-release-observation-template.json",
  "docs/development/post-release-observation-v0.1.7.json",
  "docs/development/operational-readiness.md",
  "docs/development/maintenance-window-index.json",
  "docs/development/incident-index.json",
  "docs/development/rollback-proof-record-template.md",
  "docs/development/update-request-expected-before-design.md",
  "docs/development/ops-005-expected-before-production-evidence-template.md",
  "docs/development/high-risk-confirmation-packets.md",
  releaseEvidenceRecordPath,
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/validation-matrix.md",
  "docs/deployment/backup-restore.md",
  "docs/development/production-release-runbook.md",
  "docs/development/release-record-template.md",
  "docs/architecture/file-storage.md",
  "docs/security/file-ai-safety.md",
  "scripts/quality/attachment-reconciliation.ts",
  "scripts/quality/attachment-reconciliation-summary.ts",
  "scripts/quality/attachment-reconciliation-summary.selftest.ts",
  "scripts/quality/release-evidence-validate.ts",
  "scripts/quality/release-evidence-validate.selftest.ts",
  "scripts/ops/post-release-observation-status.ts",
  "scripts/quality/post-release-observation-validate.ts",
  "scripts/quality/product-experience-review-discovery.ts",
  "scripts/quality/product-experience-review-validate.ts",
  "tasks/indexes/residuals.md",
  "tasks/active/0019-update-request-expected-before-binding.md",
  "tasks/active/0020-business-state-concurrency.md",
  "scripts/ops/data-integrity-doctor.ts",
  "scripts/quality/data-integrity-doctor-validate.ts",
  "scripts/quality/data-integrity-doctor.selftest.ts",
  "workflow/README.md",
] as const;

export function buildOperabilityStatusProjection(options: BuildOptions = {}): OperabilityStatusProjection {
  const facts = collectProjectionFacts(options);

  return {
    schemaVersion: 2,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: "offline_long_term_operability_status_projection",
    asOf: facts.asOf,
    app: buildAppStatus(facts.packageJson),
    sourceBaseline: buildSourceBaseline(),
    sourceSnapshot: {
      controlPlaneSourceHash: facts.controlPlaneSourceHash,
      files: controlPlaneSourceFiles,
      missingFiles: facts.missingFiles,
      protectedPathFingerprint: facts.protectedPathFingerprint,
    },
    status: buildStatus(facts),
    safetyFacts: buildSafetyFacts(),
    requiredFiles: {
      present: facts.presentFiles,
      missing: facts.missingFiles,
    },
    packageScripts: {
      present: facts.presentScripts,
      missing: facts.missingScripts,
    },
    residuals: buildResidualSummary(facts),
    uxReview: facts.uxReview,
    releaseEvidenceGaps: facts.releaseEvidenceGaps,
    nextActions: nextActions(facts.residuals, facts.uxReview),
    boundaryStops: buildBoundaryStops(),
    commands: buildCommandMatrix(),
    claimDiscipline: buildClaimDiscipline(),
    doesNotProve: buildDoesNotProve(),
  };
}

export function buildOperabilityStatusSummary(projection: OperabilityStatusProjection): OperabilityStatusSummary {
  return {
    title: "AreaForge operability status",
    app: `${projection.app.name} ${projection.app.version} (${projection.app.releaseTag})`,
    offlineOverall: projection.status.overall,
    controlPlane: projection.status.controlPlane,
    releaseTrain: projection.status.releaseTrain,
    productionHealthClaim: projection.status.productionHealthClaim,
    currentBlockers: currentBlockerSummary(projection),
    boundaryStops: projection.boundaryStops.map(toBoundaryStopSummary),
    dueResiduals: projection.residuals.dueItems
      .map((item) => `${item.id} ${item.reviewStatus} reviewAt=${item.reviewAt} owners=${item.ownerSkills.join(",")}`),
    executableNowItems: projection.residuals.executableNowItems
      .map((item) => `${item.id} ${item.type} reviewAt=${item.reviewAt} owners=${item.ownerSkills.join(",")}`),
    releaseRelevantResiduals: projection.residuals.releaseRelevantIds,
    releaseEvidenceGaps: projection.releaseEvidenceGaps.blockingGaps
      .map((gap) => `${gap.key} ${gap.status} ${gap.gapType} blocks=${gap.blocks.join(",")}`),
    uxReview: `${projection.uxReview.status}: ${projection.uxReview.detail}`,
    nextEvidenceCommands: uniqueStrings([
      ...projection.commands.daily.slice(0, 4),
      "pnpm ops:ops-006:preflight:strict",
      "pnpm ops:ops-006:preflight:selftest",
      "pnpm ops:ops-006:evidence:selftest",
      "pnpm ops:ops-006:production:preflight:selftest",
      "pnpm ops:ops-007:preflight:strict",
      "pnpm ops:ops-007:preflight:selftest",
      "pnpm ops:ops-008:preflight:strict",
      "pnpm ops:ops-008:preflight:selftest",
      "pnpm sc:sc-004:preflight",
      "pnpm sc:sc-004:preflight:selftest",
      "pnpm sc:sc-004:validate <readback.json> <controlled-pr.json>",
      "pnpm attachment:crash-window:selftest",
      "pnpm updater:phase-journal:selftest",
      "pnpm ops:ops-001:preflight",
      "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
      "pnpm release:closeout:audit -- --version <X.Y.Z>",
      "pnpm release:closeout:audit:validate <release-closeout-audit.json>",
      "pnpm release:post-observation:validate <post-release-observation.json>",
      "pnpm release:post-observation:status <post-release-observation.json>",
      ...projection.commands.release.slice(0, 4),
    ].map(toSummaryCommand)),
    cannotClaim: projection.doesNotProve,
    safetyFacts: {
      readOnly: projection.safetyFacts.readOnly,
      networkRequested: projection.safetyFacts.networkRequested,
      serverCommandAttempted: projection.safetyFacts.serverCommandAttempted,
      productionWriteAttempted: projection.safetyFacts.productionWriteAttempted,
      protectedPathWriteAttempted: projection.safetyFacts.protectedPathWriteAttempted,
      secretValuePrinted: projection.safetyFacts.secretValuePrinted,
    },
  };
}

function currentBlockerSummary(projection: OperabilityStatusProjection): string[] {
  const ids = new Set(projection.residuals.currentBlockerIds);
  return projection.nextActions
    .filter((item) => ids.has(item.residualRiskId))
    .map((item) => `${item.residualRiskId} owners=${item.ownerSkills.join(",")}`);
}

export function formatOperabilityStatusSummary(summary: OperabilityStatusSummary): string {
  return [
    summary.title,
    `app: ${summary.app}`,
    `offlineOverall: ${summary.offlineOverall}`,
    `controlPlane: ${summary.controlPlane}`,
    `releaseTrain: ${summary.releaseTrain}`,
    `productionHealthClaim: ${summary.productionHealthClaim}`,
    listBlock("currentBlockers", summary.currentBlockers),
    listBlock("boundaryStops", summary.boundaryStops),
    listBlock("dueResiduals", summary.dueResiduals),
    listBlock("executableNowItems", summary.executableNowItems),
    listBlock("releaseRelevantResiduals", summary.releaseRelevantResiduals),
    listBlock("releaseEvidenceGaps", summary.releaseEvidenceGaps),
    `uxReview: ${summary.uxReview}`,
    listBlock("nextEvidenceCommands", summary.nextEvidenceCommands),
    listBlock("cannotClaim", summary.cannotClaim),
    `safetyFacts: readOnly=${summary.safetyFacts.readOnly} networkRequested=${summary.safetyFacts.networkRequested} serverCommandAttempted=${summary.safetyFacts.serverCommandAttempted} productionWriteAttempted=${summary.safetyFacts.productionWriteAttempted} protectedPathWriteAttempted=${summary.safetyFacts.protectedPathWriteAttempted} secretValuePrinted=${summary.safetyFacts.secretValuePrinted}`,
  ].join("\n");
}

function collectProjectionFacts(options: BuildOptions): ProjectionFacts {
  const root = options.root ?? process.cwd();
  const asOf = options.asOf ?? todayUtcDate();
  const now = projectionDate(asOf);
  const packageJson = readJson<ProjectionFacts["packageJson"]>(root, "package.json");
  const ledger = readResidualLedgerV2({ root, file: ledgerPath, now });
  const residuals = ledger.items.map((item) => classifyResidual(item, asOf, root, now));
  const missingFiles = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
  const missingScripts = requiredPackageScripts.filter((script) => !(packageJson.scripts ?? {})[script]);
  const releaseRelevantItems = residuals.filter(isReleaseRelevant);
  const controlPlaneSourceHash = hashControlPlaneSources(root);
  const protectedPathFingerprint = buildProtectedPathFingerprint(root);
  const releaseEvidenceGaps = buildReleaseEvidenceGaps(root);
  const evidenceNow = options.generatedAt
    ? new Date(options.generatedAt)
    : options.asOf
      ? new Date(`${asOf}T23:59:59.999Z`)
      : new Date();
  const uxReview = options.uxReviewEvaluation ?? evaluateProductExperienceEvidence({ root, now: evidenceNow });
  const overall = overallStatus({
    hasMissingControlPlane: missingFiles.length > 0 || missingScripts.length > 0,
    residuals,
    uxReview,
  });

  return {
    asOf,
    packageJson,
    ledger,
    residuals,
    presentFiles: requiredFiles.filter((file) => !missingFiles.includes(file)),
    missingFiles,
    presentScripts: requiredPackageScripts.filter((script) => !missingScripts.includes(script)),
    missingScripts,
    releaseRelevantItems,
    overall,
    controlPlaneSourceHash,
    protectedPathFingerprint,
    releaseEvidenceGaps,
    uxReview,
  };
}

function buildAppStatus(packageJson: ProjectionFacts["packageJson"]): OperabilityStatusProjection["app"] {
  return {
    name: packageJson.name ?? "@areasong/areaforge",
    version: packageJson.version ?? "unknown",
    onlineUrl: "https://forge.areasong.top/",
    releaseTag: versionTag(packageJson.version ?? "unknown"),
    autoApplyDefault: "none",
  };
}

function listBlock(label: string, values: string[]): string {
  if (values.length === 0) return `${label}: none`;
  return [`${label}:`, ...values.map((value) => `- ${value}`)].join("\n");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function toBoundaryStopSummary(stop: BoundaryStop): string {
  return `${stop.key}: ${stop.evidence}; blockedBy=${stop.currentBoundary.join(",")}`;
}

function toSummaryCommand(command: string): string {
  if (command === "pnpm ops:handoff") return "pnpm ops:handoff --summary";
  if (command === "pnpm ops:status") return "pnpm ops:status --summary";
  return command;
}

function buildSourceBaseline(): OperabilityStatusProjection["sourceBaseline"] {
  return {
    borrowedMechanisms: [
      "AreaFlow-style offline status projection",
      "AreaMatrix-style residual index with stable close conditions",
      "status-word discipline: readiness, health, smoke, record, and apply stay separate",
    ],
    notBorrowed: [
      "task-loop runner",
      "version execution queue",
      "managed-project shim",
      "cross-project status apply",
    ],
  };
}

function buildStatus(facts: ProjectionFacts): OperabilityStatusProjection["status"] {
  return {
    overall: facts.overall,
    controlPlane: facts.missingFiles.length === 0 && facts.missingScripts.length === 0 ? "pass" : "fail",
    productionHealthClaim: "not_proven_by_offline_projection",
    releaseTrain: releaseTrainStatus(facts.overall, facts.releaseRelevantItems),
  };
}

function buildSafetyFacts(): OperabilityStatusProjection["safetyFacts"] {
  return {
    readOnly: true,
    networkRequested: false,
    serverCommandAttempted: false,
    backupRestoreAttempted: false,
    migrationAttempted: false,
    productionWriteAttempted: false,
    protectedPathWriteAttempted: false,
    secretValuePrinted: false,
    statusProjectionWritten: false,
  };
}

function buildResidualSummary(facts: ProjectionFacts): OperabilityStatusProjection["residuals"] {
  const dueItems = facts.residuals.filter((item) => item.reviewStatus !== "future");
  const executableNowItems = facts.residuals.filter((item) => item.executableNow);
  const nonEffectiveAcceptedExceptionItems = facts.residuals.filter(isNonEffectiveAcceptedException);
  return {
    source: facts.ledger.source,
    total: facts.residuals.length,
    countsByType: countBy(facts.residuals, residualTypes, (item) => item.type),
    countsByReviewStatus: countBy(facts.residuals, reviewStatuses, (item) => item.reviewStatus),
    currentBlockerIds: facts.residuals.filter((item) => item.type === "current-blocker").map((item) => item.id),
    dueItems: dueItems.map(toDueItem),
    executableNowItems: executableNowItems.map(toExecutableNowItem),
    nonEffectiveAcceptedExceptionItems: nonEffectiveAcceptedExceptionItems.map(toNonEffectiveAcceptedExceptionItem),
    releaseRelevantIds: facts.releaseRelevantItems.map((item) => item.id),
  };
}

function buildCommandMatrix(): OperabilityStatusProjection["commands"] {
  return {
    daily: [
      "pnpm ops:handoff",
      "pnpm ops:handoff:validate <operational-handoff.json>",
      "pnpm ops:status",
      "pnpm ops:status:validate <operability-status.json>",
      "pnpm ops:support:bundle-preview",
      "pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>",
      "pnpm ops:backup-restore:preview",
      "pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>",
      "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
      "pnpm ops:ops-001:preflight",
      "AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=<manifest> pnpm ops:ops-001:fallback:finalize <redacted-fallback-dir> <output-dir>",
      "pnpm ops:long-term:snapshot",
      "pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json>",
      "pnpm ops:readiness:summary",
      "pnpm ops:evidence:bundle",
      "pnpm ops:alert:preview",
      "pnpm ops:ops-004:preflight",
      "pnpm ops:ops-005:local:selftest",
      "pnpm ops:ops-005:preflight",
      "pnpm ops:ops-005:evidence:validate <ops-005-production-evidence-record> <release-record> <release-assets-dir>",
      "pnpm sc:sc-004:validate <readback.json> <controlled-pr.json>",
      "AREAFORGE_SC004_READBACK_RECORD=<readback.json> AREAFORGE_SC004_CONTROLLED_PR_RECORD=<controlled-pr.json> pnpm sc:sc-004:preflight",
      "pnpm maintenance:window:record",
      "pnpm maintenance:window:validate <maintenance-window-record.md|txt>",
      "pnpm maintenance:window:index",
      "pnpm maintenance:window:index:validate docs/development/maintenance-window-index.json",
      "pnpm incident:index",
      "pnpm incident:index:validate docs/development/incident-index.json",
      "pnpm residuals:evidence:preflight",
      "pnpm residuals:closure:validate <residual-closure-review-record>",
    ],
    weekly: [
      "pnpm ops:handoff",
      "pnpm ops:status",
      "pnpm ops:handoff:validate:selftest",
      "pnpm ops:status:validate:selftest",
      "pnpm ops:readonly-side-effect:selftest",
      "pnpm ops:data-integrity:selftest",
      "pnpm enterprise:operability:preflight",
      "pnpm maintenance:cadence:preflight",
      "pnpm ops:support:bundle-preview:selftest",
      "pnpm ops:backup-restore:preview:selftest",
      "pnpm release:evidence:redacted-export:selftest",
      "pnpm release:closeout:audit:selftest",
      "pnpm ops:ops-001:preflight:selftest",
      "pnpm ops:ops-001:fallback:finalize:selftest",
      "pnpm ops:ops-004:preflight:selftest",
      "pnpm ops:ops-005:local:selftest",
      "pnpm ops:ops-005:preflight:selftest",
      "pnpm ops:ops-005:evidence:selftest",
      "pnpm sc:sc-002:preflight:selftest",
      "pnpm sc:sc-004:validate:selftest",
      "pnpm sc:sc-004:preflight:selftest",
      "pnpm ops:long-term:snapshot:selftest",
      "pnpm maintenance:window:record:selftest",
      "pnpm maintenance:window:selftest",
      "pnpm maintenance:window:index:selftest",
      "pnpm incident:index:selftest",
      "pnpm residuals:validate",
      "pnpm residuals:evidence:preflight:selftest",
      "pnpm residuals:closure:selftest",
      "pnpm residuals:review-due",
      "pnpm residuals:review-due:selftest",
      "pnpm residuals:promotion-preview",
      "pnpm residuals:promotion-preview:selftest",
      "pnpm docs:readiness",
    ],
    release: [
      "pnpm ops:handoff",
      "pnpm ops:status",
      "pnpm ops:long-term:gate",
      "pnpm ops:long-term:snapshot",
      "DATABASE_URL=<read-only-url> pnpm ops:data-integrity:doctor -- --attachment-summary <attachment-reconciliation-summary.json>",
      "pnpm ops:data-integrity:validate <data-integrity-doctor.json>",
      "pnpm release:train:preflight",
      "pnpm github-release-updater:preflight",
      "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
      "pnpm release:closeout:audit -- --version <X.Y.Z>",
      "pnpm release:closeout:audit:validate <release-closeout-audit.json>",
      "pnpm release:evidence:redacted-export:selftest",
      "pnpm release:supply-chain:selftest",
      "pnpm sc:sc-002:preflight",
      "pnpm sc:sc-004:validate <readback.json> <controlled-pr.json>",
      "AREAFORGE_SC004_READBACK_RECORD=<readback.json> AREAFORGE_SC004_CONTROLLED_PR_RECORD=<controlled-pr.json> pnpm sc:sc-004:preflight",
      "pnpm ops:ops-005:local:selftest",
      "pnpm ops:ops-005:preflight",
      "pnpm ops:ops-005:evidence:validate <ops-005-production-evidence-record> <release-record> <release-assets-dir>",
      "pnpm ops:evidence:bundle",
      "pnpm experience:review:validate <record>",
    ],
    incident: [
      "pnpm ops:evidence:bundle",
      "pnpm ops:alert:preview",
      "pnpm incident:record:validate <record>",
      "pnpm incident:index",
      "pnpm incident:index:validate docs/development/incident-index.json",
      "pnpm rollback:proof:validate <record>",
    ],
  };
}

function buildClaimDiscipline(): OperabilityStatusProjection["claimDiscipline"] {
  return {
    statusProjectionIsNotProductionHealth: true,
    requiresLiveEvidenceForProductionHealth: true,
    requiresExplicitConfirmationForProductionWrites: true,
  };
}

function buildBoundaryStops(): BoundaryStop[] {
  return [
    {
      key: "post_update_ops001",
      evidence: "post-v0.1.7 production readonly smoke, redacted update-agent status, operational evidence bundle, and OPS-001 closure packet",
      currentBoundary: [
        "no server command",
        "no secret read/print/copy/commit",
        "no residual ledger closure",
      ],
      allowedNow: [
        "pnpm ops:ops-001:preflight",
        "pnpm residuals:evidence:preflight",
        "local status, handoff, docs, and validator checks",
      ],
      requiresFreshConfirmation: [
        "server-side redacted or fallback evidence collection scope",
        "explicit permission for any smoke credential file read if authenticated smoke is required",
        "maintainer review before any residual ledger closure",
      ],
    },
    {
      key: "release_backup_hashes",
      evidence: "releaseEvidenceBundleHash, backup SHA256 fields, and attachment reconciliation path/status/hash bindings for docs/development/release-v0.1.7-record.md",
      currentBoundary: [
        "no server command",
        "no root-only update-record or backup metadata read",
        "no backup/env/secrets copying",
      ],
      allowedNow: [
        "pnpm ops:backup-restore:preview",
        "pnpm release:evidence:validate docs/development/release-v0.1.7-record.md",
        "pnpm release:evidence:redacted-export:selftest",
      ],
      requiresFreshConfirmation: [
        "server-side no-secret redacted release evidence export",
        "local validation with pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
      ],
    },
    {
      key: "update_request_expected_before",
      evidence: "AF-RISK-OPS-005 expected-before V2 local implementation is verified; signed Release and production deployment evidence remain",
      currentBoundary: [
        "no matching signed Release for the verified V2 checkout",
        "no production deployment confirmation",
        "no mutation request execution",
        "no AF-RISK-OPS-005 residual closure",
      ],
      allowedNow: [
        "pnpm ops:ops-005:local:selftest",
        "pnpm ops:ops-005:preflight",
        "local signed Release readiness validation",
      ],
      requiresFreshConfirmation: [
        "separate signed Release confirmation after local validation",
        "separate production timer, queue isolation, Web/agent deployment, and V2 check confirmation",
      ],
    },
    {
      key: "business_state_concurrency",
      evidence: "AF-RISK-OPS-006 local_verified is complete; matching signed Release, base rollout, controlled synthetic probe, and production evidence remain",
      currentBoundary: [
        "no matching signed Release for the verified OPS-006 checkout",
        "no production migration/deploy confirmation",
        "no controlled production write probe confirmation",
        "no AF-RISK-OPS-006 residual closure",
      ],
      allowedNow: [
        "pnpm ops:ops-006:preflight:strict",
        "pnpm ops:ops-006:evidence:selftest",
        "pnpm ops:ops-006:production:preflight:selftest",
      ],
      requiresFreshConfirmation: [
        "matching signed Release after local validation",
        "separate base rollout with backup, migration, health, smoke, and doctor evidence",
        "separate controlled synthetic concurrency write probe",
        "maintainer review before residual ledger closure",
      ],
    },
    {
      key: "residual_closure",
      evidence: "AF-RISK-OPS-001 / AF-RISK-OPS-004 / AF-RISK-OPS-005 / AF-RISK-OPS-006 / supply-chain residual closure decisions",
      currentBoundary: [
        "no residual ledger closure",
        "no completion claim without live evidence gate",
      ],
      allowedNow: [
        "pnpm residuals:review-due",
        "pnpm residuals:evidence:preflight",
        "pnpm ops:long-term:gate",
      ],
      requiresFreshConfirmation: [
        "maintainer review after all close-condition validators pass",
      ],
    },
  ];
}

function buildReleaseEvidenceGaps(root: string): ReleaseEvidenceGapSummary {
  const fullPath = resolve(root, releaseEvidenceRecordPath);
  if (!existsSync(fullPath)) {
    return {
      sourceRecordPath: releaseEvidenceRecordPath,
      sourceRecordHash: null,
      status: "missing_record",
      blockingGaps: releaseEvidenceFields().map((field) =>
        toReleaseEvidenceGap(field, "missing", "release evidence record is missing")
      ),
      doesNotProve: releaseEvidenceGapNonProofs(),
    };
  }

  const raw = readFileSync(fullPath, "utf8");
  const fields = parseFlatKeyValueRecord(raw);
  const blockingGaps = releaseEvidenceFields()
    .map((field) => {
      const value = fields.get(field.key) ?? "";
      const status = classifyReleaseEvidenceField(field.key, value);
      return status === "present" ? null : toReleaseEvidenceGap(field, status, releaseEvidenceText(field.key, status));
    })
    .filter((gap): gap is ReleaseEvidenceGap => gap !== null);

  return {
    sourceRecordPath: releaseEvidenceRecordPath,
    sourceRecordHash: `sha256:${sha256(raw)}`,
    status: blockingGaps.length === 0
      ? "ready"
      : blockingGaps.some((gap) => gap.status === "invalid") ? "blocked" : "needs_evidence",
    blockingGaps,
    doesNotProve: releaseEvidenceGapNonProofs(),
  };
}

function releaseEvidenceFields(): Array<Pick<ReleaseEvidenceGap, "key" | "gapType" | "requiredEvidence">> {
  return [
    {
      key: "releaseEvidenceBundleHash",
      gapType: "release_evidence_bundle_hash",
      requiredEvidence: ["releaseEvidenceBundleHash as sha256:<64 hex> or 64 hex in the redacted release evidence record"],
    },
    {
      key: "databaseBackupSha256",
      gapType: "release_evidence_backup_hash",
      requiredEvidence: ["databaseBackupSha256 as 64 hex in the redacted release evidence record"],
    },
    {
      key: "uploadsBackupSha256",
      gapType: "release_evidence_backup_hash",
      requiredEvidence: ["uploadsBackupSha256 as 64 hex in the redacted release evidence record"],
    },
    {
      key: "envBackupSha256",
      gapType: "release_evidence_backup_hash",
      requiredEvidence: ["envBackupSha256 as 64 hex in the redacted release evidence record"],
    },
    {
      key: "attachmentReconciliationCsvPath",
      gapType: "attachment_reconciliation_binding",
      requiredEvidence: ["attachmentReconciliationCsvPath pointing to the redacted reconciliation CSV evidence"],
    },
    {
      key: "attachmentReconciliationCsvSha256",
      gapType: "attachment_reconciliation_binding",
      requiredEvidence: ["attachmentReconciliationCsvSha256 as sha256:<64 hex>"],
    },
    {
      key: "attachmentReconciliationSummaryPath",
      gapType: "attachment_reconciliation_binding",
      requiredEvidence: ["attachmentReconciliationSummaryPath pointing to the redacted reconciliation summary"],
    },
    {
      key: "attachmentReconciliationSummaryHash",
      gapType: "attachment_reconciliation_binding",
      requiredEvidence: ["attachmentReconciliationSummaryHash as sha256:<64 hex>"],
    },
    {
      key: "attachmentReconciliationStatus",
      gapType: "attachment_reconciliation_binding",
      requiredEvidence: ["attachmentReconciliationStatus as pass or mismatch"],
    },
  ];
}

function toReleaseEvidenceGap(
  field: Pick<ReleaseEvidenceGap, "key" | "gapType" | "requiredEvidence">,
  status: ReleaseEvidenceGapStatus,
  safeEvidence: string,
): ReleaseEvidenceGap {
  return {
    key: field.key,
    gapType: field.gapType,
    status,
    sourceRecord: releaseEvidenceRecordPath,
    sourceField: field.key,
    safeEvidence,
    requiredEvidence: field.requiredEvidence,
    residualRiskIds: ["AF-RISK-OPS-001"],
    blocks: [
      "release_evidence_validator",
      "long_term_live_gate",
      "maintenance_handoff",
    ],
  };
}

function classifyReleaseEvidenceField(key: ReleaseEvidenceGap["key"], value: string): "present" | ReleaseEvidenceGapStatus {
  if (!value) return "missing";
  if (key === "attachmentReconciliationStatus") return ["pass", "mismatch"].includes(value) ? "present" : "invalid";
  if (key === "attachmentReconciliationCsvPath" || key === "attachmentReconciliationSummaryPath") {
    return /root-only|not-copied|pending-redacted/i.test(value) ? "root_only" : "present";
  }
  const pattern = key === "releaseEvidenceBundleHash" || key === "attachmentReconciliationCsvSha256" || key === "attachmentReconciliationSummaryHash"
    ? /^(sha256:)?[a-f0-9]{64}$/i
    : /^[a-f0-9]{64}$/i;
  if (pattern.test(value)) return "present";
  if (/root-only|not-copied|pending-redacted/i.test(value)) return "root_only";
  return "invalid";
}

function releaseEvidenceText(key: ReleaseEvidenceGap["key"], status: ReleaseEvidenceGapStatus): string {
  if (status === "root_only") return `${key} is recorded as root-only or pending redacted export`;
  if (status === "missing") return `${key} is missing from the release evidence record`;
  return `${key} is present but not valid release evidence metadata`;
}

function releaseEvidenceGapNonProofs(): string[] {
  return [
    "backup archive exists",
    "release evidence bundle exists",
    "database dump or upload archive was read",
    "production restore execution",
    "release evidence validator passes",
    "long-term live gate passes",
    "residual risk closure",
  ];
}

function parseFlatKeyValueRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of record.split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    fields.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return fields;
}

function buildDoesNotProve(): string[] {
  return [
    "current production health",
    "production readiness without live evidence",
    "updater apply completion",
    "GitHub Release creation",
    "backup, restore, migration, or rollback execution",
    "residual risk closure",
    "auto-apply enablement",
    "permission to read, print, copy, or commit secrets",
  ];
}

function isReleaseRelevant(item: ClassifiedResidual): boolean {
  return item.type === "current-blocker" ||
    item.type === "monitoring-gap" ||
    item.type === "release-follow-up" ||
    item.id.startsWith("AF-RISK-REL-") ||
    item.id.startsWith("AF-RISK-SC-");
}

function toDueItem(
  item: ClassifiedResidual,
): OperabilityStatusProjection["residuals"]["dueItems"][number] {
  return {
    id: item.id,
    type: item.type,
    reviewAt: item.reviewAt,
    reviewStatus: item.reviewStatus,
    daysUntilReview: item.daysUntilReview,
    executableNow: item.executableNow,
    ownerSkills: item.ownerSkills,
  };
}

function toExecutableNowItem(
  item: ClassifiedResidual,
): OperabilityStatusProjection["residuals"]["executableNowItems"][number] {
  return {
    id: item.id,
    type: item.type,
    reviewAt: item.reviewAt,
    reviewStatus: item.reviewStatus,
    currentImpact: item.currentImpact,
    closeCondition: item.closeCondition,
    requiredEvidence: item.requiredEvidence,
    ownerSkills: item.ownerSkills,
  };
}

function toNonEffectiveAcceptedExceptionItem(
  item: ClassifiedResidual,
): OperabilityStatusProjection["residuals"]["nonEffectiveAcceptedExceptionItems"][number] {
  return {
    id: item.id,
    reviewAt: item.reviewAt,
    reviewStatus: item.reviewStatus,
    effectiveExceptionStatus: item.effectiveExceptionStatus,
    ownerSkills: item.ownerSkills,
    closeCondition: item.closeCondition,
    requiredEvidence: item.requiredEvidence,
  };
}

function classifyResidual(item: ResidualItemV2, asOf: string, root: string, now: Date): ClassifiedResidual {
  const reviewDate = parseDate(item.reviewAt);
  const asOfDate = parseDate(asOf);
  const daysUntilReview = Math.round((reviewDate.getTime() - asOfDate.getTime()) / 86_400_000);
  return {
    ...item,
    executableNow: effectiveExecutableNow(item, { root, now }),
    effectiveExceptionStatus: effectiveExceptionStatus(item, now),
    acceptedExceptionEffective: isAcceptedExceptionEffective(item, now),
    daysUntilReview,
    reviewStatus: reviewStatus(daysUntilReview),
  };
}

function reviewStatus(daysUntilReview: number): ReviewStatus {
  if (daysUntilReview < 0) return "overdue";
  if (daysUntilReview === 0) return "due_today";
  if (daysUntilReview <= 14) return "due_soon";
  return "future";
}

function overallStatus(input: {
  hasMissingControlPlane: boolean;
  residuals: ClassifiedResidual[];
  uxReview: ProductExperienceEvidenceEvaluation;
}): OverallStatus {
  if (input.hasMissingControlPlane) return "blocked";
  if (input.residuals.some((item) => item.type === "current-blocker")) return "blocked";
  if (input.uxReview.status === "invalid") return "blocked";
  if (input.uxReview.status === "missing" || input.uxReview.status === "stale") return "needs_live_evidence";
  if (input.residuals.some(isNonEffectiveAcceptedException)) return "needs_live_evidence";
  if (input.residuals.some((item) => item.reviewStatus === "overdue" || item.reviewStatus === "due_today")) {
    return "needs_live_evidence";
  }
  if (input.residuals.some((item) => item.type === "monitoring-gap" || item.type === "release-follow-up")) {
    return "needs_live_evidence";
  }
  if (input.residuals.some((item) => item.type !== "closed-evidence" && item.type !== "historical-reference")) {
    return "operable_with_residuals";
  }
  return "ready";
}

function releaseTrainStatus(overall: OverallStatus, items: ClassifiedResidual[]): OperabilityStatusProjection["status"]["releaseTrain"] {
  if (overall === "blocked") return "blocked";
  if (overall === "needs_live_evidence") return "needs_release_evidence";
  if (items.some((item) => item.type !== "closed-evidence" && item.type !== "historical-reference")) {
    return "needs_release_evidence";
  }
  return "ready_to_decide";
}

function nextActions(
  residuals: ClassifiedResidual[],
  uxReview: ProductExperienceEvidenceEvaluation,
): OperabilityStatusProjection["nextActions"] {
  return residuals
    .filter((item) =>
      item.type === "current-blocker" || item.executableNow || item.reviewStatus !== "future" ||
      isNonEffectiveAcceptedException(item) || (item.id === "AF-RISK-UX-001" && uxReview.status !== "fresh")
    )
    .map((item) => ({
      residualRiskId: item.id,
      reason: nextActionReason(item, uxReview),
      requiredEvidence: item.requiredEvidence,
      ownerSkills: item.ownerSkills,
    }));
}

function nextActionReason(item: ClassifiedResidual, uxReview: ProductExperienceEvidenceEvaluation): string {
  if (item.id === "AF-RISK-UX-001") {
    return `ux_review_${uxReview.status}: ${uxReview.detail}`;
  }
  if (isNonEffectiveAcceptedException(item)) {
    return `accepted_exception_${item.effectiveExceptionStatus ?? "invalid"}: ${item.currentImpact}`;
  }
  return item.reviewStatus === "future" ? item.currentImpact : `${item.reviewStatus}: ${item.currentImpact}`;
}

function isNonEffectiveAcceptedException(item: ClassifiedResidual): boolean {
  return item.type === "accepted-exception" && !item.acceptedExceptionEffective;
}

function countBy<T, K extends string>(items: T[], keys: K[], getKey: (item: T) => K): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const item of items) {
    counts[getKey(item)] += 1;
  }
  return counts;
}

function readJson<T>(root: string, file: string): T {
  return JSON.parse(readFileSync(resolve(root, file), "utf8")) as T;
}

function hashControlPlaneSources(root: string): string {
  return hashPathSet(root, controlPlaneSourceFiles);
}

function buildProtectedPathFingerprint(root: string): OperabilityStatusProjection["sourceSnapshot"]["protectedPathFingerprint"] {
  return {
    algorithm: "sha256",
    scope: "read_only_side_effect_guard_inputs",
    paths: [...protectedPathFiles],
    hash: hashPathSet(root, [...protectedPathFiles]),
    doesNotProve: [
      "production health",
      "absence of changes outside protected paths",
      "git worktree cleanliness",
    ],
  };
}

function hashPathSet(root: string, files: string[]): string {
  const entries = files.map((file) => {
    const fullPath = resolve(root, file);
    if (!existsSync(fullPath)) {
      return { file, status: "missing" };
    }
    return {
      file,
      status: "present",
      sha256: createHash("sha256").update(readFileSync(fullPath)).digest("hex"),
    };
  });
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolve(root: string, file: string): string {
  return path.join(root, file);
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date ${value}; expected YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date ${value}; expected a real calendar date`);
  }
  return date;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function projectionDate(asOf: string): Date {
  return new Date(`${asOf}T12:00:00.000Z`);
}

function versionTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function shouldFail(status: OverallStatus, failOn: string | undefined): boolean {
  if (!failOn) return false;
  const order: OverallStatus[] = ["ready", "operable_with_residuals", "needs_live_evidence", "blocked"];
  const threshold = order.includes(failOn as OverallStatus) ? failOn as OverallStatus : "blocked";
  return order.indexOf(status) >= order.indexOf(threshold);
}

function isMain(): boolean {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMain()) {
  try {
    const projection = buildOperabilityStatusProjection({
      asOf: process.env.AREAFORGE_OPERABILITY_STATUS_AS_OF,
    });
    if (process.argv.includes("--summary")) {
      console.log(formatOperabilityStatusSummary(buildOperabilityStatusSummary(projection)));
    } else {
      console.log(JSON.stringify(projection, null, 2));
    }
    if (shouldFail(projection.status.overall, process.env.AREAFORGE_OPERABILITY_STATUS_FAIL_ON)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`FAIL operability status: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}
