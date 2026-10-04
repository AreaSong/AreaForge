import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import type { ReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DataExportZipWriter } from "./data-export-zip";
import { attachmentExportChunks, checkedRoot, dataExportStorageRoots, exportArchiveStream, exportFileName, EXPORT_CHUNK_BYTES, openVerifiedExportArchive, removeRegisteredExportFiles } from "./data-export-files";
import { createPrivateExportWriter, exportJsonBytes } from "./data-export-archive";

async function* bytes(value: string) { yield Buffer.from(value); }
async function fixture() {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "areaforge-export-test-")));
  const exports = path.join(base, "exports"); const uploads = path.join(base, "uploads");
  await mkdir(exports, { mode: 0o700 }); await mkdir(uploads, { mode: 0o700 });
  return { base, roots: await dataExportStorageRoots(exports, uploads), key: `export-${randomUUID()}` };
}

test("流式 ZIP 计算标准 CRC/目录偏移并拒绝重复、路径和资源溢出", async () => {
  const output: Buffer[] = []; const directory: Buffer[] = [];
  const writer = new DataExportZipWriter(async chunk => { output.push(Buffer.from(chunk)); }, async chunk => { directory.push(Buffer.from(chunk)); });
  const entry = await writer.add("entries/note/note-1.json", bytes("123456789"));
  assert.equal(entry.sha256, `sha256:${createHash("sha256").update("123456789").digest("hex")}`);
  const receipt = await writer.finish((async function* () { yield* directory; })());
  const archive = Buffer.concat(output); const centralOffset = archive.readUInt32LE(archive.length - 6);
  assert.equal(archive.readUInt32LE(centralOffset), 0x02014b50);
  assert.equal(archive.readUInt32LE(centralOffset + 16), 0xcbf43926);
  assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(archive).digest("hex")}`);
  assert.equal(receipt.sizeBytes, archive.length);
  for (const name of ["../escape", "/absolute", "nested//file"]) {
    const invalid = new DataExportZipWriter(async () => undefined, async () => undefined);
    await assert.rejects(invalid.add(name, bytes("x")), /ENTRY_NAME_INVALID/);
  }
  const duplicate = new DataExportZipWriter(async () => undefined, async () => undefined);
  await duplicate.add("x", bytes("")); await assert.rejects(duplicate.add("x", bytes("")));
  await assert.rejects(duplicate.finish(bytes("")), /WRITER_STATE_INVALID/);
  await assert.rejects(new DataExportZipWriter(async () => undefined, async () => undefined, { maxBytes: 8 }).add("x", bytes("")), /LIMIT_EXCEEDED/);
  const corruptDirectory: Buffer[] = [];
  const corrupt = new DataExportZipWriter(async () => undefined, async chunk => { corruptDirectory.push(Buffer.from(chunk)); });
  await corrupt.add("a", bytes("123456789")); corruptDirectory[0]!.writeUInt32LE(0, 16);
  await assert.rejects(corrupt.finish((async function* () { yield* corruptDirectory; })()), /DIRECTORY_MISMATCH/);
});

test("超过 ZIP16 条目计数时写入 ZIP64 终结记录而非截断", async () => {
  const directory: Buffer[] = []; let tail = Buffer.alloc(0);
  const writer = new DataExportZipWriter(async chunk => { tail = Buffer.concat([tail, chunk]).subarray(-128); }, async chunk => { directory.push(Buffer.from(chunk)); });
  for (let index = 0; index < 65_536; index += 1) await writer.add(`e/${index}`, bytes(""));
  const receipt = await writer.finish((async function* () { yield* directory; })());
  const zip64 = tail.length - 98;
  assert.equal(tail.readUInt32LE(zip64), 0x06064b50);
  assert.equal(tail.readBigUInt64LE(zip64 + 32), 65_536n);
  assert.equal(tail.readUInt32LE(tail.length - 42), 0x07064b50);
  assert.equal(tail.readUInt16LE(tail.length - 12), 0xffff);
  assert.equal(receipt.entries, 65_536);
});

test("私有归档同句柄校验，回收只触及登记 key，不删除源附件", async () => {
  const { base, roots, key } = await fixture();
  try {
    const sourceName = `${randomUUID().replaceAll("-", "")}.md`;
    const content = Buffer.from("synthetic private attachment");
    await writeFile(path.join(roots.uploadRoot, sourceName), content, { mode: 0o600 });
    await writeFile(path.join(roots.exportRoot, "keep-me"), "unrelated", { mode: 0o600 });
    const writer = await createPrivateExportWriter(roots, key);
    await writer.add("entries/note/note.json", exportJsonBytes({ body: "self-owned" }), { kind: "note", id: "note", omittedFieldCount: 0 });
    await writer.add("attachments/file.md", attachmentExportChunks(roots, { storedName: sourceName, sizeBytes: content.length, sha256: createHash("sha256").update(content).digest("hex") }), { kind: "attachmentFile", id: "file" });
    const receipt = await writer.finish({ entries: ["must-not-override"], protocol: "fixture", schemaVersion: 2 });
    const handle = await openVerifiedExportArchive(roots, { key, sizeBytes: receipt.sizeBytes, sha256: receipt.sha256 }); await handle.close();
    const archive = await readFile(path.join(roots.exportRoot, exportFileName(key, ".zip")));
    assert.equal(archive.length, receipt.sizeBytes);
    const marker = archive.indexOf(Buffer.from('{"protocol":"fixture"'));
    const end = archive.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), marker);
    const parsed = JSON.parse(archive.subarray(marker, end).toString());
    assert.equal(parsed.entries.length, 2); assert.equal(parsed.entries[0].kind, "note");
    assert.equal(await removeRegisteredExportFiles(roots, key), 1);
    assert.equal(await removeRegisteredExportFiles(roots, key), 0);
    assert.deepEqual(await readFile(path.join(roots.uploadRoot, sourceName)), content);
    assert.equal(await readFile(path.join(roots.exportRoot, "keep-me"), "utf8"), "unrelated");
    const linkKey = `export-${randomUUID()}`;
    await symlink(path.join(roots.uploadRoot, sourceName), path.join(roots.exportRoot, exportFileName(linkKey, ".zip")));
    await assert.rejects(removeRegisteredExportFiles(roots, linkKey), /UNSAFE_STORAGE/);
    await assert.rejects(dataExportStorageRoots(roots.exportRoot, roots.exportRoot), /UNSAFE_STORAGE/);
    await assert.rejects(checkedRoot(process.cwd()), /UNSAFE_STORAGE/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("附件校验失败或 manifest 元数据异常后不可完成归档", async () => {
  const { base, roots, key } = await fixture();
  try {
    const writer = await createPrivateExportWriter(roots, key);
    await assert.rejects(writer.add("x", bytes("x"), { kind: "bad/path", id: "x" }), /MANIFEST_INVALID/);
    await assert.rejects(writer.finish({}), /WRITER_STATE_INVALID/); await writer.close();
    const sourceName = `${randomUUID().replaceAll("-", "")}.md`;
    await writeFile(path.join(roots.uploadRoot, sourceName), "changed", { mode: 0o600 });
    await assert.rejects(async () => { for await (const _chunk of attachmentExportChunks(roots, { storedName: sourceName, sizeBytes: 7, sha256: "0".repeat(64) })) { /* 消耗并触发尾部完整性校验。 */ } }, /ATTACHMENT_MISMATCH/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("下载在首次读取前取消、传输中取消和 abort 均关闭句柄，预取保持字节背压", { timeout: 5_000 }, async () => {
  const { base } = await fixture();
  try {
    const file = path.join(base, "stream-fixture");
    await writeFile(file, Buffer.alloc(EXPORT_CHUNK_BYTES * 16, 42), { mode: 0o600 });
    for (const mode of ["before-read", "during-read", "abort", "backpressure"] as const) {
      const handle = await open(file, "r");
      let source: ReadStream | undefined;
      const createReadStream = handle.createReadStream.bind(handle);
      handle.createReadStream = options => { source = createReadStream(options); return source; };
      const controller = new AbortController(); const body = exportArchiveStream(handle, controller.signal);
      const closed = new Promise<void>(resolve => { source!.once("close", resolve); });
      if (mode === "before-read") await body.cancel();
      else if (mode === "abort") { controller.abort(); await assert.rejects(body.getReader().read()); }
      else if (mode === "during-read") { const reader = body.getReader(); await reader.read(); await reader.cancel(); }
      else {
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(source!.bytesRead <= 3 * EXPORT_CHUNK_BYTES, "unconsumed body must not buffer the whole archive");
        await body.cancel();
      }
      await closed;
      assert.equal(handle.fd, -1);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});
