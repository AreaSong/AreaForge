import { createHash } from "node:crypto";
import {
  findSubjectDuplicateSets,
  type SubjectDuplicateCandidate,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  SubjectDuplicateSetDto,
  SubjectReferenceCountDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts/workspace";

type SubjectPreviewRow = Awaited<ReturnType<typeof loadSubjectPreviewRows>>[number];

export async function listSubjectDuplicatePreviews(
  actorId: string,
  workspaceId: string,
): Promise<SubjectDuplicateSetDto[]> {
  await assertOwnedWorkspace(actorId, workspaceId);
  const rows = await loadSubjectPreviewRows(workspaceId);
  if (rows.length < 2) return [];

  const referencesById = await buildReferenceCounts(workspaceId, rows);
  const sets = findSubjectDuplicateSets(buildCandidates(rows, referencesById));
  return Promise.all(sets.map(async (set, index) => {
    const targetId = set.recommendedTargetId;
    const sourceIds = set.subjectIds.filter((subjectId) => subjectId !== targetId);
    const [conflictCounts, primaryKnowledgePoints] = await Promise.all([
      previewSubjectMergeConflicts([targetId, ...sourceIds]),
      countPrimaryKnowledgePoints(sourceIds),
    ]);
    const subjects = joinSubjects(set.subjectIds, rows, referencesById);
    const snapshotHash = buildSubjectDuplicateSnapshotHash({
      workspaceId,
      targetId,
      sourceIds,
      reasons: set.reasons,
      subjects,
      conflictCounts,
      primaryKnowledgePoints,
    });
    return {
      id: "duplicate-set-" + (index + 1) + "-" + set.subjectIds.join("-"),
      snapshotHash,
      reasons: set.reasons,
      recommendedTargetId: targetId,
      subjects,
      conflictCounts,
      requiredReassignments: { primaryKnowledgePoints },
      totalReferenceCount: subjects.reduce((sum, item) => sum + item.references.total, 0),
      canAutoApply: false,
      requiresUserConfirmation: true,
    };
  }));
}

export function buildSubjectDuplicateSnapshotHash(input: {
  workspaceId: string;
  targetId: string;
  sourceIds: string[];
  reasons: SubjectDuplicateSetDto["reasons"];
  subjects: SubjectDuplicateSetDto["subjects"];
  conflictCounts: SubjectDuplicateSetDto["conflictCounts"];
  primaryKnowledgePoints: number;
}): string {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    targetId: input.targetId,
    sourceIds: [...input.sourceIds].sort(),
    reasons: input.reasons,
    subjects: input.subjects,
    conflictCounts: input.conflictCounts,
    primaryKnowledgePoints: input.primaryKnowledgePoints,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

async function loadSubjectPreviewRows(workspaceId: string) {
  return prisma.subject.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      _count: {
        select: {
          tasks: true,
          sessions: true,
          syllabusNodes: true,
          notes: true,
          mistakes: true,
          simulationSubjectResults: true,
          planMilestones: true,
          studyResources: true,
          primaryKnowledgePoints: true,
          relatedKnowledgePoints: true,
          knowledgeGroups: true,
          learningArrangements: true,
        },
      },
    },
  });
}

async function buildReferenceCounts(
  workspaceId: string,
  rows: SubjectPreviewRow[],
): Promise<Map<string, SubjectReferenceCountDto>> {
  const subjectIds = rows.map((row) => row.id);
  const [activeSessions, inboxItems] = await Promise.all([
    prisma.studySession.findMany({
      where: { subjectId: { in: subjectIds }, status: { in: ["RUNNING", "PAUSED", "CLOSING"] } },
      select: { subjectId: true },
    }),
    prisma.planInboxItem.findMany({
      where: { workspaceId, subjectId: { in: subjectIds } },
      select: { subjectId: true },
    }),
  ]);
  const activeSessionCounts = countBySubject(activeSessions);
  const inboxCounts = countBySubject(inboxItems);
  return new Map(rows.map((row) => {
    const references = createReferenceCount(row, activeSessionCounts.get(row.id) ?? 0, inboxCounts.get(row.id) ?? 0);
    return [row.id, references];
  }));
}

