import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { constants, openSync, closeSync } from "node:fs";
import path from "node:path";
import { createPrismaClient, type PrismaClient } from "../../packages/db/src/index";
import { selectPersistedDeletionReplay, validatePersistedDeletionLedger, type PersistedDeletionLedger, type DeletionLedgerWatermark } from "../../packages/core/src/index";
import { prepareDeletionReplay } from "../../packages/db/src/data-delete-replay";
import { buildRestorationDeletePlan } from "../../packages/db/src/data-delete-plan";
import { verifyFrozenDeletePlan } from "../../packages/db/src/data-delete-commit";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { deleteFixtureEnvironment, loadDataDeleteFixture, verifyDeleteFixtureLedger, assertDeleteFixtureContainer, type DataDeleteFixture } from "./data-delete-fixture";
import { seedDeletionCase, createFixtureDeletion, makeDeletionEligible } from "./data-delete-runtime-data";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";

export interface DeleteBackup { createdAt: string; directory: string; dumpHash: string; uploadHashes: Record<string, string>; exportHashes: Record<string, string> }

export async function createDeleteFixtureBackup(fixture: DataDeleteFixture): Promise<DeleteBackup> {
  loadDataDeleteFixture(fixture.root);
  assertDeleteFixtureContainer(fixture);
  const directory = path.join(fixture.root, "backup", randomBytes(8).toString("hex"));
  await mkdir(directory, { mode: 0o700 });
  const createdAt = new Date().toISOString();
  const dump = openSync(path.join(directory, "database.dump"), "wx", 0o600);
  try { execFileSync("docker", ["exec", fixture.containerName, "pg_dump", "-U", "fixture", "-d", fixture.databaseName,
    "--format=custom"], { stdio: ["ignore", dump, "pipe"] }); }
  finally { closeSync(dump); }
  const uploadHashes = await copyFixtureFiles(path.join(fixture.root, "uploads"), path.join(directory, "uploads"));
  const exportHashes = await copyFixtureFiles(path.join(fixture.root, "exports"), path.join(directory, "exports"));
  return { directory, createdAt, uploadHashes, exportHashes, dumpHash: hash(await readFile(path.join(directory, "database.dump"))) };
}

