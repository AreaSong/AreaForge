import assert from "node:assert/strict";
import test from "node:test";
import { dataJobTotalQuotaRejection, readDataJobTotalQuotaPolicy, readWorkspaceMemberQuotaPolicy,
  requiresDataJobQuotaSerializable, workspaceMemberQuotaRejection } from "./capacity-quotas";

const total = { DATA_JOB_TOTAL_QUOTA_ENABLED: "true", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "2",
  DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: "3", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: "4" };

test("成员与总量开关独立关闭，不给生产填隐式阈值", () => {
  assert.equal(readDataJobTotalQuotaPolicy({}), null);
  assert.equal(readDataJobTotalQuotaPolicy({ ...total, DATA_JOB_TOTAL_QUOTA_ENABLED: "false" }), null);
  assert.equal(readWorkspaceMemberQuotaPolicy({}), null);
  assert.equal(readWorkspaceMemberQuotaPolicy({ WORKSPACE_MEMBER_QUOTA_ENABLED: "false", WORKSPACE_MEMBER_QUOTA_MAX_SEATS: "bad" }), null);
  assert.equal(requiresDataJobQuotaSerializable({}), false);
  assert.equal(requiresDataJobQuotaSerializable(total), true);
  assert.equal(requiresDataJobQuotaSerializable({ DATA_JOB_QUOTA_ENABLED: "true" }), true);
});

test("所有总量限额显式配置，严格非负整数并允许零", () => {
  assert.deepEqual(readDataJobTotalQuotaPolicy(total), { maxUserJobs: 2, maxWorkspaceJobs: 3, maxInstanceJobs: 4 });
  for (const value of [undefined, "", "01", "1.5", "-1", "1e3", " 2", "2147483648"]) {
    for (const key of Object.keys(total).filter(key => key !== "DATA_JOB_TOTAL_QUOTA_ENABLED")) {
      assert.throws(() => readDataJobTotalQuotaPolicy({ ...total, [key]: value }), { code: "DATA_JOB_QUOTA_CONFIG_INVALID" });
    }
  }
  assert.throws(() => readDataJobTotalQuotaPolicy({ ...total, DATA_JOB_TOTAL_QUOTA_ENABLED: "TRUE" }), /CONFIG_INVALID/);
  assert.equal(readDataJobTotalQuotaPolicy({ ...total, DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: "0" })?.maxUserJobs, 0);
});

test("成员上限含Owner至少一席，非法配置与未知占用拒绝新增", () => {
  const env = { WORKSPACE_MEMBER_QUOTA_ENABLED: "true", WORKSPACE_MEMBER_QUOTA_MAX_SEATS: "2" };
  assert.deepEqual(readWorkspaceMemberQuotaPolicy(env), { maxSeats: 2 });
  for (const value of [undefined, "", "0", "-1", "01", "1.5", "2147483648"]) {
    assert.throws(() => readWorkspaceMemberQuotaPolicy({ ...env, WORKSPACE_MEMBER_QUOTA_MAX_SEATS: value }), /CONFIG_INVALID/);
  }
  assert.throws(() => readWorkspaceMemberQuotaPolicy({ ...env, WORKSPACE_MEMBER_QUOTA_ENABLED: "yes" }), /CONFIG_INVALID/);
  assert.equal(workspaceMemberQuotaRejection({ maxSeats: 2 }, 1), null);
  assert.equal(workspaceMemberQuotaRejection({ maxSeats: 2 }, 2), "WORKSPACE_MEMBER_QUOTA_LIMIT");
  assert.equal(workspaceMemberQuotaRejection({ maxSeats: 2 }, 20), "WORKSPACE_MEMBER_QUOTA_LIMIT");
  for (const value of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(workspaceMemberQuotaRejection({ maxSeats: 2 }, value), "WORKSPACE_MEMBER_QUOTA_USAGE_UNAVAILABLE");
  }
});

test("用户、工作区、实例三维限制叠加，ACCOUNT没有工作区桶", () => {
  const policy = readDataJobTotalQuotaPolicy(total)!;
  assert.equal(dataJobTotalQuotaRejection(policy, { userJobs: 1, workspaceJobs: 2, instanceJobs: 3 }, true), null);
  assert.equal(dataJobTotalQuotaRejection(policy, { userJobs: 2, workspaceJobs: 2, instanceJobs: 3 }, true), "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT");
  assert.equal(dataJobTotalQuotaRejection(policy, { userJobs: 1, workspaceJobs: 3, instanceJobs: 3 }, true), "DATA_JOB_QUOTA_WORKSPACE_ACTIVE_LIMIT");
  assert.equal(dataJobTotalQuotaRejection(policy, { userJobs: 1, workspaceJobs: 2, instanceJobs: 4 }, true), "DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT");
  assert.equal(dataJobTotalQuotaRejection({ ...policy, maxWorkspaceJobs: 0 }, { userJobs: 1, workspaceJobs: 0, instanceJobs: 3 }, false), null);
  assert.equal(dataJobTotalQuotaRejection({ ...policy, maxInstanceJobs: 0 }, { userJobs: 0, workspaceJobs: 0, instanceJobs: 0 }, false), "DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT");
  assert.equal(dataJobTotalQuotaRejection(policy, { userJobs: NaN, workspaceJobs: 0, instanceJobs: 0 }, false), "DATA_JOB_QUOTA_USAGE_UNAVAILABLE");
  assert.equal(dataJobTotalQuotaRejection({ ...policy, maxInstanceJobs: -1 }, { userJobs: 0, workspaceJobs: 0, instanceJobs: 0 }, false), "DATA_JOB_QUOTA_CONFIG_INVALID");
});
