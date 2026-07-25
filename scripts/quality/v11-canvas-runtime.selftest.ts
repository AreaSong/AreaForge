import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { getKnowledgeCanvas } from "../../apps/web/lib/study/knowledge-canvas-service";

const noteCount = 4_996;

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
      "Note",
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
  await prisma.syllabusNode.create({
    data: { subjectId: subject.id, stableKey: "root", title: "数据结构总纲", kind: "CHAPTER" },
  });
  await prisma.note.createMany({
    data: Array.from({ length: noteCount }, (_, index) => ({
      subjectId: subject.id,
      stableKey: `canvas-note-${String(index).padStart(4, "0")}`,
      title: `Canvas Note ${String(index).padStart(4, "0")}`,
      content: "isolated canvas fixture",
    })),
  });

  assert.equal(await prisma.note.count({ where: { subjectId: subject.id } }), noteCount);
  const defaultLayer = await getKnowledgeCanvas(user.id, { depth: 1, limit: 80 });
  assert.ok(defaultLayer.nodes.length <= 80);
  assert.ok(defaultLayer.nodes.some((node) => node.entityType === "WORKSPACE"));
  assert.ok(defaultLayer.nodes.some((node) => node.entityType === "SUBJECT_GROUP"));
  assert.equal(defaultLayer.nodes.some((node) => node.entityType === "SUBJECT"), false);
  assert.equal(defaultLayer.nodes.some((node) => node.entityType === "NOTE"), false);

  const subjectLayer = await getKnowledgeCanvas(user.id, { depth: 2, limit: 80 });
  assert.ok(subjectLayer.nodes.some((node) => node.entityType === "SUBJECT"));
  assert.equal(subjectLayer.nodes.some((node) => node.entityType === "NOTE"), false);

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
  assert.equal(second.nodes.some((node) => firstIds.has(node.id)), false);

  const searched = await getKnowledgeCanvas(user.id, {
    focus: `SUBJECT:${subject.id}`,
    depth: 1,
    limit: 80,
    entityType: "NOTE",
    q: "Canvas Note 4995",
  });
  assert.ok(searched.nodes.some((node) => node.label === "Canvas Note 4995"));
  assert.ok(searched.nodes.length <= 80);

  await assert.rejects(
    () => getKnowledgeCanvas(user.id, { focus: "NOTE:missing", depth: 1 }),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_CANVAS_FOCUS",
  );
  await assert.rejects(
    () => getKnowledgeCanvas(user.id, { cursor: "invalid", depth: 1 }),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_CANVAS_CURSOR",
  );

  console.log(JSON.stringify({
    schemaVersion: "v11-canvas-runtime-selftest-v1",
    status: "pass",
    database,
    totalObjects: noteCount + 4,
    firstPage: first.nodes.length,
    secondPage: second.nodes.length,
    checks: {
      layeredDefault: "pass",
      boundedPagination: "pass",
      noPageOverlap: "pass",
      exactSearchAcrossFixture: "pass",
      stableInvalidFocusAndCursor: "pass",
      defaultLayoutNoCoordinateOverlap: "pass",
    },
  }, null, 2));
  console.log("PASS v1.1 5,000-object canvas runtime selftest");
} finally {
  await prisma.$disconnect();
}
