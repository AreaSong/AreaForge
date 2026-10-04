import assert from "node:assert/strict";
import test from "node:test";
import {
  authActionTokenHashMatches,
  createAuthActionToken,
  createWorkspaceInvitationToken,
  deriveDeviceLabel,
  hashAuthActionToken,
  hashWorkspaceInvitationToken,
  isAuthActionTokenUsable,
  isPasswordPolicySatisfied,
  isReauthenticationFresh,
  isSessionUsable,
  isWorkspaceInvitationUsable,
} from "./auth-security";
import { getDummyPasswordHash, verifyPassword } from "./index";

const secret = "test-auth-action-secret-that-is-at-least-32-characters";

test("action tokens contain 256 bits of random material and use purpose-separated hashes", () => {
  const token = createAuthActionToken();
  assert.equal(Buffer.from(token, "base64url").length, 32);

  const verificationHash = hashAuthActionToken(token, "EMAIL_VERIFICATION", secret);
  const resetHash = hashAuthActionToken(token, "PASSWORD_RESET", secret);
  assert.notEqual(verificationHash, resetHash);
  assert.equal(authActionTokenHashMatches(token, "EMAIL_VERIFICATION", secret, verificationHash), true);
  assert.equal(authActionTokenHashMatches(token, "PASSWORD_RESET", secret, verificationHash), false);
});

test("action token usability rejects purpose mismatch, replay, revocation, and expiry", () => {
  const now = new Date("2026-09-05T10:00:00.000Z");
  const base = {
    purpose: "PASSWORD_RESET" as const,
    expectedPurpose: "PASSWORD_RESET" as const,
    expiresAt: new Date("2026-09-05T10:30:00.000Z"),
    consumedAt: null,
    revokedAt: null,
    now,
  };
  assert.equal(isAuthActionTokenUsable(base), true);
  assert.equal(isAuthActionTokenUsable({ ...base, expectedPurpose: "EMAIL_VERIFICATION" }), false);
  assert.equal(isAuthActionTokenUsable({ ...base, consumedAt: now }), false);
  assert.equal(isAuthActionTokenUsable({ ...base, revokedAt: now }), false);
  assert.equal(isAuthActionTokenUsable({ ...base, expiresAt: now }), false);
});

test("workspace invitations use a separate token domain and reject terminal states", () => {
  const token = createWorkspaceInvitationToken();
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.notEqual(
    hashWorkspaceInvitationToken(token, secret),
    hashAuthActionToken(token, "EMAIL_VERIFICATION", secret),
  );
  const now = new Date("2026-09-05T10:00:00.000Z");
  assert.equal(isWorkspaceInvitationUsable({ status: "PENDING", expiresAt: new Date("2026-09-05T11:00:00Z"), now }), true);
  assert.equal(isWorkspaceInvitationUsable({ status: "ACCEPTED", expiresAt: new Date("2026-09-05T11:00:00Z"), now }), false);
  assert.equal(isWorkspaceInvitationUsable({ status: "PENDING", expiresAt: now, now }), false);
});

test("session usability binds account status and auth revision", () => {
  const now = new Date("2026-09-05T10:00:00.000Z");
  const base = {
    accountStatus: "ACTIVE" as const,
    accountAuthRevision: 3,
    sessionAuthRevision: 3,
    expiresAt: new Date("2026-09-06T10:00:00.000Z"),
    revokedAt: null,
    now,
  };
  assert.equal(isSessionUsable(base), true);
  assert.equal(isSessionUsable({ ...base, accountStatus: "SUSPENDED" }), false);
  assert.equal(isSessionUsable({ ...base, sessionAuthRevision: 2 }), false);
  assert.equal(isSessionUsable({ ...base, revokedAt: now }), false);
  assert.equal(isSessionUsable({ ...base, expiresAt: now }), false);
});

test("recent reauthentication rejects future, stale, and missing timestamps", () => {
  const now = new Date("2026-09-05T10:00:00.000Z");
  assert.equal(isReauthenticationFresh(new Date("2026-09-05T09:51:00.000Z"), now), true);
  assert.equal(isReauthenticationFresh(new Date("2026-09-05T09:49:59.999Z"), now), false);
  assert.equal(isReauthenticationFresh(new Date("2026-09-05T10:00:00.001Z"), now), false);
  assert.equal(isReauthenticationFresh(null, now), false);
});

test("device labels are coarse and never echo the raw user agent", () => {
  const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Safari/605.1.15";
  const label = deriveDeviceLabel(userAgent);
  assert.equal(label, "Mac 设备 · Safari");
  assert.equal(label.includes(userAgent), false);
  assert.equal(deriveDeviceLabel(null), "未知设备");
});

test("password policy requires length and three character categories", () => {
  assert.equal(isPasswordPolicySatisfied("AreaForge2026!"), true);
  assert.equal(isPasswordPolicySatisfied("onlylowercase"), false);
  assert.equal(isPasswordPolicySatisfied("Short1!"), false);
  assert.equal(isPasswordPolicySatisfied("A1!".repeat(90)), false);
});

test("unknown-account dummy hash performs scrypt work without matching arbitrary input", async () => {
  assert.equal(await verifyPassword("not-a-real-password", getDummyPasswordHash()), true);
  assert.equal(await verifyPassword("anything-else", getDummyPasswordHash()), false);
});
