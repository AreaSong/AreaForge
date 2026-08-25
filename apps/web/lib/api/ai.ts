import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  AiDraftDecisionRequestDto,
  AiDraftEndpointDto,
  AiDraftGenerateRequestDto,
  AiDraftGenerateResponseDto,
  AiDraftPreviewRequestDto,
  AiDraftPreviewResponseDto,
  AiDraftRejectResponseDto,
  AiProviderCredentialStatus,
  AiProviderUpdateRequestDto,
  AiPreferenceUpdateRequestDto,
  AiProviderPreferenceDto,
  AiRuntimeUpdateRequestDto,
  AiRuntimeSettingStatus,
} from "@/lib/contracts";

export interface AiRuntimeResponse {
  runtime?: AiRuntimeSettingStatus;
  error?: string;
}

export interface AiPreferenceResponse {
  preference?: AiProviderPreferenceDto;
  error?: string;
}

export interface AiProviderResponse {
  provider?: AiProviderCredentialStatus;
  error?: string;
}

export interface AiProviderTestResponse {
  test?: { success?: boolean; reason?: string };
  error?: string;
}

export function updateAiRuntime(
  body: AiRuntimeUpdateRequestDto,
): Promise<ApiResult<AiRuntimeResponse>> {
  return requestApiResult("/api/ai/runtime", createJsonRequest("PATCH", body));
}

export function updateAiPreference(
  body: AiPreferenceUpdateRequestDto,
): Promise<ApiResult<AiPreferenceResponse>> {
  return requestApiResult("/api/ai/preferences", createJsonRequest("PATCH", body));
}

export function updateAiProvider(
  body: AiProviderUpdateRequestDto,
): Promise<ApiResult<AiProviderResponse>> {
  return requestApiResult("/api/ai/provider", createJsonRequest("PATCH", body));
}

export function testAiProvider(): Promise<ApiResult<AiProviderTestResponse>> {
  return requestApiResult("/api/ai/provider/test", createJsonRequest("POST", {}));
}

export function deleteAiProvider(): Promise<ApiResult<AiProviderResponse>> {
  return requestApiResult("/api/ai/provider", { method: "DELETE" });
}

export function previewAiDraft<E extends AiDraftEndpointDto>(
  endpoint: E,
  body: AiDraftPreviewRequestDto<E>,
): Promise<ApiResult<AiDraftPreviewResponseDto<E>>> {
  return postAiDraftRequest(endpoint, body);
}

export function generateAiDraft<E extends AiDraftEndpointDto>(
  endpoint: E,
  body: AiDraftGenerateRequestDto<E>,
): Promise<ApiResult<AiDraftGenerateResponseDto<E>>> {
  return postAiDraftRequest(endpoint, body);
}

export function acknowledgeAiDraft<E extends AiDraftEndpointDto>(
  endpoint: E,
  body: AiDraftDecisionRequestDto<"ack">,
): Promise<ApiResult<AiDraftGenerateResponseDto<E>>> {
  return postAiDraftRequest(endpoint, body);
}

export function rejectAiDraft<E extends AiDraftEndpointDto>(
  endpoint: E,
  body: AiDraftDecisionRequestDto<"reject">,
): Promise<ApiResult<AiDraftRejectResponseDto<E>>> {
  return postAiDraftRequest(endpoint, body);
}

function postAiDraftRequest<T>(
  endpoint: AiDraftEndpointDto,
  body: unknown,
): Promise<ApiResult<T>> {
  return requestApiResult(
    `/api/ai/drafts/${encodeURIComponent(endpoint)}`,
    createJsonRequest("POST", body),
  );
}
