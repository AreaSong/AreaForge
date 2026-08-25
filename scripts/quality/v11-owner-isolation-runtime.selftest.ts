import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { createNoteAttachment } from "../../apps/web/lib/study/attachments-service";
import { createMistakeAttempt } from "../../apps/web/lib/study/mistake-attempt-service";
import {
  createMistake,
  getMistakeById,
  getOwnedMistakeDetail,
  listMistakes,
  updateMistake,
  updateMistakeLinks,
} from "../../apps/web/lib/study/mistakes-service";
import {
  archiveNote,
  createNote,
  getNoteById,
  getOwnedNoteDetail,
  listNotes,
  restoreNote,
  updateNote,
} from "../../apps/web/lib/study/notes-service";
import { getAnalyticsSummary } from "../../apps/web/lib/study/analytics-service";
import {
  getKnowledgeCanvas,
  saveKnowledgeCanvasLayout,
} from "../../apps/web/lib/study/knowledge-canvas-service";
import {
  createPlanInboxItem,
  dismissPlanInboxItem,
  listPlanInboxItems,
} from "../../apps/web/lib/study/plan-inbox-service";
import { createTaskDependency } from "../../apps/web/lib/study/task-dependency-service";
import {
  addMasteryEvidence,
  addMasteryRetest,
  createSyllabusNode,
  getSyllabusNode,
  getSyllabusMapOverview,
  listSyllabusOptions,
  updateSyllabusNode,
} from "../../apps/web/lib/study/syllabus-service";
import {
  createLinkStudyResource,
  getStudyResource,
  getStudyResourceEditorOptions,
  linkStudyResource,
  listStudyResources,
  updateStudyResource,
} from "../../apps/web/lib/study/study-resource-service";
import {
  addSimulationRemediationsToInbox,
  completeSimulationTask,
  confirmSimulationExam,
  createSimulationExam,
  createSimulationLossItem,
  createSimulationTask,
  getSimulationExam,
  listSimulationExams,
  listSimulationRemediations,
  listSimulationTasks,
  saveSimulationExamResults,
} from "../../apps/web/lib/study/simulation-service";
import {
  confirmReviewEvent,
  correctReviewEvent,
  materializeReviewSchedule,
  pauseReviewSchedule,
  rescheduleReview,
  resumeReviewSchedule,
} from "../../apps/web/lib/study/review-schedule-service";
import {
  activateExamWorkspace,
  updateWorkspaceSubject,
} from "../../apps/web/lib/study/exam-workspace-service";
import {
  createStudyTask,
  updateStudyTask,
} from "../../apps/web/lib/study/task-command-service";
import { getTodayDashboard } from "../../apps/web/lib/study/dashboard-query-service";
import {
  getTodayReview,
  saveTodayReview,
  updateDailyReview,
} from "../../apps/web/lib/study/daily-review-service";
import { pauseStudySession, startStudySession } from "../../apps/web/lib/study/session-lifecycle-service";
import { getActiveStudySession } from "../../apps/web/lib/study/session-query-service";
import { listStudyTasks, listSubjects } from "../../apps/web/lib/study/study-query-service";
import { getStudyTaskDetail } from "../../apps/web/lib/study/task-detail-service";

const checks: string[] = [];

