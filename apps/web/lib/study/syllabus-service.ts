import {
  evaluateMasteryProof,
  evaluateSyllabusMapSignal,
  parseSyllabusMarkdown,
  summarizeSyllabusMap,
  type MasteryProofCondition,
  type MasteryEvidenceInput,
  type MasteryProofLevel,
  type MasteryProofSummary,
  type SyllabusMapNodeStatus,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { cache } from "react";
import { ApiError } from "@/lib/api/responses";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";
import { pauseScheduleOnTargetArchive } from "./review-schedule-service";
import { calculateMasteryConfidence, syllabusMasteryStatusView } from "@/lib/knowledge/mastery-status";
import type {
  MasteryEvidenceTypeDto,
  MasteryLevelDto,
  MasteryRetestResultDto,
  SyllabusMapOverviewDto,
  SyllabusNodeDto,
  SyllabusNodeKindDto,
  SyllabusNodeStatusDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";

type DbSyllabusNodeKind = "SUBJECT" | "CHAPTER" | "TOPIC" | "PROBLEM_TYPE";
type DbSyllabusNodeStatus = "NOT_STARTED" | "LEARNING" | "COVERED" | "NEEDS_REVIEW" | "MASTERED" | "WEAK" | "DEFERRED";
type DbMasteryLevel = "SEEN" | "LEARNED" | "BASIC_EXERCISES" | "CAN_EXPLAIN" | "RETEST_PASSED" | "EXAM_STABLE";
type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type SyllabusDbClient = PrismaClient | Prisma.TransactionClient;

const syllabusNodeEvidenceInclude = {
  _count: {
    select: {
      tasks: true,
      sessions: true,
      notes: true,
      mistakes: true,
    },
  },
  tasks: {
    orderBy: { updatedAt: "desc" as const },
    take: 8,
    select: {
      id: true,
      title: true,
      status: true,
      completedAt: true,
      updatedAt: true,
    },
  },
  sessions: {
    orderBy: { updatedAt: "desc" as const },
    take: 8,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      effectiveMinutes: true,
      updatedAt: true,
    },
  },
  notes: {
    orderBy: { updatedAt: "desc" as const },
    take: 8,
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
  },
  mistakes: {
    orderBy: { updatedAt: "desc" as const },
    take: 8,
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
  },
  masteryConditions: {
    orderBy: { condition: "asc" as const },
    select: {
      condition: true,
      checked: true,
      checkedAt: true,
      actorId: true,
    },
  },
  masteryEvidence: {
    orderBy: { createdAt: "desc" as const },
    take: 12,
    select: {
      id: true,
      evidenceType: true,
      taskId: true,
      sessionId: true,
      noteId: true,
      mistakeId: true,
      retestId: true,
      summary: true,
      createdAt: true,
      actorId: true,
      task: { select: { title: true } },
      session: { select: { startedAt: true, effectiveMinutes: true } },
      note: { select: { title: true } },
      mistake: { select: { title: true } },
      retest: { select: { result: true, testedAt: true, score: true } },
    },
  },
  masteryRetests: {
    orderBy: { testedAt: "desc" as const },
    take: 12,
    select: {
      id: true,
      testedAt: true,
      result: true,
      score: true,
      summary: true,
      nextReviewAt: true,
      actorId: true,
    },
  },
};

const masteryConditionValues: MasteryProofCondition[] = [
  "course_or_textbook",
  "own_explanation",
  "basic_exercise",
  "comprehensive_exercise",
  "mistake_reviewed",
  "delayed_retest",
];

export interface CreateSyllabusNodeInput {
  idempotencyKey: string;
  subjectId: string;
  parentId?: string | null;
  title: string;
  kind: SyllabusNodeKindDto;
  status: SyllabusNodeStatusDto;
  masteryLevel?: MasteryLevelDto | null;
  sortOrder: number;
  targetMinutes: number;
}

export interface UpdateSyllabusNodeInput {
  expectedRevision: number;
  parentId?: string | null;
  title?: string;
  kind?: SyllabusNodeKindDto;
  status?: SyllabusNodeStatusDto;
  masteryLevel?: MasteryLevelDto | null;
  masteryConditions?: MasteryProofCondition[];
  sortOrder?: number;
  targetMinutes?: number;
}

export interface CreateMasteryEvidenceInput {
  evidenceType: MasteryEvidenceTypeDto;
  taskId?: string;
  sessionId?: string;
  noteId?: string;
  mistakeId?: string;
  retestId?: string;
  summary?: string;
}

export interface CreateMasteryRetestInput {
  idempotencyKey: string;
  testedAt?: string;
  result: MasteryRetestResultDto;
  score?: string;
  summary?: string;
  nextReviewAt?: string | null;
}

export interface ImportSyllabusMarkdownInput {
  idempotencyKey: string;
  subjectId: string;
  parentId?: string | null;
  markdown: string;
}

export interface ImportSyllabusMarkdownResult {
  importedCount: number;
  ignoredLines: number[];
  nodes: SyllabusNodeDto[];
}

interface FlatSyllabusNode {
  id: string;
  revision: number;
  stableKey: string | null;
  archivedAt: Date | null;
  subjectId: string;
  parentId: string | null;
  title: string;
  kind: DbSyllabusNodeKind;
  status: DbSyllabusNodeStatus;
  masteryLevel: DbMasteryLevel | null;
  sortOrder: number;
  targetMinutes: number;
  actualMinutes: number;
  _count?: {
    tasks: number;
    sessions: number;
    notes: number;
    mistakes: number;
  };
  tasks?: Array<{
    id: string;
    title: string;
    status: DbTaskStatus;
    completedAt: Date | null;
    updatedAt: Date;
  }>;
  sessions?: Array<{
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    effectiveMinutes: number;
    updatedAt: Date;
  }>;
  notes?: Array<{
    id: string;
    title: string;
    updatedAt: Date;
  }>;
  mistakes?: Array<{
    id: string;
    title: string;
    updatedAt: Date;
  }>;
  masteryConditions?: Array<{
    condition: string;
    checked: boolean;
    checkedAt: Date | null;
    actorId: string | null;
  }>;
  masteryEvidence?: Array<{
    id: string;
    evidenceType: string;
    taskId: string | null;
    sessionId: string | null;
    noteId: string | null;
    mistakeId: string | null;
    retestId: string | null;
    summary: string | null;
    createdAt: Date;
    actorId: string | null;
    task: { title: string } | null;
    session: { startedAt: Date; effectiveMinutes: number } | null;
    note: { title: string } | null;
    mistake: { title: string } | null;
    retest: { result: string; testedAt: Date; score: string | null } | null;
  }>;
  masteryRetests?: Array<{
    id: string;
    testedAt: Date;
    result: string;
    score: string | null;
    summary: string | null;
    nextReviewAt: Date | null;
    actorId: string | null;
  }>;
  subject: {
    name: string;
    color: string;
  };
}

export async function listSyllabusTree(actorId: string): Promise<SyllabusNodeDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { sortOrder: "asc" },
    include: {
      syllabusNodes: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          ...syllabusNodeEvidenceInclude,
        },
      },
    },
  });

  return subjects.flatMap((subject) =>
    buildTree(
      subject.syllabusNodes.map((node) => ({
        ...node,
        subject,
      })),
    ),
  );
}

