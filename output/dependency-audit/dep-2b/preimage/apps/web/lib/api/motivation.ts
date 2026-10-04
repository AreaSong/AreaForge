import {
  createJsonRequest,
  requestApiResult,
  type ApiResult,
} from "@/lib/api/client";
import type { MotivationItemDto, MotivationVaultDto } from "@/lib/contracts";

export interface MotivationItemResponse {
  item?: MotivationItemDto;
  latest?: MotivationItemDto;
  conflictFields?: string[];
  error?: string;
}

export interface MotivationReorderResponse {
  items?: MotivationItemDto[];
  latest?: MotivationItemDto[];
  conflictFields?: string[];
  error?: string;
}

export interface MotivationVaultResponse {
  vault?: MotivationVaultDto;
  latest?: MotivationVaultDto | null;
  conflictFields?: string[];
  error?: string;
}

export interface MotivationNextResponse {
  item?: Pick<MotivationItemDto, "title" | "body" | "externalUrl"> | null;
  reminderAllowed?: boolean;
  error?: string;
}

export function createMotivationItem(body: unknown): Promise<ApiResult<MotivationItemResponse>> {
  return requestApiResult("/api/motivation/items", createJsonRequest("POST", body));
}

export function updateMotivationItem(
  id: string,
  body: unknown,
): Promise<ApiResult<MotivationItemResponse>> {
  return requestApiResult(`/api/motivation/items/${encodeURIComponent(id)}`, createJsonRequest("PATCH", body));
}

export function archiveMotivationItem(
  id: string,
  body: unknown,
): Promise<ApiResult<MotivationItemResponse>> {
  return requestApiResult(
    `/api/motivation/items/${encodeURIComponent(id)}/archive`,
    createJsonRequest("POST", body),
  );
}

export function reorderMotivationItems(body: unknown): Promise<ApiResult<MotivationReorderResponse>> {
  return requestApiResult("/api/motivation/items/reorder", createJsonRequest("PATCH", body));
}

export function saveMotivationVault(body: unknown): Promise<ApiResult<MotivationVaultResponse>> {
  return requestApiResult("/api/motivation-vault", createJsonRequest("POST", body));
}

export function requestMotivationNext(
  mode: "automatic" | "manual",
): Promise<ApiResult<MotivationNextResponse>> {
  return requestApiResult("/api/motivation/next", createJsonRequest("POST", { mode }));
}
