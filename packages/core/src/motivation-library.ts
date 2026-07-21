import { canonicalizeHttpsUrl } from "./learning-tree-url";

export const MOTIVATION_ITEM_TYPES = ["QUOTE", "VIDEO_LINK", "VAULT_EXCERPT"] as const;
export type MotivationItemType = (typeof MOTIVATION_ITEM_TYPES)[number];

export const MOTIVATION_REMINDER_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const MOTIVATION_REMINDER_DAILY_MAX = 2;
export const MOTIVATION_RECENT_ITEM_LIMIT = 8;

export const MOTIVATION_RECOVERY_ACTIONS = ["CONTINUE", "START_5_MIN", "MINIMUM_TASK"] as const;
export type MotivationRecoveryAction = (typeof MOTIVATION_RECOVERY_ACTIONS)[number];

export function isMotivationItemType(value: string): value is MotivationItemType {
  return (MOTIVATION_ITEM_TYPES as readonly string[]).includes(value);
}

export function validateMotivationItemPayload(input: {
  type: MotivationItemType;
  body?: string | null;
  externalUrl?: string | null;
  vaultSourceId?: string | null;
}): { ok: true } | { ok: false; reason: "payload_mismatch" | "invalid_https_url" } {
  const body = input.body?.trim() || null;
  const externalUrl = input.externalUrl?.trim() || null;
  const vaultSourceId = input.vaultSourceId?.trim() || null;

  switch (input.type) {
    case "QUOTE":
      if (!body || externalUrl || vaultSourceId) return { ok: false, reason: "payload_mismatch" };
      return { ok: true };
    case "VIDEO_LINK":
      if (!externalUrl || vaultSourceId || body) return { ok: false, reason: "payload_mismatch" };
      if (!isHttpsUrl(externalUrl)) return { ok: false, reason: "invalid_https_url" };
      return { ok: true };
    case "VAULT_EXCERPT":
      if (!body || !vaultSourceId || externalUrl) return { ok: false, reason: "payload_mismatch" };
      return { ok: true };
  }
}

export function isHttpsUrl(value: string): boolean {
  return canonicalizeHttpsUrl(value).ok;
}

export function canAutoShowMotivationReminder(input: {
  now: Date;
  learningDay: Date;
  lastAutoShowAt: Date | null;
  dailyCount: number;
  currentLearningDay: Date;
}): { allowed: true } | { allowed: false; reason: "interval" | "daily_cap" } {
  if (input.dailyCount >= MOTIVATION_REMINDER_DAILY_MAX) {
    const sameDay = input.learningDay.getTime() === input.currentLearningDay.getTime();
    if (sameDay) return { allowed: false, reason: "daily_cap" };
  }
  if (input.lastAutoShowAt) {
    const elapsed = input.now.getTime() - input.lastAutoShowAt.getTime();
    if (elapsed < MOTIVATION_REMINDER_INTERVAL_MS) {
      return { allowed: false, reason: "interval" };
    }
  }
  return { allowed: true };
}

export function nextReminderStateAfterShow(input: {
  now: Date;
  currentLearningDay: Date;
  previousLearningDay: Date | null;
  previousDailyCount: number;
  previousRecentItemIds: string[];
  shownItemId: string;
}): {
  lastAutoShowAt: Date;
  learningDay: Date;
  dailyCount: number;
  recentItemIds: string[];
} {
  const sameDay =
    input.previousLearningDay != null &&
    input.previousLearningDay.getTime() === input.currentLearningDay.getTime();
  const dailyCount = sameDay ? input.previousDailyCount + 1 : 1;
  const recentItemIds = [input.shownItemId, ...input.previousRecentItemIds.filter((id) => id !== input.shownItemId)].slice(
    0,
    MOTIVATION_RECENT_ITEM_LIMIT,
  );
  return {
    lastAutoShowAt: input.now,
    learningDay: input.currentLearningDay,
    dailyCount,
    recentItemIds,
  };
}

export function pickMotivationItemId(input: {
  enabledItemIds: string[];
  recentItemIds: string[];
}): string | null {
  if (input.enabledItemIds.length === 0) return null;
  const fresh = input.enabledItemIds.filter((id) => !input.recentItemIds.includes(id));
  const pool = fresh.length > 0 ? fresh : input.enabledItemIds;
  return pool[0] ?? null;
}
