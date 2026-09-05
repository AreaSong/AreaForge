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
  assert.throws(() => parseServerEnv({ ...baseEnv, SMTP_USER: "mailer" }));
  assert.throws(() => parseServerEnv({ ...baseEnv, SMTP_PASSWORD: "synthetic-password" }));
});
