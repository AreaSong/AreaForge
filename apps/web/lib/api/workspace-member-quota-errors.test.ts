import assert from "node:assert/strict";
import test from "node:test";
import { invitationAcceptErrorText, invitationPreviewFailure } from "./workspace-membership";
import { workspaceMemberQuotaErrorStatus, workspaceMemberQuotaErrorText } from "./workspace-member-quota-errors";

test("成员席位拒绝与暂时失败不误报为失效邀请，不披露使用量", () => {
  assert.equal(workspaceMemberQuotaErrorStatus("WORKSPACE_MEMBER_QUOTA_LIMIT"), 429);
  assert.equal(workspaceMemberQuotaErrorStatus("WORKSPACE_MEMBER_QUOTA_BUSY"), 503);
  assert.match(invitationAcceptErrorText({ status: 429, body: { error: "WORKSPACE_MEMBER_QUOTA_LIMIT" } }), /席位已满.*释放席位.*再次接受/);
  assert.match(invitationAcceptErrorText({ status: 503, body: { error: "WORKSPACE_MEMBER_QUOTA_BUSY" } }), /成员状态正在变化.*未加入/);
  assert.match(invitationAcceptErrorText({ status: 409, body: { error: "WORKSPACE_INVITATION_CONTINUATION_REQUIRED" } }), /受邀账户.*邀请是否仍有效/);
  assert.match(invitationAcceptErrorText({ status: 0, body: null }), /网络连接不可用/);
  assert.match(invitationAcceptErrorText({ status: 503, body: { error: "UNAVAILABLE" } }), /暂时不可用/);
  for (const code of [undefined, "constructor", "__proto__", "internal-error-with-private-values"]) assert.equal(workspaceMemberQuotaErrorText(code), undefined);
});

test("仅暂时失败可重试预览，不把已消费凭证当成可重复成功", () => {
  for (const status of [0, 500, 503]) assert.equal(invitationPreviewFailure({ status, body: null }).retryable, true);
  for (const status of [400, 404, 409]) assert.equal(invitationPreviewFailure({ status, body: null }).retryable, false);
  assert.match(invitationAcceptErrorText({ status: 404, body: null }), /已使用或已过期/);
});
