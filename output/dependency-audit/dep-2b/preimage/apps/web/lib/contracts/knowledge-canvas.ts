import type { KnowledgeCanvasEdgeInput, KnowledgeCanvasEntityType } from "@areaforge/core";

export interface KnowledgeCanvasNodeDto {
  id: string;
  entityType: KnowledgeCanvasEntityType;
  entityId: string;
  label: string;
  subjectId: string | null;
  parentId: string | null;
  href: string | null;
  x: number | null;
  y: number | null;
  collapsed: boolean;
  pinned: boolean;
  hidden: boolean;
  contextOnly: boolean;
}

export interface KnowledgeCanvasEdgeDto {
  id: string;
  sourceId: string;
  targetId: string;
  kind: KnowledgeCanvasEdgeInput["kind"];
}

export interface KnowledgeCanvasLayoutDto {
  workspaceId: string;
  revision: number;
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  hasSavedLayout: boolean;
  updatedAt: string;
  staleLayoutCandidates: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }>;
}

export interface KnowledgeCanvasQueryDto {
  workspaceId: string;
  focusId: string;
  depth: number;
  syncedAt: string;
  nodes: KnowledgeCanvasNodeDto[];
  hiddenNodes: KnowledgeCanvasNodeDto[];
  edges: KnowledgeCanvasEdgeDto[];
  list: Array<{
    id: string;
    entityType: KnowledgeCanvasEntityType;
    label: string;
    href: string | null;
    subjectId: string | null;
  }>;
  nextCursor: string | null;
  truncated: boolean;
  graphNodeCount: number;
  graphEdgeCount: number;
  pageContextTruncated: boolean;
  loadStats: {
    candidateRowsRead: number;
    ancestorRowsRead: number;
    relationRowsRead: number;
    returnedNodeRows: number;
    returnedEdgeRows: number;
    candidateWindowLimit: number;
    relationWindowLimit: number;
    layoutRowsRead: number;
    staleLayoutRowsRead: number;
  };
  filterOptions: {
    subjects: Array<{ id: string; label: string }>;
  };
  layout: KnowledgeCanvasLayoutDto;
}
