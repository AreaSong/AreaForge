import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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
  assert.equal(assertCapacityMigrationPreimage(), 54);
  const root = mkdtempSync(path.join(tmpdir(), "areaforge-capacity-preimage-"));
  try {
    mkdirSync(path.join(root, "prisma"));
    cpSync("prisma/migrations", path.join(root, "prisma/migrations"), { recursive: true });
    copyFileSync("prisma/schema.prisma", path.join(root, "prisma/schema.prisma"));
    assert.equal(assertCapacityMigrationPreimage(root), 54);
    const migrations = path.join(root, "prisma/migrations");
    const first = readdirSync(migrations).sort().find(name => /^\d+_/.test(name))!;
    const sql = path.join(migrations, first, "migration.sql"); const original = readFileSync(sql);
    writeFileSync(sql, Buffer.concat([original, Buffer.from("\n-- synthetic drift\n")]));
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/); writeFileSync(sql, original);
    const extra = path.join(migrations, ".ignored.sql"); writeFileSync(extra, "SELECT 1;");
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/); unlinkSync(extra);
    unlinkSync(sql); symlinkSync(path.resolve("prisma/migrations", first, "migration.sql"), sql);
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/);
    unlinkSync(sql); writeFileSync(sql, original);
    writeFileSync(path.join(root, "prisma/schema.prisma"), "// synthetic schema drift\n");
    assert.throws(() => assertCapacityMigrationPreimage(root), /CAPACITY_MIGRATION_PREIMAGE_CHANGED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
