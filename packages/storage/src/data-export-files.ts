import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, link, lstat, open, realpath, unlink, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

export const EXPORT_STORAGE_MAX_BYTES = 512 * 1024 * 1024;
export const EXPORT_CHUNK_BYTES = 64 * 1024;
export type ExportFileSuffix = ".zip.part" | ".central" | ".manifest" | ".zip";
export interface DataExportStorageRoots { exportRoot: string; uploadRoot: string }

export class DataExportStorageError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); this.name = "DataExportStorageError"; }
}

export async function dataExportStorageRoots(exportDir: string, uploadDir: string): Promise<DataExportStorageRoots> {
  try {
    const exportRoot = await checkedRoot(exportDir, true);
    const uploadRoot = await checkedRoot(uploadDir, false);
    if (inside(exportRoot, uploadRoot) || inside(uploadRoot, exportRoot)) invalid();
    return { exportRoot, uploadRoot };
  } catch (error) { throw storageError(error); }
}

export async function checkedRoot(value: string, privateMode = true): Promise<string> {
  if (!path.isAbsolute(value)) invalid();
  const root = path.resolve(value);
  if ([path.parse(root).root, path.resolve(homedir()), process.cwd()].includes(root)
    || root.split(path.sep).includes("public")) invalid();
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root
    || (privateMode && (stat.mode & 0o077) !== 0)) invalid();
  return root;
}

export function exportFileName(key: string, suffix: ExportFileSuffix): string {
  if (!/^export-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key)
    || ![".zip.part", ".central", ".manifest", ".zip"].includes(suffix)) invalid();
  return `${key}${suffix}`;
}

export async function createExportFile(root: string, key: string, suffix: Exclude<ExportFileSuffix, ".zip">): Promise<FileHandle> {
  try {
    return await open(path.join(await checkedRoot(root), exportFileName(key, suffix)), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) { throw storageError(error); }
}

export async function openExportSpool(root: string, key: string, suffix: ".central" | ".manifest"): Promise<FileHandle> {
  try {
    return await open(path.join(await checkedRoot(root), exportFileName(key, suffix)), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) { throw storageError(error); }
}

export async function writeExportBytes(handle: FileHandle, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.length) {
    const { bytesWritten } = await handle.write(value, offset, value.length - offset, null);
    if (bytesWritten <= 0) throw new DataExportStorageError("DATA_EXPORT_STORAGE_WRITE_FAILED", true);
    offset += bytesWritten;
  }
}

export async function* exportFileChunks(handle: FileHandle, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const buffer = Buffer.alloc(EXPORT_CHUNK_BYTES);
  let position = 0;
  while (true) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    position += bytesRead;
    // 消费者可能预取；不能复用仍在 HTTP/文件写队列中的可变 buffer。
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
}

export async function* attachmentExportChunks(roots: DataExportStorageRoots, input: { storedName: string; sizeBytes: number; sha256: string }, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  let handle: FileHandle | undefined;
  try {
    if (!/^[A-Za-z0-9_-]{16,}\.(png|jpg|webp|pdf|zip|md)$/.test(input.storedName)) invalid();
    handle = await open(path.join(await checkedRoot(roots.uploadRoot, false), input.storedName), constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await checkFileShape(handle, input.sizeBytes);
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of exportFileChunks(handle, signal)) {
      size += chunk.length;
      if (size > input.sizeBytes) throw new DataExportStorageError("DATA_EXPORT_ATTACHMENT_MISMATCH");
      hash.update(chunk); yield chunk;
    }
    const after = await handle.stat();
    if (size !== input.sizeBytes || hash.digest("hex") !== digest(input.sha256) || before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
      throw new DataExportStorageError("DATA_EXPORT_ATTACHMENT_MISMATCH");
    }
  } catch (error) { throw storageError(error); }
  finally { await handle?.close().catch(() => undefined); }
}

export async function openVerifiedExportArchive(roots: DataExportStorageRoots, input: { key: string; sizeBytes: number; sha256: string }, signal?: AbortSignal): Promise<FileHandle> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path.join(await checkedRoot(roots.exportRoot), exportFileName(input.key, ".zip")), constants.O_RDONLY | constants.O_NOFOLLOW);
    await checkFileShape(handle, input.sizeBytes);
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of exportFileChunks(handle, signal)) {
      size += chunk.length;
      if (size > input.sizeBytes) throw new DataExportStorageError("DATA_EXPORT_ARCHIVE_MISMATCH");
      hash.update(chunk);
    }
    if (size !== input.sizeBytes || hash.digest("hex") !== digest(input.sha256)) throw new DataExportStorageError("DATA_EXPORT_ARCHIVE_MISMATCH");
    return handle;
  } catch (error) { await handle?.close().catch(() => undefined); throw storageError(error); }
}

