import { randomUUID } from "node:crypto";
import {
  hmacAiPayload,
  isValidAiPayloadBindingSecret,
  mintAiDraftPreviewToken,
  verifyAiDraftPreviewToken,
} from "@areaforge/auth";
import {
  AI_DRAFT_OUTPUT_SCHEMAS,
  AI_DRAFT_PROJECTION_VERSIONS,
  buildAiDraftCanonicalPayloads,
  normalizeAiDraftInput,
  type AiDraftEndpoint,
  type AiDraftNormalizedInput,
} from "@areaforge/core";
import {
  createFallbackKnowledgeCardDraftAdvice,
  createFallbackLearningTreeDraftAdvice,
  createFallbackMotivationDraftAdvice,
  createFallbackPlanDraftAdvice,
  generateAdviceWithProvider,
  validateKnowledgeCardDraftAdvice,
  validateLearningTreeDraftAdvice,
  validateMotivationDraftAdvice,
  validatePlanDraftAdvice,
  type AiAdviceKind,
  type AiAdviceStatus,
} from "@areaforge/ai";
import { prisma } from "@areaforge/db";
import { getAuthEnv } from "@/lib/auth/env";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { resolveConfiguredAiProvider } from "./ai-service";

export interface AiDraftPreviewResponse {
  phase: "preview";
  endpoint: AiDraftEndpoint;
  operationId: string;
  previewToken: string;
  projectionVersion: string;
  outputSchema: string;
  expiresAt: string;
  payloadPreview: Record<string, unknown>;
  note: string;
}

export interface AiDraftGenerateResponse {
  phase: "generate";
  endpoint: AiDraftEndpoint;
  operationId: string;
  projectionVersion: string;
  outputSchema: string;
  status: AiAdviceStatus;
  externalCall: boolean;
  draft: unknown;
  meta: {
    reason: string;
    sensitiveContextIncluded: boolean;
  };
}

function mapEndpointToKind(endpoint: AiDraftEndpoint): AiAdviceKind {
  switch (endpoint) {
    case "learning-tree":
      return "learning_tree_draft";
    case "knowledge-card":
      return "knowledge_card_draft";
    case "plan":
      return "plan_draft";
    case "motivation":
      return "motivation_draft";
  }
}

function buildProviderContext(input: AiDraftNormalizedInput): Record<string, unknown> {
  switch (input.endpoint) {
    case "learning-tree":
      return {
        selectedText: input.selectedText,
        scope: input.scope,
        subjectLabel: input.checkedProjection?.subjectLabel,
        rootNodeLabel: input.checkedProjection?.rootNodeLabel,
      };
    case "knowledge-card":
      return {
        selectedText: input.selectedText,
        kind: input.kind,
        subjectLabel: input.checkedProjection?.subjectLabel,
        nodeLabel: input.checkedProjection?.nodeLabel,
      };
    case "plan":
      return {
        selectedText: input.selectedText,
        subjectLabel: input.checkedProjection?.subjectLabel,
        milestoneLabel: input.checkedProjection?.milestoneLabel,
        dateWindow: input.checkedProjection?.dateWindow,
        defaultDurationMinutes: input.checkedProjection?.defaultDurationMinutes,
      };
    case "motivation":
      return {
        selectedText: input.selectedText,
        tone: input.tone,
      };
  }
}

function mapDraftError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof Error && "code" in error) {
    const code = String((error as { code: string }).code);
    if (code === "AI_PAYLOAD_TOO_LARGE") throw new ApiError("AI_PAYLOAD_TOO_LARGE", 413);
    if (code === "AI_DRAFT_UNKNOWN_FIELD" || code === "AI_DRAFT_INVALID_ENUM") {
      throw new ApiError(code, 400);
    }
    if (code === "AI_BINDING_SECRET_INVALID") throw new ApiError("AI_BINDING_SECRET_INVALID", 503);
  }
  throw error;
}

