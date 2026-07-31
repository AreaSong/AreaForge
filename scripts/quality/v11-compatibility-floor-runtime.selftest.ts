import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  assertEmbeddedMigrationManifests,
  assertGitCommitMigrationManifest,
  assertSourceMigrationManifest,
  currentMigrationManifest,
  floorCommit,
  floorMigrationManifest,
  legacyCommit,
  legacyMigrationManifest,
  migrationManifestDigest,
  type MigrationManifestEntry,
} from "./v11-compatibility-floor-manifest";
import {
  buildWorktreeValidationFingerprint,
  type WorktreeValidationFingerprint,
} from "./worktree-validation-fingerprint";

const fingerprintCommand = "pnpm ops:v11:compatibility-floor:orchestrate";
const fixtureUserId = "v11-compat-user";
const legacySubjectId = "v11-compat-legacy-subject";
const mode = process.argv[2];

if (process.env.AREAFORGE_V11_COMPATIBILITY_FLOOR_ISOLATED_DB !== "1") {
  throw new Error("compatibility floor selftest requires AREAFORGE_V11_COMPATIBILITY_FLOOR_ISOLATED_DB=1");
}
assertEmbeddedMigrationManifests();

if (mode === "seed") {
  await seedWithCandidate();
} else if (mode === "probe") {
  await probeWithFloor();
} else if (mode === "validate") {
  await validateWithCandidate();
} else {
  throw new Error("usage: v11-compatibility-floor-runtime.selftest.ts <seed|probe|validate>");
}