export async function getSyllabusNode(actorId: string, nodeId: string): Promise<SyllabusNodeDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const node = await prisma.syllabusNode.findFirst({
    where: { id: nodeId, subject: { workspaceId: workspace.id } },
    include: {
      subject: true,
      ...syllabusNodeEvidenceInclude,
    },
  });
  if (!node) throw new ApiError("SYLLABUS_NODE_NOT_FOUND", 404);
  return serializeNode(node, []);
}

/**
 * 任务/计时/笔记/错题选择器专用的轻量考纲树：不加载证据、掌握证明与地图信号，
 * 避免选择器场景为每个节点携带整组关联查询。
 */
export async function listSyllabusOptions(actorId: string): Promise<SyllabusOptionNodeDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const nodes = await prisma.syllabusNode.findMany({
    where: {
      archivedAt: null,
      subject: { workspaceId: workspace.id, archivedAt: null },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      subjectId: true,
      parentId: true,
      title: true,
      subject: {
        select: { sortOrder: true },
      },
    },
  });

  const byId = new Map<string, SyllabusOptionNodeDto>();
  const roots: Array<{ dto: SyllabusOptionNodeDto; subjectSortOrder: number }> = [];
  for (const node of nodes) {
    byId.set(node.id, { id: node.id, subjectId: node.subjectId, title: node.title, children: [] });
  }
  for (const node of nodes) {
    const dto = byId.get(node.id);
    if (!dto) continue;
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) {
      parent.children.push(dto);
    } else {
      roots.push({ dto, subjectSortOrder: node.subject.sortOrder });
    }
  }

  return roots
    .sort((left, right) => left.subjectSortOrder - right.subjectSortOrder)
    .map((root) => root.dto);
}

// 同一次服务端渲染内共享轻量考纲树，页面与次级消费方不重复查询。
export const listSyllabusOptionsShared = cache(
  async (actorId: string): Promise<SyllabusOptionNodeDto[]> => listSyllabusOptions(actorId),
);

// 同一次服务端渲染内共享考纲地图总览（长期风险摘要与考纲页共用）。
export const getSyllabusMapOverviewShared = cache(
  async (actorId: string): Promise<SyllabusMapOverviewDto> => getSyllabusMapOverview(actorId),
);

export async function getSyllabusMapOverview(actorId: string): Promise<SyllabusMapOverviewDto> {
  const nodes = await listSyllabusTree(actorId);
  const flatNodes = flattenSyllabusNodes(nodes);
  const summaryInputs = flatNodes.map(toSyllabusMapSummaryInput);
  const subjectIds = Array.from(new Set(flatNodes.map((node) => node.subjectId)));

  return {
    nodes,
    summary: summarizeSyllabusMap(summaryInputs),
    summaryBySubject: Object.fromEntries(
      subjectIds.map((subjectId) => [
        subjectId,
        summarizeSyllabusMap(
          flatNodes
            .filter((node) => node.subjectId === subjectId)
            .map(toSyllabusMapSummaryInput),
        ),
      ]),
    ),
  };
}

export function filterSyllabusTreeByQuery(nodes: SyllabusNodeDto[], rawQuery?: string): SyllabusNodeDto[] {
  const query = rawQuery?.trim().slice(0, 120).toLocaleLowerCase("zh-CN");
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterSyllabusTreeByQuery(node.children, query);
    return node.title.toLocaleLowerCase("zh-CN").includes(query) || children.length > 0
      ? [{ ...node, children }]
      : [];
  });
}

