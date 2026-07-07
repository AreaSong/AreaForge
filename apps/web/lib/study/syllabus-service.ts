import {
  evaluateMasteryProof,
  evaluateSyllabusMapSignal,
  parseSyllabusMarkdown,
  summarizeSyllabusMap,
  type MasteryProofCondition,
  type MasteryProofLevel,
  type SyllabusMapNodeStatus,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  MasteryLevelDto,
  SyllabusMapOverviewDto,
  SyllabusNodeDto,
  SyllabusNodeKindDto,
  SyllabusNodeStatusDto,
} from "./types";

type DbSyllabusNodeKind = "SUBJECT" | "CHAPTER" | "TOPIC" | "PROBLEM_TYPE";
type DbSyllabusNodeStatus = "NOT_STARTED" | "LEARNING" | "COVERED" | "NEEDS_REVIEW" | "MASTERED" | "WEAK" | "DEFERRED";
type DbMasteryLevel = "SEEN" | "LEARNED" | "BASIC_EXERCISES" | "CAN_EXPLAIN" | "RETEST_PASSED" | "EXAM_STABLE";

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
    take: 1,
    select: {
      completedAt: true,
      updatedAt: true,
    },
  },
  sessions: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    select: {
      endedAt: true,
      updatedAt: true,
    },
  },
  notes: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    select: {
      updatedAt: true,
    },
  },
  mistakes: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    select: {
      updatedAt: true,
    },
  },
};

export interface CreateSyllabusNodeInput {
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
  parentId?: string | null;
  title?: string;
  kind?: SyllabusNodeKindDto;
  status?: SyllabusNodeStatusDto;
  masteryLevel?: MasteryLevelDto | null;
  sortOrder?: number;
  targetMinutes?: number;
}

export interface ImportSyllabusMarkdownInput {
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
    completedAt: Date | null;
    updatedAt: Date;
  }>;
  sessions?: Array<{
    endedAt: Date | null;
    updatedAt: Date;
  }>;
  notes?: Array<{
    updatedAt: Date;
  }>;
  mistakes?: Array<{
    updatedAt: Date;
  }>;
  subject: {
    name: string;
    color: string;
  };
}

