import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../packages/db/src/index";
import {
  convertPlanInboxItem,
  createUserPlanInboxItem,
} from "../../apps/web/lib/study/plan-inbox-service";
import { listStudyTasks } from "../../apps/web/lib/study/study-query-service";
import {
  getCheckInLockTargets,
  listWorkspaceCheckIns,
  refreshWorkspaceCheckInSnapshotForDate,
} from "../../apps/web/lib/study/check-in-service";
import { getStudyDayRange } from "../../apps/web/lib/study/date";
import {
  resetRbacRuntimeFixture,
  seedRbacRuntimeFixture,
} from "./v15-rbac-runtime-fixture";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
const expectedDatabase = process.env.AREAFORGE_V15_R_EXPECTED_DATABASE ?? "";
const checkInMigrationSql = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20260906105000_v15_r_check_in_owner/migration.sql"),
  "utf8",
).trim();

try {
  configureSyntheticEnvironment();
  await assertIsolatedDatabase();
  await verifyCheckInMigrationContract();
  await resetRbacRuntimeFixture();
  const fixture = await seedRbacRuntimeFixture("v15-r-owner");
  const plannedDate = new Date("2026-09-07T00:00:00.000Z");

  const inbox = await createUserPlanInboxItem(fixture.users.member.userId, {
    clientRequestKey: "member-owner-contract",
    title: "成员自己的正式任务",
    subjectId: fixture.subjects.primary,
    plannedDate: plannedDate.toISOString(),
    estimatedMinutes: 35,
    priority: "HIGH",
    type: "study",
  });
  const converted = await convertPlanInboxItem(fixture.users.member.userId, inbox.id, {
    expectedRevision: inbox.revision,
    idempotencyKey: `member-owner-${fixture.users.member.userId}`,
  });

  assert.equal(converted.status, "CONVERTED");
  assert.ok(converted.convertedTaskId);
  const task = await prisma.studyTask.findUniqueOrThrow({
    where: { id: converted.convertedTaskId },
    select: { ownerUserId: true, subjectId: true, title: true },
  });
  assert.equal(task.ownerUserId, fixture.users.member.userId);
  assert.equal(task.subjectId, fixture.subjects.primary);

  const memberTasks = await listStudyTasks(fixture.users.member.userId);
  assert.equal(memberTasks.some((item) => item.id === converted.convertedTaskId), true);
  const ownerTasks = await listStudyTasks(fixture.users.owner.userId);
  assert.equal(ownerTasks.some((item) => item.id === converted.convertedTaskId), false);

  const checkInIsolation = await verifyCheckInIsolation(fixture);

  console.log(JSON.stringify({
    schemaVersion: "v15-r-owner-isolation-runtime-selftest-v2",
    status: "pass",
    checks: [
      {
        id: "check_in_owner_migration_fails_closed",
        status: "pass",
        details: {
          cleanWorkspacePreimageApplied: true,
          mixedMemberPreimageRejected: true,
          ambiguousGlobalPreimageRejected: true,
        },
      },
      {
        id: "member_plan_inbox_conversion_creates_member_owned_task",
        status: "pass",
        details: {
          convertedTaskId: converted.convertedTaskId,
          taskOwner: task.ownerUserId,
          memberCanRead: true,
          workspaceOwnerCannotReadMemberTask: true,
        },
      },
      {
        id: "member_check_in_projection_isolated_by_actor",
        status: "pass",
        details: checkInIsolation,
      },
    ],
    safetyFacts: {
      isolatedDatabaseRequired: true,
      isolatedDatabaseWriteAttempted: true,
      productionWriteAttempted: false,
      physicalDeleteAttempted: false,
      serverCommandAttempted: false,
      secretsOperationAttempted: false,
    },
  }, null, 2));
  console.log("PASS v1.5-R owner isolation runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function verifyCheckInMigrationContract(): Promise<void> {
  const columns = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CheckIn'
      AND column_name = 'ownerUserId'
  `;
  assert.equal(columns[0]?.is_nullable, "NO");
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'CheckIn_owner_legacy_studyDate_uidx',
        'CheckIn_owner_workspace_studyDate_uidx',
        'CheckIn_ownerUserId_workspaceId_studyDate_idx'
      )
    ORDER BY indexname
  `;
  assert.equal(indexes.length, 3);

  await applyCheckInMigrationFixture("v15_r_checkin_clean", "clean");
  await assert.rejects(
    () => applyCheckInMigrationFixture("v15_r_checkin_mixed", "mixed"),
    /mixed or unknown member source facts/,
  );
  await assert.rejects(
    () => applyCheckInMigrationFixture("v15_r_checkin_global", "ambiguous-global"),
    /cannot infer global CheckIn owner/,
  );
}

async function applyCheckInMigrationFixture(
  schema: string,
  mode: "clean" | "mixed" | "ambiguous-global",
): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await createCheckInMigrationPreimage(tx, mode);
      await tx.$executeRawUnsafe(checkInMigrationSql);
      if (mode === "clean") {
        const rows = await tx.$queryRawUnsafe<Array<{ ownerUserId: string }>>(
          'SELECT "ownerUserId" FROM "CheckIn"',
        );
        assert.deepEqual(rows, [{ ownerUserId: "owner" }]);
      }
    });
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
}

