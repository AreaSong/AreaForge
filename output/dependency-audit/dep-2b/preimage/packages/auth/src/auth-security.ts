import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const authActionTokenBytes = 32;
export const reauthenticationMaxAgeMs = 10 * 60 * 1000;

export type AuthActionPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";
export type AuthenticatedAccountStatus = "ACTIVE" | "SUSPENDED";

export function createAuthActionToken(): string {
  return randomBytes(authActionTokenBytes).toString("base64url");
}

export function createWorkspaceInvitationToken(): string {
  return randomBytes(authActionTokenBytes).toString("base64url");
}

export function hashWorkspaceInvitationToken(token: string, secret: string): string {
  assertActionTokenSecret(secret);
  return createHmac("sha256", secret)
    .update(`areaforge:workspace-invitation:v1:${token}`)
    .digest("hex");
}

export function hashAuthActionToken(
  token: string,
  purpose: AuthActionPurpose,
  secret: string,
): string {
  assertActionTokenSecret(secret);
  return createHmac("sha256", secret)
    .update(`areaforge:auth-action:v1:${purpose}:${token}`)
    .digest("hex");
}

export function authActionTokenHashMatches(
  token: string,
  purpose: AuthActionPurpose,
  secret: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashAuthActionToken(token, purpose, secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isAuthActionTokenUsable(input: {
  purpose: AuthActionPurpose;
  expectedPurpose: AuthActionPurpose;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  return input.purpose === input.expectedPurpose
    && !input.consumedAt
    && !input.revokedAt
    && input.expiresAt > now;
}

export function isWorkspaceInvitationUsable(input: {
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: Date;
  now?: Date;
}): boolean {
  return input.status === "PENDING" && input.expiresAt > (input.now ?? new Date());
}

export function isSessionUsable(input: {
  accountStatus: AuthenticatedAccountStatus;
  accountAuthRevision: number;
  sessionAuthRevision: number;
  expiresAt: Date;
  revokedAt: Date | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  return input.accountStatus === "ACTIVE"
    && input.accountAuthRevision >= 1
    && input.sessionAuthRevision === input.accountAuthRevision
    && !input.revokedAt
    && input.expiresAt > now;
}

export function isReauthenticationFresh(
  reauthenticatedAt: Date | null,
  now = new Date(),
  maxAgeMs = reauthenticationMaxAgeMs,
): boolean {
  if (!reauthenticatedAt || maxAgeMs <= 0) return false;
  const ageMs = now.getTime() - reauthenticatedAt.getTime();
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

export function deriveDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "未知设备";
  const normalized = userAgent.toLowerCase();
  const device = normalized.includes("iphone") || normalized.includes("ipad")
    ? "Apple 移动设备"
    : normalized.includes("android")
      ? "Android 设备"
      : normalized.includes("windows")
        ? "Windows 设备"
        : normalized.includes("macintosh") || normalized.includes("mac os")
          ? "Mac 设备"
          : normalized.includes("linux")
            ? "Linux 设备"
            : "未知设备";
  const browser = normalized.includes("edg/")
    ? "Edge"
    : normalized.includes("firefox/")
      ? "Firefox"
      : normalized.includes("chrome/") || normalized.includes("crios/")
        ? "Chrome"
        : normalized.includes("safari/")
          ? "Safari"
          : "浏览器";
  return `${device} · ${browser}`;
}

export function isPasswordPolicySatisfied(password: string): boolean {
  if (password.length < 12 || password.length > 256) return false;
  const categories = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]
    .filter((pattern) => pattern.test(password)).length;
  return categories >= 3;
}

function assertActionTokenSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error("AUTH_ACTION_TOKEN_SECRET must contain at least 32 characters.");
  }
}
