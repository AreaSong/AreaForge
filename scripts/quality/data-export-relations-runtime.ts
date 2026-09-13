import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../packages/db/src/index";
import { createAttachmentUri } from "../../packages/storage/src/index";
import type { ExportFixture } from "./data-export-runtime-fixture";

export async function seedExportRelationEvidence(f: ExportFixture) {
  const refs = new Map<string, Record<string, string>>();
  for (let index = 0; index < 2; index += 1) {
    const storedName = `${randomUUID().replaceAll("-", "")}.png`;
    await writeFile(path.join(f.roots.uploadRoot, storedName), f.fileBytes, { flag: "wx", mode: 0o600 });
    const attachment = await prisma.attachment.create({ data: { ownerUserId: f.actor.id, originalName: "same-name.png",
      storedName, uri: createAttachmentUri(storedName), mimeType: "image/png", sizeBytes: f.fileBytes.length,
      hash: f.attachment.hash, status: "READY", finalizedAt: new Date() } });
    const resource = await prisma.studyResource.create({ data: { ownerUserId: f.actor.id, workspaceId: f.workspace.id,
      stableKey: `file-${index}`, title: `同名附件资料 ${index}`, sourceType: "FILE", attachmentId: attachment.id } });
    refs.set(`studyResource/${resource.id}`, { attachmentId: attachment.id });
  }
  const schedule = await prisma.reviewSchedule.create({ data: { ownerUserId: f.actor.id, workspaceId: f.workspace.id,
    targetType: "NOTE", noteId: f.note.id, dueDate: new Date() } });
  const task = await prisma.studyTask.create({ data: { ownerUserId: f.actor.id, subjectId: f.subject.id, title: "复习来源任务",
    type: "review", plannedDate: new Date(), reviewScheduleId: schedule.id } });
  refs.set(`studyTask/${task.id}`, { reviewScheduleId: schedule.id });
  const retest = await prisma.knowledgeRetest.create({ data: { userId: f.actor.id, workspaceId: f.workspace.id, title: "关联复测", method: "SELF_TEST" } });
  const exams = await Promise.all([1, 2].map(index => prisma.simulationExam.create({ data: { ownerUserId: f.actor.id,
    workspaceId: f.workspace.id, name: `关联模拟 ${index}`, examDate: new Date() } })));
  for (const reference of [{ reviewScheduleId: schedule.id }, { knowledgeRetestId: retest.id }, { simulationExamId: exams[1]!.id }]) {
    const session = await prisma.studySession.create({ data: { userId: f.actor.id, workspaceId: f.workspace.id, subjectId: f.subject.id,
      startedAt: new Date(), endedAt: new Date(), status: "COMPLETED", ...reference } });
    refs.set(`studySession/${session.id}`, Object.fromEntries(Object.entries(reference).filter((pair): pair is [string, string] => typeof pair[1] === "string")));
  }
  return refs;
}
