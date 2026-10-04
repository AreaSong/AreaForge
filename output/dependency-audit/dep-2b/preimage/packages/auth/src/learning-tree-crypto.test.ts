import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  LEARNING_TREE_EXPORT_PURPOSE,
  LEARNING_TREE_PREVIEW_PURPOSE,
} from "@areaforge/core";
import {
  mintLearningTreeExportToken,
  mintLearningTreePreviewToken,
  verifyLearningTreeExportToken,
  verifyLearningTreePreviewToken,
} from "./learning-tree-crypto";

const secret = "x".repeat(32);

test("learning tree export token is purpose separated and expires", () => {
  const minted = mintLearningTreeExportToken({
    actorId: "u1",
    workspaceId: "w1",
    sourceSha256: "a".repeat(64),
    scope: "branch",
    subjectKey: "subject_ds",
    rootNodeKey: "node_list",
    rootRevision: 3,
    now: 1_000_000,
    ttlMs: 60_000,
  }, secret);
  const verified = verifyLearningTreeExportToken(minted.token, secret, 1_030_000);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.claims.rootNodeKey, "node_list");
  assert.equal(verifyLearningTreePreviewToken(minted.token, secret, 1_030_000).ok, false);
  assert.equal(verifyLearningTreeExportToken(minted.token, secret, 1_100_000).ok, false);

  const preview = mintLearningTreePreviewToken({
    actorId: "u1",
    workspaceId: "w1",
    sourceSha256: "b".repeat(64),
    canonicalPlanHash: "c".repeat(64),
    diffSnapshotHash: "d".repeat(64),
    scope: "subject",
    rootRevision: 3,
    now: 1_000_000,
    ttlMs: 60_000,
  }, secret);
  assert.equal(verifyLearningTreeExportToken(preview.token, secret, 1_030_000).ok, false);
});

test("learning tree preview token rejects missing or invalid diff hash and parser version", () => {
  const minted = mintLearningTreePreviewToken({
    actorId: "u1",
    workspaceId: "w1",
    sourceSha256: "a".repeat(64),
    canonicalPlanHash: "b".repeat(64),
    diffSnapshotHash: "c".repeat(64),
    scope: "subject",
    rootRevision: 1,
    now: 1_000_000,
    ttlMs: 60_000,
  }, secret);
  for (const mutate of [
    (claims: Record<string, unknown>) => { delete claims.diffSnapshotHash; },
    (claims: Record<string, unknown>) => { claims.diffSnapshotHash = "not-a-hash"; },
    (claims: Record<string, unknown>) => { claims.parserVersion = "1.0.0"; },
  ]) {
    const token = resignToken(minted.token, LEARNING_TREE_PREVIEW_PURPOSE, mutate);
    assert.deepEqual(verifyLearningTreePreviewToken(token, secret, 1_030_000), {
      ok: false,
      reason: "malformed",
    });
  }
  assert.throws(() => mintLearningTreePreviewToken({
    actorId: "u1",
    workspaceId: "w1",
    sourceSha256: "bad",
    canonicalPlanHash: "b".repeat(64),
    diffSnapshotHash: "c".repeat(64),
    scope: "subject",
    rootRevision: 1,
  }, secret), /Invalid learning tree preview token claims/);
});

test("expired learning tree preview token retains only signature-validated claims", () => {
  const minted = mintLearningTreePreviewToken({
    actorId: "u1",
    workspaceId: "w1",
    sourceSha256: "a".repeat(64),
    canonicalPlanHash: "b".repeat(64),
    diffSnapshotHash: "c".repeat(64),
    scope: "branch",
    rootRevision: 2,
    now: 1_000_000,
    ttlMs: 1_000,
  }, secret);
  const expired = verifyLearningTreePreviewToken(minted.token, secret, 1_002_000);
  if (expired.ok) assert.fail("token should be expired");
  assert.equal(expired.reason, "expired");
  if (expired.reason === "expired") {
    assert.equal(expired.claims.actorId, "u1");
    assert.equal(expired.claims.workspaceId, "w1");
    assert.equal(expired.claims.scope, "branch");
  }

  const tampered = `${minted.token.slice(0, -1)}${minted.token.endsWith("a") ? "b" : "a"}`;
  const rejected = verifyLearningTreePreviewToken(tampered, secret, 1_002_000);
  assert.deepEqual(rejected, { ok: false, reason: "signature" });
});

test("learning tree export token validates parser hash and common claim shapes", () => {
  const minted = mintLearningTreeExportToken({
    actorId: "u1",
    workspaceId: "w1",
    sourceSha256: "a".repeat(64),
    scope: "global",
    rootRevision: 1,
    now: 1_000_000,
    ttlMs: 60_000,
  }, secret);
  for (const mutate of [
    (claims: Record<string, unknown>) => { claims.parserVersion = "1.0.0"; },
    (claims: Record<string, unknown>) => { claims.sourceSha256 = "A".repeat(64); },
    (claims: Record<string, unknown>) => { claims.actorId = " "; },
    (claims: Record<string, unknown>) => { claims.rootRevision = 0; },
    (claims: Record<string, unknown>) => { claims.nonce = "short"; },
  ]) {
    const token = resignToken(minted.token, LEARNING_TREE_EXPORT_PURPOSE, mutate);
    assert.deepEqual(verifyLearningTreeExportToken(token, secret, 1_030_000), {
      ok: false,
      reason: "malformed",
    });
  }
});

function resignToken(
  token: string,
  purpose: string,
  mutate: (claims: Record<string, unknown>) => void,
): string {
  const payload = token.split(".")[0]!;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  mutate(claims);
  const nextPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`${purpose}:${nextPayload}`).digest("base64url");
  return `${nextPayload}.${signature}`;
}
