import assert from "node:assert/strict";
import test from "node:test";
import { DataJobQueueError } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { dataJobQuotaErrorStatus, dataJobQuotaErrorText } from "@/lib/api/data-job-quota-errors";
import { throwRankingRebuildApiError } from "@/lib/ranking/rebuild-service";
import { throwDataExportApiError } from "./data-export-runtime-service";
import { throwSearchIndexApiError } from "./workspace-search-index-service";

test("三域把确定额度拒绝映射为429，配置/隔离/竞争映射为有界503", () => {
  for (const mapper of [throwDataExportApiError, throwSearchIndexApiError, throwRankingRebuildApiError]) {
    for (const [code, status] of [["DATA_JOB_QUOTA_ACTIVE_LIMIT", 429], ["DATA_JOB_QUOTA_EXPORT_LIMIT", 429],
      ["DATA_JOB_QUOTA_CONFIG_INVALID", 503], ["DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED", 503],
      ["DATA_JOB_QUOTA_BUSY", 503], ["DATA_JOB_QUOTA_USAGE_UNAVAILABLE", 503]] as const) {
      assert.throws(() => mapper(new DataJobQueueError(code)), error => error instanceof ApiError && error.code === code && error.status === status);
    }
    assert.throws(() => mapper(new DataJobQueueError("DATA_JOB_QUEUE_NOT_FOUND")), error => error instanceof ApiError && error.status === 404);
  }
});

test("配额反馈说明名额、次数与恢复操作，不误称索引容量或权限失效", () => {
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_ACTIVE_LIMIT")!, /任务名额.*取消.*重试/);
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_EXPORT_LIMIT")!, /24 小时.*不会返还/);
  assert.match(dataJobQuotaErrorText("DATA_JOB_QUOTA_CONFIG_INVALID")!, /已有任务仍可/);
  for (const code of [undefined, "SEARCH_INDEX_DOCUMENT_LIMIT", "constructor", "__proto__"]) {
    assert.equal(dataJobQuotaErrorText(code), undefined);
    assert.equal(dataJobQuotaErrorStatus(code ?? ""), undefined);
  }
});
