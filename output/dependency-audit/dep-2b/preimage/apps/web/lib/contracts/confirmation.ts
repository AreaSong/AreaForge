export type ConfirmationFilter = "pending" | "history";
export type ConfirmationKind = "periodic_report" | "stage_adjustment" | "simulation" | "knowledge_retest" | "ai_draft";
export type ConfirmationStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "FROZEN";

export type ConfirmationActionDto =
  | {
      kind: "periodic_report";
      reportId: string;
      reportKind: "week" | "month";
      expectedRevision: number;
      rangeStart: string;
      rangeEnd: string;
    }
  | { kind: "stage_adjustment"; draftId: string; expectedRevision: number }
  | { kind: "simulation"; examId: string; expectedRevision: number; ready: boolean }
  | { kind: "knowledge_retest"; retestId: string; expectedRevision: number; ready: boolean }
  | { kind: "ai_draft"; endpoint: string; operationId: string; canExecute: false };

export interface ConfirmationItemDto {
  id: string;
  kind: ConfirmationKind;
  sourceId: string;
  revision: number;
  status: ConfirmationStatus;
  requiresUserConfirmation: boolean;
  confirmedAt: string | null;
  frozenAt: string | null;
  title: string;
  summary: string;
  href: string;
  sourceHref: string;
  sourceLabel: string;
  createdAt: string;
  action: ConfirmationActionDto | null;
  /** @deprecated Consumers should derive this from status/frozenAt. */
  frozen: boolean;
}
