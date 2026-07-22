import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const floorCommit = "c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4";
const productMigrations = [
  "20260721120000_v11_m1_exam_workspace_subject",
  "20260721130000_v11_m2_note_task_session_relations",
  "20260721140000_v11_m3_milestone_dependency_inbox",
  "20260721200000_v11_m4_study_resource",
  "20260721210000_v11_m5_learning_tree_import",
  "20260721220000_v11_m6_review_checkin_v2",
  "20260721230000_v11_m7_canvas_motivation_notification",
  "20260722010000_v11_m8_simulation_loss",
];

const mode = process.argv[2];
if (process.env.AREAFORGE_V11_COMPATIBILITY_FLOOR_ISOLATED_DB !== "1") {
  throw new Error("compatibility floor selftest requires AREAFORGE_V11_COMPATIBILITY_FLOOR_ISOLATED_DB=1");
}

if (mode === "seed") {
  await seedWithCandidate();
} else if (mode === "probe") {
  await probeWithFloor();
} else {
  throw new Error("usage: v11-compatibility-floor-runtime.selftest.ts <seed|probe>");
}

async function seedWithCandidate(): Promise<void> {
  const root = process.cwd();
  const { prisma } = await importFrom<{ prisma: CompatiblePrisma }>(path.join(root, "packages/db/src/index.ts"));
  const services = await importFrom<CandidateServices>(path.join(root, "apps/web/lib/study/exam-workspace-service.ts"));

  try {
    await assertIsolatedDatabase(prisma);
    assert.equal(await prisma.user.count(), 0, "compatibility fixture database must start empty");
    await assertProductMigrations(prisma);

    await prisma.user.create({
      data: { id: "v11-compat-user", email: "v11-compat@example.invalid", passwordHash: "synthetic" },
    });
    const first = await services.createExamWorkspace("v11-compat-user", {
      stableKey: "compat-first",
      name: "Compatibility First",
      activate: true,
    });
    const second = await services.createExamWorkspace("v11-compat-user", {
      stableKey: "compat-second",
      name: "Compatibility Second",
      activate: true,
    });
    await services.createWorkspaceSubject("v11-compat-user", first.id, {
      stableKey: "custom-first",
      name: "Custom First",
      color: "#2563eb",
    });
    await services.createWorkspaceSubject("v11-compat-user", second.id, {
      stableKey: "custom-second",
      name: "Custom Second",
      color: "#16a34a",
    });

    const sharedDate = new Date("2026-07-22T00:00:00.000Z");
    const rangeEnd = new Date("2026-07-28T23:59:59.000Z");
    await prisma.dailyReview.createMany({ data: [
      { workspaceId: first.id, reviewDate: sharedDate, summary: "first" },
      { workspaceId: second.id, reviewDate: sharedDate, summary: "second" },
    ] });
    await prisma.checkIn.createMany({ data: [
      { workspaceId: first.id, studyDate: sharedDate },
      { workspaceId: second.id, studyDate: sharedDate },
    ] });
    await prisma.periodicReportDecision.createMany({ data: [
      { workspaceId: first.id, kind: "week", rangeStart: sharedDate, rangeEnd, status: "CONFIRMED", reportSnapshot: {} },
      { workspaceId: second.id, kind: "week", rangeStart: sharedDate, rangeEnd, status: "CONFIRMED", reportSnapshot: {} },
    ] });

    console.log(JSON.stringify({
      schemaVersion: "v11-compatibility-floor-runtime-v1",
      mode: "candidate-seed",
      status: "pass",
      candidateCommit: git(root, ["rev-parse", "HEAD"]),
      floorCommit,
      checks: {
        allProductMigrationsApplied: true,
        secondWorkspaceWritten: true,
        customSubjectsWritten: 2,
        workspaceCompositeRowsWritten: 6,
      },
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function probeWithFloor(): Promise<void> {
  const floorRoot = process.env.AREAFORGE_V11_COMPATIBILITY_FLOOR_ROOT;
  if (!floorRoot || !path.isAbsolute(floorRoot)) throw new Error("AREAFORGE_V11_COMPATIBILITY_FLOOR_ROOT must be absolute");
  assert.equal(git(floorRoot, ["rev-parse", "HEAD"]), floorCommit, "floor checkout commit mismatch");

  const packageVersion = JSON.parse(readFileSync(path.join(floorRoot, "package.json"), "utf8")).version;
  const { prisma } = await importFrom<{ prisma: CompatiblePrisma }>(path.join(floorRoot, "packages/db/src/index.ts"));
  const services = await importFrom<FloorServices>(path.join(floorRoot, "apps/web/lib/study/exam-workspace-service.ts"));

  try {
    await assertIsolatedDatabase(prisma);
    await assertProductMigrations(prisma);

    const workspaces = await services.listExamWorkspaces("v11-compat-user");
    const active = await services.resolveActiveWorkspace("v11-compat-user");
    const subjects = await prisma.subject.findMany({ where: { workspaceId: { not: null } } });
    const [dailyReviews, checkIns, reportDecisions] = await Promise.all([
      prisma.dailyReview.count({ where: { workspaceId: { not: null } } }),
      prisma.checkIn.count({ where: { workspaceId: { not: null } } }),
      prisma.periodicReportDecision.count({ where: { workspaceId: { not: null } } }),
    ]);

    assert.equal(workspaces.length, 2);
    assert.equal(active.stableKey, "compat-second");
    assert.deepEqual(subjects.map((item: { stableKey: string }) => item.stableKey).sort(), ["custom-first", "custom-second"]);
    assert.equal(dailyReviews, 2);
    assert.equal(checkIns, 2);
    assert.equal(reportDecisions, 2);

    console.log(JSON.stringify({
      schemaVersion: "v11-compatibility-floor-runtime-v1",
      mode: "floor-probe",
      status: "pass",
      floorCommit,
      floorPackageVersion: packageVersion,
      checks: {
        fullSchemaReadable: true,
        secondWorkspaceReadable: true,
        customSubjectsReadable: subjects.length,
        workspaceCompositeRowsReadable: dailyReviews + checkIns + reportDecisions,
        activeWorkspaceStableKey: active.stableKey,
      },
    }, null, 2));
    console.log("PASS v1.1 compatibility floor application rollback probe");
  } finally {
    await prisma.$disconnect();
  }
}

async function assertIsolatedDatabase(prisma: CompatiblePrisma): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>("SELECT current_database()");
  const database = rows[0]?.current_database ?? "";
  if (!database.includes("v11compat")) throw new Error("compatibility floor selftest refused database without v11compat marker");
}

async function assertProductMigrations(prisma: CompatiblePrisma): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
  );
  const applied = new Set(rows.map((row) => row.migration_name));
  assert.deepEqual(productMigrations.filter((migration) => !applied.has(migration)), []);
}

async function importFrom<T>(file: string): Promise<T> {
  return import(pathToFileURL(file).href) as Promise<T>;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

type CompatiblePrisma = {
  user: { count(): Promise<number>; create(args: unknown): Promise<unknown> };
  subject: { findMany(args: unknown): Promise<Array<{ stableKey: string }>> };
  dailyReview: { createMany(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
  checkIn: { createMany(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
  periodicReportDecision: { createMany(args: unknown): Promise<unknown>; count(args: unknown): Promise<number> };
  $queryRawUnsafe<T>(query: string): Promise<T>;
  $disconnect(): Promise<void>;
};

type CandidateServices = {
  createExamWorkspace(actorId: string, input: Record<string, unknown>): Promise<{ id: string }>;
  createWorkspaceSubject(actorId: string, workspaceId: string, input: Record<string, unknown>): Promise<unknown>;
};

type FloorServices = {
  listExamWorkspaces(actorId: string): Promise<Array<{ stableKey: string }>>;
  resolveActiveWorkspace(actorId: string): Promise<{ stableKey: string }>;
};
