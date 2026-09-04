import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildSimulationRemediationOriginKey,
  buildSimulationRemediationOriginSnapshot,
} from "../../packages/core/src/index";
import { prisma, type Prisma } from "../../packages/db/src/index";

export interface SubjectMergePair {
  actorId: string;
  workspaceId: string;
  targetSubjectId: string;
  sourceSubjectId: string;
}

export interface CompleteSubjectMergeFixture extends SubjectMergePair {
  sourceIds: {
    task: string;
    session: string;
    syllabusNode: string;
    note: string;
    mistake: string;
    simulationResult: string;
    milestone: string;
    simulationInbox: string;
    genericInbox: string;
    resource: string;
    primaryKnowledgePoint: string;
    duplicateKnowledgeLink: string;
    movableKnowledgeLink: string;
    knowledgeGroup: string;
    learningArrangement: string;
  };
  simulationInboxPreimage: {
    originKey: string;
    stableKey: string;
    originSnapshot: Record<string, unknown>;
  };
  duplicateKnowledgeLinkCreatedAt: string;
  privateMarker: string;
}

export async function resetSubjectMergeFixture(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditEvent", "Subject", "ExamWorkspace", "User"
    RESTART IDENTITY CASCADE
  `);
}

export async function seedSubjectMergePair(label: string): Promise<SubjectMergePair> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const user = await prisma.user.create({
    data: {
      email: `v13-${label}-${suffix}@example.invalid`,
      passwordHash: "fixture-only",
    },
  });
  const workspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: `v13-${label}-${suffix}`,
      name: `v1.3 ${label}`,
      status: "ACTIVE",
    },
  });
  const [target, source] = await Promise.all([
    prisma.subject.create({
      data: {
        workspaceId: workspace.id,
        stableKey: `math-main-${suffix}`,
        name: "数学",
        color: "#14b8a6",
        sortOrder: 1,
      },
    }),
    prisma.subject.create({
      data: {
        workspaceId: workspace.id,
        stableKey: `math-legacy-${suffix}`,
        name: " 数学 ",
        color: "#64748b",
        sortOrder: 2,
      },
    }),
  ]);
  return {
    actorId: user.id,
    workspaceId: workspace.id,
    targetSubjectId: target.id,
    sourceSubjectId: source.id,
  };
}

export async function addTargetReferenceWeight(pair: SubjectMergePair, count = 20): Promise<void> {
  await prisma.studyTask.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      subjectId: pair.targetSubjectId,
      title: `目标科目权重 ${index + 1}`,
      type: "study",
      status: "TODO" as const,
      priority: "MEDIUM" as const,
      debtStatus: "NONE" as const,
      plannedDate: new Date("2026-09-04T00:00:00.000Z"),
      estimatedMinutes: 10,
    })),
  });
}

export async function seedCompleteSubjectMergeGraph(
  pair: SubjectMergePair,
): Promise<CompleteSubjectMergeFixture> {
  await addTargetReferenceWeight(pair);
  const privateMarker = `V13_PRIVATE_BODY_${randomUUID()}`;
  const task = await prisma.studyTask.create({
    data: {
      subjectId: pair.sourceSubjectId,
      title: privateMarker,
      type: "study",
      status: "TODO",
      priority: "HIGH",
      debtStatus: "NONE",
      plannedDate: new Date("2026-09-05T00:00:00.000Z"),
      estimatedMinutes: 30,
    },
  });
  const session = await prisma.studySession.create({
    data: {
      subjectId: pair.sourceSubjectId,
      taskId: task.id,
      userId: pair.actorId,
      workspaceId: pair.workspaceId,
      status: "COMPLETED",
      startedAt: new Date("2026-09-04T01:00:00.000Z"),
      endedAt: new Date("2026-09-04T01:30:00.000Z"),
      effectiveMinutes: 30,
    },
  });
  const syllabusNode = await prisma.syllabusNode.create({
    data: {
      subjectId: pair.sourceSubjectId,
      title: "极限",
      kind: "TOPIC",
      stableKey: `limit-${randomUUID()}`,
    },
  });
  const [note, mistake] = await Promise.all([
    prisma.note.create({
      data: {
        subjectId: pair.sourceSubjectId,
        syllabusNodeId: syllabusNode.id,
        taskId: task.id,
        title: "合并夹具笔记",
        content: privateMarker,
      },
    }),
    prisma.mistake.create({
      data: {
        subjectId: pair.sourceSubjectId,
        syllabusNodeId: syllabusNode.id,
        title: "合并夹具错题",
        questionText: privateMarker,
      },
    }),
  ]);
  const exam = await prisma.simulationExam.create({
    data: {
      workspaceId: pair.workspaceId,
      name: "隔离模拟考试",
      examDate: new Date("2026-09-03T00:00:00.000Z"),
      status: "CONFIRMED",
    },
  });
  const simulationResult = await prisma.simulationSubjectResult.create({
    data: {
      simulationExamId: exam.id,
      subjectId: pair.sourceSubjectId,
      paperFullScore: 150,
      actualScore: 100,
    },
  });
  const stagePlan = await prisma.stagePlan.create({
    data: {
      workspaceId: pair.workspaceId,
      stableKey: `stage-${randomUUID()}`,
      name: "基础阶段",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-10-01T00:00:00.000Z"),
      goal: "隔离验证",
      mode: "NORMAL",
      status: "ACTIVE",
    },
  });
  const milestone = await prisma.planMilestone.create({
    data: {
      workspaceId: pair.workspaceId,
      stagePlanId: stagePlan.id,
      subjectId: pair.sourceSubjectId,
      stableKey: `milestone-${randomUUID()}`,
      title: "完成极限复习",
    },
  });
  const simulationInboxPreimage = buildSimulationInboxPreimage(pair, exam.id, simulationResult.id);
  const [simulationInbox, genericInbox] = await Promise.all([
    prisma.planInboxItem.create({
      data: {
        workspaceId: pair.workspaceId,
        subjectId: pair.sourceSubjectId,
        stableKey: simulationInboxPreimage.stableKey,
        originKey: simulationInboxPreimage.originKey,
        originVersion: 1,
        originType: "SIMULATION_LOSS",
        originSnapshot: simulationInboxPreimage.originSnapshot as Prisma.InputJsonValue,
        title: "模拟补救",
        actorId: pair.actorId,
      },
    }),
    prisma.planInboxItem.create({
      data: {
        workspaceId: pair.workspaceId,
        subjectId: pair.sourceSubjectId,
        stableKey: `manual-${randomUUID()}:v1`,
        originKey: `manual-${randomUUID()}`,
        originVersion: 1,
        originType: "MANUAL",
        originSnapshot: { kind: "fixture" },
        title: "普通收件箱项",
        actorId: pair.actorId,
      },
    }),
  ]);
  const resource = await prisma.studyResource.create({
    data: {
      workspaceId: pair.workspaceId,
      stableKey: `resource-${randomUUID()}`,
      title: "隔离资料",
      sourceType: "LINK",
      externalUrl: "https://example.invalid/v13-subject-merge",
      displayHost: "example.invalid",
      subjectId: pair.sourceSubjectId,
      actorId: pair.actorId,
    },
  });
  const knowledge = await seedKnowledgeReferences(pair);
  const knowledgeGroup = await prisma.knowledgeGroup.create({
    data: {
      userId: pair.actorId,
      workspaceId: pair.workspaceId,
      subjectId: pair.sourceSubjectId,
      stableKey: `group-${randomUUID()}`,
      title: "隔离知识分组",
    },
  });
  const learningArrangement = await prisma.learningArrangement.create({
    data: {
      userId: pair.actorId,
      workspaceId: pair.workspaceId,
      subjectId: pair.sourceSubjectId,
      title: "隔离学习安排",
      startDate: new Date("2026-09-05T00:00:00.000Z"),
      endDate: new Date("2026-09-12T00:00:00.000Z"),
    },
  });
  return {
    ...pair,
    sourceIds: {
      task: task.id,
      session: session.id,
      syllabusNode: syllabusNode.id,
      note: note.id,
      mistake: mistake.id,
      simulationResult: simulationResult.id,
      milestone: milestone.id,
      simulationInbox: simulationInbox.id,
      genericInbox: genericInbox.id,
      resource: resource.id,
      primaryKnowledgePoint: knowledge.primaryKnowledgePointId,
      duplicateKnowledgeLink: knowledge.duplicateLink.id,
      movableKnowledgeLink: knowledge.movableLink.id,
      knowledgeGroup: knowledgeGroup.id,
      learningArrangement: learningArrangement.id,
    },
    simulationInboxPreimage,
    duplicateKnowledgeLinkCreatedAt: knowledge.duplicateLink.createdAt.toISOString(),
    privateMarker,
  };
}

export async function assertCompleteGraphSubject(
  fixture: CompleteSubjectMergeFixture,
  subjectId: string,
  expectDuplicateLink: boolean,
): Promise<void> {
  const ids = fixture.sourceIds;
  const counts = await Promise.all([
    prisma.studyTask.count({ where: { id: ids.task, subjectId } }),
    prisma.studySession.count({ where: { id: ids.session, subjectId } }),
    prisma.syllabusNode.count({ where: { id: ids.syllabusNode, subjectId } }),
    prisma.note.count({ where: { id: ids.note, subjectId } }),
    prisma.mistake.count({ where: { id: ids.mistake, subjectId } }),
    prisma.simulationSubjectResult.count({ where: { id: ids.simulationResult, subjectId } }),
    prisma.planMilestone.count({ where: { id: ids.milestone, subjectId } }),
    prisma.planInboxItem.count({ where: { id: { in: [ids.simulationInbox, ids.genericInbox] }, subjectId } }),
    prisma.studyResource.count({ where: { id: ids.resource, subjectId } }),
    prisma.knowledgePoint.count({ where: { id: ids.primaryKnowledgePoint, primarySubjectId: subjectId } }),
    prisma.knowledgePointSubject.count({ where: { id: ids.movableKnowledgeLink, subjectId } }),
    prisma.knowledgeGroup.count({ where: { id: ids.knowledgeGroup, subjectId } }),
    prisma.learningArrangement.count({ where: { id: ids.learningArrangement, subjectId } }),
  ]);
  assert.deepEqual(counts, [1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1]);
  const duplicateLink = await prisma.knowledgePointSubject.findUnique({
    where: { id: ids.duplicateKnowledgeLink },
  });
  assert.equal(Boolean(duplicateLink), expectDuplicateLink);
  if (duplicateLink) {
    assert.equal(duplicateLink.subjectId, subjectId);
    assert.equal(duplicateLink.role, "SOURCE_DUPLICATE");
    assert.equal(duplicateLink.createdAt.toISOString(), fixture.duplicateKnowledgeLinkCreatedAt);
  }
  if (expectDuplicateLink) {
    const inbox = await prisma.planInboxItem.findUniqueOrThrow({ where: { id: ids.simulationInbox } });
    assert.equal(inbox.originKey, fixture.simulationInboxPreimage.originKey);
    assert.equal(inbox.stableKey, fixture.simulationInboxPreimage.stableKey);
    assert.deepEqual(inbox.originSnapshot, fixture.simulationInboxPreimage.originSnapshot);
  }
}

export async function assertSubjectMergeAuditIsMinimal(
  operationId: string,
  privateMarker: string,
): Promise<void> {
  const event = await prisma.auditEvent.findUniqueOrThrow({ where: { id: operationId } });
  const serialized = JSON.stringify(event.metadata);
  assert.doesNotMatch(serialized, new RegExp(privateMarker));
  assert.ok(Buffer.byteLength(serialized, "utf8") <= 4 * 1024 * 1024);
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown>
    : {};
  assert.equal(metadata.claimState, "completed");
  assert.equal(typeof metadata.scopeHash, "string");
  assert.equal(typeof metadata.sourceMapping, "object");
}

export async function seedSimulationInbox(
  pair: SubjectMergePair,
  examId: string,
  subjectResultId: string,
  subjectId: string,
): Promise<void> {
  const originKey = buildSimulationRemediationOriginKey({
    examId,
    subjectId,
    reason: "CONCEPT_GAP",
    syllabusNodeId: null,
  });
  const snapshot = buildSimulationRemediationOriginSnapshot({
    examId,
    subjectResultId,
    subjectResultRevision: 1,
    subjectId,
    reason: "CONCEPT_GAP",
    syllabusNodeId: null,
    itemIds: [],
    lostScore: 5,
  });
  await prisma.planInboxItem.create({
    data: {
      workspaceId: pair.workspaceId,
      subjectId,
      stableKey: `${originKey}:v1`,
      originKey,
      originVersion: 1,
      originType: "SIMULATION_LOSS",
      originSnapshot: snapshot as Prisma.InputJsonValue,
      title: "模拟来源冲突夹具",
    },
  });
}

function buildSimulationInboxPreimage(
  pair: SubjectMergePair,
  examId: string,
  subjectResultId: string,
) {
  const originKey = buildSimulationRemediationOriginKey({
    examId,
    subjectId: pair.sourceSubjectId,
    reason: "CONCEPT_GAP",
    syllabusNodeId: null,
  });
  const originSnapshot = buildSimulationRemediationOriginSnapshot({
    examId,
    subjectResultId,
    subjectResultRevision: 1,
    subjectId: pair.sourceSubjectId,
    reason: "CONCEPT_GAP",
    syllabusNodeId: null,
    itemIds: [],
    lostScore: 10,
  });
  return { originKey, stableKey: `${originKey}:v1`, originSnapshot };
}

async function seedKnowledgeReferences(pair: SubjectMergePair) {
  const primary = await prisma.knowledgePoint.create({
    data: {
      userId: pair.actorId,
      workspaceId: pair.workspaceId,
      primarySubjectId: pair.sourceSubjectId,
      stableKey: `primary-${randomUUID()}`,
      title: "来源主知识点",
    },
  });
  const [shared, movable] = await Promise.all([
    prisma.knowledgePoint.create({
      data: {
        userId: pair.actorId,
        workspaceId: pair.workspaceId,
        primarySubjectId: pair.targetSubjectId,
        stableKey: `shared-${randomUUID()}`,
        title: "重复关联知识点",
      },
    }),
    prisma.knowledgePoint.create({
      data: {
        userId: pair.actorId,
        workspaceId: pair.workspaceId,
        primarySubjectId: pair.targetSubjectId,
        stableKey: `movable-${randomUUID()}`,
        title: "可迁移关联知识点",
      },
    }),
  ]);
  await prisma.knowledgePointSubject.create({
    data: { knowledgePointId: shared.id, subjectId: pair.targetSubjectId, role: "RELATED" },
  });
  const [duplicateLink, movableLink] = await Promise.all([
    prisma.knowledgePointSubject.create({
      data: { knowledgePointId: shared.id, subjectId: pair.sourceSubjectId, role: "SOURCE_DUPLICATE" },
    }),
    prisma.knowledgePointSubject.create({
      data: { knowledgePointId: movable.id, subjectId: pair.sourceSubjectId, role: "RELATED" },
    }),
  ]);
  return {
    primaryKnowledgePointId: primary.id,
    duplicateLink,
    movableLink,
  };
}
