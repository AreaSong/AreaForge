import { z } from "zod";

export const localFallbackStatus = "local_rule_fallback" as const;

export const disciplineAdviceSchema = z.object({
  status: z.literal(localFallbackStatus).default(localFallbackStatus),
  line: z.string().min(1),
  nextAction: z.string().min(1),
  reason: z.string().min(1),
});

export type DisciplineAdvice = z.infer<typeof disciplineAdviceSchema>;

export const dailyReviewAdviceSchema = z.object({
  status: z.literal(localFallbackStatus).default(localFallbackStatus),
  title: z.string().min(1),
  observations: z.array(z.string().min(1)).min(1).max(5),
  nextReviewPrompt: z.string().min(1),
  reason: z.string().min(1),
});

export type DailyReviewAdvice = z.infer<typeof dailyReviewAdviceSchema>;

export const tomorrowPlanAdviceSchema = z.object({
  status: z.literal(localFallbackStatus).default(localFallbackStatus),
  title: z.string().min(1),
  minimumTaskTitle: z.string().min(1),
  estimatedMinutes: z.number().int().min(5).max(240),
  priority: z.enum(["low", "medium", "high", "critical"]),
  reason: z.string().min(1),
  cautions: z.array(z.string().min(1)).max(5),
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