export async function createSyllabusNode(
  input: CreateSyllabusNodeInput,
  actorId: string,
): Promise<SyllabusNodeDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("syllabus-node-create-v1", {
    subjectId: input.subjectId,
    parentId: input.parentId ?? null,
    title: input.title,
    kind: input.kind,
    status: input.status,
    masteryLevel: input.masteryLevel ?? null,
    sortOrder: input.sortOrder,
    targetMinutes: input.targetMinutes,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "SYLLABUS_NODE_CREATED",
      entityType: "SyllabusNode",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "SYLLABUS_NODE_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseSyllabusNodeSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      return serializeNode(await findSyllabusNodeForProof(replay.resultId, tx, workspace.id, true), []);
    }

    await assertSubjectExists(input.subjectId, workspace.id, tx);
    if (input.parentId) {
      await assertSyllabusNodeBelongsToSubject(input.parentId, input.subjectId, tx, workspace.id);
    }

    const created = await tx.syllabusNode.create({
      data: {
        subjectId: input.subjectId,
        parentId: input.parentId ?? null,
        title: input.title,
        kind: toDbKind(input.kind),
        status: toDbStatus(input.status),
        masteryLevel: input.masteryLevel ? toDbMastery(input.masteryLevel) : null,
        sortOrder: input.sortOrder,
        targetMinutes: input.targetMinutes,
      },
      include: {
        subject: true,
        ...syllabusNodeEvidenceInclude,
      },
    });

    const result = serializeNode({ ...created, subject: created.subject }, []);
    await recordPersistentCreateResult(tx, command, created.id, {
      subjectId: created.subjectId,
      parentId: created.parentId,
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

export async function importSyllabusMarkdown(
  input: ImportSyllabusMarkdownInput,
  actorId: string,
): Promise<ImportSyllabusMarkdownResult> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const parsed = parseSyllabusMarkdown({
    markdown: input.markdown,
    maxLines: 80,
    maxDepth: 5,
    maxTitleLength: 120,
  });

  if (parsed.errors.length > 0) {
    throw new ApiError("SYLLABUS_MARKDOWN_INVALID", 400);
  }
  const requestFingerprint = buildPersistentCreateFingerprint("syllabus-markdown-import-v1", {
    subjectId: input.subjectId,
    parentId: input.parentId ?? null,
    markdown: input.markdown,
  });

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "SYLLABUS_MARKDOWN_IMPORTED",
      entityType: "SyllabusMarkdownImport",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "SYLLABUS_MARKDOWN_IMPORT_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseSyllabusImportSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      throw new ApiError("SYLLABUS_MARKDOWN_IMPORT_IDEMPOTENCY_SNAPSHOT_UNAVAILABLE", 409);
    }

    await assertSubjectExists(input.subjectId, workspace.id, tx);
    if (input.parentId) {
      await assertSyllabusNodeBelongsToSubject(input.parentId, input.subjectId, tx, workspace.id);
    }

    const createdNodes: SyllabusNodeDto[] = [];
    const parentByDepth = new Map<number, string>();

    for (const [index, parsedNode] of parsed.nodes.entries()) {
      const parentId = resolveImportedParentId(parsedNode.depth, input.parentId ?? null, parentByDepth);
      const node = await tx.syllabusNode.create({
        data: {
          subjectId: input.subjectId,
          parentId,
          title: parsedNode.title,
          kind: toDbKind(parsedNode.kind),
          status: "NOT_STARTED",
          sortOrder: parsedNode.sourceLine * 10 + index,
          targetMinutes: 0,
        },
        include: {
          subject: true,
          ...syllabusNodeEvidenceInclude,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "SYLLABUS_NODE_IMPORTED_MARKDOWN",
          entityType: "SyllabusNode",
          entityId: node.id,
          metadata: {
            sourceLine: parsedNode.sourceLine,
            importParentId: input.parentId ?? null,
          },
        },
      });

      parentByDepth.set(parsedNode.depth, node.id);
      for (const depth of Array.from(parentByDepth.keys())) {
        if (depth > parsedNode.depth) parentByDepth.delete(depth);
      }
      createdNodes.push(serializeNode({ ...node, subject: node.subject }, []));
    }

    const result = {
      importedCount: createdNodes.length,
      ignoredLines: parsed.ignoredLines,
      nodes: createdNodes,
    };
    await recordPersistentCreateResult(tx, command, workspace.id, {
      importedCount: createdNodes.length,
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

export async function updateSyllabusNode(
  id: string,
  input: UpdateSyllabusNodeInput,
  actorId: string,
): Promise<SyllabusNodeDto> {
  const masteryProofRequest = resolveMasteryProofRequest(input);
  const requestedConditionSnapshot = input.masteryConditions ?? [];
  const nextMasteryLevel =
    input.status === "mastered"
      ? input.masteryLevel ?? "learned"
      : input.masteryLevel === undefined
        ? undefined
      : input.masteryLevel;

  const node = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await findSyllabusNodeForProof(id, tx, workspace.id, true);
    if (existing.revision !== input.expectedRevision) {
      const latestDto = serializeNode(existing, []);
      throw new ApiError("SYLLABUS_NODE_REVISION_CONFLICT", 409, {
        latest: latestDto,
        conflictFields: collectSyllabusNodeConflictFields(input, latestDto),
        workbench: "/knowledge/syllabi",
      });
    }
    if (input.parentId !== undefined) {
      await assertParentIsSafe(id, existing.subjectId, input.parentId, tx, workspace.id);
    }
    if (input.masteryConditions !== undefined) {
      await upsertMasteryConditions(id, requestedConditionSnapshot, actorId, tx);
    }

    const proofNode = masteryProofRequest
      ? await findSyllabusNodeForProof(id, tx, workspace.id, true)
      : existing;
    const proof = masteryProofRequest
      ? assertNodeCanMarkMastery(proofNode, masteryProofRequest.level)
      : null;
    const changed = await tx.syllabusNode.updateMany({
      where: {
        id,
        revision: input.expectedRevision,
        archivedAt: null,
        subject: { workspaceId: workspace.id, archivedAt: null },
      },
      data: {
        parentId: input.parentId,
        title: input.title,
        kind: input.kind ? toDbKind(input.kind) : undefined,
        status: input.status ? toDbStatus(input.status) : undefined,
        masteryLevel: nextMasteryLevel === undefined ? undefined : nextMasteryLevel ? toDbMastery(nextMasteryLevel) : null,
        sortOrder: input.sortOrder,
        targetMinutes: input.targetMinutes,
        revision: { increment: 1 },
      },
    });

    if (changed.count !== 1) {
      const latest = await findSyllabusNodeForProof(id, tx, workspace.id);
      const latestDto = serializeNode(latest, []);
      throw new ApiError("SYLLABUS_NODE_REVISION_CONFLICT", 409, {
        latest: latestDto,
        conflictFields: collectSyllabusNodeConflictFields(input, latestDto),
        workbench: "/knowledge/syllabi",
      });
    }

    const updated = await findSyllabusNodeForProof(id, tx, workspace.id, true);

    await audit(
      actorId,
      proof ? "SYLLABUS_NODE_MASTERY_PROVED" : "SYLLABUS_NODE_UPDATED",
      "SyllabusNode",
      updated.id,
      proof && masteryProofRequest
        ? createMasteryAuditMetadata(masteryProofRequest.level, proof)
        : undefined,
      tx,
    );

    return updated;
  });

  return serializeNode({ ...node, subject: node.subject }, []);
}

export async function archiveSyllabusNode(
  id: string,
  expectedRevision: number,
  actorId: string,
): Promise<SyllabusNodeDto> {
  return setSyllabusNodeArchived(id, expectedRevision, actorId, true);
}

export async function restoreSyllabusNode(
  id: string,
  expectedRevision: number,
  actorId: string,
): Promise<SyllabusNodeDto> {
  return setSyllabusNodeArchived(id, expectedRevision, actorId, false);
}

async function setSyllabusNodeArchived(
  id: string,
  expectedRevision: number,
  actorId: string,
  archived: boolean,
): Promise<SyllabusNodeDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await findSyllabusNodeForProof(id, tx, workspace.id, true);
    const existingDto = serializeNode(existing, []);
    if (existing.revision !== expectedRevision) {
      throw syllabusArchiveConflict(existingDto);
    }
    if (Boolean(existing.archivedAt) === archived) return existingDto;

    const changed = await tx.syllabusNode.updateMany({
      where: {
        id,
        revision: expectedRevision,
        archivedAt: archived ? null : { not: null },
        subject: { workspaceId: workspace.id, archivedAt: null },
      },
      data: {
        archivedAt: archived ? new Date() : null,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw syllabusArchiveConflict(serializeNode(await findSyllabusNodeForProof(id, tx, workspace.id), []));
    }

    if (archived) {
      await pauseScheduleOnTargetArchive(tx, { syllabusNodeId: id });
    }
    await audit(
      actorId,
      archived ? "SYLLABUS_NODE_ARCHIVED" : "SYLLABUS_NODE_RESTORED",
      "SyllabusNode",
      id,
      undefined,
      tx,
    );
    return serializeNode(await findSyllabusNodeForProof(id, tx, workspace.id), []);
  });
}

function syllabusArchiveConflict(latest: SyllabusNodeDto): ApiError {
  return new ApiError("SYLLABUS_NODE_REVISION_CONFLICT", 409, {
    latest,
    conflictFields: ["revision", "archivedAt"],
    workbench: "/knowledge/syllabi",
  });
}

export async function addMasteryEvidence(
  syllabusNodeId: string,
  input: CreateMasteryEvidenceInput,
  actorId: string,
): Promise<SyllabusNodeDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const node = await findSyllabusNodeForProof(syllabusNodeId, tx, workspace.id, true);
    const data = await buildMasteryEvidenceCreateData(node, input, actorId, tx);
    const existing = await findExistingMasteryEvidence(data, tx);
    if (!existing) {
      await tx.masteryEvidence.create({ data });
      await audit(actorId, "MASTERY_EVIDENCE_ADDED", "SyllabusNode", syllabusNodeId, {
        evidenceType: input.evidenceType,
        taskId: input.taskId ?? null,
        sessionId: input.sessionId ?? null,
        noteId: input.noteId ?? null,
        mistakeId: input.mistakeId ?? null,
        retestId: input.retestId ?? null,
      }, tx);
    }

    return findSyllabusNodeForProof(syllabusNodeId, tx, workspace.id, true);
  });

  return serializeNode(updated, []);
}

