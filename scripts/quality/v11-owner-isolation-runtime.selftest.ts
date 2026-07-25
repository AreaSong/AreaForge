import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { createNoteAttachment } from "../../apps/web/lib/study/attachments-service";
import {
  createMistake,
  getMistakeById,
  listMistakes,
  updateMistake,
} from "../../apps/web/lib/study/mistakes-service";
import { createNote, getNoteById, listNotes } from "../../apps/web/lib/study/notes-service";
import { getAnalyticsSummary } from "../../apps/web/lib/study/analytics-service";
import { saveKnowledgeCanvasLayout } from "../../apps/web/lib/study/knowledge-canvas-service";
import {
  getSyllabusMapOverview,
  listSyllabusOptions,
  updateSyllabusNode,
} from "../../apps/web/lib/study/syllabus-service";
import {
  createStudyTask,
  getActiveStudySession,
  getTodayReview,
  getTodayDashboard,
  listStudyTasks,
  listSubjects,
  pauseStudySession,
  saveTodayReview,
  startStudySession,
  updateDailyReview,
  updateStudyTask,
} from "../../apps/web/lib/study/service";

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

  assert.deepEqual((await listSubjects(own.userId)).map((row) => row.id), [own.subjectId]);
  assert.deepEqual((await listStudyTasks(own.userId)).map((row) => row.id), [ownTask.id]);
  assert.deepEqual((await listNotes(own.userId)).map((row) => row.id), [ownNote.id]);
  assert.deepEqual((await listMistakes(own.userId)).map((row) => row.id), [ownMistake.id]);
  checks.push("owner_scoped_lists");

  assert.deepEqual((await listSyllabusOptions(own.userId)).map((row) => row.id), [ownNode.id]);
  assert.deepEqual((await getSyllabusMapOverview(own.userId)).nodes.map((row) => row.id), [ownNode.id]);
  await rejectsApi(() => updateSyllabusNode(otherNode.id, { title: "hijacked" }, own.userId), "SYLLABUS_NODE_NOT_FOUND");
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

  assert.equal(await getNoteById(otherNote.id, own.userId), null);
  assert.equal(await getMistakeById(otherMistake.id, own.userId), null);
  checks.push("foreign_details_hidden");

  await rejectsApi(() => createStudyTask({
    subjectId: other.subjectId,
    title: "cross owner task",
    type: "focus",
    priority: "medium",
    estimatedMinutes: 25,
  }, own.userId), "SUBJECT_NOT_FOUND");
  await rejectsApi(() => createNote({
    subjectId: other.subjectId,
    title: "cross owner note",
    content: "blocked",
  }, own.userId), "SUBJECT_NOT_FOUND");
  await rejectsApi(() => createMistake({
    subjectId: other.subjectId,
    title: "cross owner mistake",
    cause: "unknown",
  }, own.userId), "SUBJECT_NOT_FOUND");
  checks.push("foreign_parent_creation_rejected");

  await rejectsApi(
    () => updateStudyTask(otherTask.id, { title: "hijacked" }, own.userId),
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
    () => createNoteAttachment({
      noteId: otherNote.id,
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

  const review = await saveTodayReview({
    summary: "完成隔离验证",
    keepAction: "继续",
    tomorrowMinimum: "25 分钟",
  }, own.userId);
  assert.equal((await getTodayReview(own.userId))?.id, review.id);
  const storedReview = await prisma.dailyReview.findUniqueOrThrow({ where: { id: review.id } });
  assert.equal(storedReview.workspaceId, own.workspaceId);
  const inbox = await prisma.planInboxItem.findFirstOrThrow({
    where: { workspaceId: own.workspaceId, originType: "DAILY_REVIEW_MINIMUM" },
  });
  assert.equal(inbox.title, "25 分钟");
  const updatedReview = await updateDailyReview(review.id, {
    expectedRevision: review.revision,
    summary: "完成隔离验证并更新",
    keepAction: "继续",
    tomorrowMinimum: "30 分钟",
  }, own.userId);
  assert.equal(updatedReview.revision, review.revision + 1);
  assert.equal((await prisma.planInboxItem.findUniqueOrThrow({ where: { id: inbox.id } })).title, "30 分钟");
  await rejectsApi(() => updateDailyReview(review.id, {
    expectedRevision: review.revision,
    summary: "过期写入",
    keepAction: "不得保存",
    tomorrowMinimum: "不得保存",
  }, own.userId), "DAILY_REVIEW_REVISION_CONFLICT");
  assert.equal(await getTodayReview(other.userId), null);
  checks.push("daily_review_workspace_cas_and_inbox_atomicity");

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

async function rejectsApi(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof ApiError && error.message === code);
}