export async function previewAiDraft(
  actorId: string,
  endpoint: AiDraftEndpoint,
  rawBody: Record<string, unknown>,
): Promise<AiDraftPreviewResponse> {
  try {
    const env = getAuthEnv();
    const secret = env.AI_PAYLOAD_BINDING_SECRET;
    if (!isValidAiPayloadBindingSecret(secret)) {
      throw new ApiError("AI_BINDING_SECRET_INVALID", 503);
    }

    const workspace = await resolveActiveWorkspace(actorId);
    const input = normalizeAiDraftInput(endpoint, rawBody);
    const canonical = buildAiDraftCanonicalPayloads(input);
    const selectionHash = hmacAiPayload("selection:v1", canonical.selectionPayload, secret);
    const previewPayloadHash = hmacAiPayload("preview:v1", canonical.previewPayload, secret);
    const providerPayloadHash = hmacAiPayload("provider:v1", canonical.providerPayload, secret);
    const operationId = randomUUID();

    const { token, claims } = mintAiDraftPreviewToken(
      {
        actorId,
        workspaceId: workspace.id,
        endpoint,
        operationId,
        projectionVersion: canonical.projectionVersion,
        selectionHash,
        previewPayloadHash,
        providerPayloadHash,
        requestFingerprint: hmacAiPayload("preview:v1", canonical.requestFingerprint, secret),
      },
      secret,
    );

    await prisma.aiDraftOperation.create({
      data: {
        operationId,
        actorId,
        workspaceId: workspace.id,
        endpoint,
        purpose: "preview:v1",
        requestFingerprint: claims.requestFingerprint,
        nonce: claims.nonce,
        projectionVersion: canonical.projectionVersion,
        status: "PENDING",
        expiresAt: new Date(claims.expiry),
      },
    });

    return {
      phase: "preview",
      endpoint,
      operationId,
      previewToken: token,
      projectionVersion: canonical.projectionVersion,
      outputSchema: AI_DRAFT_OUTPUT_SCHEMAS[endpoint],
      expiresAt: new Date(claims.expiry).toISOString(),
      payloadPreview: JSON.parse(canonical.previewPayload) as Record<string, unknown>,
      note: "发送前预览：仅包含选中文本与已勾选投影；确认后才会外呼 provider。",
    };
  } catch (error) {
    mapDraftError(error);
  }
}

