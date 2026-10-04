import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquirePoolLock } from "../dev/dev-test-pool-lock";
import { assertExportFixtureSlot, exportFixtureEnvironment, loadDevTestExportFixture } from "../dev/dev-test-export-fixture";
import {
  DEFAULT_DEV_TEST_PORTS,
  compareOldest,
  containerName,
  parseConfiguredPorts,
  selectLatestInstance,
  selectSlot,
  validatePool,
  type PoolInstance,
  type SlotNumber,
} from "../dev/dev-test-pool-core";

const root = process.cwd();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "areaforge-dev-test-pool-selftest-"));

try {
  testPorts();
  testRefreshSelection();
  testSnapshotFifo();
  testLatestSelection();
  testPoolValidation();
  testRealLockContention();
  testStaleLockRecovery();
  testSourceGuardrails();
  testExportFixtureAdmission();
  console.log("dev test pool selftest passed.");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function testPorts(): void {
  assert.deepEqual(parseConfiguredPorts(""), [...DEFAULT_DEV_TEST_PORTS]);
  assert.deepEqual(parseConfiguredPorts("45101,45102,45103"), [45101, 45102, 45103]);
  assert.throws(() => parseConfiguredPorts("45101,45101,45103"), /unique/);
  assert.throws(() => parseConfiguredPorts("80,45102,45103"), /between 1024 and 65535/);
}

function testRefreshSelection(): void {
  const empty = selectSlot("refresh", [], [...DEFAULT_DEV_TEST_PORTS]);
  assert.deepEqual({ slot: empty.slot, replacing: empty.replacing, reason: empty.reason },
    { slot: 1, replacing: null, reason: "empty-pool" });

  const first = instance(1, 100);
  const second = instance(2, 200);
  const latest = selectSlot("refresh", [first, second], [...DEFAULT_DEV_TEST_PORTS]);
  assert.equal(latest.slot, 2);
  assert.equal(latest.replacing?.id, second.id);

  const selected = selectSlot("refresh", [first, second], [...DEFAULT_DEV_TEST_PORTS], 1);
  assert.equal(selected.slot, 1);
  assert.equal(selected.replacing?.id, first.id);
}

function testSnapshotFifo(): void {
  const first = instance(1, 100);
  const second = instance(2, 200);
  const empty = selectSlot("snapshot", [first, second], [...DEFAULT_DEV_TEST_PORTS]);
  assert.equal(empty.slot, 3);
  assert.equal(empty.replacing, null);

  const third = instance(3, 300);
  const fifo = selectSlot("snapshot", [third, second, first], [...DEFAULT_DEV_TEST_PORTS]);
  assert.equal(fifo.slot, 1);
  assert.equal(fifo.reason, "fifo-oldest");
  assert.equal([second, first].sort(compareOldest)[0]?.id, first.id);
  assert.throws(() => selectSlot("snapshot", [first], [...DEFAULT_DEV_TEST_PORTS], 1), /does not accept --slot/);
}

function testLatestSelection(): void {
  const first = instance(1, 100);
  const second = instance(2, 300);
  const third = instance(3, 200);
  assert.equal(selectLatestInstance([]), null);
  assert.equal(selectLatestInstance([third, first, second])?.id, second.id);

  const fifoReplacement = { ...first, id: "replacement", generation: 400, createdAt: new Date(400).toISOString() };
  assert.equal(selectLatestInstance([fifoReplacement, second, third])?.id, fifoReplacement.id);
  assert.equal(selectLatestInstance([first, third])?.id, third.id, "removing the latest slot must reveal the next latest instance");
  assert.equal(selectLatestInstance([first, second, third])?.id, second.id,
    "a failed candidate omitted by rollback must not change the latest instance");
}

function testPoolValidation(): void {
  const first = instance(1, 100);
  assert.throws(() => validatePool([first, { ...first, id: "duplicate" }], [...DEFAULT_DEV_TEST_PORTS]), /duplicate/);
  assert.throws(() => validatePool([{ ...first, name: "foreign" }], [...DEFAULT_DEV_TEST_PORTS]), /unexpected name/);
  assert.throws(() => validatePool([{ ...first, port: 49999 }], [...DEFAULT_DEV_TEST_PORTS]), /unexpected port/);
}

function testRealLockContention(): void {
  const lockPath = path.join(temporaryRoot, "contention.lock");
  const release = acquirePoolLock(lockPath);
  assert.throws(() => acquirePoolLock(lockPath), /another AreaForge test-pool operation is active/);
  release();
  const releaseAgain = acquirePoolLock(lockPath);
  releaseAgain();
}

function testStaleLockRecovery(): void {
  const lockPath = path.join(temporaryRoot, "stale.lock");
  writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, createdAt: "2000-01-01T00:00:00.000Z" }), { mode: 0o600 });
  const old = new Date("2000-01-01T00:00:00.000Z");
  utimesSync(lockPath, old, old);
  const release = acquirePoolLock(lockPath, 1);
  release();
}

