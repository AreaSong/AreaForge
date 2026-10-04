// Shared response shapes are defined in contracts/* and aggregated here as a
// type-only compatibility facade. This module must not depend on study services.
export type { ActivityBreakdown } from "@/lib/contracts/activity";
export type { ActionCenterTodayDto, SubjectShortcutTaskOptionDto } from "@/lib/contracts/action-center";
export type { AppShellStatusDto } from "@/lib/contracts/app-shell";
export type {
  AnalyticsDailyPointDto,
  AnalyticsRiskItemDto,
  AnalyticsSubjectShareDto,
  AnalyticsSummaryDto,
  LongTermRiskSummaryDto,
} from "@/lib/contracts/analytics";
export type {
  AiProviderCredentialStatus,
  AiProviderPreferenceDto,
  AiRuntimeSettingStatus,
} from "@/lib/contracts/ai";
export type { CheckInV2Dto } from "@/lib/contracts/check-in";
export type {
  ConfirmationActionDto,
  ConfirmationFilter,
  ConfirmationItemDto,
  ConfirmationKind,
  ConfirmationStatus,
} from "@/lib/contracts/confirmation";
export type { DailyReviewFactsDto } from "@/lib/contracts/daily-review";
export type {
  ExamWorkspaceDto,
  SubjectDuplicateSetDto,
  SubjectGroupDto,
  SubjectMergeResultDto,
  SubjectMergeOperationDto,
  SubjectMergeUndoResultDto,
  SubjectReferenceCountDto,
  TakeoverPreviewDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts/workspace";
export type {
  KnowledgeCanvasEdgeDto,
  KnowledgeCanvasLayoutDto,
  KnowledgeCanvasNodeDto,
  KnowledgeCanvasQueryDto,
} from "@/lib/contracts/knowledge-canvas";
export type {
  KnowledgeMasteryStateDto,
  KnowledgePointDetailDto,
  KnowledgePointDto,
} from "@/lib/contracts/knowledge";
export type {
  KnowledgeRetestDetailDto,
  KnowledgeRetestListItemDto,
  KnowledgeRetestPointDto,
  KnowledgeRetestResultDto,
  KnowledgeRetestStatusDto,
} from "@/lib/contracts/knowledge-retest";
export type {
  LearningTreeConfirmResultDto,
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchDetailDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/contracts/learning-tree";
export type {
  MistakeCreatePrefillDto,
  MotivationItemDto,
  MotivationNextDto,
  MotivationVaultField,
  NoteEditorOptionsDto,
  OwnedMistakeDetailDto,
  OwnedNoteDetailDto,
} from "@/lib/contracts/knowledge-library";
export type { NotificationPreferenceDto } from "@/lib/contracts/notification";
export type {
  PlanInboxDependencyRefDto,
  PlanInboxFormOptions,
  PlanInboxItemDto,
  PlanInboxWriteResult,
} from "@/lib/contracts/plan-inbox";
export type {
  PlanMilestoneConflictLatest,
  PlanMilestoneDto,
  PlanRollingDayDto,
  PlanRollingDto,
} from "@/lib/contracts/planning";
export type { RecoveryV2Dto } from "@/lib/contracts/recovery";
export type { ReportDecisionConflictLatest } from "@/lib/contracts/report-decisions";
export type {
  PeriodicReportDecisionDto,
  PeriodicReportDto,
  PeriodicReportKind,
  PeriodicReportsDto,
  PeriodicSubjectShareDto,
} from "@/lib/contracts/reports";
export type {
  BridgedReviewScheduleDto,
  RecentReviewEventDto,
  ReviewEventDto,
  ReviewQueueItemDto,
  ReviewQueueTargetDto,
  ReviewScheduleDto,
  ReviewWorkbenchSummaryDto,
} from "@/lib/contracts/review";
export type { ReviewTargetDto } from "@/lib/contracts/review-target";
export type {
  SimulationRemediationDto,
  SimulationStageDraftDto,
  SimulationWorkspaceDto,
  StageAdjustmentConflictLatest,
  StagePlanConflictLatest,
} from "@/lib/contracts/simulation";
export type {
  StagingUploadResult,
  StudyResourceDto,
  StudyResourceEditorOptionsDto,
  StudyResourceOrganizeStatus,
} from "@/lib/contracts/study-resource";
export type {
  StudyTaskDetailDto,
  TaskDependencyDto,
  TaskDependencyCandidateDto,
  TaskRelationSummaryDto,
  TaskUpdateSnapshotDto,
} from "@/lib/contracts/task";