try {
  await assertIsolatedDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
  const own = await seedOwner("owner");
  const other = await seedOwner("other");

  const ownTask = await prisma.studyTask.create({
    data: { subjectId: own.subjectId, title: "own task", type: "focus", plannedDate: new Date() },
  });
  const otherTask = await prisma.studyTask.create({
    data: { subjectId: other.subjectId, title: "other task", type: "focus", plannedDate: new Date() },
  });
  const ownNote = await prisma.note.create({
    data: { subjectId: own.subjectId, title: "own note", content: "own" },
  });
  const otherNote = await prisma.note.create({
    data: { subjectId: other.subjectId, title: "other note", content: "private" },
  });
  const ownMistake = await prisma.mistake.create({
    data: { subjectId: own.subjectId, title: "own mistake", cause: "UNKNOWN" },
  });
  const otherMistake = await prisma.mistake.create({
    data: { subjectId: other.subjectId, title: "other mistake", cause: "UNKNOWN" },
  });
  const ownNode = await prisma.syllabusNode.create({
    data: { subjectId: own.subjectId, title: "own node", kind: "TOPIC" },
  });
  const otherNode = await prisma.syllabusNode.create({
    data: { subjectId: other.subjectId, title: "other node", kind: "TOPIC" },
  });
  const ownInbox = await createPlanInboxItem(own.userId, {
    stableKey: "own-inbox",
    originKey: "owner-isolation:own",
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "owner-isolation" },
    title: "own inbox",
  });
  const otherInbox = await createPlanInboxItem(other.userId, {
    stableKey: "other-inbox",
    originKey: "owner-isolation:other",
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "owner-isolation" },
    title: "other inbox",
  });

  assert.deepEqual((await listSubjects(own.userId)).map((row) => row.id), [own.subjectId]);
  assert.deepEqual((await listStudyTasks(own.userId)).map((row) => row.id), [ownTask.id]);
  assert.deepEqual((await listNotes(own.userId)).map((row) => row.id), [ownNote.id]);
  assert.deepEqual((await listMistakes(own.userId)).map((row) => row.id), [ownMistake.id]);
  assert.deepEqual((await listPlanInboxItems(own.userId)).map((row) => row.id), [ownInbox.id]);
  checks.push("owner_scoped_lists");

  const ownCompleteMistake = await createMistake({
    idempotencyKey: `owner-mistake-v2-${randomUUID()}`,
    subjectId: own.subjectId,
    title: "owner mistake v2",
    questionText: "owner-only question",
    cause: "concept_confusion",
    correctIdea: "owner-only idea",
  }, own.userId);
  await rejectsApi(() => createMistakeAttempt(otherMistake.id, {
    idempotencyKey: `cross-owner-attempt-${randomUUID()}`,
    answerMode: "PAPER_OR_ORAL",
    result: "FAILED",
  }, own.userId), "MISTAKE_NOT_FOUND");
  await rejectsApi(() => updateMistakeLinks(ownCompleteMistake.id, {
    expectedUpdatedAt: ownCompleteMistake.updatedAt,
    noteIds: [otherNote.id],
    resourceIds: [],
  }, own.userId), "NOTE_NOT_FOUND");
  const otherResource = await prisma.studyResource.create({
    data: { workspaceId: other.workspaceId, subjectId: other.subjectId, stableKey: `other-resource-${randomUUID()}`, title: "other resource", sourceType: "LINK", externalUrl: "https://example.com/other" },
  });
  await rejectsApi(() => updateMistakeLinks(ownCompleteMistake.id, {
    expectedUpdatedAt: ownCompleteMistake.updatedAt,
    noteIds: [],
    resourceIds: [otherResource.id],
  }, own.userId), "STUDY_RESOURCE_NOT_FOUND");
  checks.push("mistake_v2_owner_isolation");

  assert.deepEqual((await listSyllabusOptions(own.userId)).map((row) => row.id), [ownNode.id]);
  assert.deepEqual((await getSyllabusMapOverview(own.userId)).nodes.map((row) => row.id), [ownNode.id]);
  await rejectsApi(() => updateSyllabusNode(otherNode.id, { expectedRevision: otherNode.revision, title: "hijacked" }, own.userId), "SYLLABUS_NODE_NOT_FOUND");
  const dashboard = await getTodayDashboard(own.userId);
  assert.equal(dashboard.tasks.some((row) => row.id === otherTask.id), false);
  const analytics = await getAnalyticsSummary(new Date(), own.userId);
  assert.deepEqual(analytics.subjects.map((row) => row.subjectId), [own.subjectId]);
  checks.push("dashboard_analytics_syllabus_scoped");

  const initialLayout = await saveKnowledgeCanvasLayout(own.userId, {
    workspaceId: own.workspaceId,
    expectedRevision: 1,
    viewportX: 1,
  });
  assert.equal(initialLayout.revision, 2);
  await rejectsApi(() => saveKnowledgeCanvasLayout(own.userId, {
    workspaceId: own.workspaceId,
    expectedRevision: 1,
    viewportX: 99,
  }), "LAYOUT_REVISION_CONFLICT");
  const concurrentLayouts = await Promise.allSettled([
    saveKnowledgeCanvasLayout(own.userId, {
      workspaceId: own.workspaceId,
      expectedRevision: initialLayout.revision,
      viewportX: 2,
    }),
    saveKnowledgeCanvasLayout(own.userId, {
      workspaceId: own.workspaceId,
      expectedRevision: initialLayout.revision,
      viewportX: 3,
    }),
  ]);
  assert.equal(concurrentLayouts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentLayouts.filter((result) => result.status === "rejected").length, 1);
  const layoutConflict = concurrentLayouts.find((result) => result.status === "rejected");
  assert.ok(layoutConflict?.status === "rejected" && layoutConflict.reason instanceof ApiError);
  assert.equal(layoutConflict.reason.message, "LAYOUT_REVISION_CONFLICT");
  checks.push("knowledge_canvas_layout_atomic_cas");

  const ownCanvas = await getKnowledgeCanvas(own.userId, {
    workspaceId: own.workspaceId,
    depth: 4,
    limit: 200,
  });
  assert.equal(ownCanvas.nodes.some((node) => node.id.includes(otherTask.id)), false);
  assert.equal(ownCanvas.nodes.some((node) => node.id.includes(otherNote.id)), false);
  await rejectsApi(() => getKnowledgeCanvas(own.userId, {
    workspaceId: other.workspaceId,
    depth: 1,
    limit: 50,
  }), "WORKSPACE_NOT_FOUND");
  await rejectsApi(() => saveKnowledgeCanvasLayout(own.userId, {
    workspaceId: other.workspaceId,
    expectedRevision: 1,
  }), "WORKSPACE_NOT_FOUND");
  checks.push("knowledge_canvas_owner_scope");

  assert.equal(await getNoteById(otherNote.id, own.userId), null);
  assert.equal(await getMistakeById(otherMistake.id, own.userId), null);
  checks.push("foreign_details_hidden");

  await rejectsApi(() => createStudyTask({
    idempotencyKey: `owner-cross-task-${randomUUID()}`,
    subjectId: other.subjectId,
    title: "cross owner task",
    type: "focus",
    priority: "medium",
    estimatedMinutes: 25,
  }, own.userId), "SUBJECT_NOT_FOUND");
  await rejectsApi(() => createNote({
    idempotencyKey: `owner-cross-note-${randomUUID()}`,
    subjectId: other.subjectId,
    title: "cross owner note",
    content: "blocked",
  }, own.userId), "SUBJECT_NOT_FOUND");
  await rejectsApi(() => createMistake({
    idempotencyKey: `owner-cross-mistake-${randomUUID()}`,
    subjectId: other.subjectId,
    title: "cross owner mistake",
    questionText: "cross owner question",
    cause: "unknown",
  }, own.userId), "SUBJECT_NOT_FOUND");
  checks.push("foreign_parent_creation_rejected");

  await rejectsApi(
    () => updateStudyTask(otherTask.id, {
      expectedStatus: "todo",
      expectedUpdatedAt: new Date(0).toISOString(),
      title: "hijacked",
    }, own.userId),
    "TASK_NOT_FOUND",
  );
  await rejectsApi(
    () => updateMistake(otherMistake.id, { title: "hijacked" }, own.userId),
    "MISTAKE_NOT_FOUND",
  );
  assert.equal((await prisma.studyTask.findUniqueOrThrow({ where: { id: otherTask.id } })).title, "other task");
  assert.equal((await prisma.mistake.findUniqueOrThrow({ where: { id: otherMistake.id } })).title, "other mistake");
  checks.push("foreign_updates_rejected");

  await rejectsApi(
    () => dismissPlanInboxItem(own.userId, otherInbox.id, otherInbox.revision),
    "PLAN_INBOX_ITEM_NOT_FOUND",
  );
  await rejectsApi(
    () => createTaskDependency(own.userId, {
      predecessorId: ownTask.id,
      successorId: otherTask.id,
      type: "HARD",
    }),
    "TASK_NOT_FOUND",
  );
  assert.equal(await prisma.taskDependency.count(), 0);
  checks.push("plan_inbox_and_dependency_owner_scope");

  await rejectsApi(
    () => createNoteAttachment({
      noteId: otherNote.id,
      idempotencyKey: `owner-cross-attachment-${randomUUID()}`,
      scan: {
        originalName: "blocked.png",
        declaredMimeType: "image/png",
        detectedMimeType: "image/png",
        sizeBytes: 8,
        sha256Hex: "0".repeat(64),
        bytes: new Uint8Array(8),
      },
    }, own.userId),
    "NOTE_NOT_FOUND",
  );
  checks.push("foreign_attachment_rejected_before_write");

  await verifyArchivedSubjectBoundary(own);
  await verifyHistoricalWorkspaceReadsAndWrites(own.userId, other.userId);
  await verifySubjectArchiveWriteRace(own);

  const createReviewInput = {
    idempotencyKey: `owner-review-create-${randomUUID()}`,
    summary: "完成隔离验证",
    keepAction: "继续",
    tomorrowMinimum: "25 分钟",
  };
  const [review, concurrentReplay] = await Promise.all([
    saveTodayReview(createReviewInput, own.userId),
    saveTodayReview(createReviewInput, own.userId),
  ]);
  assert.deepEqual(concurrentReplay, review);
  assert.deepEqual(await saveTodayReview(createReviewInput, own.userId), review);
  assert.equal((await getTodayReview(own.userId))?.id, review.id);
  const storedReview = await prisma.dailyReview.findUniqueOrThrow({ where: { id: review.id } });
  assert.equal(storedReview.workspaceId, own.workspaceId);
  const inbox = await prisma.planInboxItem.findFirstOrThrow({
    where: { workspaceId: own.workspaceId, originType: "DAILY_REVIEW_MINIMUM" },
  });
  assert.equal(inbox.title, "25 分钟");
  assert.equal(await prisma.planInboxItem.count({
    where: { workspaceId: own.workspaceId, originType: "DAILY_REVIEW_MINIMUM" },
  }), 1);
  assert.equal(await prisma.auditEvent.count({
    where: {
      action: "DAILY_REVIEW_TODAY_SAVED",
      metadata: { path: ["idempotencyKey"], equals: createReviewInput.idempotencyKey },
    },
  }), 1);
  const beforeConflict = await dailyReviewWriteCounts(own.workspaceId);
  await assert.rejects(
    () => saveTodayReview({ ...createReviewInput, summary: "同键不同请求不得覆盖" }, own.userId),
    (error: unknown) => error instanceof ApiError
      && error.code === "DAILY_REVIEW_IDEMPOTENCY_CONFLICT"
      && error.details?.workbench === "/roadmap/reviews/daily"
      && error.details?.conflictFields?.includes("idempotencyKey") === true
      && (error.details.latest as { id?: string } | undefined)?.id === review.id,
  );
  assert.deepEqual(await dailyReviewWriteCounts(own.workspaceId), beforeConflict);

  const updateReviewInput = {
    idempotencyKey: `owner-review-update-${randomUUID()}`,
    expectedRevision: review.revision,
    summary: "完成隔离验证并更新",
    keepAction: "继续",
    tomorrowMinimum: "30 分钟",
  };
  const updatedReview = await updateDailyReview(review.id, updateReviewInput, own.userId);
  assert.deepEqual(await updateDailyReview(review.id, updateReviewInput, own.userId), updatedReview);
  assert.equal(updatedReview.revision, review.revision + 1);
  const supersededInbox = await prisma.planInboxItem.findUniqueOrThrow({ where: { id: inbox.id } });
  const updatedInbox = await prisma.planInboxItem.findUniqueOrThrow({
    where: {
      workspaceId_originKey_originVersion: {
        workspaceId: own.workspaceId,
        originKey: inbox.originKey,
        originVersion: updatedReview.revision,
      },
    },
  });
  assert.equal(supersededInbox.title, "25 分钟");
  assert.equal(supersededInbox.supersededByItemId, updatedInbox.id);
  assert.equal(updatedInbox.title, "30 分钟");
  await rejectsApi(() => updateDailyReview(review.id, {
    idempotencyKey: `owner-review-stale-${randomUUID()}`,
    expectedRevision: review.revision,
    summary: "过期写入",
    keepAction: "不得保存",
    tomorrowMinimum: "不得保存",
  }, own.userId), "DAILY_REVIEW_REVISION_CONFLICT");

  const keyedTodayUpdateInput = {
    idempotencyKey: `owner-review-today-update-${randomUUID()}`,
    summary: "复盘兼容入口更新",
    keepAction: "继续",
    tomorrowMinimum: "35 分钟",
  };
  const keyedTodayUpdate = await saveTodayReview(keyedTodayUpdateInput, own.userId);
  assert.deepEqual(await saveTodayReview(keyedTodayUpdateInput, own.userId), keyedTodayUpdate);
  assert.equal(keyedTodayUpdate.revision, updatedReview.revision + 1);
  const legacyTodayUpdate = await saveTodayReview({
    summary: "旧请求体仍可更新",
    keepAction: "继续",
    tomorrowMinimum: "40 分钟",
  }, own.userId);
  assert.equal(legacyTodayUpdate.revision, keyedTodayUpdate.revision + 1);
  assert.equal(legacyTodayUpdate.tomorrowMinimum, "40 分钟");
  assert.equal(await getTodayReview(other.userId), null);
  checks.push("daily_review_workspace_cas_idempotency_legacy_and_inbox_atomicity");

  const session = await startStudySession({ subjectId: own.subjectId }, own.userId);
  assert.equal((await getActiveStudySession(own.userId))?.id, session.id);
  assert.equal(await getActiveStudySession(other.userId), null);
  await rejectsApi(() => pauseStudySession(session.id, other.userId), "SESSION_NOT_FOUND");
  assert.equal((await prisma.studySession.findUniqueOrThrow({ where: { id: session.id } })).status, "RUNNING");
  checks.push("session_owner_isolation");

  console.log(JSON.stringify({
    schemaVersion: "v11-owner-isolation-runtime-selftest-v1",
    status: "pass",
    checks,
  }, null, 2));
  console.log("PASS v1.1 owner isolation runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V11_OWNER_ISOLATION_DB !== "1") {
    throw new Error("requires AREAFORGE_V11_OWNER_ISOLATION_DB=1");
  }
  const [{ current_database: database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!database.includes("v11owner")) {
    throw new Error("refused database without v11owner marker");
  }
}

