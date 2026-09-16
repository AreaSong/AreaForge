import assert from "node:assert/strict";
import test from "node:test";
import { parseServerEnv } from "./index";

const baseEnv = {
  DATABASE_URL: "postgresql://example.invalid/areaforge",
  AUTH_SESSION_SECRET: "synthetic-session-secret-at-least-32-characters",
};

test("auth TTL and SMTP port settings accept bounded positive integers", () => {
  const parsed = parseServerEnv({
    ...baseEnv,
    AUTH_REAUTH_MAX_AGE_SECONDS: "600",
    AUTH_INVITATION_TTL_SECONDS: "259200",
    SMTP_PORT: "465",
  });
  assert.equal(parsed.AUTH_REAUTH_MAX_AGE_SECONDS, 600);
  assert.equal(parsed.AUTH_INVITATION_TTL_SECONDS, 259200);
  assert.equal(parsed.SMTP_PORT, 465);
});

test("security durations and SMTP ports fail closed on malformed values", () => {
  for (const [key, value] of [
    ["AUTH_REAUTH_MAX_AGE_SECONDS", "0"],
    ["AUTH_PASSWORD_RESET_TTL_SECONDS", "-1"],
    ["AUTH_EMAIL_VERIFICATION_TTL_SECONDS", "1.5"],
    ["SMTP_PORT", "65536"],
    ["SMTP_PORT", "not-a-number"],
  ]) {
    assert.throws(() => parseServerEnv({ ...baseEnv, [key]: value }), `${key}=${value}`);
  }
});

test("multi-user and SMTP secrets fail closed when configuration is incomplete", () => {
  assert.throws(() => parseServerEnv({ ...baseEnv, AUTH_MULTI_USER_ENABLED: "true" }));
  assert.doesNotThrow(() => parseServerEnv({
    ...baseEnv,
    AUTH_MULTI_USER_ENABLED: "true",
    AUTH_ACTION_TOKEN_SECRET: "synthetic-action-token-secret-at-least-32-characters",
  }));
  assert.throws(() => parseServerEnv({ ...baseEnv, AUTH_RBAC_ENABLED: "true" }));
  assert.throws(() => parseServerEnv({ ...baseEnv, PLATFORM_NOTIFICATION_QUEUE_ENABLED: "true" }));
  assert.doesNotThrow(() => parseServerEnv({
    ...baseEnv,
    AUTH_MULTI_USER_ENABLED: "true",
    AUTH_RBAC_ENABLED: "true",
    AUTH_ACTION_TOKEN_SECRET: "synthetic-action-token-secret-at-least-32-characters",
  }));
  assert.throws(() => parseServerEnv({ ...baseEnv, SMTP_USER: "mailer" }));
  assert.throws(() => parseServerEnv({ ...baseEnv, SMTP_PASSWORD: "synthetic-password" }));
});

test("local candidate feature gates are parsed centrally and default closed", () => {
  const defaults = parseServerEnv(baseEnv);
  assert.equal(defaults.DATA_LIFECYCLE_ENABLED, false);
  assert.equal(defaults.DATA_EXPORT_ENABLED, false);
  assert.equal(defaults.RANKING_ENABLED, false);
  assert.equal(defaults.RANKING_PROJECTION_ENABLED, false);
  assert.equal(defaults.RANKING_REBUILD_QUEUE_ENABLED, false);
  assert.equal(defaults.SEARCH_INDEX_ENABLED, false);
  assert.equal(defaults.SEARCH_INDEX_QUEUE_ENABLED, false);
  assert.equal(defaults.PLATFORM_NOTIFICATIONS_ENABLED, false);
  assert.equal(defaults.PLATFORM_NOTIFICATION_QUEUE_ENABLED, false);
  assert.equal(defaults.DATA_JOB_WORKER_ENABLED, false);
  assert.equal(defaults.DATA_JOB_QUOTA_ENABLED, false);
  assert.equal(defaults.DATA_JOB_TOTAL_QUOTA_ENABLED, false);
  assert.equal(defaults.WORKSPACE_MEMBER_QUOTA_ENABLED, false);

  const enabled = parseServerEnv({
    ...baseEnv,
    DATA_LIFECYCLE_ENABLED: "true",
    RANKING_ENABLED: "true",
    RANKING_PROJECTION_ENABLED: "true",
    PLATFORM_NOTIFICATIONS_ENABLED: "true",
    PLATFORM_NOTIFICATION_QUEUE_ENABLED: "true",
  });
  assert.equal(enabled.DATA_LIFECYCLE_ENABLED, true);
  assert.equal(enabled.RANKING_ENABLED, true);
  assert.equal(enabled.RANKING_PROJECTION_ENABLED, true);
  assert.equal(enabled.PLATFORM_NOTIFICATIONS_ENABLED, true);
  assert.equal(enabled.PLATFORM_NOTIFICATION_QUEUE_ENABLED, true);
});

test("配额原始限额独立于身份配置，缺失或错误不得阻断登录和既有控制", () => {
  for (const limit of [undefined, "", "bad", "-1", "1.5", "999999999999999999999"]) {
    const parsed = parseServerEnv({ ...baseEnv, DATA_JOB_QUOTA_ENABLED: "true", DATA_JOB_QUOTA_MAX_ACTIVE_JOBS: limit });
    assert.equal(parsed.DATA_JOB_QUOTA_ENABLED, true);
    assert.equal(parsed.DATA_JOB_QUOTA_MAX_ACTIVE_JOBS, limit || undefined);
    assert.equal(parsed.AUTH_SESSION_SECRET, baseEnv.AUTH_SESSION_SECRET);
  }
});

test("成员和总量坏限额不阻断通用身份配置解析", () => {
  for (const limit of [undefined, "", "bad", "0", "-1", "1.5", "999999999999999999999"]) {
    const parsed = parseServerEnv({ ...baseEnv, DATA_JOB_TOTAL_QUOTA_ENABLED: "true", WORKSPACE_MEMBER_QUOTA_ENABLED: "true",
      DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: limit, DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: limit,
      DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: limit, WORKSPACE_MEMBER_QUOTA_MAX_SEATS: limit });
    assert.equal(parsed.AUTH_SESSION_SECRET, baseEnv.AUTH_SESSION_SECRET);
    assert.equal(parsed.DATA_JOB_TOTAL_QUOTA_ENABLED, true);
    assert.equal(parsed.WORKSPACE_MEMBER_QUOTA_ENABLED, true);
    assert.equal(parsed.WORKSPACE_MEMBER_QUOTA_MAX_SEATS, limit || undefined);
  }
});
