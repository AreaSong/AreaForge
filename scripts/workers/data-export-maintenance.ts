import { beginDataExportReclaim, finishDataExportReclaim, listReclaimableDataExports, listReclaimedDataExports, type DataQueueClient } from "../../packages/db/src/index";
import { dataExportStorageRoots, removeRegisteredExportFiles, DataExportStorageError } from "../../packages/storage/src/index";

export function createDataExportMaintenance(client: DataQueueClient, env: Readonly<Record<string, string | undefined>> = process.env) {
  let afterId: string | undefined; let lastSweep = 0;
  return async (force = false): Promise<{ reclaimed: number; failures: number }> => {
    if (!env.EXPORT_DIR || !env.UPLOAD_DIR || (!force && Date.now() - lastSweep < 60_000)) return { reclaimed: 0, failures: 0 };
    lastSweep = Date.now();
    const roots = await dataExportStorageRoots(env.EXPORT_DIR, env.UPLOAD_DIR);
    const candidates = await listReclaimableDataExports(client);
    // 已回收记录也轮转核对，回收在晚到 writer 后仍可再次清除同一登记 key，绝不扫描目录前缀。
    const previous = await listReclaimedDataExports(client, afterId);
    afterId = previous.length === 5 ? previous[previous.length - 1]!.id : undefined;
    let reclaimed = 0; let failures = 0;
    for (const id of [...new Set([...candidates, ...previous.map(row => row.id)])]) {
      const artifact = await beginDataExportReclaim(client, id);
      if (!artifact) continue;
      try {
        const removed = await removeRegisteredExportFiles(roots, artifact.objectKey);
        if (!artifact.alreadyReclaimed || removed) await finishDataExportReclaim(client, id);
        if (removed || !artifact.alreadyReclaimed) reclaimed += 1;
      } catch (error) {
        failures += 1;
        await finishDataExportReclaim(client, id, error instanceof DataExportStorageError ? error.code : "DATA_EXPORT_RECLAIM_FAILED");
      }
    }
    return { reclaimed, failures };
  };
}
