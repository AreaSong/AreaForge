import type { PeriodicReportDecisionDto, PeriodicReportDto } from "./reports";

export interface ReportDecisionConflictLatest {
  kind: "periodic-report-decision";
  report: PeriodicReportDto;
  decision: PeriodicReportDecisionDto | null;
  sourceConflict?: unknown;
}
