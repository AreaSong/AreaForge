import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedRequestOrigin } from "./auth";

test("same-origin mutations bind to configured APP_URL instead of a forwarded Host header", () => {
  assert.equal(isAllowedRequestOrigin("https://forge.example", "https://forge.example/app"), true);
  assert.equal(isAllowedRequestOrigin("https://evil.example", "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin("https://forge.example.evil.test", "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin("https://forge.example/path", "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin(null, "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin("not-a-url", "https://forge.example"), false);
});
