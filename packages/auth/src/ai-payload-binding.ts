import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AI_DRAFT_PREVIEW_PURPOSE,
  AI_DRAFT_PREVIEW_TTL_MS,
  AI_PAYLOAD_BINDING_PURPOSES,
  isAiDraftEndpoint,
  type AiDraftEndpoint,
  type AiDraftPreviewTokenClaims,
  type AiPayloadBindingPurpose,
} from "@areaforge/core";

const MIN_SECRET_LENGTH = 32;

export function isValidAiPayloadBindingSecret(secret: string | null | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

export function hmacAiPayload(
  purpose: AiPayloadBindingPurpose,
  canonicalPayload: string,
  secret: string,
): string {
  assertSecret(secret);
  // Domain-separated purposes: selection:v1 | preview:v1 | provider:v1
  if (!(AI_PAYLOAD_BINDING_PURPOSES as readonly string[]).includes(purpose)) {
    throw new Error("AI_DRAFT_INVALID_ENUM");
  }
  return createHmac("sha256", secret).update(`${purpose}:${canonicalPayload}`, "utf8").digest("hex");
}

export function mintAiDraftPreviewToken(
  claims: Omit<AiDraftPreviewTokenClaims, "purpose" | "expiry" | "nonce"> & {
    now?: number;
    ttlMs?: number;
    nonce?: string;
  },
  secret: string,
): { token: string; claims: AiDraftPreviewTokenClaims } {
  assertSecret(secret);
  if (!isAiDraftEndpoint(claims.endpoint)) throw new Error("AI_DRAFT_INVALID_ENUM");
  const full: AiDraftPreviewTokenClaims = {
    purpose: AI_DRAFT_PREVIEW_PURPOSE,
    actorId: claims.actorId,
    workspaceId: claims.workspaceId,
    endpoint: claims.endpoint,
    operationId: claims.operationId,
    projectionVersion: claims.projectionVersion,
    selectionHash: claims.selectionHash,
    previewPayloadHash: claims.previewPayloadHash,
    providerPayloadHash: claims.providerPayloadHash,
    requestFingerprint: claims.requestFingerprint,
    expiry: (claims.now ?? Date.now()) + (claims.ttlMs ?? AI_DRAFT_PREVIEW_TTL_MS),
    nonce: claims.nonce ?? randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${AI_DRAFT_PREVIEW_PURPOSE}:${payload}`)
    .digest("base64url");
  return { token: `${payload}.${signature}`, claims: full };
}

export function verifyAiDraftPreviewToken(
  token: string,
  secret: string,
  expected: {
    actorId: string;
    workspaceId: string;
    endpoint: AiDraftEndpoint;
    now?: number;
  },
):
  | { ok: true; claims: AiDraftPreviewTokenClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "mismatch" | "secret" } {
  if (!isValidAiPayloadBindingSecret(secret)) return { ok: false, reason: "secret" };
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return { ok: false, reason: "malformed" };
  const expectedSig = createHmac("sha256", secret)
    .update(`${AI_DRAFT_PREVIEW_PURPOSE}:${payload}`)
    .digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSig);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: "signature" };
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AiDraftPreviewTokenClaims;
    if (claims.purpose !== AI_DRAFT_PREVIEW_PURPOSE) return { ok: false, reason: "malformed" };
    if (!claims.expiry || claims.expiry < (expected.now ?? Date.now())) return { ok: false, reason: "expired" };
    if (
      claims.actorId !== expected.actorId ||
      claims.workspaceId !== expected.workspaceId ||
      claims.endpoint !== expected.endpoint ||
      !isAiDraftEndpoint(claims.endpoint)
    ) {
      return { ok: false, reason: "mismatch" };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function assertSecret(secret: string) {
  if (!isValidAiPayloadBindingSecret(secret)) {
    throw new Error("AI_BINDING_SECRET_INVALID");
  }
}
