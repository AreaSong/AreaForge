import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { selectPersistedDeletionReplay, validatePersistedDeletionLedger, isVerifiedStorageRelease, hashDataExportValue, type PersistedDeletionLedger } from "../../packages/core/src/index";
import { type PrismaClient, checkWorkspaceStorageQuotaAdmission, readStorageQuotaFileClaims } from "../../packages/db/src/index";
import { readDeleteRecords, deleteKeyPredicate } from "../../packages/db/src/data-delete-query";
import { prepareDeletionReplay } from "../../packages/db/src/data-delete-replay";
import { buildRestorationDeletePlan } from "../../packages/db/src/data-delete-plan";
import { verifyFrozenDeletePlan, type DeletePlanVerifier } from "../../packages/db/src/data-delete-commit";
import { verifyStorageQuotaInventory } from "../../packages/storage/src/index";
import { executeDatabaseDeletion, type DataDeleteHooks } from "../workers/data-delete-worker";
import { createStorageAttachmentIntent, type PendingStorageAttachmentInput } from "../../apps/web/lib/study/attachment-storage-service";
import { withStoragePolicy } from "./storage-quota-runtime-data";
import { digest, fileTree, privateBytes, ledger, watermarkOf, verifyTarget, verifySnapshot, type RestoreTarget } from "./storage-quota-restore-tools";
import { type StorageQuotaFixture } from "./storage-quota-fixture";

