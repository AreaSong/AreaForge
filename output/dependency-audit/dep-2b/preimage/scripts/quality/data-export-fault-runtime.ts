import assert from "node:assert/strict";
import { access, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma, claimQueuedDataJob } from "../../packages/db/src/index";
import { exportFileName } from "../../packages/storage/src/index";
import { cancelDataLifecycleJob, createExportDownloadGrant, pauseDataLifecycleJob, redeemExportDownloadGrant, resumeDataLifecycleJob, retryDataLifecycleJob } from "../../apps/web/lib/system/data-lifecycle-service";
import { createDataExportHandler } from "../workers/data-export-handler";
import { createDataExportMaintenance } from "../workers/data-export-maintenance";
import { createFixtureExport, executeFixtureExport, reclaimFixtureArtifact, runFixtureExport } from "./data-export-runtime-actions";
import { seedDataExportFixture } from "./data-export-runtime-fixture";

export async function exportFileFailuresAndReplay() {
  const f = await seedDataExportFixture();
  const bad = Buffer.from(f.fileBytes); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
  await writeFile(f.sourcePath, bad);
  const job = await createFixtureExport(f);
  const failed = await executeFixtureExport(f, job.id);
  assert.equal(failed.row.errorCode, "DATA_EXPORT_ATTACHMENT_MISMATCH"); assert.ok(failed.row.deadLetteredAt);
  assert.deepEqual(await readFile(f.sourcePath), bad, "worker must not repair source bytes");
  assert.equal(await prisma.dataExportPackage.count({ where: { jobId: job.id } }), 0);
  const previous = await prisma.dataExportArtifact.findFirstOrThrow({ where: { jobId: job.id } });
  assert.equal(previous.state, "STAGING");
  await reclaimFixtureArtifact(previous.id);
  assert.equal((await prisma.dataExportArtifact.findUniqueOrThrow({ where: { id: previous.id } })).state, "RECLAIMED");
  // 只有夹具恢复了人为注入的坏输入，应用不执行源附件修复。
  await writeFile(f.sourcePath, f.fileBytes);
  await retryDataLifecycleJob(f.actor, job.id, failed.row.updatedAt.getTime());
  const retried = await executeFixtureExport(f, job.id); assert.equal(retried.result, "SUCCEEDED");
  assert.ok(retried.row.leaseVersion > previous.leaseVersion);
  const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId: job.id } });
  assert.notEqual(pkg.sourceArtifactId, previous.id);
}

export async function exportMissingSymlinkAndLimit() {
  for (const fault of ["missing", "symlink", "limit"] as const) {
    const f = await seedDataExportFixture(); const job = await createFixtureExport(f);
    if (fault !== "limit") await unlink(f.sourcePath);
    if (fault === "symlink") {
      const target = path.join(f.base, `${f.prefix}.outside.txt`); await writeFile(target, "synthetic outside target", { mode: 0o600 });
      await symlink(target, f.sourcePath);
    }
    const result = await executeFixtureExport(f, job.id, createDataExportHandler(prisma, process.env, fault === "limit" ? { maxBytes: 100 } : {}));
    assert.equal(result.result, "FAILED");
    assert.equal(result.row.errorCode, { missing: "DATA_EXPORT_FILE_MISSING", symlink: "DATA_EXPORT_UNSAFE_STORAGE", limit: "DATA_EXPORT_LIMIT_EXCEEDED" }[fault]);
    assert.equal(await prisma.dataExportPackage.count({ where: { jobId: job.id } }), 0);
    await assert.rejects(createExportDownloadGrant(f.actor, job.id));
  }
}

