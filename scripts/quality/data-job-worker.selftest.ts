import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { DataQueueClient } from "../../packages/db/src/index";
import { abortableJobPreparation, DataJobHandlerError, type DataJobHandler } from "../workers/data-job-handler";
import { runDataJobWorker, validateWorkerOptions } from "../workers/data-job-runner";
import { parseDataJobWorkerArguments, runConfiguredDataJobWorker } from "../workers/data-job-worker";
import { createDataJobHandlers, enabledDataJobKinds } from "../workers/data-job-handlers";

const handler: DataJobHandler = { kind: "NOTIFICATION", prepare: async () => async () => undefined };

test("worker 默认关闭，无处理器或重复处理器在触碰数据库前失败", async () => {
  const client = new Proxy({} as DataQueueClient, { get() { throw new Error("DATABASE_MUST_NOT_BE_TOUCHED"); } });
  const options = { client, workerId: "test-worker", handlers: [handler], signal: new AbortController().signal };
  await assert.rejects(runDataJobWorker(options), /DATA_JOB_WORKER_DISABLED/);
  await assert.rejects(runDataJobWorker({ ...options, enabled: true, handlers: [] }), /DATA_JOB_HANDLERS_REQUIRED/);
  assert.throws(() => validateWorkerOptions({ ...options, handlers: [handler, handler] }, 30_000, 1_000));
  assert.throws(() => validateWorkerOptions(options, 30_000, 0));
});

test("导出回收必须显式选择，关闭导出后不注册处理器且不可混入消费参数", async () => {
  assert.equal(parseDataJobWorkerArguments(["--reclaim-exports"]).reclaimExports, true);
  assert.equal(parseDataJobWorkerArguments(["--once"]).reclaimExports, false);
  for (const args of [["--reclaim-exports", "--once"], ["--reclaim-exports", "--workspace=fixture"], ["--reclaim-exports", "--reclaim-exports"]]) {
    assert.throws(() => parseDataJobWorkerArguments(args), /ARGUMENT_INVALID/);
  }
  await assert.rejects(runConfiguredDataJobWorker(["--reclaim-exports"], {}), /WORKER_DISABLED/);
  await assert.rejects(runConfiguredDataJobWorker(["--reclaim-exports"], { DATA_JOB_WORKER_ENABLED: "true", DATABASE_URL: "must-not-connect" }), /STORAGE_CONFIG_REQUIRED/);
});

test("EXPORT 只通过双开关显式注册，缺少依赖时在触碰数据库前拒绝", () => {
  assert.deepEqual(enabledDataJobKinds({ DATA_EXPORT_ENABLED: "true" }), []);
  assert.deepEqual(enabledDataJobKinds({ DATA_LIFECYCLE_ENABLED: "true" }), []);
  const env = { DATA_LIFECYCLE_ENABLED: "true", DATA_EXPORT_ENABLED: "true", EXPORT_DIR: "/fixture/exports", UPLOAD_DIR: "/fixture/uploads" };
  assert.throws(() => createDataJobHandlers(env), /DATA_EXPORT_CLIENT_REQUIRED/);
  const client = new Proxy({} as DataQueueClient, { get() { throw new Error("DATABASE_MUST_NOT_BE_TOUCHED"); } });
  assert.deepEqual(createDataJobHandlers(env, client).map(value => value.kind), ["EXPORT"]);
  assert.deepEqual(enabledDataJobKinds({ ...env, DATA_DELETE_ENABLED: "true", DATA_JOB_HANDLER: "arbitrary" }), ["EXPORT"]);
});

test("RANKING 只有六个开关精确开启才注册，关闭任一个均不触碰数据库", () => {
  const flags = ["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "RANKING_ENABLED",
    "RANKING_PROJECTION_ENABLED", "RANKING_REBUILD_QUEUE_ENABLED", "DATA_JOB_WORKER_ENABLED"];
  const env: Record<string, string | undefined> = Object.fromEntries(flags.map(key => [key, "true"]));
  const client = new Proxy({} as DataQueueClient, { get() { throw new Error("DATABASE_MUST_NOT_BE_TOUCHED"); } });
  assert.deepEqual(enabledDataJobKinds(env), ["RANKING_REBUILD"]);
  assert.throws(() => createDataJobHandlers(env), /RANKING_REBUILD_CLIENT_REQUIRED/);
  assert.deepEqual(createDataJobHandlers(env, client).map(value => value.kind), ["RANKING_REBUILD"]);
  for (const key of flags) {
    for (const value of [undefined, "false", "TRUE", "1"]) {
      const disabled = { ...env, [key]: value };
      assert.deepEqual(enabledDataJobKinds(disabled), [], `${key}=${value}`);
      assert.deepEqual(createDataJobHandlers(disabled, client), [], `${key}=${value}`);
    }
  }
});

test("SEARCH 仅在五开关精确开启后注册，关闭任一开关不访问数据库", () => {
  const flags = ["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "SEARCH_INDEX_ENABLED", "SEARCH_INDEX_QUEUE_ENABLED", "DATA_JOB_WORKER_ENABLED"];
  const env = Object.fromEntries(flags.map(key => [key, "true"]));
  const client = new Proxy({} as DataQueueClient, { get() { throw new Error("DATABASE_MUST_NOT_BE_TOUCHED"); } });
  assert.deepEqual(enabledDataJobKinds(env), ["SEARCH_INDEX_REBUILD"]);
  assert.throws(() => createDataJobHandlers(env), /SEARCH_INDEX_CLIENT_REQUIRED/);
  assert.deepEqual(createDataJobHandlers(env, client).map(item => item.kind), ["SEARCH_INDEX_REBUILD"]);
  for (const key of flags) for (const value of [undefined, "false", "TRUE", "1"]) {
    assert.deepEqual(createDataJobHandlers({ ...env, [key]: value }, client), []);
  }
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

test("暂停/取消结果只能由受信任的队列心跳产生", async () => {
  const source = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../workers/data-job-execution.ts"), "utf8");
  const heartbeatSource = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../workers/data-job-heartbeat.ts"), "utf8");
  assert.match(heartbeatSource, /class DataJobControlError/);
  assert.match(source, /if \(error instanceof DataJobControlError\)/);
  assert.doesNotMatch(source, /error instanceof DataJobHandlerError && error\.code === "DATA_JOB_(PAUSED|CANCELLED)"/);
});
