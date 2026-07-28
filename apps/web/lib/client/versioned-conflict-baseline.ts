import type { PeriodicReportDto } from "@/lib/study/reports-service";
import type { StageAdjustmentDraftRecordDto } from "@/lib/study/types";

export function selectReportDecisionBaseline(
  current: PeriodicReportDto,
  serverCandidate: PeriodicReportDto | null,
): PeriodicReportDto {
  if (!serverCandidate || serverCandidate.kind !== current.kind) return current;

  const rangeOrder = serverCandidate.range.start.localeCompare(current.range.start);
  if (rangeOrder !== 0) return rangeOrder > 0 ? serverCandidate : current;
  if (serverCandidate.revision !== current.revision) {
    return serverCandidate.revision > current.revision ? serverCandidate : current;
  }
  return !current.decision && serverCandidate.decision ? serverCandidate : current;
}

export function selectStageDecisionBaseline(
  current: StageAdjustmentDraftRecordDto,
  serverCandidate: StageAdjustmentDraftRecordDto | null,
): StageAdjustmentDraftRecordDto {
  if (!serverCandidate) return current;
  if (serverCandidate.id === current.id) {
    return serverCandidate.revision > current.revision ? serverCandidate : current;
  }

  const candidateOrigin = serverCandidate.originVersion ?? -1;
  const currentOrigin = current.originVersion ?? -1;
  if (candidateOrigin !== currentOrigin) return candidateOrigin > currentOrigin ? serverCandidate : current;

  return Date.parse(serverCandidate.createdAt) > Date.parse(current.createdAt) ? serverCandidate : current;
}
