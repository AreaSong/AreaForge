import assert from "node:assert/strict";
import test from "node:test";
import { dataJobQuotaRejection, isDataJobQuotaKind, readDataJobQuotaPolicy } from "./data-job-quota";

const enabled = { DATA_JOB_QUOTA_ENABLED: "true", DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "2", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "3" };

test("任务配额默认关闭，开启必须显式提供两个规范非负整数", () => {
  assert.equal(readDataJobQuotaPolicy({}), null);
  assert.equal(readDataJobQuotaPolicy({ ...enabled, DATA_JOB_QUOTA_ENABLED: "false", DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "bad" }), null);
  assert.deepEqual(readDataJobQuotaPolicy(enabled), { maxActiveJobs: 2, maxExports24h: 3 });
  assert.deepEqual(readDataJobQuotaPolicy({ ...enabled, DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: "0", DATA_JOB_QUOTA_MAX_EXPORTS_24H: "0" }), { maxActiveJobs: 0, maxExports24h: 0 });
  for (const value of [undefined, "", "-1", "+1", "01", "1.5", "1e3", " 2", "2147483648", "Infinity"]) {
    assert.throws(() => readDataJobQuotaPolicy({ ...enabled, DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: value }), /QUOTA_CONFIG_INVALID/);
    assert.throws(() => readDataJobQuotaPolicy({ ...enabled, DATA_JOB_QUOTA_MAX_EXPORTS_24H: value }), /QUOTA_CONFIG_INVALID/);
  }
  for (const value of ["TRUE", "1", "", "unknown"]) assert.throws(() => readDataJobQuotaPolicy({ ...enabled, DATA_JOB_QUOTA_ENABLED: value }), /QUOTA_CONFIG_INVALID/);
});

test("三个域共享活跃名额，导出窗口只限制新的 EXPORT", () => {
  const policy = { maxActiveJobs: 2, maxExports24h: 3 };
  for (const kind of ["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"]) {
    assert.equal(isDataJobQuotaKind(kind), true);
    assert.equal(dataJobQuotaRejection(policy, { activeJobs: 1, exports24h: 2 }, kind), null);
    assert.equal(dataJobQuotaRejection(policy, { activeJobs: 2, exports24h: 2 }, kind), "DATA_JOB_QUOTA_ACTIVE_LIMIT");
  }
  assert.equal(dataJobQuotaRejection(policy, { activeJobs: 1, exports24h: 3 }, "EXPORT"), "DATA_JOB_QUOTA_EXPORT_LIMIT");
  assert.equal(dataJobQuotaRejection(policy, { activeJobs: 1, exports24h: 3 }, "SEARCH_INDEX_REBUILD"), null);
  assert.equal(dataJobQuotaRejection({ maxActiveJobs: 0, maxExports24h: 0 }, { activeJobs: 0, exports24h: 0 }, "EXPORT"), "DATA_JOB_QUOTA_ACTIVE_LIMIT");
});

test("通知和删除不受配额影响，不可信计数或策略拒绝准入", () => {
  const policy = { maxActiveJobs: 2, maxExports24h: 3 };
  for (const kind of ["NOTIFICATION", "DELETE", "unknown"]) {
    assert.equal(isDataJobQuotaKind(kind), false);
    assert.equal(dataJobQuotaRejection(policy, { activeJobs: 100, exports24h: 100 }, kind), null);
  }
  for (const value of [-1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(dataJobQuotaRejection(policy, { activeJobs: value, exports24h: 0 }, "EXPORT"), "DATA_JOB_QUOTA_USAGE_UNAVAILABLE");
    assert.equal(dataJobQuotaRejection({ ...policy, maxActiveJobs: value }, { activeJobs: 0, exports24h: 0 }, "EXPORT"), "DATA_JOB_QUOTA_CONFIG_INVALID");
  }
});
