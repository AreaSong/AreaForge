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
  nextActions: Array<{
    residualRiskId: string;
    reason: string;
    requiredEvidence: string;
    ownerSkills: string[];
  }>;
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
const requiredFiles = [
  "README.md",
  "docs/README.md",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/maintenance-cadence.md",
  "docs/development/maintenance-window-record-template.md",
  "docs/development/operational-readiness.md",
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
  "scripts/ops/operational-handoff.ts",
  "scripts/ops/long-term-operability-live-gate.ts",
  "scripts/ops/operational-readiness-summary.ts",
  "scripts/ops/operational-evidence-bundle.ts",
  "scripts/ops/support-bundle-preview.ts",
  "scripts/ops/ops001-evidence-preflight.ts",
  "scripts/ops/ops004-alert-evidence-preflight.ts",
  "scripts/ops/sc002-supply-chain-preflight.ts",
  "scripts/ops/operational-alert-preview.ts",
  "scripts/ops/residual-review-due.ts",
  "scripts/ops/generate-maintenance-window-record.ts",
  "scripts/quality/enterprise-operability-preflight.ts",
  "scripts/quality/residual-ledger-validate.ts",
  "scripts/quality/operational-handoff.selftest.ts",
  "scripts/quality/long-term-operability-live-gate.selftest.ts",
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
  "ops:status:selftest",
  "ops:handoff",
  "ops:handoff:selftest",
  "ops:long-term:gate",
  "ops:long-term:gate:selftest",
  "ops:readiness:summary",
  "ops:evidence:bundle",
  "ops:support:bundle-preview",
  "ops:support:bundle-preview:validate",
  "ops:support:bundle-preview:selftest",
  "ops:ops-001:preflight",
  "ops:ops-001:preflight:selftest",
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
  "residuals:review-due",
  "release:train:preflight",
];

export function buildOperabilityStatusProjection(options: BuildOptions = {}): OperabilityStatusProjection {
  const facts = collectProjectionFacts(options);

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: "offline_long_term_operability_status_projection",
    asOf: facts.asOf,
    app: buildAppStatus(facts.packageJson),
    sourceBaseline: buildSourceBaseline(),
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
    nextActions: nextActions(facts.residuals),
    commands: buildCommandMatrix(),
    claimDiscipline: buildClaimDiscipline(),
  };
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
      "pnpm ops:status",
      "pnpm ops:support:bundle-preview",
      "pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>",
      "pnpm ops:ops-001:preflight",
      "pnpm ops:readiness:summary",
      "pnpm ops:evidence:bundle",
      "pnpm ops:alert:preview",
      "pnpm ops:ops-004:preflight",
      "pnpm maintenance:window:record",
      "pnpm maintenance:window:validate <maintenance-window-record.md|txt>",
    ],
    weekly: [
      "pnpm ops:handoff",
      "pnpm ops:status",
      "pnpm enterprise:operability:preflight",
      "pnpm maintenance:cadence:preflight",
      "pnpm ops:support:bundle-preview:selftest",
      "pnpm ops:ops-001:preflight:selftest",
      "pnpm ops:ops-004:preflight:selftest",
      "pnpm sc:sc-002:preflight:selftest",
      "pnpm maintenance:window:record:selftest",
      "pnpm maintenance:window:selftest",
      "pnpm residuals:validate",
      "pnpm residuals:review-due",
      "pnpm docs:readiness",
    ],
    release: [
      "pnpm ops:handoff",
      "pnpm ops:status",
      "pnpm ops:long-term:gate",
      "pnpm release:train:preflight",
      "pnpm github-release-updater:preflight",
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
    console.log(JSON.stringify(projection, null, 2));
    if (shouldFail(projection.status.overall, process.env.AREAFORGE_OPERABILITY_STATUS_FAIL_ON)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`FAIL operability status: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}