type Trust = { sourceId: string; head: string | null; sequence: string; directory: string; hash: string; entries: PersistedDeletionLedger[] };
const trusts = new WeakSet<Trust>();
/** head 先从受控源独立查询并固定；导出的待验文件不提供信任锚。 */
export async function pinTrust(source: StorageQuotaFixture, client: PrismaClient): Promise<Trust> {
  const head = await client.dataDeletionLedger.findFirst({ orderBy: { sequence: "desc" }, select: { entryHash: true, sequence: true } });
  const entries = await ledger(client); validatePersistedDeletionLedger(entries, head?.entryHash ?? null);
  const directory = path.join(source.root, "backups", "trust-" + randomBytes(6).toString("hex"));
  const { mkdir } = await import("node:fs/promises"); await mkdir(directory, { mode: 0o700 });
  const anchor = { sourceId: source.scopeId, head: head?.entryHash ?? null, sequence: String(head?.sequence ?? 0) };
  const hash = digest(JSON.stringify(anchor));
  await writeFile(path.join(directory, "head.json"), JSON.stringify(anchor), { flag: "wx", mode: 0o600 });
  await writeFile(path.join(directory, "ledger.json"), JSON.stringify(entries), { flag: "wx", mode: 0o600 });
  const trust = { ...anchor, directory, hash, entries }; trusts.add(trust); return trust;
}
async function verifyTrust(trust: Trust, source: StorageQuotaFixture, client: PrismaClient) {
  assert.ok(trusts.has(trust)); assert.equal(trust.sourceId, source.scopeId);
  const [database] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database?.name, source.databaseName);
  assert.equal(digest(await privateBytes(path.join(trust.directory, "head.json"))), trust.hash);
  const anchor = JSON.parse((await privateBytes(path.join(trust.directory, "head.json"))).toString());
  assert.deepEqual(anchor, { sourceId: trust.sourceId, head: trust.head, sequence: trust.sequence });
  const current = await client.dataDeletionLedger.findFirst({ orderBy: { sequence: "desc" }, select: { entryHash: true, sequence: true } });
  assert.equal(current?.entryHash ?? null, trust.head, "STORAGE_TRUST_DRIFT"); assert.equal(String(current?.sequence ?? 0), trust.sequence);
}
function verifier(entry: PersistedDeletionLedger): DeletePlanVerifier {
  return async (tx, row) => {
    const plan = await verifyFrozenDeletePlan(tx, row, buildRestorationDeletePlan);
    assert.equal(hashDataExportValue(plan.target), hashDataExportValue(entry.manifest.target));
    for (const item of plan.items) {
      assert.ok(entry.manifest.items.some(saved => saved.identityHash === item.identityHash && saved.model === item.model
        && hashDataExportValue(saved.key) === hashDataExportValue(item.key)), "STORAGE_REPLAY_SCOPE_EXPANDED");
      if (item.model === "Attachment") {
        const file = await tx.attachment.findUniqueOrThrow({ where: { id: item.key.id! } });
        assert.ok(entry.manifest.files.some(saved => saved.storageKind === "UPLOAD" && saved.storageKey === file.storedName
          && saved.expectedHash === file.hash && saved.expectedSize === file.sizeBytes), "STORAGE_REPLAY_FILE_CHANGED");
      }
    }
    return plan;
  };
}
export async function restoreInventory(target: RestoreTarget, expected: Awaited<ReturnType<PrismaClient["attachment"]["findMany"]>>) {
  const rows = await target.client.attachment.findMany({ orderBy: { id: "asc" } });
  assert.deepEqual(rows, expected, "STORAGE_RESTORE_METADATA_DRIFT");
  const files = await fileTree(path.join(target.root, "uploads")); const expectedFiles: Record<string, unknown> = {};
  const usage: Record<string, string> = {}; const statuses: Record<string, number> = {};
  for (const row of rows) {
    assert.ok(row.storageWorkspaceId, "STORAGE_RESTORE_UNKNOWN_OWNER");
    statuses[row.status] = (statuses[row.status] ?? 0) + 1;
    if (row.storageReleasedAt !== null) { assert.ok(isVerifiedStorageRelease(row)); continue; }
    usage[row.storageWorkspaceId] = String(BigInt(usage[row.storageWorkspaceId] ?? "0") + BigInt(row.sizeBytes));
    const names = [row.storedName, ".staging/" + row.storedName + ".staging"];
    const saved = names.filter(name => target.snapshot.files[name]);
    // READY 必须有 final；未落盘意图仍计原始占用，不能因文件缺失猜成释放。
    if (row.status === "READY") assert.deepEqual(saved, [row.storedName]);
    assert.ok(saved.length <= 1);
    for (const name of saved) { assert.deepEqual(target.snapshot.files[name], { hash: row.hash, size: row.sizeBytes }); expectedFiles[name] = target.snapshot.files[name]; }
  }
  assert.deepEqual(files, Object.fromEntries(Object.entries(expectedFiles).sort(([a], [b]) => a.localeCompare(b))), "STORAGE_RESTORE_FILES_DRIFT");
  assert.deepEqual(await fileTree(path.join(target.root, "exports")), {});
  for (const [workspaceId, bytes] of Object.entries(usage)) {
    const verifyInventory = (tx: Parameters<typeof readStorageQuotaFileClaims>[0]) => verifyStorageQuotaInventory(path.join(target.root, "uploads"), names => readStorageQuotaFileClaims(tx, names));
    const probe = (max: string) => target.client.$transaction(tx => checkWorkspaceStorageQuotaAdmission(tx, { workspaceId, requestedBytes: 1 },
      { env: { WORKSPACE_STORAGE_QUOTA_ENABLED: "true", WORKSPACE_STORAGE_QUOTA_MAX_BYTES: max }, verifyInventory }), { isolationLevel: "Serializable" });
    await assert.rejects(probe(bytes), (error: unknown) => (error as { code: string }).code === "WORKSPACE_STORAGE_QUOTA_LIMIT");
    await probe(String(BigInt(bytes) + 1n));
  }
  return { fileManifestHash: digest(JSON.stringify(files)), files: Object.keys(files).length, usage, statuses, rows: rows.length };
}
/** fixture 隔离控制器，不被 Web/生产装载。重启默认为关闭；只允许一次受控服务调用。 */
export class StorageRestoreGate {
  #opened = false; #seal: string | null = null;
  readonly results: Array<{ sequence: string; replayed: boolean; files: number }> = [];
  constructor(readonly target: RestoreTarget, readonly trust: Trust, readonly sourceClient: PrismaClient,
    readonly expected: Awaited<ReturnType<PrismaClient["attachment"]["findMany"]>>) {}
  get opened() { return this.#opened; }
  async #binding() {
    await verifyTarget(this.target); await verifySnapshot(this.target.source, this.target.snapshot);
    await verifyTrust(this.trust, this.target.source, this.sourceClient);
  }
  async replay(input?: unknown, hooks: DataDeleteHooks = {}) {
    this.#opened = false; this.#seal = null; await this.#binding();
    const supplied = input ?? JSON.parse((await privateBytes(path.join(this.trust.directory, "ledger.json"))).toString());
    const entries = selectPersistedDeletionReplay(supplied, this.trust.head, this.target.snapshot.watermark);
    const targetLedger = await ledger(this.target.client); validatePersistedDeletionLedger(targetLedger, watermarkOf(targetLedger).entryHash);
    const prefix = Number(this.target.snapshot.watermark.sequence);
    assert.deepEqual(watermarkOf(targetLedger.slice(0, prefix)), this.target.snapshot.watermark);
    for (const row of targetLedger.slice(prefix)) assert.ok(entries.some(entry => row.intentId === "replay_" + entry.intentId), "STORAGE_TARGET_LEDGER_DRIFT");
    let replayed = 0;
    for (const entry of entries) {
      const lease = await prepareDeletionReplay(this.target.client, entry, this.target.databaseName);
      if (lease) {
        const verify = verifier(entry);
        const result = await executeDatabaseDeletion(this.target.client, lease,
          { uploadRoot: path.join(this.target.root, "uploads"), exportRoot: path.join(this.target.root, "exports") }, hooks,
          { verifyPlan: verify, beforeFile: verify });
        assert.equal(result.state, "SUCCEEDED", "STORAGE_REPLAY_INCOMPLETE"); replayed++;
      }
      const removed = await this.target.client.dataDeletionFile.count({ where: { intentId: "replay_" + entry.intentId, phase: "REMOVED" } });
      this.results.push({ sequence: entry.sequence, replayed: !!lease, files: removed });
    }
    return replayed;
  }
  async verifyAndOpen() {
    this.#opened = false; this.#seal = null; await this.#binding();
    const entries = selectPersistedDeletionReplay(this.trust.entries, this.trust.head, this.target.snapshot.watermark);
    for (const entry of entries) {
      const row = await this.target.client.dataDeletionIntent.findUniqueOrThrow({ where: { id: "replay_" + entry.intentId } });
      assert.equal(row.state, "SUCCEEDED");
      assert.equal(row.requestHash, hashDataExportValue({ sourceEntryHash: entry.entryHash, databaseName: this.target.databaseName }));
      assert.equal(await this.target.client.dataDeletionLedger.count({ where: { intentId: row.id } }), 1);
      for (const item of entry.manifest.items) assert.equal((await readDeleteRecords(this.target.client, item.model, deleteKeyPredicate(item.key))).length, 0, "STORAGE_DELETED_OBJECT_REAPPEARED");
    }
    const inventory = await restoreInventory(this.target, this.expected);
    this.#seal = await this.#stateDigest(); this.#opened = true; return inventory;
  }
  async #stateDigest() {
    const { priorState } = await import("./storage-quota-deletion-data");
    const state = await priorState(this.target.client, { ...this.target.source, root: this.target.root });
    return digest(JSON.stringify({ ...state, visibility: String(state.visibility) }));
  }

  async admit(input: PendingStorageAttachmentInput) {
    const permitted = this.#opened; this.#opened = false;
    assert.ok(permitted, "STORAGE_RESTORE_CLOSED"); await this.#binding();
    assert.equal(await this.#stateDigest(), this.#seal, "STORAGE_RESTORE_EVIDENCE_DRIFT");
    await restoreInventory(this.target, this.expected);
    return withStoragePolicy({ UPLOAD_DIR: path.join(this.target.root, "uploads"), WORKSPACE_STORAGE_QUOTA_ENABLED: "true", WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "4096" },
      () => this.target.client.$transaction(async tx => {
        const note = await tx.note.findUniqueOrThrow({ where: { id: input.noteId! }, include: { subject: true } });
        assert.equal(note.ownerUserId, input.actorId); assert.equal(note.subject.workspaceId, input.workspaceId);
        assert.equal(await tx.dataDeletionFence.count({ where: { model: "Note", keyJson: { path: ["id"], equals: input.noteId! } } }), 0);
        return createStorageAttachmentIntent(tx, input);
      }, { isolationLevel: "Serializable", timeout: 15_000 }));
  }
}
