import { z } from "zod";
import {
  KNOWLEDGE_CANVAS_ENTITY_TYPES,
  KNOWLEDGE_CANVAS_MAX_RENDERED_NODES,
} from "@areaforge/core";

export const knowledgeCanvasLayoutNodeSchema = z.object({
  entityType: z.enum(KNOWLEDGE_CANVAS_ENTITY_TYPES),
  entityId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  collapsed: z.boolean().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

export const knowledgeCanvasLayoutPutSchema = z.object({
  workspaceId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  viewportX: z.number().finite().optional(),
  viewportY: z.number().finite().optional(),
  viewportZoom: z.number().finite().positive().optional(),
  nodes: z.array(knowledgeCanvasLayoutNodeSchema).max(KNOWLEDGE_CANVAS_MAX_RENDERED_NODES).optional(),
}).superRefine((value, context) => {
  const keys = new Set<string>();
  for (const [index, node] of (value.nodes ?? []).entries()) {
    const key = `${node.entityType}:${node.entityId}`;
    if (keys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["nodes", index],
        message: "DUPLICATE_LAYOUT_NODE",
      });
    }
    keys.add(key);
  }
});

export const knowledgeCanvasLayoutDeleteSchema = z.object({
  workspaceId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});

export const knowledgeCanvasLayoutConflictSnapshotSchema = z.object({
  workspaceId: z.string().min(1),
  revision: z.number().int().positive(),
  viewportX: z.number().finite(),
  viewportY: z.number().finite(),
  viewportZoom: z.number().finite().positive(),
  hasSavedLayout: z.boolean(),
  updatedAt: z.string().datetime(),
  nodes: z.array(knowledgeCanvasLayoutNodeSchema),
});

export const knowledgeCanvasLayoutConflictResponseSchema = z.object({
  error: z.literal("LAYOUT_REVISION_CONFLICT"),
  latest: knowledgeCanvasLayoutConflictSnapshotSchema,
  conflictFields: z.array(z.string().min(1)),
});

export type KnowledgeCanvasLayoutConflictSnapshot = z.infer<
  typeof knowledgeCanvasLayoutConflictSnapshotSchema
>;
