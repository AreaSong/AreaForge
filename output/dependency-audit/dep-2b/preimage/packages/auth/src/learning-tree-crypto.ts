import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  LEARNING_TREE_PARSER_VERSION,
  LEARNING_TREE_EXPORT_PURPOSE,
  LEARNING_TREE_EXPORT_TTL_MS,
  LEARNING_TREE_PREVIEW_PURPOSE,
  LEARNING_TREE_PREVIEW_TTL_MS,
  LEARNING_TREE_PROTOCOL,
  type LearningTreeExportTokenClaims,
  type LearningTreePreviewTokenClaims,
  type LearningTreeScope,
} from "@areaforge/core";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createPlanBatchRef(input: {
  sourceSha256: string;
  canonicalPlanHash: string;
  planStableKey: string;
  originVersion: number;
}): string {
  return sha256Hex(
    [
      "plan-batch-ref:v1",
      input.sourceSha256,
      input.canonicalPlanHash,
      input.planStableKey,
      String(input.originVersion),
    ].join("|"),
  );
}

export function mintLearningTreePreviewToken(
  claims: Omit<LearningTreePreviewTokenClaims, "expiry" | "nonce" | "protocolVersion" | "parserVersion"> & {
    now?: number;
    ttlMs?: number;
  },
  secret: string,
): { token: string; claims: LearningTreePreviewTokenClaims } {
  const { now, ttlMs, ...unsignedClaims } = claims;
  const full: LearningTreePreviewTokenClaims = {
    ...unsignedClaims,
    protocolVersion: LEARNING_TREE_PROTOCOL,
    parserVersion: LEARNING_TREE_PARSER_VERSION,
    expiry: (now ?? Date.now()) + (ttlMs ?? LEARNING_TREE_PREVIEW_TTL_MS),
    nonce: randomBytes(16).toString("base64url"),
  };
  assertPreviewClaims(full);
  const payload = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${LEARNING_TREE_PREVIEW_PURPOSE}:${payload}`)
    .digest("base64url");
  return { token: `${payload}.${signature}`, claims: full };
}

export function verifyLearningTreePreviewToken(
  token: string,
  secret: string,
  now = Date.now(),
):
  | { ok: true; claims: LearningTreePreviewTokenClaims }
  | { ok: false; reason: "expired"; claims: LearningTreePreviewTokenClaims }
  | { ok: false; reason: "malformed" | "signature" } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payload, signature] = parts;
  if (!payload || !signature) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret)
    .update(`${LEARNING_TREE_PREVIEW_PURPOSE}:${payload}`)
    .digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: "signature" };
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LearningTreePreviewTokenClaims;
    if (!isPreviewClaims(claims)) return { ok: false, reason: "malformed" };
    if (claims.expiry < now) return { ok: false, reason: "expired", claims };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function mintLearningTreeExportToken(
  claims: Omit<LearningTreeExportTokenClaims, "expiry" | "nonce" | "protocolVersion" | "parserVersion"> & {
    now?: number;
    ttlMs?: number;
  },
  secret: string,
): { token: string; claims: LearningTreeExportTokenClaims } {
  const { now, ttlMs, ...unsignedClaims } = claims;
  const full: LearningTreeExportTokenClaims = {
    ...unsignedClaims,
    protocolVersion: LEARNING_TREE_PROTOCOL,
    parserVersion: LEARNING_TREE_PARSER_VERSION,
    expiry: (now ?? Date.now()) + (ttlMs ?? LEARNING_TREE_EXPORT_TTL_MS),
    nonce: randomBytes(16).toString("base64url"),
  };
  assertExportClaims(full);
  const payload = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${LEARNING_TREE_EXPORT_PURPOSE}:${payload}`)
    .digest("base64url");
  return { token: `${payload}.${signature}`, claims: full };
}

export function verifyLearningTreeExportToken(
  token: string,
  secret: string,
  now = Date.now(),
): { ok: true; claims: LearningTreeExportTokenClaims } | { ok: false; reason: "malformed" | "signature" | "expired" } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payload, signature] = parts;
  if (!payload || !signature) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret)
    .update(`${LEARNING_TREE_EXPORT_PURPOSE}:${payload}`)
    .digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, reason: "signature" };
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LearningTreeExportTokenClaims;
    if (!isExportClaims(claims)) return { ok: false, reason: "malformed" };
    if (claims.expiry < now) return { ok: false, reason: "expired" };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function isScope(value: unknown): value is LearningTreeScope {
  return value === "global" || value === "subject" || value === "branch";
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasCommonClaims(value: unknown): value is {
  actorId: string;
  workspaceId: string;
  protocolVersion: typeof LEARNING_TREE_PROTOCOL;
  parserVersion: typeof LEARNING_TREE_PARSER_VERSION;
  sourceSha256: string;
  scope: LearningTreeScope;
  rootRevision: number;
  expiry: number;
  nonce: string;
} {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return claims.protocolVersion === LEARNING_TREE_PROTOCOL &&
    claims.parserVersion === LEARNING_TREE_PARSER_VERSION &&
    isNonEmptyString(claims.actorId) &&
    isNonEmptyString(claims.workspaceId) &&
    isNonce(claims.nonce) &&
    Number.isInteger(claims.rootRevision) &&
    Number(claims.rootRevision) >= 1 &&
    Number.isSafeInteger(claims.expiry) &&
    Number(claims.expiry) > 0 &&
    isSha256(claims.sourceSha256) &&
    isScope(claims.scope);
}

function isPreviewClaims(value: unknown): value is LearningTreePreviewTokenClaims {
  return hasCommonClaims(value) &&
    isSha256((value as Record<string, unknown>).canonicalPlanHash) &&
    isSha256((value as Record<string, unknown>).diffSnapshotHash);
}

function isExportClaims(value: unknown): value is LearningTreeExportTokenClaims {
  if (!hasCommonClaims(value)) return false;
  const claims = value as Record<string, unknown>;
  return (claims.subjectKey === undefined || isNonEmptyString(claims.subjectKey)) &&
    (claims.rootNodeKey === undefined || isNonEmptyString(claims.rootNodeKey));
}

function assertPreviewClaims(claims: LearningTreePreviewTokenClaims): void {
  if (!isPreviewClaims(claims)) throw new TypeError("Invalid learning tree preview token claims.");
}

function assertExportClaims(claims: LearningTreeExportTokenClaims): void {
  if (!isExportClaims(claims)) throw new TypeError("Invalid learning tree export token claims.");
}

function isNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}
