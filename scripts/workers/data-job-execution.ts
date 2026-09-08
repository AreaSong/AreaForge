import { commitQueuedDataJob, DataJobQueueError, failQueuedDataJob, type DataJobLease, type DataQueueClient } from "../../packages/db/src/index";
import { abortableJobPreparation, DataJobHandlerError, type DataJobHandler } from "./data-job-handler";
import { DataJobControlError, startDataJobHeartbeat } from "./data-job-heartbeat";

export type DataJobExecutionResult = "SUCCEEDED" | "FAILED" | "PAUSED" | "CANCELLED" | "LEASE_LOST";

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
  const keeper = startDataJobHeartbeat(input, controller);
  try {
    if (input.handler.kind !== input.lease.kind) throw new DataJobQueueError("DATA_JOB_HANDLER_KIND_MISMATCH");
    controller.signal.throwIfAborted();
    const commit = await abortableJobPreparation(input.handler.prepare({ lease: input.lease, signal: controller.signal, heartbeat: keeper.heartbeat }), controller.signal);
    await keeper.beforeCommit();
    controller.signal.throwIfAborted();
    return await commitQueuedDataJob(input.client, { lease: input.lease, effect: async (tx, job) => {
      controller.signal.throwIfAborted();
      await commit(tx, job);
      controller.signal.throwIfAborted();
    } });
  } catch (error) {
    await keeper.stop();
    return await settleExecutionFailure(input, controller.signal.aborted ? controller.signal.reason : error);
  } finally {
    controller.abort();
    input.signal.removeEventListener("abort", shutdown);
    await keeper.stop();
  }
}

async function settleExecutionFailure(input: { client: DataQueueClient; lease: DataJobLease }, error: unknown): Promise<DataJobExecutionResult> {
  if (error instanceof DataJobControlError) return error.status;
  if (error instanceof DataJobQueueError && error.code === "DATA_JOB_LEASE_LOST") return "LEASE_LOST";
  const code = error instanceof DataJobHandlerError || error instanceof DataJobQueueError ? error.code : "DATA_JOB_HANDLER_FAILED";
  const retryable = error instanceof DataJobHandlerError ? error.retryable : !(error instanceof DataJobQueueError);
  try {
    return await failQueuedDataJob(input.client, { lease: input.lease, errorCode: code, retryable });
  } catch (failure) {
    if (failure instanceof DataJobQueueError && failure.code === "DATA_JOB_LEASE_LOST") return "LEASE_LOST";
    throw failure;
  }
}
