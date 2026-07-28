import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AI_DRAFT_RESULT_PROOF_MAX_LENGTH,
  AI_DRAFT_RESULT_PROOF_PURPOSE,
  AI_DRAFT_RESULT_PROOF_TTL_MS,
  AI_DRAFT_RESULT_PROOF_VERSION,
  hmacAiPayload,
  isAiDraftResultProofLengthAllowed,
  isValidAiPayloadBindingSecret,
  mintAiDraftPreviewToken,
  mintAiDraftResultProof,
  verifyAiDraftPreviewToken,
  verifyAiDraftResultProof,
} from "./ai-payload-binding";

const secret = "s".repeat(32);

test("ai payload binding hmac is purpose-separated", () => {
  assert.equal(isValidAiPayloadBindingSecret("short"), false);
  assert.equal(isValidAiPayloadBindingSecret(secret), true);
  const a = hmacAiPayload("selection:v1", "payload", secret);
  const b = hmacAiPayload("preview:v1", "payload", secret);
  assert.notEqual(a, b);
});

test("ai draft preview token binds actor workspace endpoint and expires", () => {
  const { token, claims } = mintAiDraftPreviewToken(
    {
      actorId: "u1",
      workspaceId: "w1",
      endpoint: "motivation",
      operationId: "op1",
      projectionVersion: "motivation-input-v1",
      selectionHash: "sel",
      previewPayloadHash: "pre",
      providerPayloadHash: "prv",
      requestFingerprint: "fp",
      now: 1_000_000,
      ttlMs: 60_000,
    },
    secret,
  );

  const ok = verifyAiDraftPreviewToken(token, secret, {
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "motivation",
    now: 1_030_000,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.claims.operationId, claims.operationId);

  const mismatch = verifyAiDraftPreviewToken(token, secret, {
    actorId: "u2",
    workspaceId: "w1",
    endpoint: "motivation",
    now: 1_030_000,
  });
  assert.equal(mismatch.ok, false);

  const expired = verifyAiDraftPreviewToken(token, secret, {
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "motivation",
    now: 1_100_000,
  });
  assert.equal(expired.ok, false);
});

test("ai draft result proof encrypts claims with a seven day default ttl", () => {
  const title = "Private Example Draft Title";
  const minted = mintAiDraftResultProof({
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "plan",
    operationId: "op-result-1",
    projectionVersion: "plan-input-v1",
    outputSchema: "plan-draft-v1",
    status: "ai_generated",
    externalCall: true,
    draft: { title, tasks: [{ title: "Review chapter 1", durationMinutes: 30 }] },
    meta: { reason: "schema validated", sensitiveContextIncluded: false },
    now: 1_000_000,
  }, secret);

  assert.equal(minted.claims.purpose, AI_DRAFT_RESULT_PROOF_PURPOSE);
  assert.equal(minted.claims.version, AI_DRAFT_RESULT_PROOF_VERSION);
  assert.equal(minted.claims.expiry, 1_000_000 + AI_DRAFT_RESULT_PROOF_TTL_MS);
  assert.equal(minted.token.includes(title), false);
  const encodedParts = minted.token.split(".").slice(1);
  const tokenBytes = Buffer.concat(encodedParts.map((part) => Buffer.from(part!, "base64url")));
  assert.equal(tokenBytes.includes(Buffer.from(title, "utf8")), false);

  const verified = verifyAiDraftResultProof(minted.token, secret, {
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "plan",
    operationId: "op-result-1",
    projectionVersion: "plan-input-v1",
    outputSchema: "plan-draft-v1",
    now: 1_030_000,
  });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.deepEqual(verified.claims.draft, minted.claims.draft);
    assert.deepEqual(verified.claims.meta, minted.claims.meta);
  }
});

test("ai draft result proof rejects invalid secrets and authenticated tampering", () => {
  const minted = mintResultProof({ now: 1_000_000, ttlMs: 60_000 });
  assert.throws(() => mintResultProof({ secret: "short" }), /AI_BINDING_SECRET_INVALID/);
  assert.deepEqual(verifyAiDraftResultProof(minted.token, "short", expectedResultProof()), {
    ok: false,
    reason: "secret",
  });
  assert.deepEqual(verifyAiDraftResultProof(minted.token, "x".repeat(32), expectedResultProof()), {
    ok: false,
    reason: "signature",
  });
  assert.deepEqual(verifyAiDraftResultProof(tamperCiphertext(minted.token), secret, expectedResultProof()), {
    ok: false,
    reason: "signature",
  });
});

