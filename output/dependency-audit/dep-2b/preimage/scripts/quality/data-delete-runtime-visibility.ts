import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "../../packages/db/src/index";
import { buildDatabaseDeletePlan } from "../../packages/db/src/data-delete-plan";
import { createDatabaseDeletion, controlDatabaseDeletion } from "../../packages/db/src/data-delete-intents";
import { withDeletionVisibility } from "../../packages/db/src/data-delete-visibility";

export async function testDeletionVisibility(client: PrismaClient, databaseUrl: string) {
  const suffix = randomUUID();
  const user = await client.user.create({ data: { email: "delete-visibility-" + suffix + "@example.test", passwordHash: "synthetic" } });
  const empty = await client.user.create({ data: { email: "delete-empty-" + suffix + "@example.test", passwordHash: "synthetic" } });
  await client.motivationVault.create({ data: { userId: user.id, whyStarted: "PRIVATE_TRASH_VAULT" } });
  const session = await client.authSession.create({ data: { userId: user.id, authRevision: user.authRevision, tokenHash: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 3_600_000), reauthenticatedAt: new Date() } });
  const actor = { id: user.id, sessionId: session.id };
  const target = { requesterId: user.id, scope: "ACCOUNT" as const, workspaceId: null, resourceType: null, resourceId: null };
  const plan = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { timeout: 60000 });
  assert.deepEqual(plan.blockers, []);
  const intent = await createDatabaseDeletion(client, { actor, target, fingerprint: plan.fingerprint,
    idempotencyKey: suffix, receiptToken: randomBytes(32).toString("hex") });
  const raw = createPrismaClient(databaseUrl, { max: 1, connectionTimeoutMillis: 500 });
  const visible = withDeletionVisibility(raw);
  try {
    const direct = await visible.user.findUniqueOrThrow({ where: { id: user.id }, include: { motivationVault: true } });
    assert.equal(direct.motivationVault, null);
    const mutated = await visible.user.update({ where: { id: user.id }, data: { passwordChangedAt: new Date() }, include: { motivationVault: true } });
    assert.equal(mutated.motivationVault, null);
    await visible.$transaction(async tx => {
      assert.equal(await tx.motivationVault.count({ where: { userId: user.id } }), 0);
      assert.equal((await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: { motivationVault: true } })).motivationVault, null);
    });
    const batch = await visible.$transaction([visible.motivationVault.count({ where: { userId: user.id } }), visible.user.count({ where: { id: user.id } })]);
    assert.deepEqual(batch, [0, 1]);
    assert.equal(await visible.user.findFirst({ where: { id: user.id, motivationVault: { isNot: null } } }), null);
    assert.ok(await visible.user.findFirst({ where: { id: user.id, motivationVault: { is: null } } }));
    const negative = await visible.user.findMany({ where: { id: { in: [user.id, empty.id] }, motivationVault: { isNot: { whyStarted: "PRIVATE_TRASH_VAULT" } } }, select: { id: true } });
    assert.equal(negative.some(row => row.id === user.id), negative.some(row => row.id === empty.id));
    await controlDatabaseDeletion(client, { actor, intentId: intent.id, expectedRevision: intent.revision, action: "cancel" });
    assert.ok((await visible.user.findUniqueOrThrow({ where: { id: user.id }, include: { motivationVault: true } })).motivationVault);
    console.log("PASS DELETE visibility: singular relation, identity mutation, nullable predicate, single-connection interactive and batch transactions");
  } finally { await raw.$disconnect(); }
}
