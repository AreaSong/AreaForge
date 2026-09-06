import assert from "node:assert/strict";
import test from "node:test";
import { isPlatformOperatorEmail } from "./operator-policy";

test("platform operator identity is server configured and email-normalized", () => {
  assert.equal(isPlatformOperatorEmail("Admin@Example.COM", " admin@example.com "), true);
  assert.equal(isPlatformOperatorEmail("member@example.com", "admin@example.com"), false);
  assert.equal(isPlatformOperatorEmail("admin@example.com"), false);
});
