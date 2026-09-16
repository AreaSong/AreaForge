import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadOperationFixture, operationFixtureEnvironment } from "./controlled-operation-fixture";
import { loadDevTestOpsFixture } from "../dev/dev-test-ops-fixture";
import { loadDevTestExportFixture, assertExportFixtureSlot, exportFixtureEnvironment } from "../dev/dev-test-export-fixture";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-ops-")));
try {
  for (const name of ["uploads", "exports", "context", "agent"]) mkdirSync(path.join(root, name), { mode: 0o700 });
  const suffix = randomBytes(6).toString("hex");
  const marker = { schemaVersion: 1, fixtureKind: "controlled-operation", databaseName: `areaforge_v20_ops_${suffix}`,
    containerName: `areaforge-v20-ops-${suffix}`, image: `sha256:${"a".repeat(64)}`, port: 54321,
    ownerUid: process.getuid!(), ownerGid: process.getgid!(), repositoryHash: createHash("sha256").update(realpathSync(process.cwd())).digest("hex"), operatorEmail: `ops-${suffix}@example.test` };
  writeFileSync(path.join(root, ".areaforge-ops-fixture.json"), JSON.stringify(marker), { mode: 0o600 });
  const secretPath = path.join(root, ".fixture.private.json");
  const secrets = { password: randomBytes(32).toString("hex"), sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") };
  writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600 });
  const fixture = loadOperationFixture(root);
  const env = { AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT: root, AREAFORGE_OPS_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: operationFixtureEnvironment(fixture).DATABASE_URL };
  const pool = loadDevTestOpsFixture(process.cwd(), env)!; assert.ok(pool);
  assert.throws(() => loadDevTestOpsFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT: root }), /FIXTURE_INVALID/);
  const runtime = exportFixtureEnvironment(pool, 3, 43173, "1.2.0");
  assert.equal(runtime.AUTH_ADMIN_EMAIL, marker.operatorEmail); assert.equal(runtime.OPS_EXECUTION_ENABLED, "true");
  for (const key of ["DATA_LIFECYCLE_ENABLED", "DATA_EXPORT_ENABLED", "DATA_DELETE_ENABLED", "DATA_DELETE_WORKER_ENABLED", "DATA_JOB_WORKER_ENABLED", "OPS_AGENT_ENABLED", "RANKING_ENABLED", "AI_ENABLED"]) assert.equal(runtime[key], "false");
  assert.equal(runtime.OPS_EXECUTION_CONTEXT_FILE, "/app/ops-context/execution-context.json");
  assert.equal(pool.operationContextRoot, path.join(root, "context")); assert.notEqual(pool.operationContextRoot, path.join(root, "agent"));
  assert.throws(() => loadDevTestOpsFixture(process.cwd(), { ...env, AREAFORGE_OPS_ISOLATED_DB: "0" }));
  assert.throws(() => loadDevTestOpsFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://fixture@127.0.0.1/areaforge_v20_delete_other" }));
  assert.throws(() => loadDevTestExportFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT: root }));
  assert.throws(() => loadDevTestExportFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT: root }));
  assert.throws(() => loadOperationFixture(root + "/../" + path.basename(root)));
  chmodSync(secretPath, 0o644); assert.throws(() => loadOperationFixture(root)); chmodSync(secretPath, 0o600);
  unlinkSync(secretPath); const target = path.join(root, ".private-target.json"); writeFileSync(target, JSON.stringify(secrets), { mode: 0o600 });
  symlinkSync(target, secretPath); assert.throws(() => loadOperationFixture(root)); unlinkSync(secretPath);
  writeFileSync(secretPath, JSON.stringify({ ...secrets, sessionSecret: randomBytes(32).toString("hex") }), { mode: 0o600 });
  assert.notEqual(loadDevTestOpsFixture(process.cwd(), env)!.id, pool.id, "secret rotation must invalidate pool fixture identity");
  assert.throws(() => assertExportFixtureSlot({ slot: 3, port: 43173, replacing: { fixtureId: "other" } } as never, pool));
  assert.throws(() => assertExportFixtureSlot({ slot: 3, port: 43173, replacing: { fixtureId: undefined } } as never, pool));
  console.log("PASS OPS fixture isolation: namespace, uid/repo/secrets, mutual exclusion, read-only metadata mount and slot ownership");
} finally { rmSync(root, { recursive: true, force: true }); }