async function createCheckInMigrationPreimage(
  tx: { $executeRawUnsafe: (query: string) => Promise<unknown> },
  mode: "clean" | "mixed" | "ambiguous-global",
): Promise<void> {
  await tx.$executeRawUnsafe(`
    CREATE TABLE "User" (
      "id" TEXT PRIMARY KEY,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "ExamWorkspace" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL
    );
    CREATE TABLE "Subject" (
      "id" TEXT PRIMARY KEY,
      "workspaceId" TEXT
    );
    CREATE TABLE "CheckIn" (
      "id" TEXT PRIMARY KEY,
      "workspaceId" TEXT,
      "studyDate" TIMESTAMP(3) NOT NULL
    );
    CREATE TABLE "StudySession" (
      "id" TEXT PRIMARY KEY,
      "subjectId" TEXT NOT NULL,
      "startedAt" TIMESTAMP(3) NOT NULL,
      "status" TEXT NOT NULL,
      "userId" TEXT
    );
    CREATE TABLE "StudyTask" (
      "id" TEXT PRIMARY KEY,
      "subjectId" TEXT NOT NULL,
      "plannedDate" TIMESTAMP(3) NOT NULL,
      "ownerUserId" TEXT
    );
    CREATE TABLE "DailyReview" (
      "id" TEXT PRIMARY KEY,
      "workspaceId" TEXT,
      "reviewDate" TIMESTAMP(3) NOT NULL,
      "ownerUserId" TEXT NOT NULL
    );
    CREATE TABLE "ReviewSchedule" (
      "id" TEXT PRIMARY KEY,
      "workspaceId" TEXT NOT NULL
    );
    CREATE TABLE "ReviewEvent" (
      "id" TEXT PRIMARY KEY,
      "reviewScheduleId" TEXT NOT NULL,
      "learningDate" TIMESTAMP(3) NOT NULL,
      "actorId" TEXT
    );
    CREATE UNIQUE INDEX "CheckIn_legacy_studyDate_uidx"
      ON "CheckIn"("studyDate") WHERE "workspaceId" IS NULL;
    CREATE UNIQUE INDEX "CheckIn_workspace_studyDate_uidx"
      ON "CheckIn"("workspaceId", "studyDate") WHERE "workspaceId" IS NOT NULL;
    INSERT INTO "User" ("id") VALUES ('owner');
  `);

  if (mode === "ambiguous-global") {
    await tx.$executeRawUnsafe(`
      INSERT INTO "User" ("id") VALUES ('member');
      INSERT INTO "CheckIn" ("id", "workspaceId", "studyDate")
      VALUES ('check-in', NULL, '2030-01-14 16:00:00');
    `);
    return;
  }

  await tx.$executeRawUnsafe(`
    INSERT INTO "ExamWorkspace" ("id", "userId") VALUES ('workspace', 'owner');
    INSERT INTO "Subject" ("id", "workspaceId") VALUES ('subject', 'workspace');
    INSERT INTO "CheckIn" ("id", "workspaceId", "studyDate")
    VALUES ('check-in', 'workspace', '2030-01-14 16:00:00');
  `);
  if (mode === "mixed") {
    await tx.$executeRawUnsafe(`
      INSERT INTO "User" ("id") VALUES ('member');
      INSERT INTO "StudySession" ("id", "subjectId", "startedAt", "status", "userId")
      VALUES ('session', 'subject', '2030-01-14 17:00:00', 'COMPLETED', 'member');
    `);
  }
}