export async function generateAiDraft(
  actorId: string,
  endpoint: AiDraftEndpoint,
  previewToken: string,
  rawBody: Record<string, unknown>,
): Promise<AiDraftGenerateResponse> {
  try {
    const env = getAuthEnv();
    const secret = env.AI_PAYLOAD_BINDING_SECRET;
    if (!isValidAiPayloadBindingSecret(secret)) {
      throw new ApiError("AI_BINDING_SECRET_INVALID", 503);
    }

    const workspace = await resolveActiveWorkspace(actorId);
    const verified = verifyAiDraftPreviewToken(previewToken, secret, {
      actorId,
      workspaceId: workspace.id,
      endpoint,
    });
    if (!verified.ok) {
      throw new ApiError("AI_DRAFT_TOKEN_INVALID", 400);
    }
    const claims = verified.claims;

    // Rebuild and compare hashes so generate payload must match preview.
    const input = normalizeAiDraftInput(endpoint, rawBody);
    const canonical = buildAiDraftCanonicalPayloads(input);
    if (canonical.projectionVersion !== claims.projectionVersion) {
      throw new ApiError("AI_DRAFT_PROJECTION_MISMATCH", 400);
    }
    const selectionHash = hmacAiPayload("selection:v1", canonical.selectionPayload, secret);
    const previewPayloadHash = hmacAiPayload("preview:v1", canonical.previewPayload, secret);
    const providerPayloadHash = hmacAiPayload("provider:v1", canonical.providerPayload, secret);
    if (
      selectionHash !== claims.selectionHash ||
      previewPayloadHash !== claims.previewPayloadHash ||
      providerPayloadHash !== claims.providerPayloadHash
    ) {
      throw new ApiError("AI_DRAFT_PROJECTION_MISMATCH", 400);
    }

    const existing = await prisma.aiDraftOperation.findUnique({
      where: {
        workspaceId_operationId: {
          workspaceId: workspace.id,
          operationId: claims.operationId,
        },
      },
    });
    if (!existing || existing.actorId !== actorId || existing.endpoint !== endpoint) {
      throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
    }
    if (existing.nonce !== claims.nonce) {
      throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
    }
    if (existing.status === "SUCCEEDED" && existing.resultReference) {
      return {
        phase: "generate",
        endpoint,
        operationId: existing.operationId,
        projectionVersion: existing.projectionVersion,
        outputSchema: AI_DRAFT_OUTPUT_SCHEMAS[endpoint],
        status: "local_rule_fallback",
        externalCall: false,
        draft: { resultReference: existing.resultReference },
        meta: {
          reason: "同一 operation 已成功，返回既有结果引用，不再次外呼。",
          sensitiveContextIncluded: false,
        },
      };
    }
    if (existing.status === "IN_FLIGHT") {
      throw new ApiError("AI_DRAFT_OPERATION_IN_FLIGHT", 409);
    }
    if (existing.status !== "PENDING" && existing.status !== "FAILED") {
      throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
    }

    const cas = await prisma.aiDraftOperation.updateMany({
      where: {
        id: existing.id,
        status: { in: ["PENDING", "FAILED"] },
        revision: existing.revision,
      },
      data: {
        status: "IN_FLIGHT",
        revision: { increment: 1 },
      },
    });
    if (cas.count !== 1) {
      throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
    }

    const kind = mapEndpointToKind(endpoint);
    const context = buildProviderContext(input);
    const provider = resolveConfiguredAiProvider(kind, {
      allowExternalProvider: true,
      userId: actorId,
    });

    let result;
    try {
      switch (endpoint) {
        case "learning-tree":
          result = await generateAdviceWithProvider({
            kind,
            context: context as never,
            provider: provider.provider,
            providerUnavailableReason: provider.unavailableReason,
            fallback: createFallbackLearningTreeDraftAdvice,
            validate: validateLearningTreeDraftAdvice,
          });
          break;
        case "knowledge-card":
          result = await generateAdviceWithProvider({
            kind,
            context: context as never,
            provider: provider.provider,
            providerUnavailableReason: provider.unavailableReason,
            fallback: createFallbackKnowledgeCardDraftAdvice,
            validate: validateKnowledgeCardDraftAdvice,
          });
          break;
        case "plan":
          result = await generateAdviceWithProvider({
            kind,
            context: context as never,
            provider: provider.provider,
            providerUnavailableReason: provider.unavailableReason,
            fallback: createFallbackPlanDraftAdvice,
            validate: validatePlanDraftAdvice,
          });
          break;
        case "motivation":
          result = await generateAdviceWithProvider({
            kind,
            context: context as never,
            provider: provider.provider,
            providerUnavailableReason: provider.unavailableReason,
            fallback: createFallbackMotivationDraftAdvice,
            validate: validateMotivationDraftAdvice,
          });
          break;
      }
    } catch (error) {
      await prisma.aiDraftOperation.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          resultReference: `error:${endpoint}:${claims.operationId}`,
          revision: { increment: 1 },
        },
      });
      throw error;
    }

    const resultReference = `draft:${endpoint}:${claims.operationId}:${result.meta.status}`;
    await prisma.aiDraftOperation.update({
      where: { id: existing.id },
      data: {
        status: "SUCCEEDED",
        resultReference,
        consumedAt: new Date(),
        revision: { increment: 1 },
      },
    });

    return {
      phase: "generate",
      endpoint,
      operationId: claims.operationId,
      projectionVersion: AI_DRAFT_PROJECTION_VERSIONS[endpoint],
      outputSchema: AI_DRAFT_OUTPUT_SCHEMAS[endpoint],
      status: result.meta.status,
      externalCall: result.meta.externalCall,
      draft: result.advice,
      meta: {
        reason: result.meta.reason,
        sensitiveContextIncluded: result.meta.sensitiveContextIncluded,
      },
    };
  } catch (error) {
    mapDraftError(error);
  }
}

export async function handleAiDraftRequest(
  actorId: string,
  endpoint: AiDraftEndpoint,
  body: Record<string, unknown>,
): Promise<AiDraftPreviewResponse | AiDraftGenerateResponse> {
  const phase = body.phase;
  if (phase === "preview") {
    return previewAiDraft(actorId, endpoint, body);
  }
  if (phase === "generate") {
    if (typeof body.previewToken !== "string" || !body.previewToken) {
      throw new ApiError("AI_DRAFT_TOKEN_INVALID", 400);
    }
    return generateAiDraft(actorId, endpoint, body.previewToken, body);
  }
  throw new ApiError("AI_DRAFT_INVALID_ENUM", 400);
}
