import Link from "next/link";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { PlanInboxItemDto } from "@/lib/contracts";

const originLabels: Record<string, string> = {
  DAILY_REVIEW_MINIMUM: "来自今日复盘",
  USER_CREATED: "手动创建",
  AI_PLAN: "来自 AI 计划草稿",
  LOW_CONVERSION: "来自低转化补救",
  RECOVERY_MINIMUM: "来自恢复最小行动",
  RETEST_FOLLOW_UP: "来自专项复测补强",
  ANALYTICS_RISK: "来自趋势风险",
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
  const snapshot = asRecord(item.originSnapshot);
  const summary = getOriginSummary(item.originType, snapshot);
  if (!summary) return null;

  return (
    <section className="border-y border-white/10 py-4">
      <p className="text-sm font-medium text-white">{summary.title}</p>
      <p className="mt-1 text-sm text-zinc-400">{summary.detail}</p>
      {summary.href ? <Link href={withReturnTo(summary.href, returnTo)} className="mt-3 inline-flex text-sm text-teal-300 hover:underline">{summary.linkLabel}</Link> : null}
    </section>
  );
}

function getOriginSummary(
  originType: string,
  snapshot: Record<string, unknown>,
): { title: string; detail: string; href?: string; linkLabel?: string } | null {
  if (originType === "SIMULATION_LOSS") {
    const examId = stringValue(snapshot.examId);
    const reason = stringValue(snapshot.reason);
    const lostScore = numberValue(snapshot.lostScore);
    return {
      title: "来自模拟考试的补救判断",
      detail: `${lostScore == null ? "已记录失分" : `${lostScore} 分失分`} · ${reason ? (lossReasonLabels[reason] ?? reason) : "未标注原因"}`,
      ...(examId ? { href: `/test/simulations/${encodeURIComponent(examId)}`, linkLabel: "查看来源考试" } : {}),
    };
  }
  if (originType === "PERIODIC_REPORT") {
    const decisionId = stringValue(snapshot.decisionId);
    const range = asRecord(snapshot.range);
    const action = stringValue(snapshot.action) ?? "下周期行动建议";
    return {
      title: "来自已接受的周期判断",
      detail: `${dateLabel(range.start)} 至 ${dateLabel(range.end)} · ${action}`,
      ...(decisionId ? { href: `/roadmap/reviews/history/${encodeURIComponent(decisionId)}`, linkLabel: "查看来源决策" } : {}),
    };
  }
  if (originType === "STAGE_ADJUSTMENT") {
    return {
      title: "来自已应用的阶段调整",
      detail: stringValue(snapshot.action) ?? "阶段调整派生行动",
      href: "/roadmap/stages",
      linkLabel: "查看阶段计划",
    };
  }
  if (originType === "DAILY_REVIEW_MINIMUM") {
    return {
      title: "来自每日复盘的最低行动",
      detail: `${dateLabel(snapshot.reviewDate)} 的复盘已将这项行动安排到投入草稿。`,
      href: "/roadmap/reviews/daily",
      linkLabel: "查看每日复盘",
    };
  }
  if (originType === "LOW_CONVERSION") {
    return {
      title: "来自低转化收口",
      detail: `${dateLabel(snapshot.endedAt)} 的学习记录需要补充一项可复核产出。`,
    };
  }
  if (originType === "RECOVERY_MINIMUM") {
    const stage = numberValue(snapshot.recoveryStage);
    const targetMinutes = numberValue(snapshot.targetMinutes);
    return {
      title: "来自恢复模式的最小行动",
      detail: `第 ${stage ?? 1} 阶段${targetMinutes == null ? "" : ` · 目标 ${targetMinutes} 分钟`}，转换前仍可调整科目与日期。`,
      href: "/today",
      linkLabel: "返回今日行动",
    };
  }
  if (originType === "RETEST_FOLLOW_UP") {
    const retestId = stringValue(snapshot.retestId);
    const pointTitle = stringValue(snapshot.knowledgePointTitle) ?? "薄弱知识点";
    const result = stringValue(snapshot.result);
    const resultLabel = result === "FAILED" ? "未通过" : result === "PARTIAL" ? "部分通过" : "需要补强";
    return {
      title: "来自专项复测的补强判断",
      detail: `${pointTitle} · ${resultLabel} · 建议在下一次复测前完成补强。`,
      ...(retestId ? { href: `/test/retests/${encodeURIComponent(retestId)}`, linkLabel: "查看来源复测" } : {}),
    };
  }
  if (originType === "ANALYTICS_RISK") {
    const range = asRecord(snapshot.range);
    const action = stringValue(snapshot.action) ?? "趋势风险行动";
    return {
      title: "来自学习趋势的风险判断",
      detail: `${dateLabel(range.start)} 至 ${dateLabel(range.end)} · ${action}`,
      href: `/roadmap/stages/trend?window=${numberValue(snapshot.windowDays) === 30 ? "30" : "7"}`,
      linkLabel: "查看来源趋势",
    };
  }
  if (originType === "AI_PLAN") {
    return {
      title: "来自已采纳的 AI 草稿",
      detail: "这是一项待安排的行动候选，转换前不会创建正式任务。",
    };
  }
  return null;
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

function dateLabel(value: unknown): string {
  const text = stringValue(value);
  return text ? text.slice(0, 10) : "日期未知";
}
