import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DataDeleteError, hashDataExportValue } from "../../packages/core/src/index";
import { createPrismaClient, type PrismaClient, type Prisma } from "../../packages/db/src/index";
import { claimDatabaseDeletion, lockedDeleteLease, renewDeleteLease, assertDeleteLease, failDatabaseDeletion, type DataDeleteLease } from "../../packages/db/src/data-delete-lease";
import { commitDatabaseDeletion, verifyFrozenDeletePlan, deletionTarget, type DeletePlanVerifier } from "../../packages/db/src/data-delete-commit";
import { readDeleteAuthorization } from "../../packages/db/src/data-delete-plan";
import { deleteClock, requireDataDeleteEnabled } from "../../packages/db/src/data-delete-intents";
import { inspectDeletionFile, removeDeletionFile, DataDeleteStorageError, type DeletionFileDescriptor, type DeletionFileRoots } from "../../packages/storage/src/data-delete-files";

export interface DataDeleteHooks { afterIntent?: () => Promise<void>; afterFileIntent?: () => Promise<void>; afterUnlink?: () => Promise<void>; afterSql?: () => Promise<void>; beforeCommit?: () => Promise<void> }
export interface DataDeleteAuthority { verifyPlan: DeletePlanVerifier; beforeFile: (...args: Parameters<DeletePlanVerifier>) => Promise<unknown>; signal?: AbortSignal }
const normalAuthority: DataDeleteAuthority = { verifyPlan: verifyFrozenDeletePlan, beforeFile: async (tx, row) => {
  if (await readDeleteAuthorization(tx, deletionTarget(row), true) !== row.authorizationHash) throw new DataDeleteError("DATA_DELETE_AUTHORIZATION_CHANGED");
} };

export async function executeDatabaseDeletion(client: PrismaClient, lease: DataDeleteLease, roots: DeletionFileRoots, hooks: DataDeleteHooks = {}, authority: DataDeleteAuthority = normalAuthority) {
  try {
    checkRunning(authority);
    await prepareDeletionFiles(client, lease, roots, authority.verifyPlan);
    await hooks.afterIntent?.();
    const files = await client.dataDeletionFile.findMany({ where: { intentId: lease.intentId }, orderBy: { identityHash: "asc" } });
    for (const file of files) {
      if (file.phase === "REMOVED") continue;
      checkRunning(authority);
      await client.$transaction(async tx => {
        const row = await lockedDeleteLease(tx, lease); await renewDeleteLease(tx, row);
        await tx.dataDeletionFile.update({ where: { id: file.id }, data: { phase: "INTENT" } });
      });
      await hooks.afterFileIntent?.();
      await client.$transaction(async tx => {
        const row = await lockedDeleteLease(tx, lease);
        checkRunning(authority);
        await authority.beforeFile(tx, row);
        await removeDeletionFile(roots, descriptor(file), { intentDurable: true, afterUnlink: hooks.afterUnlink });
        checkRunning(authority);
        assertDeleteLease(row, lease, await deleteClock(tx));
        await tx.dataDeletionFile.update({ where: { id: file.id }, data: { phase: "REMOVED" } });
      }, { timeout: 60_000 });
    }
    checkRunning(authority);
    return await commitDatabaseDeletion(client, lease, hooks.afterSql, authority.verifyPlan, hooks.beforeCommit);
  } catch (error) {
    const failure = error instanceof DataDeleteStorageError ? new DataDeleteError(error.code) : error;
    return { intentId: lease.intentId, state: await failDatabaseDeletion(client, lease, failure) };
  }
}

async function prepareDeletionFiles(client: PrismaClient, lease: DataDeleteLease, roots: DeletionFileRoots, verifyPlan: DeletePlanVerifier) {
  await client.$transaction(async tx => {
    const initial = await lockedDeleteLease(tx, lease);
    const row = await renewDeleteLease(tx, initial);
    const plan = await verifyPlan(tx, row);
    if (row.irreversibleAt) return;
    const candidates = await deletionFileCandidates(tx, plan.items);
    for (const candidate of candidates) {
      const info = await inspectDeletionFile(roots, candidate.file, candidate.allowMissing);
      await tx.dataDeletionFile.create({ data: { intentId: row.id,
        identityHash: hashDataExportValue({ kind: candidate.file.storageKind, key: candidate.file.storageKey }),
        storageKind: candidate.file.storageKind, storageKey: candidate.file.storageKey, expectedHash: info?.sha256 ?? null,
        expectedSize: info ? BigInt(info.size) : null, phase: info ? "PENDING" : "REMOVED" } });
    }
    assertDeleteLease(row, lease, await deleteClock(tx));
    await tx.dataDeletionIntent.update({ where: { id: row.id }, data: { irreversibleAt: await deleteClock(tx), revision: { increment: 1 } } });
  }, { timeout: 60_000 });
}

