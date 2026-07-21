import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  LEARNING_TREE_PARSER_VERSION,
  LEARNING_TREE_PREVIEW_PURPOSE,
  LEARNING_TREE_PREVIEW_TTL_MS,
  LEARNING_TREE_PROTOCOL,
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
  const full: LearningTreePreviewTokenClaims = {
    ...claims,
    protocolVersion: LEARNING_TREE_PROTOCOL,
    parserVersion: LEARNING_TREE_PARSER_VERSION,
    expiry: (claims.now ?? Date.now()) + (claims.ttlMs ?? LEARNING_TREE_PREVIEW_TTL_MS),
    nonce: randomBytes(16).toString("base64url"),
  };
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
): { ok: true; claims: LearningTreePreviewTokenClaims } | { ok: false; reason: "malformed" | "signature" | "expired" } {
  const [payload, signature] = token.split(".");
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
    if (!claims.expiry || claims.expiry < now) return { ok: false, reason: "expired" };
    if (claims.protocolVersion !== LEARNING_TREE_PROTOCOL) return { ok: false, reason: "malformed" };
    if (!isScope(claims.scope)) return { ok: false, reason: "malformed" };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function isScope(value: unknown): value is LearningTreeScope {
  return value === "global" || value === "subject" || value === "branch";
}
