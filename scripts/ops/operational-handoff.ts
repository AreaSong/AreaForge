import { pathToFileURL } from "node:url";
import { buildOperabilityStatusProjection, type OperabilityStatusProjection } from "./operability-status";

type FocusKind = "execute_now" | "review_due" | "release_evidence" | "track";

export type OperationalHandoff = {
  schemaVersion: 1;
  generatedAt: string;
  mode: "read_only_operational_handoff";
  app: OperabilityStatusProjection["app"];
  status: {
    offlineOverall: OperabilityStatusProjection["status"]["overall"];
    controlPlane: OperabilityStatusProjection["status"]["controlPlane"];
    releaseTrain: OperabilityStatusProjection["status"]["releaseTrain"];
    productionHealthClaim: OperabilityStatusProjection["status"]["productionHealthClaim"];
  };
  source: {
    statusProjection: "pnpm ops:status";
    residualLedger: string;
    authoritativeDocs: string[];
  };
  claimBoundary: {
    canClaim: string[];
    cannotClaim: string[];
  };
  evidenceFocus: {
    immediate: FocusItem[];
    dueOrSoon: FocusItem[];
    releaseRelevantIds: string[];
  };
  nextCommands: {
    handoff: string[];
    liveEvidence: string[];
    release: string[];
    maintenance: string[];
  };
  highRiskBoundaries: string[];
  safetyFacts: OperabilityStatusProjection["safetyFacts"] & {
    handoffWritten: false;
  };
};

type FocusItem = {
  residualRiskId: string;
  kind: FocusKind;
  ownerSkills: string[];
  reason: string;
  requiredEvidence: string;
};

type BuildOptions = {
  root?: string;
  asOf?: string;
  generatedAt?: string;
};

export function buildOperationalHandoff(options: BuildOptions = {}): OperationalHandoff {
  const projection = buildOperabilityStatusProjection(options);
  const executableIds = new Set(projection.residuals.executableNowItems.map((item) => item.id));
  const dueIds = new Set(projection.residuals.dueItems.map((item) => item.id));
  const releaseRelevantIds = new Set(projection.residuals.releaseRelevantIds);
  const focusItems = projection.nextActions.map((action) => toFocusItem({
    action,
    executableIds,
    dueIds,
    releaseRelevantIds,
  }));

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? projection.generatedAt,
    mode: "read_only_operational_handoff",
    app: projection.app,
    status: {
      offlineOverall: projection.status.overall,
      controlPlane: projection.status.controlPlane,
      releaseTrain: projection.status.releaseTrain,
      productionHealthClaim: projection.status.productionHealthClaim,
    },
    source: {
      statusProjection: "pnpm ops:status",
      residualLedger: projection.residuals.source,
      authoritativeDocs: [
        "docs/development/long-term-operability-control-plane.md",
        "docs/development/operational-readiness.md",
        "docs/development/maintenance-cadence.md",
        "docs/development/residual-risk-ledger.md",
        "docs/development/release-train.md",
      ],
    },
    claimBoundary: buildClaimBoundary(projection),
    evidenceFocus: {
      immediate: focusItems.filter((item) => item.kind === "execute_now"),
      dueOrSoon: focusItems.filter((item) => item.kind !== "execute_now"),
      releaseRelevantIds: projection.residuals.releaseRelevantIds,
    },
    nextCommands: buildNextCommands(projection),
    highRiskBoundaries: [
      "No production deploy, migration, backup, restore, updater apply, rollback, or server command is executed by this handoff.",
      "Web runtime update requests are not updater apply evidence.",
      "Release readiness still needs signed assets, immutable digests, smoke evidence, rollback target, and residual-risk review.",
      "Residual risks close only with their close-condition evidence.",
    ],
    safetyFacts: {
      ...projection.safetyFacts,
      handoffWritten: false,
    },
  };
}

function toFocusItem(input: {
  action: OperabilityStatusProjection["nextActions"][number];
  executableIds: Set<string>;
  dueIds: Set<string>;
  releaseRelevantIds: Set<string>;
}): FocusItem {
  return {
    residualRiskId: input.action.residualRiskId,
    kind: focusKind(input.action.residualRiskId, input.executableIds, input.dueIds, input.releaseRelevantIds),
    ownerSkills: input.action.ownerSkills,
    reason: input.action.reason,
    requiredEvidence: input.action.requiredEvidence,
  };
}

function focusKind(
  residualRiskId: string,
  executableIds: Set<string>,
  dueIds: Set<string>,
  releaseRelevantIds: Set<string>,
): FocusKind {
  if (executableIds.has(residualRiskId)) return "execute_now";
  if (dueIds.has(residualRiskId)) return "review_due";
  if (releaseRelevantIds.has(residualRiskId)) return "release_evidence";
  return "track";
}

function buildClaimBoundary(projection: OperabilityStatusProjection): OperationalHandoff["claimBoundary"] {
  const canClaim = [
    `offline control plane: ${projection.status.controlPlane}`,
    `offline operability status: ${projection.status.overall}`,
    `release train status from local source facts: ${projection.status.releaseTrain}`,
  ];
  const cannotClaim = [
    "current production health without live readiness, authenticated smoke, update-agent, backup, and release evidence",
    "updater apply completion from Web update requests or offline projection",
    "auto-apply enablement while AREAFORGE_AUTO_APPLY remains none",
    "residual risk closure without close-condition evidence",
  ];

  if (projection.status.controlPlane !== "pass") {
    cannotClaim.unshift("enterprise operability while required control-plane files or scripts are missing");
  }

  return { canClaim, cannotClaim };
}

function buildNextCommands(projection: OperabilityStatusProjection): OperationalHandoff["nextCommands"] {
  return {
    handoff: [
      "pnpm ops:handoff",
      "pnpm ops:status",
      "pnpm residuals:review-due",
    ],
    liveEvidence: [
      "pnpm ops:readiness:summary",
      "pnpm ops:evidence:bundle",
      "pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>",
      "pnpm ops:alert:preview",
      "pnpm smoke:prod-readonly:config",
      "pnpm smoke:prod-readonly",
    ],
    release: projection.commands.release,
    maintenance: projection.commands.weekly,
  };
}

function shouldFail(status: OperabilityStatusProjection["status"]["overall"], failOn: string | undefined): boolean {
  if (!failOn) return false;
  const order: Array<OperabilityStatusProjection["status"]["overall"]> = [
    "ready",
    "operable_with_residuals",
    "needs_live_evidence",
    "blocked",
  ];
  const threshold = order.includes(failOn as OperabilityStatusProjection["status"]["overall"])
    ? failOn as OperabilityStatusProjection["status"]["overall"]
    : "blocked";
  return order.indexOf(status) >= order.indexOf(threshold);
}

function isMain(): boolean {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMain()) {
  try {
    const handoff = buildOperationalHandoff({
      asOf: process.env.AREAFORGE_OPERABILITY_STATUS_AS_OF,
    });
    console.log(JSON.stringify(handoff, null, 2));
    if (shouldFail(handoff.status.offlineOverall, process.env.AREAFORGE_OPERABILITY_HANDOFF_FAIL_ON)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`FAIL operational handoff: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}
