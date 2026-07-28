import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { listMistakes } from "../../apps/web/lib/study/mistakes-service";
import {
  archiveMotivationItem,
  createMotivationItem,
  getMotivationNext,
  listMotivationItems,
  reorderMotivationItems,
  updateMotivationItem,
} from "../../apps/web/lib/study/motivation-library-service";
import { listNotes } from "../../apps/web/lib/study/notes-service";
import { listStudyResources } from "../../apps/web/lib/study/study-resource-service";
import { filterSyllabusTreeByQuery, getSyllabusMapOverview } from "../../apps/web/lib/study/syllabus-service";

if (!process.env.AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET.length < 32) {
  process.env.AUTH_SESSION_SECRET = "v11-m7-isolated-auth-session-secret-20260727";
}

try {
  if (process.env.AREAFORGE_V11_M7_ISOLATED_DB !== "1") {
    throw new Error("requires AREAFORGE_V11_M7_ISOLATED_DB=1");
  }
  const [{ current_database: database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!database.includes("v11m7")) throw new Error("refused database without v11m7 marker");
  assert.equal(existsSync("apps/web/app/api/motivation/items/reorder/route.ts"), true);
  assert.equal(await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE tablename IN ('MotivationItem', 'MotivationReminderState', 'KnowledgeCanvasLayout')
  `.then((rows) => rows.length), 3);

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "MotivationReminderState", "MotivationItem", "MotivationVault", "RecoveryState", "PlanInboxItem", "StudySession", "StudyResource", "Mistake", "Note", "SyllabusNode", "Subject", "SubjectGroup", "ExamWorkspace", "AuditEvent", "User" RESTART IDENTITY CASCADE`);
  const user = await prisma.user.create({
    data: { email: `v11m7-${randomUUID()}@example.invalid`, passwordHash: "x" },
  });
  const foreignUser = await prisma.user.create({
    data: { email: `v11m7-foreign-${randomUUID()}@example.invalid`, passwordHash: "x" },
  });
  const workspace = await prisma.examWorkspace.create({
    data: { userId: user.id, stableKey: "m7", name: "M7", status: "ACTIVE" },
  });
  const subject = await prisma.subject.create({
    data: { workspaceId: workspace.id, stableKey: "math", name: "数学", color: "#14b8a6" },
  });
  const syllabusRoot = await prisma.syllabusNode.create({
    data: { subjectId: subject.id, title: "高等数学", kind: "CHAPTER" },
  });
  await prisma.syllabusNode.createMany({
    data: [
      { subjectId: subject.id, parentId: syllabusRoot.id, title: "Needle 极限", kind: "TOPIC" },
      { subjectId: subject.id, parentId: syllabusRoot.id, title: "函数连续性", kind: "TOPIC" },
    ],
  });
  const oldSearchNote = await prisma.note.create({
    data: {
      subjectId: subject.id,
      title: "Needle card",
      content: "search target",
      updatedAt: new Date("2020-01-01T00:00:00.000Z"),
    },
  });
  await prisma.note.createMany({
    data: Array.from({ length: 205 }, (_, index) => ({
      subjectId: subject.id,
      title: `filler-card-${index}`,
      content: "filler",
      updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    })),
  });
  const lateSearchMistake = await prisma.mistake.create({
    data: {
      subjectId: subject.id,
      title: "Needle mistake",
      nextReviewAt: new Date("2035-01-01T00:00:00.000Z"),
    },
  });
  await prisma.mistake.createMany({
    data: Array.from({ length: 205 }, (_, index) => ({
      subjectId: subject.id,
      title: `filler-mistake-${index}`,
      nextReviewAt: new Date("2026-07-27T00:00:00.000Z"),
    })),
  });
  const archivedSearchResource = await prisma.studyResource.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "needle-resource",
      title: "Needle resource",
      sourceType: "LINK",
      subjectId: subject.id,
      externalUrl: "https://example.com/needle",
      displayHost: "example.com",
      archivedAt: new Date("2026-07-27T00:00:00.000Z"),
    },
  });
  assert.equal((await listNotes(user.id)).some((note) => note.id === oldSearchNote.id), false);
  assert.deepEqual((await listNotes(user.id, { q: "  NEEDLE " })).map((note) => note.id), [oldSearchNote.id]);
  assert.equal((await listMistakes(user.id)).some((mistake) => mistake.id === lateSearchMistake.id), false);
  assert.deepEqual((await listMistakes(user.id, { q: " needle " })).map((mistake) => mistake.id), [lateSearchMistake.id]);
  assert.deepEqual(
    (await listStudyResources(user.id, { includeArchived: true, q: "Needle" })).map((resource) => resource.id),
    [archivedSearchResource.id],
  );
  const filteredSyllabus = filterSyllabusTreeByQuery((await getSyllabusMapOverview(user.id)).nodes, "needle");
  assert.equal(filteredSyllabus.length, 1);
  assert.equal(filteredSyllabus[0]?.id, syllabusRoot.id);
  assert.deepEqual(filteredSyllabus[0]?.children.map((node) => node.title), ["Needle 极限"]);
  const vault = await prisma.motivationVault.create({
    data: {
      whyStarted: "为了把长期目标落实到今天",
      futureSelf: "稳定完成每一次最低行动",
    },
  });

  const quoteKey = `m7-quote-${randomUUID()}`;
  const quote = await createMotivationItem(user.id, {
    idempotencyKey: quoteKey,
    type: "QUOTE",
    title: "今天的一步",
    body: "只做眼前明确的一步",
    sortOrder: 0,
  });
  const quoteReplay = await createMotivationItem(user.id, {
    idempotencyKey: quoteKey,
    type: "QUOTE",
    title: "今天的一步",
    body: "只做眼前明确的一步",
    sortOrder: 0,
  });
  assert.equal(quoteReplay.id, quote.id);
  const video = await createMotivationItem(user.id, {
    idempotencyKey: `m7-video-${randomUUID()}`,
    type: "VIDEO_LINK",
    title: "复盘视频",
    externalUrl: "https://example.com/motivation",
    sortOrder: 1,
  });
  const excerpt = await createMotivationItem(user.id, {
    idempotencyKey: `m7-vault-${randomUUID()}`,
    type: "VAULT_EXCERPT",
    title: "初心摘录",
    body: vault.whyStarted,
    vaultSourceId: vault.id,
    vaultField: "whyStarted",
    sortOrder: 2,
  });
  await assert.rejects(
    () => createMotivationItem(user.id, {
      idempotencyKey: `m7-vault-invalid-${randomUUID()}`,
      type: "VAULT_EXCERPT",
      title: "非法摘录",
      body: "不是明确选择的原文",
      vaultSourceId: vault.id,
      vaultField: "whyStarted",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "MOTIVATION_VAULT_EXCERPT_INVALID",
  );

  const updatedQuote = await updateMotivationItem(user.id, quote.id, {
    expectedRevision: quote.revision,
    title: "今天只推进一步",
    tags: ["最低行动"],
  });
  await assert.rejects(
    () => updateMotivationItem(user.id, quote.id, {
      expectedRevision: quote.revision,
      title: "过期覆盖",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "MOTIVATION_ITEM_REVISION_CONFLICT",
  );
  await assert.rejects(
    () => updateMotivationItem(foreignUser.id, quote.id, {
      expectedRevision: updatedQuote.revision,
      title: "跨用户覆盖",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "MOTIVATION_ITEM_NOT_FOUND",
  );

  const beforeReorder = await listMotivationItems(user.id);
  const reordered = await reorderMotivationItems(user.id, {
    order: [...beforeReorder].reverse().map((item) => ({ id: item.id, expectedRevision: item.revision })),
  });
  assert.deepEqual(reordered.map((item) => item.id), [...beforeReorder].reverse().map((item) => item.id));
  const stableReorderSnapshot = await listMotivationItems(user.id);
  await assert.rejects(
    () => reorderMotivationItems(user.id, {
      order: stableReorderSnapshot.map((item, index) => ({
        id: item.id,
        expectedRevision: index === 0 ? item.revision - 1 : item.revision,
      })),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "MOTIVATION_ITEM_REORDER_CONFLICT",
  );
  assert.deepEqual(await listMotivationItems(user.id), stableReorderSnapshot);

  const latestVideo = stableReorderSnapshot.find((item) => item.id === video.id)!;
  const archivedVideo = await archiveMotivationItem(user.id, video.id, latestVideo.revision);
  assert.ok(archivedVideo.archivedAt);
  assert.equal((await listMotivationItems(user.id)).some((item) => item.id === video.id), false);
  assert.equal((await listMotivationItems(user.id, true)).some((item) => item.id === video.id), true);

  const manualBeforeTrigger = await getMotivationNext(user.id, { mode: "manual" });
  assert.equal(manualBeforeTrigger.reminderReason, "manual");
  assert.equal(await prisma.motivationReminderState.count({ where: { userId: user.id } }), 0);
  const noTrigger = await getMotivationNext(user.id, { mode: "automatic" });
  assert.equal(noTrigger.reminderReason, "no_trigger");
  assert.equal(await prisma.motivationReminderState.count({ where: { userId: user.id } }), 0);

  await prisma.recoveryState.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      actorId: user.id,
      status: "ACTIVE",
      triggerType: "MANUAL",
      targetMinutes: 30,
      visibleTaskLimit: 3,
      reason: "M7 automatic reminder trigger",
    },
  });
  const concurrentAutomatic = await Promise.all([
    getMotivationNext(user.id, { mode: "automatic" }),
    getMotivationNext(user.id, { mode: "automatic" }),
  ]);
  assert.equal(concurrentAutomatic.filter((result) => result.reminderReason === "ok").length, 1);
  assert.equal(concurrentAutomatic.filter((result) => result.reminderReason === "interval").length, 1);
  const reminderAfterConcurrent = await prisma.motivationReminderState.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(reminderAfterConcurrent.dailyCount, 1);

  const running = await prisma.studySession.create({
    data: { subjectId: subject.id, status: "RUNNING", startedAt: new Date() },
  });
  const activeBlocked = await getMotivationNext(user.id, { mode: "automatic" });
  assert.equal(activeBlocked.reminderReason, "active_activity");
  assert.equal((await prisma.motivationReminderState.findUniqueOrThrow({ where: { userId: user.id } })).dailyCount, 1);
  await prisma.studySession.update({
    where: { id: running.id },
    data: { status: "CANCELED", endedAt: new Date() },
  });

  await prisma.motivationReminderState.update({
    where: { userId: user.id },
    data: { lastAutoShowAt: new Date(Date.now() - 5 * 60 * 60 * 1000), dailyCount: 1 },
  });
  assert.equal((await getMotivationNext(user.id, { mode: "automatic" })).reminderReason, "ok");
  await prisma.motivationReminderState.update({
    where: { userId: user.id },
    data: { lastAutoShowAt: new Date(Date.now() - 5 * 60 * 60 * 1000), dailyCount: 2 },
  });
  assert.equal((await getMotivationNext(user.id, { mode: "automatic" })).reminderReason, "daily_cap");

  assert.deepEqual(new Set((await listMotivationItems(user.id, true)).map((item) => item.type)), new Set(["QUOTE", "VIDEO_LINK", "VAULT_EXCERPT"]));
  assert.equal((await listMotivationItems(foreignUser.id, true)).length, 0);
  assert.equal(excerpt.vaultSourceId, vault.id);
  console.log(JSON.stringify({
    schemaVersion: "v11-m7-runtime-selftest-v1",
    status: "pass",
    database,
    checks: {
      threeItemTypesAndVaultSelection: "pass",
      knowledgeSearchBeforeTakeAndAncestorRetention: "pass",
      createReplayAndEditCas: "pass",
      atomicReorderRollback: "pass",
      archiveVisibilityAndOwnerIsolation: "pass",
      automaticTriggerAndActivityGate: "pass",
      concurrentAutomaticSingleWinner: "pass",
      intervalAndDailyCap: "pass",
    },
  }, null, 2));
  console.log("PASS v11 M7 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}
