import { prisma } from "@areaforge/db";
import { formatBytes } from "@/lib/formatters";

import type { WorkspaceCapacityMetrics } from "@/lib/contracts";

export type { WorkspaceCapacityMetrics };

export async function getWorkspaceCapacityMetrics(
  actorId: string,
  workspaceId?: string | null,
): Promise<WorkspaceCapacityMetrics> {
  if (!workspaceId) {
    return createEmptyCapacityMetrics();
  }

  try {
    const [
      activeSubjectCount,
      syllabusNodeCount,
      knowledgePointCount,
      noteCount,
      mistakeCount,
      sessionCount,
      sessionAggregate,
      attachmentCount,
      attachmentAggregate,
    ] = await Promise.all([
      prisma.subject.count({
        where: { workspaceId, archivedAt: null },
      }),
      prisma.syllabusNode.count({
        where: { subject: { workspaceId } },
      }),
      prisma.knowledgePoint.count({
        where: { workspaceId },
      }),
      prisma.note.count({
        where: { subject: { workspaceId }, archivedAt: null },
      }),
      prisma.mistake.count({
        where: { subject: { workspaceId } },
      }),
      prisma.studySession.count({
        where: { subject: { workspaceId } },
      }),
      prisma.studySession.aggregate({
        where: { subject: { workspaceId } },
        _sum: { effectiveMinutes: true },
      }),
      prisma.attachment.count({
        where: {
          OR: [
            { note: { subject: { workspaceId } } },
            { studyResource: { workspaceId } },
          ],
        },
      }),
      prisma.attachment.aggregate({
        where: {
          OR: [
            { note: { subject: { workspaceId } } },
            { studyResource: { workspaceId } },
          ],
        },
        _sum: { sizeBytes: true },
      }),
    ]);

    const totalEffectiveMinutes = sessionAggregate?._sum?.effectiveMinutes || 0;
    const totalSessionMinutes = totalEffectiveMinutes;
    const totalSessionHoursFormatted = `${(totalSessionMinutes / 60).toFixed(1)} h`;
    const totalAttachmentBytes = attachmentAggregate?._sum?.sizeBytes || 0;
    const totalAttachmentBytesFormatted = formatBytes(totalAttachmentBytes);

    return {
      activeSubjectCount,
      syllabusNodeCount,
      knowledgePointCount,
      noteCount,
      mistakeCount,
      sessionCount,
      totalSessionMinutes,
      totalEffectiveMinutes,
      totalSessionHoursFormatted,
      attachmentCount,
      totalAttachmentBytes,
      totalAttachmentBytesFormatted,
    };
  } catch {
    return createEmptyCapacityMetrics();
  }
}

export function createEmptyCapacityMetrics(): WorkspaceCapacityMetrics {
  return {
    activeSubjectCount: 0,
    syllabusNodeCount: 0,
    knowledgePointCount: 0,
    noteCount: 0,
    mistakeCount: 0,
    sessionCount: 0,
    totalSessionMinutes: 0,
    totalEffectiveMinutes: 0,
    totalSessionHoursFormatted: "0.0 h",
    attachmentCount: 0,
    totalAttachmentBytes: 0,
    totalAttachmentBytesFormatted: formatBytes(0),
  };
}
