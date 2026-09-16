import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCapacityFixture, capacityFixtureEnvironment, CAPACITY_FIXTURE_LIMITS } from "./capacity-fixture";
import { loadQuotaFixture } from "./quota-fixture";
import { loadDevTestExportFixture, exportFixtureEnvironment, assertExportFixtureSlot, type DevTestExportFixture } from "../dev/dev-test-export-fixture";
import { loadDevTestCapacityFixture } from "../dev/dev-test-capacity-fixture";
import { loadDevTestQuotaFixture } from "../dev/dev-test-quota-fixture";
import { loadDevTestDeleteFixture } from "../dev/dev-test-delete-fixture";
import { loadDevTestOpsFixture } from "../dev/dev-test-ops-fixture";
import { loadDevTestRankingFixture } from "../dev/dev-test-ranking-fixture";
import { loadDevTestSearchFixture } from "../dev/dev-test-search-fixture";
import type { SlotSelection } from "../dev/dev-test-pool-core";
import { DockerClient } from "../dev/dev-test-docker";
import { capacityRuntimeCode, capacityTransient } from "./capacity-runtime-support";

const root = realpathSync(process.cwd());
const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-capacity-")));
try {
  assert.equal(capacityRuntimeCode({ code: "P2010", meta: { code: "57014" } }), "57014");
  assert.equal(capacityTransient("WORKSPACE_INVITATION_CONTINUATION_REQUIRED"), false);
  for (const name of ["uploads", "exports"]) mkdirSync(path.join(directory, name), { mode: 0o700 });
  const marker = { schemaVersion: 1, fixtureKind: "capacity", databaseName: "areaforge_v20_capacity_abcdef012345",
    containerName: "areaforge-v20-capacity-abcdef012345", volumeName: "areaforge-v20-capacity-abcdef012345-data", port: 54321,
    image: `sha256:${"a".repeat(64)}`, ownerUid: process.getuid!(), ownerGid: process.getgid!(), repositoryHash: createHash("sha256").update(root).digest("hex") };
  const markerFile = path.join(directory, ".areaforge-capacity-fixture.json"); const secretFile = path.join(directory, ".fixture.private.json");
  writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
  writeFileSync(secretFile, JSON.stringify({ password: randomBytes(32).toString("hex"), sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { mode: 0o600 });
  if (process.getuid!() === 0) assert.throws(() => loadCapacityFixture(directory, root));
  else {
    const fixture = loadCapacityFixture(directory, root); const env = capacityFixtureEnvironment(fixture);
    const poolEnv = { ...env, AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT: directory, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL };
    const pool = loadDevTestExportFixture(root, poolEnv)!; assert.equal(pool.kind, "CAPACITY");
    const runtime = exportFixtureEnvironment(pool, 3, 43173, "1.2.0");
    for (const key of ["WORKSPACE_MEMBER_QUOTA_ENABLED", "DATA_JOB_TOTAL_QUOTA_ENABLED", "SEARCH_INDEX_QUEUE_ENABLED", "RANKING_REBUILD_QUEUE_ENABLED", "DATA_EXPORT_ENABLED"]) assert.equal(runtime[key], "true");
    for (const key of ["DATA_JOB_QUOTA_ENABLED", "DATA_DELETE_ENABLED", "DATA_DELETE_WORKER_ENABLED", "OPS_EXECUTION_ENABLED", "PLATFORM_NOTIFICATIONS_ENABLED", "AI_ENABLED"]) assert.equal(runtime[key], "false");
    assert.equal(runtime.WORKSPACE_MEMBER_QUOTA_MAX_SEATS, CAPACITY_FIXTURE_LIMITS.maxSeats);
    assert.equal(runtime.DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE, CAPACITY_FIXTURE_LIMITS.maxInstanceJobs);
    assert.throws(() => loadQuotaFixture(directory), /QUOTA_FIXTURE_INVALID/);
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_CAPACITY_ISOLATED_DB: "0" }));
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://remote.example/other" }));
    for (const [mode, loader] of [["DELETE", loadDevTestDeleteFixture], ["OPS", loadDevTestOpsFixture], ["RANKING", loadDevTestRankingFixture],
      ["SEARCH", loadDevTestSearchFixture], ["QUOTA", loadDevTestQuotaFixture]] as const) {
      const mixed = { ...poolEnv, [`AREAFORGE_DEV_TEST_${mode}_FIXTURE_ROOT`]: directory };
      assert.throws(() => loadDevTestExportFixture(root, mixed), /MODES_CONFLICT/);
      assert.throws(() => loader(root, mixed)); assert.throws(() => loadDevTestCapacityFixture(root, mixed));
    }
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT: directory }), /MODES_CONFLICT/);
    assert.throws(() => loadCapacityFixture(directory, `${root}/other`));
    chmodSync(path.join(directory, "exports"), 0o755); assert.throws(() => loadCapacityFixture(directory)); chmodSync(path.join(directory, "exports"), 0o700);
    writeFileSync(markerFile, JSON.stringify({ ...marker, fixtureKind: "quota" })); assert.throws(() => loadCapacityFixture(directory));
    writeFileSync(markerFile, JSON.stringify({ ...marker, databaseName: "areaforge_shared" })); assert.throws(() => loadCapacityFixture(directory));
    writeFileSync(markerFile, JSON.stringify(marker));
    renameSync(secretFile, `${secretFile}.source`); symlinkSync(`${secretFile}.source`, secretFile);
    assert.throws(() => loadCapacityFixture(directory)); unlinkSync(secretFile); renameSync(`${secretFile}.source`, secretFile);
    assert.doesNotThrow(() => assertExportFixtureSlot({ slot: 3, replacing: { fixtureId: pool.id } } as SlotSelection, pool));
    assert.throws(() => assertExportFixtureSlot({ slot: 3, replacing: { fixtureId: "old-quota" } } as SlotSelection, pool), /SLOT_MISMATCH/);
    for (const slot of [1, 2]) {
      assert.throws(() => assertExportFixtureSlot({ slot } as SlotSelection, pool), /SLOT_REFUSED/);
      assert.throws(() => exportFixtureEnvironment(pool, slot, 43170 + slot, "1.2.0"), /SLOT_REFUSED/);
    }
    assertFixtureMounts(pool);
  }
  console.log("PASS CAPACITY isolation: distinct marker/database, private files, modes, exact slot and readonly mounts");
} finally { rmSync(directory, { recursive: true, force: true }); }

