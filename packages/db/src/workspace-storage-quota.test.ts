import assert from "node:assert/strict";
import test from "node:test";
import { checkWorkspaceStorageQuotaAdmission, type StorageQuotaTransaction } from "./workspace-storage-quota";

const env = { WORKSPACE_STORAGE_QUOTA_ENABLED: "true", WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "100" };
function fixture(options: { used?: bigint; unknown?: bigint; isolation?: string; locked?: boolean } = {}) {
  const sql: string[] = [];
  const tx = { $executeRaw: async (parts: TemplateStringsArray) => { sql.push(parts.join("?")); return 0; },
    $queryRaw: async (parts: TemplateStringsArray) => {
      const query = parts.join("?"); sql.push(query);
      if (query.includes("transaction_isolation")) return [{ value: options.isolation ?? "serializable" }];
      if (query.includes("pg_try_advisory")) return [{ acquired: options.locked ?? true }];
      if (query.includes("WITH inventory")) return [{ used: options.used ?? BigInt(0), unknown: options.unknown ?? BigInt(0) }];
      return [];
    } } as unknown as StorageQuotaTransaction;
  return { tx, sql };
}

test("存储关闭不读数据库或文件，非法配置在新增准入拒绝", async () => {
  const f = fixture(); let checked = false;
  await checkWorkspaceStorageQuotaAdmission(f.tx, { workspaceId: "workspace", requestedBytes: 10 }, { env: {}, verifyInventory: async () => { checked = true; } });
  assert.equal(f.sql.length, 0); assert.equal(checked, false);
  await assert.rejects(checkWorkspaceStorageQuotaAdmission(f.tx, { workspaceId: "workspace", requestedBytes: 10 },
    { env: { ...env, WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "bad" }, verifyInventory: async () => undefined }), { code: "WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID" });
  assert.equal(f.sql.length, 0);
});

test("新增存储字节必须可序列化，锁忙和未知归属不访问文件", async () => {
  for (const [options, code] of [[{ isolation: "read committed" }, "WORKSPACE_STORAGE_QUOTA_ISOLATION_UNSUPPORTED"],
    [{ locked: false }, "WORKSPACE_STORAGE_QUOTA_BUSY"], [{ unknown: BigInt(1) }, "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN"]] as const) {
    const f = fixture(options); let checked = false;
    await assert.rejects(checkWorkspaceStorageQuotaAdmission(f.tx, { workspaceId: "workspace", requestedBytes: 10 },
      { env, verifyInventory: async () => { checked = true; } }), { code });
    assert.equal(checked, false);
  }
});

test("超额不创建文件，原始SUM保留所有未释放状态并对NULL桶单独推导", async () => {
  const f = fixture({ used: BigInt(90) }); let checked = false;
  await assert.rejects(checkWorkspaceStorageQuotaAdmission(f.tx, { workspaceId: "workspace", requestedBytes: 11 },
    { env, verifyInventory: async () => { checked = true; } }), { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
  assert.equal(checked, false);
  const usage = f.sql.find(query => query.includes("WITH inventory"))!;
  assert.match(usage, /storageWorkspaceId" IS NULL AND/);
  assert.match(usage, /storageReleasedAt" IS NULL/);
  assert.doesNotMatch(usage, /DataDeletionFence|status\s*=/);
  await checkWorkspaceStorageQuotaAdmission(f.tx, { workspaceId: "workspace", requestedBytes: 10 },
    { env, verifyInventory: async () => { checked = true; } });
  assert.equal(checked, true);
});
