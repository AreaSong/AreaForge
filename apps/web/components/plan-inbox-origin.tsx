import Link from "next/link";
import { withReturnTo } from "@/lib/navigation/batch7";
import type { PlanInboxItemDto } from "@/lib/study/plan-inbox-service";

const originLabels: Record<string, string> = {
  DAILY_REVIEW_MINIMUM: "来自今日复盘",
  USER_CREATED: "手动创建",
  AI_PLAN: "来自 AI 计划草稿",
  LOW_CONVERSION: "来自低转化补救",
  SIMULATION_LOSS: "来自模拟考试补救",
  PERIODIC_REPORT: "来自周期复盘决策",
  STAGE_ADJUSTMENT: "来自阶段调整",
};

const lossReasonLabels: Record<string, string> = {
  CONCEPT_GAP: "概念缺口",
  MEMORY_FORMULA: "记忆/公式",
  METHOD_ERROR: "方法错误",
  CALCULATION_CARELESS: "计算/粗心",
  TIME_ALLOCATION: "时间分配",
  READING_COMPREHENSION: "审题理解",
  UNFAMILIAR_PATTERN: "题型陌生",
  MINDSET: "心态",
  UNANSWERED: "未作答",
  OTHER: "其他",
};

export function planInboxOriginLabel(originType: string): string {
  return originLabels[originType] ?? "投入草稿";
}

export function PlanInboxOriginSummary({ item, returnTo }: { item: Pick<PlanInboxItemDto, "originType" | "originSnapshot">; returnTo: string }) {
  if (item.originType !== "SIMULATION_LOSS") return null;
  const snapshot = asRecord(item.originSnapshot);
  const examId = stringValue(snapshot.examId);
  const reason = stringValue(snapshot.reason);
  const lostScore = numberValue(snapshot.lostScore);

  return (
    <section className="border-y border-white/10 py-4">
      <p className="text-sm font-medium text-white">模拟失分补救</p>
      <p className="mt-1 text-sm text-zinc-400">
        {lostScore == null ? "已记录失分" : `${lostScore} 分失分`} · {reason ? (lossReasonLabels[reason] ?? reason) : "未标注原因"}
      </p>
      {examId ? <Link href={withReturnTo(`/test/simulations/${encodeURIComponent(examId)}`, returnTo)} className="mt-3 inline-flex text-sm text-teal-300 hover:underline">查看来源考试</Link> : null}
    </section>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
