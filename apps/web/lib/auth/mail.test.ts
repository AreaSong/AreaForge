import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthMailContent, validateAuthActionUrl } from "./mail";

test("auth mail contains only the action link and minimal product copy", () => {
  const token = "synthetic-token-with-at-least-thirty-two-bytes";
  const url = `https://forge.example.test/auth/reset#token=${token}`;
  const content = buildAuthMailContent("PASSWORD_RESET", url);
  assert.match(content.subject, /重置/);
  assert.match(content.text, new RegExp(token));
  assert.match(content.html, new RegExp(token));
  assert.doesNotMatch(content.text, /\?token=/);
  assert.doesNotMatch(content.text, /Workspace 成员|学习正文|附件/);
});

test("auth action links keep tokens in the fragment and reject query credentials", () => {
  const appUrl = "https://forge.example.test";
  const token = "synthetic-token-with-at-least-thirty-two-bytes";
  const fragmentUrl = `${appUrl}/reset-password#token=${token}`;

  assert.equal(validateAuthActionUrl(fragmentUrl, appUrl), fragmentUrl);
  assert.throws(
    () => validateAuthActionUrl(`${appUrl}/reset-password?token=${token}`, appUrl),
    /configured AreaForge origin/,
  );
  assert.throws(
    () => validateAuthActionUrl(`https://attacker.example/reset-password#token=${token}`, appUrl),
    /configured AreaForge origin/,
  );
});
