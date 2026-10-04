import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRankingFixture, rankingFixtureEnvironment } from "./ranking-rebuild-fixture";
import { loadDevTestExportFixture, exportFixtureEnvironment, type DevTestExportFixture } from "../dev/dev-test-export-fixture";
import { DockerClient } from "../dev/dev-test-docker";
import { loadDevTestRankingFixture } from "../dev/dev-test-ranking-fixture";

const root = realpathSync(process.cwd());
const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-ranking-")));
try {
  for (const name of ["uploads", "exports"]) mkdirSync(path.join(directory, name), { mode: 0o700 });
  const marker = { schemaVersion: 1, fixtureKind: "ranking-rebuild", databaseName: "areaforge_v20_ranking_abcdef012345",
    containerName: "areaforge-v20-ranking-abcdef012345", volumeName: "areaforge-v20-ranking-abcdef012345-data", port: 54321,
    image: `sha256:${"a".repeat(64)}`, ownerUid: process.getuid!(), ownerGid: process.getgid!(), repositoryHash: createHash("sha256").update(root).digest("hex") };
  const markerFile = path.join(directory, ".areaforge-ranking-fixture.json");
  const secretFile = path.join(directory, ".fixture.private.json");
  writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
  writeFileSync(secretFile, JSON.stringify({ password: randomBytes(32).toString("hex"), sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { mode: 0o600 });
  if (process.getuid!() === 0) { assert.throws(() => loadRankingFixture(directory, root)); }
  else {
    const fixture = loadRankingFixture(directory, root); const env = rankingFixtureEnvironment(fixture);
    const poolEnv = { ...env, AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT: directory, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL };
    const pool = loadDevTestExportFixture(root, poolEnv)!; assert.equal(pool.kind, "RANKING");
    assert.equal(loadDevTestRankingFixture(root, poolEnv)?.id, pool.id);
    assert.throws(() => loadDevTestRankingFixture(root, { ...poolEnv, AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT: directory }), /FIXTURE_INVALID/);
    const runtime = exportFixtureEnvironment(pool, 3, 43173, "1.2.0");
    assert.equal(runtime.RANKING_REBUILD_QUEUE_ENABLED, "true"); assert.equal(runtime.DATA_JOB_WORKER_ENABLED, "true");
    for (const key of ["DATA_EXPORT_ENABLED", "DATA_DELETE_ENABLED", "DATA_LIFECYCLE_ENABLED", "OPS_EXECUTION_ENABLED", "PLATFORM_NOTIFICATIONS_ENABLED", "AI_ENABLED"]) assert.equal(runtime[key], "false");
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_RANKING_REBUILD_ISOLATED_DB: "0" }));
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://remote.example/other" }));
    assert.throws(() => loadDevTestExportFixture(root, { ...poolEnv, AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT: directory }), /MODES_CONFLICT/);
    assert.throws(() => loadRankingFixture(directory, `${root}/other`));
    chmodSync(path.join(directory, "exports"), 0o755); assert.throws(() => loadRankingFixture(directory)); chmodSync(path.join(directory, "exports"), 0o700);
    writeFileSync(markerFile, JSON.stringify({ ...marker, databaseName: "areaforge_shared" })); assert.throws(() => loadRankingFixture(directory)); writeFileSync(markerFile, JSON.stringify(marker));
    renameSync(secretFile, `${secretFile}.source`); symlinkSync(`${secretFile}.source`, secretFile);
    assert.throws(() => loadRankingFixture(directory)); unlinkSync(secretFile); renameSync(`${secretFile}.source`, secretFile);
    assertFixtureMounts(pool);
  }
  console.log("PASS RANKING fixture: ownership, modes, exact database, permissions, symlink and private mounts");
} finally { rmSync(directory, { recursive: true, force: true }); }

function assertFixtureMounts(pool: DevTestExportFixture) {
  for (const kind of [undefined, "DELETE", "OPS", "RANKING"] as const) {
    const calls: string[][] = []; const docker = new DockerClient(root);
    Object.defineProperty(docker, "run", { value: (args: string[]) => { calls.push(args); return "synthetic-container"; } });
    docker.runInstance(3, 43173, { imageTag: "synthetic-image", appVersion: "1.2.0", gitCommit: "a".repeat(40),
      sourceFingerprint: `sha256:${"b".repeat(64)}`, buildId: `sha256:${"c".repeat(64)}`, generation: 1, note: "isolation" }, {},
    { ...pool, kind, operationContextRoot: path.join(directory, "context") });
    assert.equal(calls.length, 1); const args = calls[0]!;
    assert.equal(args.includes("-v"), false); assert.equal(args.some(arg => arg.includes("areaforge-dev-test-uploads")), false);
    assert.ok(args.some(arg => arg.endsWith("dst=/app/uploads,readonly")));
    assert.ok(args.some(arg => arg.endsWith("dst=/app/exports,readonly")));
  }
}
