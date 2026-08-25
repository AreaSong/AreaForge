import { getStudyDayKey, getStudyDayRange } from "./date";

export function getEffectiveStudyStreak(
  sessions: Array<{ startedAt: Date }>,
  checkInSnapshots: Map<string, { effectiveMinutes: number }>,
  now: Date,
): number {
  const studiedDays = new Set(sessions.map((session) => getStudyDayKey(session.startedAt)));
  let cursor = getStudyDayRange(now).start;
  let streak = 0;

  for (let index = 0; index < 60; index += 1) {
    const key = getStudyDayKey(cursor);
    const snapshot = checkInSnapshots.get(key);
    const studied = snapshot ? snapshot.effectiveMinutes > 0 : studiedDays.has(key);
    if (!studied) return streak;
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return streak;
}
