import assert from "node:assert/strict";
import { test } from "node:test";
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
    scope: "subject",
    rootRevision: 3,
    now: 1_000_000,
    ttlMs: 60_000,
  }, secret);
  assert.equal(verifyLearningTreeExportToken(preview.token, secret, 1_030_000).ok, false);
});
