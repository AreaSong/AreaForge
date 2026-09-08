import type {
  WorkspaceRole,
  WorkspaceShareGrantAccess,
  WorkspaceShareGrantScope,
} from "@areaforge/core";
import type { MistakeDto, NoteDto } from "@/lib/contracts";
import { createJsonRequest, requestApiResult, type ApiResult } from "./client";

export type ShareableResourceType = "NOTE" | "MISTAKE" | "ATTACHMENT";

export interface WorkspaceShareGrantView {
  id: string;
  workspaceId: string;
  resourceOwnerUserId: string;
  scope: WorkspaceShareGrantScope;
  granteeUserId: string | null;
  granteeRole: WorkspaceRole | null;
  resourceType: ShareableResourceType;
  resourceId: string;
  access: WorkspaceShareGrantAccess;
  expiresAt: string | null;
  revokedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedResourceView extends WorkspaceShareGrantView {
  resourceOwnerUserId: string;
}

export interface CoachSuggestionView {
  id: string;
  workspaceId: string;
  authorUserId: string;
  recipientUserId: string;
  sourceGrantId: string;
  sourceResourceType: ShareableResourceType;
  sourceResourceId: string;
  sourceSnapshotHash: string;
  payload: {
    title: string;
    plannedDate: string | null;
    estimatedMinutes: number | null;
    priority: string | null;
    type: string | null;
    subjectId: string | null;
    primaryNodeId: string | null;
  };
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "REVOKED";
  revision: number;
  decidedAt: string | null;
  planInboxItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SharedResourceDetailView =
  | { resourceType: "NOTE"; id: string; title: string; content: string; subjectName: string; updatedAt: string }
  | { resourceType: "MISTAKE"; id: string; title: string; questionText: string | null; cause: string; causeNote: string | null; correctIdea: string | null; subjectName: string; updatedAt: string }
  | { resourceType: "ATTACHMENT"; id: string; originalName: string; mimeType: string; sizeBytes: number; downloadApiPath: string; updatedAt: string };

interface GrantsResponse { grants?: WorkspaceShareGrantView[]; error?: string }
interface SharedResponse { sharedResources?: SharedResourceView[]; error?: string }
interface SuggestionsResponse { suggestions?: CoachSuggestionView[]; error?: string }
interface GrantResponse { grant?: WorkspaceShareGrantView; error?: string }
interface SuggestionResponse { suggestion?: CoachSuggestionView; error?: string }
interface SharedDetailResponse { resource?: SharedResourceDetailView; error?: string }
interface NotesResponse { notes?: NoteDto[]; error?: string }
interface MistakesResponse { mistakes?: MistakeDto[]; error?: string }

export function listWorkspaceShareGrants(workspaceId: string): Promise<ApiResult<GrantsResponse>> {
  return requestApiResult(`/api/exam-workspaces/${encodeURIComponent(workspaceId)}/share-grants`);
}

export function createWorkspaceShareGrant(
  workspaceId: string,
  input: {
    resourceType: ShareableResourceType;
    resourceId: string;
    scope: WorkspaceShareGrantScope;
    granteeUserId?: string | null;
    granteeRole?: WorkspaceRole | null;
    access: WorkspaceShareGrantAccess;
    expiresAt?: string | null;
  },
): Promise<ApiResult<GrantResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/share-grants`,
    createJsonRequest("POST", input),
  );
}

export function revokeWorkspaceShareGrant(
  workspaceId: string,
  grantId: string,
  expectedRevision: number,
): Promise<ApiResult<GrantResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/share-grants/${encodeURIComponent(grantId)}`,
    createJsonRequest("DELETE", { expectedRevision }),
  );
}

export function updateWorkspaceShareGrant(
  workspaceId: string,
  grantId: string,
  input: { expectedRevision: number; access?: WorkspaceShareGrantAccess; expiresAt?: string | null },
): Promise<ApiResult<GrantResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/share-grants/${encodeURIComponent(grantId)}`,
    createJsonRequest("PATCH", input),
  );
}

export function listSharedWithMe(): Promise<ApiResult<SharedResponse>> {
  return requestApiResult("/api/shared-with-me");
}

export function listOwnedNotes(): Promise<ApiResult<NotesResponse>> {
  return requestApiResult("/api/notes");
}

export function listOwnedMistakes(): Promise<ApiResult<MistakesResponse>> {
  return requestApiResult("/api/mistakes");
}

export function listCoachSuggestions(workspaceId?: string): Promise<ApiResult<SuggestionsResponse>> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  return requestApiResult(`/api/coach/suggestions${query}`);
}

export function decideCoachSuggestion(
  suggestionId: string,
  action: "accept" | "reject" | "revoke",
  expectedRevision: number,
): Promise<ApiResult<SuggestionResponse>> {
  return requestApiResult(
    `/api/coach/suggestions/${encodeURIComponent(suggestionId)}`,
    createJsonRequest("PATCH", { action, expectedRevision }),
  );
}

export function createCoachSuggestion(input: {
  workspaceId: string;
  resourceType: ShareableResourceType;
  resourceId: string;
  payload: CoachSuggestionView["payload"];
}): Promise<ApiResult<SuggestionResponse>> {
  return requestApiResult("/api/coach/suggestions", createJsonRequest("POST", input));
}

export function getSharedResourceDetail(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<ApiResult<SharedDetailResponse>> {
  return requestApiResult(`/api/shared-resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`);
}
