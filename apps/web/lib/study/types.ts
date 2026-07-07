import type {
  DashboardSnapshot,
  MasteryProofCondition,
  MasteryProofSummary,
  MotivationWakeSignal,
  StageLevelSummary,
  SyllabusMapSignal,
  SyllabusMapSummary,
  TaskDebtReorderAction,
  TaskDebtReorderPressure,
} from "@areaforge/core";

export type TaskStatusDto = "todo" | "in_progress" | "done" | "skipped" | "deferred";
export type TaskPriorityDto = "low" | "medium" | "high" | "critical";
export type StudySessionStatusDto = "running" | "paused" | "completed" | "canceled";
export type SyllabusNodeKindDto = "subject" | "chapter" | "topic" | "problem_type";
export type SyllabusNodeStatusDto =
  | "not_started"
  | "learning"
  | "covered"
  | "needs_review"
  | "mastered"
  | "weak"
  | "deferred";
export type MasteryLevelDto =
  | "seen"
  | "learned"
  | "basic_exercises"
  | "can_explain"
  | "retest_passed"
  | "exam_stable";
export type NoteMasteryStatusDto = "understood" | "partial" | "unknown" | "relearn" | "before_exam";
export type MistakeCauseDto =
  | "unknown"
  | "concept_confusion"
  | "formula_unfamiliar"
  | "wrong_approach"
  | "careless"
  | "time_pressure"
  | "unfamiliar_pattern";
export type RecoveryStateStatusDto = "active" | "completed" | "canceled";
export type RecoveryTriggerTypeDto = "rule" | "manual";
export type RecoverySourceDto = "state" | "realtime_rule";
export type MasteryEvidenceTypeDto = "task" | "session" | "note" | "mistake" | "retest";
export type MasteryRetestResultDto = "passed" | "failed" | "partial";
export type StagePlanModeDto = "recovery" | "strengthen" | "sprint" | "maintain";
export type StagePlanStatusDto = "draft" | "active" | "completed" | "archived";
export type StageAdjustmentDraftSourceDto = "local_rule" | "ai";
export type StageAdjustmentDraftStatusDto = "draft" | "applied" | "rejected";
export type StageAdjustmentDraftRiskDto = "low" | "medium" | "high" | "critical";
export type StageAdjustmentTaskIntensityDto = "reduce" | "keep" | "increase" | "sprint";
export type StageAdjustmentTaskActionDto =
  | "split"
  | "defer"
  | "drop"
  | "convert_review"
  | "simulate"
  | "retest";

export interface SubjectDto {
  id: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface StudyTaskDto {
  id: string;
  subjectId: string;
  parentTaskId: string | null;
  subjectName: string;
  subjectColor: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  title: string;
  type: string;
  status: TaskStatusDto;
  priority: TaskPriorityDto;
  debtStatus: string;
  plannedDate: string;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
  completedAt: string | null;
}

export interface StudySessionDto {
  id: string;
  subjectId: string;
  subjectName: string;
  taskId: string | null;
  taskTitle: string | null;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  status: StudySessionStatusDto;
  startedAt: string;
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
}

export interface MasteryConditionRecordDto {
  condition: MasteryProofCondition;
  checked: boolean;
  checkedAt: string | null;
  actorId: string | null;
}

export interface MasteryEvidenceDto {
  id: string;
  evidenceType: MasteryEvidenceTypeDto;
  taskId: string | null;
  sessionId: string | null;
  noteId: string | null;
  mistakeId: string | null;
  retestId: string | null;
  summary: string | null;
  sourceLabel: string;
  createdAt: string;
  actorId: string | null;
}

export interface MasteryRetestDto {
  id: string;
  testedAt: string;
  result: MasteryRetestResultDto;
  score: string | null;
  summary: string | null;
  nextReviewAt: string | null;
  actorId: string | null;
}

export interface MasteryEvidenceCandidateDto {
  id: string;
  label: string;
}

export interface DailyReviewDto {
  id: string;
  reviewDate: string;
  totalMinutes: number;
  effectiveMinutes: number;
  summary: string | null;
  lostControl: string | null;
  keepAction: string | null;
  tomorrowMinimum: string | null;
  mood: string | null;
  aiSuggestion: string | null;
}

export interface SyllabusNodeDto {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  parentId: string | null;
  title: string;
  kind: SyllabusNodeKindDto;
  status: SyllabusNodeStatusDto;
  masteryLevel: MasteryLevelDto | null;
  sortOrder: number;
  targetMinutes: number;
  actualMinutes: number;
  evidence: {
    taskCount: number;
    sessionCount: number;
    noteCount: number;
    mistakeCount: number;
    lastEvidenceAt: string | null;
    daysSinceLastEvidence: number | null;
    source: "explicit" | "fallback_count";
  };
  masteryConditions: MasteryProofCondition[];
  masteryConditionRecords: MasteryConditionRecordDto[];
  masteryEvidence: MasteryEvidenceDto[];
  masteryRetests: MasteryRetestDto[];
  masteryEvidenceCandidates: Record<MasteryEvidenceTypeDto, MasteryEvidenceCandidateDto[]>;
  masteryProof: MasteryProofSummary;
  mapSignal: SyllabusMapSignal;
  children: SyllabusNodeDto[];
}

export interface SyllabusMapOverviewDto {
  nodes: SyllabusNodeDto[];
  summary: SyllabusMapSummary;
  summaryBySubject: Record<string, SyllabusMapSummary>;
}

export interface AttachmentDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  downloadApiPath: string;
  createdAt: string;
}