export async function exportPreparedFailureAndDisable() {
  for (const fault of ["disabled", "failure"] as const) {
    const f = await seedDataExportFixture(); const job = await createFixtureExport(f);
    const handler = createDataExportHandler(prisma);
    const result = await executeFixtureExport(f, job.id, { kind: "EXPORT", prepare: async context => {
      const effect = await handler.prepare(context);
      if (fault === "disabled") { process.env.DATA_EXPORT_ENABLED = "false"; return effect; }
      throw new Error("synthetic failure after sealed file");
    } }).finally(() => { process.env.DATA_EXPORT_ENABLED = "true"; });
    assert.equal(result.result, "FAILED");
    const artifact = await prisma.dataExportArtifact.findFirstOrThrow({ where: { jobId: job.id } });
    assert.equal(artifact.state, "STAGING");
    assert.equal(await exists(path.join(f.roots.exportRoot, exportFileName(artifact.objectKey, ".zip"))), true);
    assert.equal(await prisma.dataExportPackage.count({ where: { jobId: job.id } }), 0);
    await reclaimFixtureArtifact(artifact.id);
    assert.equal(await exists(path.join(f.roots.exportRoot, exportFileName(artifact.objectKey, ".zip"))), false);
    assert.deepEqual(await readFile(f.sourcePath), f.fileBytes);
  }
}

export async function exportControlsAndExpiryCleanup() {
  const paused = await seedDataExportFixture(); const job = await createFixtureExport(paused);
  const pause = await pauseDataLifecycleJob(paused.actor, job.id, job.revision); assert.equal(pause.status, "PAUSED");
  assert.equal(await claimQueuedDataJob(prisma, { workerId: "paused", kinds: ["EXPORT"], leaseMs: 30_000, partition: { requestedByUserId: paused.actor.id } }), null);
  await resumeDataLifecycleJob(paused.actor, job.id, pause.revision);
  assert.equal((await executeFixtureExport(paused, job.id)).result, "SUCCEEDED");
  for (const action of ["PAUSE", "CANCEL"] as const) {
    const f = await seedDataExportFixture(); const queued = await createFixtureExport(f); const handler = createDataExportHandler(prisma);
    let controlled = false;
    const result = await executeFixtureExport(f, queued.id, { kind: "EXPORT", prepare: context => handler.prepare({ ...context, heartbeat: async progress => {
      await context.heartbeat(progress);
      if (!controlled && progress === 0.1) {
        controlled = true;
        const row = await prisma.dataJob.findUniqueOrThrow({ where: { id: queued.id } });
        if (action === "PAUSE") await pauseDataLifecycleJob(f.actor, row.id, row.updatedAt.getTime());
        else await cancelDataLifecycleJob(f.actor, row.id, row.updatedAt.getTime());
      }
    } }) });
    assert.equal(result.result, action === "PAUSE" ? "PAUSED" : "CANCELLED");
    assert.equal(await prisma.dataExportPackage.count({ where: { jobId: queued.id } }), 0);
  }
  const f = await seedDataExportFixture(); const complete = await runFixtureExport(f);
  const grant = await createExportDownloadGrant(f.actor, complete.id);
  const response = await redeemExportDownloadGrant(f.actor, grant.token);
  const clientCopy = Buffer.from(await new Response(response.body).arrayBuffer());
  const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId: complete.id } });
  const expiredAt = new Date(Date.now() - 1);
  await prisma.$transaction(async tx => {
    await tx.dataJob.update({ where: { id: complete.id }, data: { expiresAt: expiredAt } });
    await tx.dataExportPackage.update({ where: { id: pkg.id }, data: { expiresAt: expiredAt } });
    await tx.dataExportArtifact.update({ where: { id: pkg.sourceArtifactId! }, data: { expiresAt: expiredAt } });
  });
  const sentinel = path.join(f.roots.exportRoot, `${f.prefix}.keep`); await writeFile(sentinel, "not registered", { mode: 0o600 });
  await assert.rejects(createExportDownloadGrant(f.actor, complete.id));
  process.env.DATA_EXPORT_ENABLED = "false";
  try { await reclaimFixtureArtifact(pkg.sourceArtifactId!); }
  finally { process.env.DATA_EXPORT_ENABLED = "true"; }
  await createDataExportMaintenance(prisma)(true);
  assert.equal((await prisma.dataExportArtifact.findUniqueOrThrow({ where: { id: pkg.sourceArtifactId! } })).state, "RECLAIMED");
  assert.equal(await exists(path.join(f.roots.exportRoot, exportFileName(pkg.objectKey, ".zip"))), false);
  assert.equal(await readFile(sentinel, "utf8"), "not registered"); assert.deepEqual(await readFile(f.sourcePath), f.fileBytes);
  assert.ok(clientCopy.length > 0, "server reclamation cannot recall an already delivered client copy");
}

async function exists(file: string) { return access(file).then(() => true, () => false); }