export async function addMasteryRetest(
  syllabusNodeId: string,
  input: CreateMasteryRetestInput,
  actorId: string,
): Promise<SyllabusNodeDto & { recordedRetestId?: string }> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const testedAt = input.testedAt ? new Date(input.testedAt) : new Date();
  const nextReviewAt = input.nextReviewAt ? new Date(input.nextReviewAt) : null;
  const requestFingerprint = buildPersistentCreateFingerprint("mastery-retest-create-v1", {
    syllabusNodeId,
    testedAt: input.testedAt ?? null,
    result: input.result,
    score: input.score ?? null,
    summary: input.summary ?? null,
    nextReviewAt: input.nextReviewAt ?? null,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "MASTERY_RETEST_RECORDED",
      entityType: "SyllabusNode",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "MASTERY_RETEST_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseSyllabusNodeSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      return serializeNode(await findSyllabusNodeForProof(replay.resultId, tx, workspace.id, true), []);
    }

    await findSyllabusNodeForProof(syllabusNodeId, tx, workspace.id, true);
    const retest = await tx.masteryRetest.create({
      data: {
        syllabusNodeId,
        testedAt,
        result: input.result,
        score: input.score,
        summary: input.summary,
        nextReviewAt,
        actorId,
      },
    });

    if (input.result === "passed") {
      await tx.masteryEvidence.create({
        data: {
          syllabusNodeId,
          evidenceType: "retest",
          retestId: retest.id,
          summary: input.summary,
          actorId,
        },
      });
    }

    const result = {
      ...serializeNode(await findSyllabusNodeForProof(syllabusNodeId, tx, workspace.id, true), []),
      recordedRetestId: retest.id,
    };
    await recordPersistentCreateResult(tx, command, syllabusNodeId, {
      retestId: retest.id,
      result: input.result,
      score: input.score ?? null,
      nextReviewAt: nextReviewAt?.toISOString() ?? null,
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });

    return result;
  });
  return updated;
}

function parseSyllabusNodeSnapshot(value: Prisma.JsonValue | undefined): SyllabusNodeDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.title === "string"
    ? value as unknown as SyllabusNodeDto
    : null;
}

function parseSyllabusImportSnapshot(value: Prisma.JsonValue | undefined): ImportSyllabusMarkdownResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.importedCount === "number" && Array.isArray(value.nodes)
    ? value as unknown as ImportSyllabusMarkdownResult
    : null;
}

export async function assertSyllabusNodeBelongsToSubject(
  nodeId: string,
  subjectId: string,
  client: SyllabusDbClient = prisma,
  workspaceId?: string,
): Promise<void> {
  const node = await client.syllabusNode.findFirst({
    where: { id: nodeId, ...(workspaceId ? { subject: { workspaceId } } : {}) },
    select: { subjectId: true },
  });

  if (!node) {
    throw new ApiError("SYLLABUS_NODE_NOT_FOUND", 404);
  }

  if (node.subjectId !== subjectId) {
    throw new ApiError("SYLLABUS_NODE_SUBJECT_MISMATCH", 400);
  }
}

