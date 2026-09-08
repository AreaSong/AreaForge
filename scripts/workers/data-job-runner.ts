import { setTimeout as delay } from "node:timers/promises";
import { validateDataJobLeaseDuration } from "../../packages/core/src/index";
import { claimQueuedDataJob, recoverQueuedDataJobs, type DataJobPartition, type DataQueueClient } from "../../packages/db/src/index";
import type { DataJobHandler } from "./data-job-handler";
import { executeDataJob, type DataJobExecutionResult } from "./data-job-execution";

export interface DataJobWorkerOptions {
  enabled?: boolean;
  client: DataQueueClient;
  workerId: string;
  handlers: readonly DataJobHandler[];
  signal: AbortSignal;
  partition?: DataJobPartition;
  leaseMs?: number;
  pollIntervalMs?: number;
  once?: boolean;
  onResult?: (result: DataJobExecutionResult) => void;
}

/** 独立进程组合入口；没有显式注册处理器时拒绝启动，不消费旧 preview 任务。 */
export async function runDataJobWorker(options: DataJobWorkerOptions): Promise<{ processed: number }> {
  if (options.enabled !== true) throw new TypeError("DATA_JOB_WORKER_DISABLED");
  const leaseMs = options.leaseMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  validateWorkerOptions(options, leaseMs, pollIntervalMs);
  const handlers = new Map(options.handlers.map((handler) => [handler.kind, handler]));
  const kinds = [...handlers.keys()];
  let processed = 0;
  while (!options.signal.aborted) {
    await recoverQueuedDataJobs(options.client, { kinds, partition: options.partition });
    if (options.signal.aborted) break;
    const lease = await claimQueuedDataJob(options.client, { workerId: options.workerId, kinds, leaseMs, partition: options.partition });
    if (lease) {
      const result = await executeDataJob({ client: options.client, lease, leaseMs, handler: handlers.get(lease.kind)!, signal: options.signal });
      processed += 1;
      options.onResult?.(result);
    }
    if (options.once) break;
    if (!lease) await waitForNextPoll(pollIntervalMs, options.signal);
  }
  return { processed };
}

export function validateWorkerOptions(options: Pick<DataJobWorkerOptions, "workerId" | "handlers">, leaseMs: number, pollIntervalMs: number): void {
  validateDataJobLeaseDuration(leaseMs);
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(options.workerId)) throw new TypeError("DATA_JOB_WORKER_ID_INVALID");
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 30_000) throw new TypeError("DATA_JOB_POLL_INTERVAL_INVALID");
  if (options.handlers.length === 0 || new Set(options.handlers.map((handler) => handler.kind)).size !== options.handlers.length) {
    throw new TypeError("DATA_JOB_HANDLERS_REQUIRED");
  }
}

async function waitForNextPoll(pollIntervalMs: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(pollIntervalMs, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
