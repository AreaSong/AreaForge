import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createPrismaClient } from "../../packages/db/src/index";
import { createDataJobHandlers } from "./data-job-handlers";
import { runDataJobWorker } from "./data-job-runner";

export async function runConfiguredDataJobWorker(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = parseDataJobWorkerArguments(args);
  if (env.DATA_JOB_WORKER_ENABLED !== "true") throw new Error("DATA_JOB_WORKER_DISABLED");
  const handlers = createDataJobHandlers(env);
  if (!handlers.length) throw new Error("DATA_JOB_HANDLERS_REQUIRED");
  if (!env.DATABASE_URL) throw new Error("DATA_JOB_DATABASE_REQUIRED");
  const client = createPrismaClient(env.DATABASE_URL);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runDataJobWorker({ enabled: true, client, workerId: `data-worker-${randomUUID()}`, handlers,
      signal: controller.signal, once: options.once, partition: options.workspaceId ? { workspaceId: options.workspaceId } : undefined,
      onResult: result => process.stdout.write(`${JSON.stringify({ event: "data-job-result", result })}\n`),
    });
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    await client.$disconnect();
  }
}

export function parseDataJobWorkerArguments(args: readonly string[]) {
  const workspaces = args.filter(arg => arg.startsWith("--workspace="));
  if (args.filter(arg => arg === "--once").length > 1 || workspaces.length > 1
    || args.some(arg => arg !== "--once" && !arg.startsWith("--workspace="))) throw new Error("DATA_JOB_WORKER_ARGUMENT_INVALID");
  const workspaceId = workspaces[0]?.slice("--workspace=".length);
  if (workspaceId !== undefined && !/^[A-Za-z0-9_-]{1,120}$/.test(workspaceId)) throw new Error("DATA_JOB_WORKER_ARGUMENT_INVALID");
  return { once: args.includes("--once"), workspaceId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConfiguredDataJobWorker(process.argv.slice(2)).catch(() => {
    // 外部 DB/驱动异常可能带连接串或正文，不直接输出异常对象。
    process.stderr.write("DATA_JOB_WORKER_STOPPED_WITH_ERROR\n"); process.exitCode = 1;
  });
}
