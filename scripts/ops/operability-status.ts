import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ResidualType =
  | "current-blocker"
  | "deferred-work"
  | "accepted-exception"
  | "monitoring-gap"
  | "release-follow-up"
  | "historical-reference"
  | "template-marker"
  | "closed-evidence";

type ReviewStatus = "overdue" | "due_today" | "due_soon" | "future";
type OverallStatus = "ready" | "operable_with_residuals" | "needs_live_evidence" | "blocked";
type BoundaryStopKey = "post_update_ops001" | "release_backup_hashes" | "residual_closure";

type ResidualLedger = {
  schemaVersion?: number;
  source?: string;
  items?: ResidualItem[];
};

type ResidualItem = {
  id: string;
  type: ResidualType;
  reviewAt: string;
  currentImpact: string;
  executableNow: boolean;
  closeCondition: string;
  requiredEvidence: string;
  ownerSkills: string[];
};

type ClassifiedResidual = ResidualItem & {
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
  key: "releaseEvidenceBundleHash" | "databaseBackupSha256" | "uploadsBackupSha256" | "envBackupSha256";
  gapType: "release_evidence_bundle_hash" | "release_evidence_backup_hash";
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
  schemaVersion: 1;
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
    dueItems: Array<Pick<ClassifiedResidual, "id" | "type" | "reviewAt" | "reviewStatus" | "daysUntilReview" | "executableNow" | "ownerSkills">>;
    executableNowItems: Array<Pick<ClassifiedResidual, "id" | "type" | "reviewAt" | "reviewStatus" | "currentImpact" | "closeCondition" | "requiredEvidence" | "ownerSkills">>;
    releaseRelevantIds: string[];
  };
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
  releaseRelevantResiduals: string[];
  releaseEvidenceGaps: string[];
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
};

type ProjectionFacts = {
  asOf: string;
  packageJson: {
    name?: string;
    version?: string;
    scripts?: Record<string, string>;
  };
  ledger: ResidualLedger;
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
  "docs/development/maintenance-cadence.md",
  "docs/development/maintenance-window-record-template.md",
  "docs/development/operational-readiness.md",
  releaseEvidenceRecordPath,
  "docs/development/support-bundle-preview.md",
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/validation-matrix.md",
  "workflow/README.md",
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
  "scripts/ops/ops001-evidence-preflight.ts",
  "scripts/ops/ops004-alert-evidence-preflight.ts",
  "scripts/ops/sc002-supply-chain-preflight.ts",
  "scripts/ops/operational-alert-preview.ts",
  "scripts/ops/residual-review-due.ts",
  "scripts/ops/generate-maintenance-window-record.ts",
  "scripts/quality/enterprise-operability-preflight.ts",
  "scripts/quality/residual-ledger-validate.ts",
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
  "scripts/quality/sc002-supply-chain-preflight.selftest.ts",
];
const requiredPackageScripts = [
  "ops:status",
  "ops:status:validate",
  "ops:status:validate:selftest",
  "ops:status:selftest",
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
  "ops:ops-001:preflight",
  "ops:ops-001:preflight:selftest",
  "ops:ops-001:fallback:finalize",
  "ops:ops-001:fallback:finalize:selftest",
  "ops:ops-004:preflight",
  "ops:ops-004:preflight:selftest",
  "sc:sc-002:preflight",
  "sc:sc-002:preflight:selftest",
  "ops:alert:preview",
  "enterprise:operability:preflight",
  "maintenance:cadence:preflight",
  "maintenance:window:record",
  "maintenance:window:record:selftest",
  "maintenance:window:validate",
  "maintenance:window:selftest",
  "residuals:validate",
  "residuals:evidence:preflight",
  "residuals:evidence:preflight:selftest",
  "residuals:closure:validate",
  "residuals:closure:selftest",
  "residuals:review-due",
  "release:train:preflight",
];
const controlPlaneSourceFiles = ["package.json", ...requiredFiles];
export const protectedPathFiles = [
  "README.md",
  "package.json",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/operational-readiness.md",
  releaseEvidenceRecordPath,
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/validation-matrix.md",
  "tasks/indexes/residuals.md",
  "workflow/README.md",
] as const;

