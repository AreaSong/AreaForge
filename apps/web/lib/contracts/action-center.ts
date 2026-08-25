import type {
  ActionCenterQueues,
  ActionCenterRecommendation,
  SubjectTimerSummary,
} from "@areaforge/core";
import type { CheckInV2Dto } from "./check-in";
import type { ExamWorkspaceDto } from "./workspace";
import type { RecoveryV2Dto } from "./recovery";
import type { StudySessionDto } from "./study-session";
import type { SyllabusOptionNodeDto } from "./syllabus";

export interface SubjectShortcutTaskOptionDto {
  id: string;
  subjectId: string;
  title: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  disabledReason: string | null;
}

export interface ActionCenterTodayDto {
  studyDate: string;
  isToday: boolean;
  setupRequired: boolean;
  workspace: ExamWorkspaceDto | null;
  recommendation: ActionCenterRecommendation | null;
  queues: ActionCenterQueues;
  queuesEmpty: boolean;
  subjectTimers: SubjectTimerSummary;
  activity: StudySessionDto | null;
  recovery: RecoveryV2Dto | null;
  checkIn: CheckInV2Dto | null;
  shortcutOptions: {
    tasks: SubjectShortcutTaskOptionDto[];
    syllabusNodes: SyllabusOptionNodeDto[];
  };
  statusBar: "setup" | "paused_activity" | "recovery_minimum" | "evening_review" | null;
  primaryActionLabel: string;
  primaryActionHref: string;
  learningLoop: {
    plannedTaskCount: number;
    completedTaskCount: number;
    deferredTaskCount: number;
    effectiveMinutes: number;
    totalMinutes: number;
    effectiveSessionCount: number;
    lowConversionCount: number;
    reviewSubmitted: boolean;
    nextAction: string | null;
  };
}