function testSourceGuardrails(): void {
  const dockerSource = readFileSync(path.join(root, "scripts/dev/dev-test-docker.ts"), "utf8");
  const cliSource = readFileSync(path.join(root, "scripts/dev/dev-test-pool.ts"), "utf8");
  const imageSource = readFileSync(path.join(root, "infra/docker/web.dev-test.Dockerfile"), "utf8");
  assert(dockerSource.includes("127.0.0.1:${port}:3000"), "test Web ports must bind localhost only");
  assert(dockerSource.includes("host.docker.internal:host-gateway"), "Linux host gateway compatibility must remain");
  assert(dockerSource.includes('this.run(["system", "df", "--format", "{{json .}}"]'),
    "doctor must expose Docker disk usage without mutating Docker resources");
  assert(dockerSource.includes("isCanonicalSlotContainer(container.Name)"),
    "only canonical slot containers may participate in pool selection");
  assert(!dockerSource.includes('`label=${DEV_TEST_LABELS.pool}=${DEV_TEST_POOL}`,\n    ], { allowFailure: true })'),
    "pool enumeration failures must not be treated as an empty pool");
  assert(!dockerSource.includes("system\", \"prune") && !dockerSource.includes("volume\", \"rm"),
    "the pool must not run global prune or delete volumes");
  assert(cliSource.includes('path.join(root, "apps/web/.env.local")'), "the local Web env file must remain the default pool configuration");
  assert(cliSource.includes("AREAFORGE_DEV_TEST_DATABASE_URL"),
    "isolated browser runs must use the explicit test-pool database override");
  assert(cliSource.includes("localContainerDatabaseUrl(databaseUrl)"),
    "the isolated database override must pass the same loopback and database-name guard");
  assert(cliSource.includes('AI_ENABLED: "false"'), "test-pool AI external calls must stay disabled");
  assert(cliSource.includes("AUTH_RBAC_ENABLED"), "test-pool must explicitly propagate the RBAC feature gate");
  assert(cliSource.includes('command === "latest"'), "the pool must expose one machine-readable latest instance");
  assert(cliSource.includes("computeProductExperienceSourceHash"),
    "runtime identity must bind to the shipped product experience source, not the whole dirty worktree");
  assert(cliSource.includes("fingerprint.digest"),
    "full worktree validation fingerprint must still contribute to build identity uniqueness");
  assert(dockerSource.includes('pnpm", ["--filter", "@areaforge/web", "build"]'),
    "the pool must build the host standalone output before packaging it");
  assert(dockerSource.includes("verbatimSymlinks: true"), "pnpm standalone links must remain container-relative");
  assert(!imageSource.includes("pnpm install") && !imageSource.includes("npm install"),
    "the test image must not download workspace dependencies again");
  assert(cliSource.indexOf("docker.build(identity,") < cliSource.indexOf("acquirePoolLock();", cliSource.indexOf("docker.build(identity,")),
    "the candidate image must build before the swap lock is acquired");
  assert(cliSource.includes("rollbackSlot(fixedName, backupName"), "failed health must restore the previous slot");
  assert(cliSource.includes("assertExportFixtureSlot(selection, fixture)"), "fixture slots must be checked under the swap lock");
  assert(dockerSource.includes("dst=/app/exports,readonly") && dockerSource.includes("dst=/app/uploads,readonly"),
    "export fixture Web runtime may read but never change synthetic file bodies");
  assert(dockerSource.includes("filter: (source: string)"), "standalone packaging must exclude local environment files");
}

