export const SESSION_START_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const SESSION_START_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type StudySessionStartTimeError = "future" | "too_old";

/**
 * 允许离线设备在恢复联网后补传，但拒绝明显错误的设备时钟污染学习日统计。
 */
export function getStudySessionStartTimeError(
  startedAt: Date,
  now = new Date(),
): StudySessionStartTimeError | null {
  const timestamp = startedAt.getTime();
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp)) return "too_old";
  if (timestamp > nowTimestamp + SESSION_START_FUTURE_SKEW_MS) return "future";
  if (timestamp < nowTimestamp - SESSION_START_MAX_AGE_MS) return "too_old";
  return null;
}
