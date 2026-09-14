import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createPrismaClient, prisma } from "../../packages/db/src/index";
import { buildDatabaseDeletePlan } from "../../packages/db/src/data-delete-plan";
import { deleteFixtureEnvironment, loadDataDeleteFixture, verifyDeleteFixtureLedger } from "./data-delete-fixture";
import { createDatabaseDeletion, controlDatabaseDeletion } from "../../packages/db/src/data-delete-intents";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { withDeletionVisibility } from "../../packages/db/src/data-delete-visibility";
import { testDeletionVisibility } from "./data-delete-runtime-visibility";
import { createDeleteFixtureBackup, restoreDeleteFixtureBackup, fixtureLedger, replayDeleteFixtureLedger, testDeletionBackupWatermark } from "./data-delete-restore-runtime";
import { testDeleteProcessRecovery } from "./data-delete-process-runtime";
import { testDeletionControls } from "./data-delete-control-runtime";
import { testDeletionResourceKinds, testDeletionAuthorizationChanges, testDeletionBlockingReferences, testDeletionRetryBudget } from "./data-delete-policy-runtime";

async function main() {
  const fixture = loadDataDeleteFixture(process.argv[2] ?? process.env.AREAFORGE_DATA_DELETE_FIXTURE_ROOT ?? "");
  const env = deleteFixtureEnvironment(fixture);
  process.env.DATABASE_URL = env.DATABASE_URL;
  const client = createPrismaClient(env.DATABASE_URL);
  process.env.DATA_DELETE_ENABLED = "true"; process.env.DATA_LIFECYCLE_ENABLED = "true";
  try {
    const [identity] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(identity?.name, fixture.databaseName);
    await verifyDeleteFixtureLedger(client);
    await testDeletionVisibility(client, env.DATABASE_URL!);
    await testDeleteProcessRecovery(client, fixture);
    await testDeletionControls(client, fixture);
    await testDeletionResourceKinds(client, fixture);
    await testDeletionAuthorizationChanges(client, fixture);
    await testDeletionBlockingReferences(client, fixture);
    await testDeletionRetryBudget(client, fixture);
    await testDeletionBackupWatermark(client, fixture);
    const suffix = randomUUID();
    const alice = await client.user.create({ data: { email: "delete-a-" + suffix + "@example.test", passwordHash: "synthetic-not-login", emailVerifiedAt: new Date() } });
    const bob = await client.user.create({ data: { email: "delete-b-" + suffix + "@example.test", passwordHash: "synthetic-not-login", emailVerifiedAt: new Date() } });
    const workspace = await client.examWorkspace.create({ data: { userId: alice.id, stableKey: "delete-" + suffix, name: "Synthetic deletion scope" } });
    await client.workspaceMembership.create({ data: { userId: alice.id, workspaceId: workspace.id, role: "OWNER", status: "ACTIVE" } });
    const subject = await client.subject.create({ data: { workspaceId: workspace.id, stableKey: "subject-" + suffix, name: "Synthetic subject", color: "#123456" } });
    const note = await client.note.create({ data: { subjectId: subject.id, ownerUserId: alice.id, title: "Synthetic note", content: "SYNTHETIC_DELETE_BODY" } });
    const target = { requesterId: alice.id, scope: "WORKSPACE" as const, workspaceId: workspace.id, resourceType: null, resourceId: null };
    const preview = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { isolationLevel: "RepeatableRead", timeout: 60_000 });
    assert.deepEqual(preview.blockers, []);
    assert.ok(preview.items.some(item => item.model === "Note" && item.key.id === note.id));
    assert.equal(JSON.stringify(preview).includes("SYNTHETIC_DELETE_BODY"), false);
    await client.note.update({ where: { id: note.id }, data: { content: "SYNTHETIC_CHANGED_BODY" } });
    const changed = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { isolationLevel: "RepeatableRead", timeout: 60_000 });
    assert.notEqual(changed.fingerprint, preview.fingerprint);
    await client.note.create({ data: { subjectId: subject.id, ownerUserId: bob.id, title: "Another owner", content: "DO_NOT_DELETE_OTHER_OWNER" } });
    const blocked = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { isolationLevel: "RepeatableRead", timeout: 60_000 });
    assert.ok(blocked.blockers.includes("DATA_DELETE_FOREIGN_REFERENCE"));
    const resource = await client.$transaction(tx => buildDatabaseDeletePlan(tx, { ...target, scope: "RESOURCE", resourceType: "Note", resourceId: note.id }), { isolationLevel: "RepeatableRead", timeout: 60_000 });
    assert.deepEqual(resource.blockers, []);
    assert.deepEqual(resource.items.map(item => item.model), ["Note"]);
    const session = await client.authSession.create({ data: { userId: alice.id, tokenHash: randomBytes(32).toString("hex"),
      authRevision: alice.authRevision, expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
    const actor = { id: alice.id, sessionId: session.id };
    const request = { actor, target: resource.target, fingerprint: resource.fingerprint, idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") };
    const trashed = await createDatabaseDeletion(client, request);
    assert.equal(trashed.state, "TRASHED");
    assert.equal((await createDatabaseDeletion(client, request)).id, trashed.id);
    const visible = withDeletionVisibility(client);
    assert.equal(await visible.note.findUnique({ where: { id: note.id } }), null);
    assert.equal(await visible.note.count({ where: { AND: [{ subjectId: subject.id }, { ownerUserId: alice.id }] } }), 0);
    const nested = await visible.subject.findUniqueOrThrow({ where: { id: subject.id }, include: {
      notes: { where: { ownerUserId: alice.id } }, _count: { select: { notes: { where: { ownerUserId: alice.id } } } } } });
    assert.equal(nested.notes.length, 0); assert.equal(nested._count.notes, 0);
    await assert.rejects(() => client.note.update({ where: { id: note.id }, data: { content: "MUST_NOT_WRITE_FROZEN" } }), /DATA_DELETE_SCOPE_FROZEN/);
    assert.equal(await claimDatabaseDeletion(client, "too-early", trashed.id), null);
    await controlDatabaseDeletion(client, { actor, intentId: trashed.id, expectedRevision: trashed.revision, action: "restore" });
    assert.ok(await visible.note.findUnique({ where: { id: note.id } }));
    await client.note.update({ where: { id: note.id }, data: { content: "SYNTHETIC_RESTORED" } });
    const bytes = Buffer.from("%PDF-1.4 synthetic deletion fixture\n");
    const storedName = randomBytes(16).toString("hex") + ".pdf";
    await writeFile(path.join(fixture.root, "uploads", storedName), bytes, { mode: 0o600, flag: "wx" });
    const attachment = await client.attachment.create({ data: { noteId: note.id, ownerUserId: alice.id, storedName,
      originalName: "synthetic.pdf", mimeType: "application/pdf", sizeBytes: bytes.length,
      hash: createHash("sha256").update(bytes).digest("hex"), uri: "upload://attachment/" + storedName, status: "READY" } });
    const withFile = await client.$transaction(tx => buildDatabaseDeletePlan(tx, resource.target), { isolationLevel: "RepeatableRead", timeout: 60_000 });
    assert.deepEqual(withFile.blockers, []);
    const backup = await createDeleteFixtureBackup(fixture);
    const pending = await createDatabaseDeletion(client, { ...request, fingerprint: withFile.fingerprint, idempotencyKey: randomUUID() });
    await client.dataDeletionIntent.update({ where: { id: pending.id }, data: { frozenAt: new Date(Date.now() - 30 * 86_400_000 - 10_000), availableAt: new Date(Date.now() - 5_000) } });
    const lease = await claimDatabaseDeletion(client, "delete-test", pending.id);
    assert.ok(lease);
    const result = await executeDatabaseDeletion(client, lease, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") });
    assert.equal(result.state, "SUCCEEDED");
    assert.equal(await client.note.findUnique({ where: { id: note.id } }), null);
    assert.equal(await client.attachment.findUnique({ where: { id: attachment.id } }), null);
    await assert.rejects(() => access(path.join(fixture.root, "uploads", storedName)));
    assert.ok(await client.note.findFirst({ where: { ownerUserId: bob.id } }));
    assert.equal(await client.dataDeletionLedger.count({ where: { intentId: pending.id } }), 1);
    const ledger = await fixtureLedger(client);
    const targetCopy = await restoreDeleteFixtureBackup(fixture, backup);
    try {
      assert.ok(await targetCopy.client.note.findUnique({ where: { id: note.id } }));
      await access(path.join(targetCopy.root, "uploads", storedName));
      assert.equal((await replayDeleteFixtureLedger(targetCopy, ledger, ledger.at(-1)!.entryHash)).replayed, 1);
      assert.equal(await targetCopy.client.note.findUnique({ where: { id: note.id } }), null);
      await assert.rejects(() => access(path.join(targetCopy.root, "uploads", storedName)));
      assert.equal((await replayDeleteFixtureLedger(targetCopy, ledger, ledger.at(-1)!.entryHash)).replayed, 0);
      const changed = JSON.parse(JSON.stringify(ledger)); changed.at(-1).manifest.items[0].key.id = "tampered";
      await assert.rejects(() => replayDeleteFixtureLedger(targetCopy, changed, ledger.at(-1)!.entryHash), /LEDGER_INVALID/);
      console.log("PASS DELETE restore: verified synthetic dump/files in a new database, trusted ledger replay, no resurrection, idempotence and tamper rejection");
    } finally { await targetCopy.client.$disconnect(); }
    console.log("PASS DELETE runtime: canonical ledger, exact row hashes, cross-owner blocking, persistent trash/restore, frozen writes, cooldown, physical file/row purge and ledger");
  } finally { await client.$disconnect(); await prisma.$disconnect(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "DATA_DELETE_RUNTIME_FAILED"); process.exitCode = 1; });
