import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";

export interface AuthBrowserResponse {
  error?: string;
}

export function login(
  email: string,
  password: string,
): Promise<ApiResult<AuthBrowserResponse>> {
  return requestApiResult("/api/auth/login", createJsonRequest("POST", { email, password }));
}

export function logout(): Promise<ApiResult<AuthBrowserResponse>> {
  return requestApiResult("/api/auth/logout", { method: "POST" });
}
