import { buildSimulationRemediationOriginKey, SIMULATION_LOSS_REASONS, type SimulationLossReason } from "@areaforge/core";
import type { Prisma } from "@areaforge/db";

export function summarizeSimulationInboxMergeConflicts(
  rows: Array<{
    subjectId: string | null;
    ownerUserId?: string;
    workspaceId?: string;
    originKey: string;
    originVersion: number;
    originSnapshot: Prisma.JsonValue;
  }>,
  targetSubjectId: string,
): { collisions: number; invalid: number } {
  const counts = new Map<string, number>();
  let invalid = 0;
  for (const row of rows) {
    const originKey = row.subjectId === targetSubjectId
      ? row.originKey
      : deriveMergedSimulationOriginKey(row.originSnapshot, targetSubjectId);
    if (!originKey) {
      invalid += 1;
      continue;
    }
    const uniqueKey = JSON.stringify([row.workspaceId, row.ownerUserId, originKey, row.originVersion]);
    counts.set(uniqueKey, (counts.get(uniqueKey) ?? 0) + 1);
  }
  return {
    collisions: [...counts.values()].filter((count) => count > 1).length,
    invalid,
  };
}

export function deriveMergedSimulationOriginKey(
  value: Prisma.JsonValue,
  targetSubjectId: string,
): string | null {
  const snapshot = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
  const examId = typeof snapshot.examId === "string" ? snapshot.examId : "";
  const reasonValue = typeof snapshot.reason === "string" ? snapshot.reason : "";
  const reason = SIMULATION_LOSS_REASONS.includes(reasonValue as SimulationLossReason)
    ? reasonValue as SimulationLossReason
    : null;
  const syllabusNodeId = typeof snapshot.syllabusNodeId === "string" && snapshot.syllabusNodeId
    ? snapshot.syllabusNodeId
    : null;
  return examId && reason
    ? buildSimulationRemediationOriginKey({ examId, subjectId: targetSubjectId, reason, syllabusNodeId })
    : null;
}

