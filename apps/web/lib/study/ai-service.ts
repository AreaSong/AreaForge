import {
  createOpenAiCompatibleJsonProvider,
  createFallbackDailyReviewAdvice,
  createFallbackDisciplineAdvice,
  createFallbackTomorrowPlanAdvice,
  generateAdviceWithProvider,
  validateDailyReviewAdvice,
  validateDisciplineAdvice,
  validateTomorrowPlanAdvice,
  type AiAdviceKind,
  type AiAdviceStatus,
  type AiJsonProvider,
  type DailyReviewAdvice,
  type DisciplineAdvice,
  type TomorrowPlanAdvice,
} from "@areaforge/ai";
import { getAuthEnv } from "@/lib/auth/env";
import { getAnalyticsSummaryShared } from "./analytics-service";
import { getTodayDashboardShared } from "./service";

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

export interface AiAdviceRequestOptions {
  allowExternalProvider?: boolean;
  provider?: AiJsonProvider;
  userId?: string;
}

interface AiProviderRateLimitState {
  count: number;
  resetAt: number;
}

const aiProviderRateLimitWindowMs = 10 * 60 * 1000;
const aiProviderRateLimitMaxCalls = 6;
const aiProviderRateLimits = new Map<string, AiProviderRateLimitState>();

export async function getDisciplineAiAdvice(
  options: AiAdviceRequestOptions = {},
): Promise<SafeAiAdviceEnvelope<DisciplineAdvice>> {
  const dashboard = await getTodayDashboardShared();
  const context = {
    phase: dashboard.stage.title,
    riskState: dashboard.snapshot.riskState,
    streakDays: dashboard.metrics.streakDays,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    mainWeakness: dashboard.debtTasks[0]?.subjectName ?? dashboard.tasks[0]?.subjectName,
  };
  const provider = resolveConfiguredAiProvider("discipline", options);
  const result = await generateAdviceWithProvider({
    kind: "discipline",
    context,
    provider: provider.provider,
    providerUnavailableReason: provider.unavailableReason,
    fallback: createFallbackDisciplineAdvice,
    validate: validateDisciplineAdvice,
  });

  return createEnvelope(result);
}

export async function getDailyReviewAiAdvice(
  options: AiAdviceRequestOptions = {},
): Promise<SafeAiAdviceEnvelope<DailyReviewAdvice>> {
  const dashboard = await getTodayDashboardShared();
  const context = {
    totalMinutes: dashboard.metrics.todayMinutes,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    lowConversionCount: dashboard.signals.lowConversionCount,
    reviewSubmitted: Boolean(dashboard.review),
    moodTag: dashboard.review?.mood,
  };
  const provider = resolveConfiguredAiProvider("daily_review", options);
  const result = await generateAdviceWithProvider({
    kind: "daily_review",
    context,
    provider: provider.provider,
    providerUnavailableReason: provider.unavailableReason,
    fallback: createFallbackDailyReviewAdvice,
    validate: validateDailyReviewAdvice,
  });

  return createEnvelope(result);
}

export async function getTomorrowPlanAiAdvice(
  options: AiAdviceRequestOptions = {},
): Promise<SafeAiAdviceEnvelope<TomorrowPlanAdvice>> {
  const [dashboard, analytics] = await Promise.all([
    getTodayDashboardShared(),
    getAnalyticsSummaryShared(),
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
  const provider = resolveConfiguredAiProvider("tomorrow_plan", options);
  const result = await generateAdviceWithProvider({
    kind: "tomorrow_plan",
    context,
    provider: provider.provider,
    providerUnavailableReason: provider.unavailableReason,
    fallback: createFallbackTomorrowPlanAdvice,
    validate: validateTomorrowPlanAdvice,
  });

  return createEnvelope(result);
}

export function createConfiguredAiProvider(): AiJsonProvider | undefined {
  const env = getAuthEnv();

  if (!env.AI_ENABLED) return undefined;

  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    logAiProviderConfigIssue("missing_config");
    return undefined;
  }

  if (env.AI_ALLOW_SENSITIVE_CONTEXT) {
    logAiProviderConfigIssue("sensitive_context_disabled");
    return undefined;
  }

  return createOpenAiCompatibleJsonProvider({
    baseUrl: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    logPrompts: false,
    allowSensitiveContext: false,
  });
}

export function resolveConfiguredAiProvider(kind: AiAdviceKind, options: AiAdviceRequestOptions): {
  provider?: AiJsonProvider;
  unavailableReason?: string;
} {
  if (options.provider) {
    return { provider: options.provider };
  }

  if (!options.allowExternalProvider) {
    return {
      unavailableReason: "首页普通打开仅展示本地规则建议，没有调用外部 AI。",
    };
  }

  const env = getAuthEnv();
  if (!env.AI_ENABLED) {
    return {
      unavailableReason: "AI_ENABLED=false：当前仅使用本地规则生成结构化建议，没有调用外部 AI。",
    };
  }

  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    logAiProviderConfigIssue("missing_config");
    return {
      unavailableReason: "AI provider 配置缺失，已回退本地规则建议。",
    };
  }

  if (env.AI_ALLOW_SENSITIVE_CONTEXT) {
    logAiProviderConfigIssue("sensitive_context_disabled");
    return {
      unavailableReason: "AI_ALLOW_SENSITIVE_CONTEXT=true 在第一版被禁用，已回退本地规则建议。",
    };
  }

  const rateLimit = checkAiProviderRateLimit(kind, options.userId ?? "unknown");
  if (!rateLimit.allowed) {
    return {
      unavailableReason: `AI 外呼已触发轻量限流，约 ${rateLimit.retryAfterSeconds} 秒后可重试；当前已回退本地规则建议。`,
    };
  }

  const provider = createConfiguredAiProvider();
  if (provider) return { provider };

  return {
    unavailableReason: "AI provider 配置缺失，已回退本地规则建议。",
  };
}

function logAiProviderConfigIssue(reason: "missing_config" | "sensitive_context_disabled"): void {
  console.warn("AI provider disabled", {
    reason,
  });
}

function checkAiProviderRateLimit(
  kind: AiAdviceKind,
  userId: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds?: number } {
  const key = `${userId}:${kind}`;
  const current = aiProviderRateLimits.get(key);

  if (!current || current.resetAt <= now) {
    aiProviderRateLimits.set(key, {
      count: 1,
      resetAt: now + aiProviderRateLimitWindowMs,
    });
    return { allowed: true };
  }

  if (current.count >= aiProviderRateLimitMaxCalls) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
    };
  }

  current.count += 1;
  aiProviderRateLimits.set(key, current);
  return { allowed: true };
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
