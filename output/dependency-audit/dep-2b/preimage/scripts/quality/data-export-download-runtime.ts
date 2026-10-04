import assert from "node:assert/strict";
import { readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma, consumeDataExportDownload, reserveDataExportDownload } from "../../packages/db/src/index";
import { exportFileName } from "../../packages/storage/src/index";
import { createExportDownloadGrant, redeemExportDownloadGrant, revokeExportDownloadGrants } from "../../apps/web/lib/system/data-lifecycle-service";
import { runFixtureExport } from "./data-export-runtime-actions";
import { seedDataExportFixture } from "./data-export-runtime-fixture";

export async function exportDownloadOpenFailures() {
  const f = await seedDataExportFixture(); const job = await runFixtureExport(f);
  const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId: job.id } });
  const archive = path.join(f.roots.exportRoot, exportFileName(pkg.objectKey, ".zip"));
  const backup = path.join(f.base, `${f.prefix}.download-fault-original`);
  for (const fault of ["missing", "corrupt", "symlink"] as const) {
    const grant = await createExportDownloadGrant(f.actor, job.id);
    await rename(archive, backup);
    try {
      if (fault === "corrupt") { const content = await readFile(backup); content[0] = content[0]! ^ 1; await writeFile(archive, content, { flag: "wx", mode: 0o600 }); }
      if (fault === "symlink") await symlink(f.sourcePath, archive);
      await assert.rejects(redeemExportDownloadGrant(f.actor, grant.token));
      const failed = await prisma.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: grant.id } });
      assert.equal(failed.consumedAt, null); assert.equal(failed.reservationId, null);
    } finally {
      if (fault !== "missing") await unlink(archive);
      await rename(backup, archive);
    }
    const retried = await redeemExportDownloadGrant(f.actor, grant.token);
    assert.equal((await new Response(retried.body).arrayBuffer()).byteLength, Number(pkg.sizeBytes));
  }
  const grant = await createExportDownloadGrant(f.actor, job.id); const controller = new AbortController(); controller.abort();
  await assert.rejects(redeemExportDownloadGrant(f.actor, grant.token, controller.signal));
  assert.equal((await prisma.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt, null);
  const response = await redeemExportDownloadGrant(f.actor, grant.token); await response.body.cancel();
  await assert.rejects(redeemExportDownloadGrant(f.actor, grant.token), "a cancelled started download does not revive its one-time grant");
}

export async function exportDownloadReservationFencing() {
  const f = await seedDataExportFixture(); const job = await runFixtureExport(f);
  const actor = { requesterId: f.actor.id, sessionId: f.actor.sessionId };
  const grant = await createExportDownloadGrant(f.actor, job.id);
  const reserved = await reserveDataExportDownload(prisma, actor, grant.token);
  await revokeExportDownloadGrants(f.actor, job.id);
  await assert.rejects(consumeDataExportDownload(prisma, actor, reserved));
  assert.equal((await prisma.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt, null);
  const replacement = await createExportDownloadGrant(f.actor, job.id);
  const old = await reserveDataExportDownload(prisma, actor, replacement.token);
  await prisma.dataExportDownloadGrant.update({ where: { id: replacement.id }, data: {
    reservedAt: new Date(Date.now() - 2_000), reservationExpiresAt: new Date(Date.now() - 1_000),
  } });
  const fresh = await reserveDataExportDownload(prisma, actor, replacement.token);
  assert.notEqual(fresh.reservationId, old.reservationId);
  await assert.rejects(consumeDataExportDownload(prisma, actor, old));
  const race = await Promise.allSettled([consumeDataExportDownload(prisma, actor, fresh), revokeExportDownloadGrants(f.actor, job.id)]);
  const after = await prisma.dataExportDownloadGrant.findUniqueOrThrow({ where: { id: replacement.id } });
  assert.ok(after.consumedAt || after.revokedAt);
  assert.equal(Boolean(after.consumedAt), race[0]!.status === "fulfilled");
  await assert.rejects(consumeDataExportDownload(prisma, actor, fresh));
}
