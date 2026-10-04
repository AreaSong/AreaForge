import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadStorageQuotaFixture, storageQuotaFixtureEnvironment } from "./storage-quota-fixture";

const root = realpathSync(process.cwd());
const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "areaforge-v20-storage-")));
try {
  for (const name of ["uploads", "exports", "backups", "restores"]) mkdirSync(path.join(directory, name), { mode: 0o700 });
  const marker = { schemaVersion: 1, fixtureKind: "storage-quota", databaseName: "areaforge_v20_storage_abcdef012345",
    containerName: "areaforge-v20-storage-abcdef012345", volumeName: "areaforge-v20-storage-abcdef012345-data",
    port: 54321, image: "sha256:" + "a".repeat(64), ownerUid: process.getuid!(), ownerGid: process.getgid!(),
    repositoryHash: createHash("sha256").update(root).digest("hex") };
  const markerFile = path.join(directory, ".areaforge-storage-quota-fixture.json");
  const secretFile = path.join(directory, ".fixture.private.json");
  writeFileSync(markerFile, JSON.stringify(marker), { mode: 0o600 });
  writeFileSync(secretFile, JSON.stringify({ password: randomBytes(32).toString("hex"), sessionSecret: randomBytes(32).toString("hex"),
    actionSecret: randomBytes(32).toString("hex") }), { mode: 0o600 });
  if (process.getuid!() === 0) assert.throws(() => loadStorageQuotaFixture(directory));
  else {
    const fixture = loadStorageQuotaFixture(directory); const env = storageQuotaFixtureEnvironment(fixture);
    assert.equal(env.WORKSPACE_STORAGE_QUOTA_ENABLED, "true");
    for (const key of ["DATA_EXPORT_ENABLED", "DATA_DELETE_WORKER_ENABLED", "DATA_JOB_WORKER_ENABLED", "SEARCH_INDEX_ENABLED", "RANKING_ENABLED", "AI_ENABLED"]) {
      assert.equal(env[key], "false");
    }
    assert.throws(() => loadStorageQuotaFixture(directory, root + "/other"));
    chmodSync(path.join(directory, "uploads"), 0o755); assert.throws(() => loadStorageQuotaFixture(directory)); chmodSync(path.join(directory, "uploads"), 0o700);
    writeFileSync(markerFile, JSON.stringify({ ...marker, databaseName: "areaforge_shared" })); assert.throws(() => loadStorageQuotaFixture(directory));
    writeFileSync(markerFile, JSON.stringify(marker));
    const secret = readFileSync(secretFile);
    renameSync(secretFile, secretFile + ".original"); symlinkSync(secretFile + ".original", secretFile);
    assert.throws(() => loadStorageQuotaFixture(directory)); unlinkSync(secretFile);
    linkSync(secretFile + ".original", secretFile); assert.throws(() => loadStorageQuotaFixture(directory));
    unlinkSync(secretFile); unlinkSync(secretFile + ".original"); writeFileSync(secretFile, secret, { mode: 0o600 });
    assert.doesNotThrow(() => loadStorageQuotaFixture(directory));
  }
  console.log("PASS STORAGE fixture identity: own namespace, UID/repository, private modes, no-follow and hardlink rejection");
} finally { rmSync(directory, { recursive: true, force: true }); }