async function seedWithCandidate(): Promise<void> {
  const root = process.cwd();
  const stateFile = requireStateFile(root);
  if (existsSync(stateFile)) throw new Error("compatibility state file must not exist before seed");
  const excludedPaths = resolveFingerprintExclusions();
  const candidateFingerprint = fingerprint(root, excludedPaths);

  assertSourceMigrationManifest(root, currentMigrationManifest, "candidate source");
  assertGitCommitMigrationManifest(root, legacyCommit, legacyMigrationManifest, "legacy commit");
  assertGitCommitMigrationManifest(root, floorCommit, floorMigrationManifest, "floor commit");

  const { prisma } = await importFrom<{ prisma: CompatiblePrisma }>(path.join(root, "packages/db/src/index.ts"));
  const services = await importFrom<CandidateServices>(path.join(root, "apps/web/lib/study/exam-workspace-service.ts"));

  try {
    const database = await assertDatabaseIdentityAndLedger(prisma);
    await assertFixtureDatabaseEmpty(prisma);
    await seedCompatibilityFixture(prisma, services);
    const checks = await assertSeededFixture(prisma);
    assert.deepEqual(fingerprint(root, excludedPaths), candidateFingerprint, "candidate worktree changed during seed");

    const state: CompatibilityState = {
      schemaVersion: "v11-compatibility-floor-runtime-v2",
      expectedDatabaseName: database.name,
      postgresServerVersionNum: database.serverVersionNum,
      candidateCommit: git(root, ["rev-parse", "HEAD"]),
      legacyCommit,
      floorCommit,
      manifests: manifestSummary(),
      fingerprintExcludedPaths: excludedPaths,
      candidateFingerprint,
      seedChecks: checks,
    };
    writeState(stateFile, state);
    console.log(JSON.stringify({ mode: "candidate-seed", status: "pass", ...state }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function probeWithFloor(): Promise<void> {
  const root = process.cwd();
  const stateFile = requireStateFile(root);
  const state = readState(stateFile);
  assertStateMatchesEnvironment(state);
  assert.deepEqual(
    fingerprint(root, state.fingerprintExcludedPaths),
    state.candidateFingerprint,
    "candidate worktree changed after seed",
  );

  const floorRoot = process.env.AREAFORGE_V11_COMPATIBILITY_FLOOR_ROOT;
  if (!floorRoot || !path.isAbsolute(floorRoot)) {
    throw new Error("AREAFORGE_V11_COMPATIBILITY_FLOOR_ROOT must be absolute");
  }
  assert.equal(git(floorRoot, ["rev-parse", "HEAD"]), floorCommit, "floor checkout commit mismatch");
  assertSourceMigrationManifest(floorRoot, floorMigrationManifest, "floor source");

  const floorFingerprint = fingerprint(floorRoot, []);
  assert.equal(floorFingerprint.worktreeState, "clean", "floor checkout must remain clean after install/generate/build");
  const packageVersion = JSON.parse(readFileSync(path.join(floorRoot, "package.json"), "utf8")).version;
  const { prisma } = await importFrom<{ prisma: CompatiblePrisma }>(path.join(floorRoot, "packages/db/src/index.ts"));
  const services = await importFrom<FloorServices>(path.join(floorRoot, "apps/web/lib/study/exam-workspace-service.ts"));

  try {
    await assertDatabaseIdentityAndLedger(prisma);
    const checks = await assertFloorReadback(prisma, services);
    assert.deepEqual(fingerprint(floorRoot, []), floorFingerprint, "floor worktree changed during probe");
    assert.deepEqual(
      fingerprint(root, state.fingerprintExcludedPaths),
      state.candidateFingerprint,
      "candidate worktree changed during probe",
    );

    const nextState: CompatibilityState = {
      ...state,
      floorPackageVersion: packageVersion,
      floorFingerprint,
      probeChecks: checks,
    };
    writeState(stateFile, nextState);
    console.log(JSON.stringify({ mode: "floor-probe", status: "pass", ...nextState }, null, 2));
    console.log("PASS v1.1 compatibility floor application rollback probe");
  } finally {
    await prisma.$disconnect();
  }
}

async function validateWithCandidate(): Promise<void> {
  const root = process.cwd();
  const stateFile = requireStateFile(root);
  const state = readState(stateFile);
  assertStateMatchesEnvironment(state);
  assert(state.floorFingerprint && state.probeChecks, "floor probe must pass before final validation");
  assert.deepEqual(
    fingerprint(root, state.fingerprintExcludedPaths),
    state.candidateFingerprint,
    "candidate worktree changed before final validation",
  );
  assertSourceMigrationManifest(root, currentMigrationManifest, "candidate source");

  const { prisma } = await importFrom<{ prisma: CompatiblePrisma }>(path.join(root, "packages/db/src/index.ts"));
  try {
    const database = await assertDatabaseIdentityAndLedger(prisma);
    const finalState: CompatibilityState = {
      ...state,
      finalValidation: {
        status: "pass",
        databaseName: database.name,
        migrationCount: currentMigrationManifest.length,
        candidateFingerprintStable: true,
        repeatDeployLedgerStable: true,
      },
    };
    writeState(stateFile, finalState);
    console.log(JSON.stringify({ mode: "candidate-final-validate", status: "pass", ...finalState }, null, 2));
    console.log("PASS v1.1 compatibility floor 24-migration final validation");
  } finally {
    await prisma.$disconnect();
  }
}

async function seedCompatibilityFixture(prisma: CompatiblePrisma, services: CandidateServices): Promise<void> {
  await prisma.user.create({
    data: { id: fixtureUserId, email: "v11-compat@example.invalid", passwordHash: "synthetic" },
  });
  await prisma.subject.create({
    data: {
      id: legacySubjectId,
      legacyCode: "MATH",
      workspaceId: null,
      stableKey: "math",
      name: "Legacy Mathematics",
      color: "#475569",
    },
  });

  const first = await services.createExamWorkspace(fixtureUserId, {
    stableKey: "compat-first",
    name: "Compatibility First",
    activate: true,
    subjects: [{ stableKey: "custom-first", name: "Custom First", color: "#2563eb" }],
  });
  const second = await services.createExamWorkspace(fixtureUserId, {
    stableKey: "compat-second",
    name: "Compatibility Second",
    activate: true,
    subjects: [{ stableKey: "custom-second", name: "Custom Second", color: "#16a34a" }],
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

  await expectUniqueConflict(
    () => prisma.dailyReview.create({ data: { workspaceId: first.id, reviewDate: sharedDate, summary: "duplicate" } }),
    "DailyReview workspace/date",
  );
  await expectUniqueConflict(
    () => prisma.checkIn.create({ data: { workspaceId: first.id, studyDate: sharedDate } }),
    "CheckIn workspace/date",
  );
  await expectUniqueConflict(
    () => prisma.periodicReportDecision.create({
      data: { workspaceId: first.id, kind: "week", rangeStart: sharedDate, rangeEnd, status: "CONFIRMED", reportSnapshot: {} },
    }),
    "PeriodicReportDecision workspace/period",
  );
}

async function assertSeededFixture(prisma: CompatiblePrisma): Promise<FixtureChecks> {
  const subjects = await prisma.subject.findMany({ where: {} });
  const legacy = subjects.find((item) => item.id === legacySubjectId);
  const custom = subjects.filter((item) => item.workspaceId !== null);
  assert.equal(legacy?.legacyCode, "MATH");
  assert.equal(legacy?.workspaceId, null);
  assert.equal(custom.length, 2);
  assert(custom.every((item) => item.legacyCode === null), "custom subjects must keep legacyCode=null");
  const [dailyReviews, checkIns, reportDecisions] = await fixtureRowCounts(prisma);
  assert.deepEqual([dailyReviews, checkIns, reportDecisions], [2, 2, 2]);
  return {
    legacySubjectWritten: true,
    secondWorkspaceWritten: true,
    customSubjectsWithNullLegacyCode: custom.length,
    workspaceCompositeRowsWritten: dailyReviews + checkIns + reportDecisions,
    sameWorkspaceCompositeDuplicatesRejected: 3,
  };
}

async function assertFloorReadback(prisma: CompatiblePrisma, services: FloorServices): Promise<FixtureChecks> {
  const workspaces = await services.listExamWorkspaces(fixtureUserId);
  const active = await services.resolveActiveWorkspace(fixtureUserId);
  const subjects = await prisma.subject.findMany({ where: {} });
  const legacy = subjects.find((item) => item.id === legacySubjectId);
  const custom = subjects.filter((item) => item.workspaceId !== null);
  const [dailyReviews, checkIns, reportDecisions] = await fixtureRowCounts(prisma);

  assert.equal(workspaces.length, 2);
  assert.equal(active.stableKey, "compat-second");
  assert.equal(legacy?.legacyCode, "MATH");
  assert.equal(legacy?.workspaceId, null);
  assert.deepEqual(custom.map((item) => item.stableKey).sort(), ["custom-first", "custom-second"]);
  assert(custom.every((item) => item.legacyCode === null), "floor must read custom subjects with legacyCode=null");
  assert.deepEqual([dailyReviews, checkIns, reportDecisions], [2, 2, 2]);
  return {
    legacySubjectWritten: true,
    secondWorkspaceWritten: true,
    customSubjectsWithNullLegacyCode: custom.length,
    workspaceCompositeRowsWritten: dailyReviews + checkIns + reportDecisions,
    sameWorkspaceCompositeDuplicatesRejected: 3,
  };
}

async function assertFixtureDatabaseEmpty(prisma: CompatiblePrisma): Promise<void> {
  const [users, subjects, workspaces] = await Promise.all([
    prisma.user.count(),
    prisma.subject.count(),
    prisma.examWorkspace.count(),
  ]);
  assert.deepEqual([users, subjects, workspaces], [0, 0, 0], "compatibility fixture database must start empty");
}

async function fixtureRowCounts(prisma: CompatiblePrisma): Promise<[number, number, number]> {
  return Promise.all([
    prisma.dailyReview.count({ where: { workspaceId: { not: null } } }),
    prisma.checkIn.count({ where: { workspaceId: { not: null } } }),
    prisma.periodicReportDecision.count({ where: { workspaceId: { not: null } } }),
  ]);
}

async function assertDatabaseIdentityAndLedger(prisma: CompatiblePrisma): Promise<DatabaseIdentity> {
  const expectedName = process.env.AREAFORGE_V11_COMPATIBILITY_EXPECTED_DATABASE_NAME;
  if (!expectedName || !expectedName.includes("v11compat")) {
    throw new Error("AREAFORGE_V11_COMPATIBILITY_EXPECTED_DATABASE_NAME must contain v11compat");
  }
  const identities = await prisma.$queryRawUnsafe<Array<{ database_name: string; server_version_num: string | number }>>(
    "SELECT current_database() AS database_name, current_setting('server_version_num') AS server_version_num",
  );
  const identity = identities[0];
  assert(identity, "database identity query returned no rows");
  assert.equal(identity.database_name, expectedName, "compatibility database name mismatch");
  const serverVersionNum = Number(identity.server_version_num);
  assert(serverVersionNum >= 160000 && serverVersionNum < 170000, "compatibility database must be PostgreSQL 16.x");
  await assertMigrationLedger(prisma, currentMigrationManifest);
  return { name: identity.database_name, serverVersionNum };
}

async function assertMigrationLedger(
  prisma: CompatiblePrisma,
  expected: readonly MigrationManifestEntry[],
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<MigrationLedgerRow[]>(
    `SELECT id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
       FROM "_prisma_migrations"
      ORDER BY started_at ASC, id ASC`,
  );
  assert.equal(rows.length, expected.length, "migration ledger row count mismatch");
  assert.deepEqual(rows.map((row) => row.migration_name), expected.map((entry) => entry.name), "migration ledger order mismatch");
  assert.equal(new Set(rows.map((row) => row.migration_name)).size, expected.length, "migration ledger contains duplicates");

  rows.forEach((row, index) => {
    const migration = expected[index];
    assert(migration, `missing expected migration at index ${index}`);
    assert.equal(row.checksum, migration.sha256, `database checksum mismatch: ${migration.name}`);
    assert(row.finished_at !== null, `migration is unfinished: ${migration.name}`);
    assert.equal(row.rolled_back_at, null, `migration was rolled back: ${migration.name}`);
    assert.equal(row.logs, null, `migration contains failure logs: ${migration.name}`);
    assert.equal(Number(row.applied_steps_count), 1, `migration applied step count mismatch: ${migration.name}`);
  });
}

async function expectUniqueConflict(action: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    const message = error instanceof Error ? error.message : "";
    assert(code === "P2002" || message.includes("duplicate key value violates unique constraint"), `${label} failed unexpectedly`);
    return;
  }
  assert.fail(`${label} duplicate unexpectedly succeeded`);
}

function assertStateMatchesEnvironment(state: CompatibilityState): void {
  assert.equal(state.schemaVersion, "v11-compatibility-floor-runtime-v2");
  assert.equal(state.expectedDatabaseName, process.env.AREAFORGE_V11_COMPATIBILITY_EXPECTED_DATABASE_NAME);
  assert.equal(state.legacyCommit, legacyCommit);
  assert.equal(state.floorCommit, floorCommit);
  assert.deepEqual(state.manifests, manifestSummary());
}

function manifestSummary(): CompatibilityState["manifests"] {
  return {
    legacy: { count: legacyMigrationManifest.length, sha256: migrationManifestDigest(legacyMigrationManifest) },
    floor: { count: floorMigrationManifest.length, sha256: migrationManifestDigest(floorMigrationManifest) },
    current: { count: currentMigrationManifest.length, sha256: migrationManifestDigest(currentMigrationManifest) },
  };
}

function fingerprint(root: string, excludedPaths: string[]): WorktreeValidationFingerprint {
  return buildWorktreeValidationFingerprint(root, fingerprintCommand, "custom", excludedPaths);
}

function resolveFingerprintExclusions(): string[] {
  const value = process.env.AREAFORGE_V11_COMPATIBILITY_EVIDENCE_RECORD?.trim();
  if (!value) return [];
  if (path.isAbsolute(value) || value === ".." || value.startsWith(`..${path.sep}`)) {
    throw new Error("AREAFORGE_V11_COMPATIBILITY_EVIDENCE_RECORD must be repository-relative");
  }
  return [value.split(path.sep).join("/")];
}

function requireStateFile(root: string): string {
  const stateFile = process.env.AREAFORGE_V11_COMPATIBILITY_STATE_FILE;
  if (!stateFile || !path.isAbsolute(stateFile)) {
    throw new Error("AREAFORGE_V11_COMPATIBILITY_STATE_FILE must be an absolute path outside the repository");
  }
  const relative = path.relative(root, stateFile);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error("compatibility state file must be outside the repository");
  }
  return stateFile;
}

function readState(stateFile: string): CompatibilityState {
  return JSON.parse(readFileSync(stateFile, "utf8")) as CompatibilityState;
}

function writeState(stateFile: string, state: CompatibilityState): void {
  const temporary = `${stateFile}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, stateFile);
}

async function importFrom<T>(file: string): Promise<T> {
  return import(pathToFileURL(file).href) as Promise<T>;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type DatabaseIdentity = { name: string; serverVersionNum: number };
type FixtureChecks = {
  legacySubjectWritten: true;
  secondWorkspaceWritten: true;
  customSubjectsWithNullLegacyCode: number;
  workspaceCompositeRowsWritten: number;
  sameWorkspaceCompositeDuplicatesRejected: 3;
};

type CompatibilityState = {
  schemaVersion: "v11-compatibility-floor-runtime-v2";
  expectedDatabaseName: string;
  postgresServerVersionNum: number;
  candidateCommit: string;
  legacyCommit: string;
  floorCommit: string;
  manifests: {
    legacy: { count: number; sha256: string };
    floor: { count: number; sha256: string };
    current: { count: number; sha256: string };
  };
  fingerprintExcludedPaths: string[];
  candidateFingerprint: WorktreeValidationFingerprint;
  seedChecks: FixtureChecks;
  floorPackageVersion?: string;
  floorFingerprint?: WorktreeValidationFingerprint;
  probeChecks?: FixtureChecks;
  finalValidation?: {
    status: "pass";
    databaseName: string;
    migrationCount: number;
    candidateFingerprintStable: true;
    repeatDeployLedgerStable: true;
  };
};

type MigrationLedgerRow = {
  id: string;
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  logs: string | null;
  rolled_back_at: Date | null;
  started_at: Date;
  applied_steps_count: number | bigint;
};

type SubjectRow = {
  id: string;
  stableKey: string;
  legacyCode: string | null;
  workspaceId: string | null;
};

type CompatiblePrisma = {
  user: { count(): Promise<number>; create(args: unknown): Promise<unknown> };
  examWorkspace: { count(): Promise<number> };
  subject: {
    count(): Promise<number>;
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<SubjectRow[]>;
  };
  dailyReview: {
    createMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    count(args: unknown): Promise<number>;
  };
  checkIn: {
    createMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    count(args: unknown): Promise<number>;
  };
  periodicReportDecision: {
    createMany(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    count(args: unknown): Promise<number>;
  };
  $queryRawUnsafe<T>(query: string): Promise<T>;
  $disconnect(): Promise<void>;
};

type CandidateServices = {
  createExamWorkspace(actorId: string, input: Record<string, unknown>): Promise<{ id: string }>;
};

type FloorServices = {
  listExamWorkspaces(actorId: string): Promise<Array<{ stableKey: string }>>;
  resolveActiveWorkspace(actorId: string): Promise<{ stableKey: string }>;
};
