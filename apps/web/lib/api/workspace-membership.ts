import { createJsonRequest, requestApiResult, type ApiResult } from "./client";

export interface WorkspaceMemberView {
  id: string;
  userId: string;
  email: string;
  role: "OWNER" | "MEMBER";
  status: "ACTIVE" | "LEFT" | "REMOVED";
  revision: number;
  joinedAt: string;
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
