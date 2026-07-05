import { z } from "zod";

export const disciplineAdviceSchema = z.object({
  line: z.string().min(1),
  nextAction: z.string().min(1),
});

export type DisciplineAdvice = z.infer<typeof disciplineAdviceSchema>;

export interface DisciplineContext {
  phase: string;
  riskState: string;
  streakDays: number;
  taskCompletionRate: number;
  effectiveMinutes: number;
  mainWeakness?: string;
}

export function createFallbackDisciplineAdvice(context: DisciplineContext): DisciplineAdvice {
  if (context.riskState === "danger" || context.riskState === "lost") {
    return {
      line: "计划已经开始报警，今天不需要证明自己多强，只需要重新动起来。",
      nextAction: "立刻完成 30 分钟最小恢复任务，结束后写 3 句话总结。",
    };
  }

  if (context.streakDays >= 7) {
    return {
      line: `连续 ${context.streakDays} 天在场，稳定很好，但不要用稳定掩盖短板。`,
      nextAction: context.mainWeakness ? `给「${context.mainWeakness}」补 30 分钟。` : "给最薄弱科目补 30 分钟。",
    };
  }

  return {
    line: "今天先别和情绪谈判，学习结果只认动作。",
    nextAction: "选择一个任务，开始一次 45 分钟专注计时。",
  };
}

export function validateDisciplineAdvice(value: unknown): DisciplineAdvice {
  return disciplineAdviceSchema.parse(value);
}