export function buildOperabilityStatusProjection(options: BuildOptions = {}): OperabilityStatusProjection {
  const facts = collectProjectionFacts(options);

  return {
    schemaVersion: 1,
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
    releaseEvidenceGaps: facts.releaseEvidenceGaps,
    nextActions: nextActions(facts.residuals),
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
    releaseRelevantResiduals: projection.residuals.releaseRelevantIds,
    releaseEvidenceGaps: projection.releaseEvidenceGaps.blockingGaps
      .map((gap) => `${gap.key} ${gap.status} ${gap.gapType} blocks=${gap.blocks.join(",")}`),
    nextEvidenceCommands: uniqueStrings([
      ...projection.commands.daily.slice(0, 4),
      "pnpm ops:ops-001:preflight",
      "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
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
  return uniqueStrings([
    ...projection.residuals.dueItems
      .filter((item) => item.type === "current-blocker")
      .map((item) => `${item.id} reviewAt=${item.reviewAt} owners=${item.ownerSkills.join(",")}`),
    ...projection.residuals.executableNowItems
      .filter((item) => item.type === "current-blocker")
      .map((item) => `${item.id} reviewAt=${item.reviewAt} owners=${item.ownerSkills.join(",")}`),
  ]);
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
    listBlock("releaseRelevantResiduals", summary.releaseRelevantResiduals),
    listBlock("releaseEvidenceGaps", summary.releaseEvidenceGaps),
    listBlock("nextEvidenceCommands", summary.nextEvidenceCommands),
    listBlock("cannotClaim", summary.cannotClaim),
    `safetyFacts: readOnly=${summary.safetyFacts.readOnly} networkRequested=${summary.safetyFacts.networkRequested} serverCommandAttempted=${summary.safetyFacts.serverCommandAttempted} productionWriteAttempted=${summary.safetyFacts.productionWriteAttempted} protectedPathWriteAttempted=${summary.safetyFacts.protectedPathWriteAttempted} secretValuePrinted=${summary.safetyFacts.secretValuePrinted}`,
  ].join("\n");
}

function collectProjectionFacts(options: BuildOptions): ProjectionFacts {
  const root = options.root ?? process.cwd();
  const asOf = options.asOf ?? todayUtcDate();
  const packageJson = readJson<ProjectionFacts["packageJson"]>(root, "package.json");
  const ledger = readJson<ResidualLedger>(root, ledgerPath);
  const residuals = (ledger.items ?? []).map((item) => classifyResidual(item, asOf));
  const missingFiles = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
  const missingScripts = requiredPackageScripts.filter((script) => !(packageJson.scripts ?? {})[script]);
  const releaseRelevantItems = residuals.filter(isReleaseRelevant);
  const controlPlaneSourceHash = hashControlPlaneSources(root);
  const protectedPathFingerprint = buildProtectedPathFingerprint(root);
  const releaseEvidenceGaps = buildReleaseEvidenceGaps(root);
  const overall = overallStatus({
    hasMissingControlPlane: missingFiles.length > 0 || missingScripts.length > 0,
    residuals,
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
  return {
    source: facts.ledger.source ?? ledgerPath,
    total: facts.residuals.length,
    countsByType: countBy(facts.residuals, residualTypes, (item) => item.type),
    countsByReviewStatus: countBy(facts.residuals, reviewStatuses, (item) => item.reviewStatus),
    dueItems: dueItems.map(toDueItem),
    executableNowItems: executableNowItems.map(toExecutableNowItem),
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
      "pnpm maintenance:window:record",
      "pnpm maintenance:window:validate <maintenance-window-record.md|txt>",
      "pnpm residuals:evidence:preflight",
      "pnpm residuals:closure:validate <residual-closure-review-record>",
    ],
    weekly: [
      "pnpm ops:handoff",
      "pnpm ops:status",
      "pnpm ops:handoff:validate:selftest",
      "pnpm ops:status:validate:selftest",
      "pnpm ops:readonly-side-effect:selftest",
      "pnpm enterprise:operability:preflight",
      "pnpm maintenance:cadence:preflight",
      "pnpm ops:support:bundle-preview:selftest",
      "pnpm ops:backup-restore:preview:selftest",
      "pnpm release:evidence:redacted-export:selftest",
      "pnpm ops:ops-001:preflight:selftest",
      "pnpm ops:ops-001:fallback:finalize:selftest",
      "pnpm ops:ops-004:preflight:selftest",
      "pnpm sc:sc-002:preflight:selftest",
      "pnpm ops:long-term:snapshot:selftest",
      "pnpm maintenance:window:record:selftest",
      "pnpm maintenance:window:selftest",
      "pnpm residuals:validate",
      "pnpm residuals:evidence:preflight:selftest",
      "pnpm residuals:closure:selftest",
      "pnpm residuals:review-due",
      "pnpm docs:readiness",
    ],
    release: [
      "pnpm ops:handoff",
      "pnpm ops:status",
      "pnpm ops:long-term:gate",
      "pnpm ops:long-term:snapshot",
      "pnpm release:train:preflight",
      "pnpm github-release-updater:preflight",
      "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
      "pnpm release:evidence:redacted-export:selftest",
      "pnpm release:supply-chain:selftest",
      "pnpm sc:sc-002:preflight",
      "pnpm ops:evidence:bundle",
      "pnpm experience:review:validate <record>",
    ],
    incident: [
      "pnpm ops:evidence:bundle",
      "pnpm ops:alert:preview",
      "pnpm incident:record:validate <record>",
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
      evidence: "releaseEvidenceBundleHash, databaseBackupSha256, uploadsBackupSha256, and envBackupSha256 for docs/development/release-v0.1.7-record.md",
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
      key: "residual_closure",
      evidence: "AF-RISK-OPS-001 / AF-RISK-OPS-004 / supply-chain residual closure decisions",
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
  const pattern = key === "releaseEvidenceBundleHash" ? /^(sha256:)?[a-f0-9]{64}$/i : /^[a-f0-9]{64}$/i;
  if (pattern.test(value)) return "present";
  if (/root-only|not-copied|pending-redacted/i.test(value)) return "root_only";
  return "invalid";
}

function releaseEvidenceText(key: ReleaseEvidenceGap["key"], status: ReleaseEvidenceGapStatus): string {
  if (status === "root_only") return `${key} is recorded as root-only or pending redacted export`;
  if (status === "missing") return `${key} is missing from the release evidence record`;
  return `${key} is present but not a valid release evidence sha256 field`;
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
  return item.type === "monitoring-gap" ||
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

function classifyResidual(item: ResidualItem, asOf: string): ClassifiedResidual {
  const reviewDate = parseDate(item.reviewAt);
  const asOfDate = parseDate(asOf);
  const daysUntilReview = Math.round((reviewDate.getTime() - asOfDate.getTime()) / 86_400_000);
  return {
    ...item,
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

function overallStatus(input: { hasMissingControlPlane: boolean; residuals: ClassifiedResidual[] }): OverallStatus {
  if (input.hasMissingControlPlane) return "blocked";
  if (input.residuals.some((item) => item.type === "current-blocker")) return "blocked";
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
  if (items.some((item) => item.type !== "closed-evidence" && item.type !== "historical-reference")) {
    return "needs_release_evidence";
  }
  return "ready_to_decide";
}

function nextActions(residuals: ClassifiedResidual[]): OperabilityStatusProjection["nextActions"] {
  return residuals
    .filter((item) => item.type === "current-blocker" || item.executableNow || item.reviewStatus !== "future")
    .map((item) => ({
      residualRiskId: item.id,
      reason: item.reviewStatus === "future" ? item.currentImpact : `${item.reviewStatus}: ${item.currentImpact}`,
      requiredEvidence: item.requiredEvidence,
      ownerSkills: item.ownerSkills,
    }));
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
