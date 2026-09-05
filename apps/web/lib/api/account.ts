import { createJsonRequest, requestApiResult, type ApiResult } from "./client";

export interface AuthSessionView {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  reauthenticatedAt: string | null;
  current: boolean;
}

interface AccountResponse {
  ok?: boolean;
  accepted?: boolean;
  error?: string;
  sessions?: AuthSessionView[];
  reauthenticatedAt?: string;
  revokedSessionCount?: number;
}

export function getDeviceSessions(): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/sessions");
}

export function reauthenticate(password: string): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/reauthenticate", createJsonRequest("POST", { password }));
}

export function revokeDeviceSession(id: string): Promise<ApiResult<AccountResponse>> {
  return requestApiResult(`/api/auth/sessions/${encodeURIComponent(id)}`, createJsonRequest("DELETE", {}));
}

export function revokeOtherDeviceSessions(): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/sessions/revoke-others", createJsonRequest("POST", {}));
}

export function changePassword(currentPassword: string, nextPassword: string): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/password", createJsonRequest("PATCH", { currentPassword, nextPassword }));
}

export function requestPasswordReset(email: string): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/password/forgot", createJsonRequest("POST", { email }));
}

export function resetPassword(token: string, nextPassword: string): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/password/reset", createJsonRequest("POST", { token, nextPassword }));
}

export function requestEmailVerification(): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/email/verification", createJsonRequest("POST", {}));
}

export function verifyEmail(token: string): Promise<ApiResult<AccountResponse>> {
  return requestApiResult("/api/auth/email/verify", createJsonRequest("POST", { token }));
}
