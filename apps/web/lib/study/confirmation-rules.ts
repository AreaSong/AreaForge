/**
 * Pure confirmation policy shared by the confirmation projection and tests.
 * Keeping readiness here prevents a list page from exposing an action that its
 * source page cannot safely complete.
 */

export type ConfirmationProjectionStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "FROZEN";

export interface SimulationConfirmationInput {
  status: "DRAFT" | "CONFIRMED";
  subjectResultCount: number;
  summary: string | null | undefined;
  reviewText: string | null | undefined;
  mindset: string | null | undefined;
}

export type RetestConfirmationInputStatus = "DRAFT" | "IN_PROGRESS" | "PENDING_REVIEW" | "CLOSED" | "VOIDED";

export function periodicReportConfirmationId(kind: "week" | "month", rangeEnd: string): string {
  return `report:${kind}:${rangeEnd}`;
}

export function isSimulationReadyForConfirmation(input: SimulationConfirmationInput): boolean {
  if (input.status === "CONFIRMED") return true;
  return input.subjectResultCount > 0
    && hasText(input.summary)
    && hasText(input.reviewText)
    && hasText(input.mindset);
}

export function simulationConfirmationActionReady(input: SimulationConfirmationInput): boolean {
  return input.status === "DRAFT" && isSimulationReadyForConfirmation(input);
}

export function retestConfirmationStatus(status: RetestConfirmationInputStatus): ConfirmationProjectionStatus | null {
  if (status === "PENDING_REVIEW") return "PENDING";
  if (status === "CLOSED") return "FROZEN";
  if (status === "VOIDED") return "REJECTED";
  return null;
}

export function retestConfirmationActionReady(status: RetestConfirmationInputStatus): boolean {
  return status === "PENDING_REVIEW";
}

export function aiConfirmationCapability(): { canExecute: false; requiresSourceProof: true } {
  return { canExecute: false, requiresSourceProof: true };
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
