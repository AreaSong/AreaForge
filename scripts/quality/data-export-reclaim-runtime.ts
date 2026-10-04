import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../packages/db/src/index";
import { exportFileName } from "../../packages/storage/src/index";
import { createDataExportMaintenance } from "../workers/data-export-maintenance";
import { createFixtureExport } from "./data-export-runtime-actions";
import { seedDataExportFixture } from "./data-export-runtime-fixture";

export async function exportReclaimFailureFairness() {
  const f = await seedDataExportFixture(); const artifacts: Array<{ id: string; key: string }> = [];
  for (let index = 0; index < 21; index += 1) {
    const job = await createFixtureExport(f, "ACCOUNT", `reclaim-${index}`);
    const objectKey = `export-${randomUUID()}`;
    const artifact = await prisma.dataExportArtifact.create({ data: { jobId: job.id, leaseVersion: 1, objectKey,
      expiresAt: new Date(Date.now() - 1_000), updatedAt: new Date(index * 1_000) } });
    const file = path.join(f.roots.exportRoot, exportFileName(objectKey, ".zip"));
    if (index < 20) await symlink(f.sourcePath, file);
    else await writeFile(file, "synthetic reclaimable copy", { flag: "wx", mode: 0o600 });
    artifacts.push({ id: artifact.id, key: objectKey });
  }
  assert.equal((await createDataExportMaintenance(prisma)(true)).failures, 20);
  // 重新构造维护器模拟进程重启，轮转依据必须已持久化，不能只靠内存游标。
  await createDataExportMaintenance(prisma)(true);
  const last = artifacts[20]!;
  assert.equal((await prisma.dataExportArtifact.findUniqueOrThrow({ where: { id: last.id } })).state, "RECLAIMED");
  await assert.rejects(access(path.join(f.roots.exportRoot, exportFileName(last.key, ".zip"))));
  assert.deepEqual(await readFile(f.sourcePath), f.fileBytes);
  // 人为注入的软链接保留作负向证据，不让应用删除未通过文件形状检查的目标。
  for (const artifact of artifacts.slice(0, 20)) assert.equal((await prisma.dataExportArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).state, "RECLAIMING");
}
