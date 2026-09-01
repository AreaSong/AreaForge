import type { TaskStatusDto } from "./task";

export type StudySessionStatusDto = "running" | "paused" | "closing" | "completed" | "canceled";
export type StudySessionActivityKindDto = "STUDY" | "REVIEW" | "TEST";
export type StudySessionActivityModeDto = "FREE_STUDY" | "KNOWLEDGE_REVIEW" | "RETEST" | "SIMULATION";
export type StudySessionStartSourceDto =
  | "TASK"
  | "SUBJECT_SHORTCUT"
  | "RECOVERY"
  | "KNOWLEDGE_REVIEW"
  | "KNOWLEDGE_RETEST"
  | "SIMULATION_EXAM";
export type StudySessionEvidenceTypeDto = "note" | "mistake" | "retest";
export type StudySessionLowReasonDto =
  | "NOT_UNDERSTOOD"
  | "DISTRACTED"
  | "MATERIAL_BLOCKED"
  | "FATIGUE"
  | "METHOD_MISMATCH"
  | "TIME_FRAGMENTED"
  | "OTHER";

export interface StudySessionEvidenceReceiptDto {
  evidenceType: StudySessionEvidenceTypeDto;
  evidenceId: string;
  label: string;
}

export interface StudySessionDevicePresenceDto {
  deviceId: string;
  deviceLabel: string;
  lastSeenAt: string;
  isCurrentDevice: boolean;
}

export interface StudySessionKnowledgePointDto {
  id: string;
  title: string;
  masteryState: "UNTOUCHED" | "LEARNING" | "INITIAL_MASTERY" | "STABLE_MASTERY" | "NEEDS_RETEST";
}

export interface StudySessionDto {
  id: string;
  subjectId: string;
  subjectName: string;
  activityKind: StudySessionActivityKindDto;
  activityMode: StudySessionActivityModeDto;
  reviewScheduleId: string | null;
  knowledgeRetestId: string | null;
  simulationExamId: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: TaskStatusDto | null;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  knowledgePoints: StudySessionKnowledgePointDto[];
  status: StudySessionStatusDto;
  startedAt: string;
  updatedAt: string;
  pausedAt: string | null;
  endedAt: string | null;
  accumulatedPauseSeconds: number;
  effectiveMinutes: number;
  qualityScore: number | null;
  isEffective: boolean | null;
  understandingLevel: string | null;
  minimalOutput: string | null;
  nextAction: string | null;
  producedNote: boolean;
  producedMistake: boolean;
  isLowConversion: boolean | null;
  antiFakeReason: string | null;
  requiredOutput: string | null;
  closeoutVersion: number;
  note: string | null;
  goalMinutes: number | null;
  startSource: StudySessionStartSourceDto | null;
  lowReasons: StudySessionLowReasonDto[];
  focusLevel: number | null;
  energyLevel: number | null;
  nextDisposition: string | null;
  clientDeviceId: string | null;
  clientDeviceLabel: string | null;
  lastHeartbeatAt: string | null;
  devicePresences: StudySessionDevicePresenceDto[];
}
