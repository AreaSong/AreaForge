import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { checkedRoot, exportFileChunks, isCode } from "./data-export-files";

export interface DeletionFileDescriptor { storageKind: "UPLOAD" | "EXPORT"; storageKey: string; expectedHash: string | null; expectedSize: number | null }
export interface DeletionFileRoots { uploadRoot: string; exportRoot: string }
export class DataDeleteStorageError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DataDeleteStorageError"; }
}

export async function inspectDeletionFile(roots: DeletionFileRoots, file: DeletionFileDescriptor, allowMissing = false) {
  const target = await deletionFileTarget(roots, file);
  let handle;
  try {
    handle = await open(target.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 512 * 1024 * 1024) invalid();
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of exportFileChunks(handle)) { hash.update(chunk); size += chunk.length; }
    const digest = hash.digest("hex"); const after = await handle.stat();
    if (size !== before.size || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || (file.expectedSize !== null && size !== file.expectedSize)
      || (file.expectedHash !== null && digest !== file.expectedHash.replace(/^sha256:/, ""))) throw new DataDeleteStorageError("DATA_DELETE_FILE_MISMATCH");
    return { sha256: digest, size, ino: before.ino, dev: before.dev };
  } catch (error) {
    if (isCode(error, "ENOENT") && allowMissing) return null;
    if (error instanceof DataDeleteStorageError) throw error;
    throw new DataDeleteStorageError(isCode(error, "ENOENT") ? "DATA_DELETE_FILE_MISSING" : "DATA_DELETE_UNSAFE_STORAGE");
  } finally { await handle?.close(); }
}

/** 只能在持久文件意图已提交、当前租约行锁仍持有时调用；不扫描目录。 */
export async function removeDeletionFile(roots: DeletionFileRoots, file: DeletionFileDescriptor, input: { intentDurable: boolean; afterUnlink?: () => Promise<void> }) {
  if (!input.intentDurable) throw new DataDeleteStorageError("DATA_DELETE_FILE_INTENT_REQUIRED");
  const target = await deletionFileTarget(roots, file);
  const verified = await inspectDeletionFile(roots, file, true);
  if (verified) {
    const current = await lstat(target.file);
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== verified.ino || current.dev !== verified.dev || current.nlink !== 1) invalid();
    await unlink(target.file);
    await input.afterUnlink?.();
  }
  const directory = await open(target.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

async function deletionFileTarget(roots: DeletionFileRoots, file: DeletionFileDescriptor) {
  if (file.storageKind !== "UPLOAD" && file.storageKind !== "EXPORT") invalid();
  if (file.storageKind === "UPLOAD" ? !/^[A-Za-z0-9_-]{16,}\.(png|jpg|webp|pdf|zip|md)$/.test(file.storageKey)
    : !/^export-[a-f0-9-]{36}\.(zip|zip\.part|central|manifest)$/.test(file.storageKey)) invalid();
  if (file.expectedHash !== null && !/^(sha256:)?[a-f0-9]{64}$/.test(file.expectedHash)) invalid();
  if (file.expectedSize !== null && (!Number.isSafeInteger(file.expectedSize) || file.expectedSize < 0)) invalid();
  const uploadRoot = await checkedRoot(roots.uploadRoot, true).catch(() => { throw new DataDeleteStorageError("DATA_DELETE_UNSAFE_STORAGE"); });
  const exportRoot = await checkedRoot(roots.exportRoot, true).catch(() => { throw new DataDeleteStorageError("DATA_DELETE_UNSAFE_STORAGE"); });
  if (inside(uploadRoot, exportRoot) || inside(exportRoot, uploadRoot)) invalid();
  const root = file.storageKind === "UPLOAD" ? uploadRoot : exportRoot;
  return { root, file: path.join(root, file.storageKey) };
}
function inside(parent: string, child: string) { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function invalid(): never { throw new DataDeleteStorageError("DATA_DELETE_UNSAFE_STORAGE"); }
