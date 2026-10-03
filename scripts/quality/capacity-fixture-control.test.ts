import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertCapacityMigrationPreimage } from "./capacity-migration-preimage";
import { capacitySignal, settleCapacityResults, waitCapacityBarrier } from "./capacity-transaction-fixture";

test("准入并发失败必须排空迟到请求后才允许调用方结算", async () => {
  const gate = capacitySignal(); const failure = new Error("SYNTHETIC_ADMISSION_FAILED");
  let completed = false; let settled = false;
  const outcome = settleCapacityResults([Promise.reject(failure), gate.promise.then(() => { completed = true; return "late"; })])
    .catch(error => { settled = true; return error; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  gate.release(); assert.equal(await outcome, failure); assert.equal(completed, true);
});

test("事务屏障在连接失败、提前结束或缺信号时有界退出", async () => {
  const signal = capacitySignal(); const pending = capacitySignal();
  await assert.rejects(waitCapacityBarrier(signal.promise, Promise.reject(new Error("SYNTHETIC_CONNECT_FAILED"))), /SYNTHETIC_CONNECT_FAILED/);
  await assert.rejects(waitCapacityBarrier(signal.promise, Promise.resolve("ended")), /CAPACITY_BARRIER_OPERATION_ENDED/);
  await assert.rejects(waitCapacityBarrier(signal.promise, pending.promise, 5), /CAPACITY_BARRIER_TIMEOUT/);
  signal.release(); await waitCapacityBarrier(signal.promise, pending.promise); pending.release();
});

test("迁移准入绑定批准内容并拒绝同数量SQL漂移、额外文件、软链接和schema漂移", () => {
  const root = mkdtempSync(path.join(tmpdir(), "areaforge-capacity-preimage-"));
  try {
    restoreApprovedPreimage(root);
    assert.equal(assertCapacityMigrationPreimage(root), 54);
    const migrations = path.join(root, "prisma/migrations");
    const first = readdirSync(migrations).sort().find(name => /^\d+_/.test(name))!;
    const sql = path.join(migrations, first, "migration.sql"); const original = readFileSync(sql);
    writeFileSync(sql, Buffer.concat([original, Buffer.from("\n-- synthetic drift\n")]));
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/); writeFileSync(sql, original);
    const extra = path.join(migrations, ".ignored.sql"); writeFileSync(extra, "SELECT 1;");
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/); unlinkSync(extra);
    const added = path.join(migrations, "20990101000000_synthetic_unapproved");
    mkdirSync(added); writeFileSync(path.join(added, "migration.sql"), "SELECT 1;");
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/); rmSync(added, { recursive: true });
    unlinkSync(sql); symlinkSync(path.resolve("prisma/migrations", first, "migration.sql"), sql);
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/);
    unlinkSync(sql); writeFileSync(sql, original);
    writeFileSync(path.join(root, "prisma/schema.prisma"), "// synthetic schema drift\n");
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function restoreApprovedPreimage(root: string) {
  const snapshot = JSON.parse(readFileSync(path.resolve("scripts/quality/fixtures/capacity/approved-migration-preimage.json"), "utf8"));
  assert.equal(snapshot.sourceCommit, "ddf690de7e030b103b36be3d9359ffc32ecaf6bd");
  assert.equal(snapshot.encoding, "gzip-base64"); assert.equal(snapshot.files, 56);
  const bytes = gunzipSync(Buffer.from(snapshot.content, "base64"), { maxOutputLength: 4 * 1024 * 1024 });
  assert.equal(createHash("sha256").update(bytes).digest("hex"), snapshot.uncompressedSha256);
  const files = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  assert.equal(Object.keys(files).length, 56);
  for (const [relative, body] of Object.entries(files)) {
    assert.match(relative, /^prisma\/(schema\.prisma|migrations\/(migration_lock\.toml|\d+_[A-Za-z0-9_]+\/migration\.sql))$/);
    assert.equal(typeof body, "string");
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, body as string, { flag: "wx", mode: 0o600 });
  }
}
