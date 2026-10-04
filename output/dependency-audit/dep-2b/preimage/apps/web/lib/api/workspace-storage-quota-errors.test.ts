import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceStorageQuotaError } from "@areaforge/core";
import { Prisma } from "@areaforge/db";
import { StorageQuotaFileError } from "@areaforge/storage";
import { workspaceStorageQuotaErrorStatus, workspaceStorageQuotaErrorText } from "./workspace-storage-quota-errors";
import { throwStorageQuotaApiError } from "../study/attachment-storage-service";

test("存储确定超额为429，未知/竞争为503，反馈不泄漏计数或内部路径", () => {
  for (const [code, status] of [["WORKSPACE_STORAGE_QUOTA_LIMIT", 429], ["WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN", 503],
    ["WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID", 503], ["WORKSPACE_STORAGE_QUOTA_BUSY", 503],
    ["WORKSPACE_STORAGE_QUOTA_ISOLATION_UNSUPPORTED", 503]] as const) {
    assert.equal(workspaceStorageQuotaErrorStatus(code), status);
    assert.throws(() => throwStorageQuotaApiError(new WorkspaceStorageQuotaError(code)), { code, status });
    assert.ok(workspaceStorageQuotaErrorText(code));
  }
  assert.throws(() => throwStorageQuotaApiError(new StorageQuotaFileError()), { code: "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN", status: 503 });
  assert.throws(() => throwStorageQuotaApiError(new Prisma.PrismaClientKnownRequestError("synthetic", { code: "P2034", clientVersion: "synthetic" })),
    { code: "WORKSPACE_STORAGE_QUOTA_BUSY", status: 503 });
  for (const code of [undefined, "__proto__", "constructor", "SYNTHETIC"]) assert.equal(workspaceStorageQuotaErrorText(code), undefined);
});
