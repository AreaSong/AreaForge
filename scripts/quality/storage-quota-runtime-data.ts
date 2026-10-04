import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import type { BoundedFileScan } from "../../packages/storage/src/index";
import { createAdmissionActor } from "./admission-runtime-fixture";
import type { StorageQuotaFixture } from "./storage-quota-fixture";
import { createNoteAttachment } from "../../apps/web/lib/study/attachments-service";

export const storagePdfBytes = Buffer.from("%PDF-1.4\n%STORAGE-QUOTA-SYNTHETIC\n1 0 obj <<>> endobj\n%%EOF\n");
export function storageScan(originalName = "storage-proof.pdf"): BoundedFileScan {
  return { originalName, declaredMimeType: "application/pdf", detectedMimeType: "application/pdf",
    bytes: storagePdfBytes, sizeBytes: storagePdfBytes.length, sha256Hex: createHash("sha256").update(storagePdfBytes).digest("hex") };
}
export async function createStorageCase(client: PrismaClient, fixture: StorageQuotaFixture, label: string, passwordHash = "synthetic-not-login") {
  assert.match(fixture.databaseName, /^areaforge_v20_storage_[a-f0-9]{12}$/);
  const [database] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database?.name, fixture.databaseName);
  const prefix = "storage-" + label + "-" + randomBytes(4).toString("hex");
  const owner = await createAdmissionActor(client, prefix + "-owner@example.test", passwordHash);
  const member = await createAdmissionActor(client, prefix + "-member@example.test", passwordHash);
  const outsider = await createAdmissionActor(client, prefix + "-other@example.test", passwordHash);
  const makeWorkspace = async (name: string, members: CurrentUser[]) => {
    const workspace = await client.examWorkspace.create({ data: { userId: owner.id, stableKey: prefix + name, name: "存储配额合成空间" + name,
      memberships: { create: [owner, ...members].map(user => ({ userId: user.id, role: user.id === owner.id ? "OWNER" as const : "MEMBER" as const })) } } });
    const subject = await client.subject.create({ data: { workspaceId: workspace.id, stableKey: prefix + name, name: "存储合成科目", color: "#0f766e" } });
    const note = await client.note.create({ data: { subjectId: subject.id, ownerUserId: owner.id, title: "存储配额合成笔记", content: "SYNTHETIC_STORAGE_CONTENT" } });
    return { workspace, subject, note };
  };
  const main = await makeWorkspace("一", [member]); const secondary = await makeWorkspace("二", []);
  const memberNote = await client.note.create({ data: { subjectId: main.subject.id, ownerUserId: member.id, title: "成员合成笔记", content: "SYNTHETIC_MEMBER_CONTENT" } });
  for (const user of [owner, member]) await client.workspaceSelection.create({ data: { userId: user.id, workspaceId: main.workspace.id } });
  return { prefix, owner, member, outsider, ...main, memberNote, secondary };
}
export type StorageCase = Awaited<ReturnType<typeof createStorageCase>>;
export async function seedStorageFile(client: PrismaClient, fixture: StorageQuotaFixture, data: StorageCase,
  options: { actor?: CurrentUser; noteId?: string | null; legacy?: boolean } = {}) {
  const actor = options.actor ?? data.owner; const storedName = randomBytes(16).toString("hex") + ".pdf";
  const row = await client.attachment.create({ data: { ownerUserId: actor.id, noteId: options.noteId === undefined ? data.note.id : options.noteId,
    originalName: "synthetic-existing.pdf", storedName, uri: "upload://attachment/" + storedName, mimeType: "application/pdf",
    hash: storageScan().sha256Hex, sizeBytes: storagePdfBytes.length, status: "READY", protocolVersion: options.legacy ? 0 : 1,
    storageWorkspaceId: options.legacy ? null : data.workspace.id } });
  await writeFile(path.join(fixture.root, "uploads", storedName), storagePdfBytes, { flag: "wx", mode: 0o600 });
  return row;
}
export function uploadStorageNote(data: StorageCase, key = randomUUID(), actor = data.owner, noteId = data.note.id) {
  return createNoteAttachment({ noteId, idempotencyKey: key, scan: storageScan() }, actor.id);
}
export async function withStoragePolicy<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(patch).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return await run(); }
  finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
export async function storageUsedBytes(client: PrismaClient, workspaceId: string) {
  const [row] = await client.$queryRaw<Array<{ used: bigint }>>`SELECT COALESCE(SUM("sizeBytes"),0)::bigint AS used
    FROM "Attachment" WHERE "storageWorkspaceId"=${workspaceId} AND "storageReleasedAt" IS NULL`;
  return row!.used;
}
export function storageErrorCode(error: unknown): string {
  const row = error as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } };
  return String(row?.meta?.code ?? row?.meta?.driverAdapterError?.cause?.originalCode ?? row?.code ?? "");
}
export async function retryStorageRequest<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await run(); }
    catch (error) {
      if (!["WORKSPACE_STORAGE_QUOTA_BUSY", "P2034", "40001", "55P03"].includes(storageErrorCode(error)) || attempt === 29) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 + attempt * 3));
    }
  }
  throw new Error("STORAGE_RETRY_EXHAUSTED");
}