function testExportFixtureAdmission(): void {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-export-")));
  try {
    const marker = { schemaVersion: 1, fixtureKind: "data-export", databaseName: "areaforge_v20_export_pool_selftest",
      ownerUid: process.getuid?.(), ownerGid: process.getgid?.(), repositoryHash: createHash("sha256").update(root).digest("hex") };
    mkdirSync(path.join(base, "uploads"), { mode: 0o700 }); mkdirSync(path.join(base, "exports"), { mode: 0o700 });
    writeFileSync(path.join(base, ".areaforge-data-export-fixture.json"), JSON.stringify(marker), { mode: 0o600 });
    const secrets = path.join(base, ".fixture.private.json");
    writeFileSync(secrets, JSON.stringify({ sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { mode: 0o600 });
    const env = { AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT: base, AREAFORGE_DATA_EXPORT_ISOLATED_DB: "1",
      AREAFORGE_DEV_TEST_DATABASE_URL: `postgresql://localhost:5432/${marker.databaseName}` };
    if (process.getuid?.() === 0) { assert.throws(() => loadDevTestExportFixture(root, env), /FIXTURE_INVALID/); return; }
    const fixture = loadDevTestExportFixture(root, env)!;
    assert.equal(loadDevTestExportFixture(root, {}), undefined);
    const runtime = exportFixtureEnvironment(fixture, 2, 43172, "1.2.0");
    assert.equal(runtime.AI_ENABLED, "false"); assert.equal(runtime.DATA_EXPORT_ENABLED, "true");
    assert.equal(runtime.AUTH_SESSION_COOKIE_NAME, "af_dev_test_2"); assert.equal(runtime.AI_API_KEY, undefined);
    assertExportFixtureSlot(selectSlot("refresh", [], [...DEFAULT_DEV_TEST_PORTS], 2), fixture);
    const shared = instance(1, 1); const own = { ...instance(2, 2), fixtureId: fixture.id };
    assert.throws(() => assertExportFixtureSlot(selectSlot("refresh", [shared], [...DEFAULT_DEV_TEST_PORTS], 1), fixture), /SLOT_MISMATCH/);
    assert.throws(() => assertExportFixtureSlot(selectSlot("refresh", [own], [...DEFAULT_DEV_TEST_PORTS], 2)), /SLOT_MISMATCH/);
    assertExportFixtureSlot(selectSlot("refresh", [own], [...DEFAULT_DEV_TEST_PORTS], 2), fixture);
    for (const override of [{ AREAFORGE_DATA_EXPORT_ISOLATED_DB: "0" }, { AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://remote.example/areaforge_v20_export_pool_selftest" },
      { AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://localhost/areaforge" }, { AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://localhost/areaforge_v20_export_other" }]) {
      assert.throws(() => loadDevTestExportFixture(root, { ...env, ...override }), /FIXTURE_INVALID/);
    }
    assert.throws(() => loadDevTestExportFixture(`${root}/wrong`, env), /FIXTURE_INVALID/);
    chmodSync(path.join(base, "exports"), 0o755);
    assert.throws(() => loadDevTestExportFixture(root, env), /FIXTURE_INVALID/); chmodSync(path.join(base, "exports"), 0o700);
    renameSync(secrets, `${secrets}.original`); symlinkSync(`${secrets}.original`, secrets);
    assert.throws(() => loadDevTestExportFixture(root, env), /FIXTURE_INVALID/); unlinkSync(secrets);
  } finally { rmSync(base, { recursive: true, force: true }); }
}

function instance(slot: SlotNumber, generation: number): PoolInstance {
  return {
    id: `container-${slot}-${generation}`,
    name: containerName(slot),
    slot,
    port: DEFAULT_DEV_TEST_PORTS[slot - 1],
    generation,
    createdAt: new Date(generation).toISOString(),
    running: true,
    imageId: `image-${slot}-${generation}`,
    sourceFingerprint: `sha256:${String(slot).repeat(64)}`,
    gitCommit: String(slot).repeat(40),
    buildId: `sha256:${String(slot).repeat(64)}`,
    note: "fixture",
  };
}
