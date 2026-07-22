import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import {
  checkInLockNamespace,
  getCheckInLockTargets,
} from "../../apps/web/lib/study/check-in-service";
import {
  completeStudyTask,
  convertStudyTaskToReview,
  deferStudyTask,
  dropStudyTask,
  endStudySession,
  pauseStudySession,
  recoverStudyTask,
  resumeStudySession,
  splitStudyTask,
  startStudySession,
  updateStudyTask,
} from "../../apps/web/lib/study/service";
import { completeSimulationTask } from "../../apps/web/lib/study/simulation-service";
import { applyTaskDebtReorder } from "../../apps/web/lib/study/task-debt-reorder-service";

const root = process.cwd();
const migrationPath = path.join(root, "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql");
const outputPath = readOutputPath(process.argv.slice(2));
const checks: RuntimeCheck[] = [];

interface RuntimeCheck {
  id: string;
  status: "pass";
  details: Record<string, string | number | boolean>;
}

interface BaseFixture {
  actorId: string;
  subjectId: string;
  syllabusNodeId: string;
}

try {
  await assertIsolatedDatabase();
  await verifyMigrationContract();
  await resetFixture();
  await verifyCheckInLockKeys();
  await verifyConcurrentStart();
  await resetFixture();
  await verifySessionTransitionsAndSingleEndEffects();
  await resetFixture();
  await verifyTaskCommandCas();
  await resetFixture();
  await verifySimulationCas();
  await resetFixture();
  await verifyDebtReorderCas();
  await resetFixture();
  await verifyConcurrentCheckInRefresh();
  await resetFixture();

  const record = createRecord();
  if (outputPath) writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log("PASS OPS-006 isolated PostgreSQL concurrency selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_OPS006_ISOLATED_DB !== "1") {
    throw new Error("OPS-006 runtime selftest requires the explicit isolated database guard");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!rows[0]?.current_database.includes("ops006")) {
    throw new Error("OPS-006 runtime selftest refused a database without the isolated name marker");
  }
}

