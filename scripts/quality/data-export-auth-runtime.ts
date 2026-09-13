import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { exportFileName } from "../../packages/storage/src/index";
import { prisma, beginDataExportArtifact, claimQueuedDataJob, commitQueuedDataJob, failQueuedDataJob, publishDataExportPackage, requirePublishedDataExport } from "../../packages/db/src/index";
import { claimDataLifecycleJob, createExportDownloadGrant, getDataLifecycleJob, redeemExportDownloadGrant, requestDataLifecycleJob, revokeExportDownloadGrants } from "../../apps/web/lib/system/data-lifecycle-service";
import { seedDataExportFixture } from "./data-export-runtime-fixture";
import { createFixtureExport, executeFixtureExport, runFixtureExport } from "./data-export-runtime-actions";

export async function exportRequestIdentityAndProtocol() {
  const f = await seedDataExportFixture();
  const jobs = await Promise.all(Array.from({ length: 4 }, () => createFixtureExport(f)));
  assert.equal(new Set(jobs.map(job => job.id)).size, 1);
  assert.equal(await prisma.dataJob.count({ where: { requestedByUserId: f.actor.id } }), 1);
  await assert.rejects(getDataLifecycleJob(f.otherActor, jobs[0]!.id), { code: "DATA_JOB_NOT_FOUND" });
  await assert.rejects(requestDataLifecycleJob(f.actor, { kind: "EXPORT", scope: "WORKSPACE", workspaceId: f.foreign.id, idempotencyKey: `${f.prefix}-foreign` }), { code: "DATA_EXPORT_AUTHORIZATION_CHANGED" });
  await assert.rejects(claimDataLifecycleJob({ jobId: jobs[0]!.id, workerId: "legacy-fixture", leaseExpiresAt: new Date(Date.now() + 30_000) }), { code: "DATA_JOB_WORKER_PROTOCOL_MISMATCH" });
  const job = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobs[0]!.id } });
  await prisma.dataJob.update({ where: { id: job.id }, data: { resultJson: { ...(job.resultJson as object), forged: true } } });
  const failed = await executeFixtureExport(f, job.id);
  assert.equal(failed.row.errorCode, "DATA_EXPORT_PAYLOAD_INVALID");
  assert.ok(failed.row.deadLetteredAt);
  assert.equal(await prisma.dataExportArtifact.count({ where: { jobId: job.id } }), 0);
}

export async function exportDownloadCapabilities() {
  const f = await seedDataExportFixture(); const job = await runFixtureExport(f);
  await assert.rejects(createExportDownloadGrant(f.otherActor, job.id), { code: "DATA_EXPORT_DOWNLOAD_NOT_FOUND" });
  const grant = await createExportDownloadGrant(f.actor, job.id);
  await assert.rejects(redeemExportDownloadGrant(f.otherActor, grant.token));
  assert.equal((await prisma.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt, null);
  const concurrent = await Promise.allSettled([redeemExportDownloadGrant(f.actor, grant.token), redeemExportDownloadGrant(f.actor, grant.token)]);
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  for (const result of concurrent) if (result.status === "fulfilled") await new Response(result.value.body).arrayBuffer();
  const once = await prisma.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: grant.id } });
  assert.ok(once.consumedAt); assert.equal(once.reservationId, null);
  const revoked = await createExportDownloadGrant(f.actor, job.id);
  await revokeExportDownloadGrants(f.actor, job.id); await assert.rejects(redeemExportDownloadGrant(f.actor, revoked.token));
  const expired = await createExportDownloadGrant(f.actor, job.id);
  await prisma.dataExportDownloadGrant.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(redeemExportDownloadGrant(f.actor, expired.token));
  const sessionGrant = await createExportDownloadGrant(f.actor, job.id);
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } });
  await assert.rejects(redeemExportDownloadGrant(f.actor, sessionGrant.token));
  assert.equal((await prisma.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: sessionGrant.id } })).consumedAt, null);
}