function assertFixtureMounts(pool: DevTestExportFixture) {
  const calls: string[][] = []; const docker = new DockerClient(root);
  Object.defineProperty(docker, "run", { value: (args: string[]) => { calls.push(args); return "synthetic-container"; } });
  docker.runInstance(3, 43173, { imageTag: "synthetic-image", appVersion: "1.2.0", gitCommit: "a".repeat(40),
    sourceFingerprint: `sha256:${"b".repeat(64)}`, buildId: `sha256:${"c".repeat(64)}`, generation: 1, note: "capacity isolation" }, {}, pool);
  const args = calls[0]!; assert.equal(calls.length, 1);
  assert.equal(args.includes("-v"), false); assert.equal(args.some(arg => arg.includes("areaforge-dev-test-uploads")), false);
  assert.ok(args.some(arg => arg.endsWith("dst=/app/uploads,readonly")));
  assert.ok(args.some(arg => arg.endsWith("dst=/app/exports,readonly")));
  for (const kind of [undefined, "DELETE", "OPS", "RANKING", "SEARCH", "QUOTA"] as const) {
    const env = exportFixtureEnvironment({ ...pool, kind, operationContextRoot: directory, operationScopeId: "synthetic" }, 3, 43173, "1.2.0");
    assert.equal(env.WORKSPACE_MEMBER_QUOTA_ENABLED, "false"); assert.equal(env.DATA_JOB_TOTAL_QUOTA_ENABLED, "false");
  }
}
