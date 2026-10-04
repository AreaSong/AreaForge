import assert from "node:assert/strict";
import test from "node:test";
import { DataExportError } from "@areaforge/core";
import { DataJobQueueError, Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { dataJobQuotaErrorStatus, dataJobQuotaErrorText } from "@/lib/api/data-job-quota-errors";
import { throwRankingRebuildApiError } from "@/lib/ranking/rebuild-service";
import { throwDataExportAdmissionApiError, throwDataExportApiError } from "./data-export-runtime-service";
import { throwSearchIndexApiError } from "./workspace-search-index-service";

test("三域把确定额度拒绝映射为429，配置/隔离/竞争映射为有界503", () => {
  for (const mapper of [throwDataExportApiError, throwSearchIndexApiError, throwRankingRebuildApiError]) {
    for (const [code, status] of [["DATA_JOB_QUOTA_ACTIVE_LIMIT", 429], ["DATA_JOB_QUOTA_EXPORT_LIMIT", 429],
      ["DATA_JOB_QUOTA_USER_ACTIVE_LIMIT", 429], ["DATA_JOB_QUOTA_WORKSPACE_ACTIVE_LIMIT", 429], ["DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT", 429],
      ["DATA_JOB_QUOTA_CONFIG_INVALID", 503], ["DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED", 503],
      ["DATA_JOB_QUOTA_BUSY", 503], ["DATA_JOB_QUOTA_USAGE_UNAVAILABLE", 503]] as const) {
      assert.throws(() => mapper(new DataJobQueueError(code)), error => error instanceof ApiError && error.code === code && error.status === status);
    }
    assert.throws(() => mapper(new DataJobQueueError("DATA_JOB_QUEUE_NOT_FOUND")), error => error instanceof ApiError && error.status === 404);
  }
});

test("导出仅在总量准入中把原始及已转换竞争映为503，关闭和既有控制保持409", () => {
  const errors = [new DataExportError("DATA_EXPORT_SCOPE_BUSY", true),
    new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code: "P2034", clientVersion: "synthetic" }),
    ...["40001", "55P03", "40P01"].map(code => new Prisma.PrismaClientKnownRequestError("synthetic conflict", {
      code: "P2010", clientVersion: "synthetic", meta: { driverAdapterError: { cause: { originalCode: code } } },
    }))];
  for (const error of errors) {
    assert.throws(() => throwDataExportAdmissionApiError(error, true), { code: "DATA_JOB_QUOTA_BUSY", status: 503 });
    assert.throws(() => throwDataExportAdmissionApiError(error, false), { code: "DATA_EXPORT_SCOPE_BUSY", status: 409 });
    assert.throws(() => throwDataExportApiError(error), { code: "DATA_EXPORT_SCOPE_BUSY", status: 409 });
  }
  assert.throws(() => throwDataExportAdmissionApiError(new DataExportError("DATA_EXPORT_AUTHORIZATION_CHANGED"), true), { status: 404 });
  assert.throws(() => throwDataExportAdmissionApiError({ code: "P2034" }, true), { code: "DATA_EXPORT_DATABASE_UNAVAILABLE", status: 503 });
});

test("配额反馈说明名额、次数与恢复操作，不误称索引容量或权限失效", () => {
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_ACTIVE_LIMIT")!, /任务名额.*取消.*重试/);
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_EXPORT_LIMIT")!, /24 小时.*不会返还/);
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_CONFIG_INVALID")!, /已有任务仍可/);
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_USER_ACTIVE_LIMIT")!, /所有工作区.*取消.*重试/);
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT")!, /学习和已有任务操作不受/);
  for (const code of [undefined, "SEARCH_INDEX_DOCUMENT_LIMIT", "constructor", "__proto__"]) {
    assert.equal(dataJobQuotaErrorText(code), undefined);
    assert.equal(dataJobQuotaErrorStatus(code ?? ""), undefined);
  }
});
