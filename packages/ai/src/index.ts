import { z } from "zod";

export const localFallbackStatus = "local_rule_fallback" as const;
export const aiGeneratedStatus = "ai_generated" as const;
export const aiInvalidFallbackStatus = "ai_invalid_fallback" as const;
export const aiErrorFallbackStatus = "ai_error_fallback" as const;

export const aiAdviceStatusSchema = z.enum([
  localFallbackStatus,
  aiGeneratedStatus,
  aiInvalidFallbackStatus,
  aiErrorFallbackStatus,
]);

export type AiAdviceStatus = z.infer<typeof aiAdviceStatusSchema>;

export type AiAdviceKind = "discipline" | "daily_review" | "tomorrow_plan";

export const disciplineAdviceSchema = z.object({
  status: aiAdviceStatusSchema.default(localFallbackStatus),
  line: z.string().min(1).max(500),
  nextAction: z.string().min(1).max(500),
  reason: z.string().min(1).max(800),
});

export type DisciplineAdvice = z.infer<typeof disciplineAdviceSchema>;

export const dailyReviewAdviceSchema = z.object({
  status: aiAdviceStatusSchema.default(localFallbackStatus),
  title: z.string().min(1).max(120),
  observations: z.array(z.string().min(1).max(300)).min(1).max(5),
  nextReviewPrompt: z.string().min(1).max(500),
  reason: z.string().min(1).max(800),
});

export type DailyReviewAdvice = z.infer<typeof dailyReviewAdviceSchema>;

export const tomorrowPlanAdviceSchema = z.object({
  status: aiAdviceStatusSchema.default(localFallbackStatus),
  title: z.string().min(1).max(120),
  minimumTaskTitle: z.string().min(1).max(160),
  estimatedMinutes: z.number().int().min(5).max(240),
  priority: z.enum(["low", "medium", "high", "critical"]),
  reason: z.string().min(1).max(800),
  cautions: z.array(z.string().min(1).max(240)).max(5),
});

export type TomorrowPlanAdvice = z.infer<typeof tomorrowPlanAdviceSchema>;

export interface DisciplineContext {
  phase: string;
  riskState: string;
  streakDays: number;
  taskCompletionRate: number;
  effectiveMinutes: number;
  mainWeakness?: string;
}

export interface DailyReviewContext {
  totalMinutes: number;
  effectiveMinutes: number;
  taskCompletionRate: number;
  lowConversionCount: number;
  reviewSubmitted: boolean;
  moodTag?: string | null;
}

export interface TomorrowPlanContext {
  riskState: string;
  recoveryActive: boolean;
  debtCount: number;
  topTaskTitle?: string;
  weakSubject?: string;
}

export interface AiJsonProviderRequest<TContext> {
  kind: AiAdviceKind;
  context: TContext;
}

export interface AiJsonProvider {
  externalCall: boolean;
  generateJson<TContext>(request: AiJsonProviderRequest<TContext>): Promise<unknown>;
}

export interface GenerateAdviceInput<TContext, TAdvice extends { status: AiAdviceStatus }> {
  kind: AiAdviceKind;
  context: TContext;
  provider?: AiJsonProvider;
  fallback: (context: TContext) => TAdvice;
  validate: (value: unknown) => TAdvice;
}

export interface GenerateAdviceResult<TAdvice> {
  advice: TAdvice;
  meta: {
    status: AiAdviceStatus;
    externalCall: boolean;
    sensitiveContextIncluded: boolean;
    sensitiveContextKeys: string[];
    reason: string;
  };
}

export function createFallbackDisciplineAdvice(context: DisciplineContext): DisciplineAdvice {
  if (context.riskState === "danger" || context.riskState === "lost") {
    return {
      status: localFallbackStatus,
      line: "计划已经开始报警，今天不需要证明自己多强，只需要重新动起来。",
      nextAction: "立刻完成 30 分钟最小恢复任务，结束后写 3 句话总结。",
      reason: "AI disabled，本地规则根据风险状态和连续性生成鞭策。",
    };
  }

  if (context.streakDays >= 7) {
    return {
      status: localFallbackStatus,
      line: `连续 ${context.streakDays} 天在场，稳定很好，但不要用稳定掩盖短板。`,
      nextAction: context.mainWeakness ? `给「${context.mainWeakness}」补 30 分钟。` : "给最薄弱科目补 30 分钟。",
      reason: "AI disabled，本地规则根据连续打卡和短板信号生成鞭策。",
    };
  }

  return {
    status: localFallbackStatus,
    line: "今天先别和情绪谈判，学习结果只认动作。",
    nextAction: "选择一个任务，开始一次 45 分钟专注计时。",
    reason: "AI disabled，本地规则根据今日指标生成鞭策。",
  };
}

