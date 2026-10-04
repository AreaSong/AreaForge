import assert from "node:assert/strict";
import test from "node:test";
import { maskEmail, OPERATOR_ACCOUNT_REASON_CODES } from "./account-management-service";

test("operator account DTO helpers keep emails masked and reasons closed", () => {
  assert.equal(maskEmail("Alice.Smith@example.com"), "al******@e***.com");
  assert.equal(maskEmail("a@x.io"), "a*@x*.io");
  assert.deepEqual(OPERATOR_ACCOUNT_REASON_CODES, [
    "SECURITY_REVIEW",
    "USER_REQUEST",
    "ABUSE_PREVENTION",
    "INCIDENT_RESPONSE",
  ]);
});