async function verifyCheckInIsolation(fixture: Awaited<ReturnType<typeof seedRbacRuntimeFixture>>) {
  const day = getStudyDayRange(new Date("2030-01-15T12:00:00.000Z"));
  const ownerUserId = fixture.users.owner.userId;
  const memberUserId = fixture.users.member.userId;
  const workspaceId = fixture.workspaceIds.primary;

  await prisma.studyTask.createMany({
    data: [
      {
        ownerUserId,
        subjectId: fixture.subjects.primary,
        title: "Owner CheckIn fixture",
        type: "study",
        status: "DONE",
        plannedDate: day.start,
      },
      {
        ownerUserId: memberUserId,
        subjectId: fixture.subjects.primary,
        title: "Member CheckIn fixture",
        type: "study",
        status: "TODO",
        plannedDate: day.start,
      },
    ],
  });
  await prisma.studySession.createMany({
    data: [
      {
        userId: ownerUserId,
        workspaceId,
        subjectId: fixture.subjects.primary,
        status: "COMPLETED",
        startedAt: new Date(day.start.getTime() + 60 * 60 * 1000),
        endedAt: new Date(day.start.getTime() + 106 * 60 * 1000),
        effectiveMinutes: 45,
        isEffective: true,
        isLowConversion: false,
      },
      {
        userId: memberUserId,
        workspaceId,
        subjectId: fixture.subjects.primary,
        status: "COMPLETED",
        startedAt: new Date(day.start.getTime() + 2 * 60 * 60 * 1000),
        endedAt: new Date(day.start.getTime() + 150 * 60 * 1000),
        effectiveMinutes: 30,
        isEffective: true,
        isLowConversion: false,
      },
    ],
  });
  await prisma.dailyReview.create({
    data: {
      ownerUserId,
      workspaceId,
      reviewDate: day.start,
      summary: "Owner-only CheckIn review fixture",
    },
  });

  const ownerLock = getCheckInLockTargets(ownerUserId, [day.start])[0]?.lockKey;
  const memberLock = getCheckInLockTargets(memberUserId, [day.start])[0]?.lockKey;
  assert.notEqual(ownerLock, memberLock);

  const [ownerSnapshot, memberSnapshot] = await Promise.all([
    prisma.$transaction((tx) => refreshWorkspaceCheckInSnapshotForDate(ownerUserId, workspaceId, day.start, tx)),
    prisma.$transaction((tx) => refreshWorkspaceCheckInSnapshotForDate(memberUserId, workspaceId, day.start, tx)),
  ]);
  assert.equal(ownerSnapshot.effectiveMinutes, 45);
  assert.equal(ownerSnapshot.taskCompletionRate, 1);
  assert.equal(ownerSnapshot.reviewSubmitted, true);
  assert.equal(memberSnapshot.effectiveMinutes, 30);
  assert.equal(memberSnapshot.taskCompletionRate, 0);
  assert.equal(memberSnapshot.reviewSubmitted, false);

  const [ownerRows, memberRows, storedCount] = await Promise.all([
    listWorkspaceCheckIns(ownerUserId, workspaceId, day.start, day.start),
    listWorkspaceCheckIns(memberUserId, workspaceId, day.start, day.start),
    prisma.checkIn.count({ where: { workspaceId, studyDate: day.start } }),
  ]);
  assert.equal(ownerRows.length, 1);
  assert.equal(memberRows.length, 1);
  assert.equal(ownerRows[0]?.effectiveMinutes, 45);
  assert.equal(memberRows[0]?.effectiveMinutes, 30);
  assert.equal(storedCount, 2);

  return {
    sameWorkspaceRowCount: storedCount,
    ownerEffectiveMinutes: ownerRows[0]?.effectiveMinutes ?? -1,
    memberEffectiveMinutes: memberRows[0]?.effectiveMinutes ?? -1,
    actorScopedAdvisoryLocks: true,
  };
}

function configureSyntheticEnvironment(): void {
  process.env.AUTH_MULTI_USER_ENABLED = "true";
  process.env.AUTH_RBAC_ENABLED = "true";
  process.env.AUTH_SESSION_SECRET = process.env.AUTH_SESSION_SECRET ?? "v15-r-owner-isolated-session-secret";
  process.env.AUTH_ACTION_TOKEN_SECRET = process.env.AUTH_ACTION_TOKEN_SECRET ?? "v15-r-owner-isolated-action-secret";
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V15_R_ISOLATED_DB !== "1") {
    throw new Error("v1.5-R runtime selftest requires AREAFORGE_V15_R_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const database = rows[0]?.current_database ?? "";
  if (!database.includes("v15rbac")) throw new Error("v1.5-R runtime selftest refused a non-v15rbac database");
  if (expectedDatabase && database !== expectedDatabase) throw new Error("v1.5-R runtime selftest database mismatch");
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("v1.5-R runtime selftest requires a loopback database host");
  }
}
