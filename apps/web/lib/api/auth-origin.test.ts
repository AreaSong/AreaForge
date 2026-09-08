import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedRequestOrigin } from "./auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("same-origin mutations bind to configured APP_URL instead of a forwarded Host header", () => {
  assert.equal(isAllowedRequestOrigin("https://forge.example", "https://forge.example/app"), true);
  assert.equal(isAllowedRequestOrigin("https://evil.example", "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin("https://forge.example.evil.test", "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin("https://forge.example/path", "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin(null, "https://forge.example"), false);
  assert.equal(isAllowedRequestOrigin("not-a-url", "https://forge.example"), false);
});

test("共享认证边界覆盖所有已认证 mutation", () => {
  const source = readFileSync(resolve(process.cwd(), "lib/api/auth.ts"), "utf8");
  assert.match(source, /if \(!isSafeReadMethod\(request\.method\)\) requireSameOrigin\(request\)/);
  assert.match(source, /return method === "GET" \|\| method === "HEAD" \|\| method === "OPTIONS"/);
});
