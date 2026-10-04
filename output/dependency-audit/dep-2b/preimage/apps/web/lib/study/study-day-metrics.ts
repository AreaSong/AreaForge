import { getStudyDayKey, getStudyDayRange } from "./date";

export interface StudyContinuitySummary {
  streakDays: number;
  missedDays: number;
}

export interface ReviewCoverageSummary {
  completionRate: number | null;
  sampleDays: number;
}

interface ReviewCoverageDay {
  studyDate: string;
  totalMinutes: number;
  taskCount: number;
  reviewSubmitted: boolean;
}

export function summarizeStudyContinuity(
  sessions: Array<{ startedAt: Date }>,
  checkInSnapshots: Map<string, { effectiveMinutes: number }>,
  now: Date,
  windowDays = 7,
): StudyContinuitySummary {
  const studiedDays = new Set(sessions.map((session) => getStudyDayKey(session.startedAt)));
  const observedDayKeys = [
    ...studiedDays,
    ...checkInSnapshots.keys(),
  ].sort();
  const firstObservedDayKey = observedDayKeys[0] ?? null;
  const today = getStudyDayRange(now).start;
  const studiedOn = (date: Date) => {
    const key = getStudyDayKey(date);
    const snapshot = checkInSnapshots.get(key);
    return snapshot ? snapshot.effectiveMinutes > 0 : studiedDays.has(key);
  };

  let cursor = studiedOn(today) ? today : shiftDay(today, -1);
  let streakDays = 0;
  for (let index = 0; index < 60 && studiedOn(cursor); index += 1) {
    streakDays += 1;
    cursor = shiftDay(cursor, -1);
  }

  let missedDays = 0;
  if (firstObservedDayKey) {
    for (let index = 1; index <= windowDays; index += 1) {
      const day = shiftDay(today, -index);
      if (getStudyDayKey(day) >= firstObservedDayKey && !studiedOn(day)) missedDays += 1;
    }
  }

  return { streakDays, missedDays };
}

export function summarizeReviewCoverage(
  snapshots: ReviewCoverageDay[],
  now: Date,
): ReviewCoverageSummary {
  const firstObservedIndex = snapshots.findIndex((snapshot) =>
    snapshot.totalMinutes > 0 || snapshot.taskCount > 0 || snapshot.reviewSubmitted
  );
  if (firstObservedIndex < 0) return { completionRate: null, sampleDays: 0 };

  const todayKey = getStudyDayRange(now).key;
  const sample = snapshots.slice(firstObservedIndex).filter((snapshot) =>
    snapshot.studyDate < todayKey || snapshot.reviewSubmitted
  );
  if (sample.length === 0) return { completionRate: null, sampleDays: 0 };

  return {
    completionRate: sample.filter((snapshot) => snapshot.reviewSubmitted).length / sample.length,
    sampleDays: sample.length,
  };
}

export function getEffectiveStudyStreak(
  sessions: Array<{ startedAt: Date }>,
  checkInSnapshots: Map<string, { effectiveMinutes: number }>,
  now: Date,
): number {
  return summarizeStudyContinuity(sessions, checkInSnapshots, now).streakDays;
}

function shiftDay(date: Date, offset: number): Date {
  return new Date(date.getTime() + offset * 24 * 60 * 60 * 1000);
}
