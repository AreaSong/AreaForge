import assert from "node:assert/strict";
import { writeFile, unlink, copyFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { createPrismaClient, type PrismaClient } from "../../packages/db/src/index";
import { selectPersistedDeletionReplay, hashDataExportValue } from "../../packages/core/src/index";
import { loadStorageQuotaFixture, storageQuotaFixtureEnvironment, assertStorageQuotaFixtureContainer, type StorageQuotaFixture } from "./storage-quota-fixture";
import { priorState, assertPriorState, fileIdentity } from "./storage-quota-deletion-data";
import { withStoragePolicy, storagePdfBytes } from "./storage-quota-runtime-data";
import { seedRestoreCases, deleteCase, admissionInput } from "./storage-quota-restore-data";
import { snapshot, restore, ledger, verifyRestoredWatermark, digest, privateBytes, watermarkOf, type RestoreTarget, type Snapshot } from "./storage-quota-restore-tools";
import { pinTrust, StorageRestoreGate } from "./storage-quota-restore-control";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;
export async function runStorageRestoreMatrix(client: PrismaClient, fixture: StorageQuotaFixture, check: Check) {
  const oldRoot = process.argv.find(arg => arg.startsWith("--prior-root="))?.slice(13);
  assert.ok(oldRoot, "explicit prior fixture required"); const old = loadStorageQuotaFixture(oldRoot); assertStorageQuotaFixtureContainer(old);
  assert.notEqual(old.scopeId, fixture.scopeId);
  const oldClient = createPrismaClient(storageQuotaFixtureEnvironment(old).DATABASE_URL);
  const before = await priorState(oldClient, old); const targets: RestoreTarget[] = []; const evidence: object[] = [];
  try {
    const data = await seedRestoreCases(client, fixture);
    const snapshotRows = await client.attachment.findMany({ orderBy: { id: "asc" } });
    const main = await snapshot(fixture, client, "quiescent-db-and-files");
    await check("snapshot-dump-files-and-nonzero-checkpoint", async () => {
      assert.equal(main.watermark.sequence, "1"); assert.equal(main.files[data.baseline.attachment.storedName], undefined);
    });
    await check("source-post-snapshot-note-workspace-file-resource-deletions", async () => {
      await deleteCase(client, fixture, data.note); await deleteCase(client, fixture, data.workspace, true); await deleteCase(client, fixture, data.resource);
      assert.ok(await client.attachment.findUnique({ where: { id: data.resource.attachment.id } }));
      assert.equal(await client.studyResource.count({ where: { id: data.resource.target.resourceId! } }), 0);
    });
    let race!: Snapshot;
    await check("commit-barrier-timestamp-before-snapshot-sequence-after", async () => {
      let release!: () => void; let reached!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { reached = resolve; });
      const execution = deleteCase(client, fixture, data.race, false, { beforeCommit: async () => { reached(); await held; } });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([ready, execution.then(() => { throw new Error("STORAGE_BARRIER_MISSED"); }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("STORAGE_BARRIER_TIMEOUT")), 20000); })]);
        race = await snapshot(fixture, client, "commit-race-attachmentless-note-files-quiescent");
      } finally { if (timer) clearTimeout(timer); release(); }
      const intent = await execution; const entries = await ledger(client); const entry = entries.find(row => row.intentId === intent.id)!;
      assert.ok(entry.completedAt < race.capturedAt); assert.equal(race.watermark.sequence, "4"); assert.equal(entry.sequence, "5");
      assert.equal(entries.filter(row => row.completedAt > race.capturedAt).length, 0);
      evidence.push({ event: "commit-race", completedAt: entry.completedAt, snapshotAt: race.capturedAt, snapshotSequence: "4", committedSequence: "5",
        timeFilterMissing: true, fileArrangement: "only attachmentless Note transaction held; all file writers stopped" });
    });
    const trust = await pinTrust(fixture, client);
    const expected = await client.attachment.findMany({ orderBy: { id: "asc" } });
    await check("independent-source-head-and-snapshot-suffix", async () => {
      assert.equal(trust.sequence, "5"); assert.equal(selectPersistedDeletionReplay(trust.entries, trust.head, main.watermark).length, 4);
      assert.equal(selectPersistedDeletionReplay(trust.entries, trust.head, race.watermark).length, 1);
    });
    const newGate = async (backup = main) => {
      const target = await restore(fixture, backup); targets.push(target);
      return new StorageRestoreGate(target, trust, client, expected);
    };
    const positive = await newGate(); const request = admissionInput(data.keep);
    await check("real-restore-55-migrations-checkpoint-and-private-files", async () => {
      assert.deepEqual(await positive.target.client.attachment.findMany({ orderBy: { id: "asc" } }), snapshotRows);
      assert.deepEqual(watermarkOf(await ledger(positive.target.client)), main.watermark);
      assert.ok(Object.keys(main.files).length >= 10);
    });
    await check("closed-gate-rejects-upload-even-quota-disabled", async () => {
      await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_ENABLED: "false" }, () => assert.rejects(positive.admit(request), /STORAGE_RESTORE_CLOSED/));
      await assert.rejects(positive.verifyAndOpen()); assert.equal(positive.opened, false);
      assert.deepEqual(await positive.target.client.attachment.findMany({ orderBy: { id: "asc" } }), snapshotRows);
    });
    await check("file-unlink-interruption-retains-rows-and-resumes", async () => {
      let interrupted = false;
      await assert.rejects(positive.replay(trust.entries, { afterUnlink: async () => { interrupted = true; throw new Error("SYNTHETIC_STORAGE_RESTORE_INTERRUPTION"); } }), /STORAGE_REPLAY_INCOMPLETE/);
      assert.ok(interrupted); assert.equal(positive.opened, false);
      assert.ok(await positive.target.client.attachment.findUnique({ where: { id: data.note.attachment.id } }));
      await assert.rejects(privateBytes(path.join(positive.target.root, "uploads", data.note.attachment.storedName)), { code: "ENOENT" });
      assert.equal(await positive.replay(), 4);
    });
    await check("repeat-trusted-suffix-no-double-delete-or-settlement", async () => {
      const saved = await ledger(positive.target.client); const rows = await positive.target.client.attachment.findMany({ orderBy: { id: "asc" } });
      assert.equal(await positive.replay(), 0); assert.deepEqual(await ledger(positive.target.client), saved);
      assert.deepEqual(await positive.target.client.attachment.findMany({ orderBy: { id: "asc" } }), rows);
    });
    await check("deleted-files-absent-closure-and-other-owners-preserved", async () => {
      for (const dataCase of [data.note, data.workspace]) {
        assert.equal(await positive.target.client.attachment.findUnique({ where: { id: dataCase.attachment.id } }), null);
        await assert.rejects(privateBytes(path.join(positive.target.root, "uploads", dataCase.attachment.storedName)), { code: "ENOENT" });
      }
      assert.equal(await positive.target.client.note.findUnique({ where: { id: data.race.note.id } }), null);
      for (const id of [data.registration.resource, data.registration.keep, data.registration.member, data.registration.secondary, data.registration.frozen]) {
        assert.deepEqual(await positive.target.client.attachment.findUniqueOrThrow({ where: { id } }), expected.find(row => row.id === id));
      }
      assert.ok(await positive.target.client.dataDeletionFence.count({ where: { intentId: data.registration.frozenIntent } }));
    });
    let inventory: object = {};
    await check("raw-ready-pending-failed-frozen-and-verified-release-usage", async () => { inventory = await positive.verifyAndOpen(); });
    const negativeInputs: Array<[string, (entries: typeof trust.entries) => unknown]> = [
      ["missing-suffix", rows => rows.slice(0, -1)], ["reordered-suffix", rows => [rows[0], rows[2], rows[1], ...rows.slice(3)]],
      ["tampered-suffix", rows => rows.map((row, index) => index === 2 ? { ...row, scopeHash: "0".repeat(64) } : row)],
      ["recomputed-self-head", rows => { const cloned = structuredClone(rows); const last = cloned.at(-1)!; last.scopeHash = "0".repeat(64);
        const { sequence: _sequence, entryHash: _entryHash, ...body } = last; last.entryHash = hashDataExportValue(body); return cloned; }],
      ["wrong-scope", rows => rows.map((row, index) => index === 2 ? { ...row, scope: "ACCOUNT" } : row)],
    ];
    for (const [name, mutate] of negativeInputs) await check(name + "-rejected-before-mutation", async () => {
      const gate = await newGate(); const beforeRows = await priorState(gate.target.client, { ...fixture, root: gate.target.root });
      await assert.rejects(gate.replay(mutate(trust.entries))); await assert.rejects(gate.admit(request), /STORAGE_RESTORE_CLOSED/);
      await assertPriorState(gate.target.client, { ...fixture, root: gate.target.root }, beforeRows);
    });
    await check("wrong-independent-head-refused", async () => {
      assert.throws(() => selectPersistedDeletionReplay(trust.entries, "0".repeat(64), main.watermark));
      const target = (await newGate()).target;
      const forged = new StorageRestoreGate(target, { ...trust, head: "0".repeat(64) }, client, expected);
      await assert.rejects(forged.replay()); await assert.rejects(forged.admit(request), /STORAGE_RESTORE_CLOSED/);
    });
    await check("snapshot-watermark-mismatch-refused", async () => {
      const gate = await newGate();
      await assert.rejects(verifyRestoredWatermark(gate.target.client, { sequence: "1", entryHash: "0".repeat(64) }), /STORAGE_SNAPSHOT_WATERMARK_MISMATCH/);
      await assert.rejects(verifyRestoredWatermark(gate.target.client, { sequence: "0", entryHash: null }), /STORAGE_SNAPSHOT_WATERMARK_MISMATCH/);
      assert.throws(() => selectPersistedDeletionReplay(trust.entries, trust.head, { sequence: "1", entryHash: "0".repeat(64) }));
      await writeFile(path.join(gate.target.root, ".restore-target.json"), JSON.stringify({ ...gate.target.registration,
        watermark: { sequence: "1", entryHash: "0".repeat(64) } }), { mode: 0o600 });
      await assert.rejects(gate.replay()); assert.equal(gate.opened, false);
    });
    await check("wrong-target-database-binding-refused", async () => {
      const gate = await newGate(); const correct = gate.target.client; gate.target.client = client;
      try { await assert.rejects(gate.replay()); assert.equal(gate.opened, false); } finally { gate.target.client = correct; }
    });
    for (const fault of ["missing-file", "dual-file", "reappeared-file", "released-file-reappeared", "hash-mismatch", "unknown-file", "metadata-identity", "unknown-owner"] as const) {
      await check(fault + "-retained-closed", async () => {
        const gate = await newGate(); await gate.replay();
        const file = path.join(gate.target.root, "uploads", data.keep.attachment.storedName);
        if (fault === "missing-file") await unlink(file);
        if (fault === "dual-file") await copyFile(file, path.join(gate.target.root, "uploads", ".staging", data.keep.attachment.storedName + ".staging"), constants.COPYFILE_EXCL);
        if (fault === "reappeared-file") await copyFile(path.join(main.directory, "uploads", data.note.attachment.storedName), path.join(gate.target.root, "uploads", data.note.attachment.storedName), constants.COPYFILE_EXCL);
        if (fault === "released-file-reappeared") {
          const released = expected.find(row => row.id === data.registration.released)!;
          await writeFile(path.join(gate.target.root, "uploads", released.storedName), storagePdfBytes, { mode: 0o600, flag: "wx" });
        }
        if (fault === "hash-mismatch") { const bytes = await privateBytes(file); bytes[0] = bytes[0]! ^ 1; await writeFile(file, bytes); }
        if (fault === "unknown-file") await writeFile(path.join(gate.target.root, "uploads", "unknownstorageidentity.pdf"), storagePdfBytes, { flag: "wx", mode: 0o600 });
        if (fault === "metadata-identity") await gate.target.client.attachment.update({ where: { id: data.keep.attachment.id }, data: { uri: "upload://attachment/invalid.pdf" } });
        if (fault === "unknown-owner") await gate.target.client.attachment.create({ data: {
          ownerUserId: data.keep.owner.id, originalName: "synthetic-orphan.pdf", storedName: "unknownstorageowner.pdf",
          uri: "upload://attachment/unknownstorageowner.pdf", hash: data.keep.attachment.hash, sizeBytes: storagePdfBytes.length,
          mimeType: "application/pdf", status: "READY", protocolVersion: 0 } });
        await assert.rejects(gate.verifyAndOpen()); await assert.rejects(gate.admit(request), /STORAGE_RESTORE_CLOSED/);
        evidence.push({ fault, target: gate.target.id, preservedClosed: true });
      });
    }
    await check("race-snapshot-real-restore-and-missing-commit-replay", async () => {
      const gate = await newGate(race); assert.ok(await gate.target.client.note.findUnique({ where: { id: data.race.note.id } }));
      assert.equal(await gate.replay(), 1); await gate.verifyAndOpen();
      assert.equal(await gate.target.client.note.findUnique({ where: { id: data.race.note.id } }), null);
      assert.equal(await gate.replay(), 0); // 重放操作再次关闭门禁。
    });
    await check("opened-gate-service-intent-only-on-verified-target", async () => {
      const created = await positive.admit(request);
      const row = await positive.target.client.attachment.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.status, "PENDING"); assert.equal(row.storageWorkspaceId, data.keep.workspace.id);
      assert.equal(await client.attachment.count({ where: { id: created.id } }), 0);
      assert.equal(positive.opened, false); evidence.push({ controlledServiceAdmission: true, target: positive.target.id, httpStarted: false });
    });
    await check("opened-evidence-drift-closes-before-upload", async () => {
      const gate = await newGate(); await gate.replay(); await gate.verifyAndOpen();
      const file = path.join(gate.target.root, "uploads", data.keep.attachment.storedName);
      const bytes = await privateBytes(file); bytes[0] = bytes[0]! ^ 1; await writeFile(file, bytes);
      await assert.rejects(gate.admit(request), /STORAGE_RESTORE_EVIDENCE_DRIFT/); assert.equal(gate.opened, false);
    });
    await check("trusted-source-head-drift-closes-before-upload", async () => {
      const gate = await newGate(); await gate.replay(); await gate.verifyAndOpen();
      await deleteCase(client, fixture, data.drift);
      await assert.rejects(gate.admit(request), /STORAGE_TRUST_DRIFT/); assert.equal(gate.opened, false);
      evidence.push({ trustedHeadDriftRejected: true, fixedSequence: trust.sequence, currentSequence: watermarkOf(await ledger(client)).sequence });
    });
    await check("tampered-dump-refused-without-overwriting-target", async () => {
      const damaged = await snapshot(fixture, client, "negative-dump-corruption");
      const file = path.join(damaged.directory, "database.dump"); const bytes = await privateBytes(file); bytes[0] = bytes[0]! ^ 1; await writeFile(file, bytes);
      await assert.rejects(restore(fixture, damaged), /STORAGE_DUMP_CHANGED/);
    });
    const preservation = await assertPriorState(oldClient, old, before);
    await check("prior-storage-resource-rows-files-unchanged", async () => {});
    evidence.push({ event: "positive-replay", target: positive.target.id, results: positive.results, inventory });
    return { cases: evidence, priorFixtureId: old.scopeId, ...preservation,
      source: { root: fixture.root, databaseName: fixture.databaseName, containerName: fixture.containerName, volumeName: fixture.volumeName, port: fixture.port, uid: fixture.ownerUid, fixtureId: fixture.scopeId },
      snapshots: [main, race].map(row => ({ kind: row.kind, dumpHash: row.dumpHash, fileManifestHash: row.fileManifestHash, watermark: row.watermark })),
      trust: { sourceId: trust.sourceId, head: trust.head, sequence: trust.sequence, independentlyPinned: true },
      targets: targets.map(row => ({ root: row.root, databaseName: row.databaseName, id: row.id, preserved: true, http: false })),
      gateBoundary: "fixture-only, fails closed, one service-level synthetic admission; not a production restore gate" };
  } finally { for (const target of targets) await target.client.$disconnect(); await oldClient.$disconnect(); }
}
