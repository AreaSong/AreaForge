import { getBrowserStoragePort } from "@/lib/client/storage-port";

export interface MotivationReminderPreference {
  enabled: boolean;
  windowStart: number;
  windowEnd: number;
}

export const DEFAULT_MOTIVATION_REMINDER_PREFERENCE: MotivationReminderPreference = {
  enabled: false,
  windowStart: 9,
  windowEnd: 22,
};

export const MOTIVATION_REMINDER_PREFERENCE_EVENT = "areaforge:motivation-reminder-preference";

export function motivationReminderPreferenceKey(userId: string): string {
  return `af.motivation.reminder.preference.v1.${userId}`;
}

export function readMotivationReminderPreference(userId: string): MotivationReminderPreference {
  if (typeof window === "undefined") return DEFAULT_MOTIVATION_REMINDER_PREFERENCE;
  try {
    const parsed = JSON.parse(getBrowserStoragePort("local")?.getItem(motivationReminderPreferenceKey(userId)) ?? "null") as unknown;
    return isMotivationReminderPreference(parsed) ? parsed : DEFAULT_MOTIVATION_REMINDER_PREFERENCE;
  } catch {
    return DEFAULT_MOTIVATION_REMINDER_PREFERENCE;
  }
}

export function writeMotivationReminderPreference(userId: string, value: MotivationReminderPreference): void {
  if (!isMotivationReminderPreference(value)) return;
  getBrowserStoragePort("local")?.setItem(motivationReminderPreferenceKey(userId), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(MOTIVATION_REMINDER_PREFERENCE_EVENT, { detail: { userId } }));
}

function isMotivationReminderPreference(value: unknown): value is MotivationReminderPreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MotivationReminderPreference>;
  return typeof candidate.enabled === "boolean"
    && isHour(candidate.windowStart)
    && isHour(candidate.windowEnd);
}

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}
