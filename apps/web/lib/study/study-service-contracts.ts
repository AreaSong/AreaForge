import type {
  StudySessionEvidenceTypeDto,
  StudySessionLowReasonDto,
  TaskStatusDto,
} from "@/lib/contracts";

export interface GetTodayDashboardOptions {
  recordRecoveryRule?: boolean;
}

export interface CreateTaskInput {
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  planMilestoneId?: string | null;
  stagePlanIds?: string[];
  knowledgePointIds?: string[];
  sourceResourceId?: string;
  title: string;
  type: string;
  priority: "low" | "medium" | "high" | "critical";
  plannedDate?: string;
  estimatedMinutes: number;
}

export interface UpdateTaskInput {
  expectedStatus: TaskStatusDto;
  expectedUpdatedAt: string;
  subjectId?: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  planMilestoneId?: string | null;
  stagePlanIds?: string[];
  knowledgePointIds?: string[];
  title?: string;
  type?: string;
  priority?: "low" | "medium" | "high" | "critical";
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string | null;
}

export interface EndSessionInput {
  mode?: "prepare" | "complete";
  qualityScore?: number;
  isEffective?: boolean;
  understandingLevel?: string;
  minimalOutput?: string;
  nextAction?: string;
  producedNote: boolean;
  producedMistake: boolean;
  note?: string;
  completeTask: boolean;
  expectedStatus?: "running" | "paused" | "closing";
  expectedUpdatedAt?: string;
  idempotencyKey?: string;
  lowReasons?: StudySessionLowReasonDto[];
  focusLevel?: number;
  energyLevel?: number;
  nextDisposition?: string;
}

export interface SessionCommandInput {
  expectedStatus: "running" | "paused" | "closing";
  expectedUpdatedAt: string;
  idempotencyKey: string;
}

export interface UpdateSessionContextInput {
  taskId?: string | null;
  syllabusNodeId?: string | null;
  knowledgePointIds?: string[];
  expectedStatus: "running" | "paused" | "closing";
  expectedUpdatedAt: string;
  idempotencyKey: string;
}

export interface StudySessionHeartbeatInput {
  clientDeviceId?: string;
  clientDeviceLabel?: string;
}

export interface LinkSessionEvidenceInput {
  idempotencyKey: string;
  expectedCloseoutVersion: number;
  evidenceType: StudySessionEvidenceTypeDto;
  evidenceId: string;
}

export interface RecoverTaskInput {
  plannedDate?: string;
  reviewText?: string;
}

export interface SplitTaskInput {
  title: string;
  plannedDate?: string;
  estimatedMinutes: number;
  reviewText?: string;
}

export interface ConvertTaskToReviewInput {
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string;
}

export interface StartManualRecoveryStateInput {
  reason?: string;
  targetMinutes?: number;
  visibleTaskLimit?: number;
}

export interface FinishRecoveryStateInput {
  exitCondition?: string;
}

export interface ReviewContentInput {
  summary: string;
  lostControl?: string;
  keepAction: string;
  tomorrowMinimum: string;
  mood?: string;
}

export interface SaveTodayReviewInput extends ReviewContentInput {
  idempotencyKey?: string;
}

export interface SaveReviewInput extends ReviewContentInput {
  idempotencyKey: string;
}

export interface UpdateReviewInput extends SaveReviewInput {
  expectedRevision: number;
}

export interface SaveMotivationVaultInput {
  idempotencyKey: string;
  expectedUpdatedAt: string | null;
  whyStarted?: string;
  neverReturnTo?: string;
  futureSelf?: string;
  messageToFuture?: string;
  firstSimulationDiary?: string;
}