function createReferenceCount(
  row: SubjectPreviewRow,
  activeSessions: number,
  planInboxItems: number,
): SubjectReferenceCountDto {
  const values = {
    tasks: row._count.tasks,
    sessions: row._count.sessions,
    activeSessions,
    syllabusNodes: row._count.syllabusNodes,
    notes: row._count.notes,
    mistakes: row._count.mistakes,
    simulationSubjectResults: row._count.simulationSubjectResults,
    planMilestones: row._count.planMilestones,
    planInboxItems,
    studyResources: row._count.studyResources,
    primaryKnowledgePoints: row._count.primaryKnowledgePoints,
    relatedKnowledgePoints: row._count.relatedKnowledgePoints,
    knowledgeGroups: row._count.knowledgeGroups,
    learningArrangements: row._count.learningArrangements,
  };
  const total = Object.entries(values)
    .filter(([key]) => key !== "activeSessions")
    .reduce((sum, [, value]) => sum + value, 0);
  return { ...values, total };
}

function buildCandidates(
  rows: SubjectPreviewRow[],
  referencesById: Map<string, SubjectReferenceCountDto>,
): SubjectDuplicateCandidate[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    stableKey: row.stableKey,
    legacyCode: row.legacyCode,
    archived: Boolean(row.archivedAt),
    sortOrder: row.sortOrder,
    referenceCount: referencesById.get(row.id)?.total ?? 0,
  }));
}

function joinSubjects(
  subjectIds: string[],
  rows: SubjectPreviewRow[],
  referencesById: Map<string, SubjectReferenceCountDto>,
): SubjectDuplicateSetDto["subjects"] {
  return subjectIds.flatMap((subjectId) => {
    const row = rows.find((candidate) => candidate.id === subjectId);
    const references = referencesById.get(subjectId);
    return row && references ? [{ subject: serializeSubject(row), references }] : [];
  });
}

async function previewSubjectMergeConflicts(
  candidateIds: string[],
): Promise<SubjectDuplicateSetDto["conflictCounts"]> {
  const [syllabusRows, simulationRows, relatedKnowledgeRows] = await Promise.all([
    prisma.syllabusNode.findMany({
      where: { subjectId: { in: candidateIds }, stableKey: { not: null } },
      select: { subjectId: true, stableKey: true },
    }),
    prisma.simulationSubjectResult.findMany({
      where: { subjectId: { in: candidateIds } },
      select: { subjectId: true, simulationExamId: true },
    }),
    prisma.knowledgePointSubject.findMany({
      where: { subjectId: { in: candidateIds } },
      select: { subjectId: true, knowledgePointId: true },
    }),
  ]);
  return {
    syllabusStableKeys: countCrossSubjectKeys(syllabusRows, (row) => row.stableKey ?? ""),
    simulationExams: countCrossSubjectKeys(simulationRows, (row) => row.simulationExamId),
    relatedKnowledgePoints: countCrossSubjectKeys(relatedKnowledgeRows, (row) => row.knowledgePointId),
  };
}

async function countPrimaryKnowledgePoints(sourceIds: string[]): Promise<number> {
  return sourceIds.length === 0
    ? 0
    : prisma.knowledgePoint.count({ where: { primarySubjectId: { in: sourceIds } } });
}

export function countCrossSubjectKeys<T extends { subjectId: string }>(
  rows: T[],
  keyOf: (row: T) => string,
): number {
  const subjectsByKey = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const subjects = subjectsByKey.get(key) ?? new Set<string>();
    subjects.add(row.subjectId);
    subjectsByKey.set(key, subjects);
  }
  return [...subjectsByKey.values()].filter((subjects) => subjects.size > 1).length;
}

function countBySubject(rows: Array<{ subjectId: string | null }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.subjectId) counts.set(row.subjectId, (counts.get(row.subjectId) ?? 0) + 1);
  }
  return counts;
}

function serializeSubject(row: SubjectPreviewRow): WorkspaceSubjectDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    groupId: row.groupId,
    stableKey: row.stableKey,
    legacyCode: row.legacyCode,
    name: row.name,
    color: row.color,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    legacyScope: false,
  };
}

async function assertOwnedWorkspace(actorId: string, workspaceId: string): Promise<void> {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { id: workspaceId, userId: actorId },
    select: { id: true },
  });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
}
