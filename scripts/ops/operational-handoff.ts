import { pathToFileURL } from "node:url";
import { buildOperabilityStatusProjection, type OperabilityStatusProjection } from "./operability-status";

type FocusKind = "current_blocker" | "execute_now" | "review_due" | "release_evidence" | "track";

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
    controlPlaneSourceHash: string;
    protectedPathFingerprint: OperabilityStatusProjection["sourceSnapshot"]["protectedPathFingerprint"];
    residualLedger: string;
    authoritativeDocs: string[];
  };
  claimBoundary: {
    canClaim: string[];
    cannotClaim: string[];
  };
  evidenceFocus: {
    currentBlockers: FocusItem[];
    boundaryStops: OperabilityStatusProjection["boundaryStops"];
    releaseEvidenceGaps: OperabilityStatusProjection["releaseEvidenceGaps"];
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
  doesNotProve: string[];
  highRiskBoundaries: string[];
  safetyFacts: OperabilityStatusProjection["safetyFacts"] & {
    handoffWritten: false;
  };
};

export type OperationalHandoffSummary = {
  title: "AreaForge operational handoff";
  app: string;
  offlineOverall: OperationalHandoff["status"]["offlineOverall"];
  controlPlane: OperationalHandoff["status"]["controlPlane"];
  releaseTrain: OperationalHandoff["status"]["releaseTrain"];
  currentBlockers: string[];
  boundaryStops: string[];
  releaseEvidenceGaps: string[];
  immediateFocus: string[];
  dueOrSoonFocus: string[];
  releaseRelevantResiduals: string[];
  nextHandoffCommands: string[];
  nextLiveEvidenceCommands: string[];
  cannotClaim: string[];
  highRiskBoundaries: string[];
  safetyFacts: Pick<
    OperationalHandoff["safetyFacts"],
    | "readOnly"
    | "networkRequested"
    | "serverCommandAttempted"
    | "productionWriteAttempted"
    | "protectedPathWriteAttempted"
      | "secretValuePrinted"
      | "handoffWritten"
  >;
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
  const currentBlockerIds = new Set(projection.residuals.dueItems
    .filter((item) => item.type === "current-blocker")
    .map((item) => item.id));
  const releaseRelevantIds = new Set(projection.residuals.releaseRelevantIds);
  const focusItems = projection.nextActions.map((action) => toFocusItem({
    action,
    currentBlockerIds,
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
      controlPlaneSourceHash: projection.sourceSnapshot.controlPlaneSourceHash,
      protectedPathFingerprint: projection.sourceSnapshot.protectedPathFingerprint,
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
    doesNotProve: buildDoesNotProve(projection),
    evidenceFocus: {
      currentBlockers: focusItems.filter((item) => item.kind === "current_blocker"),
      boundaryStops: projection.boundaryStops,
      releaseEvidenceGaps: projection.releaseEvidenceGaps,
      immediate: focusItems.filter((item) => item.kind === "execute_now"),
      dueOrSoon: focusItems.filter((item) => item.kind !== "execute_now" && item.kind !== "current_blocker"),
      releaseRelevantIds: projection.residuals.releaseRelevantIds,
    },
    nextCommands: buildNextCommands(projection),
    highRiskBoundaries: [
      "No production deploy, migration, backup, restore, updater apply, rollback, or server command is executed by this handoff.",
      "Web runtime update requests are not updater apply evidence.",
      "Release readiness still needs signed assets, immutable digests, smoke evidence, rollback target, and residual-risk review.",
      "Residual risks close only with their close-condition evidence.",
      "Secrets must not be read, printed, copied, or committed unless a future confirmation explicitly authorizes that exact evidence path.",
    ],
    safetyFacts: {
      ...projection.safetyFacts,
      handoffWritten: false,
    },
  };
}

export function buildOperationalHandoffSummary(handoff: OperationalHandoff): OperationalHandoffSummary {
  return {
    title: "AreaForge operational handoff",
    app: `${handoff.app.name} ${handoff.app.version} (${handoff.app.releaseTag})`,
    offlineOverall: handoff.status.offlineOverall,
    controlPlane: handoff.status.controlPlane,
    releaseTrain: handoff.status.releaseTrain,
    currentBlockers: handoff.evidenceFocus.currentBlockers.map(toSummaryFocus),
    boundaryStops: handoff.evidenceFocus.boundaryStops.map(toSummaryBoundaryStop),
    releaseEvidenceGaps: handoff.evidenceFocus.releaseEvidenceGaps.blockingGaps
      .map((gap) => `${gap.key} ${gap.status} ${gap.gapType} blocks=${gap.blocks.join(",")}`),
    immediateFocus: handoff.evidenceFocus.immediate.map(toSummaryFocus),
    dueOrSoonFocus: handoff.evidenceFocus.dueOrSoon.map(toSummaryFocus),
    releaseRelevantResiduals: handoff.evidenceFocus.releaseRelevantIds,
    nextHandoffCommands: uniqueStrings(handoff.nextCommands.handoff.map(toSummaryCommand)),
    nextLiveEvidenceCommands: uniqueStrings(handoff.nextCommands.liveEvidence.slice(0, 6)),
    cannotClaim: handoff.claimBoundary.cannotClaim,
    highRiskBoundaries: handoff.highRiskBoundaries,
    safetyFacts: {
      readOnly: handoff.safetyFacts.readOnly,
      networkRequested: handoff.safetyFacts.networkRequested,
      serverCommandAttempted: handoff.safetyFacts.serverCommandAttempted,
      productionWriteAttempted: handoff.safetyFacts.productionWriteAttempted,
      protectedPathWriteAttempted: handoff.safetyFacts.protectedPathWriteAttempted,
      secretValuePrinted: handoff.safetyFacts.secretValuePrinted,
      handoffWritten: handoff.safetyFacts.handoffWritten,
    },
  };
}

export function formatOperationalHandoffSummary(summary: OperationalHandoffSummary): string {
  return [
    summary.title,
    `app: ${summary.app}`,
    `offlineOverall: ${summary.offlineOverall}`,
    `controlPlane: ${summary.controlPlane}`,
    `releaseTrain: ${summary.releaseTrain}`,
    listBlock("currentBlockers", summary.currentBlockers),
    listBlock("boundaryStops", summary.boundaryStops),
    listBlock("releaseEvidenceGaps", summary.releaseEvidenceGaps),
    listBlock("immediateFocus", summary.immediateFocus),
    listBlock("dueOrSoonFocus", summary.dueOrSoonFocus),
    listBlock("releaseRelevantResiduals", summary.releaseRelevantResiduals),
    listBlock("nextHandoffCommands", summary.nextHandoffCommands),
    listBlock("nextLiveEvidenceCommands", summary.nextLiveEvidenceCommands),
    listBlock("cannotClaim", summary.cannotClaim),
    listBlock("highRiskBoundaries", summary.highRiskBoundaries),
    `safetyFacts: readOnly=${summary.safetyFacts.readOnly} networkRequested=${summary.safetyFacts.networkRequested} serverCommandAttempted=${summary.safetyFacts.serverCommandAttempted} productionWriteAttempted=${summary.safetyFacts.productionWriteAttempted} protectedPathWriteAttempted=${summary.safetyFacts.protectedPathWriteAttempted} secretValuePrinted=${summary.safetyFacts.secretValuePrinted} handoffWritten=${summary.safetyFacts.handoffWritten}`,
  ].join("\n");
}

function buildDoesNotProve(projection: OperabilityStatusProjection): string[] {
  return [
    ...projection.doesNotProve,
    "production update request completion",
    "operator approval for high-risk actions",
  ];
}

function toSummaryFocus(item: FocusItem): string {
  return `${item.residualRiskId} kind=${item.kind} owners=${item.ownerSkills.join(",")}`;
}

function toSummaryBoundaryStop(stop: OperabilityStatusProjection["boundaryStops"][number]): string {
  return `${stop.key}: ${stop.evidence}; blockedBy=${stop.currentBoundary.join(",")}`;
}

function listBlock(label: string, values: string[]): string {
  if (values.length === 0) return `${label}: none`;
  return [`${label}:`, ...values.map((value) => `- ${value}`)].join("\n");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function toSummaryCommand(command: string): string {
  if (command === "pnpm ops:handoff") return "pnpm ops:handoff --summary";
  if (command === "pnpm ops:status") return "pnpm ops:status --summary";
  return command;
}

function toFocusItem(input: {
  action: OperabilityStatusProjection["nextActions"][number];
  currentBlockerIds: Set<string>;
  executableIds: Set<string>;
  dueIds: Set<string>;
  releaseRelevantIds: Set<string>;
}): FocusItem {
  return {
    residualRiskId: input.action.residualRiskId,
    kind: focusKind(
      input.action.residualRiskId,
      input.currentBlockerIds,
      input.executableIds,
      input.dueIds,
      input.releaseRelevantIds,
    ),
    ownerSkills: input.action.ownerSkills,
    reason: input.action.reason,
    requiredEvidence: input.action.requiredEvidence,
  };
}

function focusKind(
  residualRiskId: string,
  currentBlockerIds: Set<string>,
  executableIds: Set<string>,
  dueIds: Set<string>,
  releaseRelevantIds: Set<string>,
): FocusKind {
  if (currentBlockerIds.has(residualRiskId)) return "current_blocker";
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
    "post-update OPS-001 closure or release evidence bundle/backup hashes under a no-server/no-secret boundary",
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
      "pnpm ops:handoff:validate <operational-handoff.json>",
      "pnpm ops:status",
      "pnpm ops:status:validate <operability-status.json>",
      "pnpm ops:support:bundle-preview",
      "pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>",
      "pnpm ops:backup-restore:preview",
      "pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>",
      "pnpm residuals:review-due",
      "pnpm residuals:evidence:preflight",
      "pnpm residuals:closure:validate <residual-closure-review-record>",
    ],
    liveEvidence: [
      "pnpm ops:ops-001:preflight",
      "AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=<manifest> pnpm ops:ops-001:fallback:finalize <redacted-fallback-dir> <output-dir>",
      "pnpm ops:backup-restore:preview",
      "pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>",
      "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
      "pnpm ops:readiness:summary",
      "pnpm ops:evidence:bundle",
      "pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>",
      "pnpm ops:long-term:snapshot",
      "pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json>",
      "pnpm ops:alert:preview",
      "pnpm maintenance:window:record",
      "pnpm maintenance:window:validate <maintenance-window-record.md|txt>",
      "pnpm residuals:evidence:preflight",
      "pnpm residuals:closure:validate <residual-closure-review-record>",
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
    if (process.argv.includes("--summary")) {
      console.log(formatOperationalHandoffSummary(buildOperationalHandoffSummary(handoff)));
    } else {
      console.log(JSON.stringify(handoff, null, 2));
    }
    if (shouldFail(handoff.status.offlineOverall, process.env.AREAFORGE_OPERABILITY_HANDOFF_FAIL_ON)) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`FAIL operational handoff: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}
