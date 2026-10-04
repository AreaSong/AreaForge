import { classifyApiFailure, type ApiErrorSource } from "@/lib/client/api-errors";

export type MutationFeedback = {
  kind: "unauthorized" | "conflict" | "error";
  message: string;
};

/** Keep write failure copy and boundary classification consistent across client workflows. */
export function mutationFeedback(source: ApiErrorSource | null | undefined, fallback: string): MutationFeedback {
  const failure = classifyApiFailure(source);
  if (failure.kind === "unauthorized") return { kind: "unauthorized", message: "登录已过期，当前命令已保留；重新登录后请显式重试。" };
  if (failure.kind === "conflict") return { kind: "conflict", message: "服务端版本已变化，当前输入已保留；请刷新查看最新状态后显式重试。" };
  return { kind: "error", message: failure.code ?? fallback };
}
