import { deriveMergedSimulationOriginKey } from "./subject-merge-preview-conflicts";
import type { Prisma, PrismaClient } from "@areaforge/db";
import type { SubjectReferenceDetailDto } from "@/lib/contracts/workspace";

type PreviewClient = PrismaClient | Prisma.TransactionClient;

// 与迁移相同的科目范围；只读取身份、版本及定位所需字段，绝不读取私有正文。
export async function loadSubjectMergePreviewReferences(client: PreviewClient, subjectIds: string[], actorId: string, targetId = subjectIds[0]) {
  const where = { subjectId: { in: subjectIds } };
  const base = { id: true, subjectId: true, updatedAt: true } as const;
  const owned = { ...base, ownerUserId: true, title: true } as const;
  const personal = { ...base, userId: true, title: true, revision: true } as const;
  const groups = await Promise.all([
    client.studyTask.findMany({ where, select: owned }),
    client.studySession.findMany({ where, select: { ...base, userId: true, status: true } }),
    client.syllabusNode.findMany({ where, select: { ...base, title: true, stableKey: true, revision: true } }),
    client.note.findMany({ where, select: { ...owned, revision: true } }),
    client.mistake.findMany({ where, select: owned }),
    client.simulationSubjectResult.findMany({ where, select: { id: true, subjectId: true, revision: true, simulationExamId: true, simulationExam: { select: { ownerUserId: true, name: true, revision: true } } } }),
    client.planMilestone.findMany({ where, select: { ...owned, revision: true } }),
    client.planInboxItem.findMany({ where, select: { ...owned, revision: true, workspaceId: true, originSnapshot: true, originType: true, originKey: true, originVersion: true, stableKey: true } }),
    client.studyResource.findMany({ where, select: { ...owned, revision: true } }),
    client.knowledgePoint.findMany({ where: { primarySubjectId: { in: subjectIds } }, select: { id: true, primarySubjectId: true, userId: true, title: true, updatedAt: true, revision: true } }),
    client.knowledgePointSubject.findMany({ where, select: { id: true, subjectId: true, knowledgePointId: true, role: true, createdAt: true, knowledgePoint: { select: { userId: true, title: true, revision: true } } } }),
    client.knowledgeGroup.findMany({ where, select: personal }),
    client.learningArrangement.findMany({ where, select: personal }),
  ]);
  const kinds = ["tasks", "sessions", "syllabusNodes", "notes", "mistakes", "simulationSubjectResults", "planMilestones", "planInboxItems", "studyResources", "primaryKnowledgePoints", "relatedKnowledgePoints", "knowledgeGroups", "learningArrangements"] as const;
  const references = groups.flatMap((rows, index) => rows.map(row => ({ kind: kinds[index]!, ...row })));
  references.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const projectedInboxKeys = new Map(groups[7].filter(row => row.originType === "SIMULATION_LOSS").map(row => [
    row.id, row.subjectId === targetId ? row.originKey : deriveMergedSimulationOriginKey(row.originSnapshot, targetId),
  ]));
  const collisions = new Map<string, Set<string>>();
  const collisionKeys = new Map<string, string>();
  for (const row of references) {
    const inboxKey = projectedInboxKeys.get(row.id);
    const key = row.kind === "syllabusNodes" && "stableKey" in row && row.stableKey ? `syllabus:${row.stableKey}`
      : "simulationExamId" in row ? `exam:${row.simulationExamId}`
      : inboxKey && "originVersion" in row ? JSON.stringify([row.workspaceId, row.ownerUserId, inboxKey, row.originVersion]) : null;
    if (!key) continue;
    collisionKeys.set(row.id, key);
    const subjects = collisions.get(key) ?? new Set<string>();
    // 补救来源在同一来源科目内也可能折叠成同键；按记录而非科目计数。
    subjects.add("originVersion" in row ? row.id : "subjectId" in row ? row.subjectId! : row.primarySubjectId);
    collisions.set(key, subjects);
  }
  const details: SubjectReferenceDetailDto[] = [];
  const privateCounts: Record<string, number> = {};
  for (const row of references) {
    const owner = "ownerUserId" in row ? row.ownerUserId : "userId" in row ? row.userId
      : "simulationExam" in row ? row.simulationExam.ownerUserId : "knowledgePoint" in row ? row.knowledgePoint.userId : null;
    if (row.kind !== "syllabusNodes" && owner !== actorId) {
      privateCounts[row.kind] = (privateCounts[row.kind] ?? 0) + 1;
      continue;
    }
    const label = "title" in row ? row.title : "simulationExam" in row ? row.simulationExam.name
      : "knowledgePoint" in row ? row.knowledgePoint.title : "学习活动";
    details.push({
      kind: row.kind, id: row.id,
      subjectId: "subjectId" in row ? row.subjectId! : row.primarySubjectId,
      conflict: projectedInboxKeys.has(row.id) && !projectedInboxKeys.get(row.id) ? "模拟补救来源无效"
        : (collisions.get(collisionKeys.get(row.id) ?? "")?.size ?? 0) > 1 ? "合并后唯一键冲突" : null,
      label, key: projectedInboxKeys.has(row.id) && "originVersion" in row
        ? `${projectedInboxKeys.get(row.id) ?? "无效来源"} · 版本 ${row.originVersion}` : "simulationExamId" in row ? row.simulationExamId : "stableKey" in row ? row.stableKey : null,
      href: referenceHref(row.kind, "simulationExamId" in row ? row.simulationExamId : "knowledgePointId" in row ? row.knowledgePointId : row.id),
    });
  }
  return { references, details, privateCounts };
}

function referenceHref(kind: string, id: string): string | null {
  const prefix: Record<string, string> = {
    planInboxItems: "/roadmap/allocation/drafts/", tasks: "/roadmap/allocation/tasks/", simulationSubjectResults: "/test/simulations/",
    syllabusNodes: "/knowledge/syllabi/", notes: "/knowledge/cards/", mistakes: "/knowledge/mistakes/",
    studyResources: "/knowledge/resources/", primaryKnowledgePoints: "/knowledge/points/", relatedKnowledgePoints: "/knowledge/points/",
  };
  return prefix[kind] ? prefix[kind] + encodeURIComponent(id) : null;
}
