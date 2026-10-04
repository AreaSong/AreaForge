import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { checkedRoot, exportFileChunks, isCode } from "./data-export-files";
import { createStagingAttachmentName, isSafeStoredAttachmentName, stagingDirectoryName } from "./index";

export interface StorageFileClaim {
  id: string; storedName: string; uri: string; hash: string; sizeBytes: number; stagingName: string | null;
  storageReleasedAt: unknown; storageReleaseProof: string | null;
}
export interface StorageCleanupIdentity { storedName: string; uri: string; hash: string; sizeBytes: number; stagingName: string | null }
export interface StorageCleanupHooks { beforeUnlink?: () => Promise<void>; afterUnlink?: () => Promise<void> }
export type StorageCleanupMode = "discard" | "failed-staging" | "absence-only";
export class StorageQuotaFileError extends Error {
  constructor(readonly code = "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN") { super(code); this.name = "StorageQuotaFileError"; }
}
type Directory = { path: string; stat: Stats };
type Roots = { final: Directory; staging: Directory | null; stagingPath: string };
type Entry = { directory: Directory; name: string; storedName: string; staging: boolean };
type VerifiedEntry = { file: string; stat: Stats; reservedBytes: number };

/** 仅扫描文件名/类型/字节，不读取正文；数据库查询必须来自同一准入事务，不能应用可见性过滤。 */
export async function verifyStorageQuotaInventory(uploadDir: string, lookup: (names: readonly string[]) => Promise<StorageFileClaim[]>): Promise<void> {
  try {
    const roots = await captureRoots(uploadDir, true); const seen = new Set<string>(); const verified: VerifiedEntry[] = []; let entries: Entry[] = [];
    for (const directory of [roots.final, ...(roots.staging ? [roots.staging] : [])]) {
      const staging = directory === roots.staging;
      for await (const entry of await opendir(directory.path)) {
        if (!staging && entry.name === stagingDirectoryName && entry.isDirectory()) continue;
        const storedName = staging && entry.name.endsWith(".staging") ? entry.name.slice(0, -8) : entry.name;
        if (!entry.isFile() || !isSafeStoredAttachmentName(storedName) || (staging && entry.name !== createStagingAttachmentName(storedName))
          || seen.has(storedName)) unsafe();
        seen.add(storedName); entries.push({ directory, name: entry.name, storedName, staging });
        if (entries.length === 128) { verified.push(...await verifyEntries(entries, lookup)); entries = []; }
      }
    }
    if (entries.length) verified.push(...await verifyEntries(entries, lookup));
    for (const entry of verified) {
      const current = await lstat(entry.file);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.dev !== entry.stat.dev
        || current.ino !== entry.stat.ino || current.size > entry.reservedBytes) unsafe();
    }
    await assertRootsStable(roots, true);
  } catch (error) { throw fileError(error); }
}

async function verifyEntries(entries: Entry[], lookup: (names: readonly string[]) => Promise<StorageFileClaim[]>) {
  const rows = await lookup(entries.map(entry => entry.storedName));
  const verified: VerifiedEntry[] = [];
  for (const entry of entries) {
    const matching = rows.filter(row => row.storedName === entry.storedName);
    if (matching.length !== 1) unsafe();
    const row = matching[0]!;
    validateIdentity(row);
    if (row.storageReleasedAt !== null || row.storageReleaseProof !== null
      || (entry.staging && row.stagingName !== entry.name)) unsafe();
    const file = path.join(entry.directory.path, entry.name); const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > row.sizeBytes) unsafe();
    verified.push({ file, stat, reservedBytes: row.sizeBytes });
  }
  return verified;
}

/** 调用方持有附件文件栅栏及已提交的弃用/失败意图；不处理未知目录项或不同身份的文件。 */
export async function removeStorageQuotaAttachmentFiles(uploadDir: string, identity: StorageCleanupIdentity, hooks: StorageCleanupHooks = {}, mode: StorageCleanupMode = "discard") {
  try {
    validateIdentity(identity); const roots = await captureRoots(uploadDir, false);
    const files = cleanupPaths(roots, identity);
    if (identity.stagingName === null && await optionalStat(files[1]!)) unsafe();
    const probes = await Promise.all(files.map(file => inspectKnownFile(file, identity)));
    if (probes.filter(Boolean).length > 1) unsafe();
    if ((mode === "failed-staging" && probes[0]) || (mode === "absence-only" && probes.some(Boolean))) unsafe();
    for (const [index, probe] of probes.entries()) {
      if (!probe) continue;
      await hooks.beforeUnlink?.(); await assertRootsStable(roots, false);
      const current = await lstat(files[index]!);
      if (!sameFile(probe, current) || !current.isFile() || current.nlink !== 1) unsafe();
      await unlink(files[index]!); await hooks.afterUnlink?.();
    }
    await syncDirectories(roots); await assertAbsent(roots, files);
    return { protocol: "storage-files-absent-v1" as const, storedName: identity.storedName, hash: identity.hash, sizeBytes: identity.sizeBytes };
  } catch (error) { throw fileError(error); }
}

