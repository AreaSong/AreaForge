import {
  buildSimulationRemediationOriginKey,
  SIMULATION_LOSS_REASONS,
  type SimulationLossReason,
} from "@areaforge/core";
import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  SubjectMergeCounts,
  SubjectMergeKnowledgeLinkPreimage,
  SubjectMergeReferencePreimage,
  SubjectMergeScope,
} from "./subject-merge-support";

type MergeTx = Prisma.TransactionClient;

export interface SubjectReferenceMigrationResult {
  counts: SubjectMergeCounts;
  deduplicatedRelatedKnowledgePointLinks: number;
  relatedKnowledgePointLinks: SubjectMergeKnowledgeLinkPreimage[];
}

export async function collectSubjectMergeScope(
  tx: MergeTx,
  sourceSubjectIds: string[],
): Promise<SubjectMergeScope> {
  const [
    studyTaskIds,
    studySessionIds,
    syllabusNodeIds,
    noteIds,
    mistakeIds,
    simulationSubjectResultIds,
    planMilestoneIds,
    planInboxItemIds,
    studyResourceIds,
    primaryKnowledgePointIds,
    relatedKnowledgePointLinkIds,
    knowledgeGroupIds,
    learningArrangementIds,
  ] = await Promise.all([
    tx.studyTask.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.studySession.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.syllabusNode.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.note.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.mistake.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.simulationSubjectResult.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.planMilestone.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.planInboxItem.findMany({
      where: { subjectId: { in: sourceSubjectIds } },
      select: {
        id: true,
        subjectId: true,
        originType: true,
        originKey: true,
        originVersion: true,
        stableKey: true,
        originSnapshot: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.studyResource.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.knowledgePoint.findMany({ where: { primarySubjectId: { in: sourceSubjectIds } }, select: { id: true, primarySubjectId: true } }),
    tx.knowledgePointSubject.findMany({
      where: { subjectId: { in: sourceSubjectIds } },
      select: { id: true, subjectId: true, knowledgePointId: true, role: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.knowledgeGroup.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
    tx.learningArrangement.findMany({ where: { subjectId: { in: sourceSubjectIds } }, select: { id: true, subjectId: true } }),
  ]);
  return {
    studyTasks: references(studyTaskIds),
    studySessions: references(studySessionIds),
    syllabusNodes: references(syllabusNodeIds),
    notes: references(noteIds),
    mistakes: references(mistakeIds),
    simulationSubjectResults: references(simulationSubjectResultIds),
    planMilestones: references(planMilestoneIds),
    planInboxItems: planInboxItemIds.map((row) => ({
      id: row.id,
      sourceSubjectId: row.subjectId!,
      originType: row.originType,
      originKey: row.originKey,
      originVersion: row.originVersion,
      stableKey: row.stableKey,
      originSnapshot: row.originSnapshot,
    })),
    studyResources: references(studyResourceIds),
    primaryKnowledgePoints: primaryKnowledgePointIds.map((row) => ({
      id: row.id,
      sourceSubjectId: row.primarySubjectId,
    })).sort(compareReferences),
    relatedKnowledgePointLinks: relatedKnowledgePointLinkIds.map((row) => ({
      id: row.id,
      sourceSubjectId: row.subjectId,
      knowledgePointId: row.knowledgePointId,
      role: row.role,
      createdAt: row.createdAt.toISOString(),
      disposition: null,
    })),
    knowledgeGroups: references(knowledgeGroupIds),
    learningArrangements: references(learningArrangementIds),
  };
}

export async function migrateSubjectReferences(
  tx: MergeTx,
  targetSubjectId: string,
  sourceSubjectIds: string[],
  scope: SubjectMergeScope,
): Promise<SubjectReferenceMigrationResult> {
  const counts = emptyCounts();
  counts.studyTasks = await updateSubjectReferences(tx.studyTask, targetSubjectId, sourceSubjectIds);
  counts.studySessions = await updateSubjectReferences(tx.studySession, targetSubjectId, sourceSubjectIds);
  counts.syllabusNodes = await updateSubjectReferences(tx.syllabusNode, targetSubjectId, sourceSubjectIds);
  counts.notes = await updateSubjectReferences(tx.note, targetSubjectId, sourceSubjectIds);
  counts.mistakes = await updateSubjectReferences(tx.mistake, targetSubjectId, sourceSubjectIds);
  counts.simulationSubjectResults = await updateSubjectReferences(
    tx.simulationSubjectResult,
    targetSubjectId,
    sourceSubjectIds,
  );
  counts.planMilestones = await updateSubjectReferences(tx.planMilestone, targetSubjectId, sourceSubjectIds);
  counts.planInboxItems = await migratePlanInboxItems(tx, targetSubjectId, sourceSubjectIds, scope);
  counts.studyResources = await updateSubjectReferences(tx.studyResource, targetSubjectId, sourceSubjectIds);
  counts.primaryKnowledgePoints = (
    await tx.knowledgePoint.updateMany({
      where: { primarySubjectId: { in: sourceSubjectIds } },
      data: { primarySubjectId: targetSubjectId },
    })
  ).count;
  counts.knowledgeGroups = await updateSubjectReferences(tx.knowledgeGroup, targetSubjectId, sourceSubjectIds);
  counts.learningArrangements = await updateSubjectReferences(
    tx.learningArrangement,
    targetSubjectId,
    sourceSubjectIds,
  );

  const relatedLinks = await migrateRelatedKnowledgePointLinks(tx, targetSubjectId, scope.relatedKnowledgePointLinks);
  counts.relatedKnowledgePointLinks = relatedLinks.processed;
  return {
    counts,
    deduplicatedRelatedKnowledgePointLinks: relatedLinks.deduplicated,
    relatedKnowledgePointLinks: relatedLinks.links,
  };
}

type SubjectUpdateDelegate = {
  updateMany(args: {
    where: { subjectId: { in: string[] } };
    data: { subjectId: string };
  }): Promise<{ count: number }>;
};

async function updateSubjectReferences(
  delegate: SubjectUpdateDelegate,
  targetSubjectId: string,
  sourceSubjectIds: string[],
): Promise<number> {
  return (
    await delegate.updateMany({
      where: { subjectId: { in: sourceSubjectIds } },
      data: { subjectId: targetSubjectId },
    })
  ).count;
}

async function migratePlanInboxItems(
  tx: MergeTx,
  targetSubjectId: string,
  sourceSubjectIds: string[],
  scope: SubjectMergeScope,
): Promise<number> {
  const simulationCount = await migrateSimulationInboxOrigins(tx, targetSubjectId, scope.planInboxItems);
  const remainingCount = (
    await tx.planInboxItem.updateMany({
      where: { subjectId: { in: sourceSubjectIds } },
      data: { subjectId: targetSubjectId },
    })
  ).count;
  return simulationCount + remainingCount;
}

async function migrateSimulationInboxOrigins(
  tx: MergeTx,
  targetSubjectId: string,
  preimages: SubjectMergeScope["planInboxItems"],
): Promise<number> {
  const items = preimages.filter((item) => item.originType === "SIMULATION_LOSS");
  for (const item of items) {
    const merged = buildMergedPlanInboxState(item, targetSubjectId);
    await tx.planInboxItem.update({
      where: { id: item.id },
      data: {
        subjectId: merged.subjectId,
        originKey: merged.originKey,
        stableKey: merged.stableKey,
        originSnapshot: merged.originSnapshot as Prisma.InputJsonObject,
        revision: { increment: 1 },
      },
    });
  }
  return items.length;
}

export function buildMergedPlanInboxState(
  item: SubjectMergeScope["planInboxItems"][number],
  targetSubjectId: string,
): Pick<typeof item, "originType" | "originKey" | "originVersion" | "stableKey" | "originSnapshot"> & {
  subjectId: string;
} {
  if (item.originType !== "SIMULATION_LOSS") {
    return {
      subjectId: targetSubjectId,
      originType: item.originType,
      originKey: item.originKey,
      originVersion: item.originVersion,
      stableKey: item.stableKey,
      originSnapshot: item.originSnapshot,
    };
  }
  const snapshot = asJsonRecord(item.originSnapshot);
  const examId = stringField(snapshot, "examId");
  const reason = simulationLossReasonField(snapshot, "reason");
  const syllabusNodeId = optionalStringField(snapshot, "syllabusNodeId");
  if (!examId || !reason) {
    throw new ApiError("SUBJECT_MERGE_SIMULATION_ORIGIN_INVALID", 409, {
      conflictFields: ["planInboxItem.originSnapshot"],
      workbench: "/settings/exams",
    });
  }
  const originKey = buildSimulationRemediationOriginKey({
    examId,
    subjectId: targetSubjectId,
    reason,
    syllabusNodeId,
  });
  return {
    subjectId: targetSubjectId,
    originType: item.originType,
    originKey,
    originVersion: item.originVersion,
    stableKey: `${originKey}:v${item.originVersion}`,
    originSnapshot: { ...snapshot, subjectId: targetSubjectId } as Prisma.JsonObject,
  };
}

async function migrateRelatedKnowledgePointLinks(
  tx: MergeTx,
  targetSubjectId: string,
  sourceLinks: SubjectMergeKnowledgeLinkPreimage[],
): Promise<{ processed: number; deduplicated: number; links: SubjectMergeKnowledgeLinkPreimage[] }> {
  if (sourceLinks.length === 0) return { processed: 0, deduplicated: 0, links: [] };

  const targetLinkPoints = new Set((await tx.knowledgePointSubject.findMany({
    where: {
      subjectId: targetSubjectId,
      knowledgePointId: { in: sourceLinks.map((link) => link.knowledgePointId) },
    },
    select: { knowledgePointId: true },
  })).map((link) => link.knowledgePointId));
  const linksByPoint = new Map<string, typeof sourceLinks>();
  for (const link of sourceLinks) {
    const list = linksByPoint.get(link.knowledgePointId) ?? [];
    list.push(link);
    linksByPoint.set(link.knowledgePointId, list);
  }

  const deleteIds: string[] = [];
  const updateIds: string[] = [];
  for (const [knowledgePointId, links] of linksByPoint) {
    if (targetLinkPoints.has(knowledgePointId)) {
      deleteIds.push(...links.map((link) => link.id));
      continue;
    }
    const [keep, ...duplicates] = links;
    if (keep) updateIds.push(keep.id);
    deleteIds.push(...duplicates.map((link) => link.id));
  }
  const deduplicated = deleteIds.length === 0
    ? 0
    : (await tx.knowledgePointSubject.deleteMany({ where: { id: { in: deleteIds } } })).count;
  for (const id of updateIds) {
    await tx.knowledgePointSubject.update({ where: { id }, data: { subjectId: targetSubjectId } });
  }
  const updatedSet = new Set(updateIds);
  const deletedSet = new Set(deleteIds);
  return {
    processed: sourceLinks.length,
    deduplicated,
    links: sourceLinks.map((link) => ({
      ...link,
      disposition: updatedSet.has(link.id) ? "updated" : deletedSet.has(link.id) ? "deleted" : null,
    })),
  };
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

function simulationLossReasonField(
  record: Record<string, Prisma.JsonValue>,
  key: string,
): SimulationLossReason | null {
  const value = stringField(record, key);
  return SIMULATION_LOSS_REASONS.includes(value as SimulationLossReason)
    ? value as SimulationLossReason
    : null;
}

function asJsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function stringField(record: Record<string, Prisma.JsonValue>, key: string): string {
  return typeof record[key] === "string" ? record[key] : "";
}

function optionalStringField(record: Record<string, Prisma.JsonValue>, key: string): string | null {
  return typeof record[key] === "string" && record[key] ? record[key] : null;
}

function references(
  rows: Array<{ id: string; subjectId: string | null }>,
): SubjectMergeReferencePreimage[] {
  return rows.map((row) => ({ id: row.id, sourceSubjectId: row.subjectId! })).sort(compareReferences);
}

function compareReferences(left: SubjectMergeReferencePreimage, right: SubjectMergeReferencePreimage): number {
  return left.id.localeCompare(right.id);
}
