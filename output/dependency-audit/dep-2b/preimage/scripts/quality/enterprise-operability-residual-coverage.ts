import type { ResidualItemV2 } from "./residual-ledger-common";

export type ResidualCoverageItem = Pick<
  ResidualItemV2,
  "id" | "reviewAt" | "closeCondition" | "requiredEvidence" | "ownerSkills"
>;

export interface ResidualCoverageResult {
  ok: boolean;
  expectedCount: number;
  sectionIssues: string[];
  missingFromReviewSection: string[];
  orphanedInReviewSection: string[];
  duplicatedInReviewSection: string[];
  incompleteItems: string[];
}

const reviewHeading = "## 当前必须持续复核的证据";
const residualBulletPattern = /^- `(?<id>AF-RISK-[A-Z]+-\d{3})`：/;

export function evaluateResidualCoverage(
  controlPlaneDoc: string,
  items: ResidualCoverageItem[],
): ResidualCoverageResult {
  const section = parseReviewSection(controlPlaneDoc);
  const expectedIds = new Set(items.map((item) => item.id));
  const counts = new Map<string, number>();

  for (const id of section.ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  const missingFromReviewSection = [...expectedIds]
    .filter((id) => (counts.get(id) ?? 0) === 0)
    .sort();
  const orphanedInReviewSection = [...counts.keys()]
    .filter((id) => !expectedIds.has(id))
    .sort();
  const duplicatedInReviewSection = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const incompleteItems = items
    .filter((item) => (
      !item.reviewAt.trim()
      || !item.closeCondition.trim()
      || !item.requiredEvidence.trim()
      || item.ownerSkills.length === 0
    ))
    .map((item) => item.id)
    .sort();

  const ok = section.issues.length === 0
    && missingFromReviewSection.length === 0
    && orphanedInReviewSection.length === 0
    && duplicatedInReviewSection.length === 0
    && incompleteItems.length === 0;

  return {
    ok,
    expectedCount: items.length,
    sectionIssues: section.issues,
    missingFromReviewSection,
    orphanedInReviewSection,
    duplicatedInReviewSection,
    incompleteItems,
  };
}

function parseReviewSection(doc: string): { ids: string[]; issues: string[] } {
  const lines = doc.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => line.trim() === reviewHeading ? index : -1)
    .filter((index) => index >= 0);

  if (headingIndexes.length !== 1) {
    return {
      ids: [],
      issues: [`expected exactly one ${reviewHeading} section, found ${headingIndexes.length}`],
    };
  }

  const start = headingIndexes[0];
  const relativeEnd = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  if (relativeEnd < 0) {
    return { ids: [], issues: [`${reviewHeading} must be followed by another level-two heading`] };
  }

  const end = start + 1 + relativeEnd;
  const ids = lines
    .slice(start + 1, end)
    .map((line) => line.match(residualBulletPattern)?.groups?.id)
    .filter((id): id is string => Boolean(id));

  return { ids, issues: [] };
}
