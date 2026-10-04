import assert from "node:assert/strict";
import test from "node:test";
import {
  COACH_SUGGESTION_CAN_AUTO_APPLY,
  COACH_SUGGESTION_REQUIRES_RECIPIENT_CONFIRMATION,
  hasWorkspaceCapability,
  listWorkspaceCapabilities,
  nextCoachSuggestionStatus,
  validateWorkspaceShareGrantTarget,
} from "./rbac";

test("RBAC 角色矩阵保持最小权限", () => {
  assert.equal(hasWorkspaceCapability("OWNER", "member:role"), true);
  assert.equal(hasWorkspaceCapability("OWNER", "coach:suggest"), true);
  assert.equal(hasWorkspaceCapability("ADMIN", "member:role"), false);
  assert.equal(hasWorkspaceCapability("ADMIN", "member:remove"), true);
  assert.equal(hasWorkspaceCapability("COACH", "coach:suggest"), true);
  assert.equal(hasWorkspaceCapability("MEMBER", "coach:suggest"), false);
  assert.equal(hasWorkspaceCapability("VIEWER", "workspace:manage"), false);
  assert.deepEqual(listWorkspaceCapabilities("VIEWER"), ["workspace:read", "share:manage-self"]);
});

test("分享 grant 目标严格满足 exact-one scope", () => {
  assert.equal(validateWorkspaceShareGrantTarget({ scope: "USER", granteeUserId: " user-1 ", access: "VIEW" }).granteeUserId, "user-1");
  assert.equal(validateWorkspaceShareGrantTarget({ scope: "ROLE", granteeRole: "COACH", access: "COACH" }).granteeRole, "COACH");
  assert.equal(validateWorkspaceShareGrantTarget({ scope: "WORKSPACE", access: "VIEW" }).scope, "WORKSPACE");
  assert.throws(() => validateWorkspaceShareGrantTarget({ scope: "USER", access: "VIEW" }), /TARGET_INVALID/);
  assert.throws(() => validateWorkspaceShareGrantTarget({ scope: "ROLE", granteeRole: "ADMIN", access: "VIEW" }), /TARGET_INVALID/);
  assert.throws(() => validateWorkspaceShareGrantTarget({ scope: "WORKSPACE", access: "COACH" }), /COACH_SCOPE_INVALID/);
});

test("Coach 建议只有一次决策且永不自动应用", () => {
  assert.equal(nextCoachSuggestionStatus("PENDING", "accept"), "ACCEPTED");
  assert.equal(nextCoachSuggestionStatus("PENDING", "reject"), "REJECTED");
  assert.equal(nextCoachSuggestionStatus("PENDING", "revoke"), "REVOKED");
  assert.throws(() => nextCoachSuggestionStatus("ACCEPTED", "reject"), /STATE_CONFLICT/);
  assert.equal(COACH_SUGGESTION_REQUIRES_RECIPIENT_CONFIRMATION, true);
  assert.equal(COACH_SUGGESTION_CAN_AUTO_APPLY, false);
});
