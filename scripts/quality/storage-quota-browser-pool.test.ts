import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDevTestExportFixture, assertExportFixtureSlot, exportFixtureEnvironment } from "../dev/dev-test-export-fixture";
import { loadStorageQuotaFixture, storageQuotaFixtureEnvironment } from "./storage-quota-fixture";
import type { SlotSelection } from "../dev/dev-test-pool-core";
import { fixtureUploadMount } from "../dev/dev-test-docker";

test("STORAGE fixture 独立准入、槽位/跨域保护与无外呼环境", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-storage-")));
  try {
    for (const name of ["uploads", "exports", "backups", "restores"]) mkdirSync(path.join(root, name), { mode: 0o700 });
    const marker = { schemaVersion: 1, fixtureKind: "storage-quota", databaseName: "areaforge_v20_storage_abcdef123456",
      containerName: "areaforge-v20-storage-abcdef123456", volumeName: "areaforge-v20-storage-abcdef123456-data", port: 32768,
      image: "sha256:" + "a".repeat(64), ownerUid: process.getuid!(), ownerGid: process.getgid!(),
      repositoryHash: createHash("sha256").update(realpathSync(process.cwd())).digest("hex") };
    writeFileSync(path.join(root, ".areaforge-storage-quota-fixture.json"), JSON.stringify(marker), { mode: 0o600 });
    writeFileSync(path.join(root, ".fixture.private.json"), JSON.stringify({ password: "a".repeat(64), sessionSecret: "b".repeat(64), actionSecret: "c".repeat(64) }), { mode: 0o600 });
    const env = { AREAFORGE_DEV_TEST_STORAGE_FIXTURE_ROOT: root, AREAFORGE_STORAGE_QUOTA_ISOLATED_DB: "1",
      AREAFORGE_DEV_TEST_DATABASE_URL: storageQuotaFixtureEnvironment(loadStorageQuotaFixture(root)).DATABASE_URL };
    const fixture = loadDevTestExportFixture(process.cwd(), env)!;
    assert.equal(fixtureUploadMount(fixture), `type=bind,src=${fixture.uploadRoot},dst=/app/uploads`);
    for (const kind of [undefined, "DELETE", "OPS", "RANKING", "SEARCH", "QUOTA", "CAPACITY"] as const)
      assert.equal(fixtureUploadMount({ ...fixture, kind }), `type=bind,src=${fixture.uploadRoot},dst=/app/uploads,readonly`);
    const selection: SlotSelection = { slot: 3, port: 43173, replacing: null, reason: "empty-slot" };
    assertExportFixtureSlot(selection, fixture);
    assert.throws(() => assertExportFixtureSlot({ ...selection, slot: 1 }, fixture));
    assert.throws(() => assertExportFixtureSlot({ ...selection, replacing: { fixtureId: "different" } as never }, fixture));
    assert.throws(() => loadDevTestExportFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT: root }));
    assert.throws(() => loadDevTestExportFixture(process.cwd(), { ...env, AREAFORGE_STORAGE_QUOTA_ISOLATED_DB: "0" }));
    assert.throws(() => loadDevTestExportFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_DATABASE_URL: "postgresql://localhost/shared" }));
    const runtime = exportFixtureEnvironment(fixture, 3, 43173, "test");
    for (const key of ["AI_ENABLED", "DATA_EXPORT_ENABLED", "DATA_DELETE_WORKER_ENABLED", "OPS_EXECUTION_ENABLED", "DATA_JOB_WORKER_ENABLED"])
      assert.equal(runtime[key], "false");
    assert.equal(runtime.WORKSPACE_STORAGE_QUOTA_MAX_BYTES, "256");
    const invalid = loadDevTestExportFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_STORAGE_POLICY: "invalid" })!;
    assert.equal(invalid.id, fixture.id);
    assert.equal(exportFixtureEnvironment(invalid, 3, 43173, "test").WORKSPACE_STORAGE_QUOTA_MAX_BYTES, "invalid");
    const link = root + "Alias"; symlinkSync(root, link);
    try { assert.throws(() => loadDevTestExportFixture(process.cwd(), { ...env, AREAFORGE_DEV_TEST_STORAGE_FIXTURE_ROOT: link })); }
    finally { unlinkSync(link); }
  } finally { rmSync(root, { recursive: true }); }
});
