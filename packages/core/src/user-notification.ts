export const USER_NOTIFICATION_KINDS = [
  "RANKING_INVITATION",
  "RANKING_CHALLENGE_STATUS",
  "RANKING_APPEAL_SUBMITTED",
  "RANKING_APPEAL_STATUS",
  "RANKING_APPEAL_WITHDRAWN",
  "RANKING_OWNERSHIP_TRANSFERRED",
  "RANKING_PARTICIPANT_REMOVED",
  "RANKING_PARTICIPANT_STATUS",
] as const;

export type UserNotificationKind = (typeof USER_NOTIFICATION_KINDS)[number];
export type UserNotificationAction = "read" | "unread" | "dismiss" | "restore";

export interface UserNotificationState {
  revision: number;
  readAt: string | null;
  dismissedAt: string | null;
}

export interface UserNotificationContent {
  title: string;
  body: string;
  actionLabel: string;
  route: "/settings/data";
}

export class UserNotificationPolicyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "UserNotificationPolicyError";
  }
}

const notificationContent: Record<UserNotificationKind, Omit<UserNotificationContent, "route">> = {
  RANKING_INVITATION: {
    title: "私有挑战邀请",
    body: "你收到了一项私有挑战邀请，接受前不会进入排名。",
    actionLabel: "查看邀请",
  },
  RANKING_CHALLENGE_STATUS: {
    title: "挑战状态更新",
    body: "你参与的私有挑战状态已更新。",
    actionLabel: "查看挑战",
  },
  RANKING_APPEAL_SUBMITTED: {
    title: "新的排名申诉",
    body: "有成员提交了排名申诉，处理前不会改写学习记录。",
    actionLabel: "处理申诉",
  },
  RANKING_APPEAL_STATUS: {
    title: "申诉状态更新",
    body: "你的排名申诉状态已更新。",
    actionLabel: "查看申诉",
  },
  RANKING_APPEAL_WITHDRAWN: {
    title: "排名申诉已撤回",
    body: "有成员撤回了排名申诉，无需继续处理。",
    actionLabel: "查看申诉",
  },
  RANKING_OWNERSHIP_TRANSFERRED: {
    title: "挑战所有权已转移",
    body: "一项私有挑战的管理责任已转移给你。",
    actionLabel: "查看挑战",
  },
  RANKING_PARTICIPANT_REMOVED: {
    title: "挑战参与状态更新",
    body: "你已不再参与一项私有挑战，相关排名投影已清理。",
    actionLabel: "查看记录",
  },
  RANKING_PARTICIPANT_STATUS: {
    title: "挑战成员状态更新",
    body: "一项私有挑战的成员参与状态已更新。",
    actionLabel: "查看成员",
  },
};

export function buildUserNotificationContent(kind: UserNotificationKind): UserNotificationContent {
  const content = notificationContent[kind];
  if (!content) throw new UserNotificationPolicyError("USER_NOTIFICATION_KIND_INVALID");
  return { ...content, route: "/settings/data" };
}

export function transitionUserNotification(input: {
  state: UserNotificationState;
  action: UserNotificationAction;
  expectedRevision: number;
  now: string;
}): UserNotificationState {
  validateState(input.state);
  if (input.expectedRevision !== input.state.revision) {
    throw new UserNotificationPolicyError("USER_NOTIFICATION_REVISION_CONFLICT");
  }
  const now = new Date(input.now);
  if (!Number.isFinite(now.getTime())) throw new UserNotificationPolicyError("USER_NOTIFICATION_TIME_INVALID");
  const timestamp = now.toISOString();
  const state = input.state;
  if (input.action === "read") {
    if (state.dismissedAt || state.readAt) throw new UserNotificationPolicyError("USER_NOTIFICATION_ACTION_INVALID");
    return { revision: state.revision + 1, readAt: timestamp, dismissedAt: null };
  }
  if (input.action === "unread") {
    if (state.dismissedAt || !state.readAt) throw new UserNotificationPolicyError("USER_NOTIFICATION_ACTION_INVALID");
    return { revision: state.revision + 1, readAt: null, dismissedAt: null };
  }
  if (input.action === "dismiss") {
    if (state.dismissedAt) throw new UserNotificationPolicyError("USER_NOTIFICATION_ACTION_INVALID");
    return { revision: state.revision + 1, readAt: state.readAt ?? timestamp, dismissedAt: timestamp };
  }
  if (input.action === "restore") {
    if (!state.dismissedAt) throw new UserNotificationPolicyError("USER_NOTIFICATION_ACTION_INVALID");
    return { revision: state.revision + 1, readAt: state.readAt, dismissedAt: null };
  }
  throw new UserNotificationPolicyError("USER_NOTIFICATION_ACTION_INVALID");
}

function validateState(state: UserNotificationState): void {
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) {
    throw new UserNotificationPolicyError("USER_NOTIFICATION_STATE_INVALID");
  }
  const readAt = parseOptionalTime(state.readAt);
  const dismissedAt = parseOptionalTime(state.dismissedAt);
  if (state.dismissedAt && !state.readAt) throw new UserNotificationPolicyError("USER_NOTIFICATION_STATE_INVALID");
  if (readAt && dismissedAt && dismissedAt < readAt) throw new UserNotificationPolicyError("USER_NOTIFICATION_STATE_INVALID");
}

function parseOptionalTime(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new UserNotificationPolicyError("USER_NOTIFICATION_STATE_INVALID");
  return time;
}
