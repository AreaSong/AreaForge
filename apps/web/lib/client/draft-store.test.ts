import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftStore, isDraftAtLeastAsNew } from "@/lib/client/draft-store";
import { createMemoryStoragePort } from "@/lib/client/storage-port";

test("draft store writes and reads a versioned value through an injected port", () => {
  const storage = createMemoryStoragePort();
  const store = createDraftStore(storage);

  store.save("draft", { title: "保留" }, 1000);

  assert.deepEqual(store.load("draft", {
    ttlMs: 5000,
    now: () => 2000,
    isValue: (value): value is { title: string } => Boolean(value && typeof value === "object" && "title" in value && typeof value.title === "string"),
  }), { title: "保留" });
});

test("draft store exposes validated metadata for source precedence", () => {
  const storage = createMemoryStoragePort();
  const store = createDraftStore(storage);
  const isValue = (value: unknown): value is { title: string } => Boolean(
    value && typeof value === "object" && "title" in value && typeof value.title === "string",
  );

  store.save("draft", { title: "较新草稿" }, 42);

  assert.deepEqual(store.loadEnvelope("draft", {
    ttlMs: 100,
    now: () => 50,
    isValue,
  }), {
    updatedAt: 42,
    value: { title: "较新草稿" },
  });
});

test("draft source precedence is monotonic and deterministic on equal timestamps", () => {
  assert.equal(isDraftAtLeastAsNew({ updatedAt: 10 }, null), true);
  assert.equal(isDraftAtLeastAsNew({ updatedAt: 10 }, { updatedAt: 10 }), true);
  assert.equal(isDraftAtLeastAsNew({ updatedAt: 9 }, { updatedAt: 10 }), false);
});

test("draft store removes expired or malformed values without throwing", () => {
  const storage = createMemoryStoragePort([
    ["expired", JSON.stringify({ version: 1, updatedAt: 1, value: { title: "旧" } })],
    ["malformed", "not-json"],
  ]);
  const store = createDraftStore(storage);
  const options = { ttlMs: 10, now: () => 100, isValue: (value: unknown): value is { title: string } => Boolean(value && typeof value === "object" && "title" in value) };

  assert.equal(store.load("expired", options), null);
  assert.equal(storage.getItem("expired"), null);
  assert.equal(store.load("malformed", options), null);
  assert.equal(storage.getItem("malformed"), null);
});

test("draft store tolerates storage failures", () => {
  const failingStorage = {
    getItem: () => { throw new Error("unavailable"); },
    setItem: () => { throw new Error("full"); },
    removeItem: () => { throw new Error("unavailable"); },
  };
  const store = createDraftStore(failingStorage);

  assert.doesNotThrow(() => store.save("draft", { value: true }, 100));
  assert.equal(store.load("draft", { ttlMs: 10, now: () => 100, isValue: (value: unknown): value is unknown => value === value }), null);
  assert.doesNotThrow(() => store.remove("draft"));
});
