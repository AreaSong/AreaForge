import {
  createOpenAiCompatibleJsonProvider,
  createFallbackDailyReviewAdvice,
  createFallbackDisciplineAdvice,
  createFallbackTomorrowPlanAdvice,
  generateAdviceWithProvider,
  AiProviderError,
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
import {
  loadEffectiveAiProviderConfig,
  type EffectiveAiProviderConfig,
} from "./ai-provider-credential-service";
import { getAiRuntimeSettingStatus } from "./ai-runtime-setting-service";
import { getTodayDashboardShared } from "./dashboard-query-service";

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
  maxProviderRetries?: number;
  providerTimeoutMs?: number;
  provider?: AiJsonProvider;
  userId: string;
}

interface AiProviderRateLimitState {
  count: number;
  resetAt: number;
}

const aiProviderRateLimitWindowMs = 10 * 60 * 1000;
const aiProviderRateLimitMaxCalls = 6;
const aiProviderRateLimits = new Map<string, AiProviderRateLimitState>();

export async function getDisciplineAiAdvice(
  options: AiAdviceRequestOptions,
): Promise<SafeAiAdviceEnvelope<DisciplineAdvice>> {
  const dashboard = await getTodayDashboardShared(options.userId);
  const context = {
    phase: dashboard.stage.title,
    riskState: dashboard.snapshot.riskState,
    streakDays: dashboard.metrics.streakDays,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    mainWeakness: dashboard.debtTasks[0]?.subjectName ?? dashboard.tasks[0]?.subjectName,
  };
  const provider = await resolveConfiguredAiProviderForUser("discipline", options);
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
  options: AiAdviceRequestOptions,
): Promise<SafeAiAdviceEnvelope<DailyReviewAdvice>> {
  const dashboard = await getTodayDashboardShared(options.userId);
  const context = {
    totalMinutes: dashboard.metrics.todayMinutes,
    effectiveMinutes: dashboard.metrics.effectiveMinutes,
    taskCompletionRate: dashboard.metrics.taskCompletionRate,
    lowConversionCount: dashboard.signals.lowConversionCount,
    reviewSubmitted: Boolean(dashboard.review),
    moodTag: dashboard.review?.mood,
  };
  const provider = await resolveConfiguredAiProviderForUser("daily_review", options);
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
  options: AiAdviceRequestOptions,
): Promise<SafeAiAdviceEnvelope<TomorrowPlanAdvice>> {
  const [dashboard, analytics] = await Promise.all([
    getTodayDashboardShared(options.userId),
    getAnalyticsSummaryShared(options.userId),
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
  const provider = await resolveConfiguredAiProviderForUser("tomorrow_plan", options);
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

export function createConfiguredAiProvider(
  maxRetries?: number,
  timeoutMs?: number,
): AiJsonProvider | undefined {
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
    timeoutMs: timeoutMs ?? env.AI_TIMEOUT_MS,
    maxRetries: maxRetries ?? env.AI_MAX_RETRIES,
    logPrompts: false,
    allowSensitiveContext: false,
  });
}

export function resolveConfiguredAiProvider(kind: AiAdviceKind, options: AiAdviceRequestOptions): {
  provider?: AiJsonProvider;
  unavailableReason?: string;
} {
  const prerequisites = resolveAiProviderPrerequisites(options);
  if (!prerequisites.available) {
    return { unavailableReason: prerequisites.unavailableReason };
  }

  if (options.provider) {
    return { provider: options.provider };
  }

  const rateLimit = checkAiProviderRateLimit(kind, options.userId ?? "unknown");
  if (!rateLimit.allowed) {
    return {
      unavailableReason: `AI 外呼已触发轻量限流，约 ${rateLimit.retryAfterSeconds} 秒后可重试；当前已回退本地规则建议。`,
    };
  }

  const provider = createConfiguredAiProvider(options.maxProviderRetries, options.providerTimeoutMs);
  if (provider) return { provider };

  return {
    unavailableReason: "AI provider 配置缺失，已回退本地规则建议。",
  };
}

export function resolveAiProviderPrerequisites(options: AiAdviceRequestOptions): {
  available: boolean;
  unavailableReason?: string;
} {
  if (!options.allowExternalProvider) {
    return {
      available: false,
      unavailableReason: "当前浏览器未开启外部 AI Provider，已使用本地规则建议。",
    };
  }

  const env = getAuthEnv();
  if (!env.AI_ENABLED) {
    return {
      available: false,
      unavailableReason: "AI_ENABLED=false：当前仅使用本地规则生成结构化建议，没有调用外部 AI。",
    };
  }

  if (options.provider) {
    return { available: true };
  }

  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    logAiProviderConfigIssue("missing_config");
    return {
      available: false,
      unavailableReason: "AI provider 配置缺失，已回退本地规则建议。",
    };
  }

  if (env.AI_ALLOW_SENSITIVE_CONTEXT) {
    logAiProviderConfigIssue("sensitive_context_disabled");
    return {
      available: false,
      unavailableReason: "AI_ALLOW_SENSITIVE_CONTEXT=true 在第一版被禁用，已回退本地规则建议。",
    };
  }

  return { available: true };
}

function logAiProviderConfigIssue(reason: "missing_config" | "sensitive_context_disabled"): void {
  console.warn("AI provider disabled", {
    reason,
  });
}

