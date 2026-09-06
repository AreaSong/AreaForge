import { prisma, type Prisma } from "@areaforge/db";
import { requireRbacFeature } from "@/lib/auth/feature-gates";
import { ApiError } from "@/lib/api/responses";
import { requireSharedResourceAccess, type ShareableResourceType } from "./policy-service";

export type SharedResourceDetailDto =
  | {
      resourceType: "NOTE";
      id: string;
      title: string;
      content: string;
      subjectName: string;
      updatedAt: string;
    }
  | {
      resourceType: "MISTAKE";
      id: string;
      title: string;
      questionText: string | null;
      cause: string;
      causeNote: string | null;
      correctIdea: string | null;
      subjectName: string;
      updatedAt: string;
    }
  | {
      resourceType: "ATTACHMENT";
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      downloadApiPath: string;
      updatedAt: string;
    };

export async function getSharedResourceDetail(
  actorId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<SharedResourceDetailDto> {
  requireRbacFeature();
  return prisma.$transaction(async (tx) => {
    const workspaceId = await resolveAccessibleWorkspaceId(tx, actorId, resourceType, resourceId);
    const access = await requireSharedResourceAccess(tx, { actorId, workspaceId, resourceType, resourceId });
    if (!access.grantId) throw sharedResourceNotFound();

    const detail = await loadRedactedDetail(tx, workspaceId, resourceType, resourceId, access.resource.ownerUserId);
    if (!detail) throw sharedResourceNotFound();
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "WORKSPACE_SHARED_RESOURCE_READ",
        entityType: resourceType,
        entityId: resourceId,
        metadata: { workspaceId, grantId: access.grantId, resourceType },
      },
    });
    return detail;
  });
}

async function resolveAccessibleWorkspaceId(
  tx: Prisma.TransactionClient,
  actorId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<string> {
  const now = new Date();
  const memberships = await tx.workspaceMembership.findMany({
    where: { userId: actorId, status: "ACTIVE", user: { status: "ACTIVE" }, workspace: { status: "ACTIVE" } },
    select: { workspaceId: true, role: true },
  });
  for (const membership of memberships) {
    const grant = await tx.workspaceShareGrant.findFirst({
      where: {
        workspaceId: membership.workspaceId,
        resourceType,
        resourceId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [{ OR: [
          { scope: "USER", granteeUserId: actorId },
          { scope: "ROLE", granteeRole: membership.role },
          { scope: "WORKSPACE", access: "VIEW" },
        ] }],
      },
      select: { id: true },
    });
    if (grant) return membership.workspaceId;
  }
  throw sharedResourceNotFound();
}

async function loadRedactedDetail(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
  ownerUserId: string,
): Promise<SharedResourceDetailDto | null> {
  if (resourceType === "NOTE") {
    const note = await tx.note.findFirst({
      where: { id: resourceId, ownerUserId, archivedAt: null, subject: { workspaceId, archivedAt: null } },
      select: { id: true, title: true, content: true, updatedAt: true, subject: { select: { name: true } } },
    });
    return note && {
      resourceType,
      id: note.id,
      title: note.title,
      content: note.content,
      subjectName: note.subject.name,
      updatedAt: note.updatedAt.toISOString(),
    };
  }
  if (resourceType === "MISTAKE") {
    const mistake = await tx.mistake.findFirst({
      where: { id: resourceId, ownerUserId, archivedAt: null, subject: { workspaceId, archivedAt: null } },
      select: {
        id: true,
        title: true,
        questionText: true,
        cause: true,
        causeNote: true,
        correctIdea: true,
        updatedAt: true,
        subject: { select: { name: true } },
      },
    });
    return mistake && {
      resourceType,
      id: mistake.id,
      title: mistake.title,
      questionText: mistake.questionText,
      cause: mistake.cause,
      causeNote: mistake.causeNote,
      correctIdea: mistake.correctIdea,
      subjectName: mistake.subject.name,
      updatedAt: mistake.updatedAt.toISOString(),
    };
  }
  const attachment = await tx.attachment.findFirst({
    where: {
      id: resourceId,
      ownerUserId,
      status: "READY",
      OR: [
        { note: { archivedAt: null, subject: { workspaceId, archivedAt: null } } },
        { studyResource: { workspaceId, archivedAt: null } },
      ],
    },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, updatedAt: true },
  });
  return attachment && {
    resourceType,
    id: attachment.id,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    downloadApiPath: `/api/attachments/${attachment.id}`,
    updatedAt: attachment.updatedAt.toISOString(),
  };
}

function sharedResourceNotFound(): ApiError {
  return new ApiError("WORKSPACE_RESOURCE_NOT_FOUND", 404);
}
