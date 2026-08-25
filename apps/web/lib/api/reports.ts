import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type {
  PeriodicReportDecisionDto,
  PeriodicReportKind,
  ReportDecisionConflictLatest,
} from "@/lib/contracts";

export type ReportDecisionAction = "confirm" | "reject";

export interface ReportDecisionInput {
  kind: PeriodicReportKind;
  expectedRevision: number;
  rangeStart: string;
  rangeEnd: string;
}

export interface ReportDecisionResponse extends ApiErrorEnvelope<ReportDecisionConflictLatest> {
  decision?: PeriodicReportDecisionDto;
}

export function decidePeriodicReport(
  reportId: string,
  action: ReportDecisionAction,
  input: ReportDecisionInput,
): Promise<ApiResult<ReportDecisionResponse>> {
  return requestApiResult(
    `/api/reports/${encodeURIComponent(reportId)}/${action}`,
    createJsonRequest("POST", input),
  );
}
