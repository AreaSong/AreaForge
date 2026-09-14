import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../packages/db/src/index";
import { buildDatabaseDeletePlan } from "../../packages/db/src/data-delete-plan";
import { createDatabaseDeletion, controlDatabaseDeletion } from "../../packages/db/src/data-delete-intents";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { seedDeletionCase, createFixtureDeletion, makeDeletionEligible } from "./data-delete-runtime-data";
import type { DataDeleteFixture } from "./data-delete-fixture";
import path from "node:path";

export async function testDeletionControls(client: PrismaClient, fixture: DataDeleteFixture) {
  const roots = { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") };
  for (const scope of ["ACCOUNT", "WORKSPACE"] as const) {
    const data = await seedDeletionCase(client, fixture);
    const intent = await createFixtureDeletion(client, data, scope);
    assert.equal(await claimDatabaseDeletion(client, "not-due", intent.id), null);
    await assert.rejects(() => client.note.create({ data: { ownerUserId: data.user.id, subjectId: data.subject.id, title: "Cannot add", content: "blocked" } }), /DATA_DELETE_SCOPE_FROZEN/);
    if (scope === "ACCOUNT") {
      await client.authSession.create({ data: { userId: data.user.id, tokenHash: randomBytes(32).toString("hex"), authRevision: data.user.authRevision,
        expiresAt: new Date(Date.now() + 3600000), reauthenticatedAt: new Date() } });
      await client.auditEvent.create({ data: { actorId: data.user.id, action: "AUTH_SYNTHETIC_REAUTH", entityType: "AuthSession", entityId: data.session.id,
        metadata: { detail: "FORBIDDEN_AUTH_DETAIL" } } });
    }
    await makeDeletionEligible(client, intent.id);
    const lease = await claimDatabaseDeletion(client, "root-delete", intent.id); assert.ok(lease);
    const result = await executeDatabaseDeletion(client, lease, roots, { afterIntent: async () => {
      const current = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: intent.id } });
      await assert.rejects(() => controlDatabaseDeletion(client, { actor: data.actor, intentId: intent.id, expectedRevision: current.revision, action: "cancel" }), /CONTROL_INVALID/);
    } });
    assert.equal(result.state, "SUCCEEDED");
    assert.equal(await client.examWorkspace.findUnique({ where: { id: data.workspace.id } }), null);
    assert.equal(await client.note.findUnique({ where: { id: data.note.id } }), null);
    assert.equal(await client.attachment.findUnique({ where: { id: data.attachment.id } }), null);
    assert.equal(!!await client.user.findUnique({ where: { id: data.user.id } }), scope !== "ACCOUNT");
    assert.equal(!!await client.authSession.findUnique({ where: { id: data.session.id } }), scope !== "ACCOUNT");
    const ledger = await client.dataDeletionLedger.findUniqueOrThrow({ where: { intentId: intent.id } });
    assert.equal(JSON.stringify(ledger.manifest).includes("FORBIDDEN_AUTH_DETAIL"), false);
    if (scope === "ACCOUNT") assert.equal(await client.auditEvent.count({ where: { actorId: data.user.id } }), 0);
    console.log("PASS DELETE " + scope + ": true root erasure, exact owned closure, security cleanup, irreversible cancellation refusal");
  }
  await testCancelAndChangedPreview(client, fixture);
  await testReconfirmation(client, fixture);
}

async function testCancelAndChangedPreview(client: PrismaClient, fixture: DataDeleteFixture) {
  const data = await seedDeletionCase(client, fixture);
  const target = { requesterId: data.user.id, scope: "WORKSPACE" as const, workspaceId: data.workspace.id, resourceType: null, resourceId: null };
  const before = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { timeout: 60000 });
  await client.note.update({ where: { id: data.note.id }, data: { content: "Changed exact preimage" } });
  await assert.rejects(() => createDatabaseDeletion(client, { actor: data.actor, target, fingerprint: before.fingerprint,
    idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") }), /PREVIEW_CHANGED/);
  const pending = await createFixtureDeletion(client, data, "WORKSPACE");
  process.env.DATA_DELETE_ENABLED = "false";
  try { assert.equal((await controlDatabaseDeletion(client, { actor: data.actor, intentId: pending.id, expectedRevision: pending.revision, action: "cancel" })).state, "CANCELLED"); }
  finally { process.env.DATA_DELETE_ENABLED = "true"; }
  await client.note.update({ where: { id: data.note.id }, data: { content: "Unfrozen after cancellation" } });
  console.log("PASS DELETE controls: changed preview rejected; disabling new requests does not block cancellation");
}

async function testReconfirmation(client: PrismaClient, fixture: DataDeleteFixture) {
  const data = await seedDeletionCase(client, fixture);
  const pending = await createFixtureDeletion(client, data);
  await client.examWorkspace.update({ where: { id: data.workspace.id }, data: { name: "Renamed while note is trashed", revision: { increment: 1 } } });
  await makeDeletionEligible(client, pending.id);
  const first = await claimDatabaseDeletion(client, "old-epoch", pending.id); assert.ok(first);
  const roots = { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") };
  assert.equal((await executeDatabaseDeletion(client, first, roots)).state, "FAILED");
  const failed = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(failed.irreversibleAt, null);
  await assert.rejects(() => controlDatabaseDeletion(client, { actor: data.actor, intentId: pending.id, expectedRevision: failed.revision, action: "restore" }), /CONTROL_INVALID/);
  await controlDatabaseDeletion(client, { actor: data.actor, intentId: pending.id, expectedRevision: failed.revision, action: "retry" });
  const next = await claimDatabaseDeletion(client, "new-epoch", pending.id); assert.ok(next);
  assert.equal((await executeDatabaseDeletion(client, next, roots)).state, "SUCCEEDED");
  console.log("PASS DELETE reconfirmation: expired trash rebinds current authorization without changing objects or extending retention");
}