export function createFallbackDailyReviewAdvice(context: DailyReviewContext): DailyReviewAdvice {
  const observations: string[] = [];

  if (context.effectiveMinutes <= 0) {
    observations.push("今天还没有有效学习记录，复盘重点先回到最小行动。");
  } else {
    observations.push(`今天有效学习 ${context.effectiveMinutes} 分钟，先确认哪些动作真的产生了转化。`);
  }

  if (context.taskCompletionRate < 0.5) {
    observations.push("任务完成率偏低，明天要缩小任务数量。");
  }

  if (context.lowConversionCount > 0) {
    observations.push(`有 ${context.lowConversionCount} 段低转化学习，复盘必须补一个可检查产出。`);
  }

  if (!context.reviewSubmitted) {
    observations.push("今日复盘还未提交，先写清失控点和一个保留动作。");
  }

  if (context.moodTag) {
    observations.push(`情绪标签已记录为「${context.moodTag}」，这里只使用标签，不读取完整情绪正文。`);
  }

  return {
    status: localFallbackStatus,
    title: "本地规则复盘建议",
    observations: [...new Set(observations)].slice(0, 5),
    nextReviewPrompt: "用 3 句话写清：今天推进了什么、哪里失控、明天最小动作是什么。",
    reason: "AI disabled，没有发送完整复盘正文、动机档案或情绪正文。",
  };
}

export function createFallbackTomorrowPlanAdvice(context: TomorrowPlanContext): TomorrowPlanAdvice {
  if (context.recoveryActive || context.riskState === "danger" || context.riskState === "lost") {
    return {
      status: localFallbackStatus,
      title: "明日恢复任务草稿",
      minimumTaskTitle: context.topTaskTitle ? `恢复推进：${context.topTaskTitle}` : "恢复推进：30 分钟有效学习",
      estimatedMinutes: 30,
      priority: "critical",
      reason: "当前处于恢复或高风险状态，明日任务只保留最小可执行动作。",
      cautions: ["不要试图补完所有欠账。", "结束后必须留下 3 句话产出。"],
    };
  }

  if (context.debtCount > 0) {
    return {
      status: localFallbackStatus,
      title: "明日欠账压制草稿",
      minimumTaskTitle: context.topTaskTitle ? `补做：${context.topTaskTitle}` : "补做最影响阶段推进的一项欠账",
      estimatedMinutes: 45,
      priority: "high",
      reason: "当前存在任务欠账，明日先压最影响阶段推进的一项。",
      cautions: ["只选 1 项欠账。", "完成后再决定是否加任务。"],
    };
  }

  return {
    status: localFallbackStatus,
    title: "明日稳态推进草稿",
    minimumTaskTitle: context.weakSubject ? `${context.weakSubject}：固定 45 分钟推进` : "固定 45 分钟推进一个核心任务",
    estimatedMinutes: 45,
    priority: "medium",
    reason: "当前没有触发恢复模式，明日保持稳态推进并压一个短板。",
    cautions: ["不要把计划扩成清单表演。"],
  };
}

export function validateDisciplineAdvice(value: unknown): DisciplineAdvice {
  return disciplineAdviceSchema.parse(value);
}

export function validateDailyReviewAdvice(value: unknown): DailyReviewAdvice {
  return dailyReviewAdviceSchema.parse(value);
}

export function validateTomorrowPlanAdvice(value: unknown): TomorrowPlanAdvice {
  return tomorrowPlanAdviceSchema.parse(value);
}

