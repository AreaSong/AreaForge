import type { DataJobKind } from "../../packages/core/src/index";
import type { DataJobLease, DataQueueTransaction, QueuedDataJob } from "../../packages/db/src/index";

export interface DataJobHandlerContext {
  lease: Readonly<DataJobLease>;
  signal: AbortSignal;
  heartbeat: (progress?: number) => Promise<void>;
}

export type DataJobCommit = (tx: DataQueueTransaction, job: Readonly<QueuedDataJob>) => Promise<void>;

export interface DataJobHandler {
  kind: DataJobKind;
  // prepare 必须响应取消；持久副作用放进返回的事务函数，外部 IO 另有补偿协议。
  prepare: (context: DataJobHandlerContext) => Promise<DataJobCommit>;
}

export class DataJobHandlerError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(/^[A-Z0-9_.:-]{1,80}$/.test(code) ? code : "DATA_JOB_HANDLER_ERROR");
    if (this.message !== code) throw new TypeError("DATA_JOB_ERROR_CODE_INVALID");
    this.name = "DataJobHandlerError";
  }
}

export function abortableJobPreparation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}
