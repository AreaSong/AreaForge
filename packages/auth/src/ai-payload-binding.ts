import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
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
const AI_DRAFT_RESULT_PROOF_TOKEN_VERSION = "v1";
const AI_DRAFT_RESULT_PROOF_KDF_SALT = "areaforge:ai-payload-binding:kdf:v1";
const AI_DRAFT_RESULT_PROOF_KDF_INFO = "ai-draft-result-proof:aes-256-gcm:v1";
const AI_DRAFT_RESULT_PROOF_AAD = "ai-draft-result-proof:token:v1";
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

export const AI_DRAFT_RESULT_PROOF_PURPOSE = "ai-draft-result-proof:v1" as const;
export const AI_DRAFT_RESULT_PROOF_VERSION = 1 as const;
export const AI_DRAFT_RESULT_PROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AI_DRAFT_RESULT_PROOF_MAX_LENGTH = 384 * 1024;

export interface AiDraftResultProofClaims {
  purpose: typeof AI_DRAFT_RESULT_PROOF_PURPOSE;
  version: typeof AI_DRAFT_RESULT_PROOF_VERSION;
  actorId: string;
  workspaceId: string;
  endpoint: AiDraftEndpoint;
  operationId: string;
  projectionVersion: string;
  outputSchema: string;
  status: string;
  externalCall: boolean;
  draft: unknown;
  meta: Record<string, unknown>;
  expiry: number;
}

export type AiDraftResultProofInput = Omit<
  AiDraftResultProofClaims,
  "purpose" | "version" | "expiry"
> & {
  now?: number;
  ttlMs?: number;
};

export interface AiDraftResultProofExpected {
  actorId: string;
  workspaceId: string;
  endpoint: AiDraftEndpoint;
  operationId?: string;
  projectionVersion?: string;
  outputSchema?: string;
  now?: number;
}

export type AiDraftResultProofVerification =
  | { ok: true; claims: AiDraftResultProofClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "mismatch" | "secret" };

