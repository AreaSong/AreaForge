import type {
  DashboardSnapshot,
  MotivationWakeSignal,
  StageLevelSummary,
} from "@areaforge/core";
import type { DailyReviewDto } from "./daily-review";
import type { RecoverySourceDto, RecoveryStateStatusDto } from "./recovery";
import type { StudySessionDto } from "./study-session";
import type { SubjectDto } from "./subject";
import type { StudyTaskDto, TaskDebtReorderDto } from "./task";

export interface SyllabusOverviewDto {
  label: string;
  progress: number;
  color: string;
}

export interface TodayDashboardDto {
  studyDay: { key: string; start: string; end: string };
  metrics: {
    daysToSimulation: number | null;
    daysToFinal: number | null;
    todayMinutes: number;
    effectiveMinutes: number;
    taskCompletionRate: number;
    streakDays: number;
    missedDays: number;
    debtCount: number;
  };
  snapshot: DashboardSnapshot;
  stage: StageLevelSummary;
  motivationWake: MotivationWakeSignal;
  checkIn: {
    completedMinimumAction: boolean;
    lowEfficiency: boolean;
    reason: string;
    effectiveSessionCount: number;
    reviewSubmitted: boolean;
  };
  recovery: {
    stateId: string | null;
    source: RecoverySourceDto;
    active: boolean;
    status: RecoveryStateStatusDto | null;
    triggerType: "rule" | "manual" | null;
    minimumMinutes: number;
    targetMinutes: number;
    visibleTaskLimit: number;
    reason: string;
    action: string;
    startedAt: string | null;
    endedAt: string | null;
    exitCondition: string | null;
  };
  subjects: SubjectDto[];
  tasks: StudyTaskDto[];
  debtTasks: StudyTaskDto[];
  debtReorder: TaskDebtReorderDto;
  visibleRecoveryTasks: StudyTaskDto[];
  activeSession: StudySessionDto | null;
  latestCompletedSession: StudySessionDto | null;
  review: DailyReviewDto | null;
  syllabusOverview: SyllabusOverviewDto[];
  signals: {
    antiFake: string;
    lowConversionCount: number;
    review: string;
    ai: string;
  };
}

export interface FocusLauncherSummaryDto {
  todayMinutes: number;
  todaySessionsCount: number;
  streakDays: number;
  subjectWeeklyStats: Record<
    string,
    { weeklyMinutes: number; lastSessionMinutes: number | null; lastSessionAgo: string | null }
  >;
}
