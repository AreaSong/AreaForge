import { DataDeleteError, type DataTrashResourceType } from "@areaforge/core";
import type { PrismaClient } from "../generated/prisma/client";

export async function listDeletionCandidates(client: PrismaClient, input: { userId: string; workspaceId: string; resourceType: DataTrashResourceType; query?: string }) {
  const membership = await client.workspaceMembership.findFirst({ where: { userId: input.userId, workspaceId: input.workspaceId,
    status: "ACTIVE", workspace: { status: "ACTIVE" } }, select: { id: true } });
  if (!membership) throw new DataDeleteError("DATA_DELETE_NOT_FOUND");
  const select = { id: true, title: true } as const; const orderBy = { updatedAt: "desc" } as const;
  const title = input.query?.trim() ? { contains: input.query.trim().slice(0, 100), mode: "insensitive" as const } : undefined;
  const where = { ownerUserId: input.userId, subject: { workspaceId: input.workspaceId }, title };
  if (input.resourceType === "Note") return client.note.findMany({ where, select, orderBy, take: 100 });
  if (input.resourceType === "Mistake") return client.mistake.findMany({ where, select, orderBy, take: 100 });
  if (input.resourceType === "StudyTask") return client.studyTask.findMany({ where, select, orderBy, take: 100 });
  if (input.resourceType === "StudyResource") return client.studyResource.findMany({ where: { ownerUserId: input.userId, workspaceId: input.workspaceId, title }, select, orderBy, take: 100 });
  if (input.resourceType === "KnowledgePoint") return client.knowledgePoint.findMany({ where: { userId: input.userId, workspaceId: input.workspaceId, title }, select, orderBy, take: 100 });
  throw new DataDeleteError("DATA_DELETE_SCOPE_INVALID");
}