async function seedOwner(prefix: string): Promise<{
  userId: string;
  workspaceId: string;
  subjectId: string;
}> {
  const user = await prisma.user.create({
    data: { email: `${prefix}-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const workspace = await prisma.examWorkspace.create({
    data: { userId: user.id, stableKey: prefix, name: prefix, status: "ACTIVE" },
  });
  const subject = await prisma.subject.create({
    data: {
      workspaceId: workspace.id,
      stableKey: `${prefix}-subject`,
      name: `${prefix} subject`,
      color: "#14b8a6",
    },
  });
  return { userId: user.id, workspaceId: workspace.id, subjectId: subject.id };
}

async function verifyArchivedSubjectBoundary(seed: Awaited<ReturnType<typeof seedOwner>>): Promise<void> {
  const subject = await prisma.subject.create({
    data: {
      workspaceId: seed.workspaceId,
      stableKey: `archived-${randomUUID()}`,
      name: "archived subject",
      color: "#ef4444",
    },
  });
  const node = await createSyllabusNode({
    idempotencyKey: `owner-archived-node-${randomUUID()}`,
    subjectId: subject.id,
    title: "archived node",
    kind: "topic",
    status: "not_started",
    sortOrder: 10,
    targetMinutes: 30,
  }, seed.userId);
  const note = await createNote({
    idempotencyKey: `owner-archived-note-${randomUUID()}`,
    subjectId: subject.id,
    syllabusNodeId: node.id,
    title: "archived note",
    content: "historical note remains readable",
  }, seed.userId);
  const restorableNote = await createNote({
    idempotencyKey: `owner-archived-restorable-note-${randomUUID()}`,
    subjectId: subject.id,
    title: "archived restorable note",
    content: "restore must stay blocked while the subject is archived",
  }, seed.userId);
  const archivedRestorableNote = await archiveNote(restorableNote.id, restorableNote.revision, seed.userId);
  const mistake = await createMistake({
    idempotencyKey: `owner-archived-mistake-${randomUUID()}`,
    subjectId: subject.id,
    syllabusNodeId: node.id,
    title: "archived mistake",
    questionText: "archived mistake question",
    cause: "concept_confusion",
    correctIdea: "historical correction",
  }, seed.userId);
  const resource = await createLinkStudyResource(seed.userId, {
    title: "archived resource",
    url: `https://example.com/archive/${randomUUID()}`,
    subjectId: subject.id,
  });
  const simulationTask = await createSimulationTask({
    subjectId: subject.id,
    syllabusNodeId: node.id,
    title: "archived simulation task",
    estimatedMinutes: 120,
  }, seed.userId);
  const exam = await createSimulationExam({ idempotencyKey: `owner-archived-exam-${randomUUID()}`, name: "archived subject exam" }, seed.userId);
  const savedExam = await saveSimulationExamResults(exam.id, simulationResultInput(subject.id, exam.revision), seed.userId);
  const remediation = await listSimulationRemediations(savedExam.id, seed.userId);
  assert.equal(remediation.length, 1);
  const dueDate = new Date().toISOString();
  const noteSchedule = await materializeReviewSchedule(seed.userId, {
    targetType: "NOTE",
    noteId: note.id,
    dueDate,
  });
  const initialReview = await confirmReviewEvent(seed.userId, noteSchedule.id, {
    idempotencyKey: `owner-archived-review-${randomUUID()}`,
    expectedRevision: noteSchedule.revision,
    result: "PASSED",
    durationSeconds: 60,
  });

  const workspace = await prisma.examWorkspace.findUniqueOrThrow({ where: { id: seed.workspaceId } });
  await updateWorkspaceSubject(seed.userId, seed.workspaceId, subject.id, {
    expectedWorkspaceRevision: workspace.revision,
    archived: true,
  });

  await verifyArchivedHistoryReadable(seed.userId, {
    subjectId: subject.id,
    nodeId: node.id,
    noteId: note.id,
    mistakeId: mistake.id,
    resourceId: resource.id,
    examId: savedExam.id,
    simulationTaskId: simulationTask.id,
  });
  const pausedNoteSchedule = await prisma.reviewSchedule.findUniqueOrThrow({
    where: { id: noteSchedule.id },
  });
  assert.equal(pausedNoteSchedule.status, "PAUSED");
  assert.equal(pausedNoteSchedule.pausedReason, "SUBJECT_ARCHIVED");
  await verifyArchivedWritesRejected(seed.userId, {
    subjectId: subject.id,
    nodeId: node.id,
    noteId: note.id,
    noteRevision: note.revision,
    restorableNoteId: archivedRestorableNote.id,
    restorableNoteRevision: archivedRestorableNote.revision,
    mistakeId: mistake.id,
    noteSchedule: pausedNoteSchedule,
    reviewEventId: initialReview.event.id,
    resource,
    savedExam,
    remediation: remediation[0]!,
    simulationTaskId: simulationTask.id,
  });
  checks.push("archived_subject_history_readable_current_writes_blocked");
}

async function verifyArchivedHistoryReadable(
  actorId: string,
  ids: {
    subjectId: string;
    nodeId: string;
    noteId: string;
    mistakeId: string;
    resourceId: string;
    examId: string;
    simulationTaskId: string;
  },
): Promise<void> {
  assert.equal((await getNoteById(ids.noteId, actorId))?.id, ids.noteId);
  assert.equal((await getMistakeById(ids.mistakeId, actorId))?.id, ids.mistakeId);
  assert.equal((await getSyllabusNode(actorId, ids.nodeId)).id, ids.nodeId);
  assert.equal((await getStudyResource(actorId, ids.resourceId)).id, ids.resourceId);
  assert.equal((await getSimulationExam(ids.examId, actorId)).id, ids.examId);
  assert.equal((await listNotes(actorId)).some((row) => row.id === ids.noteId), true);
  assert.equal((await listMistakes(actorId)).some((row) => row.id === ids.mistakeId), true);
  assert.equal((await listStudyResources(actorId)).some((row) => row.id === ids.resourceId), true);
  assert.equal((await listSimulationExams(actorId)).some((row) => row.id === ids.examId), true);
  assert.equal((await listSimulationTasks(actorId)).some((row) => row.id === ids.simulationTaskId), true);
  const noteDetail = await getOwnedNoteDetail(ids.noteId, actorId);
  const mistakeDetail = await getOwnedMistakeDetail(ids.mistakeId, actorId);
  assert.equal(noteDetail?.readOnly, true);
  assert.equal(noteDetail?.subjectArchived, true);
  assert.equal(mistakeDetail?.readOnly, true);
  assert.equal(mistakeDetail?.subjectArchived, true);

  assert.equal((await listSubjects(actorId)).some((row) => row.id === ids.subjectId), false);
  assert.equal((await listSyllabusOptions(actorId)).some((row) => row.id === ids.nodeId), false);
  assert.equal((await listSimulationRemediations(ids.examId, actorId)).length, 0);
  const editorOptions = await getStudyResourceEditorOptions(actorId);
  assert.equal(editorOptions.subjects.some((row) => row.id === ids.subjectId), false);
  assert.equal(editorOptions.notes.some((row) => row.id === ids.noteId), false);
  assert.equal(editorOptions.mistakes.some((row) => row.id === ids.mistakeId), false);
  assert.equal(editorOptions.syllabusNodes.some((row) => row.id === ids.nodeId), false);
}

async function verifyArchivedWritesRejected(
  actorId: string,
  scenario: {
    subjectId: string;
    nodeId: string;
    noteId: string;
    noteRevision: number;
    restorableNoteId: string;
    restorableNoteRevision: number;
    mistakeId: string;
    noteSchedule: {
      id: string;
      revision: number;
    };
    reviewEventId: string;
    resource: Awaited<ReturnType<typeof createLinkStudyResource>>;
    savedExam: Awaited<ReturnType<typeof saveSimulationExamResults>>;
    remediation: Awaited<ReturnType<typeof listSimulationRemediations>>[number];
    simulationTaskId: string;
  },
): Promise<void> {
  const before = await archivedWriteCounts();
  const archivedMistake = await getMistakeById(scenario.mistakeId, actorId);
  assert.ok(archivedMistake, "archived-subject mistake must remain readable");
  await rejectsApi(
    () => archiveNote(scenario.noteId, scenario.noteRevision, actorId),
    "SUBJECT_ARCHIVED",
  );
  await rejectsApi(
    () => restoreNote(scenario.restorableNoteId, scenario.restorableNoteRevision, actorId),
    "SUBJECT_ARCHIVED",
  );
  await rejectsApi(() => materializeReviewSchedule(actorId, {
    targetType: "MISTAKE",
    mistakeId: scenario.mistakeId,
    dueDate: new Date().toISOString(),
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => resumeReviewSchedule(actorId, scenario.noteSchedule.id, {
    expectedRevision: scenario.noteSchedule.revision,
    dueDate: new Date().toISOString(),
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => rescheduleReview(actorId, scenario.noteSchedule.id, {
    expectedRevision: scenario.noteSchedule.revision,
    dueDate: new Date().toISOString(),
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => pauseReviewSchedule(actorId, scenario.noteSchedule.id, {
    expectedRevision: scenario.noteSchedule.revision,
    reason: "must remain read-only",
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => confirmReviewEvent(actorId, scenario.noteSchedule.id, {
    idempotencyKey: `owner-blocked-review-${randomUUID()}`,
    expectedRevision: scenario.noteSchedule.revision,
    result: "PASSED",
    durationSeconds: 60,
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => correctReviewEvent(actorId, scenario.reviewEventId, {
    idempotencyKey: `owner-blocked-correction-${randomUUID()}`,
    expectedRevision: scenario.noteSchedule.revision,
    result: "PARTIAL",
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => createNote({
    idempotencyKey: `owner-blocked-note-${randomUUID()}`,
    subjectId: scenario.subjectId,
    title: "blocked archived note",
    content: "blocked",
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => createMistake({
    idempotencyKey: `owner-blocked-mistake-${randomUUID()}`,
    subjectId: scenario.subjectId,
    title: "blocked archived mistake",
    questionText: "blocked archived mistake question",
    cause: "concept_confusion",
    correctIdea: "blocked",
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => updateMistake(scenario.mistakeId, {
    title: "blocked update",
    expectedUpdatedAt: archivedMistake.updatedAt,
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => createSyllabusNode({
    idempotencyKey: `owner-blocked-node-${randomUUID()}`,
    subjectId: scenario.subjectId,
    title: "blocked archived node",
    kind: "topic",
    status: "not_started",
    sortOrder: 20,
    targetMinutes: 20,
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => updateSyllabusNode(scenario.nodeId, { expectedRevision: 1, title: "blocked update" }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => addMasteryEvidence(scenario.nodeId, {
    evidenceType: "note",
    noteId: scenario.noteId,
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => addMasteryRetest(scenario.nodeId, {
    idempotencyKey: `owner-blocked-retest-${randomUUID()}`,
    result: "passed",
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => createLinkStudyResource(actorId, {
    title: "blocked archived resource",
    url: `https://example.com/blocked/${randomUUID()}`,
    subjectId: scenario.subjectId,
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => updateStudyResource(actorId, scenario.resource.id, {
    expectedRevision: scenario.resource.revision,
    title: "blocked update",
  }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => linkStudyResource(actorId, scenario.resource.id, { noteIds: [scenario.noteId] }), "SUBJECT_ARCHIVED");
  await rejectsApi(() => saveSimulationExamResults(
    scenario.savedExam.id,
    simulationResultInput(scenario.subjectId, scenario.savedExam.revision, scenario.savedExam.subjectResults[0]?.revision),
    actorId,
  ), "SUBJECT_ARCHIVED");
  await rejectsApi(() => createSimulationLossItem(scenario.savedExam.subjectResults[0]!.id, {
    idempotencyKey: `owner-blocked-loss-${randomUUID()}`,
    reason: "CONCEPT_GAP",
    lostScore: 1,
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => addSimulationRemediationsToInbox(scenario.savedExam.id, actorId, [{
    originKey: scenario.remediation.originKey,
    originVersion: scenario.remediation.originVersion,
  }]), "SUBJECT_ARCHIVED");
  await rejectsApi(() => confirmSimulationExam(scenario.savedExam.id, scenario.savedExam.revision, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => createSimulationTask({
    subjectId: scenario.subjectId,
    title: "blocked archived simulation task",
    estimatedMinutes: 90,
  }, actorId), "SUBJECT_ARCHIVED");
  await rejectsApi(() => completeSimulationTask(scenario.simulationTaskId, { summary: "blocked" }, actorId), "SUBJECT_ARCHIVED");
  assert.deepEqual(await archivedWriteCounts(), before);
}

function simulationResultInput(subjectId: string, expectedRevision: number, subjectRevision?: number) {
  return {
    expectedRevision,
    lossReasons: ["concept_gap"],
    summary: "structured historical result",
    subjectResults: [{
      subjectId,
      expectedRevision: subjectRevision,
      paperFullScore: 100,
      targetScore: 80,
      actualScore: 60,
      blankQuestionCount: 0,
      lossReasons: ["concept_gap"],
      lossItems: [{ reason: "CONCEPT_GAP" as const, lostScore: 40 }],
    }],
  };
}

async function archivedWriteCounts() {
  const [notes, mistakes, nodes, evidence, retests, resources, lossItems, inbox, tasks, schedules, events, audits] = await Promise.all([
    prisma.note.count(),
    prisma.mistake.count(),
    prisma.syllabusNode.count(),
    prisma.masteryEvidence.count(),
    prisma.masteryRetest.count(),
    prisma.studyResource.count(),
    prisma.simulationLossItem.count(),
    prisma.planInboxItem.count(),
    prisma.studyTask.count(),
    prisma.reviewSchedule.count(),
    prisma.reviewEvent.count(),
    prisma.auditEvent.count(),
  ]);
  return { notes, mistakes, nodes, evidence, retests, resources, lossItems, inbox, tasks, schedules, events, audits };
}

async function verifyHistoricalWorkspaceReadsAndWrites(actorId: string, otherActorId: string): Promise<void> {
  const oldWorkspace = await prisma.examWorkspace.findFirstOrThrow({
    where: { userId: actorId, status: "ACTIVE" },
  });
  const oldSubject = await prisma.subject.findFirstOrThrow({
    where: { workspaceId: oldWorkspace.id, archivedAt: null },
  });
  const oldTask = await prisma.studyTask.create({
    data: { subjectId: oldSubject.id, title: "historical task", type: "focus", plannedDate: new Date() },
  });
  const oldNote = await prisma.note.create({
    data: { subjectId: oldSubject.id, title: "historical note", content: "historical content" },
  });
  const oldMistake = await prisma.mistake.create({
    data: {
      subjectId: oldSubject.id,
      title: "historical mistake",
      cause: "CONCEPT_CONFUSION",
      correctIdea: "historical correction",
    },
  });
  const workspace = await prisma.examWorkspace.create({
    data: { userId: actorId, stableKey: `historical-${randomUUID()}`, name: "historical", status: "ARCHIVED" },
  });
  const subject = await prisma.subject.create({
    data: { workspaceId: workspace.id, stableKey: `historical-${randomUUID()}`, name: "historical subject", color: "#64748b" },
  });
  const node = await prisma.syllabusNode.create({ data: { subjectId: subject.id, title: "historical node", kind: "TOPIC" } });
  const mistake = await prisma.mistake.create({ data: { subjectId: subject.id, title: "historical mistake", cause: "UNKNOWN" } });
  const resource = await prisma.studyResource.create({
    data: {
      workspaceId: workspace.id,
      stableKey: `historical-${randomUUID()}`,
      title: "historical resource",
      category: "OTHER",
      sourceType: "LINK",
      subjectId: subject.id,
      externalUrl: "https://example.com/historical",
      displayHost: "example.com",
    },
  });
  const exam = await prisma.simulationExam.create({
    data: { workspaceId: workspace.id, name: "historical exam", examDate: new Date() },
  });

  await activateExamWorkspace(actorId, workspace.id, workspace.revision);
  const taskDetail = await getStudyTaskDetail(actorId, oldTask.id);
  const noteDetail = await getOwnedNoteDetail(oldNote.id, actorId);
  const mistakeDetail = await getOwnedMistakeDetail(oldMistake.id, actorId);
  assert.equal(taskDetail.readOnly, true);
  assert.equal(taskDetail.workspaceId, oldWorkspace.id);
  assert.equal(noteDetail?.readOnly, true);
  assert.equal(noteDetail?.note.id, oldNote.id);
  assert.equal(mistakeDetail?.readOnly, true);
  assert.equal(mistakeDetail?.mistake.id, oldMistake.id);
  await rejectsApi(() => getStudyTaskDetail(otherActorId, oldTask.id), "TASK_NOT_FOUND");
  assert.equal(await getOwnedNoteDetail(oldNote.id, otherActorId), null);
  assert.equal(await getOwnedMistakeDetail(oldMistake.id, otherActorId), null);

  await rejectsApi(() => updateStudyTask(oldTask.id, {
    expectedStatus: "todo",
    expectedUpdatedAt: oldTask.updatedAt.toISOString(),
    title: "blocked historical task",
  }, actorId), "TASK_NOT_FOUND");
  await rejectsApi(() => updateNote(oldNote.id, {
    expectedRevision: oldNote.revision,
    title: "blocked historical note",
  }, actorId), "NOTE_NOT_FOUND");
  await rejectsApi(() => updateMistake(oldMistake.id, {
    expectedUpdatedAt: oldMistake.updatedAt.toISOString(),
    title: "blocked historical mistake",
  }, actorId), "MISTAKE_NOT_FOUND");
  assert.equal((await prisma.studyTask.findUniqueOrThrow({ where: { id: oldTask.id } })).title, oldTask.title);
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: oldNote.id } })).title, oldNote.title);
  assert.equal((await prisma.mistake.findUniqueOrThrow({ where: { id: oldMistake.id } })).title, oldMistake.title);

  const archivedOldWorkspace = await prisma.examWorkspace.findUniqueOrThrow({ where: { id: oldWorkspace.id } });
  await activateExamWorkspace(actorId, oldWorkspace.id, archivedOldWorkspace.revision);

  await rejectsApi(() => createNote({
    idempotencyKey: `owner-historical-note-${randomUUID()}`,
    subjectId: subject.id,
    title: "blocked",
    content: "blocked",
  }, actorId), "SUBJECT_NOT_FOUND");
  await rejectsApi(() => updateMistake(mistake.id, { title: "blocked" }, actorId), "MISTAKE_NOT_FOUND");
  await rejectsApi(() => updateSyllabusNode(node.id, { expectedRevision: node.revision, title: "blocked" }, actorId), "SYLLABUS_NODE_NOT_FOUND");
  await rejectsApi(() => updateStudyResource(actorId, resource.id, { expectedRevision: resource.revision, title: "blocked" }), "STUDY_RESOURCE_NOT_FOUND");
  await rejectsApi(() => saveSimulationExamResults(exam.id, simulationResultInput(subject.id, exam.revision), actorId), "SIMULATION_EXAM_NOT_FOUND");
  checks.push("historical_workspace_owner_reads_cross_owner_404_and_writes_rejected");
}

async function verifySubjectArchiveWriteRace(seed: Awaited<ReturnType<typeof seedOwner>>): Promise<void> {
  const subject = await prisma.subject.create({
    data: {
      workspaceId: seed.workspaceId,
      stableKey: `archive-race-${randomUUID()}`,
      name: "archive race subject",
      color: "#f59e0b",
    },
  });
  const workspace = await prisma.examWorkspace.findUniqueOrThrow({ where: { id: seed.workspaceId } });
  const [archiveResult, noteResult] = await Promise.allSettled([
    updateWorkspaceSubject(seed.userId, seed.workspaceId, subject.id, {
      expectedWorkspaceRevision: workspace.revision,
      archived: true,
    }),
    createNote({
      idempotencyKey: `owner-archive-race-note-${randomUUID()}`,
      subjectId: subject.id,
      title: "archive race note",
      content: "serialized by actor lock",
    }, seed.userId),
  ]);
  assert.equal(archiveResult.status, "fulfilled");
  const archived = await prisma.subject.findUniqueOrThrow({ where: { id: subject.id } });
  assert.ok(archived.archivedAt);
  if (noteResult.status === "rejected") {
    assert.ok(noteResult.reason instanceof ApiError);
    assert.equal(noteResult.reason.message, "SUBJECT_ARCHIVED");
  } else {
    assert.ok(new Date(noteResult.value.createdAt).getTime() <= archived.archivedAt.getTime());
  }
  await rejectsApi(() => createNote({
    idempotencyKey: `owner-post-archive-note-${randomUUID()}`,
    subjectId: subject.id,
    title: "post archive blocked",
    content: "blocked",
  }, seed.userId), "SUBJECT_ARCHIVED");
  checks.push("subject_archive_write_actor_lock_serialized");
}

async function dailyReviewWriteCounts(workspaceId: string) {
  const [reviews, inboxItems, checkIns, auditCount] = await Promise.all([
    prisma.dailyReview.findMany({
      where: { workspaceId },
      select: { id: true, revision: true, summary: true, tomorrowMinimum: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.planInboxItem.findMany({
      where: { workspaceId, originType: "DAILY_REVIEW_MINIMUM" },
      select: { id: true, revision: true, title: true, supersededByItemId: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.checkIn.findMany({
      where: { workspaceId },
      select: { id: true, sourceVersion: true, reviewSubmitted: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.auditEvent.count({ where: { entityType: "DailyReview" } }),
  ]);
  return { reviews, inboxItems, checkIns, auditCount };
}

async function rejectsApi(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof ApiError && error.message === code);
}