async function verifyMigrationContract(): Promise<void> {
  const migrationSql = readFileSync(migrationPath, "utf8").trim();
  const publicIndex = await prisma.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'StudySession_one_active_idx'
  `;
  if (publicIndex.length !== 1 || !publicIndex[0]?.indexdef.includes("WHERE (status = ANY")) {
    throw new Error("OPS-006 active-session partial unique index is not applied");
  }

  const validSchema = "ops006_valid_migration_fixture";
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${validSchema}" CASCADE`);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${validSchema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${validSchema}"`);
    await tx.$executeRawUnsafe(`CREATE TABLE "StudySession" ("status" text NOT NULL)`);
    await tx.$executeRawUnsafe(migrationSql);
  });
  const sandboxIndex = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM pg_indexes
    WHERE schemaname = ${validSchema} AND indexname = 'StudySession_one_active_idx'
  `;
  if (sandboxIndex[0]?.count !== 1n) throw new Error("OPS-006 canonical migration did not create the sandbox index");

  const repeatResult = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${validSchema}"`);
      await tx.$executeRawUnsafe(migrationSql);
    }),
  ]);
  if (repeatResult[0]?.status !== "rejected") throw new Error("OPS-006 repeated index apply must fail closed");
  await prisma.$executeRawUnsafe(`DROP SCHEMA "${validSchema}" CASCADE`);

  const dirtyResult = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "ops006_dirty_migration_fixture"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "ops006_dirty_migration_fixture"`);
      await tx.$executeRawUnsafe(`CREATE TABLE "StudySession" ("status" text NOT NULL)`);
      await tx.$executeRawUnsafe(`INSERT INTO "StudySession" ("status") VALUES ('RUNNING'), ('PAUSED')`);
      await tx.$executeRawUnsafe(migrationSql);
    }),
  ]);
  if (dirtyResult[0]?.status !== "rejected") {
    throw new Error("OPS-006 migration must reject a dirty active-session preimage");
  }

  checks.push({
    id: "migration.apply_verify_negative_fixtures",
    status: "pass",
    details: {
      publicIndexPresent: true,
      sandboxApplyPassed: true,
      repeatedApplyRejected: true,
      dirtyPreimageRejected: true,
    },
  });
}

async function verifyCheckInLockKeys(): Promise<void> {
  const targets = getCheckInLockTargets([
    new Date("2026-07-18T16:30:00.000Z"),
    new Date("2026-07-17T16:30:00.000Z"),
    new Date("2026-07-18T01:00:00.000Z"),
  ]);
  if (
    checkInLockNamespace !== 1095123785
    || targets.length !== 2
    || targets[0]?.studyDayKey !== "2026-07-18"
    || targets[0]?.lockKey !== 20260718
    || targets[1]?.studyDayKey !== "2026-07-19"
    || targets[1]?.lockKey !== 20260719
    || Number(checkInLockNamespace) === 2026070703
  ) {
    throw new Error("OPS-006 CheckIn advisory lock key contract failed");
  }
  checks.push({
    id: "checkin.lock_key_contract",
    status: "pass",
    details: { orderedDayCount: 2, duplicateDayRemoved: true, recoveryKeyIsolated: true },
  });
}

async function verifyConcurrentStart(): Promise<void> {
  const base = await createBaseFixture();
  const taskIds = await Promise.all([
    createTask(base, "start-a"),
    createTask(base, "start-b"),
  ]);
  const results = await Promise.allSettled(taskIds.map((taskId) => startStudySession({ taskId }, base.actorId)));
  expectOneWinnerOneConflict(results, "ACTIVE_SESSION_EXISTS");

  const activeCount = await prisma.studySession.count({ where: { status: { in: ["RUNNING", "PAUSED"] } } });
  const inProgressCount = await prisma.studyTask.count({ where: { id: { in: taskIds }, status: "IN_PROGRESS" } });
  if (activeCount !== 1 || inProgressCount !== 1) {
    throw new Error("OPS-006 concurrent start did not preserve the single-active invariant");
  }
  checks.push({
    id: "session.concurrent_start",
    status: "pass",
    details: { successCount: 1, conflictCount: 1, activeSessionCount: 1, claimedTaskCount: 1 },
  });
}

async function verifySessionTransitionsAndSingleEndEffects(): Promise<void> {
  const base = await createBaseFixture();
  const taskId = await createTask(base, "session-end");
  const started = await startStudySession({ taskId, syllabusNodeId: base.syllabusNodeId }, base.actorId);

  expectOneWinnerOneConflict(
    await raceLockedSession(started.id, () => pauseStudySession(started.id, base.actorId)),
    "SESSION_STATE_CONFLICT",
  );
  expectOneWinnerOneConflict(
    await raceLockedSession(started.id, () => resumeStudySession(started.id, base.actorId)),
    "SESSION_STATE_CONFLICT",
  );

  await prisma.studySession.update({
    where: { id: started.id },
    data: { startedAt: new Date(Date.now() - 31 * 60_000) },
  });
  const endInput = {
    qualityScore: 4,
    isEffective: true,
    understandingLevel: "clear",
    minimalOutput: "完成了可复核的并发测试产出并记录下一步。",
    nextAction: "复核测试结果",
    producedNote: true,
    producedMistake: false,
    completeTask: true,
  };
  expectOneWinnerOneConflict(
    await raceLockedSession(started.id, () => endStudySession(started.id, endInput, base.actorId)),
    "SESSION_STATE_CONFLICT",
  );

  const [session, task, node, endAuditCount, debtEventCount, checkIn] = await Promise.all([
    prisma.studySession.findUnique({ where: { id: started.id } }),
    prisma.studyTask.findUnique({ where: { id: taskId } }),
    prisma.syllabusNode.findUnique({ where: { id: base.syllabusNodeId } }),
    prisma.auditEvent.count({ where: { action: "STUDY_SESSION_ENDED" } }),
    prisma.taskDebtEvent.count({ where: { taskId, action: "complete" } }),
    prisma.checkIn.findFirst(),
  ]);
  if (
    !session
    || !task
    || !node
    || !checkIn
    || session.status !== "COMPLETED"
    || session.effectiveMinutes <= 0
    || task.actualMinutes !== session.effectiveMinutes
    || node.actualMinutes !== session.effectiveMinutes
    || endAuditCount !== 1
    || debtEventCount !== 1
    || checkIn.totalMinutes !== session.effectiveMinutes
    || checkIn.effectiveSessionCount !== 1
  ) {
    throw new Error(`OPS-006 concurrent end side-effect mismatch: ${JSON.stringify({
      sessionStatus: session?.status ?? null,
      sessionMinutes: session?.effectiveMinutes ?? null,
      taskMinutes: task?.actualMinutes ?? null,
      nodeMinutes: node?.actualMinutes ?? null,
      endAuditCount,
      debtEventCount,
      checkInMinutes: checkIn?.totalMinutes ?? null,
      checkInSessionCount: checkIn?.effectiveSessionCount ?? null,
    })}`);
  }
  checks.push({
    id: "session.pause_resume_end_cas",
    status: "pass",
    details: {
      pauseWinnerCount: 1,
      resumeWinnerCount: 1,
      endWinnerCount: 1,
      effectiveMinutes: session.effectiveMinutes,
      auditCount: 1,
      debtEventCount: 1,
      checkInSessionCount: 1,
    },
  });
}

async function verifyTaskCommandCas(): Promise<void> {
  const base = await createBaseFixture();
  const commands: Array<{
    name: string;
    create: () => Promise<string>;
    run: (id: string) => Promise<unknown>;
  }> = [
    { name: "complete", create: () => createTask(base, "complete"), run: (id: string) => completeStudyTask(id, "done", base.actorId) },
    { name: "defer", create: () => createTask(base, "defer"), run: (id: string) => deferStudyTask(id, undefined, "later", base.actorId) },
    { name: "drop", create: () => createTask(base, "drop"), run: (id: string) => dropStudyTask(id, base.actorId) },
    { name: "recover", create: () => createTask(base, "recover", { status: "SKIPPED", debtStatus: "NONE" }), run: (id: string) => recoverStudyTask(id, {}, base.actorId) },
    { name: "split", create: () => createTask(base, "split"), run: (id: string) => splitStudyTask(id, { title: "split-child", estimatedMinutes: 20 }, base.actorId) },
    { name: "convert", create: () => createTask(base, "convert"), run: (id: string) => convertStudyTaskToReview(id, { estimatedMinutes: 25 }, base.actorId) },
    { name: "metadata", create: () => createTask(base, "metadata"), run: (id: string) => updateStudyTask(id, { title: "metadata-updated" }, base.actorId) },
  ];

  for (const command of commands) {
    const taskId = await command.create();
    expectOneWinnerOneConflict(await raceLockedTask(taskId, () => command.run(taskId)), "TASK_STATE_CONFLICT");
  }
  const splitChildren = await prisma.studyTask.count({ where: { title: "split-child" } });
  if (splitChildren !== 1) throw new Error("OPS-006 split CAS left duplicate child side effects");
  checks.push({
    id: "task.command_cas",
    status: "pass",
    details: { commandCount: commands.length, winnerCount: commands.length, conflictCount: commands.length, splitChildCount: 1 },
  });
}

async function verifySimulationCas(): Promise<void> {
  const base = await createBaseFixture();
  const taskId = await createTask(base, "simulation", { type: "simulation_exam" });
  const input = { durationMinutes: 120, actualScore: "100", summary: "simulation complete" };
  expectOneWinnerOneConflict(
    await raceLockedTask(taskId, () => completeSimulationTask(taskId, input, base.actorId)),
    "TASK_STATE_CONFLICT",
  );
  const eventCount = await prisma.taskDebtEvent.count({ where: { taskId, action: "complete" } });
  if (eventCount !== 1) throw new Error("OPS-006 simulation CAS produced duplicate debt events");
  checks.push({
    id: "task.simulation_complete_cas",
    status: "pass",
    details: { successCount: 1, conflictCount: 1, debtEventCount: 1 },
  });
}

async function verifyDebtReorderCas(): Promise<void> {
  const base = await createBaseFixture();
  const now = new Date();
  const taskId = await createTask(base, "reorder", {
    plannedDate: new Date(now.getTime() - 3 * 86_400_000),
    priority: "CRITICAL",
    debtStatus: "NEEDS_RECOVERY",
  });
  expectOneWinnerOneConflict(
    await raceLockedTask(taskId, () => applyTaskDebtReorder({ selectedTaskIds: [taskId] }, base.actorId, now), 700),
    "TASK_STATE_CONFLICT",
  );
  const appliedAuditCount = await prisma.auditEvent.count({ where: { action: "TASK_DEBT_REORDER_APPLIED" } });
  if (appliedAuditCount !== 1) throw new Error("OPS-006 debt reorder CAS produced partial batch side effects");
  checks.push({
    id: "task.debt_reorder_cas",
    status: "pass",
    details: { successCount: 1, conflictCount: 1, appliedAuditCount: 1 },
  });
}

async function verifyConcurrentCheckInRefresh(): Promise<void> {
  const base = await createBaseFixture();
  const taskIds = await Promise.all([
    createTask(base, "checkin-a"),
    createTask(base, "checkin-b"),
  ]);
  const results = await Promise.allSettled(taskIds.map((taskId) => completeStudyTask(taskId, "done", base.actorId)));
  if (results.some((result) => result.status !== "fulfilled")) {
    throw new Error("OPS-006 independent task completion unexpectedly conflicted");
  }
  const checkIn = await prisma.checkIn.findFirst();
  const doneCount = await prisma.studyTask.count({ where: { id: { in: taskIds }, status: "DONE" } });
  if (!checkIn || doneCount !== 2 || checkIn.taskCompletionRate !== 1) {
    throw new Error("OPS-006 concurrent CheckIn refresh did not match committed task aggregates");
  }
  checks.push({
    id: "checkin.concurrent_refresh",
    status: "pass",
    details: { committedTaskCount: 2, doneTaskCount: 2, taskCompletionRate: checkIn.taskCompletionRate },
  });
}

async function createBaseFixture(): Promise<BaseFixture> {
  const user = await prisma.user.create({
    data: { email: `ops006-${createHash("sha256").update(String(Date.now() + Math.random())).digest("hex").slice(0, 12)}@example.invalid`, passwordHash: "fixture" },
  });
  const subject = await prisma.subject.create({
    data: { legacyCode: "MATH", stableKey: "math", name: "OPS-006 fixture", color: "#111111" },
  });
  const node = await prisma.syllabusNode.create({
    data: { subjectId: subject.id, title: "OPS-006 fixture", kind: "TOPIC" },
  });
  return { actorId: user.id, subjectId: subject.id, syllabusNodeId: node.id };
}

async function createTask(
  base: BaseFixture,
  title: string,
  overrides: Partial<{
    type: string;
    status: "TODO" | "IN_PROGRESS" | "SKIPPED" | "DEFERRED";
    priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    debtStatus: "NONE" | "ACCEPTABLE" | "NEEDS_RECOVERY";
    plannedDate: Date;
  }> = {},
): Promise<string> {
  const task = await prisma.studyTask.create({
    data: {
      subjectId: base.subjectId,
      syllabusNodeId: base.syllabusNodeId,
      title,
      type: overrides.type ?? "study",
      status: overrides.status ?? "TODO",
      priority: overrides.priority ?? "MEDIUM",
      debtStatus: overrides.debtStatus ?? "NONE",
      plannedDate: overrides.plannedDate ?? new Date(),
      estimatedMinutes: 30,
    },
    select: { id: true },
  });
  return task.id;
}

async function raceLockedTask<T>(taskId: string, run: () => Promise<T>, holdMs = 250): Promise<PromiseSettledResult<T>[]> {
  let calls: Array<Promise<T>> = [];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "StudyTask" WHERE "id" = ${taskId} FOR UPDATE`;
    calls = [run(), run()];
    await delay(holdMs);
  });
  return Promise.allSettled(calls);
}

