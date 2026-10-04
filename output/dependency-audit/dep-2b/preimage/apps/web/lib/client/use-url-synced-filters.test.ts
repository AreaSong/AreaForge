import assert from "node:assert/strict";
import test from "node:test";
import { mergeUrlSyncedFilters } from "./use-url-synced-filters";

test("URL filter patches preserve unrelated canonical values", () => {
  const current = { subject: "math", node: "all", review: "due" };
  assert.deepEqual(mergeUrlSyncedFilters(current, { node: "node-1" }), {
    subject: "math",
    node: "node-1",
    review: "due",
  });
  assert.deepEqual(current, { subject: "math", node: "all", review: "due" });
});
