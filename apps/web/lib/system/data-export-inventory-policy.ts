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

  planned("AuthSession", "safe device/session metadata only; never tokenHash"),
  planned("WorkspaceInvitation", "actor-related lifecycle only; target email minimization required"),
  included("WorkspaceSelection"),
  included("WorkspaceShareGrant", "owner/grantee-related grant metadata"),
  included("CoachSuggestion", "author/recipient scoped payload and lineage"),
  included("TaskDebtEvent"),
  included("RecoveryState"),
  included("PeriodicReportDecision"),
  included("MasteryConditionRecord"),
  included("MasteryEvidence"),
  included("MasteryRetest"),
  planned("SimulationSubjectResult"),
  planned("SimulationLossItem"),
  included("StageAdjustmentDraft"),
  planned("TaskDependency"),
  included("PlanInboxItem"),
  planned("PlanInboxDependencyRef"),
  planned("StudyTaskRelatedSyllabusNode"),
  planned("StudyTaskStageLink"),
  planned("StudyTaskKnowledgePoint"),
  planned("NoteRelatedSyllabusNode"),
  planned("NoteMistakeLink"),
  planned("StudyResourceTag"),
  planned("StudyResourceTaskLink"),
  planned("StudyResourceNoteLink"),
  planned("StudyResourceMistakeLink"),
  planned("StudyResourceSyllabusNodeLink"),
  planned("LearningTreeImportBatch"),
  planned("LearningTreeImportItem"),
  planned("LearningTreeExportGrant", "lifecycle metadata only; never bearer material"),
  planned("ReviewEvent"),
  planned("MistakeAttempt"),
  included("KnowledgeCanvasLayout"),
  planned("KnowledgeCanvasNodeLayout"),
  included("MotivationReminderState"),
  included("AiDraftOperation", "result metadata only; never prompt/raw provider response"),
  planned("AiProviderCredential", "provider metadata only; never encryptedApiKey"),
  included("TerminalGoal"),
  included("KnowledgeGroup"),
  included("KnowledgePoint"),
  planned("KnowledgePointSubject"),
  planned("KnowledgePointRelation"),
  planned("KnowledgeSyllabusLink"),
  planned("StageGoalLink"),
  planned("StageKnowledgeTarget"),
  included("LearningArrangement"),
  planned("LearningArrangementKnowledgePoint"),
  planned("StudySessionCloseout"),
  planned("StudySessionDevicePresence", "coarse device metadata only"),
  planned("StudySessionKnowledgePoint"),
  included("KnowledgeRetest"),
  planned("KnowledgeRetestPoint"),
  included("KnowledgeEvidence"),
  included("RankingPreference"),
  planned("PrivateChallenge"),
  planned("PrivateChallengeParticipant"),
  planned("RankingAppeal", "reason belongs only to submitter/authorized review scope"),
  planned("ControlledOperationRequest", "requester-visible typed intent and result only; never lease tokens"),

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

function planned(model: string, reason = "requires an explicit owner-scoped select before complete archive implementation"): DataExportModelDisposition {
  return { model, disposition: "PLANNED_MINIMIZED", reason };
}

function excluded(model: string, reason: string): DataExportModelDisposition {
  return { model, disposition: "EXCLUDED_SECURITY", reason };
}

function derived(model: string, reason: string): DataExportModelDisposition {
  return { model, disposition: "DERIVED_REBUILDABLE", reason };
}