export async function exportEpochAndSwitches() {
  const f = await seedDataExportFixture(); const job = await runFixtureExport(f, "WORKSPACE");
  for (const flag of ["DATA_EXPORT_ENABLED", "DATA_LIFECYCLE_ENABLED"]) {
    process.env[flag] = "false";
    try { await assert.rejects(prisma.$transaction(tx => requirePublishedDataExport(tx, job.id, f.actor.id)), { code: "DATA_EXPORT_DISABLED" }); }
    finally { process.env[flag] = "true"; }
  }
  const grant = await createExportDownloadGrant(f.actor, job.id);
  await prisma.examWorkspace.update({ where: { id: f.workspace.id }, data: { revision: { increment: 1 } } });
  assert.equal((await getDataLifecycleJob(f.actor, job.id)).downloadable, false);
  await assert.rejects(redeemExportDownloadGrant(f.actor, grant.token), { code: "DATA_EXPORT_AUTHORIZATION_CHANGED" });
  const g = await seedDataExportFixture(); const queued = await createFixtureExport(g);
  await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: g.foreign.id, userId: g.actor.id } }, data: { status: "ACTIVE", revision: { increment: 1 } } });
  await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: g.foreign.id, userId: g.actor.id } }, data: { status: "LEFT", revision: { increment: 1 } } });
  assert.equal((await executeFixtureExport(g, queued.id)).row.errorCode, "DATA_EXPORT_AUTHORIZATION_CHANGED");
  assert.equal(await prisma.dataExportPackage.count({ where: { jobId: queued.id } }), 0);
  await verifyExportOwnerTransfer();
  const suspended = await seedDataExportFixture(); const beforeFreeze = await createFixtureExport(suspended);
  await prisma.user.update({ where: { id: suspended.actor.id }, data: { status: "SUSPENDED", authRevision: { increment: 1 } } });
  await prisma.user.update({ where: { id: suspended.actor.id }, data: { status: "ACTIVE", authRevision: { increment: 1 } } });
  assert.equal((await executeFixtureExport(suspended, beforeFreeze.id)).row.errorCode, "DATA_EXPORT_AUTHORIZATION_CHANGED");
}

async function verifyExportOwnerTransfer() {
  const f = await seedDataExportFixture(); const job = await createFixtureExport(f, "WORKSPACE");
  await prisma.$transaction(async tx => {
    await tx.examWorkspace.update({ where: { id: f.workspace.id }, data: { userId: f.other.id, revision: { increment: 1 } } });
    await tx.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: f.workspace.id, userId: f.actor.id } }, data: { role: "MEMBER", revision: { increment: 1 } } });
    await tx.workspaceMembership.create({ data: { workspaceId: f.workspace.id, userId: f.other.id, role: "OWNER" } });
  });
  assert.equal((await executeFixtureExport(f, job.id)).row.errorCode, "DATA_EXPORT_AUTHORIZATION_CHANGED");
  await assert.rejects(requestDataLifecycleJob(f.actor, { kind: "EXPORT", scope: "WORKSPACE", workspaceId: f.workspace.id, idempotencyKey: `${f.prefix}-after-transfer` }), { code: "DATA_EXPORT_AUTHORIZATION_CHANGED" });
  await prisma.note.create({ data: { ownerUserId: f.other.id, subjectId: f.subject.id, title: "新 Owner 本人笔记", content: "NEW_OWNER_ONLY" } });
  const transferred = await runFixtureExport({ ...f, actor: f.otherActor }, "WORKSPACE");
  const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId: transferred.id } });
  const bytes = await readFile(path.join(f.roots.exportRoot, exportFileName(pkg.objectKey, ".zip")));
  assert.equal(bytes.includes(Buffer.from("OWN_NOTE_BODY")), false, "new Workspace owner must not export previous owner's private notes");
  assert.equal(bytes.includes(Buffer.from("NEW_OWNER_ONLY")), true);
  assert.equal(pkg.attachmentCount, 0);
}

export async function exportReceiptAdmission() {
  const f = await seedDataExportFixture(); const job = await createFixtureExport(f);
  const lease = await claimQueuedDataJob(prisma, { workerId: "receipt-fixture", kinds: ["EXPORT"], leaseMs: 30_000, partition: { requestedByUserId: f.actor.id } }); assert.ok(lease);
  const prepared = await beginDataExportArtifact(prisma, lease);
  const good = { sizeBytes: 100, sha256: "sha256:" + "a".repeat(64), manifestSha256: "sha256:" + "b".repeat(64), recordCount: 1, attachmentCount: 0, omittedFieldCount: 0, snapshotAt: new Date().toISOString() };
  for (const receipt of [{ ...good, recordCount: 100_001 }, { ...good, attachmentCount: 2 }, { ...good, snapshotAt: "2999-01-01T00:00:00.000Z" }, { ...good, snapshotAt: "2026-09-13" }]) {
    await assert.rejects(commitQueuedDataJob(prisma, { lease, effect: (tx, row) => publishDataExportPackage(tx, row, { artifactId: prepared.artifact.id, leaseVersion: lease.leaseVersion, receipt }) }), { code: "DATA_EXPORT_RECEIPT_INVALID" });
  }
  assert.equal(await prisma.dataExportPackage.count({ where: { jobId: job.id } }), 0);
  assert.equal((await prisma.dataExportArtifact.findUniqueOrThrow({ where: { id: prepared.artifact.id } })).state, "STAGING");
  await failQueuedDataJob(prisma, { lease, errorCode: "DATA_EXPORT_RECEIPT_INVALID", retryable: false });
  const legacy = await prisma.dataJob.create({ data: { kind: "EXPORT", scope: "ACCOUNT", requestedByUserId: f.actor.id, status: "SUCCEEDED", queueVersion: 0, idempotencyKey: randomUUID(), requestFingerprint: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
  await assert.rejects(createExportDownloadGrant(f.actor, legacy.id));
}
