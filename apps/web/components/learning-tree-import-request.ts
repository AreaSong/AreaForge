export const learningTreeImportDiffPageSize = 100;

export interface LearningTreeErrorBody {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
}

export function beginLearningTreeRequest(
  requestInFlight: { current: boolean },
  setPending: (pending: boolean) => void,
): boolean {
  if (requestInFlight.current) return false;
  requestInFlight.current = true;
  setPending(true);
  return true;
}

export function endLearningTreeRequest(
  requestInFlight: { current: boolean },
  setPending: (pending: boolean) => void,
) {
  requestInFlight.current = false;
  setPending(false);
}
