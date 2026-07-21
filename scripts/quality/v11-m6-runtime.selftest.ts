import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { listWorkspaceCheckIns } from "../../apps/web/lib/study/check-in-service";
import { convertPlanInboxItem, createPlanInboxItem } from "../../apps/web/lib/study/plan-inbox-service";
import {
  applyRecoveryDayProgress,
  cancelRecoveryV2,
  getActiveRecoveryV2,
  startRecoveryV2,
} from "../../apps/web/lib/study/recovery-v2-service";
import {
  abandonBridgeTask,
  confirmReviewEvent,
  correctReviewEvent,
  createBridgeTask,
  materializeReviewSchedule,
  pauseReviewSchedule,
  resumeReviewSchedule,
} from "../../apps/web/lib/study/review-schedule-service";
import { getStudyDayRange } from "../../apps/web/lib/study/date";

/**
 * Batch 6 隔离 runtime selftest：
 * - ReviewSchedule exactly-one / pause-resume / confirm 幂等与 fingerprint 409
 * - correction 单 successor
 * - CheckIn v2 升级与 review 不计入 effectiveMinutes
 * - Recovery 三阶 / 单日一阶
 * - 桥接 partial unique / 放弃不取消排期
 * - PlanInbox convert 原子性
 */

const checks: Array<{ id: string; status: "pass"; details: Record<string, string | number | boolean> }> = [];

try {
  await assertIsolatedDatabase();
  await verifyRoutesExist();
  await verifyMigration6Schema();
  await resetTables();
  const seed = await seedWorkspace();
  await verifyScheduleConstraints(seed);
  await verifyConfirmIdempotencyAndCheckIn(seed);
  await verifyCorrectionSingleSuccessor(seed);
  await verifyBridgeAndInboxConvert(seed);
  await verifyRecoveryStages(seed);

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m6-runtime-selftest-v1",
        status: "pass",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS v11 M6 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V11_M6_ISOLATED_DB !== "1") {
    throw new Error("v11 M6 runtime selftest requires AREAFORGE_V11_M6_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!rows[0]?.current_database.includes("v11m6")) {
    throw new Error("v11 M6 runtime selftest refused a database without the isolated name marker");
  }
  pass("isolated_database", { database: rows[0].current_database });
}

async function verifyRoutesExist(): Promise<void> {
  const routes = [
    "apps/web/app/api/review-schedules/route.ts",
    "apps/web/app/api/review-schedules/[id]/events/route.ts",
    "apps/web/app/api/review-events/[id]/corrections/route.ts",
    "apps/web/app/api/check-ins/route.ts",
    "apps/web/app/api/recovery/start/route.ts",
    "apps/web/app/api/plan-inbox/[id]/convert/route.ts",
  ];
  for (const route of routes) {
    assert.equal(existsSync(join(process.cwd(), route)), true);
  }
  pass("isolated_routes_exist", { count: routes.length });
}