export function isValidAiPayloadBindingSecret(secret: string | null | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

export function isAiDraftResultProofLengthAllowed(token: string): boolean {
  return token.length > 0 && token.length <= AI_DRAFT_RESULT_PROOF_MAX_LENGTH;
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

export function mintAiDraftResultProof(
  input: AiDraftResultProofInput,
  secret: string,
): { token: string; claims: AiDraftResultProofClaims } {
  assertSecret(secret);
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? AI_DRAFT_RESULT_PROOF_TTL_MS;
  assertResultProofLifetime(now, ttlMs);
  const claims: AiDraftResultProofClaims = {
    purpose: AI_DRAFT_RESULT_PROOF_PURPOSE,
    version: AI_DRAFT_RESULT_PROOF_VERSION,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    endpoint: input.endpoint,
    operationId: input.operationId,
    projectionVersion: input.projectionVersion,
    outputSchema: input.outputSchema,
    status: input.status,
    externalCall: input.externalCall,
    draft: input.draft,
    meta: input.meta,
    expiry: now + ttlMs,
  };
  assertResultProofClaims(claims);
  return { token: encryptResultProof(claims, secret), claims };
}

export function verifyAiDraftResultProof(
  token: string,
  secret: string,
  expected: AiDraftResultProofExpected,
): AiDraftResultProofVerification {
  if (!isValidAiPayloadBindingSecret(secret)) return { ok: false, reason: "secret" };
  if (!isAiDraftResultProofLengthAllowed(token)) return { ok: false, reason: "malformed" };
  const decrypted = decryptResultProof(token, secret);
  if (!decrypted.ok) return decrypted;
  try {
    const claims = JSON.parse(decrypted.plaintext) as unknown;
    if (!isResultProofClaims(claims)) return { ok: false, reason: "malformed" };
    if (claims.expiry <= (expected.now ?? Date.now())) return { ok: false, reason: "expired" };
    if (!matchesResultProofExpected(claims, expected)) return { ok: false, reason: "mismatch" };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function encryptResultProof(claims: AiDraftResultProofClaims, secret: string): string {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveResultProofKey(secret), iv, {
    authTagLength: AES_GCM_TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(AI_DRAFT_RESULT_PROOF_AAD, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(claims), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    AI_DRAFT_RESULT_PROOF_TOKEN_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

function decryptResultProof(
  token: string,
  secret: string,
): { ok: true; plaintext: string } | { ok: false; reason: "malformed" | "signature" } {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== AI_DRAFT_RESULT_PROOF_TOKEN_VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const iv = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);
  const tag = decodeBase64Url(parts[3]);
  if (!iv || !ciphertext || !tag || iv.length !== AES_GCM_IV_BYTES || tag.length !== AES_GCM_TAG_BYTES) {
    return { ok: false, reason: "malformed" };
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveResultProofKey(secret), iv, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(AI_DRAFT_RESULT_PROOF_AAD, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, plaintext: plaintext.toString("utf8") };
  } catch {
    return { ok: false, reason: "signature" };
  }
}

function deriveResultProofKey(secret: string): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from(AI_DRAFT_RESULT_PROOF_KDF_SALT, "utf8"),
    Buffer.from(AI_DRAFT_RESULT_PROOF_KDF_INFO, "utf8"),
    32,
  ));
}

function decodeBase64Url(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

const RESULT_PROOF_KEYS = new Set([
  "purpose",
  "version",
  "actorId",
  "workspaceId",
  "endpoint",
  "operationId",
  "projectionVersion",
  "outputSchema",
  "status",
  "externalCall",
  "draft",
  "meta",
  "expiry",
]);

function isResultProofClaims(value: unknown): value is AiDraftResultProofClaims {
  if (!isPlainRecord(value) || !hasExactKeys(value, RESULT_PROOF_KEYS)) return false;
  return value.purpose === AI_DRAFT_RESULT_PROOF_PURPOSE &&
    value.version === AI_DRAFT_RESULT_PROOF_VERSION &&
    isNonEmptyString(value.actorId) &&
    isNonEmptyString(value.workspaceId) &&
    typeof value.endpoint === "string" && isAiDraftEndpoint(value.endpoint) &&
    isNonEmptyString(value.operationId) &&
    isNonEmptyString(value.projectionVersion) &&
    isNonEmptyString(value.outputSchema) &&
    isNonEmptyString(value.status) &&
    typeof value.externalCall === "boolean" &&
    isJsonValue(value.draft) &&
    isPlainRecord(value.meta) && isJsonValue(value.meta) &&
    Number.isSafeInteger(value.expiry) && Number(value.expiry) > 0;
}

function matchesResultProofExpected(
  claims: AiDraftResultProofClaims,
  expected: AiDraftResultProofExpected,
): boolean {
  return claims.actorId === expected.actorId &&
    claims.workspaceId === expected.workspaceId &&
    claims.endpoint === expected.endpoint &&
    (expected.operationId === undefined || claims.operationId === expected.operationId) &&
    (expected.projectionVersion === undefined || claims.projectionVersion === expected.projectionVersion) &&
    (expected.outputSchema === undefined || claims.outputSchema === expected.outputSchema);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isPlainRecord(value) && Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertResultProofClaims(claims: AiDraftResultProofClaims): void {
  if (!isResultProofClaims(claims)) throw new TypeError("Invalid AI draft result proof claims.");
}

function assertResultProofLifetime(now: number, ttlMs: number): void {
  if (
    !Number.isSafeInteger(now) || now < 0 ||
    !Number.isSafeInteger(ttlMs) || ttlMs <= 0 ||
    !Number.isSafeInteger(now + ttlMs)
  ) {
    throw new TypeError("Invalid AI draft result proof lifetime.");
  }
}

function assertSecret(secret: string) {
  if (!isValidAiPayloadBindingSecret(secret)) {
    throw new Error("AI_BINDING_SECRET_INVALID");
  }
}
