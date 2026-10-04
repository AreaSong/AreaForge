import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { stableStringify } from "./ai-draft";
import { isVerifiedStorageRelease, readWorkspaceStorageQuotaPolicy, storageReleaseProof, workspaceStorageQuotaRejection, type StorageReleaseRecord } from "./workspace-storage-quota";

test("便携UTF-8摘要与原字节协议一致，Unicode身份和内部URI均参与绑定", () => {
  for (const id of ["ascii", "附件-甲😀", "孤立代理-\ud800"]) {
    const identity = { id, ownerUserId: "owner-乙", storageWorkspaceId: "workspace-丙", storedName: "1234567890abcdef.pdf",
      uri: "upload://attachment/1234567890abcdef.pdf", hash: "a".repeat(64), sizeBytes: 10, protocolVersion: 1 };
    const canonical = stableStringify({ protocol: "workspace-storage-release-v1", ...identity });
    const expected = "sha256:" + createHash("sha256").update(new TextEncoder().encode(canonical)).digest("hex");
    assert.equal(storageReleaseProof(identity), expected);
  }
});

test("字节准入默认关闭且不选隐式阈值，零限额和规范整数均明确", () => {
  assert.equal(readWorkspaceStorageQuotaPolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "bad" }), null);
  assert.deepEqual(readWorkspaceStorageQuotaPolicy({ WORKSPACE_STORAGE_QUOTA_ENABLED: "true", WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "0" }), { maxBytes: 0n });
  for (const value of [undefined, "", "01", "-1", "1.5", "1e9", "9007199254740992", " 42"]) {
    assert.throws(() => readWorkspaceStorageQuotaPolicy({ WORKSPACE_STORAGE_QUOTA_ENABLED: "true", WORKSPACE_STORAGE_QUOTA_MAX_BYTES: value }),
      { code: "WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID" });
  }
});

test("字节用量使用精确整数，恰好满额允许，新增超额和未知用量拒绝", () => {
  assert.equal(workspaceStorageQuotaRejection({ maxBytes: 10n }, 4n, 6), null);
  assert.equal(workspaceStorageQuotaRejection({ maxBytes: 10n }, 4n, 7), "WORKSPACE_STORAGE_QUOTA_LIMIT");
  assert.equal(workspaceStorageQuotaRejection({ maxBytes: 0n }, 0n, 1), "WORKSPACE_STORAGE_QUOTA_LIMIT");
  for (const value of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
    assert.equal(workspaceStorageQuotaRejection({ maxBytes: 100n }, 0n, value), "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN");
  }
  assert.equal(workspaceStorageQuotaRejection({ maxBytes: 10n }, -1n, 1), "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN");
});

test("释放证明绑定精确内部身份，FAILED/PENDING或时间标记自身不能免计量", () => {
  const row: StorageReleaseRecord = { id: "attachment-a", ownerUserId: "owner-a", storageWorkspaceId: "workspace-a",
    storedName: "1234567890abcdef.png", uri: "upload://attachment/1234567890abcdef.png", hash: "a".repeat(64),
    sizeBytes: 10, protocolVersion: 1, status: "FAILED", stagingName: null, storageReleasedAt: null, storageReleaseProof: null };
  assert.equal(isVerifiedStorageRelease(row), false);
  const released = { ...row, storageReleasedAt: new Date(), storageReleaseProof: storageReleaseProof(row) };
  assert.equal(isVerifiedStorageRelease(released), true);
  for (const patch of [{ sizeBytes: 11 }, { ownerUserId: "other" }, { storageWorkspaceId: "other" }, { status: "READY" },
    { stagingName: "leftover.staging" }, { storageReleaseProof: "sha256:" + "0".repeat(64) }, { storageReleasedAt: "bad" },
    { storedName: "qrstuvwxyzabcdef.png", uri: "upload://attachment/qrstuvwxyzabcdef.png" }]) {
    assert.throws(() => isVerifiedStorageRelease({ ...released, ...patch }), { code: "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN" });
  }
});
