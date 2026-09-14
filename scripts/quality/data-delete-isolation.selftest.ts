import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDataDeleteFixture, deleteFixtureEnvironment } from "./data-delete-fixture";
import { loadDevTestDeleteFixture } from "../dev/dev-test-delete-fixture";
import { assertExportFixtureSlot, exportFixtureEnvironment } from "../dev/dev-test-export-fixture";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-delete-")));
try {
  for (const name of ["uploads", "exports", "backup", "restored-uploads", "restored-exports"]) mkdirSync(path.join(root, name), { mode: 0o700 });
  const suffix = randomBytes(6).toString("hex");
  const marker = { schemaVersion: 1, fixtureKind: "data-delete", databaseName: "areaforge_v20_delete_" + suffix,
    restoreDatabaseName: "areaforge_v20_delete_" + suffix + "_restore", containerName: "areaforge-v20-delete-" + suffix,
    image: "sha256:" + "a".repeat(64), port: 54321, ownerUid: process.getuid!(), ownerGid: process.getgid!(),
    repositoryHash: createHash("sha256").update(realpathSync(process.cwd())).digest("hex") };
  writeFileSync(path.join(root, ".areaforge-data-delete-fixture.json"), JSON.stringify(marker), { mode: 0o600 });
  writeFileSync(path.join(root, ".fixture.private.json"), JSON.stringify({ password: randomBytes(32).toString("hex"), sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { mode: 0o600 });
  const fixture = loadDataDeleteFixture(root); const databaseUrl = deleteFixtureEnvironment(fixture).DATABASE_URL;
  const env = { AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT: root, AREAFORGE_DATA_DELETE_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl };
  const pool = loadDevTestDeleteFixture(process.cwd(), env); assert.ok(pool);
  assert.equal(exportFixtureEnvironment(pool, 3, 43173, "1.2.0").DATA_DELETE_ENABLED, "true");
  assert.equal(exportFixtureEnvironment(pool, 3, 43173, "1.2.0").DATA_DELETE_WORKER_ENABLED, "false");
  assert.equal(exportFixtureEnvironment(pool, 3, 43173, "1.2.0").DATA_EXPORT_ENABLED, "false");
  assert.throws(() => loadDevTestDeleteFixture(process.cwd(), { ...env, AREAFORGE_DATA_DELETE_ISOLATED_DB: "0" }));
  assert.throws(() => loadDevTestDeleteFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://fixture@127.0.0.1/areaforge_v20_export_other" }));
  assert.throws(() => loadDevTestDeleteFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT: root }));
  assert.throws(() => loadDataDeleteFixture(root + "/../" + path.basename(root)));
  chmodSync(path.join(root, ".fixture.private.json"), 0o644); assert.throws(() => loadDataDeleteFixture(root));
  chmodSync(path.join(root, ".fixture.private.json"), 0o600);
  assert.throws(() => assertExportFixtureSlot({ slot: 3, port: 43173, replacing: { fixtureId: "another-fixture" } } as never, pool));
  assert.throws(() => assertExportFixtureSlot({ slot: 3, port: 43173, replacing: { fixtureId: undefined } } as never, pool));
  console.log("PASS DELETE isolation: exact namespace, marker, permissions, no EXPORT fallback, same-slot ownership, readonly Web mounts");
} finally { rmSync(root, { recursive: true, force: true }); }
