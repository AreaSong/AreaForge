export type WorkspaceSearchResultKind = "SUBJECT" | "TASK" | "KNOWLEDGE_POINT" | "NOTE" | "MISTAKE" | "RESOURCE";

export interface WorkspaceSearchResultDto {
  id: string;
  kind: WorkspaceSearchResultKind;
  label: string;
  href: string;
  visibility: "WORKSPACE" | "OWNER" | "SHARED";
}

export interface WorkspaceSearchResponseDto {
  contractVersion: "workspace-search-v1";
  workspaceId: string;
  query: string;
  results: WorkspaceSearchResultDto[];
  truncated: boolean;
  indexed: false;
}
