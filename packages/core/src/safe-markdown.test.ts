import assert from "node:assert/strict";
import test from "node:test";
import { parseSafeMarkdown } from "./safe-markdown";

test("safe markdown drops raw HTML, images and unsafe link schemes", () => {
  const projected = parseSafeMarkdown([
    "# Title",
    "",
    "<script>alert(1)</script>",
    "",
    "[bad](javascript:alert(1)) [good](https://example.com/path)",
    "",
    "![remote](https://example.com/tracker.png)",
  ].join("\n"));
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("script"), false);
  assert.equal(serialized.includes("javascript:"), false);
  assert.equal(serialized.includes("tracker.png"), false);
  assert.equal(serialized.includes("https://example.com/path"), true);
  assert.equal(serialized.includes("remote"), true);
});
