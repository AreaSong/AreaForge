import type { DataExportRecordInput } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { normalizeEmail } from "@/lib/auth/session";
import { appendRows, type ExportRecordDelegate } from "./data-export-inventory-records";

type DbClient = typeof prisma | Prisma.TransactionClient;
type DataJobScope = "ACCOUNT" | "WORKSPACE";

interface ExportContext {
  db: Record<string, ExportRecordDelegate>;
  records: DataExportRecordInput[];
  actorId: string;
  actorEmail: string;
  workspaceIds: readonly string[];
  scope: DataJobScope;
  includeData: boolean;
}

export async function appendRelatedExportRecords(
  client: DbClient,
  records: DataExportRecordInput[],
  actorId: string,
  actorEmail: string,
  workspaceIds: readonly string[],
  scope: DataJobScope,
  includeData: boolean,
): Promise<void> {
  const context: ExportContext = {
    db: client as unknown as Record<string, ExportRecordDelegate>,
    records,
    actorId, actorEmail,
    workspaceIds,
    scope,
    includeData,
  };
  await appendAccountSecurityRecords(context);
  await appendSimulationAndTaskRecords(context);
  await appendTaskRelationRecords(context);
  await appendResourceRelationRecords(context);
  await appendImportAndReviewRecords(context);
  await appendKnowledgeRelationRecords(context);
  await appendSessionRecords(context);
  await appendRankingRecords(context);
}

async function appendAccountSecurityRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, actorEmail, workspaceIds, scope, includeData } = context;
  if (scope === "ACCOUNT") {
    await appendRows(db, records, "authSession", "authSession", { userId: actorId }, {
      id: true, userId: true, authRevision: true, deviceLabel: includeData, expiresAt: true,
      lastSeenAt: true, reauthenticatedAt: true, createdAt: true, revokedAt: true, revokedReason: true,
    });
    await appendRows(db, records, "aiProviderCredential", "aiProviderCredential", { userId: actorId }, {
      id: true, userId: true, baseUrl: true, model: true, apiKeyFingerprint: true,
      revision: true, createdAt: true, updatedAt: true,
    });
    await appendRows(db, records, "controlledOperationRequest", "controlledOperationRequest", {
      requestedByUserId: actorId,
    }, {
      id: true, operationCode: true, operation: includeData, risk: true, requiresApproval: true,
      requestedByUserId: true, confirmedByUserId: true, approvedByUserId: true,
      requestedReason: includeData, status: true, requestedAt: true, expiresAt: true,
      confirmedAt: true, approvedAt: true, startedAt: true, finishedAt: true, attempt: true,
      failureCode: true, retryable: true, holdReasonCode: true, resultCode: true,
      evidenceHash: true, revision: true, createdAt: true, updatedAt: true,
    });
  }
  await appendRows(db, records, "workspaceInvitation", "workspaceInvitation", {
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
    OR: [
      { invitedByUserId: actorId },
      { acceptedByUserId: actorId },
      { emailNormalized: normalizeEmail(actorEmail) },
    ],
  }, {
    id: true, workspaceId: true, role: true, status: true, expiresAt: true,
    invitedByUserId: true, acceptedByUserId: true, revision: true, acceptedAt: true,
    revokedAt: true, createdAt: true, updatedAt: true,
  });
}

async function appendSimulationAndTaskRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, workspaceIds, scope, includeData } = context;
  const examWhere = {
    ownerUserId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  const taskWhere = {
    ownerUserId: actorId,
    ...(scope === "WORKSPACE" ? { subject: { workspaceId: { in: [...workspaceIds] } } } : {}),
  };
  await appendRows(db, records, "simulationSubjectResult", "simulationSubjectResult", {
    simulationExam: examWhere,
  }, {
    id: true, simulationExamId: true, subjectId: true, paperFullScore: true, targetScore: true,
    actualScore: true, durationMinutes: true, blankQuestionCount: true,
    lossReasons: includeData, summary: includeData, revision: true,
  });
  await appendRows(db, records, "simulationLossItem", "simulationLossItem", {
    simulationSubjectResult: { simulationExam: examWhere },
  }, {
    id: true, simulationSubjectResultId: true, reason: true, syllabusNodeId: true,
    lostScore: true, note: includeData, revision: true, archivedAt: true,
    mistakeId: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "taskDependency", "taskDependency", {
    predecessor: taskWhere, successor: taskWhere,
  }, {
    id: true, predecessorId: true, successorId: true, type: true, revision: true,
    actorId: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "planInboxDependencyRef", "planInboxDependencyRef", {
    inboxItem: {
      ownerUserId: actorId,
      ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
    },
  }, {
    id: true, inboxItemId: true, targetType: true, dependencyType: true, taskId: true,
    importBatchId: true, planStableKey: true, planOriginVersion: true, createdAt: true,
  });
}

async function appendTaskRelationRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, workspaceIds, scope } = context;
  const taskWhere = {
    ownerUserId: actorId,
    ...(scope === "WORKSPACE" ? { subject: { workspaceId: { in: [...workspaceIds] } } } : {}),
  };
  const noteWhere = {
    ownerUserId: actorId,
    ...(scope === "WORKSPACE" ? { subject: { workspaceId: { in: [...workspaceIds] } } } : {}),
  };
  await appendRows(db, records, "studyTaskRelatedSyllabusNode", "studyTaskRelatedSyllabusNode", {
    task: taskWhere,
  }, { id: true, taskId: true, syllabusNodeId: true, createdAt: true });
  await appendRows(db, records, "studyTaskStageLink", "studyTaskStageLink", {
    task: taskWhere,
  }, { id: true, taskId: true, stagePlanId: true, createdAt: true });
  await appendRows(db, records, "studyTaskKnowledgePoint", "studyTaskKnowledgePoint", {
    task: taskWhere,
  }, { id: true, taskId: true, knowledgePointId: true, createdAt: true });
  await appendRows(db, records, "noteRelatedSyllabusNode", "noteRelatedSyllabusNode", {
    note: noteWhere,
  }, { id: true, noteId: true, syllabusNodeId: true, createdAt: true });
  await appendRows(db, records, "noteMistakeLink", "noteMistakeLink", {
    note: noteWhere,
  }, { id: true, noteId: true, mistakeId: true, createdAt: true });
}