async function assertSubjectExists(
  subjectId: string,
  workspaceId: string,
  client: SyllabusDbClient,
): Promise<void> {
  const subject = await client.subject.findFirst({
    where: { id: subjectId, workspaceId },
    select: { id: true, name: true, color: true, updatedAt: true, archivedAt: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
  if (subject.archivedAt) {
    throw new ApiError("SUBJECT_ARCHIVED", 409, {
      latest: {
        id: subject.id,
        name: subject.name,
        color: subject.color,
        updatedAt: subject.updatedAt.toISOString(),
        archivedAt: subject.archivedAt.toISOString(),
      },
      conflictFields: ["subject.archivedAt"],
      workbench: "/knowledge/syllabi",
    });
  }
}

function resolveImportedParentId(
  depth: number,
  fallbackParentId: string | null,
  parentByDepth: Map<number, string>,
): string | null {
  for (let parentDepth = depth - 1; parentDepth >= 0; parentDepth -= 1) {
    const parentId = parentByDepth.get(parentDepth);
    if (parentId) return parentId;
  }

  return fallbackParentId;
}

function resolveMasteryProofRequest(input: UpdateSyllabusNodeInput): { level: MasteryLevelDto } | null {
  if (input.masteryLevel) return { level: input.masteryLevel };
  if (input.status === "mastered") return { level: "learned" };
  return null;
}

function assertNodeCanMarkMastery(
  node: FlatSyllabusNode,
  requestedLevel: MasteryLevelDto,
): MasteryProofPayload {
  const proof = createMasteryProof(node, requestedLevel);
  if (!proof.summary.canMarkRequestedLevel) {
    throw new ApiError("MASTERY_PROOF_REQUIRED", 400);
  }

  return proof;
}

async function findSyllabusNodeForProof(
  id: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
  workspaceId?: string,
  requireActiveSubject = false,
): Promise<FlatSyllabusNode> {
  const node = await client.syllabusNode.findFirst({
    where: { id, ...(workspaceId ? { subject: { workspaceId } } : {}) },
    include: {
      subject: true,
      ...syllabusNodeEvidenceInclude,
    },
  });

  if (!node) {
    throw new ApiError("SYLLABUS_NODE_NOT_FOUND", 404);
  }
  if (requireActiveSubject && node.subject.archivedAt) {
    throw new ApiError("SUBJECT_ARCHIVED", 409, {
      latest: serializeNode({ ...node, subject: node.subject }, []),
      conflictFields: ["subject.archivedAt"],
      workbench: "/knowledge/syllabi",
    });
  }

  return { ...node, subject: node.subject };
}

async function upsertMasteryConditions(
  syllabusNodeId: string,
  selectedConditions: MasteryProofCondition[],
  actorId: string,
  client: Prisma.TransactionClient,
): Promise<void> {
  const selected = new Set(selectedConditions);
  const now = new Date();

  for (const condition of masteryConditionValues) {
    const checked = selected.has(condition);
    await client.masteryConditionRecord.upsert({
      where: {
        syllabusNodeId_condition: {
          syllabusNodeId,
          condition,
        },
      },
      create: {
        syllabusNodeId,
        condition,
        checked,
        checkedAt: checked ? now : null,
        actorId,
      },
      update: {
        checked,
        checkedAt: checked ? now : null,
        actorId,
      },
    });
  }
}

async function buildMasteryEvidenceCreateData(
  node: FlatSyllabusNode,
  input: CreateMasteryEvidenceInput,
  actorId: string,
  client: Prisma.TransactionClient,
): Promise<Prisma.MasteryEvidenceUncheckedCreateInput> {
  switch (input.evidenceType) {
    case "task":
      return {
        syllabusNodeId: node.id,
        evidenceType: "task",
        taskId: await assertTaskEvidenceBelongsToNode(input.taskId, node.id, client),
        summary: input.summary,
        actorId,
      };
    case "session":
      return {
        syllabusNodeId: node.id,
        evidenceType: "session",
        sessionId: await assertSessionEvidenceBelongsToNode(input.sessionId, node.id, client),
        summary: input.summary,
        actorId,
      };
    case "note":
      return {
        syllabusNodeId: node.id,
        evidenceType: "note",
        noteId: await assertNoteEvidenceBelongsToNode(input.noteId, node.id, client),
        summary: input.summary,
        actorId,
      };
    case "mistake":
      return {
        syllabusNodeId: node.id,
        evidenceType: "mistake",
        mistakeId: await assertMistakeEvidenceBelongsToNode(input.mistakeId, node.id, client),
        summary: input.summary,
        actorId,
      };
    case "retest":
      return {
        syllabusNodeId: node.id,
        evidenceType: "retest",
        retestId: await assertRetestEvidenceBelongsToNode(input.retestId, node.id, client),
        summary: input.summary,
        actorId,
      };
  }
}

async function findExistingMasteryEvidence(
  data: Prisma.MasteryEvidenceUncheckedCreateInput,
  client: Prisma.TransactionClient,
) {
  return client.masteryEvidence.findFirst({
    where: {
      syllabusNodeId: data.syllabusNodeId,
      evidenceType: data.evidenceType,
      taskId: data.taskId ?? null,
      sessionId: data.sessionId ?? null,
      noteId: data.noteId ?? null,
      mistakeId: data.mistakeId ?? null,
      retestId: data.retestId ?? null,
    },
    select: { id: true },
  });
}

async function assertTaskEvidenceBelongsToNode(
  id: string | undefined,
  syllabusNodeId: string,
  client: Prisma.TransactionClient,
): Promise<string> {
  if (!id) throw new ApiError("MASTERY_EVIDENCE_REFERENCE_REQUIRED", 400);
  const task = await client.studyTask.findUnique({
    where: { id },
    select: { syllabusNodeId: true },
  });
  if (!task || task.syllabusNodeId !== syllabusNodeId) {
    throw new ApiError("MASTERY_EVIDENCE_NODE_MISMATCH", 400);
  }
  return id;
}

async function assertSessionEvidenceBelongsToNode(
  id: string | undefined,
  syllabusNodeId: string,
  client: Prisma.TransactionClient,
): Promise<string> {
  if (!id) throw new ApiError("MASTERY_EVIDENCE_REFERENCE_REQUIRED", 400);
  const session = await client.studySession.findUnique({
    where: { id },
    select: { syllabusNodeId: true },
  });
  if (!session || session.syllabusNodeId !== syllabusNodeId) {
    throw new ApiError("MASTERY_EVIDENCE_NODE_MISMATCH", 400);
  }
  return id;
}

async function assertNoteEvidenceBelongsToNode(
  id: string | undefined,
  syllabusNodeId: string,
  client: Prisma.TransactionClient,
): Promise<string> {
  if (!id) throw new ApiError("MASTERY_EVIDENCE_REFERENCE_REQUIRED", 400);
  const note = await client.note.findUnique({
    where: { id },
    select: { syllabusNodeId: true },
  });
  if (!note || note.syllabusNodeId !== syllabusNodeId) {
    throw new ApiError("MASTERY_EVIDENCE_NODE_MISMATCH", 400);
  }
  return id;
}

async function assertMistakeEvidenceBelongsToNode(
  id: string | undefined,
  syllabusNodeId: string,
  client: Prisma.TransactionClient,
): Promise<string> {
  if (!id) throw new ApiError("MASTERY_EVIDENCE_REFERENCE_REQUIRED", 400);
  const mistake = await client.mistake.findUnique({
    where: { id },
    select: { syllabusNodeId: true },
  });
  if (!mistake || mistake.syllabusNodeId !== syllabusNodeId) {
    throw new ApiError("MASTERY_EVIDENCE_NODE_MISMATCH", 400);
  }
  return id;
}

async function assertRetestEvidenceBelongsToNode(
  id: string | undefined,
  syllabusNodeId: string,
  client: Prisma.TransactionClient,
): Promise<string> {
  if (!id) throw new ApiError("MASTERY_EVIDENCE_REFERENCE_REQUIRED", 400);
  const retest = await client.masteryRetest.findUnique({
    where: { id },
    select: { result: true, syllabusNodeId: true },
  });
  if (!retest || retest.syllabusNodeId !== syllabusNodeId) {
    throw new ApiError("MASTERY_EVIDENCE_NODE_MISMATCH", 400);
  }
  if (retest.result !== "passed") {
    throw new ApiError("MASTERY_RETEST_NOT_PASSED", 400);
  }
  return id;
}

async function assertParentIsSafe(
  nodeId: string,
  subjectId: string,
  parentId: string | null,
  client: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  if (!parentId) return;
  if (parentId === nodeId) {
    throw new ApiError("SYLLABUS_NODE_PARENT_SELF", 400);
  }

  await assertSyllabusNodeBelongsToSubject(parentId, subjectId, client, workspaceId);

  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 80; depth += 1) {
    if (cursor === nodeId) {
      throw new ApiError("SYLLABUS_NODE_PARENT_CYCLE", 400);
    }

    const parent: { parentId: string | null } | null = await client.syllabusNode.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

function buildTree(nodes: FlatSyllabusNode[]): SyllabusNodeDto[] {
  const byId = new Map<string, SyllabusNodeDto>();
  const roots: SyllabusNodeDto[] = [];

  for (const node of nodes) {
    byId.set(node.id, serializeNode(node, []));
  }

  for (const node of nodes) {
    const dto = byId.get(node.id);
    if (!dto) continue;

    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) {
      parent.children.push(dto);
    } else {
      roots.push(dto);
    }
  }

  return roots;
}

function flattenSyllabusNodes(nodes: SyllabusNodeDto[]): SyllabusNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenSyllabusNodes(node.children)]);
}

