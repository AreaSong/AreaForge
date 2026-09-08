export const DATA_EXPORT_MODEL_DISPOSITIONS = [
  included("User"),
  included("ExamWorkspace"),
  included("WorkspaceMembership"),
  included("SubjectGroup"),
  included("Subject"),
  included("SyllabusNode"),
  included("SyllabusNodeProgress"),
  included("StudyTask"),
  included("StudySession"),
  included("DailyReview"),
  included("CheckIn"),
  included("Note"),
  included("Attachment", "metadata only; file body requires DATA-EXPORT confirmation"),
  included("Mistake"),
  included("StudyResource"),
  included("SimulationExam"),
  included("StagePlan"),
  included("PlanMilestone"),
  included("ReviewSchedule"),
  included("MotivationVault"),
  included("MotivationItem"),
  included("NotificationPreference"),
  included("UserNotification"),
  included("AuditEvent", "actor-scoped redacted event metadata"),
  included("DataJob", "requester-scoped public lifecycle fields"),

  included("AuthSession", "account-scoped coarse session lifecycle; token and network hashes excluded"),
  included("WorkspaceInvitation", "actor-related lifecycle only; target email and token excluded"),
  included("WorkspaceSelection"),
  included("WorkspaceShareGrant", "owner/grantee-related grant metadata"),
  included("CoachSuggestion", "author/recipient scoped payload and lineage"),
  included("TaskDebtEvent"),
  included("RecoveryState"),
  included("PeriodicReportDecision"),
  included("MasteryConditionRecord"),
  included("MasteryEvidence"),
  included("MasteryRetest"),
  included("SimulationSubjectResult"),
  included("SimulationLossItem"),
  included("StageAdjustmentDraft"),
  included("TaskDependency"),
  included("PlanInboxItem"),
  included("PlanInboxDependencyRef"),
  included("StudyTaskRelatedSyllabusNode"),
  included("StudyTaskStageLink"),
  included("StudyTaskKnowledgePoint"),
  included("NoteRelatedSyllabusNode"),
  included("NoteMistakeLink"),
  included("StudyResourceTag"),
  included("StudyResourceTaskLink"),
  included("StudyResourceNoteLink"),
  included("StudyResourceMistakeLink"),
  included("StudyResourceSyllabusNodeLink"),
  included("LearningTreeImportBatch", "actor-scoped import result with capability and idempotency material excluded"),
  included("LearningTreeImportItem"),
  included("LearningTreeExportGrant", "actor-scoped lifecycle metadata only; bearer nonce excluded"),
  included("ReviewEvent"),
  included("MistakeAttempt"),
  included("KnowledgeCanvasLayout"),
  included("KnowledgeCanvasNodeLayout"),
  included("MotivationReminderState"),
  included("AiDraftOperation", "result metadata only; never prompt/raw provider response"),
  included("AiProviderCredential", "account-scoped provider metadata only; encrypted API key excluded"),
  included("TerminalGoal"),
  included("KnowledgeGroup"),
  included("KnowledgePoint"),
  included("KnowledgePointSubject"),
  included("KnowledgePointRelation"),
  included("KnowledgeSyllabusLink"),
  included("StageGoalLink"),
  included("StageKnowledgeTarget"),
  included("LearningArrangement"),
  included("LearningArrangementKnowledgePoint"),
  included("StudySessionCloseout"),
  included("StudySessionDevicePresence", "actor-scoped coarse device metadata; stable device id excluded"),
  included("StudySessionKnowledgePoint"),
  included("KnowledgeRetest"),
  included("KnowledgeRetestPoint"),
  included("KnowledgeEvidence"),
  included("RankingPreference"),
  included("PrivateChallenge", "owned or joined challenge source facts without derived projection"),
  included("PrivateChallengeParticipant", "current actor participation only; other participant rows excluded"),
  included("RankingAppeal", "submitter-scoped appeal and reason; reviewer-only appeals excluded"),
  included("ControlledOperationRequest", "requester-visible typed intent and result; capability and lease material excluded"),

  excluded("AuthActionToken", "purpose-separated credential material is never exported"),
  excluded("AuthThrottleBucket", "anti-abuse keys and counters are internal security state"),
  excluded("DataExportPackage", "artifact storage identity and objectKey are internal"),
  excluded("DataExportDownloadGrant", "download capability hashes are never exported"),
  excluded("AiRuntimeSetting", "global server runtime configuration is not account data"),
  derived("RankingProjection", "rebuildable from opt-in challenge source facts"),
] as const satisfies readonly DataExportModelDisposition[];

export type DataExportDisposition = "INCLUDED_PREVIEW" | "PLANNED_MINIMIZED" | "EXCLUDED_SECURITY" | "DERIVED_REBUILDABLE";

export interface DataExportModelDisposition {
  model: string;
  disposition: DataExportDisposition;
  reason: string;
}

function included(model: string, reason = "owner- or actor-scoped record is included in the preview manifest"): DataExportModelDisposition {
  return { model, disposition: "INCLUDED_PREVIEW", reason };
}

function excluded(model: string, reason: string): DataExportModelDisposition {
  return { model, disposition: "EXCLUDED_SECURITY", reason };
}

function derived(model: string, reason: string): DataExportModelDisposition {
  return { model, disposition: "DERIVED_REBUILDABLE", reason };
}