export interface NoteDto {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  title: string;
  content: string;
  masteryStatus: NoteMasteryStatusDto | null;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentDto[];
}

export interface MistakeDto {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  title: string;
  source: string | null;
  cause: MistakeCauseDto;
  correctIdea: string | null;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MotivationVaultDto {
  id: string;
  whyStarted: string | null;
  neverReturnTo: string | null;
  futureSelf: string | null;
  messageToFuture: string | null;
  firstSimulationDiary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationSubjectResultDto {
  id: string;
  simulationExamId: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  targetScore: number | null;
  actualScore: number | null;
  durationMinutes: number | null;
  blankQuestionCount: number;
  lossReasons: string[];
  summary: string | null;
}

export interface SimulationExamDto {
  id: string;
  name: string;
  examDate: string;
  isFirstSynchronized: boolean;
  targetDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  targetScore: number | null;
  actualScore: number | null;
  blankQuestionCount: number;
  lossReasons: string[];
  mindset: string | null;
  summary: string | null;
  reviewText: string | null;
  createdAt: string;
  updatedAt: string;
  subjectResults: SimulationSubjectResultDto[];
}

export interface StagePlanDto {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  mode: StagePlanModeDto;
  status: StagePlanStatusDto;
  createdAt: string;
  updatedAt: string;
}

export interface StageAdjustmentDraftRecordDto {
  id: string;
  stagePlanId: string | null;
  source: StageAdjustmentDraftSourceDto;
  mode: StagePlanModeDto;
  risk: StageAdjustmentDraftRiskDto;
  riskConclusion: string;
  focusSubjects: string[];
  taskIntensity: StageAdjustmentTaskIntensityDto;
  taskAdjustmentActions: StageAdjustmentTaskActionDto[];
  nextStageEmphasis: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
  status: StageAdjustmentDraftStatusDto;
  createdAt: string;
  appliedAt: string | null;
  actorId: string | null;
}

export interface SyllabusOverviewDto {
  label: string;
  progress: number;
  color: string;
}

export interface TaskDebtReorderSuggestionDto {
  taskId: string;
  taskTitle: string;
  subjectName: string;
  action: TaskDebtReorderAction;
  reason: string;
  estimatedMinutes: number;
  rank: number;
}

export interface TaskDebtReorderDto {
  pressure: TaskDebtReorderPressure;
  availableMinutes: number;
  summary: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
  suggestions: TaskDebtReorderSuggestionDto[];
}

export interface RecoveryStateDto {
  id: string;
  status: RecoveryStateStatusDto;
  triggerType: RecoveryTriggerTypeDto;
  startedAt: string;
  endedAt: string | null;
  targetMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  exitCondition: string | null;
  actorId: string | null;
}

export interface TodayDashboardDto {
  studyDay: {
    key: string;
    start: string;
    end: string;
  };
  metrics: {
    daysToSimulation: number;
    daysToFinal: number;
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
    triggerType: RecoveryTriggerTypeDto | null;
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
