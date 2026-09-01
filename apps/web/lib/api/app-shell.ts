import { requestApiResult, type ApiResult } from "@/lib/api/client";
import type { AppShellStatusDto } from "@/lib/contracts";

export interface AppShellStatusResponse {
  status?: AppShellStatusDto;
  error?: string;
}

export function readAppShellStatus(
  deviceHeaders: HeadersInit,
  signal?: AbortSignal,
): Promise<ApiResult<AppShellStatusResponse>> {
  return requestApiResult("/api/app-shell/status", {
    cache: "no-store",
    headers: deviceHeaders,
    signal,
  });
}
