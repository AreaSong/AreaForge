import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hmacAiPayload,
  isValidAiPayloadBindingSecret,
  mintAiDraftPreviewToken,
  verifyAiDraftPreviewToken,
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
