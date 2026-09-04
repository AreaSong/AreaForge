import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { listSubjectDuplicatePreviews } from "../../apps/web/lib/study/subject-duplicate-query-service";
import { mergeWorkspaceSubjects } from "../../apps/web/lib/study/subject-merge-service";
import {
  listRecentSubjectMergeOperations,
  undoWorkspaceSubjectMerge,
} from "../../apps/web/lib/study/subject-merge-undo-service";
import {
  addTargetReferenceWeight,
  assertCompleteGraphSubject,
  assertSubjectMergeAuditIsMinimal,
  resetSubjectMergeFixture,
  seedCompleteSubjectMergeGraph,
  seedSimulationInbox,
  seedSubjectMergePair,
  type SubjectMergePair,
} from "./v13-subject-merge-runtime-fixture";

const checks: RuntimeCheck[] = [];

interface RuntimeCheck {
  id: string;
  status: "pass";
  details: Record<string, string | number | boolean>;
}

try {
  await assertIsolatedDatabase();
  await runIsolated("complete_merge_and_exact_undo", verifyCompleteMergeAndUndo);
  await runIsolated("active_session_blocks", verifyActiveSessionBlock);
  await runIsolated("ownership_and_stale_snapshot", verifyOwnershipAndStaleSnapshot);
  await runIsolated("previewed_unique_conflicts", verifyPreviewedUniqueConflicts);
  await runIsolated("merge_transaction_rollback", verifyMergeTransactionRollback);
  await runIsolated("undo_scope_drift", verifyUndoScopeDrift);
  await runIsolated("undo_unique_conflict_rollback", verifyUndoUniqueConflictRollback);
  await runIsolated("undo_expiry", verifyUndoExpiry);
  await runIsolated("corrupt_audit_visibility", verifyCorruptAuditVisibility);

  console.log(JSON.stringify({
    schemaVersion: "v13-subject-merge-runtime-selftest-v1",
    status: "pass",
    checks,
    doesNotProve: [
      "production migration or production data safety",
      "browser experience",
      "signed Release readiness",
      "v1.3 release or production completion",
    ],
    safetyFacts: {
      isolatedDatabaseRequired: true,
      productionWriteAttempted: false,
      physicalDeleteAttempted: false,
      serverCommandAttempted: false,
    },
  }, null, 2));
  console.log("PASS v1.3 subject merge isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V13_SUBJECT_MERGE_ISOLATED_DB !== "1") {
    throw new Error("v1.3 subject merge selftest requires AREAFORGE_V13_SUBJECT_MERGE_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const database = rows[0]?.current_database ?? "";
  if (!database.includes("v13subjectmerge")) {
    throw new Error("v1.3 subject merge selftest refused a database without the v13subjectmerge marker");
  }
  pass("isolated_database_guard", { database });
}

async function runIsolated(id: string, run: () => Promise<void>): Promise<void> {
  await resetSubjectMergeFixture();
  await run();
  pass(id, { verified: true });
}

async function verifyCompleteMergeAndUndo(): Promise<void> {
  const fixture = await seedCompleteSubjectMergeGraph(await seedSubjectMergePair("complete"));
  const preview = await getPreview(fixture);
  assert.equal(preview.conflictCounts.relatedKnowledgePoints, 1);
  assert.equal(preview.requiredReassignments.primaryKnowledgePoints, 1);
  assert.equal(preview.requiredReassignments.simulationOriginInboxItems, 1);
  assert.equal(totalBlockingConflicts(preview), 0);

  const mergeInput = commandFor(fixture, preview, `merge-${randomUUID()}`);
  const merged = await mergeWorkspaceSubjects(fixture.actorId, mergeInput);
  assert.deepEqual(await mergeWorkspaceSubjects(fixture.actorId, mergeInput), merged);
  await expectApiError(
    () => mergeWorkspaceSubjects(fixture.actorId, { ...mergeInput, snapshotHash: `${mergeInput.snapshotHash}-changed` }),
    "SUBJECT_MERGE_IDEMPOTENCY_CONFLICT",
  );
  assert.deepEqual(merged.migratedReferenceCounts, expectedReferenceCounts());
  assert.equal(merged.deduplicatedRelatedKnowledgePointLinks, 1);
  assert.equal((await sourceSubject(fixture)).archivedAt instanceof Date, true);
  await assertCompleteGraphSubject(fixture, fixture.targetSubjectId, false);
  await assertSubjectMergeAuditIsMinimal(merged.operationId, fixture.privateMarker);

  const operations = await listRecentSubjectMergeOperations(fixture.actorId, fixture.workspaceId);
  const operation = operations.find((item) => item.id === merged.operationId);
  assert.equal(operation?.status, "AVAILABLE");
  assert.ok(operation);
  await prisma.studyTask.update({
    where: { id: fixture.sourceIds.task },
    data: { title: "合并后保留的任务标题" },
  });
  const undoInput = {
    workspaceId: fixture.workspaceId,
    operationId: operation.id,
    expectedWorkspaceRevision: operation.workspaceRevision,
    undoSnapshotHash: operation.undoSnapshotHash,
    idempotencyKey: `undo-${randomUUID()}`,
    confirm: true as const,
  };
  const undone = await undoWorkspaceSubjectMerge(fixture.actorId, undoInput);
  assert.deepEqual(await undoWorkspaceSubjectMerge(fixture.actorId, undoInput), undone);
  await expectApiError(
    () => undoWorkspaceSubjectMerge(fixture.actorId, { ...undoInput, expectedWorkspaceRevision: 999 }),
    "SUBJECT_MERGE_UNDO_IDEMPOTENCY_CONFLICT",
  );
  assert.deepEqual(undone.restoredReferenceCounts, expectedReferenceCounts());
  assert.equal(undone.recreatedRelatedKnowledgePointLinks, 1);
  assert.equal((await sourceSubject(fixture)).archivedAt, null);
  await assertCompleteGraphSubject(fixture, fixture.sourceSubjectId, true);
  const editedTask = await prisma.studyTask.findUniqueOrThrow({ where: { id: fixture.sourceIds.task } });
  assert.equal(editedTask.title, "合并后保留的任务标题");
  const afterOperations = await listRecentSubjectMergeOperations(fixture.actorId, fixture.workspaceId);
  assert.equal(afterOperations.find((item) => item.id === merged.operationId)?.status, "UNDONE");
}

async function verifyActiveSessionBlock(): Promise<void> {
  const pair = await seedSubjectMergePair("active");
  await addTargetReferenceWeight(pair, 2);
  const session = await prisma.studySession.create({
    data: {
      subjectId: pair.sourceSubjectId,
      userId: pair.actorId,
      workspaceId: pair.workspaceId,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
  const preview = await getPreview(pair);
  await expectApiError(
    () => mergeWorkspaceSubjects(pair.actorId, commandFor(pair, preview, `active-${randomUUID()}`)),
    "ACTIVE_SESSION_BLOCKS_SUBJECT_MERGE",
  );
  assert.equal((await prisma.studySession.findUniqueOrThrow({ where: { id: session.id } })).subjectId, pair.sourceSubjectId);
  assert.equal((await sourceSubject(pair)).archivedAt, null);
}

async function verifyOwnershipAndStaleSnapshot(): Promise<void> {
  const pair = await seedSubjectMergePair("ownership");
  const outsider = await seedSubjectMergePair("outsider");
  const preview = await getPreview(pair);
  await expectApiError(() => listSubjectDuplicatePreviews(outsider.actorId, pair.workspaceId), "WORKSPACE_NOT_FOUND", 404);
  await expectApiError(
    () => mergeWorkspaceSubjects(outsider.actorId, commandFor(pair, preview, `cross-${randomUUID()}`)),
    "WORKSPACE_NOT_FOUND",
    404,
  );
  await prisma.examWorkspace.update({ where: { id: pair.workspaceId }, data: { revision: { increment: 1 } } });
  await expectApiError(
    () => mergeWorkspaceSubjects(pair.actorId, commandFor(pair, preview, `stale-${randomUUID()}`)),
    "SUBJECT_MERGE_SNAPSHOT_CONFLICT",
  );
  assert.equal((await sourceSubject(pair)).archivedAt, null);
}

async function verifyPreviewedUniqueConflicts(): Promise<void> {
  const pair = await seedSubjectMergePair("conflicts");
  await addTargetReferenceWeight(pair, 10);
  const sharedKey = `shared-${randomUUID()}`;
  await Promise.all([
    prisma.syllabusNode.create({ data: { subjectId: pair.targetSubjectId, title: "目标节点", kind: "TOPIC", stableKey: sharedKey } }),
    prisma.syllabusNode.create({ data: { subjectId: pair.sourceSubjectId, title: "来源节点", kind: "TOPIC", stableKey: sharedKey } }),
  ]);
  const exam = await prisma.simulationExam.create({
    data: { workspaceId: pair.workspaceId, name: "冲突考试", examDate: new Date(), status: "CONFIRMED" },
  });
  const [targetResult, sourceResult] = await Promise.all([
    prisma.simulationSubjectResult.create({ data: { simulationExamId: exam.id, subjectId: pair.targetSubjectId } }),
    prisma.simulationSubjectResult.create({ data: { simulationExamId: exam.id, subjectId: pair.sourceSubjectId } }),
  ]);
  await seedSimulationInbox(pair, exam.id, targetResult.id, pair.targetSubjectId);
  await seedSimulationInbox(pair, exam.id, sourceResult.id, pair.sourceSubjectId);
  await prisma.planInboxItem.create({
    data: {
      workspaceId: pair.workspaceId,
      subjectId: pair.sourceSubjectId,
      stableKey: `invalid-${randomUUID()}`,
      originKey: `invalid-${randomUUID()}`,
      originVersion: 1,
      originType: "SIMULATION_LOSS",
      originSnapshot: { invalid: true },
      title: "损坏来源夹具",
    },
  });
  const preview = await getPreview(pair);
  assert.deepEqual(preview.conflictCounts, {
    syllabusStableKeys: 1,
    simulationExams: 1,
    simulationInboxOrigins: 1,
    invalidSimulationInboxOrigins: 1,
    relatedKnowledgePoints: 0,
  });
  await expectApiError(
    () => mergeWorkspaceSubjects(pair.actorId, commandFor(pair, preview, `conflict-${randomUUID()}`)),
    "SUBJECT_MERGE_UNIQUE_CONFLICT",
  );
  assert.equal((await sourceSubject(pair)).archivedAt, null);
}

async function verifyMergeTransactionRollback(): Promise<void> {
  const pair = await seedSubjectMergePair("rollback");
  await addTargetReferenceWeight(pair, 2);
  const task = await prisma.studyTask.create({
    data: {
      subjectId: pair.sourceSubjectId,
      title: "回滚任务",
      type: "study",
      plannedDate: new Date(),
    },
  });
  const preview = await getPreview(pair);
  await installArchiveAbortTrigger();
  try {
    await assert.rejects(() => mergeWorkspaceSubjects(pair.actorId, commandFor(pair, preview, `rollback-${randomUUID()}`)));
  } finally {
    await removeArchiveAbortTrigger();
  }
  assert.equal((await prisma.studyTask.findUniqueOrThrow({ where: { id: task.id } })).subjectId, pair.sourceSubjectId);
  assert.equal((await sourceSubject(pair)).archivedAt, null);
  assert.equal(await prisma.auditEvent.count({ where: { action: "SUBJECT_MERGE_CONFIRMED" } }), 0);
}

async function verifyUndoScopeDrift(): Promise<void> {
  const fixture = await seedCompleteSubjectMergeGraph(await seedSubjectMergePair("drift"));
  const preview = await getPreview(fixture);
  const merged = await mergeWorkspaceSubjects(
    fixture.actorId,
    commandFor(fixture, preview, `drift-merge-${randomUUID()}`),
  );
  const operation = (await listRecentSubjectMergeOperations(fixture.actorId, fixture.workspaceId))[0]!;
  await prisma.planInboxItem.update({
    where: { id: fixture.sourceIds.simulationInbox },
    data: { originSnapshot: { changedAfterMerge: true } },
  });
  const blocked = (await listRecentSubjectMergeOperations(fixture.actorId, fixture.workspaceId))
    .find((item) => item.id === merged.operationId);
  assert.equal(blocked?.status, "BLOCKED");
  assert.ok(blocked?.blockingFields.includes("planInboxItems"));
  await expectApiError(
    () => undoWorkspaceSubjectMerge(fixture.actorId, {
      workspaceId: fixture.workspaceId,
      operationId: operation.id,
      expectedWorkspaceRevision: operation.workspaceRevision,
      undoSnapshotHash: operation.undoSnapshotHash,
      idempotencyKey: `drift-undo-${randomUUID()}`,
      confirm: true,
    }),
    "SUBJECT_MERGE_UNDO_SCOPE_CHANGED",
  );
  assert.equal((await sourceSubject(fixture)).archivedAt instanceof Date, true);
}

async function verifyUndoUniqueConflictRollback(): Promise<void> {
  const pair = await seedSubjectMergePair("undo-unique");
  await addTargetReferenceWeight(pair, 2);
  const stableKey = `undo-node-${randomUUID()}`;
  const original = await prisma.syllabusNode.create({
    data: { subjectId: pair.sourceSubjectId, title: "原节点", kind: "TOPIC", stableKey },
  });
  const preview = await getPreview(pair);
  const merged = await mergeWorkspaceSubjects(pair.actorId, commandFor(pair, preview, `unique-merge-${randomUUID()}`));
  await prisma.syllabusNode.create({
    data: { subjectId: pair.sourceSubjectId, title: "后续新节点", kind: "TOPIC", stableKey },
  });
  const operation = (await listRecentSubjectMergeOperations(pair.actorId, pair.workspaceId))
    .find((item) => item.id === merged.operationId)!;
  await expectApiError(
    () => undoWorkspaceSubjectMerge(pair.actorId, undoCommand(pair, operation, `unique-undo-${randomUUID()}`)),
    "SUBJECT_MERGE_UNDO_UNIQUE_CONFLICT",
  );
  assert.equal((await prisma.syllabusNode.findUniqueOrThrow({ where: { id: original.id } })).subjectId, pair.targetSubjectId);
  assert.equal((await sourceSubject(pair)).archivedAt instanceof Date, true);
  assert.equal(await completedUndoCount(merged.operationId), 0);
}

async function verifyUndoExpiry(): Promise<void> {
  const pair = await seedSubjectMergePair("expired");
  await addTargetReferenceWeight(pair, 2);
  await prisma.studyTask.create({ data: { subjectId: pair.sourceSubjectId, title: "过期任务", type: "study", plannedDate: new Date() } });
  const preview = await getPreview(pair);
  const merged = await mergeWorkspaceSubjects(pair.actorId, commandFor(pair, preview, `expire-merge-${randomUUID()}`));
  const event = await prisma.auditEvent.findUniqueOrThrow({ where: { id: merged.operationId } });
  const metadata = jsonRecord(event.metadata);
  await prisma.auditEvent.update({
    where: { id: event.id },
    data: { metadata: { ...metadata, undoUntil: "2000-01-01T00:00:00.000Z" } as Prisma.InputJsonObject },
  });
  const operation = (await listRecentSubjectMergeOperations(pair.actorId, pair.workspaceId))[0]!;
  assert.equal(operation.status, "EXPIRED");
  await expectApiError(
    () => undoWorkspaceSubjectMerge(pair.actorId, undoCommand(pair, operation, `expire-undo-${randomUUID()}`)),
    "SUBJECT_MERGE_UNDO_WINDOW_EXPIRED",
  );
}

async function verifyCorruptAuditVisibility(): Promise<void> {
  const pair = await seedSubjectMergePair("corrupt-audit");
  const event = await prisma.auditEvent.create({
    data: {
      actorId: pair.actorId,
      action: "SUBJECT_MERGE_CONFIRMED",
      entityType: "SubjectMerge",
      metadata: {
        workspaceId: pair.workspaceId,
        claimState: "completed",
        sourceMapping: {},
      },
    },
  });
  const operation = (await listRecentSubjectMergeOperations(pair.actorId, pair.workspaceId))
    .find((item) => item.id === event.id);
  assert.equal(operation?.status, "BLOCKED");
  assert.deepEqual(operation?.blockingFields, ["mergeOperation"]);
}

async function getPreview(pair: SubjectMergePair) {
  const previews = await listSubjectDuplicatePreviews(pair.actorId, pair.workspaceId);
  const preview = previews.find((item) => item.recommendedTargetId === pair.targetSubjectId);
  assert.ok(preview, "expected a duplicate preview with the fixture target");
  return preview;
}

function commandFor(pair: SubjectMergePair, preview: Awaited<ReturnType<typeof getPreview>>, idempotencyKey: string) {
  return {
    workspaceId: pair.workspaceId,
    targetSubjectId: pair.targetSubjectId,
    sourceSubjectIds: [pair.sourceSubjectId],
    snapshotHash: preview.snapshotHash,
    expectedWorkspaceRevision: preview.workspaceRevision,
    idempotencyKey,
    confirm: true as const,
  };
}

function undoCommand(
  pair: SubjectMergePair,
  operation: Awaited<ReturnType<typeof listRecentSubjectMergeOperations>>[number],
  idempotencyKey: string,
) {
  return {
    workspaceId: pair.workspaceId,
    operationId: operation.id,
    expectedWorkspaceRevision: operation.workspaceRevision,
    undoSnapshotHash: operation.undoSnapshotHash,
    idempotencyKey,
    confirm: true as const,
  };
}

function totalBlockingConflicts(preview: Awaited<ReturnType<typeof getPreview>>): number {
  const conflicts = preview.conflictCounts;
  return conflicts.syllabusStableKeys
    + conflicts.simulationExams
    + conflicts.simulationInboxOrigins
    + conflicts.invalidSimulationInboxOrigins;
}

function expectedReferenceCounts() {
  return {
    studyTasks: 1,
    studySessions: 1,
    syllabusNodes: 1,
    notes: 1,
    mistakes: 1,
    simulationSubjectResults: 1,
    planMilestones: 1,
    planInboxItems: 2,
    studyResources: 1,
    primaryKnowledgePoints: 1,
    relatedKnowledgePointLinks: 2,
    knowledgeGroups: 1,
    learningArrangements: 1,
  };
}

async function installArchiveAbortTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION v13_subject_merge_abort() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."archivedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'v13 subject merge injected archive failure';
      END IF;
      RETURN NEW;
    END
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER v13_subject_merge_abort_trigger
    BEFORE UPDATE ON "Subject"
    FOR EACH ROW EXECUTE FUNCTION v13_subject_merge_abort()
  `);
}

async function removeArchiveAbortTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS v13_subject_merge_abort_trigger ON "Subject"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS v13_subject_merge_abort()`);
}

async function sourceSubject(pair: SubjectMergePair) {
  return prisma.subject.findUniqueOrThrow({ where: { id: pair.sourceSubjectId } });
}

async function completedUndoCount(operationId: string): Promise<number> {
  return prisma.auditEvent.count({
    where: {
      action: "SUBJECT_MERGE_UNDONE",
      AND: [
        { metadata: { path: ["mergeOperationId"], equals: operationId } },
        { metadata: { path: ["claimState"], equals: "completed" } },
      ],
    },
  });
}

async function expectApiError(run: () => Promise<unknown>, code: string, status = 409): Promise<void> {
  try {
    await run();
    assert.fail(`expected ${code}`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== code || error.status !== status) throw error;
  }
}

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function pass(id: string, details: RuntimeCheck["details"]): void {
  checks.push({ id, status: "pass", details });
}
