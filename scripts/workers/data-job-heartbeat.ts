import { setTimeout as delay } from "node:timers/promises";
import { DataJobQueueError, heartbeatQueuedDataJob, type DataJobLease, type DataQueueClient } from "../../packages/db/src/index";

export class DataJobControlError extends Error {
  constructor(readonly status: "PAUSED" | "CANCELLED") {
    super(`DATA_JOB_${status}`);
    this.name = "DataJobControlError";
  }
}

export function startDataJobHeartbeat(input: { client: DataQueueClient; lease: DataJobLease; leaseMs: number }, controller: AbortController) {
  const timer = new AbortController();
  let accepting = true;
  let tail: Promise<void> = Promise.resolve();
  const renew = async (progress?: number) => {
    controller.signal.throwIfAborted();
    const status = await heartbeatQueuedDataJob(input.client, { lease: input.lease, leaseMs: input.leaseMs, progress });
    if (status !== "RUNNING") throw new DataJobControlError(status);
  };
  const heartbeat = (progress?: number): Promise<void> => {
    if (!accepting) return Promise.reject(new DataJobQueueError("DATA_JOB_HEARTBEAT_CLOSED"));
    const operation = tail.then(() => renew(progress)).catch((error: unknown) => { controller.abort(error); throw error; });
    tail = operation.catch(() => undefined);
    return operation;
  };
  const keeper = keepLeaseAlive(heartbeat, input.leaseMs, timer.signal, controller);
  const stop = async () => {
    accepting = false;
    timer.abort();
    await keeper;
    await tail;
  };
  const beforeCommit = async () => {
    // 先排空准备期心跳并续租，再锁任务行；提交期间不让自己的心跳争抢同一行锁。
    await stop();
    await renew();
  };
  return { heartbeat, stop, beforeCommit };
}

async function keepLeaseAlive(heartbeat: () => Promise<void>, leaseMs: number, signal: AbortSignal, controller: AbortController): Promise<void> {
  try {
    while (!signal.aborted && !controller.signal.aborted) {
      await delay(Math.max(100, Math.floor(leaseMs / 3)), undefined, { signal });
      if (!signal.aborted) await heartbeat();
    }
  } catch (error) {
    if (!signal.aborted && !controller.signal.aborted) controller.abort(error);
  }
}