export async function listSyllabusTree(): Promise<SyllabusNodeDto[]> {
  const subjects = await prisma.subject.findMany({
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

export async function getSyllabusMapOverview(): Promise<SyllabusMapOverviewDto> {
  const nodes = await listSyllabusTree();
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

export async function createSyllabusNode(
  input: CreateSyllabusNodeInput,
  actorId: string,
): Promise<SyllabusNodeDto> {
  await assertSubjectExists(input.subjectId);
  if (input.parentId) {
    await assertSyllabusNodeBelongsToSubject(input.parentId, input.subjectId);
  }

  const node = await prisma.syllabusNode.create({
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

  await audit(actorId, "SYLLABUS_NODE_CREATED", "SyllabusNode", node.id);
  return serializeNode({ ...node, subject: node.subject }, []);
}

export async function importSyllabusMarkdown(
  input: ImportSyllabusMarkdownInput,
  actorId: string,
): Promise<ImportSyllabusMarkdownResult> {
  await assertSubjectExists(input.subjectId);
  if (input.parentId) {
    await assertSyllabusNodeBelongsToSubject(input.parentId, input.subjectId);
  }

  const parsed = parseSyllabusMarkdown({
    markdown: input.markdown,
    maxLines: 80,
    maxDepth: 5,
    maxTitleLength: 120,
  });

  if (parsed.errors.length > 0) {
    throw new ApiError("SYLLABUS_MARKDOWN_INVALID", 400);
  }

  const nodes = await prisma.$transaction(async (tx) => {
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

    return createdNodes;
  });

  return {
    importedCount: nodes.length,
    ignoredLines: parsed.ignoredLines,
    nodes,
  };
}

export async function updateSyllabusNode(
  id: string,
  input: UpdateSyllabusNodeInput,
  actorId: string,
): Promise<SyllabusNodeDto> {
  const existing = await prisma.syllabusNode.findUnique({
    where: { id },
    include: {
      subject: true,
      ...syllabusNodeEvidenceInclude,
    },
  });

  if (!existing) {
    throw new ApiError("SYLLABUS_NODE_NOT_FOUND", 404);
  }

  if (input.parentId !== undefined) {
    await assertParentIsSafe(id, existing.subjectId, input.parentId);
  }

  if (input.status === "mastered") {
    assertNodeCanMarkMastery(existing, input.masteryLevel ?? "learned");
  }

  const node = await prisma.syllabusNode.update({
    where: { id },
    data: {
      parentId: input.parentId,
      title: input.title,
      kind: input.kind ? toDbKind(input.kind) : undefined,
      status: input.status ? toDbStatus(input.status) : undefined,
      masteryLevel: input.masteryLevel === undefined ? undefined : input.masteryLevel ? toDbMastery(input.masteryLevel) : null,
      sortOrder: input.sortOrder,
      targetMinutes: input.targetMinutes,
    },
    include: {
      subject: true,
      ...syllabusNodeEvidenceInclude,
    },
  });

  await audit(actorId, "SYLLABUS_NODE_UPDATED", "SyllabusNode", node.id);
  return serializeNode({ ...node, subject: node.subject }, []);
}

export async function assertSyllabusNodeBelongsToSubject(nodeId: string, subjectId: string): Promise<void> {
  const node = await prisma.syllabusNode.findUnique({
    where: { id: nodeId },
    select: { subjectId: true },
  });

  if (!node) {
    throw new ApiError("SYLLABUS_NODE_NOT_FOUND", 404);
  }

  if (node.subjectId !== subjectId) {
    throw new ApiError("SYLLABUS_NODE_SUBJECT_MISMATCH", 400);
  }
}

async function assertSubjectExists(subjectId: string): Promise<void> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
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

function assertNodeCanMarkMastery(node: FlatSyllabusNode, requestedLevel: MasteryLevelDto): void {
  const proof = createMasteryProof(node, requestedLevel);
  if (!proof.canMarkRequestedLevel) {
    throw new ApiError("MASTERY_PROOF_REQUIRED", 400);
  }
}

async function assertParentIsSafe(nodeId: string, subjectId: string, parentId: string | null): Promise<void> {
  if (!parentId) return;
  if (parentId === nodeId) {
    throw new ApiError("SYLLABUS_NODE_PARENT_SELF", 400);
  }

  await assertSyllabusNodeBelongsToSubject(parentId, subjectId);

  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 80; depth += 1) {
    if (cursor === nodeId) {
      throw new ApiError("SYLLABUS_NODE_PARENT_CYCLE", 400);
    }

    const parent: { parentId: string | null } | null = await prisma.syllabusNode.findUnique({
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
  const freshness = getSyllabusEvidenceFreshness(node);
  const evidence = {
    taskCount: node._count?.tasks ?? 0,
    sessionCount: node._count?.sessions ?? 0,
    noteCount: node._count?.notes ?? 0,
    mistakeCount: node._count?.mistakes ?? 0,
    lastEvidenceAt: freshness.lastEvidenceAt?.toISOString() ?? null,
    daysSinceLastEvidence: freshness.daysSinceLastEvidence,
  };

  return {
    id: node.id,
    subjectId: node.subjectId,
    subjectName: node.subject.name,
    subjectColor: node.subject.color,
    parentId: node.parentId,
    title: node.title,
    kind: fromDbKind(node.kind),
    status,
    masteryLevel,
    sortOrder: node.sortOrder,
    targetMinutes: node.targetMinutes,
    actualMinutes: node.actualMinutes,
    evidence,
    masteryProof: createMasteryProof(node, masteryLevel ?? "learned"),
    mapSignal: evaluateSyllabusMapSignal({
      nodeStatus: status as SyllabusMapNodeStatus,
      masteryLevel,
      evidenceCount: evidence.taskCount + evidence.sessionCount + evidence.noteCount + evidence.mistakeCount,
      mistakeCount: evidence.mistakeCount,
      daysSinceLastReview: freshness.daysSinceLastEvidence,
      retestPassed: masteryLevel === "retest_passed" || masteryLevel === "exam_stable",
      isHighFrequency: node.kind === "PROBLEM_TYPE",
      isPersonalFocus: status === "weak" || status === "needs_review",
    }),
    children,
  };
}

function createMasteryProof(node: FlatSyllabusNode, requestedLevel: MasteryLevelDto) {
  const masteryLevel = node.masteryLevel ? fromDbMastery(node.masteryLevel) : null;
  const freshness = getSyllabusEvidenceFreshness(node);
  const evidence = {
    taskCount: node._count?.tasks ?? 0,
    sessionCount: node._count?.sessions ?? 0,
    noteCount: node._count?.notes ?? 0,
    mistakeCount: node._count?.mistakes ?? 0,
    reviewedMistakeCount: masteryLevel === "exam_stable" ? node._count?.mistakes ?? 0 : 0,
    retestPassedCount: masteryLevel === "retest_passed" || masteryLevel === "exam_stable" ? 1 : 0,
    daysSinceLastEvidence: freshness.daysSinceLastEvidence,
  };

  return evaluateMasteryProof({
    requestedLevel: requestedLevel as MasteryProofLevel,
    completedConditions: inferMasteryConditions(node, masteryLevel),
    evidence,
  });
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

async function audit(actorId: string, action: string, entityType: string, entityId: string): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
    },
  });
}
