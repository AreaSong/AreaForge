import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "../../packages/db/src/index";
import type { DataDeleteTarget } from "../../packages/core/src/index";
import { previewDatabaseDeletion, createDatabaseDeletion, deleteClock } from "../../packages/db/src/data-delete-intents";
import { createStorageCase, seedStorageFile } from "./storage-quota-runtime-data";
import type { StorageQuotaFixture } from "./storage-quota-fixture";

export const storageDeletionEvidence: object[] = [];
const registered = new Set<string>();
export async function deletionCase(client: PrismaClient, fixture: StorageQuotaFixture, kind: "Note" | "StudyResource" = "Note", secondary = false) {
  const initial = await createStorageCase(client, fixture, "delete-" + kind);
  const data = secondary ? { ...initial, ...initial.secondary } : initial;
  const attachment = await seedStorageFile(client, fixture, data, { noteId: kind === "Note" ? data.note.id : null });
  const resource = kind === "StudyResource" ? await client.studyResource.create({ data: { ownerUserId: data.owner.id,
    workspaceId: data.workspace.id, sourceType: "FILE", stableKey: randomUUID(), title: "STORAGE 合成资料", attachmentId: attachment.id } }) : null;
  const actor = { id: data.owner.id, sessionId: data.owner.sessionId };
  await client.authSession.update({ where: { id: actor.sessionId }, data: { reauthenticatedAt: await deleteClock(client) } });
  const target: DataDeleteTarget = { requesterId: actor.id, scope: "RESOURCE", workspaceId: data.workspace.id,
    resourceType: kind, resourceId: resource?.id ?? data.note.id };
  return { ...data, attachment, actor, target };
}
export type DeletionData = Awaited<ReturnType<typeof deletionCase>>;
export async function freeze(client: PrismaClient, data: DeletionData, target = data.target) {
  const plan = await previewDatabaseDeletion(client, data.actor, target);
  assert.deepEqual(plan.blockers, []);
  const row = await createDatabaseDeletion(client, { actor: data.actor, target, fingerprint: plan.fingerprint,
    idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") });
  registered.add(row.id);
  storageDeletionEvidence.push({ event: "registered", intentId: row.id, attachmentId: data.attachment.id,
    workspaceId: data.workspace.id, scope: target.scope, items: plan.items.map(item => ({ model: item.model, identityHash: item.identityHash })) });
  return row;
}
export async function eligible(client: PrismaClient, id: string) {
  assert.ok(registered.has(id));
  const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id } });
  assert.equal(row.irreversibleAt, null);
  const now = await deleteClock(client); const retention = row.scope === "RESOURCE" ? 30 * 86400000 : 86400000;
  // 沿用 DELETE fixture 的受控到期方式，仅本进程登记的新 intent；不改源/权限/文件/租约。
  await client.dataDeletionIntent.update({ where: { id }, data: { frozenAt: new Date(now.getTime() - retention - 10000), availableAt: new Date(now.getTime() - 5000) } });
  storageDeletionEvidence.push({ event: "fixture-expiry", intentId: id, fields: ["frozenAt", "availableAt"] });
}
export async function fileIdentity(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat(); assert.ok(stat.isFile()); assert.equal(stat.nlink, 1);
    return { dev: stat.dev, ino: stat.ino, size: stat.size, hash: createHash("sha256").update(await handle.readFile()).digest("hex") };
  } finally { await handle.close(); }
}
export function uploadPath(fixture: StorageQuotaFixture, data: DeletionData) { return path.join(fixture.root, "uploads", data.attachment.storedName); }
export async function priorState(client: PrismaClient, fixture: StorageQuotaFixture) {
  const tables = await client.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const rows: Record<string, string[]> = {};
  for (const { name } of tables) {
    if (name === "DataDeletionVisibility") continue; // 全局可见性代次按冻结协议推进，不是业务对象。
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    const values = await client.$queryRaw<Array<{ hash: string }>>(Prisma.sql`SELECT md5(to_jsonb(t)::text) AS hash FROM ${Prisma.raw('"' + name + '"')} t ORDER BY hash`);
    rows[name] = values.map(row => row.hash);
  }
  const files: Record<string, object> = {};
  async function walk(directory: string) {
    for (const name of await readdir(directory)) {
      const full = path.join(directory, name); const stat = await lstat(full);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) await walk(full); else files[path.relative(fixture.root, full)] = await fileIdentity(full);
    }
  }
  await walk(path.join(fixture.root, "uploads")); await walk(path.join(fixture.root, "exports"));
  const visibility = await client.dataDeletionVisibility.findUniqueOrThrow({ where: { id: 1 } });
  return { rows, files, visibility: visibility.revision };
}
export async function assertPriorState(client: PrismaClient, fixture: StorageQuotaFixture, before: Awaited<ReturnType<typeof priorState>>) {
  const after = await priorState(client, fixture);
  assert.ok(after.visibility >= before.visibility);
  for (const [table, rows] of Object.entries(before.rows)) {
    const remaining = [...after.rows[table]!];
    for (const hash of rows) { const index = remaining.indexOf(hash); assert.ok(index >= 0, "prior row changed: " + table); remaining.splice(index, 1); }
  }
  for (const [file, identity] of Object.entries(before.files)) assert.deepEqual(after.files[file], identity, "prior file changed");
  return { visibilityBefore: String(before.visibility), visibilityAfter: String(after.visibility), priorRowsUnchanged: Object.values(before.rows).reduce((sum, rows) => sum + rows.length, 0), priorFilesUnchanged: Object.keys(before.files).length };
}
