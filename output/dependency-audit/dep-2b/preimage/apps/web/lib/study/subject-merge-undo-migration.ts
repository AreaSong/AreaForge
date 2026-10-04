import { stableStringify } from "@areaforge/core";
import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  SubjectMergeCounts,
  SubjectMergeReferencePreimage,
  SubjectMergeScope,
} from "./subject-merge-support";
import { buildMergedPlanInboxState } from "./subject-merge-migration";

type MergeTx = Prisma.TransactionClient;

export async function assertSubjectMergeScopeStillAtTarget(
  tx: MergeTx,
  targetSubjectId: string,
  scope: SubjectMergeScope,
): Promise<void> {
  const checks = await Promise.all([
    tx.studyTask.count({ where: { id: { in: ids(scope.studyTasks) }, subjectId: targetSubjectId } }),
    tx.studySession.count({ where: { id: { in: ids(scope.studySessions) }, subjectId: targetSubjectId } }),
    tx.syllabusNode.count({ where: { id: { in: ids(scope.syllabusNodes) }, subjectId: targetSubjectId } }),
    tx.note.count({ where: { id: { in: ids(scope.notes) }, subjectId: targetSubjectId } }),
    tx.mistake.count({ where: { id: { in: ids(scope.mistakes) }, subjectId: targetSubjectId } }),
    tx.simulationSubjectResult.count({ where: { id: { in: ids(scope.simulationSubjectResults) }, subjectId: targetSubjectId } }),
    tx.planMilestone.count({ where: { id: { in: ids(scope.planMilestones) }, subjectId: targetSubjectId } }),
    countStablePlanInboxItems(tx, targetSubjectId, scope.planInboxItems),
    tx.studyResource.count({ where: { id: { in: ids(scope.studyResources) }, subjectId: targetSubjectId } }),
    tx.knowledgePoint.count({ where: { id: { in: ids(scope.primaryKnowledgePoints) }, primarySubjectId: targetSubjectId } }),
    tx.knowledgeGroup.count({ where: { id: { in: ids(scope.knowledgeGroups) }, subjectId: targetSubjectId } }),
    tx.learningArrangement.count({ where: { id: { in: ids(scope.learningArrangements) }, subjectId: targetSubjectId } }),
    tx.knowledgePointSubject.count({
      where: {
        id: { in: scope.relatedKnowledgePointLinks.filter((link) => link.disposition === "updated").map((link) => link.id) },
        subjectId: targetSubjectId,
      },
    }),
    tx.knowledgePointSubject.count({
      where: { id: { in: scope.relatedKnowledgePointLinks.filter((link) => link.disposition === "deleted").map((link) => link.id) } },
    }),
  ]);
  const expected = [
    scope.studyTasks.length,
    scope.studySessions.length,
    scope.syllabusNodes.length,
    scope.notes.length,
    scope.mistakes.length,
    scope.simulationSubjectResults.length,
    scope.planMilestones.length,
    scope.planInboxItems.length,
    scope.studyResources.length,
    scope.primaryKnowledgePoints.length,
    scope.knowledgeGroups.length,
    scope.learningArrangements.length,
    scope.relatedKnowledgePointLinks.filter((link) => link.disposition === "updated").length,
    0,
  ];
  const labels = [
    "studyTasks", "studySessions", "syllabusNodes", "notes", "mistakes",
    "simulationSubjectResults", "planMilestones", "planInboxItems", "studyResources",
    "primaryKnowledgePoints", "knowledgeGroups", "learningArrangements",
    "relatedKnowledgePointLinks.updated", "relatedKnowledgePointLinks.deleted",
  ];
  const blockingFields = labels.filter((_, index) => checks[index] !== expected[index]);
  if (blockingFields.length > 0) {
    throw new ApiError("SUBJECT_MERGE_UNDO_SCOPE_CHANGED", 409, {
      conflictFields: blockingFields,
      workbench: "/settings/exams",
    });
  }
}

