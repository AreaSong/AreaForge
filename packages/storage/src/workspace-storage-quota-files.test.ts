import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, link, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertStorageQuotaFilesAbsent, removeStorageQuotaAttachmentFiles, verifyStorageQuotaInventory, type StorageFileClaim } from "./workspace-storage-quota-files";

const content = Buffer.from("synthetic storage quota");
const name = "1234567890abcdef.png";
const row: StorageFileClaim = { id: "synthetic-attachment", storedName: name, uri: "upload://attachment/" + name,
  hash: createHash("sha256").update(content).digest("hex"), sizeBytes: content.length, stagingName: name + ".staging",
  storageReleasedAt: null, storageReleaseProof: null };
async function fixture(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "areaforge-storage-files-")));
  try { await mkdir(path.join(root, ".staging"), { mode: 0o700 }); await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("只读清单接受有效文件和有预留的部分暂存，不把缺失当释放", () => fixture(async root => {
  await writeFile(path.join(root, ".staging", name + ".staging"), content.subarray(0, 5), { mode: 0o600 });
  await verifyStorageQuotaInventory(root, async names => { assert.deepEqual(names, [name]); return [row]; });
  await assert.rejects(removeStorageQuotaAttachmentFiles(root, row));
  assert.equal((await readFile(path.join(root, ".staging", name + ".staging"))).length, 5);
}));

test("未知文件、已释放后再现及双文件拒绝，不清理可疑内容", () => fixture(async root => {
  await writeFile(path.join(root, name), content, { mode: 0o600 });
  await assert.rejects(verifyStorageQuotaInventory(root, async () => []));
  await assert.rejects(verifyStorageQuotaInventory(root, async () => [{ ...row, storageReleasedAt: new Date() }]));
  await writeFile(path.join(root, ".staging", name + ".staging"), content, { mode: 0o600 });
  await assert.rejects(verifyStorageQuotaInventory(root, async () => [row]));
  await assert.rejects(removeStorageQuotaAttachmentFiles(root, row));
  assert.deepEqual(await readFile(path.join(root, name)), content);
}));

test("精确文件清理可重试，目录持久化后才形成缺失证明", () => fixture(async root => {
  await writeFile(path.join(root, name), content, { mode: 0o600 });
  await assert.rejects(removeStorageQuotaAttachmentFiles(root, row, { afterUnlink: async () => { throw new Error("SYNTHETIC_CRASH"); } }));
  const proof = await removeStorageQuotaAttachmentFiles(root, row);
  assert.equal(proof.protocol, "storage-files-absent-v1");
  await assertStorageQuotaFilesAbsent(root, row);
  await writeFile(path.join(root, name), content, { mode: 0o600 });
  await assert.rejects(assertStorageQuotaFilesAbsent(root, row));
  assert.deepEqual(await readFile(path.join(root, name)), content);
}));

test("软链接、硬链接和哈希漂移都不能获得释放证明", () => fixture(async root => {
  const original = path.join(root, "original"); await writeFile(original, content, { mode: 0o600 });
  const target = path.join(root, name);
  await symlink(original, target); await assert.rejects(removeStorageQuotaAttachmentFiles(root, row)); await rm(target);
  await link(original, target); await assert.rejects(removeStorageQuotaAttachmentFiles(root, row)); await rm(target);
  await writeFile(target, Buffer.alloc(content.length), { mode: 0o600 });
  await assert.rejects(removeStorageQuotaAttachmentFiles(root, row));
  assert.deepEqual(await readFile(original), content);
}));

test("验证后的同内容路径替换被拒绝，不删除新身份", () => fixture(async root => {
  const target = path.join(root, name); await writeFile(target, content, { mode: 0o600 });
  await assert.rejects(removeStorageQuotaAttachmentFiles(root, row, { beforeUnlink: async () => {
    await rename(target, path.join(root, "retained-original")); await writeFile(target, content, { mode: 0o600 });
  } }));
  assert.deepEqual(await readFile(target), content);
}));

test("目录软链接即使没有目标文件也不是缺失证明", () => fixture(async root => {
  await rmdir(path.join(root, ".staging")); await mkdir(path.join(root, "other"), { mode: 0o700 });
  await symlink(path.join(root, "other"), path.join(root, ".staging"));
  await assert.rejects(assertStorageQuotaFilesAbsent(root, row));
}));

test("未登记的暂存文件即使内容相同也只阻断、不删除", () => fixture(async root => {
  const target = path.join(root, ".staging", name + ".staging");
  await writeFile(target, content, { mode: 0o600 });
  const unregistered = { ...row, stagingName: null };
  await assert.rejects(verifyStorageQuotaInventory(root, async () => [unregistered]));
  await assert.rejects(removeStorageQuotaAttachmentFiles(root, unregistered));
  assert.deepEqual(await readFile(target), content);
}));

test("FIFO以非阻塞方式打开后拒绝，不占住清理线程", { skip: process.platform === "win32" }, () => fixture(async root => {
  execFileSync("mkfifo", [path.join(root, name)]);
  const moduleUrl = new URL("./workspace-storage-quota-files.ts", import.meta.url).href;
  const program = "import { removeStorageQuotaAttachmentFiles } from " + JSON.stringify(moduleUrl)
    + ";try{await removeStorageQuotaAttachmentFiles(" + JSON.stringify(root) + "," + JSON.stringify(row)
    + ");process.exitCode=2;}catch{process.stdout.write('rejected');}";
  const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], { encoding: "utf8", timeout: 5000 });
  assert.equal(result, "rejected");
}));

for (const mutation of ["link", "grow"] as const) test("清单末端重验早批文件变化：" + mutation, () => fixture(async root => {
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), "areaforge-storage-link-")));
  try {
    const rows = Array.from({ length: 129 }, (_, index) => {
      const storedName = "batch-" + String(index).padStart(16, "0") + ".png";
      return { ...row, storedName, uri: "upload://attachment/" + storedName, stagingName: null };
    });
    for (const item of rows) await writeFile(path.join(root, item.storedName), content, { mode: 0o600 });
    let firstName = ""; let batch = 0;
    await assert.rejects(verifyStorageQuotaInventory(root, async names => {
      batch++;
      if (batch === 1) firstName = names[0]!;
      else if (mutation === "link") await link(path.join(root, firstName), path.join(outside, "link"));
      else await appendFile(path.join(root, firstName), "x");
      return rows.filter(item => names.includes(item.storedName));
    }));
    assert.equal(batch, 2);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));