export async function resolveConfiguredAiProviderForUser(
  kind: AiAdviceKind,
  options: AiAdviceRequestOptions,
): Promise<{
  provider?: AiJsonProvider;
  unavailableReason?: string;
}> {
  const prerequisites = await resolveAiProviderPrerequisitesForUser(options);
  if (!prerequisites.available) {
    return { unavailableReason: prerequisites.unavailableReason };
  }

  if (options.provider) {
    return { provider: options.provider };
  }

  const rateLimit = checkAiProviderRateLimit(kind, options.userId ?? "unknown");
  if (!rateLimit.allowed) {
    return {
      unavailableReason: `AI 外呼已触发轻量限流，约 ${rateLimit.retryAfterSeconds} 秒后可重试；当前已回退本地规则建议。`,
    };
  }

  const configured = await loadEffectiveAiProviderConfig(options.userId);
  if (!configured.config) {
    return { unavailableReason: configured.unavailableReason ?? "AI provider 配置缺失，已回退本地规则建议。" };
  }

  try {
    return {
      provider: createAiProviderFromConfig(configured.config, options),
    };
  } catch {
    logAiProviderConfigIssue("missing_config");
    return { unavailableReason: "AI provider 配置无效，已回退本地规则建议。" };
  }
}

export async function resolveAiProviderPrerequisitesForUser(options: AiAdviceRequestOptions): Promise<{
  available: boolean;
  unavailableReason?: string;
}> {
  if (!options.allowExternalProvider) {
    return {
      available: false,
      unavailableReason: "当前浏览器未开启外部 AI Provider，已使用本地规则建议。",
    };
  }

  const runtime = await getAiRuntimeSettingStatus();
  if (!runtime.serverEnabled) {
    return {
      available: false,
      unavailableReason: "AI_ENABLED=false：当前仅使用本地规则生成结构化建议，没有调用外部 AI。",
    };
  }

  if (!runtime.webEnabled) {
    return {
      available: false,
      unavailableReason: "Web 全局 AI 开关已关闭：当前仅使用本地规则生成结构化建议，没有调用外部 AI。",
    };
  }

  if (options.provider) {
    return { available: true };
  }

  const configured = await loadEffectiveAiProviderConfig(options.userId);
  if (!configured.config) {
    return {
      available: false,
      unavailableReason: configured.unavailableReason ?? "AI provider 配置缺失，已回退本地规则建议。",
    };
  }

  const env = getAuthEnv();
  if (env.AI_ALLOW_SENSITIVE_CONTEXT) {
    logAiProviderConfigIssue("sensitive_context_disabled");
    return {
      available: false,
      unavailableReason: "AI_ALLOW_SENSITIVE_CONTEXT=true 在第一版被禁用，已回退本地规则建议。",
    };
  }

  return { available: true };
}

export async function testConfiguredAiProviderForUser(
  userId: string,
  allowExternalProvider: boolean,
): Promise<{ success: boolean; externalCall: boolean; reason: string }> {
  const prerequisites = await resolveAiProviderPrerequisitesForUser({
    allowExternalProvider,
    userId,
  });
  if (!prerequisites.available) {
    return {
      success: false,
      externalCall: false,
      reason: prerequisites.unavailableReason ?? "Provider 当前不可用。",
    };
  }

  const resolved = await resolveConfiguredAiProviderForUser("discipline", {
    allowExternalProvider,
    userId,
    maxProviderRetries: 0,
    providerTimeoutMs: Math.min(getAuthEnv().AI_TIMEOUT_MS, 15_000),
  });
  if (!resolved.provider) {
    return {
      success: false,
      externalCall: false,
      reason: resolved.unavailableReason ?? "Provider 当前不可用。",
    };
  }

  try {
    const result = await resolved.provider.generateJson({
      kind: "discipline",
      context: {
        phase: "connection_test",
        riskState: "normal",
        streakDays: 0,
        taskCompletionRate: 0,
        effectiveMinutes: 0,
      },
    });
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return { success: false, externalCall: true, reason: "Provider 返回格式不可用，未保存响应。" };
    }
    return { success: true, externalCall: true, reason: "Provider 连接测试成功，响应未保存。" };
  } catch (error) {
    return { success: false, externalCall: true, reason: providerTestFailureReason(error) };
  }
}

function providerTestFailureReason(error: unknown): string {
  if (!(error instanceof AiProviderError)) return "Provider 连接失败，未保存响应。";

  switch (error.code) {
    case "auth_failed":
      return `Provider 拒绝认证（HTTP ${error.statusCode ?? 401}），请重新填写当前中转站的 API Key。`;
    case "bad_request":
      return "Provider 拒绝请求，请检查 Base URL 和模型名称。";
    case "request_timeout":
      return "Provider 响应超时，请检查中转站负载或网络。";
    case "rate_limited":
      return "Provider 返回限流，请稍后再测试。";
    case "server_error":
      return "Provider 或上游服务返回 5xx，请检查中转站状态。";
    case "invalid_json":
      return "Provider 返回的不是有效 JSON，可能不是兼容的 Chat Completions 接口。";
    case "schema_invalid":
      return "Provider 返回结构不符合当前测试协议，未保存响应。";
    case "network_error":
      return "无法连接 Provider，请检查 Base URL、DNS 和端口。";
    case "missing_config":
      return "Provider 配置不完整，请检查 Base URL、模型和 API Key。";
  }
}

function createAiProviderFromConfig(
  config: EffectiveAiProviderConfig,
  options: AiAdviceRequestOptions,
): AiJsonProvider {
  const env = getAuthEnv();
  return createOpenAiCompatibleJsonProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: options.providerTimeoutMs ?? env.AI_TIMEOUT_MS,
    maxRetries: options.maxProviderRetries ?? env.AI_MAX_RETRIES,
    logPrompts: false,
    allowSensitiveContext: false,
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
