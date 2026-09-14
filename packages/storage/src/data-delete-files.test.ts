import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, link, access, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectDeletionFile, removeDeletionFile } from "./data-delete-files";

test("删除文件需精确身份和已提交意图，缺失重试幂等且不碰 sentinel", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "areaforge-v20-delete-")));
  const roots = { uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports") };
  try {
    await mkdir(roots.uploadRoot, { mode: 0o700 }); await mkdir(roots.exportRoot, { mode: 0o700 });
    const bytes = Buffer.from("synthetic private bytes");
    const file = { storageKind: "UPLOAD" as const, storageKey: "abcdefghijklmnop.pdf", expectedHash: createHash("sha256").update(bytes).digest("hex"), expectedSize: bytes.length };
    await writeFile(path.join(roots.uploadRoot, file.storageKey), bytes, { mode: 0o600 });
    await writeFile(path.join(roots.uploadRoot, "sentinel.pdf"), "keep", { mode: 0o600 });
    await assert.rejects(() => removeDeletionFile(roots, file, { intentDurable: false }), /INTENT_REQUIRED/);
    assert.equal((await inspectDeletionFile(roots, file))?.size, bytes.length);
    await removeDeletionFile(roots, file, { intentDurable: true });
    await removeDeletionFile(roots, file, { intentDurable: true });
    assert.equal(await readFile(path.join(roots.uploadRoot, "sentinel.pdf"), "utf8"), "keep");
    await assert.rejects(() => inspectDeletionFile(roots, file), /FILE_MISSING/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("删除文件拒绝穿越、软链接、硬链接与哈希漂移", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "areaforge-v20-delete-")));
  const roots = { uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports") };
  try {
    await mkdir(roots.uploadRoot, { mode: 0o700 }); await mkdir(roots.exportRoot, { mode: 0o700 });
    const file = { storageKind: "UPLOAD" as const, storageKey: "abcdefghijklmnop.pdf", expectedHash: null, expectedSize: null };
    const outside = path.join(root, "sentinel"); await writeFile(outside, "keep", { mode: 0o600 });
    await assert.rejects(() => inspectDeletionFile(roots, { ...file, storageKey: "../sentinel" }), /UNSAFE/);
    await symlink(outside, path.join(roots.uploadRoot, file.storageKey));
    await assert.rejects(() => removeDeletionFile(roots, file, { intentDurable: true }), /UNSAFE/);
    await rm(path.join(roots.uploadRoot, file.storageKey));
    await link(outside, path.join(roots.uploadRoot, file.storageKey));
    await assert.rejects(() => inspectDeletionFile(roots, file), /UNSAFE/);
    await rm(path.join(roots.uploadRoot, file.storageKey));
    await writeFile(path.join(roots.uploadRoot, file.storageKey), "different", { mode: 0o600 });
    await assert.rejects(() => removeDeletionFile(roots, { ...file, expectedHash: "a".repeat(64) }, { intentDurable: true }), /FILE_MISMATCH/);
    await access(outside);
  } finally { await rm(root, { recursive: true, force: true }); }
});
