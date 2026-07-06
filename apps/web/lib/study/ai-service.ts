import {
  createFallbackDailyReviewAdvice,
  createFallbackDisciplineAdvice,
  createFallbackTomorrowPlanAdvice,
  generateAdviceWithProvider,
  validateDailyReviewAdvice,
  validateDisciplineAdvice,
  validateTomorrowPlanAdvice,
  type AiAdviceStatus,
  type DailyReviewAdvice,
  type DisciplineAdvice,
  type TomorrowPlanAdvice,
} from "@areaforge/ai";
import { getAnalyticsSummary } from "./analytics-service";
import { getTodayDashboard } from "./service";

export interface SafeAiAdviceEnvelope<TAdvice> {
  advice: TAdvice;
  meta: {
    status: AiAdviceStatus;
    externalCall: boolean;
    sensitiveContextIncluded: boolean;
    sensitiveContextKeys: string[];
    reason: string;
  };
}

export async function getDisciplineAiAdvice(): Promise<SafeAiAdviceEnvelope<DisciplineAdvice>> {
  const dashboard = await getTodayDashboard();
  const context = {
    phase: dashboard.stage.title,
    riskState: dashboard.snapshot.riskState,
    streakDays: dashboard.metrics.streakDays,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    mainWeakness: dashboard.debtTasks[0]?.subjectName ?? dashboard.tasks[0]?.subjectName,
  };
  const result = await generateAdviceWithProvider({
    kind: "discipline",
    context,
    fallback: createFallbackDisciplineAdvice,
    validate: validateDisciplineAdvice,
  });

  return createEnvelope(result);
}

export async function getDailyReviewAiAdvice(): Promise<SafeAiAdviceEnvelope<DailyReviewAdvice>> {
  const dashboard = await getTodayDashboard();
  const context = {
    totalMinutes: dashboard.metrics.todayMinutes,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    lowConversionCount: dashboard.signals.lowConversionCount,
    reviewSubmitted: Boolean(dashboard.review),
    moodTag: dashboard.review?.mood,
  };
  const result = await generateAdviceWithProvider({
    kind: "daily_review",
    context,
    fallback: createFallbackDailyReviewAdvice,
    validate: validateDailyReviewAdvice,
  });

  return createEnvelope(result);
}

export async function getTomorrowPlanAiAdvice(): Promise<SafeAiAdviceEnvelope<TomorrowPlanAdvice>> {
  const [dashboard, analytics] = await Promise.all([
    getTodayDashboard(),
    getAnalyticsSummary(),
  ]);
  const weakestSubject = analytics.subjects
    .filter((subject) => subject.effectiveMinutes === 0)
    .map((subject) => subject.subjectName)[0];
  const context = {
    riskState: dashboard.snapshot.riskState,
    recoveryActive: dashboard.recovery.active,
    debtCount: dashboard.metrics.debtCount,
    topTaskTitle: dashboard.snapshot.topTasks[0]?.title ?? dashboard.debtTasks[0]?.title,
    weakSubject: weakestSubject,
  };
  const result = await generateAdviceWithProvider({
    kind: "tomorrow_plan",
    context,
    fallback: createFallbackTomorrowPlanAdvice,
    validate: validateTomorrowPlanAdvice,
  });

  return createEnvelope(result);
}

function createEnvelope<TAdvice>(
  result: {
    advice: TAdvice;
    meta: {
      status: AiAdviceStatus;
      externalCall: boolean;
      sensitiveContextIncluded: boolean;
      sensitiveContextKeys: string[];
      reason: string;
    };
  },
): SafeAiAdviceEnvelope<TAdvice> {
  return {
    advice: result.advice,
    meta: {
      status: result.meta.status,
      externalCall: result.meta.externalCall,
      sensitiveContextIncluded: result.meta.sensitiveContextIncluded,
      sensitiveContextKeys: result.meta.sensitiveContextKeys,
      reason: result.meta.reason,
    },
  };
}
