import assert from "node:assert/strict";
import test from "node:test";
import {
  aiDraftHandoffKey,
  readAiDraftHandoff,
  readAiDraftHandoffEnvelope,
  writeAiDraftHandoff,
} from "./ai-draft-handoff";
import { createMemoryStoragePort } from "./storage-port";

interface CardHandoff {
  title: string;
  body: string;
}

const isCardHandoff = (value: unknown): value is CardHandoff => Boolean(
  value && typeof value === "object"
  && typeof (value as Partial<CardHandoff>).title === "string"
  && typeof (value as Partial<CardHandoff>).body === "string",
);

test("AI handoff storage validates identity, payload, and TTL", () => {
  const storage = createMemoryStoragePort();
  writeAiDraftHandoff(storage, {
    endpoint: "knowledge-card",
    userId: "user-1",
    value: { title: "极限", body: "正文" },
    now: 100,
  });
  assert.deepEqual(readAiDraftHandoff(storage, {
    endpoint: "knowledge-card",
    userId: "user-1",
    isValue: isCardHandoff,
    now: 200,
    ttlMs: 1_000,
  }), { title: "极限", body: "正文" });
  assert.deepEqual(readAiDraftHandoffEnvelope(storage, {
    endpoint: "knowledge-card",
    userId: "user-1",
    isValue: isCardHandoff,
    now: 200,
    ttlMs: 1_000,
  }), {
    version: 1,
    endpoint: "knowledge-card",
    userId: "user-1",
    updatedAt: 100,
    value: { title: "极限", body: "正文" },
  });

  assert.equal(readAiDraftHandoff(storage, {
    endpoint: "knowledge-card",
    userId: "user-1",
    isValue: isCardHandoff,
    now: 1_101,
    ttlMs: 1_000,
  }), null);
  assert.equal(storage.getItem(aiDraftHandoffKey("knowledge-card", "user-1")), null);
});

test("AI handoff storage removes malformed envelopes", () => {
  const storage = createMemoryStoragePort([
    [aiDraftHandoffKey("knowledge-card", "user-1"), JSON.stringify({ version: 1, value: { title: 1 } })],
  ]);
  assert.equal(readAiDraftHandoff(storage, {
    endpoint: "knowledge-card",
    userId: "user-1",
    isValue: isCardHandoff,
  }), null);
  assert.equal(storage.length, 0);
});
