import { DataDeleteError } from "@areaforge/core";
import catalog from "../generated/data-delete/models.json";

export const deleteOwnerFields: Readonly<Record<string, string>> = {
  User: "id", ExamWorkspace: "userId", WorkspaceMembership: "userId", WorkspaceSelection: "userId",
  AuthSession: "userId", AuthActionToken: "userId", MotivationVault: "userId", MotivationItem: "userId",
  MotivationReminderState: "userId", NotificationPreference: "userId", AiProviderCredential: "userId",
  DailyReview: "ownerUserId", CheckIn: "ownerUserId", PeriodicReportDecision: "ownerUserId",
  SimulationExam: "ownerUserId", StagePlan: "ownerUserId", StageAdjustmentDraft: "ownerUserId",
  PlanMilestone: "ownerUserId", PlanInboxItem: "ownerUserId", StudyResource: "ownerUserId", ReviewSchedule: "ownerUserId",
  StudyTask: "ownerUserId", Note: "ownerUserId", Mistake: "ownerUserId", SyllabusNodeProgress: "ownerUserId",
  MasteryConditionRecord: "ownerUserId", MasteryEvidence: "ownerUserId", MasteryRetest: "ownerUserId", Attachment: "ownerUserId",
  StudySession: "userId", StudySessionDevicePresence: "userId", RecoveryState: "userId", KnowledgeCanvasLayout: "userId",
  TerminalGoal: "userId", KnowledgeGroup: "userId", KnowledgePoint: "userId", LearningArrangement: "userId",
  KnowledgeRetest: "userId", KnowledgeEvidence: "userId", RankingPreference: "userId",
  AiDraftOperation: "actorId", LearningTreeExportGrant: "actorId", UserNotification: "recipientUserId",
  LearningTreeImportBatch: "actorId", AuditEvent: "actorId", DataJob: "requestedByUserId",
  DataExportDownloadGrant: "requestedByUserId", PrivateChallenge: "ownerUserId", PrivateChallengeParticipant: "userId",
  RankingAppeal: "submittedByUserId", WorkspaceInvitation: "invitedByUserId", WorkspaceShareGrant: "resourceOwnerUserId",
  WorkspaceSearchPartition: "userId",
};

export const deleteParentFields: Readonly<Record<string, string>> = {
  SubjectGroup: "workspace", Subject: "workspace", SyllabusNode: "subject",
  TaskDebtEvent: "task", SimulationSubjectResult: "simulationExam", SimulationLossItem: "simulationSubjectResult",
  StudyResourceTag: "resource", ReviewEvent: "reviewSchedule", MistakeAttempt: "mistake",
  KnowledgeCanvasNodeLayout: "layout", StudySessionCloseout: "session", LearningTreeImportItem: "batch",
  DataExportArtifact: "job", DataExportPackage: "job", RankingProjection: "participant",
  WorkspaceSearchDocument: "partition",
};

export const deleteLinkModels = ["StudyTaskRelatedSyllabusNode", "StudyTaskStageLink", "StudyTaskKnowledgePoint",
  "NoteRelatedSyllabusNode", "NoteMistakeLink", "TaskDependency", "PlanInboxDependencyRef", "StudyResourceTaskLink",
  "StudyResourceNoteLink", "StudyResourceMistakeLink", "StudyResourceSyllabusNodeLink", "KnowledgePointSubject",
  "KnowledgePointRelation", "KnowledgeSyllabusLink", "StageGoalLink", "StageKnowledgeTarget",
  "LearningArrangementKnowledgePoint", "StudySessionKnowledgePoint", "KnowledgeRetestPoint"] as const;
export const deleteRetainedModels = ["AuthThrottleBucket", "AiRuntimeSetting", "ControlledOperationRequest", "CoachSuggestion"] as const;
export const deletionProtocolModels = ["DataDeletionIntent", "DataDeletionItem", "DataDeletionFence", "DataDeletionFile", "DataDeletionLedger", "DataDeletionVisibility"] as const;
export const accountOnlyDeleteModels = ["User", "AuthSession", "AuthActionToken", "MotivationVault", "MotivationItem",
  "MotivationReminderState", "NotificationPreference", "AiProviderCredential"];

const workspacePaths: Readonly<Record<string, string>> = {
  ExamWorkspace: "id", StudyTask: "subject.workspaceId", Note: "subject.workspaceId", Mistake: "subject.workspaceId",
  SyllabusNodeProgress: "syllabusNode.subject.workspaceId", MasteryConditionRecord: "syllabusNode.subject.workspaceId",
  MasteryEvidence: "syllabusNode.subject.workspaceId", MasteryRetest: "syllabusNode.subject.workspaceId",
  Attachment: "note.subject.workspaceId", DataExportDownloadGrant: "exportPackage.job.workspaceId",
  RankingAppeal: "challenge.workspaceId", PrivateChallengeParticipant: "challenge.workspaceId",
};

export interface DeleteField { name: string; kind: string; type: string; isId: boolean; isList: boolean; isRequired: boolean;
  relationFromFields?: string[]; relationToFields?: string[]; relationOnDelete?: string }
export interface DeleteModel { name: string; dbName?: string | null; fields: DeleteField[]; primaryKey?: { fields: string[] } | null }
export const deletionSchemaHash: string = catalog.schemaHash;
export type DeleteRelation = { child: string; parent: string; childColumns: readonly string[]; parentColumns: readonly string[]; name: string };
const modelMap = new Map<string, DeleteModel>((catalog.models as DeleteModel[]).map(model => [model.name, model]));

export function sourceDeleteModels(): DeleteModel[] {
  const declared = [...Object.keys(deleteOwnerFields), ...Object.keys(deleteParentFields), ...deleteLinkModels, ...deleteRetainedModels];
  const actual = [...modelMap.keys()].filter(name => !deletionProtocolModels.includes(name as never));
  if (new Set(declared).size !== declared.length || actual.some(name => !declared.includes(name)) || declared.some(name => !modelMap.has(name))) {
    throw new DataDeleteError("DATA_DELETE_MODEL_UNCLASSIFIED");
  }
  return actual.map(deleteModel);
}

export function deleteModel(name: string): DeleteModel {
  const model = modelMap.get(name);
  if (!model || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new DataDeleteError("DATA_DELETE_MODEL_INVALID");
  return model;
}

export function deletePrimaryKey(name: string): readonly string[] {
  const model = deleteModel(name);
  const fields = model.fields.filter(field => field.isId).map(field => field.name);
  const result = fields.length ? fields : model.primaryKey?.fields;
  if (!result?.length) throw new DataDeleteError("DATA_DELETE_PRIMARY_KEY_UNSUPPORTED");
  return result;
}

export function deleteRelations(): DeleteRelation[] {
  return sourceDeleteModels().flatMap(model => model.fields.filter(field => field.kind === "object" && field.relationFromFields?.length)
    .map(field => ({ child: model.name, parent: field.type, childColumns: field.relationFromFields!, parentColumns: field.relationToFields!, name: field.name })));
}

export function deleteWorkspacePath(model: string): string | null {
  if (accountOnlyDeleteModels.includes(model)) return null;
  if (workspacePaths[model]) return workspacePaths[model];
  if (deleteModel(model).fields.some(field => field.name === "workspaceId")) return "workspaceId";
  const parent = deleteParentFields[model];
  if (!parent) return null;
  const relation = deleteModel(model).fields.find(field => field.name === parent && field.kind === "object");
  if (!relation) throw new DataDeleteError("DATA_DELETE_PARENT_INVALID");
  const rest = deleteWorkspacePath(relation.type);
  return rest ? parent + "." + rest : null;
}