function toSyllabusMapSummaryInput(node: SyllabusNodeDto) {
  return {
    id: node.id,
    title: node.title,
    subject: node.subjectName,
    cellStatus: node.mapSignal.cellStatus,
    isHighFrequency: node.kind === "problem_type",
    isPersonalFocus: node.status === "weak" || node.status === "needs_review",
  };
}

function serializeNode(node: FlatSyllabusNode, children: SyllabusNodeDto[]): SyllabusNodeDto {
  const masteryLevel = node.masteryLevel ? fromDbMastery(node.masteryLevel) : null;
  const status = fromDbStatus(node.status);
  const masteryConditions = getCompletedMasteryConditions(node, masteryLevel);
  const proof = createMasteryProof(node, masteryLevel ?? "learned", masteryConditions);
  const evidence = createMasteryEvidenceSummary(node, proof.evidence);
  const latestRetest = node.masteryRetests?.[0] ?? null;
  const masteryView = syllabusMasteryStatusView({
    level: masteryLevel,
    nextRetestAt: latestRetest?.nextReviewAt,
    proofRisk: proof.summary.risk,
  });

  return {
    id: node.id,
    revision: node.revision,
    stableKey: node.stableKey,
    archivedAt: node.archivedAt?.toISOString() ?? null,
    subjectId: node.subjectId,
    subjectName: node.subject.name,
    subjectColor: node.subject.color,
    parentId: node.parentId,
    title: node.title,
    kind: fromDbKind(node.kind),
    status,
    masteryLevel,
    masteryStatus: masteryView.status,
    needsRetest: masteryView.needsRetest,
    masteryConfidence: calculateMasteryConfidence({
      evidenceCount: evidence.taskCount + evidence.sessionCount + evidence.noteCount + evidence.mistakeCount,
      sessionCount: evidence.sessionCount,
      noteCount: evidence.noteCount,
      mistakeCount: evidence.mistakeCount,
      passedRetestCount: countPassedRetests(node),
      daysSinceLastEvidence: evidence.daysSinceLastEvidence,
    }),
    sortOrder: node.sortOrder,
    targetMinutes: node.targetMinutes,
    actualMinutes: node.actualMinutes,
    evidence,
    masteryConditions,
    masteryConditionRecords: serializeMasteryConditionRecords(node),
    masteryEvidence: serializeMasteryEvidenceRecords(node),
    masteryRetests: serializeMasteryRetests(node),
    masteryEvidenceCandidates: createMasteryEvidenceCandidates(node),
    masteryProof: proof.summary,
    mapSignal: evaluateSyllabusMapSignal({
      nodeStatus: status as SyllabusMapNodeStatus,
      masteryLevel,
      evidenceCount: evidence.taskCount + evidence.sessionCount + evidence.noteCount + evidence.mistakeCount,
      mistakeCount: evidence.mistakeCount,
      daysSinceLastReview: evidence.daysSinceLastEvidence,
      retestPassed: masteryLevel === "retest_passed" || masteryLevel === "exam_stable",
      isHighFrequency: node.kind === "PROBLEM_TYPE",
      isPersonalFocus: status === "weak" || status === "needs_review",
    }),
    children,
  };
}

function collectSyllabusNodeConflictFields(
  input: UpdateSyllabusNodeInput,
  latest: SyllabusNodeDto,
): string[] {
  const fields: string[] = ["revision"];
  const comparisons: Array<[keyof UpdateSyllabusNodeInput, unknown]> = [
    ["parentId", latest.parentId],
    ["title", latest.title],
    ["kind", latest.kind],
    ["status", latest.status],
    ["masteryLevel", latest.masteryLevel],
    ["sortOrder", latest.sortOrder],
    ["targetMinutes", latest.targetMinutes],
  ];
  for (const [field, serverValue] of comparisons) {
    if (input[field] !== undefined && input[field] !== serverValue) fields.push(field);
  }
  if (input.masteryConditions !== undefined) {
    const local = [...input.masteryConditions].sort();
    const server = [...latest.masteryConditions].sort();
    if (JSON.stringify(local) !== JSON.stringify(server)) fields.push("masteryConditions");
  }
  return fields;
}

interface MasteryProofPayload {
  summary: MasteryProofSummary;
  completedConditions: MasteryProofCondition[];
  evidence: MasteryEvidenceInput;
}

function createMasteryProof(
  node: FlatSyllabusNode,
  requestedLevel: MasteryLevelDto,
  completedConditions: MasteryProofCondition[] = getCompletedMasteryConditions(node, node.masteryLevel ? fromDbMastery(node.masteryLevel) : null),
): MasteryProofPayload {
  const evidence = buildMasteryEvidenceInput(node, completedConditions);

  return {
    summary: evaluateMasteryProof({
      requestedLevel: requestedLevel as MasteryProofLevel,
      completedConditions,
      evidence,
    }),
    completedConditions,
    evidence,
  };
}

