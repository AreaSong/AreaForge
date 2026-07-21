export type AppShellLightTone = "gray" | "blue" | "green" | "amber" | "red";

export type AppShellLightKind = "activity" | "review" | "debt" | "stage" | "todayClosure";

export interface AppShellLightAction {
  label: string;
  href: string;
}

export interface AppShellLight {
  kind: AppShellLightKind;
  tone: AppShellLightTone;
  label: string;
  summary: string;
  action: AppShellLightAction | null;
}

export interface AppShellStatusInput {
  activity: {
    hasActive: boolean;
    isPaused: boolean;
    justCompleted: boolean;
    conflictOrUnknown: boolean;
    continueHref: string;
  };
  review: {
    executableCount: number;
    bridgedCount: number;
    overdueLearningDays: number;
    blocked: boolean;
    inQuickReview: boolean;
    nextHref: string;
  };
  debt: {
    countable: number;
    severe: boolean;
    recoveryBlocked: boolean;
    arrangedComplete: boolean;
    debtHref: string;
  };
  stage: {
    hasStage: boolean;
    inProgress: boolean;
    milestoneHealthy: boolean;
    milestoneNearOrDraftPending: boolean;
    conflictOrBlocked: boolean;
    stageHref: string;
  };
  todayClosure: {
    inReminderWindow: boolean;
    minimumActionDone: boolean;
    dailyReviewDone: boolean;
    minimumActionHref: string;
    reviewHref: string;
  };
}

export interface AppShellStatusProjection {
  lights: AppShellLight[];
  mobileTop: AppShellLight;
}

function activityLight(input: AppShellStatusInput["activity"]): AppShellLight {
  if (input.conflictOrUnknown) {
    return {
      kind: "activity",
      tone: "red",
      label: "活动",
      summary: "活动状态冲突或保存结果未知",
      action: { label: "查看冲突", href: input.continueHref },
    };
  }
  if (input.hasActive && input.isPaused) {
    return {
      kind: "activity",
      tone: "amber",
      label: "活动",
      summary: "活动已暂停，可继续",
      action: { label: "继续活动", href: input.continueHref },
    };
  }
  if (input.hasActive) {
    return {
      kind: "activity",
      tone: "blue",
      label: "活动",
      summary: "专注进行中",
      action: { label: "继续活动", href: input.continueHref },
    };
  }
  if (input.justCompleted) {
    return {
      kind: "activity",
      tone: "green",
      label: "活动",
      summary: "刚完成且结果已保存",
      action: null,
    };
  }
  return {
    kind: "activity",
    tone: "gray",
    label: "活动",
    summary: "无活动",
    action: null,
  };
}

function reviewLight(input: AppShellStatusInput["review"]): AppShellLight {
  const totalDue = input.executableCount + input.bridgedCount;
  if (input.blocked || input.overdueLearningDays >= 3) {
    return {
      kind: "review",
      tone: "red",
      label: "复习",
      summary: input.blocked
        ? "复习被阻塞"
        : `逾期至少 ${input.overdueLearningDays} 个学习日`,
      action: { label: "查看队列", href: input.nextHref },
    };
  }
  if (input.inQuickReview) {
    return {
      kind: "review",
      tone: "blue",
      label: "复习",
      summary: "正在快速复习",
      action: { label: "继续复习", href: input.nextHref },
    };
  }
  if (totalDue > 0 || input.overdueLearningDays > 0) {
    return {
      kind: "review",
      tone: "amber",
      label: "复习",
      summary: `可执行 ${input.executableCount} · 已桥接 ${input.bridgedCount}`,
      action: { label: "开始下一项", href: input.nextHref },
    };
  }
  if (input.executableCount === 0 && input.bridgedCount === 0) {
    return {
      kind: "review",
      tone: "green",
      label: "复习",
      summary: "当前无到期项",
      action: null,
    };
  }
  return {
    kind: "review",
    tone: "gray",
    label: "复习",
    summary: "无正式排期",
    action: null,
  };
}

