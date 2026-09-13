import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { appendRows, type DataExportRecordTarget, type ExportRecordDelegate } from "./data-export-record-target";

export async function appendPrimaryExportRecords(client: PrismaClient | Prisma.TransactionClient, records: DataExportRecordTarget, actorId: string, workspaceIds: readonly string[], scope: "ACCOUNT" | "WORKSPACE", includeData: boolean): Promise<void> {
  const db = client as unknown as Record<string, ExportRecordDelegate>;
  const workspaceWhere = { workspaceId: { in: [...workspaceIds] } };
  const ownerWhere = scope === "WORKSPACE" ? { ownerUserId: actorId, ...workspaceWhere } : { ownerUserId: actorId };
  const userWhere = scope === "WORKSPACE" ? { userId: actorId, workspaceId: { in: [...workspaceIds] } } : { userId: actorId };
  const subjectOwnerWhere = scope === "WORKSPACE"
    ? { ownerUserId: actorId, subject: workspaceWhere }
    : { ownerUserId: actorId };

  if (scope === "ACCOUNT") {
    await appendRows(db, records, "account", "user", { id: actorId }, {
      id: true, email: true, status: true, emailVerifiedAt: true, createdAt: true, updatedAt: true,
    });
  }
  await appendRows(db, records, "syllabusNodeProgress", "syllabusNodeProgress", scope === "WORKSPACE"
    ? { ownerUserId: actorId, syllabusNode: { subject: workspaceWhere } }
    : { ownerUserId: actorId }, {
    id: true, syllabusNodeId: true, ownerUserId: true, status: true, masteryLevel: true, targetMinutes: true, actualMinutes: true, revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "studyTask", "studyTask", scope === "WORKSPACE" ? subjectOwnerWhere : { ownerUserId: actorId }, {
    id: true, ownerUserId: true, subjectId: true, syllabusNodeId: true, parentTaskId: true, planMilestoneId: true, reviewScheduleId: true,
    title: true, type: true, status: true, priority: true, debtStatus: true, plannedDate: true, estimatedMinutes: true,
    actualMinutes: true, reviewText: includeData, completedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "studySession", "studySession", scope === "WORKSPACE" ? { ...userWhere } : { userId: actorId }, {
    id: true, subjectId: true, taskId: true, syllabusNodeId: true, activityKind: true, activityMode: true, status: true,
    reviewScheduleId: true, knowledgeRetestId: true, simulationExamId: true,
    startedAt: true, pausedAt: true, endedAt: true, accumulatedPauseSeconds: true, effectiveMinutes: true, qualityScore: true,
    isEffective: true, understandingLevel: true, minimalOutput: includeData, nextAction: includeData, producedNote: true, producedMistake: true,
    isLowConversion: true, antiFakeReason: includeData, requiredOutput: includeData, closeoutVersion: true, note: includeData, goalMinutes: true,
    userId: true, workspaceId: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "dailyReview", "dailyReview", scope === "WORKSPACE" ? { ...ownerWhere } : { ownerUserId: actorId }, {
    id: true, workspaceId: true, ownerUserId: true, revision: true, reviewDate: true, totalMinutes: true, effectiveMinutes: true,
    summary: includeData, lostControl: true, keepAction: includeData, tomorrowMinimum: includeData, mood: includeData, aiSuggestion: includeData, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "checkIn", "checkIn", scope === "WORKSPACE" ? { ...ownerWhere } : { ownerUserId: actorId }, {
    id: true, ownerUserId: true, workspaceId: true, studyDate: true, completedMinimumAction: true, totalMinutes: true,
    effectiveMinutes: true, effectiveSessionCount: true, taskCompletionRate: true, reviewSubmitted: true, lowEfficiency: true,
    lowConversionCount: true, sourceVersion: true, reviewCount: true, reviewSeconds: true, passedCount: true, partialCount: true,
    failedCount: true, minimumActionSource: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "note", "note", subjectOwnerWhere, {
    id: true, ownerUserId: true, subjectId: true, syllabusNodeId: true, taskId: true, kind: true, studyDate: true,
    stableKey: true, revision: true, title: true, content: includeData, masteryStatus: true, nextReviewAt: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "attachment", "attachment", scope === "WORKSPACE" ? { ownerUserId: actorId, OR: [{ note: { subject: workspaceWhere } }, { studyResource: workspaceWhere }] } : { ownerUserId: actorId }, {
    id: true, ownerUserId: true, noteId: true, originalName: true, mimeType: true, sizeBytes: true, hash: true, status: true, protocolVersion: true, finalizedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "mistake", "mistake", subjectOwnerWhere, {
    id: true, ownerUserId: true, subjectId: true, syllabusNodeId: true, title: true, questionText: includeData, source: true,
    cause: true, causeNote: includeData, correctAnswer: includeData, correctIdea: includeData, nextReviewAt: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "studyResource", "studyResource", scope === "WORKSPACE" ? ownerWhere : { ownerUserId: actorId }, {
    id: true, workspaceId: true, ownerUserId: true, stableKey: true, title: true, category: true, sourceType: true,
    subjectId: true, attachmentId: true, externalUrl: true, displayHost: true, duplicateOfResourceId: true, revision: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "simulationExam", "simulationExam", scope === "WORKSPACE" ? ownerWhere : { ownerUserId: actorId }, {
    id: true, workspaceId: true, ownerUserId: true, name: true, examDate: true, isFirstSynchronized: true, targetDurationMinutes: true,
    actualDurationMinutes: true, targetScore: true, actualScore: true, blankQuestionCount: true, mindset: true, summary: includeData,
    reviewText: includeData, status: true, confirmedAt: true, revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "stagePlan", "stagePlan", scope === "WORKSPACE" ? ownerWhere : { ownerUserId: actorId }, {
    id: true, workspaceId: true, ownerUserId: true, stableKey: true, revision: true, name: true, startDate: true, endDate: true,
    goal: includeData, mode: true, status: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "planMilestone", "planMilestone", scope === "WORKSPACE" ? ownerWhere : { ownerUserId: actorId }, {
    id: true, workspaceId: true, ownerUserId: true, stagePlanId: true, subjectId: true, stableKey: true, title: true,
    targetDate: true, sortOrder: true, status: true, revision: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "reviewSchedule", "reviewSchedule", scope === "WORKSPACE" ? ownerWhere : { ownerUserId: actorId }, {
    id: true, workspaceId: true, ownerUserId: true, targetType: true, noteId: true, mistakeId: true, studyResourceId: true,
    syllabusNodeId: true, status: true, dueDate: true, pausedReason: true, consecutivePassCount: true, revision: true, createdAt: true, updatedAt: true,
  });
  if (scope === "ACCOUNT") {
    await appendRows(db, records, "motivationVault", "motivationVault", { userId: actorId }, {
      id: true, userId: true, whyStarted: includeData, neverReturnTo: includeData, futureSelf: includeData, messageToFuture: includeData,
      firstSimulationDiary: includeData, createdAt: true, updatedAt: true,
    });
    await appendRows(db, records, "motivationItem", "motivationItem", { userId: actorId }, {
      id: true, userId: true, type: true, title: true, body: includeData, externalUrl: true, enabled: true, sortOrder: true,
      revision: true, archivedAt: true, createdAt: true, updatedAt: true,
    });
    await appendRows(db, records, "notificationPreference", "notificationPreference", { userId: actorId }, {
      id: true, userId: true, reviewDueEnabled: true, planStartEnabled: true, eveningReviewEnabled: true, reviewDueWindowStart: true,
      reviewDueWindowEnd: true, planStartWindowStart: true, planStartWindowEnd: true, eveningReviewWindowStart: true,
      eveningReviewWindowEnd: true, quietHoursStart: true, quietHoursEnd: true, revision: true, createdAt: true, updatedAt: true,
    });
  }
  await appendRows(db, records, "userNotification", "userNotification", scope === "WORKSPACE"
    ? { recipientUserId: actorId, workspaceId: { in: [...workspaceIds] } }
    : { recipientUserId: actorId }, {
    id: true, recipientUserId: true, workspaceId: true, workspaceLabel: true, kind: true,
    readAt: true, dismissedAt: true, revision: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, records, "dataJob", "dataJob", scope === "WORKSPACE"
    ? { requestedByUserId: actorId, workspaceId: { in: [...workspaceIds] } }
    : { requestedByUserId: actorId }, {
    id: true, kind: true, scope: true, status: true, progress: true, attempt: true, errorCode: true, retryable: true, expiresAt: true, createdAt: true, updatedAt: true,
  });
}
