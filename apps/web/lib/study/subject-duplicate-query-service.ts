import { createHash } from "node:crypto";
import {
  buildSimulationRemediationOriginKey,
  findSubjectDuplicateSets,
  SIMULATION_LOSS_REASONS,
  type SimulationLossReason,
  type SubjectDuplicateCandidate,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { workspaceOwnerWhere } from "@/lib/workspace/access-service";
import type {
  SubjectDuplicateSetDto,
  SubjectReferenceCountDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts/workspace";

type SubjectPreviewRow = Awaited<ReturnType<typeof loadSubjectPreviewRows>>[number];
type SubjectPreviewClient = PrismaClient | Prisma.TransactionClient;

export async function listSubjectDuplicatePreviews(
  actorId: string,
  workspaceId: string,
): Promise<SubjectDuplicateSetDto[]> {
  return listSubjectDuplicatePreviewsWithClient(actorId, workspaceId, prisma);
}

export async function listSubjectDuplicatePreviewsWithClient(
  actorId: string,
  workspaceId: string,
  client: SubjectPreviewClient,
): Promise<SubjectDuplicateSetDto[]> {
  const workspace = await assertOwnedWorkspace(actorId, workspaceId, client);
  const rows = await loadSubjectPreviewRows(client, workspaceId);
  if (rows.length < 2) return [];

  const referencesById = await buildReferenceCounts(client, workspaceId, rows);
  const sets = findSubjectDuplicateSets(buildCandidates(rows, referencesById));
  return Promise.all(sets.map(async (set, index) => {
    const targetId = set.recommendedTargetId;
    const sourceIds = set.subjectIds.filter((subjectId) => subjectId !== targetId);
    const [conflictPreview, primaryKnowledgePoints] = await Promise.all([
      previewSubjectMergeConflicts(client, workspaceId, targetId, sourceIds),
      countPrimaryKnowledgePoints(client, sourceIds),
    ]);
    const { simulationOriginInboxItems, ...conflictCounts } = conflictPreview;
    const subjects = joinSubjects(set.subjectIds, rows, referencesById);
    const snapshotHash = buildSubjectDuplicateSnapshotHash({
      workspaceId,
      workspaceRevision: workspace.revision,
      targetId,
      sourceIds,
      reasons: set.reasons,
      subjects,
      conflictCounts,
      simulationOriginInboxItems,
      primaryKnowledgePoints,
    });
    return {
      id: "duplicate-set-" + (index + 1) + "-" + set.subjectIds.join("-"),
      workspaceRevision: workspace.revision,
      snapshotHash,
      reasons: set.reasons,
      recommendedTargetId: targetId,
      subjects,
      conflictCounts,
      requiredReassignments: {
        primaryKnowledgePoints,
        simulationOriginInboxItems,
      },
      totalReferenceCount: subjects.reduce((sum, item) => sum + item.references.total, 0),
      canAutoApply: false,
      requiresUserConfirmation: true,
    };
  }));
}

export function buildSubjectDuplicateSnapshotHash(input: {
  workspaceId: string;
  workspaceRevision: number;
  targetId: string;
  sourceIds: string[];
  reasons: SubjectDuplicateSetDto["reasons"];
  subjects: SubjectDuplicateSetDto["subjects"];
  conflictCounts: SubjectDuplicateSetDto["conflictCounts"];
  simulationOriginInboxItems: number;
  primaryKnowledgePoints: number;
}): string {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    workspaceRevision: input.workspaceRevision,
    targetId: input.targetId,
    sourceIds: [...input.sourceIds].sort(),
    reasons: input.reasons,
    subjects: input.subjects,
    conflictCounts: {
      syllabusStableKeys: input.conflictCounts.syllabusStableKeys,
      simulationExams: input.conflictCounts.simulationExams,
      simulationInboxOrigins: input.conflictCounts.simulationInboxOrigins,
      invalidSimulationInboxOrigins: input.conflictCounts.invalidSimulationInboxOrigins,
      relatedKnowledgePoints: input.conflictCounts.relatedKnowledgePoints,
    },
    simulationOriginInboxItems: input.simulationOriginInboxItems,
    primaryKnowledgePoints: input.primaryKnowledgePoints,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

async function loadSubjectPreviewRows(client: SubjectPreviewClient, workspaceId: string) {
  return client.subject.findMany({
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
  client: SubjectPreviewClient,
  workspaceId: string,
  rows: SubjectPreviewRow[],
): Promise<Map<string, SubjectReferenceCountDto>> {
  const subjectIds = rows.map((row) => row.id);
  const [activeSessions, inboxItems] = await Promise.all([
    client.studySession.findMany({
      where: { subjectId: { in: subjectIds }, status: { in: ["RUNNING", "PAUSED", "CLOSING"] } },
      select: { subjectId: true },
    }),
    client.planInboxItem.findMany({
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
  client: SubjectPreviewClient,
  workspaceId: string,
  targetId: string,
  sourceIds: string[],
): Promise<SubjectDuplicateSetDto["conflictCounts"] & { simulationOriginInboxItems: number }> {
  const candidateIds = [targetId, ...sourceIds];
  const [syllabusRows, simulationRows, relatedKnowledgeRows, simulationInboxItems] = await Promise.all([
    client.syllabusNode.findMany({
      where: { subjectId: { in: candidateIds }, stableKey: { not: null } },
      select: { subjectId: true, stableKey: true },
    }),
    client.simulationSubjectResult.findMany({
      where: { subjectId: { in: candidateIds } },
      select: { subjectId: true, simulationExamId: true },
    }),
    client.knowledgePointSubject.findMany({
      where: { subjectId: { in: candidateIds } },
      select: { subjectId: true, knowledgePointId: true },
    }),
    client.planInboxItem.findMany({
      where: {
        workspaceId,
        originType: "SIMULATION_LOSS",
        subjectId: { in: candidateIds },
      },
      select: {
        subjectId: true,
        originKey: true,
        originVersion: true,
        originSnapshot: true,
      },
    }),
  ]);
  const inboxConflicts = summarizeSimulationInboxMergeConflicts(simulationInboxItems, targetId);
  return {
    syllabusStableKeys: countCrossSubjectKeys(syllabusRows, (row) => row.stableKey ?? ""),
    simulationExams: countCrossSubjectKeys(simulationRows, (row) => row.simulationExamId),
    simulationInboxOrigins: inboxConflicts.collisions,
    invalidSimulationInboxOrigins: inboxConflicts.invalid,
    relatedKnowledgePoints: countCrossSubjectKeys(relatedKnowledgeRows, (row) => row.knowledgePointId),
    simulationOriginInboxItems: simulationInboxItems.filter((item) => item.subjectId !== targetId).length,
  };
}

export function summarizeSimulationInboxMergeConflicts(
  rows: Array<{
    subjectId: string | null;
    originKey: string;
    originVersion: number;
    originSnapshot: Prisma.JsonValue;
  }>,
  targetSubjectId: string,
): { collisions: number; invalid: number } {
  const counts = new Map<string, number>();
  let invalid = 0;
  for (const row of rows) {
    const originKey = row.subjectId === targetSubjectId
      ? row.originKey
      : deriveMergedSimulationOriginKey(row.originSnapshot, targetSubjectId);
    if (!originKey) {
      invalid += 1;
      continue;
    }
    const uniqueKey = `${originKey}:v${row.originVersion}`;
    counts.set(uniqueKey, (counts.get(uniqueKey) ?? 0) + 1);
  }
  return {
    collisions: [...counts.values()].filter((count) => count > 1).length,
    invalid,
  };
}

function deriveMergedSimulationOriginKey(
  value: Prisma.JsonValue,
  targetSubjectId: string,
): string | null {
  const snapshot = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
  const examId = typeof snapshot.examId === "string" ? snapshot.examId : "";
  const reasonValue = typeof snapshot.reason === "string" ? snapshot.reason : "";
  const reason = SIMULATION_LOSS_REASONS.includes(reasonValue as SimulationLossReason)
    ? reasonValue as SimulationLossReason
    : null;
  const syllabusNodeId = typeof snapshot.syllabusNodeId === "string" && snapshot.syllabusNodeId
    ? snapshot.syllabusNodeId
    : null;
  return examId && reason
    ? buildSimulationRemediationOriginKey({ examId, subjectId: targetSubjectId, reason, syllabusNodeId })
    : null;
}

async function countPrimaryKnowledgePoints(client: SubjectPreviewClient, sourceIds: string[]): Promise<number> {
  return sourceIds.length === 0
    ? 0
    : client.knowledgePoint.count({ where: { primarySubjectId: { in: sourceIds } } });
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

async function assertOwnedWorkspace(
  actorId: string,
  workspaceId: string,
  client: SubjectPreviewClient,
): Promise<{ id: string; revision: number }> {
  const workspace = await client.examWorkspace.findFirst({
    where: { id: workspaceId, ...workspaceOwnerWhere(actorId) },
    select: { id: true, revision: true },
  });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  return workspace;
}