export async function generateAdviceWithProvider<TContext, TAdvice extends { status: AiAdviceStatus }>(
  input: GenerateAdviceInput<TContext, TAdvice>,
): Promise<GenerateAdviceResult<TAdvice>> {
  const sensitiveContextKeys = findSensitiveContextKeys(input.context);

  if (sensitiveContextKeys.length > 0) {
    return createFallbackResult({
      advice: input.fallback(input.context),
      status: aiErrorFallbackStatus,
      externalCall: false,
      sensitiveContextKeys,
      reason: `AI 上下文包含敏感字段，已拦截外部生成：${sensitiveContextKeys.join(", ")}`,
    });
  }

  if (!input.provider) {
    return createFallbackResult({
      advice: input.fallback(input.context),
      status: localFallbackStatus,
      externalCall: false,
      sensitiveContextKeys,
      reason: "AI disabled：当前仅使用本地规则生成结构化建议，没有调用外部 AI。",
    });
  }

  try {
    const generated = await input.provider.generateJson({
      kind: input.kind,
      context: input.context,
    });
    const advice = input.validate(withAdviceStatus(generated, aiGeneratedStatus));

    return {
      advice,
      meta: {
        status: aiGeneratedStatus,
        externalCall: input.provider.externalCall,
        sensitiveContextIncluded: false,
        sensitiveContextKeys,
        reason: input.provider.externalCall
          ? "AI provider 返回结构化建议，输出已通过 schema 校验。"
          : "Mock AI provider 返回结构化建议，输出已通过 schema 校验。",
      },
    };
  } catch {
    return createFallbackResult({
      advice: input.fallback(input.context),
      status: aiInvalidFallbackStatus,
      externalCall: input.provider.externalCall,
      sensitiveContextKeys,
      reason: "AI provider 输出无效、超时或报错，已回退本地规则建议。",
    });
  }
}

export function createStaticJsonProvider(value: unknown): AiJsonProvider {
  return {
    externalCall: false,
    async generateJson() {
      return value;
    },
  };
}

export function createThrowingJsonProvider(): AiJsonProvider {
  return {
    externalCall: false,
    async generateJson() {
      throw new Error("AI_PROVIDER_ERROR");
    },
  };
}

export function findSensitiveContextKeys(value: unknown): string[] {
  return Array.from(new Set(findSensitiveContextKeysInternal(value))).sort();
}

function createFallbackResult<TAdvice extends { status: AiAdviceStatus }>(input: {
  advice: TAdvice;
  status: AiAdviceStatus;
  externalCall: boolean;
  sensitiveContextKeys: string[];
  reason: string;
}): GenerateAdviceResult<TAdvice> {
  return {
    advice: setAdviceStatus(input.advice, input.status),
    meta: {
      status: input.status,
      externalCall: input.externalCall,
      sensitiveContextIncluded: input.sensitiveContextKeys.length > 0,
      sensitiveContextKeys: input.sensitiveContextKeys,
      reason: input.reason,
    },
  };
}

function setAdviceStatus<TAdvice extends { status: AiAdviceStatus }>(
  advice: TAdvice,
  status: AiAdviceStatus,
): TAdvice {
  return {
    ...advice,
    status,
  };
}

function withAdviceStatus(value: unknown, status: AiAdviceStatus): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return {
    ...value,
    status,
  };
}

function findSensitiveContextKeysInternal(value: unknown, path = "context"): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveContextKeysInternal(item, `${path}[${index}]`));
  }

  return Object.entries(value).flatMap(([key, item]) => {
    const nextPath = `${path}.${key}`;
    const current = isSensitiveContextKey(key) ? [nextPath] : [];
    return [...current, ...findSensitiveContextKeysInternal(item, nextPath)];
  });
}

function isSensitiveContextKey(key: string): boolean {
  const normalized = normalizeContextKey(key);
  const exactSensitiveKeys = [
    "whystarted",
    "neverreturnto",
    "futureself",
    "messagetofuture",
    "firstsimulationdiary",
    "lostcontrol",
    "keepaction",
    "tomorrowminimum",
    "reviews",
    "sessionnote",
    "note",
    "content",
    "file",
    "files",
    "prompt",
    "apikey",
    "authorization",
    "databaseurl",
    "sessiontoken",
    "uploaddir",
    "uploadpath",
  ];
  if (exactSensitiveKeys.includes(normalized)) {
    return true;
  }

  return [
    "summary",
    "reviewtext",
    "reviewbody",
    "reviewcontent",
    "emotiontext",
    "emotionrecord",
    "moodtext",
    "moodrecord",
    "motivationvault",
    "attachment",
    "pdfcontent",
    "imagecontent",
    "filepath",
  ].some((needle) => normalized.includes(needle));
}

function normalizeContextKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
