import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  MasteryLevelDto,
  SyllabusNodeDto,
  SyllabusNodeKindDto,
  SyllabusNodeStatusDto,
} from "./types";

type DbSyllabusNodeKind = "SUBJECT" | "CHAPTER" | "TOPIC" | "PROBLEM_TYPE";
type DbSyllabusNodeStatus = "NOT_STARTED" | "LEARNING" | "COVERED" | "NEEDS_REVIEW" | "MASTERED" | "WEAK" | "DEFERRED";
type DbMasteryLevel = "SEEN" | "LEARNED" | "BASIC_EXERCISES" | "CAN_EXPLAIN" | "RETEST_PASSED" | "EXAM_STABLE";

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
          _count: {
            select: {
              tasks: true,
              sessions: true,
              notes: true,
              mistakes: true,
            },
          },
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
      _count: {
        select: {
          tasks: true,
          sessions: true,
          notes: true,
          mistakes: true,
        },
      },
    },
  });

  await audit(actorId, "SYLLABUS_NODE_CREATED", "SyllabusNode", node.id);
  return serializeNode({ ...node, subject: node.subject }, []);
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
      _count: {
        select: {
          tasks: true,
          sessions: true,
          notes: true,
          mistakes: true,
        },
      },
    },
  });

  if (!existing) {
    throw new ApiError("SYLLABUS_NODE_NOT_FOUND", 404);
  }

  if (input.parentId !== undefined) {
    await assertParentIsSafe(id, existing.subjectId, input.parentId);
  }

  if (input.status === "mastered") {
    await assertNodeHasMasteryEvidence(id);
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
    include: { subject: true },
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

async function assertNodeHasMasteryEvidence(nodeId: string): Promise<void> {
  const [taskCount, sessionCount, noteCount, mistakeCount] = await Promise.all([
    prisma.studyTask.count({ where: { syllabusNodeId: nodeId } }),
    prisma.studySession.count({ where: { syllabusNodeId: nodeId, status: "COMPLETED" } }),
    prisma.note.count({ where: { syllabusNodeId: nodeId } }),
    prisma.mistake.count({ where: { syllabusNodeId: nodeId } }),
  ]);

  if (taskCount + sessionCount + noteCount + mistakeCount === 0) {
    throw new ApiError("MASTERY_EVIDENCE_REQUIRED", 400);
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

function serializeNode(node: FlatSyllabusNode, children: SyllabusNodeDto[]): SyllabusNodeDto {
  return {
    id: node.id,
    subjectId: node.subjectId,
    subjectName: node.subject.name,
    subjectColor: node.subject.color,
    parentId: node.parentId,
    title: node.title,
    kind: fromDbKind(node.kind),
    status: fromDbStatus(node.status),
    masteryLevel: node.masteryLevel ? fromDbMastery(node.masteryLevel) : null,
    sortOrder: node.sortOrder,
    targetMinutes: node.targetMinutes,
    actualMinutes: node.actualMinutes,
    evidence: {
      taskCount: node._count?.tasks ?? 0,
      sessionCount: node._count?.sessions ?? 0,
      noteCount: node._count?.notes ?? 0,
      mistakeCount: node._count?.mistakes ?? 0,
    },
    children,
  };
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