test("ai draft result proof rejects expiry and expected claim mismatches", () => {
  const minted = mintResultProof({ now: 1_000_000, ttlMs: 60_000 });
  assert.deepEqual(verifyAiDraftResultProof(minted.token, secret, {
    ...expectedResultProof(),
    now: 1_060_000,
  }), { ok: false, reason: "expired" });

  for (const expected of [
    { ...expectedResultProof(), actorId: "u2" },
    { ...expectedResultProof(), workspaceId: "w2" },
    { ...expectedResultProof(), endpoint: "motivation" as const },
    { ...expectedResultProof(), operationId: "op2" },
    { ...expectedResultProof(), projectionVersion: "plan-input-v2" },
    { ...expectedResultProof(), outputSchema: "plan-draft-v2" },
  ]) {
    assert.deepEqual(verifyAiDraftResultProof(minted.token, secret, expected), {
      ok: false,
      reason: "mismatch",
    });
  }
});

test("ai draft result proof validates claim shapes before minting", () => {
  assert.throws(() => mintResultProof({ status: " " }), /Invalid AI draft result proof claims/);
  assert.throws(() => mintResultProof({ draft: undefined }), /Invalid AI draft result proof claims/);
  assert.throws(() => mintResultProof({ meta: { reason: undefined } }), /Invalid AI draft result proof claims/);
  assert.throws(() => mintResultProof({ now: 1_000_000, ttlMs: 0 }), /Invalid AI draft result proof lifetime/);
  assert.deepEqual(verifyAiDraftResultProof("v1.bad.token", secret, expectedResultProof()), {
    ok: false,
    reason: "malformed",
  });
});

test("ai draft result proof enforces the shared serialized length boundary", () => {
  assert.equal(isAiDraftResultProofLengthAllowed("x".repeat(AI_DRAFT_RESULT_PROOF_MAX_LENGTH)), true);
  assert.equal(isAiDraftResultProofLengthAllowed(""), false);
  assert.equal(isAiDraftResultProofLengthAllowed("x".repeat(AI_DRAFT_RESULT_PROOF_MAX_LENGTH + 1)), false);
  assert.deepEqual(
    verifyAiDraftResultProof(
      "x".repeat(AI_DRAFT_RESULT_PROOF_MAX_LENGTH + 1),
      secret,
      expectedResultProof(),
    ),
    { ok: false, reason: "malformed" },
  );
});

test("ai draft result proof allows worst-case JSON escaping for a valid learning tree draft", () => {
  const markdownDraft = "\ud800".repeat(32_000);
  const minted = mintAiDraftResultProof({
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "learning-tree",
    operationId: "op-worst-json-escaping",
    projectionVersion: "learning-tree-input-v1",
    outputSchema: "learning-tree-draft-v1",
    status: "local_rule_fallback",
    externalCall: false,
    draft: {
      status: "local_rule_fallback",
      schemaVersion: "learning-tree-draft-v1",
      markdownDraft,
      notes: [],
      reason: "boundary fixture",
    },
    meta: { reason: "boundary fixture", sensitiveContextIncluded: false },
    now: 1_000_000,
    ttlMs: 60_000,
  }, secret);

  assert.ok(minted.token.length > 256_000);
  assert.ok(minted.token.length <= AI_DRAFT_RESULT_PROOF_MAX_LENGTH);
  const verified = verifyAiDraftResultProof(minted.token, secret, {
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "learning-tree",
    operationId: "op-worst-json-escaping",
    projectionVersion: "learning-tree-input-v1",
    outputSchema: "learning-tree-draft-v1",
    now: 1_030_000,
  });
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal((verified.claims.draft as { markdownDraft: string }).markdownDraft, markdownDraft);
});

function mintResultProof(overrides: Record<string, unknown> = {}) {
  const { secret: secretOverride, ...inputOverrides } = overrides;
  const input = {
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "plan" as const,
    operationId: "op1",
    projectionVersion: "plan-input-v1",
    outputSchema: "plan-draft-v1",
    status: "local_rule_fallback",
    externalCall: false,
    draft: { title: "Private Example Draft Title" },
    meta: { reason: "local fallback", sensitiveContextIncluded: false },
    ...inputOverrides,
  };
  const proofSecret = typeof secretOverride === "string" ? secretOverride : secret;
  return mintAiDraftResultProof(input, proofSecret);
}

function expectedResultProof() {
  return {
    actorId: "u1",
    workspaceId: "w1",
    endpoint: "plan" as const,
    operationId: "op1",
    projectionVersion: "plan-input-v1",
    outputSchema: "plan-draft-v1",
    now: 1_030_000,
  };
}

function tamperCiphertext(token: string): string {
  const parts = token.split(".");
  const ciphertext = parts[2]!;
  parts[2] = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  return parts.join(".");
}