function debtLight(input: AppShellStatusInput["debt"]): AppShellLight {
  if (input.severe || input.recoveryBlocked) {
    return {
      kind: "debt",
      tone: "red",
      label: "欠账",
      summary: input.recoveryBlocked ? "恢复安排被阻塞" : "严重欠账",
      action: { label: "查看欠账区", href: input.debtHref },
    };
  }
  if (input.countable > 0) {
    return {
      kind: "debt",
      tone: "amber",
      label: "欠账",
      summary: `可处理欠账 ${input.countable} 项`,
      action: { label: "查看欠账区", href: input.debtHref },
    };
  }
  if (input.arrangedComplete) {
    return {
      kind: "debt",
      tone: "green",
      label: "欠账",
      summary: "已完成当前恢复安排",
      action: null,
    };
  }
  return {
    kind: "debt",
    tone: "gray",
    label: "欠账",
    summary: "无欠账",
    action: null,
  };
}

function stageLight(input: AppShellStatusInput["stage"]): AppShellLight {
  if (input.conflictOrBlocked) {
    return {
      kind: "stage",
      tone: "red",
      label: "阶段",
      summary: "阶段计划冲突或关键里程碑阻塞",
      action: { label: "查看阶段建议", href: input.stageHref },
    };
  }
  if (input.milestoneNearOrDraftPending) {
    return {
      kind: "stage",
      tone: "amber",
      label: "阶段",
      summary: "里程碑临近、到期或有待确认草稿",
      action: { label: "查看阶段建议", href: input.stageHref },
    };
  }
  if (input.inProgress) {
    return {
      kind: "stage",
      tone: "blue",
      label: "阶段",
      summary: "阶段进行中",
      action: { label: "查看阶段", href: input.stageHref },
    };
  }
  if (input.hasStage && input.milestoneHealthy) {
    return {
      kind: "stage",
      tone: "green",
      label: "阶段",
      summary: "里程碑健康",
      action: null,
    };
  }
  return {
    kind: "stage",
    tone: "gray",
    label: "阶段",
    summary: "无阶段数据",
    action: null,
  };
}

/**
 * Today closure never uses red — amber is the maximum severity.
 */
function todayClosureLight(input: AppShellStatusInput["todayClosure"]): AppShellLight {
  if (!input.inReminderWindow) {
    return {
      kind: "todayClosure",
      tone: "gray",
      label: "今日闭环",
      summary: "尚未进入提醒窗口",
      action: null,
    };
  }
  if (input.minimumActionDone && input.dailyReviewDone) {
    return {
      kind: "todayClosure",
      tone: "green",
      label: "今日闭环",
      summary: "最低行动和当日复盘均已闭环",
      action: null,
    };
  }
  const needsMinimum = !input.minimumActionDone;
  return {
    kind: "todayClosure",
    tone: "amber",
    label: "今日闭环",
    summary: needsMinimum ? "最低行动尚未完成" : "晚间复盘尚未完成",
    action: {
      label: needsMinimum ? "开始最低行动" : "完成复盘",
      href: needsMinimum ? input.minimumActionHref : input.reviewHref,
    },
  };
}

const TONE_SEVERITY: Record<AppShellLightTone, number> = {
  gray: 0,
  green: 1,
  blue: 2,
  amber: 3,
  red: 4,
};

/**
 * Mobile merges to one status button: active activity first, else highest severity.
 */
export function selectMobileTopLight(lights: AppShellLight[]): AppShellLight {
  const activity = lights.find((light) => light.kind === "activity");
  if (activity && (activity.tone === "blue" || activity.tone === "amber" || activity.tone === "red")) {
    return activity;
  }
  return [...lights].sort((a, b) => TONE_SEVERITY[b.tone] - TONE_SEVERITY[a.tone])[0] ?? lights[0];
}

export function projectAppShellStatus(input: AppShellStatusInput): AppShellStatusProjection {
  const lights: AppShellLight[] = [
    activityLight(input.activity),
    reviewLight(input.review),
    debtLight(input.debt),
    stageLight(input.stage),
    todayClosureLight(input.todayClosure),
  ];
  return {
    lights,
    mobileTop: selectMobileTopLight(lights),
  };
}
