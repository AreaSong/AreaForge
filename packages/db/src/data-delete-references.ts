import { Prisma } from "../generated/prisma/client";
import { quotedDeleteName } from "./data-delete-query";

export interface DeleteSoftReference { child: string; column: string; parent: string; discriminator?: string; values?: readonly string[]; array?: boolean }
const typed = (child: string, column: string, discriminator: string, targets: Record<string, readonly string[]>): DeleteSoftReference[] =>
  Object.entries(targets).map(([parent, values]) => ({ child, column, parent, discriminator, values }));
const resources = { Note: ["NOTE", "Note", "note"], Mistake: ["MISTAKE", "Mistake", "mistake"],
  Attachment: ["ATTACHMENT", "Attachment", "attachment"], DailyReview: ["DAILY_REVIEW", "DailyReview"],
  MotivationVault: ["MOTIVATION", "MotivationVault"], AiDraftOperation: ["AI_DRAFT", "AiDraftOperation"] };

export const deleteSoftReferences: readonly DeleteSoftReference[] = [
  ...typed("WorkspaceShareGrant", "resourceId", "resourceType", resources),
  ...typed("CoachSuggestion", "sourceResourceId", "sourceResourceType", resources),
  { child: "PlanInboxItem", column: "subjectId", parent: "Subject" },
  { child: "PlanInboxItem", column: "primaryNodeId", parent: "SyllabusNode" },
  { child: "PlanInboxItem", column: "relatedNodeIds", parent: "SyllabusNode", array: true },
  { child: "StageAdjustmentDraft", column: "sourceReportDecisionId", parent: "PeriodicReportDecision" },
  { child: "PlanInboxDependencyRef", column: "importBatchId", parent: "LearningTreeImportBatch" },
  ...typed("LearningTreeImportItem", "mappedTargetId", "objectType", { Subject: ["SUBJECT", "subject"],
    SyllabusNode: ["SYLLABUS_NODE", "syllabus_node", "node"], StudyTask: ["TASK", "task"], Note: ["NOTE", "note"],
    StudyResource: ["RESOURCE", "resource"], PlanInboxItem: ["INBOX_ITEM", "inboxItem"] }),
  ...typed("KnowledgeCanvasNodeLayout", "entityId", "entityType", { Note: ["NOTE", "note"], Mistake: ["MISTAKE", "mistake"],
    StudyResource: ["RESOURCE", "resource"], SyllabusNode: ["SYLLABUS_NODE", "syllabusNode"], KnowledgePoint: ["KNOWLEDGE_POINT", "knowledgePoint"] }),
  ...typed("UserNotification", "sourceEntityId", "sourceEntityType", { PrivateChallenge: ["PrivateChallenge"],
    PrivateChallengeParticipant: ["PrivateChallengeParticipant"], RankingAppeal: ["RankingAppeal"] }),
];

export function softDeletePredicate(reference: DeleteSoftReference, ids: readonly string[]): Prisma.Sql {
  const field = Prisma.sql`s.${quotedDeleteName(reference.column)}`;
  const match = reference.array ? Prisma.sql`${field} && ARRAY[${Prisma.join(ids)}]::text[]` : Prisma.sql`${field} IN (${Prisma.join(ids)})`;
  return reference.discriminator ? Prisma.sql`(${match}) AND s.${quotedDeleteName(reference.discriminator)}::text IN (${Prisma.join(reference.values!)})` : match;
}
