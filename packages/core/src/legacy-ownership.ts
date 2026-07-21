export type LegacyOwnershipVerdict = "TAKEOVER_ELIGIBLE" | "UNRESOLVED_LEGACY";

export interface LegacyOwnershipEvidence {
  subjectOwnerCandidates: string[];
  referencedOwnerCandidates: string[];
  hasOrphanSubject: boolean;
  hasCrossOwnerReference: boolean;
  hasMissingOwner: boolean;
}

export interface LegacyTakeoverPreviewCounts {
  eligibleCount: number;
  unresolvedCount: number;
  crossOwnerBlockedCount: number;
  affectedDateCount: number;
  affectedPeriodCount: number;
}

export function classifyLegacyOwnership(evidence: LegacyOwnershipEvidence): LegacyOwnershipVerdict {
  if (
    evidence.hasOrphanSubject ||
    evidence.hasCrossOwnerReference ||
    evidence.hasMissingOwner ||
    evidence.subjectOwnerCandidates.length !== 1
  ) {
    return "UNRESOLVED_LEGACY";
  }

  const owner = evidence.subjectOwnerCandidates[0];
  if (!owner || evidence.referencedOwnerCandidates.some((candidate) => candidate !== owner)) {
    return "UNRESOLVED_LEGACY";
  }

  return "TAKEOVER_ELIGIBLE";
}

export function summarizeTakeoverPreview(
  rows: Array<{ verdict: LegacyOwnershipVerdict; affectedDates?: number; affectedPeriods?: number }>,
): LegacyTakeoverPreviewCounts {
  return {
    eligibleCount: rows.filter((row) => row.verdict === "TAKEOVER_ELIGIBLE").length,
    unresolvedCount: rows.filter((row) => row.verdict === "UNRESOLVED_LEGACY").length,
    crossOwnerBlockedCount: rows.filter((row) => row.verdict === "UNRESOLVED_LEGACY").length,
    affectedDateCount: rows.reduce((total, row) => total + (row.affectedDates ?? 0), 0),
    affectedPeriodCount: rows.reduce((total, row) => total + (row.affectedPeriods ?? 0), 0),
  };
}
