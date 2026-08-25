import { parseSafeMarkdown } from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { ReviewTargetDto } from "@/lib/contracts/review-target";
import {
  knowledgeCardDetailRoute,
  mistakeDetailRoute,
  studyResourceDetailRoute,
  syllabusNodeDetailRoute,
} from "@/lib/navigation/route-helpers";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { masteryStatusForSyllabusLevel, masteryStatusLabel, type SyllabusMasteryPersistenceLevel } from "@/lib/knowledge/mastery-status";

export type { ReviewTargetDto } from "@/lib/contracts/review-target";

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
      include: { subject: { select: { id: true, name: true } } },
    });
    if (!note) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return {
      id: note.id,
      subjectId: note.subjectId,
      type: "NOTE",
      title: note.title,
      subtitle: `${note.subject.name} · ${noteKindLabel(note.kind)}`,
      canonicalHref: knowledgeCardDetailRoute(note.id),
      body: parseSafeMarkdown(note.content),
      revealTitle: null,
      revealBody: [],
      canPass: true,
    };
  }

  if (schedule.targetType === "MISTAKE" && schedule.mistakeId) {
    const mistake = await prisma.mistake.findFirst({
      where: { id: schedule.mistakeId, subject: { workspaceId: workspace.id } },
      include: { subject: { select: { id: true, name: true } } },
    });
    if (!mistake) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    const revealText = [
      `错因：${mistake.cause}`,
      mistake.causeNote ? `\n\n错因说明：${mistake.causeNote}` : "",
      mistake.correctAnswer ? `\n\n标准答案：${mistake.correctAnswer}` : "",
      mistake.correctIdea ? `\n\n正确思路：${mistake.correctIdea}` : "\n\n正确思路尚未记录。",
    ].join("");
    return {
      id: mistake.id,
      subjectId: mistake.subjectId,
      type: "MISTAKE",
      title: mistake.title,
      subtitle: `${mistake.subject.name} · 错题复测`,
      canonicalHref: mistakeDetailRoute(mistake.id),
      body: parseSafeMarkdown(mistake.questionText || mistake.title),
      revealTitle: "标准答案、错因与正确思路",
      revealBody: parseSafeMarkdown(revealText),
      canPass: Boolean(mistake.questionText?.trim()) && mistake.cause !== "UNKNOWN" && Boolean(mistake.correctIdea?.trim()),
    };
  }

  if (schedule.targetType === "STUDY_RESOURCE" && schedule.studyResourceId) {
    const resource = await prisma.studyResource.findFirst({
      where: { id: schedule.studyResourceId, workspaceId: workspace.id },
      include: {
        subject: { select: { id: true, name: true } },
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
      subjectId: resource.subjectId,
      type: "STUDY_RESOURCE",
      title: resource.title,
      subtitle: `${resource.subject?.name ?? "未分科"} · ${resourceCategoryLabel(resource.category)}`,
      canonicalHref: studyResourceDetailRoute(resource.id),
      body: parseSafeMarkdown(`${source}${tags}`),
      revealTitle: null,
      revealBody: [],
      canPass: true,
    };
  }

  if (schedule.targetType === "SYLLABUS_NODE" && schedule.syllabusNodeId) {
    const node = await prisma.syllabusNode.findFirst({
      where: { id: schedule.syllabusNodeId, subject: { workspaceId: workspace.id } },
      include: { subject: { select: { id: true, name: true } } },
    });
    if (!node) throw new ApiError("REVIEW_TARGET_NOT_FOUND", 404);
    return {
      id: node.id,
      subjectId: node.subjectId,
      type: "SYLLABUS_NODE",
      title: node.title,
      subtitle: `${node.subject.name} · ${syllabusKindLabel(node.kind)}`,
      canonicalHref: syllabusNodeDetailRoute(node.id),
      body: parseSafeMarkdown(`当前状态：${syllabusStatusLabel(node.status)}\n\n掌握状态：${masteryStatusLabel(masteryStatusForSyllabusLevel(node.masteryLevel ? node.masteryLevel.toLowerCase() as SyllabusMasteryPersistenceLevel : null))}`),
      revealTitle: null,
      revealBody: [],
      canPass: true,
    };
  }

  throw new ApiError("REVIEW_TARGET_INVALID", 409);
}

function noteKindLabel(value: string) {
  return ({ GENERAL: "通用卡片", CONCEPT: "概念卡片", METHOD: "方法卡片", EXAMPLE: "例题卡片", JOURNAL: "学习记录", SUMMARY: "总结卡片" } as Record<string, string>)[value] ?? "知识卡片";
}

function resourceCategoryLabel(value: string) {
  return ({ BOOK: "书籍", COURSE: "课程", ARTICLE: "文章", PAPER: "试卷", VIDEO: "视频", OTHER: "学习资料" } as Record<string, string>)[value] ?? "学习资料";
}

function syllabusKindLabel(value: string) {
  return ({ SUBJECT: "科目", CHAPTER: "章节", TOPIC: "知识点", PROBLEM_TYPE: "题型专题", subject: "科目", chapter: "章节", topic: "知识点", problem_type: "题型专题" } as Record<string, string>)[value] ?? "考纲节点";
}

function syllabusStatusLabel(value: string) {
  return ({ NOT_STARTED: "未开始", LEARNING: "学习中", COVERED: "已覆盖", NEEDS_REVIEW: "待复习", MASTERED: "已掌握", WEAK: "薄弱", DEFERRED: "延期", not_started: "未开始", learning: "学习中", covered: "已覆盖", needs_review: "待复习", mastered: "已掌握", weak: "薄弱", deferred: "延期" } as Record<string, string>)[value] ?? "未记录";
}
