export const RECOVERY_STAGE_TARGETS_MINUTES = [30, 60, 90] as const;
export const RECOVERY_WINDOW_DAYS = 7;

export type RecoveryV2Status = "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELED";

export function stageTargetMinutes(stage: number): number {
  const idx = Math.min(Math.max(stage, 1), RECOVERY_STAGE_TARGETS_MINUTES.length) - 1;
  return RECOVERY_STAGE_TARGETS_MINUTES[idx];
}

export function computeRecoveryProgressMinutes(input: {
  effectiveSessionMinutes: number;
  confirmedReviewSeconds: number;
}): number {
  return input.effectiveSessionMinutes + Math.floor(input.confirmedReviewSeconds / 60);
}

export function evaluateRecoveryDayProgress(input: {
  currentStage: number;
  status: RecoveryV2Status;
  progressMinutesToday: number;
  windowDayIndex: number;
  alreadyAdvancedToday: boolean;
}): {
  nextStage: number;
  nextStatus: RecoveryV2Status;
  advanced: boolean;
} {
  if (input.status !== "ACTIVE") {
    return { nextStage: input.currentStage, nextStatus: input.status, advanced: false };
  }

  if (input.windowDayIndex >= RECOVERY_WINDOW_DAYS) {
    return { nextStage: input.currentStage, nextStatus: "EXPIRED", advanced: false };
  }

  if (input.alreadyAdvancedToday) {
    return { nextStage: input.currentStage, nextStatus: "ACTIVE", advanced: false };
  }

  const target = stageTargetMinutes(input.currentStage);
  if (input.progressMinutesToday < target) {
    return { nextStage: input.currentStage, nextStatus: "ACTIVE", advanced: false };
  }

  if (input.currentStage >= RECOVERY_STAGE_TARGETS_MINUTES.length) {
    return { nextStage: input.currentStage, nextStatus: "COMPLETED", advanced: true };
  }

  return {
    nextStage: input.currentStage + 1,
    nextStatus: "ACTIVE",
    advanced: true,
  };
}

export function recoveryWindowDayIndex(input: {
  windowStartDate: Date;
  todayStart: Date;
}): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((input.todayStart.getTime() - input.windowStartDate.getTime()) / dayMs);
}
