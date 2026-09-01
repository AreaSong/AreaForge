import type {
  AiDraftEndpoint,
  AiDraftNormalizedInput,
  AiDraftMotivationTone,
  AiDraftScope,
  KnowledgeCardDraftAdvice,
  LearningTreeDraftAdvice,
  MotivationDraftAdvice,
  PlanDraftAdvice,
} from "@areaforge/core";

export type {
  AiAdviceStatus,
  KnowledgeCardDraftAdvice,
  LearningTreeDraftAdvice,
  MotivationDraftAdvice,
  PlanDraftAdvice,
} from "@areaforge/core";

/** Browser-safe AI preference contract. Request/cookie adapters stay outside this module. */
export interface AiProviderPreferenceDto {
  externalProviderEnabled: boolean;
  scope: "current_browser";
}

export type AiProviderCredentialSource = "account" | "environment" | "none";

export interface AiProviderCredentialStatus {
  accountConfigured: boolean;
  effectiveConfigured: boolean;
  source: AiProviderCredentialSource;
  baseUrl: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  encryptionConfigured: boolean;
  globalEnabled: boolean;
  revision: number | null;
  updatedAt: string | null;
}

export interface AiRuntimeSettingStatus {
  webEnabled: boolean;
  serverEnabled: boolean;
  effectiveEnabled: boolean;
  revision: number;
  updatedAt: string | null;
}

export interface AiRuntimeUpdateRequestDto {
  enabled: boolean;
  expectedRevision?: number;
}

export interface AiPreferenceUpdateRequestDto {
  externalProviderEnabled: boolean;
}

export interface AiProviderUpdateRequestDto {
  baseUrl: string;
  model: string;
  apiKey?: string;
  expectedRevision?: number;
}

export type AiDraftEndpointDto = AiDraftEndpoint;
export type AiDraftToneDto = AiDraftMotivationTone;
export type AiDraftScopeDto = AiDraftScope;
export type AiDraftRequestPhaseDto = "preview" | "generate" | "ack" | "reject";

type AiDraftInputDto<E extends AiDraftEndpointDto> = Omit<
  Extract<AiDraftNormalizedInput, { endpoint: E }>,
  "endpoint"
>;

export type AiDraftPreviewRequestDto<E extends AiDraftEndpointDto> = {
  phase: "preview";
} & AiDraftInputDto<E>;

export type AiDraftGenerateRequestDto<E extends AiDraftEndpointDto> = {
  phase: "generate";
  previewToken: string;
} & AiDraftInputDto<E>;

export interface AiDraftDecisionRequestDto<P extends "ack" | "reject" = "ack" | "reject"> {
  phase: P;
  resultProof: string;
}

export type AiDraftRequestForPhaseDto<
  E extends AiDraftEndpointDto,
  P extends AiDraftRequestPhaseDto,
> = P extends "preview"
  ? AiDraftPreviewRequestDto<E>
  : P extends "generate"
    ? AiDraftGenerateRequestDto<E>
    : P extends "ack" | "reject"
      ? AiDraftDecisionRequestDto<P>
      : never;

export type AiDraftOutputByEndpointDto = {
  "learning-tree": LearningTreeDraftAdvice;
  "knowledge-card": KnowledgeCardDraftAdvice;
  plan: PlanDraftAdvice;
  motivation: MotivationDraftAdvice;
};

export interface AiDraftPreviewResponseDto<E extends AiDraftEndpointDto = AiDraftEndpointDto> {
  phase: "preview";
  endpoint: E;
  operationId: string;
  previewToken: string;
  projectionVersion: string;
  outputSchema: string;
  expiresAt: string;
  payloadPreview: Record<string, unknown>;
  note: string;
  error?: string;
}

export interface AiDraftGenerateResponseDto<E extends AiDraftEndpointDto = AiDraftEndpointDto> {
  phase: "generate";
  endpoint: E;
  operationId: string;
  projectionVersion: string;
  outputSchema: string;
  status: "local_rule_fallback" | "ai_generated" | "ai_invalid_fallback" | "ai_error_fallback";
  externalCall: boolean;
  draft: AiDraftOutputByEndpointDto[E];
  resultProof: string;
  meta: {
    reason: string;
    sensitiveContextIncluded: boolean;
  };
  error?: string;
}

export interface AiDraftRejectResponseDto<E extends AiDraftEndpointDto = AiDraftEndpointDto> {
  phase: "reject";
  endpoint: E;
  operationId: string;
  projectionVersion: string;
  status: "REJECTED";
  resultProof: string;
  resultReference: string;
  rejectedAt: string;
  error?: string;
}

export type AiDraftResponseForPhaseDto<
  E extends AiDraftEndpointDto,
  P extends AiDraftRequestPhaseDto,
> = P extends "preview"
  ? AiDraftPreviewResponseDto<E>
  : P extends "reject"
    ? AiDraftRejectResponseDto<E>
    : AiDraftGenerateResponseDto<E>;
