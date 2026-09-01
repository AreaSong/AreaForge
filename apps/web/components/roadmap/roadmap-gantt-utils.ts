import type { PlanMilestoneDto, StagePlanDto } from "@/lib/contracts";

export interface GanttTimeBounds {
  minTime: number;
  maxTime: number;
  totalDurationMs: number;
  nowPositionPercent: number;
  formattedMinDate: string;
  formattedMaxDate: string;
  isNowInRange: boolean;
}

export interface StageGanttSpan {
  stage: StagePlanDto;
  leftPercent: number;
  widthPercent: number;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
  progressPercent: number;
  startDateFormatted: string;
  endDateFormatted: string;
  durationDays: number;
  remainingDays: number;
}

export interface MilestoneGanttPoint {
  milestone: PlanMilestoneDto;
  positionPercent: number;
  isPast: boolean;
  isCompleted: boolean;
  isUrgent: boolean;
  daysUntil: number;
  targetDateFormatted: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseSafeDate(dateInput: string | Date | null | undefined, fallback: number): number {
  if (!dateInput) return fallback;
  const parsed = new Date(dateInput).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDateToMonthDay(timestamp: number): string {
  const date = new Date(timestamp);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${m}/${d}`;
}

export function computeGanttTimeBounds(
  stages: StagePlanDto[],
  milestones: PlanMilestoneDto[],
  nowInput: Date = new Date(),
): GanttTimeBounds {
  const now = nowInput.getTime();
  let min = now - 30 * DAY_MS;
  let max = now + 90 * DAY_MS;

  const validStageTimes: number[] = [];
  for (const s of stages) {
    const start = parseSafeDate(s.startDate, 0);
    const end = parseSafeDate(s.endDate, 0);
    if (start > 0) validStageTimes.push(start);
    if (end > 0) validStageTimes.push(end);
  }

  for (const m of milestones) {
    const target = parseSafeDate(m.targetDate, 0);
    if (target > 0) validStageTimes.push(target);
  }

  if (validStageTimes.length > 0) {
    const earliest = Math.min(...validStageTimes);
    const latest = Math.max(...validStageTimes);
    // Add small padding (e.g. 3 days)
    min = Math.min(earliest - 3 * DAY_MS, now - 3 * DAY_MS);
    max = Math.max(latest + 3 * DAY_MS, now + 7 * DAY_MS);
  }

  const totalDurationMs = Math.max(max - min, DAY_MS);
  const nowClamped = Math.max(min, Math.min(max, now));
  const nowPositionPercent = Math.round(((nowClamped - min) / totalDurationMs) * 1000) / 10;
  const isNowInRange = now >= min && now <= max;

  return {
    minTime: min,
    maxTime: max,
    totalDurationMs,
    nowPositionPercent,
    formattedMinDate: formatDateToMonthDay(min),
    formattedMaxDate: formatDateToMonthDay(max),
    isNowInRange,
  };
}

export function computeStageGanttSpan(
  stage: StagePlanDto,
  bounds: GanttTimeBounds,
  nowInput: Date = new Date(),
): StageGanttSpan {
  const now = nowInput.getTime();
  const start = parseSafeDate(stage.startDate, bounds.minTime);
  const end = parseSafeDate(stage.endDate, bounds.maxTime);

  const left = Math.max(0, Math.min(100, ((start - bounds.minTime) / bounds.totalDurationMs) * 100));
  const right = Math.max(0, Math.min(100, ((end - bounds.minTime) / bounds.totalDurationMs) * 100));
  const width = Math.max(2, right - left);

  const durationDays = Math.max(1, Math.round((end - start) / DAY_MS));
  const remainingDays = Math.round((end - now) / DAY_MS);

  const isCurrent = stage.status === "active" || (now >= start && now <= end && stage.status !== "completed");
  const isPast = stage.status === "completed" || (end < now && stage.status !== "active");
  const isFuture = start > now && stage.status !== "active" && stage.status !== "completed";

  let progressPercent = 0;
  if (isPast) {
    progressPercent = 100;
  } else if (isCurrent && end > start) {
    const elapsed = Math.max(0, now - start);
    progressPercent = Math.min(100, Math.max(5, Math.round((elapsed / (end - start)) * 100)));
  }

  return {
    stage,
    leftPercent: Math.round(left * 10) / 10,
    widthPercent: Math.round(width * 10) / 10,
    isCurrent,
    isPast,
    isFuture,
    progressPercent,
    startDateFormatted: formatDateToMonthDay(start),
    endDateFormatted: formatDateToMonthDay(end),
    durationDays,
    remainingDays,
  };
}

export function computeMilestoneGanttPoint(
  milestone: PlanMilestoneDto,
  bounds: GanttTimeBounds,
  nowInput: Date = new Date(),
): MilestoneGanttPoint {
  const now = nowInput.getTime();
  const target = parseSafeDate(milestone.targetDate, bounds.minTime);

  const pos = Math.max(0, Math.min(100, ((target - bounds.minTime) / bounds.totalDurationMs) * 100));
  const daysUntil = Math.round((target - now) / DAY_MS);
  const isCompleted = milestone.status === "completed";
  const isPast = target < now && !isCompleted;
  const isUrgent = !isCompleted && daysUntil >= 0 && daysUntil <= 7;

  return {
    milestone,
    positionPercent: Math.round(pos * 10) / 10,
    isPast,
    isCompleted,
    isUrgent,
    daysUntil,
    targetDateFormatted: formatDateToMonthDay(target),
  };
}
