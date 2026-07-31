import { parseSafeMarkdown, type SafeMarkdownNode } from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";

export interface ReviewTargetDto {
  id: string;
  type: "NOTE" | "MISTAKE" | "STUDY_RESOURCE" | "SYLLABUS_NODE";
  title: string;
  subtitle: string;
  canonicalHref: string;
  body: SafeMarkdownNode[];
  revealTitle: string | null;
  revealBody: SafeMarkdownNode[];
  canPass: boolean;
}

export async function getReviewTarget(actorId: string, scheduleId: string): Promise<ReviewTargetDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const schedule = await prisma.reviewSchedule.findFirst({
    where: { id: scheduleId, workspaceId: workspace.id },
    select: {
      targetType: true,
      noteId: true,
      mistakeId: true,
      studyResourceId: true,
      syllabusNodeId: true,
    },
  });
  if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);

  if (schedule.targetType === "NOTE" && schedule.noteId) {
    const note = await prisma.note.findFirst({
      where: { id: schedule.noteId, subject: { workspaceId: workspace.id } },
      include: { subject: { select: { name: true } } },
    });
    if (!note) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return {
      id: note.id,
      type: "NOTE",
      title: note.title,
      subtitle: `${note.subject.name} · ${note.kind}`,
      canonicalHref: `/knowledge/notes/${note.id}`,
      body: parseSafeMarkdown(note.content),
      revealTitle: null,
      revealBody: [],
      canPass: true,
    };
  }

  if (schedule.targetType === "MISTAKE" && schedule.mistakeId) {
    const mistake = await prisma.mistake.findFirst({
      where: { id: schedule.mistakeId, subject: { workspaceId: workspace.id } },
      include: { subject: { select: { name: true } } },
    });
    if (!mistake) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    const revealText = [
      `错因：${mistake.cause}`,
      mistake.correctIdea ? `\n\n正确思路：${mistake.correctIdea}` : "\n\n正确思路尚未记录。",
    ].join("");
    return {
      id: mistake.id,
      type: "MISTAKE",
      title: mistake.title,
      subtitle: `${mistake.subject.name} · 错题复测`,
      canonicalHref: `/knowledge/mistakes/${mistake.id}`,
      body: parseSafeMarkdown(mistake.source || mistake.title),
      revealTitle: "错因与正确思路",
      revealBody: parseSafeMarkdown(revealText),
      canPass: mistake.cause !== "UNKNOWN" && Boolean(mistake.correctIdea?.trim()),
    };
  }

  if (schedule.targetType === "STUDY_RESOURCE" && schedule.studyResourceId) {
    const resource = await prisma.studyResource.findFirst({
      where: { id: schedule.studyResourceId, workspaceId: workspace.id },
      include: {
        subject: { select: { name: true } },
        attachment: { select: { mimeType: true, originalName: true } },
        tags: { select: { tagDisplay: true } },
      },
    });
    if (!resource) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    const source = resource.sourceType === "FILE"
      ? `${resource.attachment?.originalName ?? "私有文件"} · ${resource.attachment?.mimeType ?? "未知格式"}`
      : `HTTPS 外链 · ${resource.displayHost ?? "未知域名"}`;
    const tags = resource.tags.length ? `\n\n标签：${resource.tags.map((tag) => tag.tagDisplay).join("、")}` : "";
    return {
      id: resource.id,
      type: "STUDY_RESOURCE",
      title: resource.title,
      subtitle: `${resource.subject?.name ?? "未分科"} · ${resource.category}`,
      canonicalHref: `/knowledge/resources/${resource.id}`,
      body: parseSafeMarkdown(`${source}${tags}`),
      revealTitle: null,
      revealBody: [],
      canPass: true,
    };
  }

  if (schedule.targetType === "SYLLABUS_NODE" && schedule.syllabusNodeId) {
    const node = await prisma.syllabusNode.findFirst({
      where: { id: schedule.syllabusNodeId, subject: { workspaceId: workspace.id } },
      include: { subject: { select: { name: true } } },
    });
    if (!node) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return {
      id: node.id,
      type: "SYLLABUS_NODE",
      title: node.title,
      subtitle: `${node.subject.name} · ${node.kind}`,
      canonicalHref: `/knowledge/syllabus/${node.id}`,
      body: parseSafeMarkdown(`当前状态：${node.status}\n\n掌握等级：${node.masteryLevel ?? "尚未记录"}`),
      revealTitle: null,
      revealBody: [],
      canPass: true,
    };
  }

  throw new ApiError("REVIEW_TARGET_INVALID", 409);
}
