import assert from "node:assert/strict";
import test from "node:test";
import type { DataQueueClient } from "../../packages/db/src/index";
import { abortableJobPreparation, DataJobHandlerError, type DataJobHandler } from "../workers/data-job-handler";
import { runDataJobWorker, validateWorkerOptions } from "../workers/data-job-runner";

const handler: DataJobHandler = { kind: "NOTIFICATION", prepare: async () => async () => undefined };

test("worker 默认关闭，无处理器或重复处理器在触碰数据库前失败", async () => {
  const client = new Proxy({} as DataQueueClient, { get() { throw new Error("DATABASE_MUST_NOT_BE_TOUCHED"); } });
  const options = { client, workerId: "test-worker", handlers: [handler], signal: new AbortController().signal };
  await assert.rejects(runDataJobWorker(options), /DATA_JOB_WORKER_DISABLED/);
  await assert.rejects(runDataJobWorker({ ...options, enabled: true, handlers: [] }), /DATA_JOB_HANDLERS_REQUIRED/);
  assert.throws(() => validateWorkerOptions({ ...options, handlers: [handler, handler] }, 30_000, 1_000));
  assert.throws(() => validateWorkerOptions(options, 30_000, 0));
});

test("未响应 abort 的准备任务也不能交出晚到的提交函数", async () => {
  const controller = new AbortController();
  let resolvePreparation!: (value: string) => void;
  const preparation = new Promise<string>((resolve) => { resolvePreparation = resolve; });
  const observed = abortableJobPreparation(preparation, controller.signal);
  controller.abort(new Error("STOPPED"));
  await assert.rejects(observed, /STOPPED/);
  resolvePreparation("late commit must not run");
});

test("处理器错误只能携带有界代码，不能把异常正文落库", () => {
  assert.equal(new DataJobHandlerError("WORK_FAILED", true).retryable, true);
  assert.throws(() => new DataJobHandlerError("private user data", true), /DATA_JOB_ERROR_CODE_INVALID/);
});