function getCompletedMasteryConditions(
  node: FlatSyllabusNode,
  masteryLevel: MasteryLevelDto | null,
): MasteryProofCondition[] {
  const explicitRecords = node.masteryConditions ?? [];
  if (explicitRecords.length > 0) {
    return explicitRecords
      .filter((record) => record.checked && isMasteryCondition(record.condition))
      .map((record) => record.condition as MasteryProofCondition);
  }

  return inferMasteryConditions(node, masteryLevel);
}

function buildMasteryEvidenceInput(
  node: FlatSyllabusNode,
  completedConditions: MasteryProofCondition[],
): MasteryEvidenceInput {
  const explicit = node.masteryEvidence ?? [];
  if (explicit.length > 0) {
    const taskCount = explicit.filter((item) => item.evidenceType === "task").length;
    const sessionCount = explicit.filter((item) => item.evidenceType === "session").length;
    const noteCount = explicit.filter((item) => item.evidenceType === "note").length;
    const mistakeCount = explicit.filter((item) => item.evidenceType === "mistake").length;
    const retestPassedCount = countPassedRetests(node);
    const freshness = getExplicitEvidenceFreshness(node);
    return {
      taskCount,
      sessionCount,
      noteCount,
      mistakeCount,
      reviewedMistakeCount: completedConditions.includes("mistake_reviewed") ? mistakeCount : 0,
      retestPassedCount,
      daysSinceLastEvidence: freshness.daysSinceLastEvidence,
    };
  }

  const fallbackFreshness = getSyllabusEvidenceFreshness(node);
  const fallbackMistakeCount = node._count?.mistakes ?? 0;
  return {
    taskCount: node._count?.tasks ?? 0,
    sessionCount: node._count?.sessions ?? 0,
    noteCount: node._count?.notes ?? 0,
    mistakeCount: fallbackMistakeCount,
    reviewedMistakeCount: completedConditions.includes("mistake_reviewed") ? fallbackMistakeCount : 0,
    retestPassedCount: completedConditions.includes("delayed_retest") ? 1 : 0,
    daysSinceLastEvidence: fallbackFreshness.daysSinceLastEvidence,
  };
}

function createMasteryEvidenceSummary(node: FlatSyllabusNode, evidence: MasteryEvidenceInput): SyllabusNodeDto["evidence"] {
  const hasExplicitEvidence = (node.masteryEvidence?.length ?? 0) > 0;
  const freshness = hasExplicitEvidence ? getExplicitEvidenceFreshness(node) : getSyllabusEvidenceFreshness(node);
  return {
    taskCount: evidence.taskCount,
    sessionCount: evidence.sessionCount,
    noteCount: evidence.noteCount,
    mistakeCount: evidence.mistakeCount,
    lastEvidenceAt: freshness.lastEvidenceAt?.toISOString() ?? null,
    daysSinceLastEvidence: freshness.daysSinceLastEvidence,
    source: hasExplicitEvidence ? "explicit" : "fallback_count",
  };
}

function serializeMasteryConditionRecords(node: FlatSyllabusNode): SyllabusNodeDto["masteryConditionRecords"] {
  return (node.masteryConditions ?? [])
    .filter((record) => isMasteryCondition(record.condition))
    .map((record) => ({
      condition: record.condition as MasteryProofCondition,
      checked: record.checked,
      checkedAt: record.checkedAt?.toISOString() ?? null,
      actorId: record.actorId,
    }));
}

function serializeMasteryEvidenceRecords(node: FlatSyllabusNode): SyllabusNodeDto["masteryEvidence"] {
  return (node.masteryEvidence ?? [])
    .filter((record) => isMasteryEvidenceType(record.evidenceType))
    .map((record) => ({
      id: record.id,
      evidenceType: record.evidenceType as MasteryEvidenceTypeDto,
      taskId: record.taskId,
      sessionId: record.sessionId,
      noteId: record.noteId,
      mistakeId: record.mistakeId,
      retestId: record.retestId,
      summary: record.summary,
      sourceLabel: labelMasteryEvidenceSource(record),
      createdAt: record.createdAt.toISOString(),
      actorId: record.actorId,
    }));
}

function serializeMasteryRetests(node: FlatSyllabusNode): SyllabusNodeDto["masteryRetests"] {
  return (node.masteryRetests ?? [])
    .filter((record) => isMasteryRetestResult(record.result))
    .map((record) => ({
      id: record.id,
      testedAt: record.testedAt.toISOString(),
      result: record.result as MasteryRetestResultDto,
      score: record.score,
      summary: record.summary,
      nextReviewAt: record.nextReviewAt?.toISOString() ?? null,
      actorId: record.actorId,
    }));
}

function createMasteryEvidenceCandidates(node: FlatSyllabusNode): SyllabusNodeDto["masteryEvidenceCandidates"] {
  return {
    task: (node.tasks ?? []).map((task) => ({
      id: task.id,
      label: `${task.title} / ${fromDbTaskStatus(task.status)} / ${formatDateLabel(task.completedAt ?? task.updatedAt)}`,
    })),
    session: (node.sessions ?? []).map((session) => ({
      id: session.id,
      label: `${formatDateLabel(session.endedAt ?? session.startedAt)} / ${session.effectiveMinutes} 分钟`,
    })),
    note: (node.notes ?? []).map((note) => ({
      id: note.id,
      label: `${note.title} / ${formatDateLabel(note.updatedAt)}`,
    })),
    mistake: (node.mistakes ?? []).map((mistake) => ({
      id: mistake.id,
      label: `${mistake.title} / ${formatDateLabel(mistake.updatedAt)}`,
    })),
    retest: (node.masteryRetests ?? [])
      .filter((retest) => retest.result === "passed")
      .map((retest) => ({
        id: retest.id,
        label: `${labelRetestResult(retest.result)} / ${formatDateLabel(retest.testedAt)}`,
      })),
  };
}

function getExplicitEvidenceFreshness(node: FlatSyllabusNode): {
  lastEvidenceAt: Date | null;
  daysSinceLastEvidence: number | null;
} {
  const candidates = [
    ...(node.masteryEvidence ?? []).map((item) => item.createdAt),
    ...(node.masteryRetests ?? []).map((item) => item.testedAt),
  ];
  const lastEvidenceAt = candidates.reduce<Date | null>((latest, date) => {
    if (!latest || date.getTime() > latest.getTime()) return date;
    return latest;
  }, null);

  return {
    lastEvidenceAt,
    daysSinceLastEvidence: lastEvidenceAt ? daysBetween(lastEvidenceAt, new Date()) : null,
  };
}

