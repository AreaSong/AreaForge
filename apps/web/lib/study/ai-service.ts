import {
  createFallbackDailyReviewAdvice,
  createFallbackDisciplineAdvice,
  createFallbackTomorrowPlanAdvice,
  type DailyReviewAdvice,
  type DisciplineAdvice,
  type TomorrowPlanAdvice,
} from "@areaforge/ai";
import { getAnalyticsSummary } from "./analytics-service";
import { getTodayDashboard } from "./service";

export interface SafeAiAdviceEnvelope<TAdvice> {
  advice: TAdvice;
  meta: {
    status: "local_rule_fallback";
    externalCall: false;
    sensitiveContextIncluded: false;
    reason: string;
  };
}

export async function getDisciplineAiAdvice(): Promise<SafeAiAdviceEnvelope<DisciplineAdvice>> {
  const dashboard = await getTodayDashboard();
  const advice = createFallbackDisciplineAdvice({
    phase: dashboard.stage.title,
    riskState: dashboard.snapshot.riskState,
    streakDays: dashboard.metrics.streakDays,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    mainWeakness: dashboard.debtTasks[0]?.subjectName ?? dashboard.tasks[0]?.subjectName,
  });

  return createEnvelope(advice);
}

export async function getDailyReviewAiAdvice(): Promise<SafeAiAdviceEnvelope<DailyReviewAdvice>> {
  const dashboard = await getTodayDashboard();
  const advice = createFallbackDailyReviewAdvice({
    totalMinutes: dashboard.metrics.todayMinutes,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    lowConversionCount: dashboard.signals.lowConversionCount,
    reviewSubmitted: Boolean(dashboard.review),
    moodTag: dashboard.review?.mood,
  });

  return createEnvelope(advice);
}

export async function getTomorrowPlanAiAdvice(): Promise<SafeAiAdviceEnvelope<TomorrowPlanAdvice>> {
  const [dashboard, analytics] = await Promise.all([
    getTodayDashboard(),
    getAnalyticsSummary(),
  ]);
  const weakestSubject = analytics.subjects
    .filter((subject) => subject.effectiveMinutes === 0)
    .map((subject) => subject.subjectName)[0];
  const advice = createFallbackTomorrowPlanAdvice({
    riskState: dashboard.snapshot.riskState,
    recoveryActive: dashboard.recovery.active,
    debtCount: dashboard.metrics.debtCount,
    topTaskTitle: dashboard.snapshot.topTasks[0]?.title ?? dashboard.debtTasks[0]?.title,
    weakSubject: weakestSubject,
  });

  return createEnvelope(advice);
}

function createEnvelope<TAdvice extends { status: "local_rule_fallback" }>(
  advice: TAdvice,
): SafeAiAdviceEnvelope<TAdvice> {
  return {
    advice,
    meta: {
      status: "local_rule_fallback",
      externalCall: false,
      sensitiveContextIncluded: false,
      reason: "AI disabled：当前仅使用本地规则生成结构化建议，没有调用外部 AI。",
    },
  };
}
