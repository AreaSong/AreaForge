import { randomUUID } from "node:crypto";
import {
  hmacAiPayload,
  isAiDraftResultProofLengthAllowed,
  isValidAiPayloadBindingSecret,
  mintAiDraftPreviewToken,
  mintAiDraftResultProof,
  verifyAiDraftPreviewToken,
  verifyAiDraftResultProof,
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
  type AiJsonProvider,
} from "@areaforge/ai";
import { prisma, type Prisma } from "@areaforge/db";
import { getAuthEnv } from "@/lib/auth/env";
import { ApiError } from "@/lib/api/responses";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  resolveAiProviderPrerequisitesForUser,
  resolveConfiguredAiProviderForUser,
} from "./ai-service";

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
  resultProof: string;
  meta: {
    reason: string;
    sensitiveContextIncluded: boolean;
  };
}

export interface AiDraftRejectResponse {
  phase: "reject";
  endpoint: AiDraftEndpoint;
  operationId: string;
  projectionVersion: string;
  status: "REJECTED";
  resultProof: string;
  resultReference: string;
  rejectedAt: string;
}

interface AiDraftGenerateOptions {
  allowExternalProvider?: boolean;
  provider?: AiJsonProvider;
}

const aiDraftResultCache = new Map<string, { expiresAt: number; response: AiDraftGenerateResponse }>();
const aiDraftResultCacheMaxEntries = 256;
const aiDraftProviderTimeoutMs = 30_000;
const aiDraftInFlightLeaseMs = 45_000;

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
  options: AiDraftGenerateOptions = {},
): Promise<AiDraftPreviewResponse> {
  try {
    const env = getAuthEnv();
    const secret = env.AI_PAYLOAD_BINDING_SECRET;
    if (!isValidAiPayloadBindingSecret(secret)) {
      throw new ApiError("AI_BINDING_SECRET_INVALID", 503);
    }

    const workspace = await resolveActiveWorkspace(actorId);
    await expireStaleAiDraftOperations(actorId, workspace.id);
    const providerPrerequisites = await resolveAiProviderPrerequisitesForUser({
      allowExternalProvider: options.allowExternalProvider,
      provider: options.provider,
      userId: actorId,
    });
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
      note: providerPrerequisites.available
        ? "发送前预览：仅包含选中文本与已勾选投影；确认后才可能外呼 provider。"
        : `发送前预览：仅包含选中文本与已勾选投影；${providerPrerequisites.unavailableReason}`,
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
  options: AiDraftGenerateOptions = {},
): Promise<AiDraftGenerateResponse> {
  let inFlightOperation: {
    id: string;
    revision: number;
  } | null = null;
  try {
    const env = getAuthEnv();
    const secret = env.AI_PAYLOAD_BINDING_SECRET;
    if (!isValidAiPayloadBindingSecret(secret)) {
      throw new ApiError("AI_BINDING_SECRET_INVALID", 503);
    }

    const workspace = await resolveActiveWorkspace(actorId);
    await expireStaleAiDraftOperations(actorId, workspace.id);
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
    if (existing.consumedAt) {
      throw new ApiError("AI_DRAFT_OPERATION_CONSUMED", 409);
    }
    if (existing.status === "SUCCEEDED" && existing.resultReference) {
      const replay = readCachedAiDraftResult(workspace.id, existing.operationId);
      if (replay) return replay;
      throw new ApiError("AI_DRAFT_RESULT_UNAVAILABLE", 409);
    }
    if (existing.status === "IN_FLIGHT") {
      throw new ApiError("AI_DRAFT_OPERATION_IN_FLIGHT", 409);
    }
    if (existing.status === "FAILED") {
      throw new ApiError("AI_DRAFT_RESULT_UNAVAILABLE", 409);
    }
    if (existing.status === "EXPIRED") {
      throw new ApiError("AI_DRAFT_OPERATION_EXPIRED", 409);
    }
    if (existing.status !== "PENDING") {
      throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
    }

    const cas = await prisma.aiDraftOperation.updateMany({
      where: {
        id: existing.id,
        status: "PENDING",
        revision: existing.revision,
      },
      data: {
        status: "IN_FLIGHT",
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (cas.count !== 1) {
      throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
    }
    inFlightOperation = {
      id: existing.id,
      revision: existing.revision + 1,
    };

    const kind = mapEndpointToKind(endpoint);
    const context = buildProviderContext(input);
    const provider = await resolveConfiguredAiProviderForUser(kind, {
      allowExternalProvider: options.allowExternalProvider,
      provider: options.provider,
      maxProviderRetries: 0,
      providerTimeoutMs: Math.min(env.AI_TIMEOUT_MS, aiDraftProviderTimeoutMs),
      userId: actorId,
    });

    let result;
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

    const resultProof = mintAiDraftResultProof({
      actorId,
      workspaceId: workspace.id,
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
    }, secret).token;
    if (!isAiDraftResultProofLengthAllowed(resultProof)) {
      throw new ApiError("AI_DRAFT_RESULT_TOO_LARGE", 413);
    }
    const response: AiDraftGenerateResponse = {
      phase: "generate",
      endpoint,
      operationId: claims.operationId,
      projectionVersion: AI_DRAFT_PROJECTION_VERSIONS[endpoint],
      outputSchema: AI_DRAFT_OUTPUT_SCHEMAS[endpoint],
      status: result.meta.status,
      externalCall: result.meta.externalCall,
      draft: result.advice,
      resultProof,
      meta: {
        reason: result.meta.reason,
        sensitiveContextIncluded: result.meta.sensitiveContextIncluded,
      },
    };
    const resultReference = buildAiDraftResultReference(endpoint, claims.operationId, response.status);
    cacheAiDraftResult(workspace.id, claims.operationId, claims.expiry, response);
    let finalized: { count: number };
    try {
      finalized = await prisma.aiDraftOperation.updateMany({
        where: {
          id: existing.id,
          status: "IN_FLIGHT",
          revision: existing.revision + 1,
        },
        data: {
          status: "SUCCEEDED",
          resultReference,
          revision: { increment: 1 },
        },
      });
    } catch (error) {
      deleteCachedAiDraftResult(workspace.id, claims.operationId);
      throw error;
    }
    if (finalized.count !== 1) {
      deleteCachedAiDraftResult(workspace.id, claims.operationId);
      throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
    }
    inFlightOperation = null;

    return response;
  } catch (error) {
    if (inFlightOperation) {
      await markAiDraftOperationFailed(inFlightOperation).catch(() => undefined);
    }
    mapDraftError(error);
  }
}

export async function acknowledgeAiDraftResult(
  actorId: string,
  endpoint: AiDraftEndpoint,
  resultProof: string,
): Promise<AiDraftGenerateResponse> {
  const acknowledged = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    return acknowledgeAiDraftResultInTx(tx, actorId, workspace.id, endpoint, resultProof);
  });
  return acknowledged.response;
}

export async function acknowledgeAiDraftResultInTx(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  endpoint: AiDraftEndpoint,
  resultProof: string,
  expected: { operationId?: string; projectionVersion?: string } = {},
): Promise<{ response: AiDraftGenerateResponse; workspaceId: string; expiry: number }> {
  const verified = verifyAiDraftResultForActor(actorId, workspaceId, endpoint, resultProof, expected);
  const operation = await tx.aiDraftOperation.findUnique({
    where: { workspaceId_operationId: { workspaceId, operationId: verified.response.operationId } },
  });
  if (
    !operation
    || operation.actorId !== actorId
    || operation.endpoint !== endpoint
    || operation.projectionVersion !== verified.response.projectionVersion
  ) {
    throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
  }
  const resultReference = buildAiDraftResultReference(
    endpoint,
    operation.operationId,
    verified.response.status,
  );
  if (operation.status === "SUCCEEDED" && operation.resultReference === resultReference) {
    if (!operation.consumedAt) {
      const consumed = await tx.aiDraftOperation.updateMany({
        where: {
          id: operation.id,
          status: "SUCCEEDED",
          resultReference,
          consumedAt: null,
          revision: operation.revision,
        },
        data: {
          consumedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (consumed.count !== 1) {
        const latest = await tx.aiDraftOperation.findUnique({ where: { id: operation.id } });
        if (
          latest?.status !== "SUCCEEDED"
          || latest.resultReference !== resultReference
          || !latest.consumedAt
        ) {
          throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
        }
      }
    }
  } else {
    throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
  }
  deleteCachedAiDraftResult(workspaceId, operation.operationId);
  return { ...verified, workspaceId };
}

/**
 * 驳回只改变草稿操作的终态，不重新读取或调用 provider；结果证明仍用于
 * 绑定原始草稿，避免客户端用 operationId 伪造一条历史记录。
 */
export async function rejectAiDraftResult(
  actorId: string,
  endpoint: AiDraftEndpoint,
  resultProof: string,
): Promise<AiDraftRejectResponse> {
  const rejected = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    return rejectAiDraftResultInTx(tx, actorId, workspace.id, endpoint, resultProof);
  });
  return rejected.response;
}

export async function rejectAiDraftResultInTx(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  endpoint: AiDraftEndpoint,
  resultProof: string,
  expected: { operationId?: string; projectionVersion?: string } = {},
): Promise<{ response: AiDraftRejectResponse; workspaceId: string }> {
  const verified = verifyAiDraftResultForActor(actorId, workspaceId, endpoint, resultProof, expected);
  const operation = await tx.aiDraftOperation.findUnique({
    where: { workspaceId_operationId: { workspaceId, operationId: verified.response.operationId } },
  });
  if (
    !operation
    || operation.actorId !== actorId
    || operation.endpoint !== endpoint
    || operation.projectionVersion !== verified.response.projectionVersion
  ) {
    throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
  }

  const resultReference = buildAiDraftDecisionReference(endpoint, operation.operationId, "rejected");
  if (operation.status === "REJECTED" && operation.resultReference === resultReference) {
    return {
      workspaceId,
      response: {
        phase: "reject",
        endpoint,
        operationId: operation.operationId,
        projectionVersion: operation.projectionVersion,
        status: "REJECTED",
        resultProof,
        resultReference,
        rejectedAt: (operation.consumedAt ?? operation.updatedAt).toISOString(),
      },
    };
  }

  // 已采用或任何非成功状态都不能再被驳回；特别是不能把已确认历史回滚。
  if (operation.status !== "SUCCEEDED" || operation.consumedAt) {
    throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
  }

  const rejectedAt = new Date();
  const updated = await tx.aiDraftOperation.updateMany({
    where: {
      id: operation.id,
      status: "SUCCEEDED",
      consumedAt: null,
      revision: operation.revision,
    },
    data: {
      status: "REJECTED",
      resultReference,
      consumedAt: rejectedAt,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    const latest = await tx.aiDraftOperation.findUnique({ where: { id: operation.id } });
    if (latest?.status === "REJECTED" && latest.resultReference === resultReference) {
      return {
        workspaceId,
        response: {
          phase: "reject",
          endpoint,
          operationId: latest.operationId,
          projectionVersion: latest.projectionVersion,
          status: "REJECTED",
          resultProof,
          resultReference,
          rejectedAt: (latest.consumedAt ?? latest.updatedAt).toISOString(),
        },
      };
    }
    throw new ApiError("AI_DRAFT_OPERATION_CONFLICT", 409);
  }

  deleteCachedAiDraftResult(workspaceId, operation.operationId);
  return {
    workspaceId,
    response: {
      phase: "reject",
      endpoint,
      operationId: operation.operationId,
      projectionVersion: operation.projectionVersion,
      status: "REJECTED",
      resultProof,
      resultReference,
      rejectedAt: rejectedAt.toISOString(),
    },
  };
}

function verifyAiDraftResultForActor(
  actorId: string,
  workspaceId: string,
  endpoint: AiDraftEndpoint,
  resultProof: string,
  expected: { operationId?: string; projectionVersion?: string },
): { response: AiDraftGenerateResponse; expiry: number } {
  const secret = getAuthEnv().AI_PAYLOAD_BINDING_SECRET;
  if (!isValidAiPayloadBindingSecret(secret)) throw new ApiError("AI_BINDING_SECRET_INVALID", 503);
  const verified = verifyAiDraftResultProof(resultProof, secret, {
    actorId,
    workspaceId,
    endpoint,
    operationId: expected.operationId,
    projectionVersion: expected.projectionVersion,
    outputSchema: AI_DRAFT_OUTPUT_SCHEMAS[endpoint],
  });
  if (!verified.ok) throw new ApiError("AI_DRAFT_RESULT_PROOF_INVALID", 409);
  const draft = validateDraftForEndpoint(endpoint, verified.claims.draft);
  if (!isAdviceStatus(verified.claims.status)) throw new ApiError("AI_DRAFT_RESULT_PROOF_INVALID", 409);
  const reason = verified.claims.meta.reason;
  const sensitiveContextIncluded = verified.claims.meta.sensitiveContextIncluded;
  if (typeof reason !== "string" || typeof sensitiveContextIncluded !== "boolean") {
    throw new ApiError("AI_DRAFT_RESULT_PROOF_INVALID", 409);
  }
  return {
    expiry: verified.claims.expiry,
    response: {
      phase: "generate",
      endpoint,
      operationId: verified.claims.operationId,
      projectionVersion: verified.claims.projectionVersion,
      outputSchema: verified.claims.outputSchema,
      status: verified.claims.status,
      externalCall: verified.claims.externalCall,
      draft,
      resultProof,
      meta: { reason, sensitiveContextIncluded },
    },
  };
}

function validateDraftForEndpoint(endpoint: AiDraftEndpoint, draft: unknown) {
  try {
    switch (endpoint) {
      case "learning-tree": return validateLearningTreeDraftAdvice(draft);
      case "knowledge-card": return validateKnowledgeCardDraftAdvice(draft);
      case "plan": return validatePlanDraftAdvice(draft);
      case "motivation": return validateMotivationDraftAdvice(draft);
    }
  } catch {
    throw new ApiError("AI_DRAFT_RESULT_PROOF_INVALID", 409);
  }
}

function isAdviceStatus(value: string): value is AiAdviceStatus {
  return value === "local_rule_fallback"
    || value === "ai_generated"
    || value === "ai_invalid_fallback"
    || value === "ai_error_fallback";
}

async function expireStaleAiDraftOperations(actorId: string, workspaceId: string): Promise<void> {
  const now = new Date();
  await prisma.aiDraftOperation.updateMany({
    where: {
      actorId,
      workspaceId,
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: {
      status: "EXPIRED",
      revision: { increment: 1 },
    },
  });
  await prisma.aiDraftOperation.updateMany({
    where: {
      actorId,
      workspaceId,
      status: "IN_FLIGHT",
      updatedAt: { lte: new Date(now.getTime() - aiDraftInFlightLeaseMs) },
    },
    data: {
      status: "FAILED",
      resultReference: "error:result-unavailable:v1",
      revision: { increment: 1 },
    },
  });
}

async function markAiDraftOperationFailed(input: {
  id: string;
  revision: number;
}): Promise<void> {
  await prisma.aiDraftOperation.updateMany({
    where: {
      id: input.id,
      status: "IN_FLIGHT",
      revision: input.revision,
    },
    data: {
      status: "FAILED",
      resultReference: "error:result-unavailable:v1",
      revision: { increment: 1 },
    },
  });
}

function buildAiDraftResultReference(
  endpoint: AiDraftEndpoint,
  operationId: string,
  status: AiAdviceStatus,
): string {
  return `draft:${endpoint}:${operationId}:${status}`;
}

function buildAiDraftDecisionReference(
  endpoint: AiDraftEndpoint,
  operationId: string,
  decision: "rejected",
): string {
  return `draft:${endpoint}:${operationId}:${decision}`;
}

function readCachedAiDraftResult(workspaceId: string, operationId: string): AiDraftGenerateResponse | null {
  const key = aiDraftResultCacheKey(workspaceId, operationId);
  const entry = aiDraftResultCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    aiDraftResultCache.delete(key);
    return null;
  }
  return entry.response;
}

function cacheAiDraftResult(
  workspaceId: string,
  operationId: string,
  expiresAt: number,
  response: AiDraftGenerateResponse,
): void {
  for (const [key, entry] of aiDraftResultCache) {
    if (entry.expiresAt <= Date.now()) aiDraftResultCache.delete(key);
  }
  while (aiDraftResultCache.size >= aiDraftResultCacheMaxEntries) {
    const oldestKey = aiDraftResultCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    aiDraftResultCache.delete(oldestKey);
  }
  aiDraftResultCache.set(aiDraftResultCacheKey(workspaceId, operationId), { expiresAt, response });
}

function aiDraftResultCacheKey(workspaceId: string, operationId: string): string {
  return `${workspaceId}:${operationId}`;
}

function deleteCachedAiDraftResult(workspaceId: string, operationId: string): void {
  aiDraftResultCache.delete(aiDraftResultCacheKey(workspaceId, operationId));
}

export function hasCachedAiDraftResultForTesting(workspaceId: string, operationId: string): boolean {
  return readCachedAiDraftResult(workspaceId, operationId) !== null;
}

export function clearAiDraftResultCacheForTesting(): void {
  aiDraftResultCache.clear();
}

export async function handleAiDraftRequest(
  actorId: string,
  endpoint: AiDraftEndpoint,
  body: Record<string, unknown>,
  options: AiDraftGenerateOptions = {},
): Promise<AiDraftPreviewResponse | AiDraftGenerateResponse | AiDraftRejectResponse> {
  const phase = body.phase;
  if (phase === "preview") {
    return previewAiDraft(actorId, endpoint, body, options);
  }
  if (phase === "generate") {
    if (typeof body.previewToken !== "string" || !body.previewToken) {
      throw new ApiError("AI_DRAFT_TOKEN_INVALID", 400);
    }
    return generateAiDraft(actorId, endpoint, body.previewToken, body, options);
  }
  if (phase === "ack") {
    if (
      Object.keys(body).some((key) => key !== "phase" && key !== "resultProof")
      || typeof body.resultProof !== "string"
      || !isAiDraftResultProofLengthAllowed(body.resultProof)
    ) {
      throw new ApiError("AI_DRAFT_RESULT_PROOF_INVALID", 400);
    }
    return acknowledgeAiDraftResult(actorId, endpoint, body.resultProof);
  }
  if (phase === "reject") {
    if (
      Object.keys(body).some((key) => key !== "phase" && key !== "resultProof")
      || typeof body.resultProof !== "string"
      || !isAiDraftResultProofLengthAllowed(body.resultProof)
    ) {
      throw new ApiError("AI_DRAFT_RESULT_PROOF_INVALID", 400);
    }
    return rejectAiDraftResult(actorId, endpoint, body.resultProof);
  }
  throw new ApiError("AI_DRAFT_INVALID_ENUM", 400);
}