export function exportArchiveStream(handle: FileHandle, signal?: AbortSignal): ReadableStream<Uint8Array> {
  // FileHandle 流即使在首次 pull 前取消也会关闭句柄；Web 队列按字节而非 chunk 数背压。
  const source = handle.createReadStream({ start: 0, autoClose: true, highWaterMark: EXPORT_CHUNK_BYTES, signal });
  return Readable.toWeb(source, { strategy: { highWaterMark: EXPORT_CHUNK_BYTES,
    size: (chunk: Uint8Array) => chunk.byteLength } }) as ReadableStream<Uint8Array>;
}

export async function publishExportFile(root: string, key: string, signal?: AbortSignal): Promise<void> {
  try {
    const base = await checkedRoot(root);
    signal?.throwIfAborted();
    const staging = path.join(base, exportFileName(key, ".zip.part"));
    const final = path.join(base, exportFileName(key, ".zip"));
    const info = await lstat(staging);
    if (!info.isFile() || info.isSymbolicLink()) invalid();
    await chmod(staging, 0o400);
    // link 是同文件系统的原子、不覆盖发布；普通 rename 可能覆盖已有代次文件。
    await link(staging, final);
    await syncExportDirectory(base);
    await unlink(staging);
    await syncExportDirectory(base);
  } catch (error) { throw storageError(error); }
}

export async function removeRegisteredExportFiles(roots: DataExportStorageRoots, key: string, suffixes: readonly ExportFileSuffix[] = [".zip.part", ".central", ".manifest", ".zip"]): Promise<number> {
  try {
    const root = await checkedRoot(roots.exportRoot);
    if (inside(root, roots.uploadRoot) || inside(roots.uploadRoot, root)) invalid();
    let removed = 0;
    for (const suffix of suffixes) {
      const file = path.join(root, exportFileName(key, suffix));
      const stat = await lstat(file).catch(error => { if (isCode(error, "ENOENT")) return null; throw error; });
      if (!stat) continue;
      if (!stat.isFile() || stat.isSymbolicLink()) invalid();
      await unlink(file).catch(error => { if (!isCode(error, "ENOENT")) throw error; });
      removed += 1;
    }
    if (removed) await syncExportDirectory(root);
    return removed;
  } catch (error) { throw storageError(error); }
}

async function syncExportDirectory(root: string): Promise<void> {
  const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function checkFileShape(handle: FileHandle, size: number) {
  if (!Number.isSafeInteger(size) || size < 0 || size > EXPORT_STORAGE_MAX_BYTES) throw new DataExportStorageError("DATA_EXPORT_LIMIT_EXCEEDED");
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size !== size) throw new DataExportStorageError("DATA_EXPORT_FILE_MISMATCH");
  return stat;
}
function digest(value: string): string {
  if (!/^(sha256:)?[a-f0-9]{64}$/.test(value)) invalid();
  return value.replace(/^sha256:/, "");
}
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function invalid(): never { throw new DataExportStorageError("DATA_EXPORT_UNSAFE_STORAGE"); }
export function isCode(error: unknown, code: string): boolean { return !!error && typeof error === "object" && "code" in error && error.code === code; }
export function storageError(error: unknown): DataExportStorageError {
  if (error instanceof DataExportStorageError) return error;
  if (isCode(error, "ENOENT")) return new DataExportStorageError("DATA_EXPORT_FILE_MISSING");
  if (isCode(error, "ELOOP") || isCode(error, "EEXIST") || isCode(error, "ENOTDIR")) return new DataExportStorageError("DATA_EXPORT_UNSAFE_STORAGE");
  return new DataExportStorageError("DATA_EXPORT_STORAGE_UNAVAILABLE", true);
}