/** 已释放的重复请求只能核验缺失，不能借旧意图重新删除再次出现的文件。 */
export async function assertStorageQuotaFilesAbsent(uploadDir: string, identity: StorageCleanupIdentity): Promise<void> {
  try {
    validateIdentity(identity); const roots = await captureRoots(uploadDir, false);
    await assertAbsent(roots, cleanupPaths(roots, identity));
  } catch (error) { throw fileError(error); }
}

async function inspectKnownFile(file: string, expected: StorageCleanupIdentity): Promise<Stats | null> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== expected.sizeBytes) unsafe();
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of exportFileChunks(handle)) { hash.update(chunk); size += chunk.byteLength; }
    const after = await handle.stat();
    if (!sameFile(before, after) || size !== expected.sizeBytes || hash.digest("hex") !== expected.hash) unsafe();
    return after;
  } catch (error) { if (isCode(error, "ENOENT")) return null; throw error; }
  finally { await handle?.close(); }
}

async function captureRoots(uploadDir: string, privateMode: boolean): Promise<Roots> {
  const root = await checkedRoot(uploadDir, privateMode);
  const stagingPath = path.join(root, stagingDirectoryName);
  const stagingStat = await optionalStat(stagingPath);
  if (stagingStat) await checkedRoot(stagingPath, privateMode);
  return { final: { path: root, stat: await lstat(root) }, staging: stagingStat ? { path: stagingPath, stat: stagingStat } : null, stagingPath };
}
function cleanupPaths(roots: Roots, identity: StorageCleanupIdentity): string[] {
  return [path.join(roots.final.path, identity.storedName), path.join(roots.stagingPath, createStagingAttachmentName(identity.storedName))];
}
async function assertRootsStable(roots: Roots, contents: boolean) {
  for (const expected of [roots.final, ...(roots.staging ? [roots.staging] : [])]) {
    const current = await lstat(expected.path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== expected.stat.dev || current.ino !== expected.stat.ino
      || await realpath(expected.path) !== expected.path || (contents && current.mtimeMs !== expected.stat.mtimeMs)) unsafe();
  }
  if (!roots.staging && await optionalStat(roots.stagingPath)) unsafe();
}
async function syncDirectories(roots: Roots) {
  for (const directory of [roots.final, ...(roots.staging ? [roots.staging] : [])]) {
    const handle = await open(directory.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (stat.dev !== directory.stat.dev || stat.ino !== directory.stat.ino) unsafe(); await handle.sync(); }
    finally { await handle.close(); }
  }
}
async function assertAbsent(roots: Roots, files: string[]) {
  await assertRootsStable(roots, false);
  for (const file of files) if (await optionalStat(file)) unsafe();
  await assertRootsStable(roots, false);
}
async function optionalStat(file: string): Promise<Stats | null> {
  try { return await lstat(file); } catch (error) { if (isCode(error, "ENOENT")) return null; throw error; }
}
function sameFile(first: Stats, second: Stats) {
  return first.dev === second.dev && first.ino === second.ino && first.size === second.size
    && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs;
}
function validateIdentity(value: StorageCleanupIdentity) {
  if (!isSafeStoredAttachmentName(value.storedName) || value.uri !== "upload://attachment/" + value.storedName
    || !/^[a-f0-9]{64}$/.test(value.hash) || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 2_147_483_647
    || (value.stagingName !== null && value.stagingName !== createStagingAttachmentName(value.storedName))) unsafe();
}
function fileError(error: unknown) { return error instanceof StorageQuotaFileError ? error : new StorageQuotaFileError(); }
function unsafe(): never { throw new StorageQuotaFileError(); }
