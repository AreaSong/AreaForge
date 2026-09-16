import { createJsonRequest, requestApiResult, type ApiResult } from "./client";
import { workspaceMemberQuotaErrorText } from "./workspace-member-quota-errors";

export interface WorkspaceMemberView {
  id: string;
  userId: string;
  email: string;
  role: "OWNER" | "ADMIN" | "COACH" | "MEMBER" | "VIEWER";
  status: "ACTIVE" | "LEFT" | "REMOVED";
  revision: number;
  joinedAt: string;
}

export type WorkspaceRoleMemberView = WorkspaceMemberView;

export interface WorkspaceCapabilitiesView {
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "COACH" | "MEMBER" | "VIEWER";
  capabilities: string[];
}

export interface WorkspaceInvitationView {
  id: string;
  workspaceId: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  revision: number;
  expiresAt: string;
  createdAt: string;
}

export interface WorkspaceInvitationPreviewView {
  workspaceName: string;
  invitedEmail: string;
  expiresAt: string;
}

interface MembershipResponse {
  ok?: boolean;
  error?: string;
  members?: WorkspaceMemberView[];
  invitations?: WorkspaceInvitationView[];
  invitation?: WorkspaceInvitationView;
  invitationPreview?: WorkspaceInvitationPreviewView;
  workspaceId?: string;
  createdAccount?: boolean;
  membership?: WorkspaceRoleMemberView;
  capability?: WorkspaceCapabilitiesView;
}

export function getWorkspaceCapabilities(workspaceId: string): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(`/api/exam-workspaces/${encodeURIComponent(workspaceId)}/capabilities`);
}

export function updateWorkspaceMemberRole(
  workspaceId: string,
  membershipId: string,
  input: { role: "ADMIN" | "COACH" | "MEMBER" | "VIEWER"; expectedRevision: number },
): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(membershipId)}/role`,
    createJsonRequest("PATCH", input),
  );
}

export function previewWorkspaceInvitation(token: string): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult("/api/workspace-invitations/preview", createJsonRequest("POST", { token }));
}

export function getWorkspaceMembers(workspaceId: string): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(`/api/exam-workspaces/${encodeURIComponent(workspaceId)}/members`);
}

export function getWorkspaceInvitations(workspaceId: string): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(`/api/exam-workspaces/${encodeURIComponent(workspaceId)}/invitations`);
}

export function inviteWorkspaceMember(workspaceId: string, email: string): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/invitations`,
    createJsonRequest("POST", { email }),
  );
}

export function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
  expectedRevision: number,
): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
    createJsonRequest("DELETE", { expectedRevision }),
  );
}

export function removeWorkspaceMember(
  workspaceId: string,
  membershipId: string,
  expectedRevision: number,
): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(membershipId)}`,
    createJsonRequest("DELETE", { expectedRevision }),
  );
}

export function leaveWorkspace(workspaceId: string, expectedRevision: number): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/members/leave`,
    createJsonRequest("POST", { expectedRevision }),
  );
}

export function transferWorkspaceOwnership(
  workspaceId: string,
  input: { targetMembershipId: string; expectedOwnerRevision: number; expectedTargetRevision: number },
): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/members/transfer`,
    createJsonRequest("POST", input),
  );
}

export function acceptWorkspaceInvitation(token: string, password?: string): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult("/api/workspace-invitations/accept", createJsonRequest("POST", { token, password }));
}

export function rejectWorkspaceInvitation(token: string): Promise<ApiResult<MembershipResponse>> {
  return requestApiResult("/api/workspace-invitations/reject", createJsonRequest("POST", { token }));
}

export function invitationAcceptErrorText(result: Pick<ApiResult<MembershipResponse>, "status" | "body">): string {
  const quota = workspaceMemberQuotaErrorText(result.body?.error);
  if (quota) return quota;
  if (result.status === 0) return "网络连接不可用，请恢复后重试。";
  if (result.body?.error === "WORKSPACE_INVITATION_CONTINUATION_REQUIRED") {
    return "请使用受邀账户登录，或检查邀请是否仍有效；新账户需要设置符合策略的密码。";
  }
  if (result.status >= 500) return "邀请服务暂时不可用，请稍后重试。";
  return "邀请无效、已使用或已过期。";
}

export function invitationPreviewFailure(result: Pick<ApiResult<MembershipResponse>, "status" | "body">) {
  const retryable = result.status === 0 || result.status >= 500;
  return { retryable, message: result.status === 0 ? "网络连接不可用，请恢复后重试。"
    : retryable ? "暂时无法读取邀请，请稍后重试。" : "邀请无效、已使用或已过期。" };
}
