import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createPrismaClient } from "../../packages/db/src/index";
import { createDataJobHandlers, enabledDataJobKinds } from "./data-job-handlers";
import { runDataJobWorker } from "./data-job-runner";
import { createDataExportMaintenance } from "./data-export-maintenance";

export async function runConfiguredDataJobWorker(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = parseDataJobWorkerArguments(args);
  if (env.DATA_JOB_WORKER_ENABLED !== "true") throw new Error("DATA_JOB_WORKER_DISABLED");
  const kinds = options.reclaimExports ? [] : enabledDataJobKinds(env);
  if (!options.reclaimExports && !kinds.length) throw new Error("DATA_JOB_HANDLERS_REQUIRED");
  if (!env.DATABASE_URL) throw new Error("DATA_JOB_DATABASE_REQUIRED");
  if (options.reclaimExports && (!env.EXPORT_DIR || !env.UPLOAD_DIR)) throw new Error("DATA_EXPORT_STORAGE_CONFIG_REQUIRED");
  const client = createPrismaClient(env.DATABASE_URL);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    if (options.reclaimExports) {
      // 显式维护入口在停止新导出后仍可回收已登记副本，不注册或消费任何任务处理器。
      const result = await createDataExportMaintenance(client, env)(true);
      process.stdout.write(`${JSON.stringify({ event: "data-export-reclaim", ...result })}\n`);
      if (result.failures) throw new Error("DATA_EXPORT_RECLAIM_INCOMPLETE");
      return;
    }
    const handlers = createDataJobHandlers(env, client);
    const maintain = createDataExportMaintenance(client, env);
    await runDataJobWorker({ enabled: true, client, workerId: `data-worker-${randomUUID()}`, handlers,
      signal: controller.signal, once: options.once, partition: options.workspaceId ? { workspaceId: options.workspaceId } : undefined,
      beforePoll: kinds.includes("EXPORT") ? async () => {
        const result = await maintain();
        if (result.reclaimed || result.failures) process.stdout.write(`${JSON.stringify({ event: "data-export-reclaim", ...result })}\n`);
      } : undefined,
      onResult: result => process.stdout.write(`${JSON.stringify({ event: "data-job-result", result })}\n`),
    });
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    await client.$disconnect();
  }
}

export function parseDataJobWorkerArguments(args: readonly string[]) {
  const workspaces = args.filter(arg => arg.startsWith("--workspace="));
  const reclaimExports = args.includes("--reclaim-exports");
  if ((reclaimExports && args.length !== 1) || args.filter(arg => arg === "--once").length > 1 || workspaces.length > 1
    || args.some(arg => arg !== "--once" && arg !== "--reclaim-exports" && !arg.startsWith("--workspace="))) throw new Error("DATA_JOB_WORKER_ARGUMENT_INVALID");
  const workspaceId = workspaces[0]?.slice("--workspace=".length);
  if (workspaceId !== undefined && !/^[A-Za-z0-9_-]{1,120}$/.test(workspaceId)) throw new Error("DATA_JOB_WORKER_ARGUMENT_INVALID");
  return { once: args.includes("--once"), workspaceId, reclaimExports };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConfiguredDataJobWorker(process.argv.slice(2)).catch(() => {
    // 外部 DB/驱动异常可能带连接串或正文，不直接输出异常对象。
    process.stderr.write("DATA_JOB_WORKER_STOPPED_WITH_ERROR\n"); process.exitCode = 1;
  });
}
