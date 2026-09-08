import type { DataExportRecordInput } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";

type DbClient = typeof prisma | Prisma.TransactionClient;
export type ExportRecordDelegate = { findMany(args: unknown): Promise<unknown[]> };
type JsonRecord = Record<string, unknown>;
type DataJobScope = "ACCOUNT" | "WORKSPACE";

export async function appendExtendedExportRecords(
  client: DbClient,
  records: DataExportRecordInput[],
  actorId: string,
  workspaceIds: readonly string[],
  scope: DataJobScope,
  includeData: boolean,
): Promise<void> {
  const db = client as unknown as Record<string, ExportRecordDelegate>;
  const workspaceWhere = { workspaceId: { in: [...workspaceIds] } };
  const actorWorkspaceWhere = scope === "WORKSPACE" ? { userId: actorId, ...workspaceWhere } : { userId: actorId };
  const ownerWorkspaceWhere = scope === "WORKSPACE" ? { ownerUserId: actorId, ...workspaceWhere } : { ownerUserId: actorId };
  const ownedNodeWhere = scope === "WORKSPACE"
    ? { ownerUserId: actorId, syllabusNode: { subject: workspaceWhere } }
    : { ownerUserId: actorId };

  if (scope === "ACCOUNT") {
    await appendRows(db, records, "workspaceSelection", "workspaceSelection", { userId: actorId }, {
      userId: true, workspaceId: true, revision: true, selectedAt: true, createdAt: true, updatedAt: true,
    }, "userId");
    await appendRows(db, records, "motivationReminderState", "motivationReminderState", { userId: actorId }, {
      id: true, userId: true, lastAutoShowAt: true, learningDay: true, dailyCount: true,
      recentItemIds: true, revision: true, createdAt: true, updatedAt: true,
    });
  }

  await appendRows(db, records, "taskDebtEvent", "taskDebtEvent", {
    task: { ownerUserId: actorId, ...(scope === "WORKSPACE" ? { subject: workspaceWhere } : {}) },
  }, {
    id: true, taskId: true, actorId: true, action: true, fromStatus: true, toStatus: true,
    fromDebtStatus: true, toDebtStatus: true, relatedTaskId: true, reason: includeData,
    metadata: includeData, createdAt: true,
  });
  await appendRows(db, records, "recoveryState", "recoveryState", actorWorkspaceWhere, {
    id: true, workspaceId: true, userId: true, status: true, triggerType: true, startedAt: true,
    endedAt: true, targetMinutes: true, visibleTaskLimit: true, reason: includeData,
    exitCondition: includeData, metadata: includeData, actorId: true, currentStage: true,
    windowStartDate: true, windowEndDate: true, lastProgressDate: true, progressionVersion: true, revision: true,
  });
  await appendRows(db, records, "periodicReportDecision", "periodicReportDecision", ownerWorkspaceWhere, {
    id: true, workspaceId: true, ownerUserId: true, kind: true, rangeStart: true, rangeEnd: true,
    status: true, reportSnapshot: includeData, nextCycleDraft: includeData, canAutoApply: true,
    requiresUserConfirmation: true, actorId: true, decidedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "masteryConditionRecord", "masteryConditionRecord", ownedNodeWhere, {
    id: true, syllabusNodeId: true, ownerUserId: true, condition: true, checked: true,
    checkedAt: true, actorId: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "masteryEvidence", "masteryEvidence", ownedNodeWhere, {
    id: true, syllabusNodeId: true, ownerUserId: true, evidenceType: true, taskId: true, sessionId: true,
    noteId: true, mistakeId: true, retestId: true, summary: includeData, actorId: true, createdAt: true,
  });
  await appendRows(db, records, "masteryRetest", "masteryRetest", ownedNodeWhere, {
    id: true, syllabusNodeId: true, ownerUserId: true, testedAt: true, result: true, score: true,
    summary: includeData, nextReviewAt: true, reviewEventId: true, actorId: true, createdAt: true,
  });
  await appendRows(db, records, "stageAdjustmentDraft", "stageAdjustmentDraft", ownerWorkspaceWhere, {
    id: true, workspaceId: true, ownerUserId: true, stagePlanId: true, sourceReportDecisionId: true,
    sourceReportRevision: true, originVersion: true, source: true, mode: true, risk: true,
    riskConclusion: includeData, focusSubjects: true, taskIntensity: true, taskAdjustmentActions: includeData,
    nextStageEmphasis: includeData, canAutoApply: true, requiresUserConfirmation: true, status: true,
    revision: true, actorId: true, createdAt: true, appliedAt: true,
  });
  await appendRows(db, records, "planInboxItem", "planInboxItem", ownerWorkspaceWhere, {
    id: true, workspaceId: true, ownerUserId: true, stableKey: true, originKey: true, originVersion: true,
    originType: true, originSnapshot: includeData, status: true, title: includeData, subjectId: true,
    plannedDate: true, estimatedMinutes: true, priority: true, type: true, planMilestoneId: true,
    primaryNodeId: true, relatedNodeIds: true, revision: true, convertedTaskId: true,
    supersededByItemId: true, actorId: true, createdAt: true, updatedAt: true, dismissedAt: true, convertedAt: true,
  });
  await appendRows(db, records, "knowledgeCanvasLayout", "knowledgeCanvasLayout", actorWorkspaceWhere, {
    id: true, userId: true, workspaceId: true, revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "aiDraftOperation", "aiDraftOperation", {
    actorId, ...(scope === "WORKSPACE" ? workspaceWhere : {}),
  }, {
    id: true, operationId: true, actorId: true, workspaceId: true, endpoint: true, purpose: true,
    projectionVersion: true, status: true, resultReference: true, expiresAt: true, consumedAt: true,
    revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "terminalGoal", "terminalGoal", actorWorkspaceWhere, {
    id: true, userId: true, workspaceId: true, stableKey: true, title: includeData, outcome: includeData,
    targetDate: true, status: true, revision: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "knowledgeGroup", "knowledgeGroup", actorWorkspaceWhere, {
    id: true, userId: true, workspaceId: true, subjectId: true, parentId: true, stableKey: true,
    title: includeData, sortOrder: true, revision: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "knowledgePoint", "knowledgePoint", actorWorkspaceWhere, {
    id: true, userId: true, workspaceId: true, primarySubjectId: true, primaryGroupId: true,
    stableKey: true, title: includeData, boundary: includeData, masteryState: true, nextRetestAt: true,
    revision: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "learningArrangement", "learningArrangement", actorWorkspaceWhere, {
    id: true, userId: true, workspaceId: true, stagePlanId: true, subjectId: true, title: includeData,
    intent: includeData, startDate: true, endDate: true, status: true, estimatedMin: true,
    estimatedMax: true, revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "knowledgeRetest", "knowledgeRetest", actorWorkspaceWhere, {
    id: true, userId: true, workspaceId: true, title: includeData, method: true, status: true, result: true,
    scheduledAt: true, testedAt: true, nextDueAt: true, summary: includeData, reviewText: includeData,
    revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "knowledgeEvidence", "knowledgeEvidence", actorWorkspaceWhere, {
    id: true, userId: true, workspaceId: true, knowledgePointId: true, sourceType: true, sessionId: true,
    retestPointId: true, summary: includeData, dimensions: includeData, confidence: true,
    occurredAt: true, createdAt: true,
  });
  await appendRows(db, records, "rankingPreference", "rankingPreference", actorWorkspaceWhere, {
    id: true, workspaceId: true, userId: true, enabled: true, timezone: true, authorizedFields: true,
    revision: true, optedInAt: true, optedOutAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "workspaceShareGrant", "workspaceShareGrant", {
    ...(scope === "WORKSPACE" ? workspaceWhere : {}),
    OR: [
      { resourceOwnerUserId: actorId },
      { grantedByUserId: actorId },
      { granteeUserId: actorId },
      { revokedByUserId: actorId },
    ],
  }, {
    id: true, workspaceId: true, resourceOwnerUserId: true, grantedByUserId: true, scope: true,
    granteeUserId: true, granteeRole: true, resourceType: true, resourceId: true, access: true,
    expiresAt: true, revokedAt: true, revokedByUserId: true, revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "coachSuggestion", "coachSuggestion", {
    ...(scope === "WORKSPACE" ? workspaceWhere : {}),
    OR: [{ authorUserId: actorId }, { recipientUserId: actorId }],
  }, {
    id: true, workspaceId: true, authorUserId: true, recipientUserId: true, sourceGrantId: true,
    sourceResourceType: true, sourceResourceId: true, sourceSnapshotHash: true, payload: includeData,
    status: true, revision: true, decidedAt: true, planInboxItemId: true, createdAt: true, updatedAt: true,
  });
}

export async function appendRows(
  db: Record<string, ExportRecordDelegate>,
  records: DataExportRecordInput[],
  kind: string,
  delegateName: string,
  where: unknown,
  select: JsonRecord,
  keyField = "id",
): Promise<void> {
  const delegate = db[delegateName];
  if (!delegate) throw new ApiError("DATA_INVENTORY_MODEL_UNAVAILABLE", 503);
  const rows = await delegate.findMany({ where, select, orderBy: { [keyField]: "asc" } });
  for (const row of rows) {
    const item = row as JsonRecord;
    const id = typeof item[keyField] === "string" ? item[keyField] as string : null;
    if (!id) throw new ApiError("DATA_INVENTORY_ID_MISSING", 409);
    records.push({ kind, id, data: toJsonSafe(item) });
  }
}

function toJsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return value;
}
