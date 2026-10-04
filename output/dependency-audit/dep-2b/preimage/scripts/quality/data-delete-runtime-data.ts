import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../packages/db/src/index";
import { buildDatabaseDeletePlan } from "../../packages/db/src/data-delete-plan";
import { createDatabaseDeletion } from "../../packages/db/src/data-delete-intents";
import type { DataDeleteTarget } from "../../packages/core/src/index";
import type { DataDeleteFixture } from "./data-delete-fixture";

export async function seedDeletionCase(client: PrismaClient, fixture: DataDeleteFixture, passwordHash = "synthetic-not-for-login") {
  const [database] = await client.$queryRaw<Array<{ name: string; now: Date }>>`SELECT current_database() AS name, clock_timestamp() AS now`;
  assert.equal(database?.name, fixture.databaseName);
  assert.ok(database?.now);
  const suffix = randomUUID();
  const user = await client.user.create({ data: { email: "delete-" + suffix + "@example.test", passwordHash, emailVerifiedAt: new Date() } });
  const session = await client.authSession.create({ data: { userId: user.id, tokenHash: randomBytes(32).toString("hex"), authRevision: user.authRevision,
    expiresAt: new Date(database.now.getTime() + 86_400_000), reauthenticatedAt: database.now } });
  const workspace = await client.examWorkspace.create({ data: { userId: user.id, stableKey: suffix, name: "删除验收工作区",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  await client.workspaceSelection.create({ data: { userId: user.id, workspaceId: workspace.id } });
  const subject = await client.subject.create({ data: { workspaceId: workspace.id, stableKey: suffix, name: "合成科目", color: "#123456" } });
  const note = await client.note.create({ data: { ownerUserId: user.id, subjectId: subject.id, title: "删除验收知识卡片", content: "SYNTHETIC_PRIVATE_DELETE_BODY" } });
  const bytes = Buffer.from("%PDF-1.4\nSynthetic deletion fixture " + suffix);
  const storedName = randomBytes(16).toString("hex") + ".pdf";
  await writeFile(path.join(fixture.root, "uploads", storedName), bytes, { mode: 0o600, flag: "wx" });
  const attachment = await client.attachment.create({ data: { ownerUserId: user.id, noteId: note.id, originalName: "synthetic.pdf", storedName,
    mimeType: "application/pdf", sizeBytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex"), uri: "upload://attachment/" + storedName, status: "READY" } });
  return { user, session, actor: { id: user.id, sessionId: session.id }, workspace, subject, note, attachment, storedName, bytes };
}
export type DeletionCase = Awaited<ReturnType<typeof seedDeletionCase>>;

export async function createFixtureDeletion(client: PrismaClient, data: DeletionCase, scope: DataDeleteTarget["scope"] = "RESOURCE") {
  const target: DataDeleteTarget = { requesterId: data.user.id, scope, workspaceId: scope === "ACCOUNT" ? null : data.workspace.id,
    resourceType: scope === "RESOURCE" ? "Note" : null, resourceId: scope === "RESOURCE" ? data.note.id : null };
  const plan = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { timeout: 60_000 });
  assert.deepEqual(plan.blockers, []);
  return createDatabaseDeletion(client, { actor: data.actor, target, fingerprint: plan.fingerprint,
    idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") });
}

export async function makeDeletionEligible(client: PrismaClient, id: string) {
  const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id } });
  assert.equal(row.irreversibleAt, null);
  const retention = row.scope === "RESOURCE" ? 30 * 86_400_000 : 86_400_000;
  // 只调整本批合成意图的时间来覆盖边界，不改全局时钟或生产保留策略。
  await client.dataDeletionIntent.update({ where: { id }, data: { frozenAt: new Date(Date.now() - retention - 10_000), availableAt: new Date(Date.now() - 5000) } });
}
