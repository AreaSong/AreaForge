export type KnowledgeMasteryResult = "PASSED" | "PARTIAL" | "FAILED";
export type KnowledgeMasteryState = "INITIAL_MASTERY" | "STABLE_MASTERY" | "NEEDS_RETEST" | "LEARNING";

export interface PreviousKnowledgeEvidence {
  occurredAt: Date;
  dimensions: unknown;
}

export function masteryStateForRetest(input: {
  result: KnowledgeMasteryResult | null;
  currentState: string;
  testedAt: Date;
  previousEvidence: PreviousKnowledgeEvidence[];
  method: string;
}): KnowledgeMasteryState {
  if (input.result !== "PASSED") {
    if (input.currentState === "STABLE_MASTERY" || input.currentState === "INITIAL_MASTERY") return input.currentState;
    return "NEEDS_RETEST";
  }

  const previousPasses = input.previousEvidence.filter((evidence) => {
    return evidenceResult(evidence.dimensions) === "PASSED"
      && evidence.occurredAt.getTime() < input.testedAt.getTime();
  });
  const delayedPass = previousPasses.some((evidence) => input.testedAt.getTime() - evidence.occurredAt.getTime() >= 7 * 24 * 60 * 60 * 1000);
  const variantEvidence = isVariantMethod(input.method) || input.previousEvidence.some((evidence) => {
    return evidenceResult(evidence.dimensions) === "PASSED" && isVariantMethod(evidenceMethod(evidence.dimensions));
  });

  return previousPasses.length >= 1 && delayedPass && variantEvidence
    ? "STABLE_MASTERY"
    : "INITIAL_MASTERY";
}

export function isVariantMethod(method: string): boolean {
  return /变式|应用|综合|限时|迁移/.test(method);
}

function evidenceResult(value: unknown): string {
  if (!isRecord(value)) return "";
  return typeof value.result === "string" ? value.result : "";
}

function evidenceMethod(value: unknown): string {
  if (!isRecord(value)) return "";
  return typeof value.method === "string" ? value.method : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
