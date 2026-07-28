import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import { ApiError, zodErrorResponse } from "../../apps/web/lib/api/responses";
import { knowledgeCanvasLayoutPutSchema } from "../../apps/web/lib/study/knowledge-canvas-contract";
import {
  getKnowledgeCanvas,
  isKnowledgeCanvasLayoutIdentityUniqueConstraintError,
  resetKnowledgeCanvasLayout,
  saveKnowledgeCanvasLayout,
} from "../../apps/web/lib/study/knowledge-canvas-service";

const noteCount = 4_987;
const bulkNoteCount = noteCount - 2;

try {
  if (process.env.AREAFORGE_V11_CANVAS_ISOLATED_DB !== "1") {
    throw new Error("requires AREAFORGE_V11_CANVAS_ISOLATED_DB=1");
  }
  const [{ current_database: database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!database.includes("v11canvas")) throw new Error("refused database without v11canvas marker");

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "KnowledgeCanvasNodeLayout",
      "KnowledgeCanvasLayout",
      "ReviewEvent",
      "ReviewSchedule",
      "StudyResourceSyllabusNodeLink",
      "StudyResourceMistakeLink",
      "StudyResourceNoteLink",
      "StudyResourceTaskLink",
      "StudyResourceTag",
      "StudyResource",
      "TaskDependency",
      "StudySession",
      "StudyTaskRelatedSyllabusNode",
      "StudyTask",
      "PlanMilestone",
      "StagePlan",
      "NoteRelatedSyllabusNode",
      "Note",
      "Mistake",
      "SyllabusNode",
      "Subject",
      "SubjectGroup",
      "ExamWorkspace",
      "AuditEvent",
      "User"
    RESTART IDENTITY CASCADE
  `);

  const user = await prisma.user.create({
    data: { email: `v11canvas-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const workspace = await prisma.examWorkspace.create({
    data: { userId: user.id, stableKey: "canvas", name: "Canvas Fixture", status: "ACTIVE" },
  });
  const group = await prisma.subjectGroup.create({
    data: { workspaceId: workspace.id, stableKey: "group-408", name: "408" },
  });
  const subject = await prisma.subject.create({
    data: { workspaceId: workspace.id, groupId: group.id, stableKey: "ds", name: "数据结构", color: "#14b8a6" },
  });
  const rootNode = await prisma.syllabusNode.create({
    data: { subjectId: subject.id, stableKey: "root", title: "数据结构总纲", kind: "CHAPTER" },
  });
  const leafNode = await prisma.syllabusNode.create({
    data: { subjectId: subject.id, parentId: rootNode.id, stableKey: "linear-list", title: "线性表", kind: "TOPIC" },
  });
  await prisma.note.createMany({
    data: Array.from({ length: bulkNoteCount }, (_, index) => ({
      subjectId: subject.id,
      stableKey: `canvas-note-${String(index).padStart(4, "0")}`,
      title: `Canvas Note ${String(index).padStart(4, "0")}`,
      content: "isolated canvas fixture",
    })),
  });
  const stagePlan = await prisma.stagePlan.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "canvas-stage",
      name: "Canvas Stage",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-08-01T00:00:00.000Z"),
      goal: "验证真实关系图",
      mode: "NORMAL",
      status: "ACTIVE",
    },
  });
  const milestone = await prisma.planMilestone.create({
    data: {
      workspaceId: workspace.id,
      stagePlanId: stagePlan.id,
      subjectId: subject.id,
      stableKey: "canvas-milestone",
      title: "掌握线性表",
    },
  });
  const predecessor = await prisma.studyTask.create({
    data: {
      subjectId: subject.id,
      syllabusNodeId: rootNode.id,
      planMilestoneId: milestone.id,
      title: "阅读线性表",
      type: "study",
      status: "DONE",
      plannedDate: new Date("2026-07-26T00:00:00.000Z"),
    },
  });
  const successor = await prisma.studyTask.create({
    data: {
      subjectId: subject.id,
      syllabusNodeId: leafNode.id,
      parentTaskId: predecessor.id,
      planMilestoneId: milestone.id,
      title: "完成线性表练习",
      type: "practice",
      status: "IN_PROGRESS",
      plannedDate: new Date("2026-07-26T00:00:00.000Z"),
    },
  });
  await prisma.taskDependency.create({
    data: { predecessorId: predecessor.id, successorId: successor.id, type: "HARD", actorId: user.id },
  });
  const relatedNote = await prisma.note.create({
    data: {
      subjectId: subject.id,
      syllabusNodeId: leafNode.id,
      taskId: successor.id,
      stableKey: "canvas-related-note",
      title: "线性表关系卡片",
      content: "只用于验证真实业务关系",
      relatedSyllabusNodes: { create: { syllabusNodeId: rootNode.id } },
    },
  });
  const archivedNote = await prisma.note.create({
    data: {
      subjectId: subject.id,
      stableKey: "canvas-archived-note",
      title: "已归档关系笔记",
      content: "只作为真实关系端点返回",
      archivedAt: new Date("2026-07-25T00:00:00.000Z"),
    },
  });
  const mistake = await prisma.mistake.create({
    data: { subjectId: subject.id, syllabusNodeId: leafNode.id, title: "线性表边界条件错题" },
  });
  const resource = await prisma.studyResource.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "canvas-resource",
      title: "线性表讲义",
      sourceType: "LINK",
      subjectId: subject.id,
      externalUrl: "https://example.com/linear-list",
      displayHost: "example.com",
      actorId: user.id,
      taskLinks: { create: { taskId: successor.id } },
      noteLinks: { create: [{ noteId: relatedNote.id }, { noteId: archivedNote.id }] },
      mistakeLinks: { create: { mistakeId: mistake.id } },
      syllabusNodeLinks: { create: { syllabusNodeId: leafNode.id } },
    },
  });
  const archivedResource = await prisma.studyResource.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "canvas-archived-resource",
      title: "已归档关系资料",
      sourceType: "LINK",
      subjectId: subject.id,
      externalUrl: "https://example.com/archived-linear-list",
      displayHost: "example.com",
      archivedAt: new Date("2026-07-25T00:00:00.000Z"),
      actorId: user.id,
      noteLinks: { create: { noteId: relatedNote.id } },
    },
  });
  await prisma.studySession.create({
    data: {
      subjectId: subject.id,
      taskId: successor.id,
      syllabusNodeId: leafNode.id,
      status: "RUNNING",
      startedAt: new Date("2026-07-26T01:00:00.000Z"),
    },
  });
  const schedule = await prisma.reviewSchedule.create({
    data: {
      workspaceId: workspace.id,
      targetType: "NOTE",
      noteId: relatedNote.id,
      status: "PAUSED",
      dueDate: null,
      pausedReason: "runtime context-only fixture",
      actorId: user.id,
    },
  });
  await prisma.studyTask.update({ where: { id: successor.id }, data: { reviewScheduleId: schedule.id } });

  assert.equal(await prisma.note.count({ where: { subjectId: subject.id } }), noteCount);
  const objectCount = (await Promise.all([
    prisma.examWorkspace.count({ where: { id: workspace.id } }),
    prisma.subjectGroup.count({ where: { workspaceId: workspace.id } }),
    prisma.subject.count({ where: { workspaceId: workspace.id } }),
    prisma.syllabusNode.count({ where: { subjectId: subject.id } }),
    prisma.note.count({ where: { subjectId: subject.id } }),
    prisma.studyTask.count({ where: { subjectId: subject.id } }),
    prisma.planMilestone.count({ where: { workspaceId: workspace.id } }),
    prisma.mistake.count({ where: { subjectId: subject.id } }),
    prisma.studyResource.count({ where: { workspaceId: workspace.id } }),
    prisma.studySession.count({ where: { subjectId: subject.id } }),
    prisma.reviewSchedule.count({ where: { workspaceId: workspace.id } }),
  ])).reduce((sum, count) => sum + count, 0);
  assert.equal(objectCount, 5_000);
  const tailNote = await prisma.note.findFirst({
    where: { subjectId: subject.id, stableKey: "canvas-note-4984" },
    select: { id: true },
  });
  assert.ok(tailNote);
  const defaultLayer = await getKnowledgeCanvas(user.id, { depth: 1, limit: 80 });
  assert.equal(defaultLayer.layout.hasSavedLayout, false);
  assert.ok(defaultLayer.nodes.length <= 80);
  assert.ok(defaultLayer.nodes.some((node) => node.entityType === "WORKSPACE"));
  assert.ok(defaultLayer.nodes.some((node) => node.entityType === "SUBJECT_GROUP"));
  assert.equal(defaultLayer.nodes.some((node) => node.entityType === "SUBJECT"), false);
  assert.equal(defaultLayer.nodes.some((node) => node.entityType === "NOTE"), false);

  const subjectLayer = await getKnowledgeCanvas(user.id, { depth: 2, limit: 80 });
  assert.ok(subjectLayer.nodes.some((node) => node.entityType === "SUBJECT"));
  assert.equal(subjectLayer.nodes.some((node) => node.entityType === "NOTE" && !node.contextOnly), false);
  assert.equal(subjectLayer.nodes.find((node) => node.id === `NOTE:${archivedNote.id}`)?.contextOnly, true);

  const first = await getKnowledgeCanvas(user.id, {
    focus: `SUBJECT:${subject.id}`,
    depth: 1,
    limit: 80,
    entityType: "NOTE",
  });
  assert.equal(first.nodes.length, 80);
  assert.equal(first.truncated, true);
  assert.ok(first.nextCursor);
  const firstIds = new Set(first.nodes.map((node) => node.id));
  const firstPositions = new Set(first.nodes.map((node) => `${node.x}:${node.y}`));
  assert.equal(firstPositions.size, first.nodes.length);

  const second = await getKnowledgeCanvas(user.id, {
    focus: `SUBJECT:${subject.id}`,
    depth: 1,
    limit: 80,
    cursor: first.nextCursor,
    entityType: "NOTE",
  });
  assert.equal(second.nodes.length, 80);
  assert.deepEqual(new Set(second.nodes.filter((node) => firstIds.has(node.id)).map((node) => node.id)), new Set([
    `SUBJECT:${subject.id}`,
    `SUBJECT_GROUP:${group.id}`,
    `NOTE:${archivedNote.id}`,
    `STUDY_RESOURCE:${archivedResource.id}`,
  ]));
  assert.ok(second.edges.every((edge) => second.nodes.some((node) => node.id === edge.sourceId)));
  assert.ok(second.edges.every((edge) => second.nodes.some((node) => node.id === edge.targetId)));

  const searched = await getKnowledgeCanvas(user.id, {
    depth: 0,
    limit: 80,
    entityType: "NOTE",
    q: "Canvas Note 4984",
  });
  assert.ok(searched.nodes.some((node) => node.label === "Canvas Note 4984"));
  assert.ok(searched.nodes.some((node) => node.entityType === "WORKSPACE"));
  assert.ok(searched.nodes.length <= 80);

  const pagedNodeIds = new Set<string>();
  const contextOnlyNodeIds = new Set<string>();
  const pagedEdgeIds = new Set<string>();
  const contextOnlyEdgeIds = new Set<string>();
  const seenCursors = new Set<string>();
  let fullCursor: string | null = null;
  let fullPageCount = 0;
  let graphEdgeCount = -1;
  do {
    const page = await getKnowledgeCanvas(user.id, {
      focus: `SUBJECT:${subject.id}`,
      depth: 4,
      limit: 200,
      cursor: fullCursor,
    });
    fullPageCount += 1;
    assert.ok(fullPageCount < 100, "canvas cursor did not terminate");
    assert.equal(page.graphNodeCount, objectCount - 4);
    assert.equal(page.pageContextTruncated, false);
    assert.ok(page.loadStats.candidateRowsRead <= page.loadStats.candidateWindowLimit);
    assert.ok(page.loadStats.returnedNodeRows <= 200);
    assert.ok(page.loadStats.relationRowsRead <= page.loadStats.relationWindowLimit);
    assert.ok(page.loadStats.candidateRowsRead * 5 < page.graphNodeCount);
    assert.ok(page.loadStats.returnedNodeRows * 5 < page.graphNodeCount);
    assert.ok(page.loadStats.relationRowsRead * 2 < page.graphNodeCount);
    assert.ok(page.loadStats.ancestorRowsRead <= page.loadStats.candidateWindowLimit * 8);
    assert.ok(page.loadStats.layoutRowsRead <= page.loadStats.returnedNodeRows);
    assert.ok(page.loadStats.staleLayoutRowsRead <= 100);
    if (graphEdgeCount < 0) graphEdgeCount = page.graphEdgeCount;
    assert.equal(page.graphEdgeCount, graphEdgeCount);
    const pageNodeById = new Map(page.nodes.map((node) => [node.id, node]));
    for (const node of page.nodes) {
      if (node.contextOnly) contextOnlyNodeIds.add(node.id);
      else pagedNodeIds.add(node.id);
    }
    for (const edge of page.edges) {
      const source = pageNodeById.get(edge.sourceId);
      const target = pageNodeById.get(edge.targetId);
      assert.ok(source);
      assert.ok(target);
      if (source.contextOnly || target.contextOnly) contextOnlyEdgeIds.add(edge.id);
      else pagedEdgeIds.add(edge.id);
    }
    if (page.truncated) {
      assert.ok(page.nextCursor, "truncated page must advance cursor");
      assert.equal(seenCursors.has(page.nextCursor), false, "canvas cursor repeated");
      seenCursors.add(page.nextCursor);
    } else {
      assert.equal(page.nextCursor, null);
    }
    fullCursor = page.nextCursor;
  } while (fullCursor);
  assert.equal(pagedNodeIds.size, objectCount - 4);
  assert.equal(pagedEdgeIds.size, graphEdgeCount);
  assert.deepEqual(contextOnlyNodeIds, new Set([
    `NOTE:${archivedNote.id}`,
    `REVIEW_SCHEDULE:${schedule.id}`,
    `STUDY_RESOURCE:${archivedResource.id}`,
    `TASK:${predecessor.id}`,
  ]));
  assert.ok(contextOnlyEdgeIds.size >= 4);

  const tailFocus = await getKnowledgeCanvas(user.id, {
    focus: `NOTE:${tailNote.id}`,
    depth: 1,
    limit: 80,
  });
  assert.equal(tailFocus.focusId, `NOTE:${tailNote.id}`);
  assert.ok(tailFocus.nodes.some((node) => node.id === `SUBJECT:${subject.id}`));
  assert.equal(
    tailFocus.nodes.find((node) => node.id === `NOTE:${tailNote.id}`)?.href,
    `/knowledge/notes/${tailNote.id}`,
  );

  const leafFocus = await getKnowledgeCanvas(user.id, {
    focus: `NOTE:${relatedNote.id}`,
    depth: 1,
    limit: 80,
  });
  assert.equal(leafFocus.focusId, `NOTE:${relatedNote.id}`);
  for (const expectedId of [
    `SYLLABUS_NODE:${leafNode.id}`,
    `SYLLABUS_NODE:${rootNode.id}`,
    `TASK:${successor.id}`,
    `STUDY_RESOURCE:${resource.id}`,
    `STUDY_RESOURCE:${archivedResource.id}`,
    `REVIEW_SCHEDULE:${schedule.id}`,
  ]) {
    assert.ok(leafFocus.nodes.some((node) => node.id === expectedId), `leaf focus missing ${expectedId}`);
  }
  assert.ok(leafFocus.edges.some((edge) => edge.kind === "evidence" && edge.targetId === `NOTE:${relatedNote.id}`));
  assert.ok(leafFocus.edges.some((edge) => edge.kind === "schedules" && edge.sourceId === `NOTE:${relatedNote.id}`));
  assert.equal(leafFocus.nodes.find((node) => node.id === `STUDY_RESOURCE:${archivedResource.id}`)?.contextOnly, true);
  assert.equal(leafFocus.nodes.find((node) => node.id === `REVIEW_SCHEDULE:${schedule.id}`)?.contextOnly, true);
  assert.equal(
    leafFocus.nodes.find((node) => node.id === `NOTE:${relatedNote.id}`)?.href,
    `/knowledge/notes/${relatedNote.id}`,
  );

  const taskFocus = await getKnowledgeCanvas(user.id, {
    focus: `TASK:${successor.id}`,
    depth: 1,
    limit: 80,
  });
  assert.equal(taskFocus.nodes.find((node) => node.id === `TASK:${predecessor.id}`)?.contextOnly, true);
  assert.equal(taskFocus.nodes.find((node) => node.id === `REVIEW_SCHEDULE:${schedule.id}`)?.contextOnly, true);
  assert.ok(taskFocus.edges.some((edge) => edge.kind === "depends" && edge.sourceId === `TASK:${predecessor.id}`));

  const resourceFocus = await getKnowledgeCanvas(user.id, {
    focus: `STUDY_RESOURCE:${resource.id}`,
    depth: 1,
    limit: 80,
  });
  assert.equal(resourceFocus.nodes.find((node) => node.id === `NOTE:${archivedNote.id}`)?.contextOnly, true);
  assert.ok(resourceFocus.edges.some((edge) =>
    edge.sourceId === `NOTE:${archivedNote.id}` && edge.targetId === `STUDY_RESOURCE:${resource.id}`,
  ));

  const duplicateLayoutInput = {
    workspaceId: workspace.id,
    expectedRevision: 1,
    nodes: [
      { entityType: "NOTE" as const, entityId: relatedNote.id, x: 10, y: 20 },
      { entityType: "NOTE" as const, entityId: relatedNote.id, x: 30, y: 40 },
    ],
  };
  const duplicateContractResult = knowledgeCanvasLayoutPutSchema.safeParse(duplicateLayoutInput);
  assert.equal(duplicateContractResult.success, false);
  if (duplicateContractResult.success) throw new Error("duplicate layout contract unexpectedly passed");
  const duplicateResponse = zodErrorResponse(duplicateContractResult.error);
  assert.equal(duplicateResponse.status, 400);
  assert.equal((await duplicateResponse.json() as { error: string }).error, "INVALID_REQUEST");
  await assert.rejects(
    () => saveKnowledgeCanvasLayout(user.id, duplicateLayoutInput),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_LAYOUT_PATCH" && error.status === 400,
  );
  assert.equal(await prisma.knowledgeCanvasLayout.count({ where: { userId: user.id, workspaceId: workspace.id } }), 0);
  assert.equal(isKnowledgeCanvasLayoutIdentityUniqueConstraintError({
    code: "P2002",
    meta: { target: ["userId", "workspaceId"] },
  }), true);
  assert.equal(isKnowledgeCanvasLayoutIdentityUniqueConstraintError({
    code: "P2002",
    meta: { target: ["layoutId", "entityType", "entityId"] },
  }), false);
  assert.equal(isKnowledgeCanvasLayoutIdentityUniqueConstraintError({
    code: "P2002",
    meta: { target: "KnowledgeCanvasLayout_userId_workspaceId_key" },
  }), true);
  assert.equal(isKnowledgeCanvasLayoutIdentityUniqueConstraintError({
    code: "P2002",
    meta: { target: "KnowledgeCanvasNodeLayout_layoutId_entityType_entityId_key" },
  }), false);

  const firstLayoutAttempts = await Promise.allSettled([
    saveKnowledgeCanvasLayout(user.id, {
      workspaceId: workspace.id,
      expectedRevision: 1,
      nodes: [{ entityType: "NOTE", entityId: relatedNote.id, x: 10, y: 20 }],
    }),
    saveKnowledgeCanvasLayout(user.id, {
      workspaceId: workspace.id,
      expectedRevision: 1,
      nodes: [{ entityType: "NOTE", entityId: relatedNote.id, x: 30, y: 40 }],
    }),
  ]);
  assert.equal(firstLayoutAttempts.filter((result) => result.status === "fulfilled").length, 1);
  const fulfilledLayout = firstLayoutAttempts.find((result) => result.status === "fulfilled");
  assert.ok(fulfilledLayout?.status === "fulfilled");
  const rejectedLayout = firstLayoutAttempts.find((result) => result.status === "rejected");
  assert.ok(rejectedLayout?.status === "rejected");
  assert.ok(rejectedLayout.reason instanceof ApiError && rejectedLayout.reason.code === "LAYOUT_REVISION_CONFLICT");

  const viewportLayout = await saveKnowledgeCanvasLayout(user.id, {
    workspaceId: workspace.id,
    expectedRevision: fulfilledLayout.value.revision,
    viewportX: 125,
    viewportY: -75,
    viewportZoom: 1.35,
    nodes: [],
  });
  const viewportReload = await getKnowledgeCanvas(user.id, { focus: `NOTE:${relatedNote.id}`, depth: 1 });
  assert.equal(viewportReload.layout.hasSavedLayout, true);
  assert.equal(viewportReload.layout.revision, viewportLayout.revision);
  assert.equal(viewportReload.layout.viewportX, 125);
  assert.equal(viewportReload.layout.viewportY, -75);
  assert.equal(viewportReload.layout.viewportZoom, 1.35);

  const staleLayout = await saveKnowledgeCanvasLayout(user.id, {
    workspaceId: workspace.id,
    expectedRevision: viewportLayout.revision,
    nodes: [{ entityType: "NOTE", entityId: "deleted-note", x: 50, y: 60 }],
  });
  const staleCanvas = await getKnowledgeCanvas(user.id, { focus: `NOTE:${relatedNote.id}`, depth: 1 });
  assert.ok(staleCanvas.layout.staleLayoutCandidates.some((node) =>
    node.entityType === "NOTE" && node.entityId === "deleted-note",
  ));

  await assert.rejects(
    () => getKnowledgeCanvas(user.id, { focus: "NOTE:missing", depth: 1 }),
    (error: unknown) => error instanceof ApiError && error.code === "CANVAS_FOCUS_NOT_FOUND" && error.status === 404,
  );
  await assert.rejects(
    () => getKnowledgeCanvas(user.id, { cursor: "invalid", depth: 1 }),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_CANVAS_CURSOR",
  );
  await assert.rejects(
    () => getKnowledgeCanvas(user.id, { cursor: `NOTE:${relatedNote.id}`, depth: 4, entityType: "MISTAKE" }),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_CANVAS_CURSOR",
  );

  const foreignUser = await prisma.user.create({
    data: { email: `v11canvas-foreign-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const foreignWorkspace = await prisma.examWorkspace.create({
    data: { userId: foreignUser.id, stableKey: "foreign-canvas", name: "Foreign Canvas", status: "ACTIVE" },
  });
  await assert.rejects(
    () => saveKnowledgeCanvasLayout(foreignUser.id, {
      workspaceId: workspace.id,
      expectedRevision: staleLayout.revision,
      nodes: [],
    }),
    (error: unknown) => error instanceof ApiError && error.code === "WORKSPACE_NOT_FOUND" && error.status === 404,
  );
  await assert.rejects(
    () => resetKnowledgeCanvasLayout(foreignUser.id, { workspaceId: foreignWorkspace.id, expectedRevision: 2 }),
    (error: unknown) => error instanceof ApiError && error.code === "LAYOUT_REVISION_CONFLICT",
  );

  const raceUser = await prisma.user.create({
    data: { email: `v11canvas-race-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const raceWorkspace = await prisma.examWorkspace.create({
    data: { userId: raceUser.id, stableKey: "race-canvas", name: "Race Canvas", status: "ACTIVE" },
  });
  const putDeleteRace = await Promise.allSettled([
    saveKnowledgeCanvasLayout(raceUser.id, {
      workspaceId: raceWorkspace.id,
      expectedRevision: 1,
      nodes: [{ entityType: "WORKSPACE", entityId: raceWorkspace.id, x: 1, y: 2 }],
    }),
    resetKnowledgeCanvasLayout(raceUser.id, { workspaceId: raceWorkspace.id, expectedRevision: 1 }),
  ]);
  assert.ok(await prisma.knowledgeCanvasLayout.findUnique({
    where: { userId_workspaceId: { userId: raceUser.id, workspaceId: raceWorkspace.id } },
  }));
  assert.ok(putDeleteRace.every((result) =>
    result.status === "fulfilled" ||
    (result.reason instanceof ApiError && result.reason.code === "LAYOUT_REVISION_CONFLICT"),
  ));

  await prisma.examWorkspace.update({
    where: { id: workspace.id },
    data: { status: "ARCHIVED", archivedAt: new Date(), revision: { increment: 1 } },
  });
  await assert.rejects(
    () => saveKnowledgeCanvasLayout(user.id, {
      workspaceId: workspace.id,
      expectedRevision: staleLayout.revision,
      nodes: [{ entityType: "NOTE", entityId: relatedNote.id, x: 70, y: 80 }],
    }),
    (error: unknown) => error instanceof ApiError && error.code === "WORKSPACE_STATE_CONFLICT" && error.status === 409,
  );

  console.log(JSON.stringify({
    schemaVersion: "v11-canvas-runtime-selftest-v3",
    status: "pass",
    database,
    totalObjects: objectCount,
    firstPage: first.nodes.length,
    secondPage: second.nodes.length,
    fullPageCount,
    checks: {
      layeredDefault: "pass",
      boundedPagination: "pass",
      noPageOverlap: "pass",
      exactSearchAcrossFixture: "pass",
      completeCursorTraversal: "pass",
      completeRelationTraversal: "pass",
      leafBidirectionalFocus: "pass",
      realBusinessRelations: "pass",
      inactiveRelationEndpoints: "pass",
      pageContextEndpoints: "pass",
      tailFocusById: "pass",
      duplicateLayoutRejected400: "pass",
      preciseP2002Classification: "pass",
      firstLayoutConcurrency409: "pass",
      viewportSaveReload: "pass",
      layoutRetryAndStaleEvidence: "pass",
      ownerAndActiveWorkspaceIsolation: "pass",
      firstPutDeleteRace: "pass",
      stableInvalidFocusAndCursor: "pass",
      defaultLayoutNoCoordinateOverlap: "pass",
    },
  }, null, 2));
  console.log("PASS v1.1 5,000-object canvas runtime selftest");
} finally {
  await prisma.$disconnect();
}