async function raceLockedSession<T>(sessionId: string, run: () => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  let calls: Array<Promise<T>> = [];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "StudySession" WHERE "id" = ${sessionId} FOR UPDATE`;
    calls = [run(), run()];
    await delay(250);
  });
  return Promise.allSettled(calls);
}

function expectOneWinnerOneConflict<T>(results: PromiseSettledResult<T>[], code: string): void {
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (fulfilled.length !== 1 || rejected.length !== 1 || !isApiError(rejected[0]?.reason, code)) {
    const reason = rejected[0]?.reason;
    const rejectedCode = reason instanceof ApiError
      ? reason.code
      : `${reason instanceof Error ? reason.constructor.name : typeof reason}:${readUnknownCode(reason)}`;
    throw new Error(`OPS-006 expected one success and one ${code} conflict; success=${fulfilled.length}, rejected=${rejected.length}, code=${rejectedCode}`);
  }
}

function readUnknownCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "none";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : "none";
}

function isApiError(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code && error.status === 409;
}

async function resetFixture(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CheckIn", "TaskDebtEvent", "AuditEvent", "StudySession", "StudyTask",
      "SyllabusNode", "Subject", "DailyReview", "RecoveryState", "User"
    CASCADE
  `);
}

function createRecord() {
  const record = {
    schemaVersion: 1,
    mode: "isolated_postgresql_ops006_concurrency_selftest",
    generatedAt: new Date().toISOString(),
    status: "pass",
    source: {
      database: "isolated_local_postgresql",
      migration: path.relative(root, migrationPath),
      migrationSha256: sha256(readFileSync(migrationPath)),
      implementationSha256: sha256([
        "apps/web/lib/study/concurrency.ts",
        "apps/web/lib/study/check-in-service.ts",
        "apps/web/lib/study/service.ts",
        "apps/web/lib/study/simulation-service.ts",
        "apps/web/lib/study/task-debt-reorder-service.ts",
      ].map((file) => readFileSync(path.join(root, file))).join("\n")),
    },
    checks,
    doesNotProve: [
      "production migration safety",
      "production data integrity",
      "signed Release readiness",
      "AF-RISK-OPS-006 residual closure",
    ],
    safetyFacts: {
      isolatedDatabaseRequired: true,
      isolatedDatabaseWriteAttempted: true,
      productionWriteAttempted: false,
      historicalRepairAttempted: false,
      serverCommandAttempted: false,
      secretValuePrinted: false,
      businessTextIncluded: false,
      objectIdentifiersIncluded: false,
    },
  };
  return { ...record, recordHash: sha256(JSON.stringify(record)) };
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readOutputPath(args: string[]): string | null {
  const index = args.indexOf("--output");
  if (index < 0) return null;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error("--output requires a path");
  return path.resolve(root, value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