async function countStablePlanInboxItems(
  tx: MergeTx,
  targetSubjectId: string,
  items: SubjectMergeScope["planInboxItems"],
): Promise<number> {
  const rows = await tx.planInboxItem.findMany({
    where: { id: { in: ids(items) }, subjectId: targetSubjectId },
    select: {
      id: true,
      subjectId: true,
      originType: true,
      originKey: true,
      originVersion: true,
      stableKey: true,
      originSnapshot: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return items.filter((item) => {
    const current = byId.get(item.id);
    if (!current) return false;
    const expected = buildMergedPlanInboxState(item, targetSubjectId);
    return current.subjectId === expected.subjectId
      && current.originType === expected.originType
      && current.originKey === expected.originKey
      && current.originVersion === expected.originVersion
      && current.stableKey === expected.stableKey
      && stableStringify(current.originSnapshot) === stableStringify(expected.originSnapshot);
  }).length;
}

export async function restoreSubjectMergeReferences(
  tx: MergeTx,
  targetSubjectId: string,
  scope: SubjectMergeScope,
): Promise<{ counts: SubjectMergeCounts; recreatedRelatedKnowledgePointLinks: number }> {
  const counts = emptyCounts();
  counts.studyTasks = await restoreGrouped(scope.studyTasks, targetSubjectId, tx.studyTask);
  counts.studySessions = await restoreGrouped(scope.studySessions, targetSubjectId, tx.studySession);
  counts.syllabusNodes = await restoreGrouped(scope.syllabusNodes, targetSubjectId, tx.syllabusNode);
  counts.notes = await restoreGrouped(scope.notes, targetSubjectId, tx.note);
  counts.mistakes = await restoreGrouped(scope.mistakes, targetSubjectId, tx.mistake);
  counts.simulationSubjectResults = await restoreGrouped(
    scope.simulationSubjectResults,
    targetSubjectId,
    tx.simulationSubjectResult,
  );
  counts.planMilestones = await restoreGrouped(scope.planMilestones, targetSubjectId, tx.planMilestone);
  counts.planInboxItems = await restoreInboxItems(tx, targetSubjectId, scope);
  counts.studyResources = await restoreGrouped(scope.studyResources, targetSubjectId, tx.studyResource);
  counts.primaryKnowledgePoints = await restorePrimaryKnowledgePoints(tx, targetSubjectId, scope);
  counts.knowledgeGroups = await restoreGrouped(scope.knowledgeGroups, targetSubjectId, tx.knowledgeGroup);
  counts.learningArrangements = await restoreGrouped(
    scope.learningArrangements,
    targetSubjectId,
    tx.learningArrangement,
  );
  const recreatedRelatedKnowledgePointLinks = await restoreKnowledgePointLinks(tx, targetSubjectId, scope);
  counts.relatedKnowledgePointLinks = scope.relatedKnowledgePointLinks.length;
  return { counts, recreatedRelatedKnowledgePointLinks };
}

type SubjectUpdateDelegate = {
  updateMany(args: {
    where: { id: { in: string[] }; subjectId: string };
    data: { subjectId: string };
  }): Promise<{ count: number }>;
};

async function restoreGrouped(
  rows: SubjectMergeReferencePreimage[],
  targetSubjectId: string,
  delegate: SubjectUpdateDelegate,
): Promise<number> {
  let total = 0;
  for (const [sourceSubjectId, sourceIds] of groupIdsBySource(rows)) {
    const changed = await delegate.updateMany({
      where: { id: { in: sourceIds }, subjectId: targetSubjectId },
      data: { subjectId: sourceSubjectId },
    });
    if (changed.count !== sourceIds.length) throw scopeChanged();
    total += changed.count;
  }
  return total;
}

async function restorePrimaryKnowledgePoints(
  tx: MergeTx,
  targetSubjectId: string,
  scope: SubjectMergeScope,
): Promise<number> {
  let total = 0;
  for (const [sourceSubjectId, sourceIds] of groupIdsBySource(scope.primaryKnowledgePoints)) {
    const changed = await tx.knowledgePoint.updateMany({
      where: { id: { in: sourceIds }, primarySubjectId: targetSubjectId },
      data: { primarySubjectId: sourceSubjectId },
    });
    if (changed.count !== sourceIds.length) throw scopeChanged();
    total += changed.count;
  }
  return total;
}

async function restoreInboxItems(
  tx: MergeTx,
  targetSubjectId: string,
  scope: SubjectMergeScope,
): Promise<number> {
  for (const item of scope.planInboxItems) {
    const changed = await tx.planInboxItem.updateMany({
      where: { id: item.id, subjectId: targetSubjectId },
      data: {
        subjectId: item.sourceSubjectId,
        originKey: item.originKey,
        originVersion: item.originVersion,
        stableKey: item.stableKey,
        originSnapshot: item.originSnapshot as Prisma.InputJsonValue,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw scopeChanged();
  }
  return scope.planInboxItems.length;
}

async function restoreKnowledgePointLinks(
  tx: MergeTx,
  targetSubjectId: string,
  scope: SubjectMergeScope,
): Promise<number> {
  let recreated = 0;
  for (const link of scope.relatedKnowledgePointLinks) {
    if (link.disposition === "updated") {
      const changed = await tx.knowledgePointSubject.updateMany({
        where: { id: link.id, subjectId: targetSubjectId },
        data: { subjectId: link.sourceSubjectId },
      });
      if (changed.count !== 1) throw scopeChanged();
      continue;
    }
    await tx.knowledgePointSubject.create({
      data: {
        id: link.id,
        knowledgePointId: link.knowledgePointId,
        subjectId: link.sourceSubjectId,
        role: link.role,
        createdAt: new Date(link.createdAt),
      },
    });
    recreated += 1;
  }
  return recreated;
}

function groupIdsBySource(rows: SubjectMergeReferencePreimage[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const current = groups.get(row.sourceSubjectId) ?? [];
    current.push(row.id);
    groups.set(row.sourceSubjectId, current);
  }
  return groups;
}

function ids(rows: Array<{ id: string }>): string[] {
  return rows.map((row) => row.id);
}

function scopeChanged(): ApiError {
  return new ApiError("SUBJECT_MERGE_UNDO_SCOPE_CHANGED", 409, {
    conflictFields: ["sourceMapping"],
    workbench: "/settings/exams",
  });
}

function emptyCounts(): SubjectMergeCounts {
  return {
    studyTasks: 0,
    studySessions: 0,
    syllabusNodes: 0,
    notes: 0,
    mistakes: 0,
    simulationSubjectResults: 0,
    planMilestones: 0,
    planInboxItems: 0,
    studyResources: 0,
    primaryKnowledgePoints: 0,
    relatedKnowledgePointLinks: 0,
    knowledgeGroups: 0,
    learningArrangements: 0,
  };
}
