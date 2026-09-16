import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadQuotaFixture, quotaFixtureEnvironment, QUOTA_FIXTURE_LIMITS } from "./quota-fixture";
import { loadDevTestExportFixture, exportFixtureEnvironment, assertExportFixtureSlot, type DevTestExportFixture } from "../dev/dev-test-export-fixture";
import type { SlotSelection } from "../dev/dev-test-pool-core";
import { DockerClient } from "../dev/dev-test-docker";
import { quotaRuntimeCode, quotaTransient } from "./quota-runtime-support";

const root = realpathSync(process.cwd());
const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-quota-")));
try {
  assert.equal(quotaRuntimeCode({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40001" } } } }), "40001");
  assert.equal(quotaTransient("40001"), true); assert.equal(quotaTransient("23514"), false);
  for (const name of ["uploads", "exports"]) mkdirSync(path.join(directory, name), { mode: 0o700 });
  const marker = { schemaVersion: 1, fixtureKind: "quota", databaseName: "areaforge_v20_quota_abcdef012345",
    containerName: "areaforge-v20-quota-abcdef012345", volumeName: "areaforge-v20-quota-abcdef012345-data", port: 54321,
    image: `sha256:${"a".repeat(64)}`, ownerUid: process.getuid!(), ownerGid: process.getgid!(), repositoryHash: createHash("sha256").update(root).digest("hex") };
  const markerFile = path.join(directory, ".areaforge-quota-fixture.json"); const secretFile = path.join(directory, ".fixture.private.json");
  writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
  writeFileSync(secretFile, JSON.stringify({ password: randomBytes(32).toString("hex"), sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { mode: 0o600 });
  if (process.getuid!() === 0) assert.throws(() => loadQuotaFixture(directory, root));
  else {
    const fixture = loadQuotaFixture(directory, root); const env = quotaFixtureEnvironment(fixture);
    const poolEnv = { ...env, AREAFORGE_DEV_TEST_QUOTA_FIXTURE_ROOT: directory, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL };
    const pool = loadDevTestExportFixture(root, poolEnv)!; assert.equal(pool.kind, "QUOTA");
    const runtime = exportFixtureEnvironment(pool, 3, 43173, "1.2.0");
    for (const key of ["DATA_JOB_QUOTA_ENABLED", "SEARCH_INDEX_QUEUE_ENABLED", "RANKING_REBUILD_QUEUE_ENABLED", "DATA_EXPORT_ENABLED", "DATA_JOB_WORKER_ENABLED"]) assert.equal(runtime[key], "true");
    for (const key of ["DATA_DELETE_ENABLED", "DATA_DELETE_WORKER_ENABLED", "OPS_EXECUTION_ENABLED", "PLATFORM_NOTIFICATIONS_ENABLED", "AI_ENABLED"]) assert.equal(runtime[key], "false");
    assert.equal(runtime.DATA_JOB_QUOTA_MAX_ACTIVE_JOBS, QUOTA_FIXTURE_LIMITS.maxActiveJobs);
    assert.equal(runtime.DATA_JOB_QUOTA_MAX_EXPORTS_24H, QUOTA_FIXTURE_LIMITS.maxExports24h);
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_DATA_JOB_QUOTA_ISOLATED_DB: "0" }));
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://remote.example/other" }));
    for (const mode of ["EXPORT", "DELETE", "OPS", "RANKING", "SEARCH"]) {
      assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, [`AREAFORGE_DEV_TEST_${mode}_FIXTURE_ROOT`]: directory }), /MODES_CONFLICT/);
    }
    assert.throws(() => loadQuotaFixture(directory, `${root}/other`));
    chmodSync(path.join(directory, "exports"), 0o755); assert.throws(() => loadQuotaFixture(directory)); chmodSync(path.join(directory, "exports"), 0o700);
    writeFileSync(markerFile, JSON.stringify({ ...marker, databaseName: "areaforge_shared" })); assert.throws(() => loadQuotaFixture(directory)); writeFileSync(markerFile, JSON.stringify(marker));
    renameSync(secretFile, `${secretFile}.source`); symlinkSync(`${secretFile}.source`, secretFile);
    assert.throws(() => loadQuotaFixture(directory)); unlinkSync(secretFile); renameSync(`${secretFile}.source`, secretFile);
    assert.doesNotThrow(() => assertExportFixtureSlot({ replacing: { fixtureId: pool.id } } as SlotSelection, pool));
    assert.throws(() => assertExportFixtureSlot({ replacing: { fixtureId: "old-search" } } as SlotSelection, pool), /SLOT_MISMATCH/);
    assertFixtureMounts(pool);
  }
  console.log("PASS QUOTA fixture: exact namespace, ownership, permissions, mode/slot isolation and readonly mounts");
} finally { rmSync(directory, { recursive: true, force: true }); }

function assertFixtureMounts(pool: DevTestExportFixture) {
  const calls: string[][] = []; const docker = new DockerClient(root);
  Object.defineProperty(docker, "run", { value: (args: string[]) => { calls.push(args); return "synthetic-container"; } });
  docker.runInstance(3, 43173, { imageTag: "synthetic-image", appVersion: "1.2.0", gitCommit: "a".repeat(40),
    sourceFingerprint: `sha256:${"b".repeat(64)}`, buildId: `sha256:${"c".repeat(64)}`, generation: 1, note: "quota isolation" }, {}, pool);
  const args = calls[0]!; assert.equal(calls.length, 1);
  assert.equal(args.includes("-v"), false); assert.equal(args.some(arg => arg.includes("areaforge-dev-test-uploads")), false);
  assert.ok(args.some(arg => arg.endsWith("dst=/app/uploads,readonly")));
  assert.ok(args.some(arg => arg.endsWith("dst=/app/exports,readonly")));
  for (const kind of [undefined, "DELETE", "OPS", "RANKING", "SEARCH"] as const) {
    const env = exportFixtureEnvironment({ ...pool, kind, operationContextRoot: directory, operationScopeId: "synthetic" }, 3, 43173, "1.2.0");
    assert.equal(env.DATA_JOB_QUOTA_ENABLED, "false");
  }
}
