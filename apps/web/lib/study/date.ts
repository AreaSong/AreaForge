const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

export interface StudyDayRange {
  key: string;
  start: Date;
  end: Date;
}

export function getStudyDayRange(now = new Date()): StudyDayRange {
  const shifted = new Date(now.getTime() + shanghaiOffsetMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();
  const start = new Date(Date.UTC(year, month, date) - shanghaiOffsetMs);
  const end = new Date(start.getTime() + dayMs);

  return {
    key: formatDayKey(year, month + 1, date),
    start,
    end,
  };
}

export function getNextStudyDayStart(now = new Date()): Date {
  return getStudyDayRange(new Date(now.getTime() + dayMs)).start;
}

export function daysUntil(target: Date, now = new Date()): number {
  const range = getStudyDayRange(now);
  return Math.max(0, Math.ceil((target.getTime() - range.start.getTime()) / dayMs));
}

export function getStudyDayKey(value: Date): string {
  return getStudyDayRange(value).key;
}

export function parseStudyDayKey(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || getStudyDayRange(parsed).key !== value) return null;
  return parsed;
}

function formatDayKey(year: number, month: number, date: number): string {
  return [year, month, date].map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0"))).join("-");
}
