export type WorkspaceSearchResultKind = "SUBJECT" | "TASK" | "KNOWLEDGE_POINT" | "NOTE" | "MISTAKE" | "RESOURCE";

export interface WorkspaceSearchResultDto {
  id: string;
  kind: WorkspaceSearchResultKind;
  label: string;
  href: string;
  visibility: "WORKSPACE" | "OWNER" | "SHARED";
}

export interface WorkspaceSearchResponseDto {
  contractVersion: "workspace-search-v2";
  workspaceId: string;
  query: string;
  results: WorkspaceSearchResultDto[];
  truncated: boolean;
  indexed: boolean;
  indexState: "DISABLED" | "MISSING" | "STALE" | "CURRENT";
  indexedAt: string | null;
}