async function deletionFileCandidates(tx: Prisma.TransactionClient, items: readonly { model: string; key: Record<string, string> }[]) {
  const result: Array<{ file: DeletionFileDescriptor; allowMissing: boolean }> = [];
  for (const item of items) {
    if (item.model === "Attachment") {
      const row = await tx.attachment.findUniqueOrThrow({ where: { id: item.key.id! } });
      if (row.status !== "READY" || row.uri !== "upload://attachment/" + row.storedName) throw new DataDeleteError("DATA_DELETE_ATTACHMENT_UNSETTLED");
      result.push({ file: { storageKind: "UPLOAD", storageKey: row.storedName, expectedHash: row.hash, expectedSize: row.sizeBytes }, allowMissing: false });
    }
    if (item.model === "DataExportArtifact") {
      const row = await tx.dataExportArtifact.findUniqueOrThrow({ where: { id: item.key.id! }, include: { exportPackage: true } });
      for (const suffix of [".zip.part", ".central", ".manifest", ".zip"]) {
        const published = suffix === ".zip" && row.state === "PUBLISHED";
        if (published && !row.exportPackage) throw new DataDeleteError("DATA_DELETE_EXPORT_UNSETTLED");
        result.push({ file: { storageKind: "EXPORT", storageKey: row.objectKey + suffix,
          expectedHash: published ? row.exportPackage!.archiveSha256 : null, expectedSize: published ? Number(row.exportPackage!.sizeBytes) : null }, allowMissing: !published });
      }
    }
  }
  return result;
}

function descriptor(row: { storageKind: string; storageKey: string | null; expectedHash: string | null; expectedSize: bigint | null }): DeletionFileDescriptor {
  if (!row.storageKey || !["UPLOAD", "EXPORT"].includes(row.storageKind)) throw new DataDeleteError("DATA_DELETE_FILE_IDENTITY_INVALID");
  return { storageKind: row.storageKind as DeletionFileDescriptor["storageKind"], storageKey: row.storageKey,
    expectedHash: row.expectedHash, expectedSize: row.expectedSize === null ? null : Number(row.expectedSize) };
}

export async function runDatabaseDeleteWorker(input: { client: PrismaClient; roots: DeletionFileRoots; signal: AbortSignal; once?: boolean; workerId?: string }) {
  requireDataDeleteEnabled();
  const workerId = input.workerId ?? "delete-" + randomUUID();
  let processed = 0;
  while (!input.signal.aborted) {
    requireDataDeleteEnabled();
    const lease = await claimDatabaseDeletion(input.client, workerId);
    if (lease) { await executeDatabaseDeletion(input.client, lease, input.roots, {}, { ...normalAuthority, signal: input.signal }); processed++; }
    if (input.once) break;
    await delay(1000, undefined, { signal: input.signal }).catch(error => { if (!input.signal.aborted) throw error; });
  }
  return { processed };
}

async function main() {
  requireDataDeleteEnabled();
  if (process.env.DATA_DELETE_WORKER_ENABLED !== "true" || process.argv.slice(2).length > 1 || process.argv.slice(2).some(arg => arg !== "--once")
    || !process.env.UPLOAD_DIR || !process.env.EXPORT_DIR) throw new DataDeleteError("DATA_DELETE_WORKER_DISABLED");
  const client = createPrismaClient(); const controller = new AbortController();
  process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
  try { console.log(JSON.stringify(await runDatabaseDeleteWorker({ client, roots: { uploadRoot: process.env.UPLOAD_DIR, exportRoot: process.env.EXPORT_DIR },
    signal: controller.signal, once: process.argv.includes("--once") }))); }
  finally { await client.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("DATA_DELETE_WORKER_FAILED"); process.exitCode = 1; });

function checkRunning(authority: DataDeleteAuthority) {
  requireDataDeleteEnabled();
  if (authority.signal?.aborted) throw new DataDeleteError("DATA_DELETE_WORKER_STOPPED", true);
}