function countPassedRetests(node: FlatSyllabusNode): number {
  return (node.masteryRetests ?? []).filter((record) => record.result === "passed").length;
}

function createMasteryAuditMetadata(
  requestedLevel: MasteryLevelDto,
  proof: MasteryProofPayload,
): Prisma.InputJsonObject {
  return {
    requestedLevel,
    completedConditions: proof.completedConditions,
    evidence: {
      taskCount: proof.evidence.taskCount,
      sessionCount: proof.evidence.sessionCount,
      noteCount: proof.evidence.noteCount,
      mistakeCount: proof.evidence.mistakeCount,
      reviewedMistakeCount: proof.evidence.reviewedMistakeCount ?? 0,
      retestPassedCount: proof.evidence.retestPassedCount ?? 0,
      daysSinceLastEvidence: proof.evidence.daysSinceLastEvidence ?? null,
    },
    allowedLevel: proof.summary.allowedLevel,
  };
}

function getSyllabusEvidenceFreshness(node: FlatSyllabusNode): {
  lastEvidenceAt: Date | null;
  daysSinceLastEvidence: number | null;
} {
  const candidates = [
    node.tasks?.[0]?.completedAt ?? node.tasks?.[0]?.updatedAt,
    node.sessions?.[0]?.endedAt ?? node.sessions?.[0]?.updatedAt,
    node.notes?.[0]?.updatedAt,
    node.mistakes?.[0]?.updatedAt,
  ].filter((date): date is Date => Boolean(date));
  const lastEvidenceAt = candidates.reduce<Date | null>((latest, date) => {
    if (!latest || date.getTime() > latest.getTime()) return date;
    return latest;
  }, null);

  return {
    lastEvidenceAt,
    daysSinceLastEvidence: lastEvidenceAt ? daysBetween(lastEvidenceAt, new Date()) : null,
  };
}

function daysBetween(from: Date, to: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / dayMs));
}

function isMasteryCondition(value: string): value is MasteryProofCondition {
  return masteryConditionValues.includes(value as MasteryProofCondition);
}

function isMasteryEvidenceType(value: string): value is MasteryEvidenceTypeDto {
  return ["task", "session", "note", "mistake", "retest"].includes(value);
}

function isMasteryRetestResult(value: string): value is MasteryRetestResultDto {
  return ["passed", "failed", "partial"].includes(value);
}

function labelMasteryEvidenceSource(record: NonNullable<FlatSyllabusNode["masteryEvidence"]>[number]): string {
  switch (record.evidenceType) {
    case "task":
      return record.task?.title ?? "任务证据";
    case "session":
      return record.session
        ? `${formatDateLabel(record.session.startedAt)} 计时 ${record.session.effectiveMinutes} 分钟`
        : "计时证据";
    case "note":
      return record.note?.title ?? "笔记证据";
    case "mistake":
      return record.mistake?.title ?? "错题证据";
    case "retest":
      return record.retest
        ? `${labelRetestResult(record.retest.result)}复测 ${formatDateLabel(record.retest.testedAt)}`
        : "复测证据";
    default:
      return "掌握证据";
  }
}

function labelRetestResult(result: string): string {
  switch (result) {
    case "passed":
      return "通过";
    case "failed":
      return "未通过";
    case "partial":
      return "部分通过";
    default:
      return "未知";
  }
}

function fromDbTaskStatus(status: DbTaskStatus): string {
  switch (status) {
    case "TODO":
      return "待做";
    case "IN_PROGRESS":
      return "进行中";
    case "DONE":
      return "完成";
    case "SKIPPED":
      return "跳过";
    case "DEFERRED":
      return "延期";
  }
}

function formatDateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function inferMasteryConditions(
  node: FlatSyllabusNode,
  masteryLevel: MasteryLevelDto | null,
): MasteryProofCondition[] {
  const conditions = new Set<MasteryProofCondition>();
  const evidenceCount =
    (node._count?.tasks ?? 0) +
    (node._count?.sessions ?? 0) +
    (node._count?.notes ?? 0) +
    (node._count?.mistakes ?? 0);

  if (node.status !== "NOT_STARTED" || evidenceCount > 0) conditions.add("course_or_textbook");
  if ((node._count?.notes ?? 0) > 0 || masteryRank(masteryLevel) >= masteryRank("can_explain")) {
    conditions.add("own_explanation");
  }
  if ((node._count?.tasks ?? 0) > 0 || (node._count?.sessions ?? 0) > 0 || masteryRank(masteryLevel) >= masteryRank("basic_exercises")) {
    conditions.add("basic_exercise");
  }
  if (masteryLevel === "exam_stable") {
    conditions.add("comprehensive_exercise");
    conditions.add("mistake_reviewed");
  }
  if (masteryLevel === "retest_passed" || masteryLevel === "exam_stable") {
    conditions.add("delayed_retest");
  }

  return Array.from(conditions);
}

function masteryRank(level: MasteryLevelDto | null): number {
  const order: MasteryLevelDto[] = ["seen", "learned", "basic_exercises", "can_explain", "retest_passed", "exam_stable"];
  return level ? order.indexOf(level) : -1;
}

function toDbKind(kind: SyllabusNodeKindDto): DbSyllabusNodeKind {
  return kind.toUpperCase() as DbSyllabusNodeKind;
}

function fromDbKind(kind: DbSyllabusNodeKind): SyllabusNodeKindDto {
  return kind.toLowerCase() as SyllabusNodeKindDto;
}

function toDbStatus(status: SyllabusNodeStatusDto): DbSyllabusNodeStatus {
  return status.toUpperCase() as DbSyllabusNodeStatus;
}

function fromDbStatus(status: DbSyllabusNodeStatus): SyllabusNodeStatusDto {
  return status.toLowerCase() as SyllabusNodeStatusDto;
}

function toDbMastery(level: MasteryLevelDto): DbMasteryLevel {
  return level.toUpperCase() as DbMasteryLevel;
}

function fromDbMastery(level: DbMasteryLevel): MasteryLevelDto {
  return level.toLowerCase() as MasteryLevelDto;
}

async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonObject,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      metadata,
    },
  });
}