async function appendResourceRelationRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, workspaceIds, scope } = context;
  const resourceWhere = {
    ownerUserId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  await appendRows(db, records, "studyResourceTag", "studyResourceTag", {
    resource: resourceWhere,
  }, { id: true, resourceId: true, tagNorm: true, tagDisplay: true, createdAt: true });
  await appendRows(db, records, "studyResourceTaskLink", "studyResourceTaskLink", {
    resource: resourceWhere,
  }, { id: true, resourceId: true, taskId: true, createdAt: true });
  await appendRows(db, records, "studyResourceNoteLink", "studyResourceNoteLink", {
    resource: resourceWhere,
  }, { id: true, resourceId: true, noteId: true, createdAt: true });
  await appendRows(db, records, "studyResourceMistakeLink", "studyResourceMistakeLink", {
    resource: resourceWhere,
  }, { id: true, resourceId: true, mistakeId: true, createdAt: true });
  await appendRows(db, records, "studyResourceSyllabusNodeLink", "studyResourceSyllabusNodeLink", {
    resource: resourceWhere,
  }, { id: true, resourceId: true, syllabusNodeId: true, createdAt: true });
}

async function appendImportAndReviewRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, workspaceIds, scope, includeData } = context;
  const batchWhere = {
    actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  const ownerWorkspaceWhere = {
    ownerUserId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  await appendRows(db, records, "learningTreeImportBatch", "learningTreeImportBatch", batchWhere, {
    id: true, workspaceId: true, protocolVersion: true, parserVersion: true, scope: true,
    canonicalMarkdown: includeData, sourceSha256: true, canonicalPlanHash: true, rootRevision: true,
    statsJson: includeData, resultJson: includeData, archivedAt: true, actorId: true,
    confirmedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "learningTreeImportItem", "learningTreeImportItem", {
    batch: batchWhere,
  }, {
    id: true, batchId: true, stableRef: true, objectType: true, diffType: true,
    sourceLine: true, sourceTargetKey: true, mappedTargetId: true, mappedTargetKey: true,
    userChoice: true, applyResult: true, redactedErrorCode: true, createdAt: true,
  });
  await appendRows(db, records, "learningTreeExportGrant", "learningTreeExportGrant", {
    actorId, ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  }, {
    id: true, actorId: true, workspaceId: true, scope: true, subjectKey: true, rootNodeKey: true,
    sourceSha256: true, rootRevision: true, expiresAt: true, consumedAt: true, createdAt: true,
  });
  await appendRows(db, records, "reviewEvent", "reviewEvent", {
    reviewSchedule: ownerWorkspaceWhere,
  }, {
    id: true, reviewScheduleId: true, expectedRevision: true, appliedRevision: true,
    result: true, durationSeconds: true, confirmedAt: true, learningDate: true, nextDueDate: true,
    consecutivePassDelta: true, correctedEventId: true, note: includeData, actorId: true, createdAt: true,
  });
  await appendRows(db, records, "mistakeAttempt", "mistakeAttempt", {
    mistake: {
      ownerUserId: actorId,
      ...(scope === "WORKSPACE" ? { subject: { workspaceId: { in: [...workspaceIds] } } } : {}),
    },
  }, {
    id: true, mistakeId: true, reviewEventId: true, answerMode: true, answerText: includeData,
    result: true, durationSeconds: true, note: includeData, attemptedAt: true, actorId: true,
  });
}

async function appendKnowledgeRelationRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, workspaceIds, scope, includeData } = context;
  const knowledgeWhere = {
    userId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  const stageWhere = {
    ownerUserId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  await appendRows(db, records, "knowledgeCanvasNodeLayout", "knowledgeCanvasNodeLayout", {
    layout: knowledgeWhere,
  }, {
    id: true, layoutId: true, entityType: true, entityId: true, x: true, y: true,
    collapsed: true, pinned: true, hidden: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "knowledgePointSubject", "knowledgePointSubject", {
    knowledgePoint: knowledgeWhere,
  }, { id: true, knowledgePointId: true, subjectId: true, role: true, createdAt: true });
  await appendRows(db, records, "knowledgePointRelation", "knowledgePointRelation", {
    fromPoint: knowledgeWhere, toPoint: knowledgeWhere,
  }, { id: true, fromPointId: true, toPointId: true, type: true, actorId: true, createdAt: true });
  await appendRows(db, records, "knowledgeSyllabusLink", "knowledgeSyllabusLink", {
    knowledgePoint: knowledgeWhere,
  }, { id: true, knowledgePointId: true, syllabusNodeId: true, role: true, createdAt: true });
  await appendRows(db, records, "stageGoalLink", "stageGoalLink", {
    stagePlan: stageWhere, terminalGoal: knowledgeWhere,
  }, { id: true, stagePlanId: true, terminalGoalId: true, role: true, createdAt: true });
  await appendRows(db, records, "stageKnowledgeTarget", "stageKnowledgeTarget", {
    stagePlan: stageWhere, knowledgePoint: knowledgeWhere,
  }, {
    id: true, stagePlanId: true, knowledgePointId: true, targetState: true, importance: true,
    feedback: includeData, revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "learningArrangementKnowledgePoint", "learningArrangementKnowledgePoint", {
    arrangement: knowledgeWhere, knowledgePoint: knowledgeWhere,
  }, { id: true, arrangementId: true, knowledgePointId: true, createdAt: true });
}

async function appendSessionRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, workspaceIds, scope, includeData } = context;
  const sessionWhere = {
    userId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  const knowledgeWhere = {
    userId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  };
  await appendRows(db, records, "studySessionCloseout", "studySessionCloseout", {
    session: sessionWhere,
  }, {
    id: true, sessionId: true, understanding: true, efficiency: true, lowReasons: includeData,
    focusLevel: true, energyLevel: true, summary: includeData, nextDisposition: includeData,
    revision: true, submittedAt: true, actorId: true,
  });
  await appendRows(db, records, "studySessionDevicePresence", "studySessionDevicePresence", {
    userId: actorId,
    ...(scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {}),
  }, {
    id: true, sessionId: true, userId: true, workspaceId: true, deviceLabel: includeData,
    lastSeenAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "studySessionKnowledgePoint", "studySessionKnowledgePoint", {
    session: sessionWhere, knowledgePoint: knowledgeWhere,
  }, {
    id: true, sessionId: true, knowledgePointId: true, understanding: true,
    note: includeData, createdAt: true,
  });
  await appendRows(db, records, "knowledgeRetestPoint", "knowledgeRetestPoint", {
    retest: knowledgeWhere, knowledgePoint: knowledgeWhere,
  }, {
    id: true, retestId: true, knowledgePointId: true, result: true, score: true,
    understanding: true, note: includeData,
  });
}

async function appendRankingRecords(context: ExportContext): Promise<void> {
  const { db, records, actorId, workspaceIds, scope, includeData } = context;
  const workspaceFilter = scope === "WORKSPACE" ? { workspaceId: { in: [...workspaceIds] } } : {};
  await appendRows(db, records, "privateChallenge", "privateChallenge", {
    ...workspaceFilter,
    OR: [{ ownerUserId: actorId }, { participants: { some: { userId: actorId } } }],
  }, {
    id: true, workspaceId: true, ownerUserId: true, name: includeData, description: includeData,
    status: true, timezone: true, startDate: true, endDate: true, targetEffectiveMinutesPerDay: true,
    scoreVersion: true, rulesVersion: true, publishedFields: true, revision: true,
    startedAt: true, endedAt: true, closedAt: true, dissolvedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "privateChallengeParticipant", "privateChallengeParticipant", {
    userId: actorId,
    ...(scope === "WORKSPACE" ? { challenge: workspaceFilter } : {}),
  }, {
    id: true, challengeId: true, userId: true, invitedByUserId: true, status: true,
    nickname: includeData, authorizedFields: true, revision: true, joinedAt: true,
    leftAt: true, removedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "rankingAppeal", "rankingAppeal", {
    submittedByUserId: actorId,
    ...(scope === "WORKSPACE" ? { challenge: workspaceFilter } : {}),
  }, {
    id: true, challengeId: true, participantId: true, submittedByUserId: true,
    reviewedByUserId: true, status: true, reason: includeData, projectionFingerprint: true,
    revision: true, reviewedAt: true, createdAt: true, updatedAt: true,
  });
}