export async function restoreDeleteFixtureBackup(fixture: DataDeleteFixture, backup: DeleteBackup) {
  loadDataDeleteFixture(fixture.root);
  assertDeleteFixtureContainer(fixture);
  assert.equal(hash(await readFile(path.join(backup.directory, "database.dump"))), backup.dumpHash);
  const suffix = randomBytes(6).toString("hex");
  const databaseName = fixture.databaseName + "_restore_" + suffix;
  assert.match(databaseName, /^areaforge_v20_delete_[a-f0-9]{12}_restore_[a-f0-9]{12}$/);
  const root = path.join(fixture.root, "restore-" + suffix);
  await mkdir(root, { mode: 0o700 });
  const registration = { databaseName, ownerUid: fixture.ownerUid, ownerGid: fixture.ownerGid, sourceDumpHash: backup.dumpHash, createdAt: new Date().toISOString() };
  await writeFile(path.join(root, ".restore-target.json"), JSON.stringify(registration), { mode: 0o600, flag: "wx" });
  const source = createPrismaClient(deleteFixtureEnvironment(fixture).DATABASE_URL);
  try {
    const found = await source.$queryRaw<Array<{ name: string }>>`SELECT datname AS name FROM pg_database WHERE datname=${databaseName}`;
    assert.equal(found.length, 0, "restore target must be newly created");
    await source.$executeRawUnsafe('CREATE DATABASE "' + databaseName + '"');
  } finally { await source.$disconnect(); }
  const dump = openSync(path.join(backup.directory, "database.dump"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { execFileSync("docker", ["exec", "-i", fixture.containerName, "pg_restore", "-U", "fixture", "-d", databaseName,
    "--no-owner", "--no-privileges", "--single-transaction"], { stdio: [dump, "pipe", "pipe"] }); }
  finally { closeSync(dump); }
  assert.deepEqual(await copyFixtureFiles(path.join(backup.directory, "uploads"), path.join(root, "uploads")), backup.uploadHashes);
  assert.deepEqual(await copyFixtureFiles(path.join(backup.directory, "exports"), path.join(root, "exports")), backup.exportHashes);
  const url = new URL(deleteFixtureEnvironment(fixture).DATABASE_URL!); url.pathname = "/" + databaseName;
  const client = createPrismaClient(url.href);
  const [actual] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(actual?.name, databaseName); await verifyDeleteFixtureLedger(client);
  const snapshotLedger = await fixtureLedger(client);
  validatePersistedDeletionLedger(snapshotLedger, snapshotLedger.at(-1)?.entryHash ?? null);
  const watermark: DeletionLedgerWatermark = { sequence: String(snapshotLedger.length), entryHash: snapshotLedger.at(-1)?.entryHash ?? null };
  await writeFile(path.join(root, ".ledger-watermark.json"), JSON.stringify({ sourceDumpHash: backup.dumpHash, watermark }), { mode: 0o600, flag: "wx" });
  return { root, databaseName, client, watermark };
}

export async function fixtureLedger(client: PrismaClient): Promise<PersistedDeletionLedger[]> {
  const rows = await client.dataDeletionLedger.findMany({ orderBy: { sequence: "asc" } });
  return rows.map(row => ({ ...row, sequence: row.sequence.toString(), completedAt: row.completedAt.toISOString() })) as unknown as PersistedDeletionLedger[];
}

export async function replayDeleteFixtureLedger(target: Awaited<ReturnType<typeof restoreDeleteFixtureBackup>>, input: unknown, expectedHead: string | null) {
  assert.match(target.databaseName, /^areaforge_v20_delete_[a-f0-9]{12}_restore_[a-f0-9]{12}$/);
  const [actual] = await target.client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(actual?.name, target.databaseName);
  const entries = selectPersistedDeletionReplay(input, expectedHead, target.watermark);
  let replayed = 0;
  for (const entry of entries) {
    const lease = await prepareDeletionReplay(target.client, entry, target.databaseName);
    if (!lease) continue;
    const verify = (tx: Parameters<typeof verifyFrozenDeletePlan>[0], row: Parameters<typeof verifyFrozenDeletePlan>[1]) => verifyFrozenDeletePlan(tx, row, buildRestorationDeletePlan);
    const result = await executeDatabaseDeletion(target.client, lease, { uploadRoot: path.join(target.root, "uploads"), exportRoot: path.join(target.root, "exports") }, {},
      { verifyPlan: verify, beforeFile: verify });
    assert.equal(result.state, "SUCCEEDED", "restore must remain unpublished if any ledger application fails"); replayed++;
  }
  return { replayed, sourceHead: expectedHead, productionTouched: false };
}

async function copyFixtureFiles(source: string, destination: string): Promise<Record<string, string>> {
  await mkdir(destination, { mode: 0o700 });
  const hashes: Record<string, string> = {};
  for (const name of (await readdir(source)).sort()) {
    const sourceFile = path.join(source, name); const stat = await lstat(sourceFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("DATA_DELETE_BACKUP_UNSAFE_ENTRY");
    await copyFile(sourceFile, path.join(destination, name), constants.COPYFILE_EXCL);
    hashes[name] = hash(await readFile(path.join(destination, name)));
  }
  return hashes;
}
function hash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }

export async function testDeletionBackupWatermark(client: PrismaClient, fixture: DataDeleteFixture) {
  const data = await seedDeletionCase(client, fixture);
  const note = await client.note.create({ data: { ownerUserId: data.user.id, subjectId: data.subject.id,
    title: "备份快照竞争验收", content: "SYNTHETIC_COMMIT_AFTER_BACKUP_SNAPSHOT" } });
  const intent = await createFixtureDeletion(client, { ...data, note }); await makeDeletionEligible(client, intent.id);
  const lease = await claimDatabaseDeletion(client, "backup-overlap", intent.id); assert.ok(lease);
  let release!: () => void; let reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const execution = executeDatabaseDeletion(client, lease, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") },
    { beforeCommit: async () => { reached(); await held; } });
  let backup: DeleteBackup;
  try {
    await Promise.race([ready, execution.then(() => { throw new Error("DATA_DELETE_COMMIT_BARRIER_NOT_REACHED"); })]);
    backup = await createDeleteFixtureBackup(fixture);
  } finally { release(); }
  assert.equal((await execution).state, "SUCCEEDED");
  const ledger = await fixtureLedger(client);
  const completed = ledger.find(entry => entry.intentId === intent.id)!;
  assert.ok(completed.completedAt <= backup.createdAt, "the deletion timestamp predates the snapshot but the transaction commits afterward");
  const restored = await restoreDeleteFixtureBackup(fixture, backup);
  try {
    assert.ok(await restored.client.note.findUnique({ where: { id: note.id } }));
    assert.equal((await replayDeleteFixtureLedger(restored, ledger, ledger.at(-1)!.entryHash)).replayed, 1,
      "snapshot-overlap deletion must be replayed even when its completedAt predates backup creation");
    assert.equal(await restored.client.note.findUnique({ where: { id: note.id } }), null);
    console.log("PASS DELETE backup overlap: precommit timestamp cannot hide a deletion missing from the restored ledger snapshot");
  } finally { await restored.client.$disconnect(); }
}
