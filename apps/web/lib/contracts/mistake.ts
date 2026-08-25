export type MistakeCauseDto =
  | "unknown"
  | "concept_confusion"
  | "formula_unfamiliar"
  | "wrong_approach"
  | "careless"
  | "time_pressure"
  | "unfamiliar_pattern";

export interface MistakeDto {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  title: string;
  questionText: string | null;
  source: string | null;
  cause: MistakeCauseDto;
  causeNote: string | null;
  correctAnswer: string | null;
  correctIdea: string | null;
  nextReviewAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  attempts: MistakeAttemptDto[];
  noteLinks: MistakeNoteLinkDto[];
  resourceLinks: MistakeResourceLinkDto[];
  reviewSchedule: MistakeReviewScheduleDto | null;
  reviewHistory: MistakeReviewEventDto[];
}

export interface MistakeAttemptDto {
  id: string;
  reviewEventId: string | null;
  answerMode: "TEXT" | "PAPER_OR_ORAL";
  answerText: string | null;
  result: "PASSED" | "PARTIAL" | "FAILED";
  durationSeconds: number | null;
  note: string | null;
  attemptedAt: string;
}

export interface MistakeNoteLinkDto {
  id: string;
  noteId: string;
  title: string;
}

export interface MistakeResourceLinkDto {
  id: string;
  resourceId: string;
  title: string;
}

export interface MistakeReviewScheduleDto {
  id: string;
  status: "ACTIVE" | "PAUSED";
  dueDate: string | null;
  pausedReason: string | null;
  consecutivePassCount: number;
  revision: number;
  updatedAt: string;
}

export interface MistakeReviewEventDto {
  id: string;
  reviewScheduleId: string;
  result: "PASSED" | "PARTIAL" | "FAILED";
  durationSeconds: number;
  confirmedAt: string;
  learningDate: string;
  nextDueDate: string;
  consecutivePassDelta: number;
  correctedEventId: string | null;
  note: string | null;
  appliedRevision: number;
}
