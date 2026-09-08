import { setTimeout as delay } from "node:timers/promises";
import { commitQueuedDataJob, DataJobQueueError, failQueuedDataJob, heartbeatQueuedDataJob, type DataJobLease, type DataQueueClient } from "../../packages/db/src/index";
import { abortableJobPreparation, DataJobHandlerError, type DataJobHandler } from "./data-job-handler";

export type DataJobExecutionResult = "SUCCEEDED" | "FAILED" | "PAUSED" | "CANCELLED" | "LEASE_LOST";

class DataJobControlError extends Error {
  constructor(readonly status: "PAUSED" | "CANCELLED") {
    super(`DATA_JOB_${status}`);
    this.name = "DataJobControlError";
  }
}

export async function executeDataJob(input: {
  client: DataQueueClient;
  lease: DataJobLease;
  leaseMs: number;
  handler: DataJobHandler;
  signal: AbortSignal;
}): Promise<DataJobExecutionResult> {
  const controller = new AbortController();
  const shutdown = () => controller.abort(new DataJobHandlerError("DATA_JOB_WORKER_STOPPED", true));
  input.signal.addEventListener("abort", shutdown, { once: true });
  if (input.signal.aborted) shutdown();
  const heartbeat = createHeartbeat(input, controller);
  const keeper = keepLeaseAlive(heartbeat, input.leaseMs, controller);
  try {
    if (input.handler.kind !== input.lease.kind) throw new DataJobQueueError("DATA_JOB_HANDLER_KIND_MISMATCH");
    controller.signal.throwIfAborted();
    const commit = await abortableJobPreparation(input.handler.prepare({ lease: input.lease, signal: controller.signal, heartbeat }), controller.signal);
    controller.signal.throwIfAborted();
    return await commitQueuedDataJob(input.client, { lease: input.lease, effect: async (tx, job) => {
      controller.signal.throwIfAborted();
      await commit(tx, job);
      controller.signal.throwIfAborted();
    } });
  } catch (error) {
    return await settleExecutionFailure(input, error);
  } finally {
    controller.abort();
    input.signal.removeEventListener("abort", shutdown);
    await keeper;
  }
}

function createHeartbeat(input: { client: DataQueueClient; lease: DataJobLease; leaseMs: number }, controller: AbortController) {
  let tail: Promise<void> = Promise.resolve();
  return (progress?: number): Promise<void> => {
    const operation = tail.then(async () => {
      controller.signal.throwIfAborted();
      const status = await heartbeatQueuedDataJob(input.client, { lease: input.lease, leaseMs: input.leaseMs, progress });
      if (status !== "RUNNING") throw new DataJobControlError(status);
    }).catch((error: unknown) => { controller.abort(error); throw error; });
    tail = operation.catch(() => undefined);
    return operation;
  };
}

async function keepLeaseAlive(heartbeat: () => Promise<void>, leaseMs: number, controller: AbortController): Promise<void> {
  try {
    while (!controller.signal.aborted) {
      await delay(Math.max(100, Math.floor(leaseMs / 3)), undefined, { signal: controller.signal });
      await heartbeat();
    }
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
  }
}

async function settleExecutionFailure(input: { client: DataQueueClient; lease: DataJobLease }, error: unknown): Promise<DataJobExecutionResult> {
  if (error instanceof DataJobControlError) return error.status;
  if (error instanceof DataJobQueueError && error.code === "DATA_JOB_LEASE_LOST") return "LEASE_LOST";
  const code = error instanceof DataJobHandlerError || error instanceof DataJobQueueError ? error.code : "DATA_JOB_HANDLER_FAILED";
  const retryable = error instanceof DataJobHandlerError ? error.retryable : !(error instanceof DataJobQueueError);
  try {
    await failQueuedDataJob(input.client, { lease: input.lease, errorCode: code, retryable });
    return "FAILED";
  } catch (failure) {
    if (failure instanceof DataJobQueueError && failure.code === "DATA_JOB_LEASE_LOST") return "LEASE_LOST";
    throw failure;
  }
}
