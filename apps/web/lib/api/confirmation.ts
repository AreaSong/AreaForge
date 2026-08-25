import {
  createJsonRequest,
  requestApiResult,
  type ApiErrorEnvelope,
  type ApiResult,
} from "@/lib/api/client";
import type {
  ConfirmationActionDto,
  ConfirmationFilter,
  ConfirmationItemDto,
} from "@/lib/contracts";

export interface ConfirmationListResponse {
  items?: ConfirmationItemDto[];
  error?: string;
}

export type ConfirmationMutationResponse = ApiErrorEnvelope<ConfirmationItemDto>;

type PeriodicReportConfirmationAction = Extract<
  ConfirmationActionDto,
  { kind: "periodic_report" }
>;
type StageAdjustmentConfirmationAction = Extract<
  ConfirmationActionDto,
  { kind: "stage_adjustment" }
>;
type SimulationConfirmationAction = Extract<
  ConfirmationActionDto,
  { kind: "simulation" }
>;

export type ConfirmationDecisionCommand =
  | (PeriodicReportConfirmationAction & { decision: "confirm" | "reject" })
  | (StageAdjustmentConfirmationAction & { decision: "confirm" | "reject" })
  | (SimulationConfirmationAction & { decision: "confirm" });

export type KnowledgeRetestConfirmationDecision = "confirm" | "void";

export interface KnowledgeRetestConfirmationInput {
  idempotencyKey: string;
  expectedRevision: number;
}

export function listConfirmations(
  filter: ConfirmationFilter,
  signal?: AbortSignal,
): Promise<ApiResult<ConfirmationListResponse>> {
  const search = new URLSearchParams({ filter });
  return requestApiResult(`/api/confirmations?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
}

export async function listConfirmationViews(
  filter: "pending" | "history" | "all",
  signal?: AbortSignal,
): Promise<{
  status: number;
  ok: boolean;
  pending: ConfirmationItemDto[];
  history: ConfirmationItemDto[];
}> {
  const filters = filter === "pending"
    ? ["pending"] as const
    : ["pending", "history"] as const;
  const results = await Promise.all(filters.map((value) => listConfirmations(value, signal)));
  const firstFailure = results.find((result) => !result.ok);
  const byFilter = new Map(filters.map((value, index) => [
    value,
    Array.isArray(results[index]?.body?.items) ? results[index]!.body!.items! : [],
  ]));

  return {
    status: firstFailure?.status ?? 200,
    ok: !firstFailure,
    pending: byFilter.get("pending") ?? [],
    history: byFilter.get("history") ?? [],
  };
}

/**
 * 确认中心只允许这组固定命令；联合类型明确排除 AI 草稿端点和无效的模拟考试驳回命令。
 */
export function decideConfirmation(
  command: ConfirmationDecisionCommand,
): Promise<ApiResult<ConfirmationMutationResponse>> {
  switch (command.kind) {
    case "periodic_report":
      return requestApiResult(
        `/api/reports/${encodeURIComponent(command.reportId)}/${command.decision}`,
        createJsonRequest("POST", {
          kind: command.reportKind,
          expectedRevision: command.expectedRevision,
          rangeStart: command.rangeStart,
          rangeEnd: command.rangeEnd,
        }),
      );
    case "stage_adjustment":
      return requestApiResult(
        `/api/stage-adjustment-drafts/${encodeURIComponent(command.draftId)}/${command.decision}`,
        createJsonRequest("POST", { expectedRevision: command.expectedRevision }),
      );
    case "simulation":
      return requestApiResult(
        `/api/simulation-exams/${encodeURIComponent(command.examId)}/confirm`,
        createJsonRequest("POST", { expectedRevision: command.expectedRevision }),
      );
  }
}

export function decideKnowledgeRetestConfirmation(
  retestId: string,
  decision: KnowledgeRetestConfirmationDecision,
  input: KnowledgeRetestConfirmationInput,
): Promise<ApiResult<ConfirmationMutationResponse>> {
  return requestApiResult(
    `/api/knowledge-retests/${encodeURIComponent(retestId)}/${decision}`,
    createJsonRequest("POST", input),
  );
}