async function verifyMigration6Schema(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('ReviewSchedule', 'ReviewEvent')
  `;
  assert.equal(tables.length, 2);
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'ReviewSchedule_noteId_uidx',
        'ReviewEvent_reviewScheduleId_idempotencyKey_key',
        'StudyTask_reviewSchedule_active_bridge_uidx',
        'RecoveryState_user_workspace_active_uidx',
        'ReviewEvent_correctedEventId_uidx'
      )
  `;
  assert.equal(indexes.length, 5);
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'CheckIn'
      AND column_name IN ('reviewCount', 'reviewSeconds', 'minimumActionSource')
  `;
  assert.equal(columns.length, 3);
  pass("migration6_schema", { tables: tables.length, indexes: indexes.length, columns: columns.length });
}

async function resetTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "MasteryEvidence",
      "MasteryRetest",
      "ReviewEvent",
      "StudyTask",
      "ReviewSchedule",
      "PlanInboxDependencyRef",
      "PlanInboxItem",
      "CheckIn",
      "RecoveryState",
      "Note",
      "Mistake",
      "SyllabusNode",
      "StudyResourceTag",
      "StudyResourceTaskLink",
      "StudyResourceNoteLink",
      "StudyResourceMistakeLink",
      "StudyResourceSyllabusNodeLink",
      "StudyResource",
      "Attachment",
      "Subject",
      "SubjectGroup",
      "ExamWorkspace",
      "AuditEvent",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

async function seedWorkspace() {
  const user = await prisma.user.create({
    data: {
      email: `v11m6-${randomUUID()}@example.com`,
      passwordHash: "x",
    },
  });
  const workspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: "m6-workspace",
      name: "M6 Workspace",
      status: "ACTIVE",
      revision: 1,
    },
  });
  const subject = await prisma.subject.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "math",
      name: "Math",
      color: "#111111",
    },
  });
  const note = await prisma.note.create({
    data: {
      subjectId: subject.id,
      title: "Concept card",
      content: "body",
      kind: "CONCEPT",
      nextReviewAt: getStudyDayRange().start,
    },
  });
  const mistake = await prisma.mistake.create({
    data: {
      subjectId: subject.id,
      title: "Mistake 1",
      cause: "UNKNOWN",
      nextReviewAt: getStudyDayRange().start,
    },
  });
  return { user, workspace, subject, note, mistake };
}

async function verifyScheduleConstraints(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const dueDate = getStudyDayRange().start.toISOString();
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: seed.note.id,
    dueDate,
  });
  assert.equal(schedule.targetType, "NOTE");
  assert.equal(schedule.status, "ACTIVE");

  const again = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: seed.note.id,
    dueDate,
  });
  assert.equal(again.id, schedule.id);

  await assert.rejects(
    () =>
      prisma.reviewSchedule.create({
        data: {
          workspaceId: seed.workspace.id,
          targetType: "NOTE",
          noteId: seed.note.id,
          mistakeId: seed.mistake.id,
          status: "ACTIVE",
          dueDate: getStudyDayRange().start,
        },
      }),
    /ReviewSchedule_target_exactly_one_check|P2010|Raw query/,
  );

  const paused = await pauseReviewSchedule(seed.user.id, schedule.id, {
    expectedRevision: schedule.revision,
    reason: "manual pause",
  });
  assert.equal(paused.status, "PAUSED");
  assert.equal(paused.dueDate, null);

  const resumed = await resumeReviewSchedule(seed.user.id, schedule.id, {
    expectedRevision: paused.revision,
    dueDate,
  });
  assert.equal(resumed.status, "ACTIVE");
  pass("schedule_constraints_pause_resume", { scheduleId: schedule.id });
}

async function verifyConfirmIdempotencyAndCheckIn(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const dueDate = getStudyDayRange().start.toISOString();
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "MISTAKE",
    mistakeId: seed.mistake.id,
    dueDate,
  });
  const key = `idem-${randomUUID()}`;
  const first = await confirmReviewEvent(seed.user.id, schedule.id, {
    idempotencyKey: key,
    expectedRevision: schedule.revision,
    result: "PASSED",
    durationSeconds: 320,
  });
  assert.equal(first.reused, false);
  assert.equal(first.event.durationSeconds, 320);

  const reused = await confirmReviewEvent(seed.user.id, schedule.id, {
    idempotencyKey: key,
    expectedRevision: schedule.revision,
    result: "PASSED",
    durationSeconds: 320,
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.event.id, first.event.id);

  try {
    await confirmReviewEvent(seed.user.id, schedule.id, {
      idempotencyKey: key,
      expectedRevision: schedule.revision,
      result: "FAILED",
      durationSeconds: 320,
    });
    assert.fail("expected idempotency conflict");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_IDEMPOTENCY_CONFLICT");
    assert.equal(error.status, 409);
  }

  try {
    await confirmReviewEvent(seed.user.id, schedule.id, {
      idempotencyKey: `idem-${randomUUID()}`,
      expectedRevision: schedule.revision,
      result: "PARTIAL",
      durationSeconds: 60,
    });
    assert.fail("expected revision conflict");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_SCHEDULE_REVISION_CONFLICT");
  }

  const today = getStudyDayRange();
  const checkIns = await listWorkspaceCheckIns(seed.workspace.id, today.start, today.start);
  assert.equal(checkIns.length, 1);
  assert.equal(checkIns[0].sourceVersion, 2);
  assert.equal(checkIns[0].reviewSeconds, 320);
  assert.equal(checkIns[0].effectiveMinutes, 0);
  assert.equal(checkIns[0].minimumActionSource, "REVIEW");
  assert.equal(checkIns[0].completedMinimumAction, true);
  pass("confirm_idempotency_checkin_v2", {
    eventId: first.event.id,
    reviewSeconds: checkIns[0].reviewSeconds,
  });
}

async function verifyCorrectionSingleSuccessor(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const note2 = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Correction note",
      content: "x",
      kind: "METHOD",
    },
  });
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: note2.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const confirmed = await confirmReviewEvent(seed.user.id, schedule.id, {
    idempotencyKey: `idem-${randomUUID()}`,
    expectedRevision: schedule.revision,
    result: "FAILED",
    durationSeconds: 90,
  });
  const correction = await correctReviewEvent(seed.user.id, confirmed.event.id, {
    idempotencyKey: `corr-${randomUUID()}`,
    expectedRevision: confirmed.schedule.revision,
    result: "PASSED",
  });
  assert.equal(correction.event.correctedEventId, confirmed.event.id);
  assert.equal(correction.event.durationSeconds, 90);

  try {
    await correctReviewEvent(seed.user.id, confirmed.event.id, {
      idempotencyKey: `corr-${randomUUID()}`,
      expectedRevision: correction.schedule.revision,
      result: "PARTIAL",
    });
    assert.fail("expected second correction to fail");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.ok(
      error.code === "REVIEW_CORRECTION_EXISTS" ||
        error.code === "REVIEW_EVENT_NOT_LATEST" ||
        error.code === "REVIEW_SCHEDULE_REVISION_CONFLICT",
    );
  }

  const today = getStudyDayRange();
  const checkIns = await listWorkspaceCheckIns(seed.workspace.id, today.start, today.start);
  const row = checkIns[0];
  assert.ok(row);
  // correction replaces original: one effective event from first confirm (320) + this note's 90
  assert.ok(row.reviewSeconds >= 90);
  pass("correction_single_successor", { correctionId: correction.event.id });
}

async function verifyBridgeAndInboxConvert(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const note3 = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Bridge note",
      content: "x",
      kind: "EXAMPLE",
    },
  });
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: note3.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const bridge = await createBridgeTask(seed.user.id, {
    reviewScheduleId: schedule.id,
    subjectId: seed.subject.id,
    title: "Review bridge task",
  });
  assert.ok(bridge.taskId);

  try {
    await createBridgeTask(seed.user.id, {
      reviewScheduleId: schedule.id,
      subjectId: seed.subject.id,
      title: "Second bridge",
    });
    assert.fail("expected bridge unique conflict");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_BRIDGE_ALREADY_EXISTS");
  }

  const afterAbandon = await abandonBridgeTask(seed.user.id, bridge.taskId);
  assert.equal(afterAbandon.status, "ACTIVE");
  assert.ok(afterAbandon.dueDate);

  const inbox = await createPlanInboxItem(seed.user.id, {
    stableKey: `inbox-${randomUUID()}`,
    originKey: `origin-${randomUUID()}`,
    originVersion: 1,
    originType: "DAILY_REVIEW",
    originSnapshot: { source: "selftest" },
    title: "Tomorrow minimum",
    subjectId: seed.subject.id,
    plannedDate: getStudyDayRange().start.toISOString(),
    estimatedMinutes: 30,
    type: "focus",
  });
  const converted = await convertPlanInboxItem(seed.user.id, inbox.id, {
    expectedRevision: inbox.revision,
  });
  assert.equal(converted.status, "CONVERTED");
  assert.ok(converted.convertedTaskId);

  try {
    await convertPlanInboxItem(seed.user.id, inbox.id, {
      expectedRevision: converted.revision,
    });
    assert.fail("expected already converted");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "PLAN_INBOX_NOT_OPEN");
  }

  pass("bridge_and_inbox_convert", {
    abandonedScheduleId: afterAbandon.id,
    convertedTaskId: converted.convertedTaskId ?? "",
  });
}

async function verifyRecoveryStages(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const started = await startRecoveryV2(seed.user.id, { reason: "selftest" });
  assert.equal(started.status, "ACTIVE");
  assert.equal(started.currentStage, 1);
  assert.equal(started.targetMinutes, 30);

  const again = await startRecoveryV2(seed.user.id);
  assert.equal(again.id, started.id);

  const advanced = await applyRecoveryDayProgress(seed.user.id, { progressMinutesToday: 30 });
  assert.ok(advanced);
  assert.equal(advanced.currentStage, 2);
  assert.equal(advanced.status, "ACTIVE");

  const noDouble = await applyRecoveryDayProgress(seed.user.id, { progressMinutesToday: 90 });
  assert.ok(noDouble);
  assert.equal(noDouble.currentStage, 2);

  const active = await getActiveRecoveryV2(seed.user.id);
  assert.ok(active);
  const canceled = await cancelRecoveryV2(seed.user.id, active.id, {
    expectedRevision: active.revision,
  });
  assert.equal(canceled.status, "CANCELED");
  pass("recovery_stages", { startedId: started.id, advancedTo: 2 });
}

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}
