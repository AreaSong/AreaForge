import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, openSync, closeSync } from "node:fs";
import { mkdir, open, readdir, lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPrismaClient, type PrismaClient } from "../../packages/db/src/index";
import { validatePersistedDeletionLedger, type PersistedDeletionLedger, type DeletionLedgerWatermark } from "../../packages/core/src/index";
import { loadStorageQuotaFixture, assertStorageQuotaFixtureContainer, storageQuotaToolEnvironment, storageQuotaFixtureEnvironment,
  verifyStorageQuotaFixtureLedger, readStorageQuotaPrivate, type StorageQuotaFixture } from "./storage-quota-fixture";

export const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export type FileManifest = Record<string, { hash: string; size: number }>;
export type Snapshot = { directory: string; dumpHash: string; files: FileManifest; fileManifestHash: string;
  watermark: DeletionLedgerWatermark; schemaHash: string; sourceId: string; capturedAt: string; kind: string };
export type RestoreTarget = { root: string; databaseName: string; id: string; source: StorageQuotaFixture;
  snapshot: Snapshot; client: PrismaClient; registration: Record<string, unknown> };
const snapshots = new WeakSet<Snapshot>(); const targets = new WeakSet<RestoreTarget>();

export async function privateDirectory(directory: string) {
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid!());
  assert.equal(await realpath(directory), directory);
}
export async function privateBytes(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid!() && !(stat.mode & 0o077));
    const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(file);
    assert.equal(after.size, bytes.length); assert.equal(after.mtimeMs, stat.mtimeMs); assert.equal(after.ctimeMs, stat.ctimeMs);
    assert.equal(current.ino, stat.ino); assert.equal(current.dev, stat.dev); return bytes;
  } finally { await handle.close(); }
}
export async function fileTree(directory: string, destination?: string, prefix = ""): Promise<FileManifest> {
  await privateDirectory(directory);
  if (destination) await mkdir(destination, { mode: 0o700 });
  const result: FileManifest = {};
  for (const name of (await readdir(directory)).sort()) {
    assert.ok(/^[a-zA-Z0-9_.-]+$/.test(name)); const file = path.join(directory, name); const stat = await lstat(file);
    if (stat.isDirectory()) {
      assert.equal(name, ".staging"); Object.assign(result, await fileTree(file, destination && path.join(destination, name), prefix + name + "/"));
    } else {
      const bytes = await privateBytes(file); result[prefix + name] = { hash: digest(bytes), size: bytes.length };
      if (destination) await writeFile(path.join(destination, name), bytes, { flag: "wx", mode: 0o600 });
    }
  }
  return result;
}
export async function ledger(client: Pick<PrismaClient, "dataDeletionLedger">): Promise<PersistedDeletionLedger[]> {
  return (await client.dataDeletionLedger.findMany({ orderBy: { sequence: "asc" } })).map(row => ({ ...row,
    sequence: String(row.sequence), completedAt: row.completedAt.toISOString() })) as unknown as PersistedDeletionLedger[];
}
export const watermarkOf = (entries: PersistedDeletionLedger[]): DeletionLedgerWatermark => ({ sequence: entries.at(-1)?.sequence ?? "0", entryHash: entries.at(-1)?.entryHash ?? null });
export async function schemaHash(client: Pick<PrismaClient, "$queryRaw">) {
  const columns = await client.$queryRaw`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
  const indexes = await client.$queryRaw`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`;
  const constraints = await client.$queryRaw<Array<{ relation: string; conname: string; definition: string }>>`SELECT conrelid::regclass::text AS relation, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname`;
  // PostgreSQL pg_dump/restore 对该 CHECK 的连续 AND 括号作无语义变化的归一化。
  // 仅接受已核对的两个完整定义；不删通用括号、不放宽旧 migration checksum。
  const variants = [
    'CHECK ((("storageWorkspaceId" IS NULL) OR (((length("storageWorkspaceId") >= 1) AND (length("storageWorkspaceId") <= 191)) AND (btrim("storageWorkspaceId") = "storageWorkspaceId"))))',
    'CHECK ((("storageWorkspaceId" IS NULL) OR ((length("storageWorkspaceId") >= 1) AND (length("storageWorkspaceId") <= 191) AND (btrim("storageWorkspaceId") = "storageWorkspaceId"))))',
  ];
  for (const row of constraints) if (row.relation === '\"Attachment\"' && row.conname === "Attachment_storage_workspace_valid" && variants.includes(row.definition)) row.definition = variants[0]!;
  const functions = await client.$queryRaw`SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY proname,pg_get_function_identity_arguments(oid)`;
  const triggers = await client.$queryRaw`SELECT tgrelid::regclass::text AS relation,tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal ORDER BY relation,tgname`;
  const enums = await client.$queryRaw`SELECT t.typname,e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace ORDER BY t.typname,e.enumsortorder`;
  return digest(JSON.stringify({ columns, indexes, constraints, functions, triggers, enums }));
}
function sourceChecked(source: StorageQuotaFixture) {
  assert.equal(loadStorageQuotaFixture(source.root).scopeId, source.scopeId); assertStorageQuotaFixtureContainer(source);
}
/** 仅本进程独占的新合成源；导出 MVCC 快照同时固定账本水位，文件在整个窗口静止。 */
export async function snapshot(source: StorageQuotaFixture, client: PrismaClient, kind: string): Promise<Snapshot> {
  sourceChecked(source); await verifyStorageQuotaFixtureLedger(client, source);
  const directory = path.join(source.root, "backups", randomBytes(8).toString("hex")); await mkdir(directory, { mode: 0o700 });
  const capturedAt = new Date().toISOString();
  return client.$transaction(async tx => {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT pg_export_snapshot() AS id`;
    assert.match(row!.id, /^[0-9A-F-]+$/);
    const entries = await ledger(tx); const watermark = watermarkOf(entries); validatePersistedDeletionLedger(entries, watermark.entryHash);
    const before = await fileTree(path.join(source.root, "uploads"));
    const fd = openSync(path.join(directory, "database.dump"), "wx", 0o600);
    try { execFileSync("docker", ["exec", source.containerName, "pg_dump", "-U", "fixture", "-d", source.databaseName,
      "--format=custom", "--snapshot=" + row!.id], { env: storageQuotaToolEnvironment(), stdio: ["ignore", fd, "pipe"] }); }
    finally { closeSync(fd); }
    const files = await fileTree(path.join(source.root, "uploads"), path.join(directory, "uploads"));
    assert.deepEqual(files, before); assert.deepEqual(await fileTree(path.join(source.root, "uploads")), before);
    assert.deepEqual(await fileTree(path.join(source.root, "exports"), path.join(directory, "exports")), {});
    const result: Snapshot = { directory, dumpHash: digest(await privateBytes(path.join(directory, "database.dump"))), files,
      fileManifestHash: digest(JSON.stringify(files)), watermark, schemaHash: await schemaHash(tx), sourceId: source.scopeId, capturedAt, kind };
    await writeFile(path.join(directory, ".snapshot.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    snapshots.add(result); return result;
  }, { isolationLevel: "RepeatableRead", timeout: 60_000 });
}
export async function verifySnapshot(source: StorageQuotaFixture, backup: Snapshot) {
  assert.ok(snapshots.has(backup)); sourceChecked(source); assert.equal(backup.sourceId, source.scopeId);
  assert.equal(path.dirname(backup.directory), path.join(source.root, "backups")); await privateDirectory(backup.directory);
  assert.deepEqual(readStorageQuotaPrivate(path.join(backup.directory, ".snapshot.json"), source.ownerUid), backup);
  assert.equal(digest(await privateBytes(path.join(backup.directory, "database.dump"))), backup.dumpHash, "STORAGE_DUMP_CHANGED");
  assert.deepEqual(await fileTree(path.join(backup.directory, "uploads")), backup.files);
  assert.equal(digest(JSON.stringify(backup.files)), backup.fileManifestHash);
}
export async function restore(source: StorageQuotaFixture, backup: Snapshot): Promise<RestoreTarget> {
  await verifySnapshot(source, backup);
  const suffix = randomBytes(6).toString("hex"); const databaseName = source.databaseName + "_restore_" + suffix;
  assert.match(databaseName, /^areaforge_v20_storage_[a-f0-9]{12}_restore_[a-f0-9]{12}$/);
  const root = path.join(source.root, "restores", suffix); await mkdir(root, { mode: 0o700 });
  const registration = { protocol: "storage-restore-fixture-v1", databaseName, sourceId: source.scopeId, ownerUid: source.ownerUid,
    dumpHash: backup.dumpHash, fileManifestHash: backup.fileManifestHash, watermark: backup.watermark, http: "disabled" };
  const id = digest(JSON.stringify(registration));
  await writeFile(path.join(root, ".restore-target.json"), JSON.stringify(registration), { flag: "wx", mode: 0o600 });
  const sourceClient = createPrismaClient(storageQuotaFixtureEnvironment(source).DATABASE_URL);
  try {
    assert.deepEqual(await sourceClient.$queryRaw`SELECT datname FROM pg_database WHERE datname=${databaseName}`, []);
    await sourceClient.$executeRawUnsafe('CREATE DATABASE "' + databaseName + '"');
    await sourceClient.$executeRawUnsafe('COMMENT ON DATABASE "' + databaseName + '" IS \'storage-restore:' + id + "'");
  } finally { await sourceClient.$disconnect(); }
  const dump = await privateBytes(path.join(backup.directory, "database.dump"));
  assert.equal(digest(dump), backup.dumpHash, "STORAGE_DUMP_CHANGED");
  // 校验与 pg_restore 消费同一缓冲区，避免校验后重新打开路径的替换窗口。
  execFileSync("docker", ["exec", "-i", source.containerName, "pg_restore", "-U", "fixture", "-d", databaseName,
    "--no-owner", "--no-privileges", "--single-transaction"], { env: storageQuotaToolEnvironment(), input: dump, stdio: ["pipe", "pipe", "pipe"] });
  assert.deepEqual(await fileTree(path.join(backup.directory, "uploads"), path.join(root, "uploads")), backup.files);
  assert.deepEqual(await fileTree(path.join(backup.directory, "exports"), path.join(root, "exports")), {});
  const url = new URL(storageQuotaFixtureEnvironment(source).DATABASE_URL!); url.pathname = "/" + databaseName;
  const target = { root, databaseName, id, source, snapshot: backup, client: createPrismaClient(url.href), registration };
  targets.add(target);
  try { await verifyTarget(target); await verifyRestoredWatermark(target.client, backup.watermark); return target; }
  catch (error) { await target.client.$disconnect().catch(() => {}); throw error; }
}
export async function verifyTarget(target: RestoreTarget) {
  assert.ok(targets.has(target)); sourceChecked(target.source); await privateDirectory(target.root);
  assert.equal(path.dirname(target.root), path.join(target.source.root, "restores"));
  assert.deepEqual(readStorageQuotaPrivate(path.join(target.root, ".restore-target.json"), target.source.ownerUid), target.registration);
  assert.equal(digest(JSON.stringify(target.registration)), target.id);
  assert.equal(target.registration.databaseName, target.databaseName);
  const [row] = await target.client.$queryRaw<Array<{ name: string; marker: string }>>`SELECT current_database() AS name, shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;
  assert.equal(row?.name, target.databaseName); assert.equal(row?.marker, "storage-restore:" + target.id);
  await verifyStorageQuotaFixtureLedger(target.client, { ...target.source, databaseName: target.databaseName });
  assert.equal(await schemaHash(target.client), target.snapshot.schemaHash);
}

export async function verifyRestoredWatermark(client: PrismaClient, expected: DeletionLedgerWatermark) {
  const entries = await ledger(client); const actual = watermarkOf(entries);
  validatePersistedDeletionLedger(entries, actual.entryHash);
  assert.deepEqual(actual, expected, "STORAGE_SNAPSHOT_WATERMARK_MISMATCH");
}
