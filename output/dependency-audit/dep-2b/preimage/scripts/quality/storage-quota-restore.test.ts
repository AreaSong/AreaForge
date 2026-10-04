import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, chmod, symlink, link, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileTree, privateBytes, restore, type RestoreTarget } from "./storage-quota-restore-tools";
import { StorageRestoreGate } from "./storage-quota-restore-control";

// 这些临时文件只是工具输入负例，不含数据库、dump、附件或已登记 fixture。
test("恢复工具拒绝公开权限、软硬链接和未知子目录", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "storage-restore-input-")); await chmod(root, 0o700);
  try {
    const file = path.join(root, "input.json"); await writeFile(file, "{}", { mode: 0o600 });
    assert.equal((await privateBytes(file)).toString(), "{}");
    await chmod(file, 0o644); await assert.rejects(privateBytes(file)); await chmod(file, 0o600);
    const soft = path.join(root, "soft.json"); await symlink(file, soft); await assert.rejects(privateBytes(soft)); await rm(soft);
    const hard = path.join(root, "hard.json"); await link(file, hard); await assert.rejects(privateBytes(file)); await rm(hard);
    await mkdir(path.join(root, "unknown"), { mode: 0o700 }); await assert.rejects(fileTree(root));
  } finally { await rm(root, { recursive: true }); }
});
test("恢复工具不消费调用者伪造的快照对象", async () => {
  await assert.rejects(restore({} as never, {} as never));
});
test("fixture 门禁默认拒绝服务调用，伪造目标不能开门", async () => {
  const target = {} as RestoreTarget;
  const gate = new StorageRestoreGate(target, {} as never, {} as never, []);
  await assert.rejects(gate.admit({} as never), /STORAGE_RESTORE_CLOSED/);
  await assert.rejects(gate.verifyAndOpen()); assert.equal(gate.opened, false);
  await assert.rejects(gate.replay()); assert.equal(gate.opened, false);
});
