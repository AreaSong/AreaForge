import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStudyResourceUploadPolicy,
  detectUploadMimeType,
  preferredDownloadDisposition,
  type BoundedFileScan,
} from "../../packages/storage/src/index";
import { LEARNING_TREE_PREVIEW_PURPOSE, canonicalizeHttpsUrl } from "../../packages/core/src/index";
import { prisma } from "../../packages/db/src/index";
import {
  createLearningTreeArchiveCapability,
  reconcileLearningTreeArchiveCapability,
  resolveLearningTreeArchiveCapability,
} from "../../apps/web/lib/client/learning-tree-archive-capability";
import {
  confirmLearningTreeImport,
  consumeLearningTreeExport,
  exportLearningTreeImportCanonical,
  getLearningTreeImport,
  listLearningTreeImports,
  previewLearningTreeImport,
  previewActiveLearningTreeExport,
  setLearningTreeImportArchived,
} from "../../apps/web/lib/study/learning-tree-service";
import {
  createLinkStudyResource,
  archiveStudyResource,
  assertBatchFileLimit,
  linkStudyResource,
  listStagedStudyResourceUploads,
  restoreStudyResource,
  resolveStudyResourceUpload,
  stageStudyResourceUploadBatch,
} from "../../apps/web/lib/study/study-resource-service";
import {
  finalizeWorkspaceAttachment,
  stageWorkspaceAttachment,
} from "../../apps/web/lib/study/attachments-service";
import { lockActorWorkspaceScope } from "../../apps/web/lib/study/exam-workspace-service";
import { buildPersistentCreateFingerprint } from "../../apps/web/lib/study/persistent-idempotency";
import { ApiError } from "../../apps/web/lib/api/responses";

/**
 * Batch 5 隔离 runtime selftest（硬条件）：
 * - confirm 原子成功 / 失败整回滚
 * - 幂等键冲突
 * - owner 外拒绝读历史
 * - 导出后无长期临时文件
 * - resource directive gate（非法 FILE/URL 阻塞，合法 LINK 写入）
 * - StudyResource 重复三选一（reuse/copy/skip）
 */

const uploadRoot = realpathSync(mkdtempSync(join(tmpdir(), "areaforge-v11m5-uploads-")));
process.env.UPLOAD_DIR = uploadRoot;
if (!process.env.AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET.length < 32) {
  process.env.AUTH_SESSION_SECRET = "v11-m5-confirm-selftest-secret-32bytes!!";
}

const checks: Array<{ id: string; status: "pass"; details: Record<string, string | number | boolean> }> = [];
const pdfMagic = new TextEncoder().encode("%PDF-1.4\n");

try {
  await assertIsolatedDatabase();
  await verifyConfirmRouteOpen();
  await verifyMigration5Schema();
  await verifyStorageZipMarkdown();
  verifyLearningTreeArchiveCapabilityState();
  await resetTables();
  const seed = await seedWorkspace();
  await verifyLinkResourceAndArchive(seed);
  await verifyHttpsZeroNetwork();
  await verifyBatchStagingIdempotency(seed);
  await verifyBatchStagingCrashRecovery(seed);
  await verifyDuplicateThreeWay(seed);
  await verifyResolutionAtomicReplayAndCleanup(seed);
  await verifyArchivedSubjectDuplicateBoundary(seed);
  await verifyStagedUploadWorkspaceIsolation(seed);
  await verifyResourceOwnerIsolation(seed);
  await verifyResourceDirectiveGate(seed);
  await verifyConfirmAtomicAndIdempotent(seed);
  await verifyActiveExportAndGrant(seed);
  await verifyNestedBranchRoundtrip(seed);
  await verifyConflictMapping(seed);
  await verifyHistoryOwnerAndExport(seed);
  await verifyArchiveChunkRollback(seed);
  await verifyLearningTreeObjectLimitAndBulk(seed);

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m5-runtime-selftest-v3",
        status: "pass",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS v11 M5 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
  rmSync(uploadRoot, { recursive: true, force: true });
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V11_M5_ISOLATED_DB !== "1") {
    throw new Error("v11 M5 runtime selftest requires AREAFORGE_V11_M5_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!rows[0]?.current_database.includes("v11m5")) {
    throw new Error("v11 M5 runtime selftest refused a database without the isolated name marker");
  }
  pass("isolated_database", { database: rows[0].current_database });
}

async function verifyConfirmRouteOpen(): Promise<void> {
  const confirmRoute = join(process.cwd(), "apps/web/app/api/learning-tree/imports/confirm/route.ts");
  assert.equal(existsSync(confirmRoute), true);
  pass("confirm_route_open", { exists: true });
}

async function verifyMigration5Schema(): Promise<void> {
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'SyllabusNode_subjectId_stableKey_key',
        'LearningTreeImportBatch_workspaceId_idempotencyKey_key'
      )
  `;
  assert.equal(indexes.length, 2);
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('LearningTreeImportBatch', 'LearningTreeImportItem', 'LearningTreeExportGrant')
  `;
  assert.equal(tables.length, 3);
  pass("migration5_schema", { indexes: indexes.length, tables: tables.length });
}

function verifyLearningTreeArchiveCapabilityState(): void {
  const activeSource = {
    batchId: "batch-capability",
    archived: false,
    workspaceStatus: "ACTIVE" as const,
    workspaceRevision: 7,
  };
  const initial = createLearningTreeArchiveCapability(activeSource);
  assert.equal(initial.allowed, null);
  const denied = resolveLearningTreeArchiveCapability(initial, false);
  assert.equal(denied.allowed, false);
  assert.equal(reconcileLearningTreeArchiveCapability(denied, activeSource).allowed, false);
  assert.equal(createLearningTreeArchiveCapability(activeSource).allowed, null);
  assert.equal(reconcileLearningTreeArchiveCapability(denied, {
    ...activeSource,
    workspaceRevision: 8,
  }).allowed, null);
  assert.equal(createLearningTreeArchiveCapability({
    ...activeSource,
    workspaceStatus: "ARCHIVED",
  }).allowed, false);
  const unknown = createLearningTreeArchiveCapability({ batchId: "legacy", archived: true });
  assert.equal(unknown.allowed, null);
  assert.equal(resolveLearningTreeArchiveCapability(unknown, true).allowed, true);
  pass("learning_tree_archive_capability_state", {
    activeStartsUnknown: true,
    conflictDowngrades: true,
    stalePropDoesNotOverride: true,
    switchRevisionRequiresProbe: true,
    reloadRequiresProbe: true,
  });
}

async function verifyStorageZipMarkdown(): Promise<void> {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const md = new TextEncoder().encode("# hello\n\nbody");
  assert.equal(detectUploadMimeType(zip), "application/zip");
  assert.equal(
    detectUploadMimeType(md, { originalName: "a.md", declaredMimeType: "text/markdown" }),
    "text/markdown",
  );
  const policy = createStudyResourceUploadPolicy(20);
  assert.ok(policy.allowedMimeTypes.includes("application/zip"));
  assert.equal(preferredDownloadDisposition("application/zip"), "attachment");
  pass("storage_zip_markdown", { ok: true });
}

async function resetTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "LearningTreeImportItem",
      "LearningTreeImportBatch",
      "LearningTreeExportGrant",
      "PlanInboxDependencyRef",
      "PlanInboxItem",
      "StudyResourceTag",
      "StudyResourceTaskLink",
      "StudyResourceNoteLink",
      "StudyResourceMistakeLink",
      "StudyResourceSyllabusNodeLink",
      "StudyResource",
      "Attachment",
      "Note",
      "SyllabusNode",
      "Subject",
      "SubjectGroup",
      "ExamWorkspace",
      "AuditEvent",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

async function verifyActiveExportAndGrant(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const preview = await previewActiveLearningTreeExport(seed.user.id, "subject", {
    subjectKey: seed.subject.stableKey,
  });
  assert.ok(preview.objectCount >= 4);
  assert.ok(preview.cardBodyCount >= 1);
  assert.ok(preview.planTitleCount >= 1);
  assert.ok(preview.externalHosts.includes("example.com"));

  const exported = await consumeLearningTreeExport(seed.user.id, {
    token: preview.exportToken,
    scope: "subject",
    subjectKey: seed.subject.stableKey,
  });
  assert.match(exported.markdown, /:::af-card\{#/);
  assert.match(exported.markdown, /::af-resource\{#/);
  assert.match(exported.markdown, /::af-plan\{#/);

  let consumed = false;
  try {
    await consumeLearningTreeExport(seed.user.id, {
      token: preview.exportToken,
      scope: "subject",
      subjectKey: seed.subject.stableKey,
    });
  } catch (error) {
    consumed = error instanceof ApiError && error.code === "LEARNING_TREE_EXPORT_TOKEN_CONSUMED";
  }
  assert.equal(consumed, true);

  let missingRoot = false;
  try {
    await previewActiveLearningTreeExport(seed.user.id, "branch", {
      subjectKey: seed.subject.stableKey,
      rootNodeKey: "missing-root",
    });
  } catch (error) {
    missingRoot = error instanceof ApiError && error.code === "ROOT_NODE_NOT_FOUND";
  }
  assert.equal(missingRoot, true);
  pass("active_export_one_time_grant", {
    objects: preview.objectCount,
    cards: preview.cardBodyCount,
    plans: preview.planTitleCount,
    externalHosts: preview.externalHosts.length,
    oneTime: true,
    invalidBranchRejected: true,
  });
}

async function verifyNestedBranchRoundtrip(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const parent = await prisma.syllabusNode.create({
    data: {
      subjectId: seed.subject.id,
      stableKey: "branch_parent_m5",
      title: "Branch parent",
      kind: "CHAPTER",
    },
  });
  const root = await prisma.syllabusNode.create({
    data: {
      subjectId: seed.subject.id,
      parentId: parent.id,
      stableKey: "branch_root_m5",
      title: "Nested branch root",
      kind: "TOPIC",
      sortOrder: 9,
      status: "LEARNING",
    },
  });
  await prisma.syllabusNode.create({
    data: {
      subjectId: seed.subject.id,
      parentId: root.id,
      stableKey: "branch_leaf_m5",
      title: "Nested branch leaf",
      kind: "PROBLEM_TYPE",
      sortOrder: 3,
      status: "COVERED",
    },
  });

  const exportPreview = await previewActiveLearningTreeExport(seed.user.id, "branch", {
    subjectKey: seed.subject.stableKey,
    rootNodeKey: root.stableKey!,
  });
  const exported = await consumeLearningTreeExport(seed.user.id, {
    token: exportPreview.exportToken,
    scope: "branch",
    subjectKey: seed.subject.stableKey,
    rootNodeKey: root.stableKey!,
  });
  assert.match(exported.markdown, /rootParentNodeKey: branch_parent_m5/);
  assert.match(exported.markdown, /sortOrder="9" status="LEARNING"/);
  assert.match(exported.markdown, /sortOrder="3" status="COVERED"/);
  const importPreview = await previewLearningTreeImport(seed.user.id, {
    markdown: exported.markdown,
    scope: "branch",
  });
  assert.equal(importPreview.blocking, false, JSON.stringify(importPreview.errors));
  assert.equal(importPreview.items.every((item) => item.diffType === "UNCHANGED"), true);
  const result = await confirmLearningTreeImport(seed.user.id, {
    markdown: importPreview.canonicalMarkdown,
    previewToken: importPreview.previewToken,
    previewOperationId: importPreview.operationId,
    idempotencyKey: "idem-m5-nested-branch-roundtrip",
    selections: importPreview.items.map((item) => ({
      stableKey: item.stableKey,
      choice: item.diffType === "UNCHANGED" || item.diffType === "SKIP" ? "skip" as const : "apply" as const,
    })),
  });
  assert.equal((await prisma.syllabusNode.findUniqueOrThrow({ where: { id: root.id } })).parentId, parent.id);

  const legacyMarkdown = exported.markdown.replace(/^rootParentNodeKey:.*\n/m, "");
  const legacyPreview = await previewLearningTreeImport(seed.user.id, {
    markdown: legacyMarkdown,
    scope: "branch",
  });
  const legacyRoot = legacyPreview.items.find((item) => item.stableKey === root.stableKey);
  assert.equal(legacyPreview.blocking, true);
  assert.equal(legacyRoot?.diffType, "MOVE");
  assert.equal(legacyRoot?.blocking, true);
  assert.equal(legacyRoot?.reason, "branch_root_parent_mismatch");
  await assert.rejects(
    confirmLearningTreeImport(seed.user.id, {
      markdown: legacyPreview.canonicalMarkdown,
      previewToken: legacyPreview.previewToken,
      previewOperationId: legacyPreview.operationId,
      idempotencyKey: "idem-m5-legacy-nested-branch",
      selections: legacyPreview.items.map((item) => ({
        stableKey: item.stableKey,
        choice: item.diffType === "UNCHANGED" || item.diffType === "SKIP" ? "skip" as const : "apply" as const,
      })),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "LEARNING_TREE_CONFIRM_BLOCKED",
  );
  assert.equal((await prisma.syllabusNode.findUniqueOrThrow({ where: { id: root.id } })).parentId, parent.id);

  const archivedLegacyMarkdown = legacyMarkdown.replace(
    /::af-node\{([^}]*)\}/g,
    '::af-node{$1 archived="true"}',
  );
  const archivedLegacyPreview = await previewLearningTreeImport(seed.user.id, {
    markdown: archivedLegacyMarkdown,
    scope: "branch",
  });
  const archivedLegacyRoot = archivedLegacyPreview.items.find((item) => item.stableKey === root.stableKey);
  assert.equal(archivedLegacyPreview.blocking, true);
  assert.equal(archivedLegacyRoot?.diffType, "MOVE");
  assert.equal(archivedLegacyRoot?.blocking, true);
  assert.equal(archivedLegacyRoot?.reason, "branch_root_parent_mismatch");
  await assert.rejects(
    confirmLearningTreeImport(seed.user.id, {
      markdown: archivedLegacyPreview.canonicalMarkdown,
      previewToken: archivedLegacyPreview.previewToken,
      previewOperationId: archivedLegacyPreview.operationId,
      idempotencyKey: "idem-m5-legacy-archived-nested-branch",
      selections: archivedLegacyPreview.items.map((item) => ({
        stableKey: item.stableKey,
        choice: item.diffType === "UNCHANGED" || item.diffType === "SKIP" ? "skip" as const : "apply" as const,
      })),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "LEARNING_TREE_CONFIRM_BLOCKED",
  );

  const wrongRootPreview = await previewLearningTreeImport(seed.user.id, {
    markdown: exported.markdown.replace(/^rootNodeKey:.*$/m, "rootNodeKey: wrong_branch_root"),
    scope: "branch",
  });
  assert.equal(wrongRootPreview.blocking, true);
  assert.ok(wrongRootPreview.errors.some((error) => error.code === "FRONTMATTER_INVALID"));
  const persistedRoot = await prisma.syllabusNode.findUniqueOrThrow({ where: { id: root.id } });
  assert.equal(persistedRoot.parentId, parent.id);
  assert.equal(persistedRoot.archivedAt, null);
  pass("nested_branch_roundtrip", {
    batchId: result.batchId,
    parentPreserved: true,
    moveCount: 0,
    nonDefaultNodeFieldsRoundTrip: true,
    legacyMoveBlocked: true,
    archivedLegacyMoveBlocked: true,
    wrongRootNodeKeyBlocked: true,
  });
}

async function seedWorkspace() {
  const user = await prisma.user.create({
    data: {
      email: `v11m5-${randomUUID()}@example.com`,
      passwordHash: "x",
    },
  });
  const workspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: "example-workspace",
      name: "M5 Workspace",
      status: "ACTIVE",
      revision: 1,
    },
  });
  const subject = await prisma.subject.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "math",
      name: "Math",
      color: "#111111",
    },
  });
  return { user, workspace, subject };
}

async function verifyLinkResourceAndArchive(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  assert.doesNotThrow(() => assertBatchFileLimit(5));
  assert.throws(() => assertBatchFileLimit(6), (error: unknown) => error instanceof ApiError && error.code === "STUDY_RESOURCE_BATCH_LIMIT");
  const unorganized = await createLinkStudyResource(seed.user.id, {
    title: "Unsorted link",
    url: "https://example.com/unsorted",
  });
  assert.equal(unorganized.organizeStatus, "UNSORTED");
  const resource = await createLinkStudyResource(seed.user.id, {
    title: "Official syllabus",
    url: "https://Example.COM/path",
    subjectId: seed.subject.id,
  });
  assert.equal(resource.sourceType, "LINK");
  assert.equal(resource.displayHost, "example.com");
  assert.equal(resource.organizeStatus, "READY_FOR_USE");
  const schedule = await prisma.reviewSchedule.create({
    data: {
      workspaceId: seed.workspace.id,
      targetType: "STUDY_RESOURCE",
      studyResourceId: resource.id,
      dueDate: new Date("2026-07-30T00:00:00.000Z"),
      actorId: seed.user.id,
    },
  });
  const archived = await archiveStudyResource(seed.user.id, resource.id, resource.revision);
  assert.equal(archived.organizeStatus, "ARCHIVED");
  const archiveReplay = await archiveStudyResource(seed.user.id, resource.id, archived.revision);
  assert.equal(archiveReplay.revision, archived.revision);
  const paused = await prisma.reviewSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
  assert.equal(paused.status, "PAUSED");
  assert.equal(paused.dueDate, null);
  assert.equal(paused.pausedReason, "TARGET_ARCHIVED");
  await assert.rejects(
    () => restoreStudyResource(seed.user.id, resource.id, resource.revision),
    (error: unknown) => error instanceof ApiError
      && error.code === "STUDY_RESOURCE_REVISION_CONFLICT"
      && error.details?.conflictFields?.includes("archivedAt") === true,
  );
  const restored = await restoreStudyResource(seed.user.id, resource.id, archived.revision);
  assert.equal(restored.organizeStatus, "READY_FOR_USE");
  const restoreReplay = await restoreStudyResource(seed.user.id, resource.id, restored.revision);
  assert.equal(restoreReplay.revision, restored.revision);
  await assert.rejects(
    () => archiveStudyResource(seed.user.id, resource.id, archived.revision),
    (error: unknown) => error instanceof ApiError && error.code === "STUDY_RESOURCE_REVISION_CONFLICT",
  );

  const concurrentArchive = await Promise.allSettled([
    archiveStudyResource(seed.user.id, resource.id, restored.revision),
    archiveStudyResource(seed.user.id, resource.id, restored.revision),
  ]);
  assert.equal(concurrentArchive.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentArchive.filter((result) => result.status === "rejected"
    && result.reason instanceof ApiError
    && result.reason.code === "STUDY_RESOURCE_REVISION_CONFLICT").length, 1);
  const concurrentWinner = concurrentArchive.find((result): result is PromiseFulfilledResult<typeof archived> => result.status === "fulfilled")!.value;
  const restoredAfterConcurrentArchive = await restoreStudyResource(seed.user.id, resource.id, concurrentWinner.revision);
  assert.equal(restoredAfterConcurrentArchive.organizeStatus, "READY_FOR_USE");
  assert.equal((await prisma.reviewSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status, "PAUSED");
  pass("link_resource_archive", {
    id: resource.id,
    unorganizedGate: true,
    scheduleRemainsPausedAfterRestore: true,
    archiveRestoreCas: true,
    concurrentArchiveSingleWinner: true,
    batchLimit: 5,
  });
}

async function verifyHttpsZeroNetwork(): Promise<void> {
  assert.equal(canonicalizeHttpsUrl("https://127.0.0.1/x").ok, false);
  assert.equal(canonicalizeHttpsUrl("https://localhost/x").ok, false);
  pass("https_zero_network_rules", { ok: true });
}

async function verifyBatchStagingIdempotency(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const scans = [
    pdfScan(pdfBytes(321), "batch-a.pdf"),
    pdfScan(pdfBytes(654), "batch-b.pdf"),
  ];
  const key = `m5-upload-batch-${randomUUID()}`;
  const attachmentCountBefore = await prisma.attachment.count();
  const first = await stageStudyResourceUploadBatch(seed.user.id, scans, key);
  const replay = await stageStudyResourceUploadBatch(seed.user.id, scans, key);
  assert.deepEqual(
    replay.map((item) => item.staging?.attachment.id ?? null),
    first.map((item) => item.staging?.attachment.id ?? null),
  );
  assert.equal(await prisma.attachment.count(), attachmentCountBefore + scans.length);
  await assert.rejects(
    () => stageStudyResourceUploadBatch(seed.user.id, [...scans].reverse(), key),
    (error: unknown) => error instanceof ApiError && error.code === "STUDY_RESOURCE_UPLOAD_BATCH_CONFLICT",
  );
  assert.equal(await prisma.attachment.count(), attachmentCountBefore + scans.length);

  const concurrentKey = `m5-upload-batch-concurrent-${randomUUID()}`;
  const concurrentScans = [pdfScan(pdfBytes(777), "batch-concurrent.pdf")];
  const concurrent = await Promise.allSettled([
    stageStudyResourceUploadBatch(seed.user.id, concurrentScans, concurrentKey),
    stageStudyResourceUploadBatch(seed.user.id, concurrentScans, concurrentKey),
  ]);
  const fulfilled = concurrent.find((result) => result.status === "fulfilled");
  const rejected = concurrent.find((result) => result.status === "rejected");
  assert.ok(fulfilled?.status === "fulfilled");
  assert.ok(
    rejected?.status === "rejected" &&
    rejected.reason instanceof ApiError &&
    rejected.reason.code === "STUDY_RESOURCE_UPLOAD_BATCH_IN_PROGRESS",
  );
  const concurrentReplay = await stageStudyResourceUploadBatch(seed.user.id, concurrentScans, concurrentKey);
  assert.deepEqual(concurrentReplay, fulfilled.value);

  const attachmentIds = [...first, ...concurrentReplay]
    .map((item) => item.staging?.attachment.id)
    .filter((id): id is string => Boolean(id));
  for (const attachmentId of attachmentIds) {
    assert.deepEqual(await resolveStudyResourceUpload(seed.user.id, { attachmentId, decision: "skip" }), { skipped: true });
  }
  pass("study_resource_upload_batch_idempotency", {
    orderedHashBound: true,
    replayReturnedOriginalBatch: true,
    concurrentDuplicateFailedClosed: true,
    duplicateFilesCreated: 0,
  });
}

async function verifyBatchStagingCrashRecovery(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const scan = pdfScan(pdfBytes(778), "batch-crash-window.pdf");
  const idempotencyKey = `m5-upload-batch-crash-${randomUUID()}`;
  const requestFingerprint = buildPersistentCreateFingerprint("study-resource-upload-batch-v1", {
    files: [uploadScanIdentity(scan)],
  });
  const claim = await prisma.auditEvent.create({
    data: {
      actorId: seed.user.id,
      action: "STUDY_RESOURCE_UPLOAD_BATCH_COMMAND",
      entityType: "StudyResourceUploadBatch",
      createdAt: new Date(Date.now() - 6 * 60 * 1000),
      metadata: {
        idempotencyProtocol: "audit-event-create-v1",
        claimState: "pending",
        workspaceId: seed.workspace.id,
        idempotencyKey,
        requestFingerprint,
        claimStartedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        claimAttempt: 1,
      },
    },
  });
  const staged = await stageWorkspaceAttachment({
    scan,
    workspaceId: seed.workspace.id,
    intentMetadata: {
      purpose: "study-resource-upload",
      batchClaimEventId: claim.id,
      batchIndex: 0,
      batchIdempotencyKey: idempotencyKey,
      scanFingerprint: buildPersistentCreateFingerprint("study-resource-upload-item-v1", uploadScanIdentity(scan)),
    },
  }, seed.user.id);
  assert.equal(await prisma.auditEvent.count({
    where: { actorId: seed.user.id, action: "STUDY_RESOURCE_UPLOAD_STAGED", entityId: staged.id },
  }), 0);
  const attachmentCount = await prisma.attachment.count();

  const recovered = await stageStudyResourceUploadBatch(seed.user.id, [scan], idempotencyKey);
  assert.equal(recovered[0]?.staging?.attachment.id, staged.id);
  assert.equal(await prisma.attachment.count(), attachmentCount);
  assert.ok((await listStagedStudyResourceUploads(seed.user.id)).some((item) => item.attachment.id === staged.id));
  const completedClaim = await prisma.auditEvent.findUniqueOrThrow({ where: { id: claim.id } });
  const completedMetadata = asJsonRecord(completedClaim.metadata);
  assert.equal(completedMetadata.claimState, "completed");
  assert.equal(completedMetadata.claimAttempt, 2);
  await resolveStudyResourceUpload(seed.user.id, { attachmentId: staged.id, decision: "skip" });
  pass("study_resource_batch_crash_recovery", {
    recoveredFromIntentWithoutStagedAudit: true,
    staleClaimTakenOver: true,
    duplicateAttachmentsCreated: 0,
  });
}

async function verifyResolutionAtomicReplayAndCleanup(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const bytes = pdfBytes(933);
  const originalStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "atomic-original.pdf"));
  const original = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: originalStage.attachment.id,
    decision: "copy",
    title: "Atomic original",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in original));

  const cleanupStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(pdfBytes(934), "cleanup-retry.pdf"));
  const cleanupBefore = await prisma.attachment.findUniqueOrThrow({ where: { id: cleanupStage.attachment.id } });
  assert.ok(cleanupBefore.stagingName);
  const stagingPath = join(uploadRoot, ".staging", cleanupBefore.stagingName!);
  assert.equal(existsSync(stagingPath), true);
  const configuredUploadRoot = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = join(uploadRoot, "missing-cleanup-root");
  try {
    assert.deepEqual(await resolveStudyResourceUpload(seed.user.id, {
      attachmentId: cleanupStage.attachment.id,
      decision: "skip",
    }), { skipped: true });
  } finally {
    process.env.UPLOAD_DIR = configuredUploadRoot;
  }
  const cleanupFailed = await prisma.attachment.findUniqueOrThrow({ where: { id: cleanupStage.attachment.id } });
  assert.equal(cleanupFailed.status, "FAILED");
  assert.equal(cleanupFailed.stagingName, cleanupBefore.stagingName);
  assert.equal(existsSync(stagingPath), true);
  assert.equal(await resolutionAuditCount(seed.user.id, cleanupStage.attachment.id), 1);
  assert.deepEqual(await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: cleanupStage.attachment.id,
    decision: "skip",
  }), { skipped: true });
  assert.equal(existsSync(stagingPath), false);
  assert.equal((await prisma.attachment.findUniqueOrThrow({ where: { id: cleanupStage.attachment.id } })).stagingName, null);
  assert.equal(await resolutionAuditCount(seed.user.id, cleanupStage.attachment.id), 1);

  const concurrentStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "atomic-concurrent.pdf"));
  const reuseRequest = {
    attachmentId: concurrentStage.attachment.id,
    decision: "reuse" as const,
    reuseResourceId: original.id,
    category: "SUMMARY",
    tags: ["atomic"],
  };
  const skipRequest = { attachmentId: concurrentStage.attachment.id, decision: "skip" as const };
  const concurrent = await Promise.allSettled([
    resolveStudyResourceUpload(seed.user.id, reuseRequest),
    resolveStudyResourceUpload(seed.user.id, skipRequest),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = concurrent.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ApiError);
  assert.equal(rejected.reason.code, "STUDY_RESOURCE_UPLOAD_DECISION_CONFLICT");
  assert.ok(rejected.reason.details?.latest);
  assert.ok((rejected.reason.details?.conflictFields?.length ?? 0) > 0);
  assert.equal(rejected.reason.details?.workbench, "/knowledge/resources");
  const resolutionEvent = await prisma.auditEvent.findFirstOrThrow({
    where: {
      actorId: seed.user.id,
      action: "STUDY_RESOURCE_UPLOAD_RESOLVED",
      entityType: "Attachment",
      entityId: concurrentStage.attachment.id,
    },
  });
  const decision = asJsonRecord(resolutionEvent.metadata).decision;
  if (decision === "reuse") {
    const replay = await resolveStudyResourceUpload(seed.user.id, reuseRequest);
    assert.ok(!("skipped" in replay));
    assert.equal(replay.id, original.id);
    assert.equal(replay.revision, original.revision + 1);
  } else {
    assert.equal(decision, "skip");
    assert.deepEqual(await resolveStudyResourceUpload(seed.user.id, skipRequest), { skipped: true });
    assert.equal((await prisma.studyResource.findUniqueOrThrow({ where: { id: original.id } })).revision, original.revision);
  }
  assert.equal(await resolutionAuditCount(seed.user.id, concurrentStage.attachment.id), 1);
  assert.equal((await prisma.attachment.findUniqueOrThrow({ where: { id: concurrentStage.attachment.id } })).status, "FAILED");

  const mismatchStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(pdfBytes(935), "hash-mismatch.pdf"));
  await assert.rejects(
    () => resolveStudyResourceUpload(seed.user.id, {
      attachmentId: mismatchStage.attachment.id,
      decision: "reuse",
      reuseResourceId: original.id,
    }),
    (error: unknown) => error instanceof ApiError &&
      error.code === "STUDY_RESOURCE_HASH_MISMATCH" &&
      Boolean(error.details?.latest) &&
      error.details?.conflictFields?.includes("attachmentHash") === true &&
      error.details?.workbench === "/knowledge/resources",
  );
  await resolveStudyResourceUpload(seed.user.id, { attachmentId: mismatchStage.attachment.id, decision: "skip" });
  pass("study_resource_resolution_atomic_replay_cleanup", {
    cleanupFailureReplayed: true,
    competingDecisionSerialized: true,
    terminalAuditCount: 1,
    structuredHashConflict: true,
  });
}

function resolutionAuditCount(actorId: string, attachmentId: string): Promise<number> {
  return prisma.auditEvent.count({
    where: {
      actorId,
      action: "STUDY_RESOURCE_UPLOAD_RESOLVED",
      entityType: "Attachment",
      entityId: attachmentId,
    },
  });
}

async function verifyDuplicateThreeWay(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const bytes = pdfBytes(512);
  const firstStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-a.pdf"));
  const original = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: firstStage.attachment.id,
    decision: "copy",
    title: "Original PDF",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in original));
  assert.equal(original.sourceType, "FILE");

  const secondStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-b.pdf"));
  assert.ok(secondStage.duplicates.some((row) => row.resourceId === original.id));
  assert.equal(Object.prototype.hasOwnProperty.call(secondStage.attachment, "hash"), false);
  assert.equal(secondStage.duplicates.every((row) => !Object.prototype.hasOwnProperty.call(row, "hash")), true);
  const pendingSecondStage = (await listStagedStudyResourceUploads(seed.user.id))
    .find((item) => item.attachment.id === secondStage.attachment.id);
  assert.ok(pendingSecondStage);
  assert.equal(Object.prototype.hasOwnProperty.call(pendingSecondStage.attachment, "hash"), false);
  assert.equal(pendingSecondStage.duplicates.every((row) => !Object.prototype.hasOwnProperty.call(row, "hash")), true);

  const skipped = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: secondStage.attachment.id,
    decision: "skip",
  });
  assert.deepEqual(skipped, { skipped: true });
  assert.deepEqual(await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: secondStage.attachment.id,
    decision: "skip",
  }), { skipped: true });

  const thirdStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-c.pdf"));
  const reused = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: thirdStage.attachment.id,
    decision: "reuse",
    reuseResourceId: original.id,
  });
  assert.ok(!("skipped" in reused));
  assert.equal(reused.id, original.id);
  const reusedRetry = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: thirdStage.attachment.id,
    decision: "reuse",
    reuseResourceId: original.id,
  });
  assert.ok(!("skipped" in reusedRetry));
  assert.equal(reusedRetry.id, original.id);

  const fourthStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-d.pdf"));
  const copied = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: fourthStage.attachment.id,
    decision: "copy",
    title: "Copy PDF",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in copied));
  assert.notEqual(copied.id, original.id);
  assert.equal(copied.duplicateOfResourceId, original.id);
  const copiedRetry = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: fourthStage.attachment.id,
    decision: "copy",
    title: "Copy PDF",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in copiedRetry));
  assert.equal(copiedRetry.id, copied.id);

  let changedRetryRejected = false;
  try {
    await resolveStudyResourceUpload(seed.user.id, {
      attachmentId: fourthStage.attachment.id,
      decision: "skip",
    });
  } catch (error) {
    changedRetryRejected = error instanceof ApiError && error.code === "STUDY_RESOURCE_UPLOAD_DECISION_CONFLICT";
  }
  assert.equal(changedRetryRejected, true);

  const readyUnbound = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(pdfBytes(513), "ready-unbound.pdf"));
  await finalizeWorkspaceAttachment(seed.user.id, readyUnbound.attachment.id);
  const recovered = await listStagedStudyResourceUploads(seed.user.id);
  assert.ok(recovered.some((item) => item.attachment.id === readyUnbound.attachment.id));
  const recoveredCopy = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: readyUnbound.attachment.id,
    decision: "copy",
    title: "Recovered ready upload",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in recoveredCopy));

  pass("duplicate_three_way", {
    originalId: original.id,
    copyId: copied.id,
    skipped: true,
    reused: true,
    retriesReturnOriginalResult: true,
    changedRetryRejected: true,
    readyUnboundRecovered: true,
    browserDtoOmitsHash: true,
  });
}

async function verifyStagedUploadWorkspaceIsolation(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const alternate = await prisma.examWorkspace.create({
    data: {
      userId: seed.user.id,
      stableKey: `resource-staging-alternate-${randomUUID()}`,
      name: "Resource staging alternate",
      status: "ARCHIVED",
      archivedAt: new Date(),
    },
  });
  const staged = await stageSingleStudyResourceUpload(
    seed.user.id,
    pdfScan(pdfBytes(640), "workspace-bound.pdf"),
  );

  await switchActiveWorkspace(seed.user.id, seed.workspace.id, alternate.id);
  const hidden = await listStagedStudyResourceUploads(seed.user.id);
  assert.equal(hidden.some((item) => item.attachment.id === staged.attachment.id), false);
  await assert.rejects(
    () => resolveStudyResourceUpload(seed.user.id, {
      attachmentId: staged.attachment.id,
      decision: "skip",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "ATTACHMENT_NOT_FOUND",
  );

  await switchActiveWorkspace(seed.user.id, alternate.id, seed.workspace.id);
  const restored = await listStagedStudyResourceUploads(seed.user.id);
  assert.equal(restored.some((item) => item.attachment.id === staged.attachment.id), true);
  assert.deepEqual(await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: staged.attachment.id,
    decision: "skip",
  }), { skipped: true });

  pass("staged_upload_workspace_isolation", {
    hiddenAfterWorkspaceSwitch: true,
    crossWorkspaceResolveDenied: true,
    restoredInCreatingWorkspace: true,
  });
}

async function switchActiveWorkspace(userId: string, fromWorkspaceId: string, toWorkspaceId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, userId);
    const archived = await tx.examWorkspace.updateMany({
      where: { id: fromWorkspaceId, userId, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: new Date(), revision: { increment: 1 } },
    });
    assert.equal(archived.count, 1);
    const activated = await tx.examWorkspace.updateMany({
      where: { id: toWorkspaceId, userId, status: "ARCHIVED" },
      data: { status: "ACTIVE", archivedAt: null, revision: { increment: 1 } },
    });
    assert.equal(activated.count, 1);
  });
}

async function verifyArchivedSubjectDuplicateBoundary(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const archivedSubject = await prisma.subject.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `archived-resource-${randomUUID()}`,
      name: "Archived resource subject",
      color: "#64748b",
    },
  });
  const bytes = pdfBytes(777);
  const originalStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "archived-original.pdf"));
  const original = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: originalStage.attachment.id,
    decision: "copy",
    title: "Archived subject original",
    subjectId: archivedSubject.id,
  });
  assert.ok(!("skipped" in original));
  await prisma.subject.update({
    where: { id: archivedSubject.id },
    data: { archivedAt: new Date() },
  });

  const duplicateStage = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(bytes, "archived-duplicate.pdf"));
  assert.equal(duplicateStage.duplicates.some((row) => row.resourceId === original.id), false);
  const staged = await listStagedStudyResourceUploads(seed.user.id);
  const recovered = staged.find((item) => item.attachment.id === duplicateStage.attachment.id);
  assert.ok(recovered);
  assert.equal(recovered.duplicates.some((row) => row.resourceId === original.id), false);
  await assert.rejects(
    () => resolveStudyResourceUpload(seed.user.id, {
      attachmentId: duplicateStage.attachment.id,
      decision: "reuse",
      reuseResourceId: original.id,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "SUBJECT_ARCHIVED",
  );

  const copied = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: duplicateStage.attachment.id,
    decision: "copy",
    title: "Active subject copy",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in copied));
  assert.equal(copied.duplicateOfResourceId, null);
  pass("archived_subject_duplicate_boundary", {
    archivedDuplicateHidden: true,
    explicitReuseRejected: true,
    copyDoesNotLinkArchivedDuplicate: true,
  });
}

async function verifyResourceOwnerIsolation(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const other = await seedOtherWorkspace();
  const staged = await stageSingleStudyResourceUpload(seed.user.id, pdfScan(pdfBytes(384), "owner.pdf"));

  let attachmentDenied = false;
  try {
    await resolveStudyResourceUpload(other.user.id, {
      attachmentId: staged.attachment.id,
      decision: "copy",
      title: "Stolen",
      subjectId: other.subject.id,
    });
  } catch (error) {
    attachmentDenied = error instanceof ApiError && error.code === "ATTACHMENT_NOT_FOUND";
  }
  assert.equal(attachmentDenied, true);

  const resource = await createLinkStudyResource(seed.user.id, {
    title: "Owner resource",
    url: "https://example.com/owner",
    subjectId: seed.subject.id,
  });
  const foreignNote = await prisma.note.create({
    data: {
      subjectId: other.subject.id,
      title: "Foreign note",
      content: "private",
    },
  });
  let linkDenied = false;
  try {
    await linkStudyResource(seed.user.id, resource.id, { noteIds: [foreignNote.id] });
  } catch (error) {
    linkDenied =
      error instanceof ApiError && error.code === "STUDY_RESOURCE_LINK_TARGET_NOT_FOUND";
  }
  assert.equal(linkDenied, true);
  assert.equal(
    await prisma.studyResourceNoteLink.count({ where: { resourceId: resource.id } }),
    0,
  );
  await archiveStudyResource(seed.user.id, resource.id, resource.revision);

  pass("resource_owner_isolation", {
    attachmentDenied: true,
    foreignLinkDenied: true,
  });
}

async function seedOtherWorkspace() {
  const user = await prisma.user.create({
    data: { email: `v11m5-other-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const workspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: `other-${randomUUID()}`,
      name: "Other Workspace",
      status: "ACTIVE",
    },
  });
  const subject = await prisma.subject.create({
    data: {
      workspaceId: workspace.id,
      stableKey: `other-subject-${randomUUID()}`,
      name: "Other Subject",
      color: "#222222",
    },
  });
  return { user, workspace, subject };
}

async function verifyResourceDirectiveGate(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const resourcesBefore = await prisma.studyResource.count({
    where: { workspaceId: seed.workspace.id, sourceType: "LINK", archivedAt: null },
  });
  const fileKindMarkdown = [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    "scope: subject",
    "workspaceKey: example-workspace",
    "subjectKey: math",
    "---",
    "",
    "# Gate Chapter",
    "",
    '::af-resource{#res_file kind="FILE" subjectKey="math" title="Bad File" url="https://example.com/f"}',
    "",
  ].join("\n");
  const filePreview = await previewLearningTreeImport(seed.user.id, {
    markdown: fileKindMarkdown,
    scope: "subject",
  });
  assert.equal(filePreview.blocking, true);
  assert.ok(filePreview.errors.some((error) => error.code === "PARSE_ERROR"));
  assert.equal(filePreview.items.filter((item) => item.objectType === "resource").length, 0);

  let confirmBlocked = false;
  try {
    await confirmLearningTreeImport(seed.user.id, {
      markdown: fileKindMarkdown,
      previewToken: filePreview.previewToken,
      idempotencyKey: "idem-m5-resource-file-gate",
      selections: [],
    });
  } catch (error) {
    confirmBlocked =
      error instanceof ApiError &&
      (error.code === "LEARNING_TREE_CONFIRM_PARSE_FAILED" ||
        error.code === "LEARNING_TREE_CONFIRM_BLOCKED" ||
        error.code === "LEARNING_TREE_CONFIRM_FINGERPRINT_MISMATCH");
  }
  assert.equal(confirmBlocked, true);

  const badUrlMarkdown = [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    "scope: subject",
    "workspaceKey: example-workspace",
    "subjectKey: math",
    "---",
    "",
    "# Gate Chapter",
    "",
    '::af-resource{#res_http kind="LINK" subjectKey="math" title="Bad URL" url="http://example.com/x"}',
    "",
  ].join("\n");
  const badUrlPreview = await previewLearningTreeImport(seed.user.id, {
    markdown: badUrlMarkdown,
    scope: "subject",
  });
  assert.equal(badUrlPreview.blocking, true);
  assert.ok(badUrlPreview.errors.some((error) => error.code === "URL_INVALID"));

  const resourcesAfter = await prisma.studyResource.count({
    where: { workspaceId: seed.workspace.id, sourceType: "LINK", archivedAt: null },
  });
  assert.equal(resourcesAfter, resourcesBefore);

  pass("resource_directive_gate", {
    fileKindBlocked: true,
    badUrlBlocked: true,
    confirmRejected: true,
  });
}

async function verifyConfirmAtomicAndIdempotent(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const markdown = [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    "scope: subject",
    "workspaceKey: example-workspace",
    "subjectKey: math",
    "---",
    "",
    "# Chapter One",
    "",
    ':::af-card{#card_m5 kind="CONCEPT" title="Limit" subjectKey="math"}',
    "Body",
    ":::",
    "",
    '::af-resource{#res_m5 kind="LINK" subjectKey="math" title="Link" url="https://example.com/r"}',
    "",
    '::af-plan{#plan_m5 subjectKey="math" title="Drill" durationMinutes="25"}',
    "",
  ].join("\n");

  const preview = await previewLearningTreeImport(seed.user.id, { markdown, scope: "subject" });
  assert.equal(preview.blocking, false);
  assert.ok(preview.items.some((item) => item.objectType === "resource" && item.stableKey === "res_m5"));
  const selections = preview.items
    .filter((item) => item.diffType !== "UNCHANGED")
    .map((item) => ({ stableKey: item.stableKey, choice: "apply" as const }));

  const foreign = await seedOtherWorkspace();
  const foreignNode = await prisma.syllabusNode.create({
    data: {
      subjectId: foreign.subject.id,
      title: "Foreign node",
      kind: "CHAPTER",
      stableKey: `foreign-node-${randomUUID()}`,
    },
  });
  let mappingDenied = false;
  let mappingErrorCode = "none";
  try {
    await confirmLearningTreeImport(seed.user.id, {
      markdown: preview.canonicalMarkdown || markdown,
      previewToken: preview.previewToken,
      idempotencyKey: "m5-map",
      selections: selections.map((selection, index) =>
        index === 0 ? { ...selection, mappedTargetId: foreignNode.id } : selection,
      ),
      previewOperationId: preview.operationId,
    });
  } catch (error) {
    mappingErrorCode = error instanceof ApiError ? error.code : error instanceof Error ? error.message : "unknown";
    mappingDenied =
      error instanceof ApiError && error.code === "LEARNING_TREE_CONFIRM_MAPPING_NOT_ALLOWED";
  }
  assert.equal(mappingDenied, true, `unexpected mapping error: ${mappingErrorCode}`);

  const batchesBeforeMismatch = await prisma.learningTreeImportBatch.count({
    where: { workspaceId: seed.workspace.id },
  });
  const emptyMismatchCases = [
    {
      name: "workspace",
      markdown: [
        "---",
        "protocol: AREAFORGE_LEARNING_TREE_V1",
        "scope: subject",
        "workspaceKey: wrong-workspace",
        "subjectKey: math",
        "---",
        "",
      ].join("\n"),
      scope: "subject" as const,
    },
    {
      name: "scope",
      markdown: [
        "---",
        "protocol: AREAFORGE_LEARNING_TREE_V1",
        "scope: global",
        `workspaceKey: ${seed.workspace.stableKey}`,
        "---",
        "",
      ].join("\n"),
      scope: "subject" as const,
    },
  ];
  for (const mismatch of emptyMismatchCases) {
    const mismatchPreview = await previewLearningTreeImport(seed.user.id, mismatch);
    assert.equal(mismatchPreview.blocking, true, `${mismatch.name} preview should block`);
    await assert.rejects(
      confirmLearningTreeImport(seed.user.id, {
        markdown: mismatchPreview.canonicalMarkdown || mismatch.markdown,
        previewToken: mismatchPreview.previewToken,
        idempotencyKey: `idem-m5-empty-${mismatch.name}-mismatch`,
        selections: [],
      }),
      (error: unknown) => error instanceof ApiError &&
        error.code === "LEARNING_TREE_CONFIRM_FRONTMATTER_MISMATCH",
    );
  }
  assert.equal(
    await prisma.learningTreeImportBatch.count({ where: { workspaceId: seed.workspace.id } }),
    batchesBeforeMismatch,
  );

  const beforeNodes = await prisma.syllabusNode.count({ where: { subjectId: seed.subject.id } });
  const beforeResources = await prisma.studyResource.count({
    where: { workspaceId: seed.workspace.id, stableKey: "res_m5" },
  });
  const concurrent = await Promise.all([
    confirmLearningTreeImport(seed.user.id, {
      markdown: preview.canonicalMarkdown || markdown,
      previewToken: preview.previewToken,
      idempotencyKey: "idem-m5-1",
      selections,
      previewOperationId: preview.operationId,
    }),
    confirmLearningTreeImport(seed.user.id, {
      markdown: preview.canonicalMarkdown || markdown,
      previewToken: preview.previewToken,
      idempotencyKey: "idem-m5-1",
      selections,
      previewOperationId: preview.operationId,
    }),
  ]);
  const first = concurrent.find((result) => !result.reused);
  const concurrentReuse = concurrent.find((result) => result.reused);
  assert.ok(first);
  assert.ok(concurrentReuse);
  assert.equal(concurrentReuse.batchId, first.batchId);
  assert.equal(first.reused, false);
  assert.ok(first.appliedCount >= 1);

  const afterNodes = await prisma.syllabusNode.count({ where: { subjectId: seed.subject.id } });
  assert.ok(afterNodes > beforeNodes);
  const afterResources = await prisma.studyResource.count({
    where: { workspaceId: seed.workspace.id, stableKey: "res_m5", sourceType: "LINK" },
  });
  assert.equal(beforeResources, 0);
  assert.equal(afterResources, 1);

  const second = await confirmLearningTreeImport(seed.user.id, {
    markdown: preview.canonicalMarkdown || markdown,
    previewToken: preview.previewToken,
    idempotencyKey: "idem-m5-1",
    selections,
    previewOperationId: preview.operationId,
  });
  assert.equal(second.reused, true);
  assert.equal(second.batchId, first.batchId);

  const expiredPreviewToken = expireLearningTreePreviewToken(preview.previewToken);
  const expiredRetry = await confirmLearningTreeImport(seed.user.id, {
    markdown: preview.canonicalMarkdown || markdown,
    previewToken: expiredPreviewToken,
    idempotencyKey: "idem-m5-1",
    selections,
    previewOperationId: preview.operationId,
  });
  assert.equal(expiredRetry.reused, true);
  assert.equal(expiredRetry.batchId, first.batchId);

  await assert.rejects(
    confirmLearningTreeImport(seed.user.id, {
      markdown: preview.canonicalMarkdown || markdown,
      previewToken: expiredPreviewToken,
      idempotencyKey: "idem-m5-1",
      selections: selections.slice(0, Math.max(1, selections.length - 1)),
      previewOperationId: preview.operationId,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "LEARNING_TREE_IDEMPOTENCY_CONFLICT",
  );
  await assert.rejects(
    confirmLearningTreeImport(foreign.user.id, {
      markdown: preview.canonicalMarkdown || markdown,
      previewToken: expiredPreviewToken,
      idempotencyKey: "idem-m5-1",
      selections,
      previewOperationId: preview.operationId,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "LEARNING_TREE_PREVIEW_ACTOR_MISMATCH",
  );

  let conflicted = false;
  try {
    await confirmLearningTreeImport(seed.user.id, {
      markdown: preview.canonicalMarkdown || markdown,
      previewToken: preview.previewToken,
      idempotencyKey: "idem-m5-1",
      selections: selections.slice(0, Math.max(1, selections.length - 1)),
      previewOperationId: preview.operationId,
    });
  } catch (error) {
    conflicted = error instanceof ApiError && error.code === "LEARNING_TREE_IDEMPOTENCY_CONFLICT";
  }
  assert.equal(conflicted, true);

  const updatedMarkdown = preview.canonicalMarkdown
    .replace("# Chapter One", "# Chapter One updated")
    .replace('title="Limit"', 'title="Limit updated"')
    .replace("\nBody\n", "\nUpdated body\n")
    .replace('title="Link"', 'title="Link updated"')
    .replace('url="https://example.com/r"', 'url="https://example.com/updated"')
    .replace('title="Drill"', 'title="Drill updated"');
  const updatePreview = await previewLearningTreeImport(seed.user.id, {
    markdown: updatedMarkdown,
    scope: "subject",
  });
  assert.equal(updatePreview.blocking, false, JSON.stringify(updatePreview.errors));
  assert.equal(updatePreview.items.length, 4);
  assert.equal(updatePreview.items.every((item) => item.diffType === "UPDATE"), true);
  const updateResult = await confirmLearningTreeImport(seed.user.id, {
    markdown: updatePreview.canonicalMarkdown,
    previewToken: updatePreview.previewToken,
    previewOperationId: updatePreview.operationId,
    idempotencyKey: "idem-m5-update-surfaces",
    selections: updatePreview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
  });
  assert.equal(updateResult.appliedCount, 4);
  const updatedNodeItem = updatePreview.items.find((item) => item.objectType === "node");
  assert.ok(updatedNodeItem?.candidateMatches[0]?.entityId);
  assert.equal((await prisma.syllabusNode.findUniqueOrThrow({
    where: { id: updatedNodeItem.candidateMatches[0].entityId },
  })).title, "Chapter One updated");
  assert.equal((await prisma.note.findFirstOrThrow({ where: {
    subjectId: seed.subject.id,
    stableKey: "card_m5",
  } })).content, "Updated body");
  assert.equal((await prisma.studyResource.findUniqueOrThrow({
    where: { workspaceId_stableKey: { workspaceId: seed.workspace.id, stableKey: "res_m5" } },
  })).externalUrl, "https://example.com/updated");
  const planVersions = (await prisma.planInboxItem.findMany({
    where: { workspaceId: seed.workspace.id, originType: "learning_tree_plan" },
    select: { id: true, originSnapshot: true, originVersion: true, supersededByItemId: true },
  })).filter((item) => asJsonRecord(item.originSnapshot).sourceStableKey === "plan_m5");
  assert.equal(planVersions.length, 2);
  const latestPlan = planVersions.find((item) => item.originVersion === 2);
  assert.ok(latestPlan);
  assert.equal(planVersions.find((item) => item.originVersion === 1)?.supersededByItemId, latestPlan.id);
  const updateBatch = await prisma.learningTreeImportBatch.findUniqueOrThrow({
    where: { id: updateResult.batchId },
    select: { statsJson: true },
  });
  const updateBulk = asJsonRecord(asJsonRecord(updateBatch.statsJson).bulkMutation);
  assert.equal(updateBulk.objectCount, 4);
  assert.equal(asJsonRecord(updateBulk.diffTypeCounts).UPDATE, 4);

  // Failed confirm must not leave half batch: force missing milestone plan then rollback
  const badMarkdown = [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    "scope: subject",
    "workspaceKey: example-workspace",
    "subjectKey: math",
    "---",
    "",
    "# Fail Chapter",
    "",
    '::af-plan{#plan_fail subjectKey="math" title="Needs milestone" milestoneKey="missing-ms" durationMinutes="25"}',
    "",
  ].join("\n");
  const badPreview = await previewLearningTreeImport(seed.user.id, { markdown: badMarkdown, scope: "subject" });
  const batchesBefore = await prisma.learningTreeImportBatch.count({ where: { workspaceId: seed.workspace.id } });
  const nodesBeforeFail = await prisma.syllabusNode.count({ where: { subjectId: seed.subject.id } });
  let failed = false;
  let failedCode = "none";
  try {
    await confirmLearningTreeImport(seed.user.id, {
      markdown: badPreview.canonicalMarkdown || badMarkdown,
      previewToken: badPreview.previewToken,
      idempotencyKey: "idem-m5-fail",
      selections: badPreview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
    });
  } catch (error) {
    failedCode = error instanceof ApiError ? error.code : error instanceof Error ? error.message : "unknown";
    failed =
      error instanceof ApiError &&
      (error.code === "LEARNING_TREE_MILESTONE_MISSING" || error.code === "LEARNING_TREE_CONFIRM_BLOCKED");
  }
  assert.equal(failed, true, `unexpected rollback error: ${failedCode}`);
  const batchesAfter = await prisma.learningTreeImportBatch.count({ where: { workspaceId: seed.workspace.id } });
  const nodesAfterFail = await prisma.syllabusNode.count({ where: { subjectId: seed.subject.id } });
  assert.equal(batchesAfter, batchesBefore);
  assert.equal(nodesAfterFail, nodesBeforeFail);

  pass("confirm_atomic_idempotent", {
    batchId: first.batchId,
    appliedCount: first.appliedCount,
    reused: second.reused,
    resourceApplied: true,
    failRolledBack: true,
    idempotencyConflict: true,
    concurrentReuse: true,
    expiredResponseLossReuse: true,
    expiredFingerprintConflict: true,
    expiredActorIsolation: true,
    foreignMappingDenied: true,
    emptyFrontmatterMismatchBlocked: true,
    mutationSurfacesBulkApplied: true,
  });
}

async function verifyHistoryOwnerAndExport(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const listed = await listLearningTreeImports(seed.user.id);
  assert.ok(listed.length >= 1);
  const detail = await getLearningTreeImport(seed.user.id, listed[0]!.id);
  assert.ok(detail.items.length >= 1);

  const beforeSnapshot = snapshotTree(uploadRoot);
  const exportMarker = mkdtempSync(join(tmpdir(), "areaforge-v11m5-export-marker-"));
  const beforeMarker = snapshotTree(exportMarker);
  const exported = await exportLearningTreeImportCanonical(seed.user.id, detail.id);
  assert.ok(exported.markdown.includes("AREAFORGE_LEARNING_TREE_V1"));
  assert.equal(exported.filename.includes(detail.id), true);
  const afterSnapshot = snapshotTree(uploadRoot);
  const afterMarker = snapshotTree(exportMarker);
  assert.deepEqual(afterSnapshot, beforeSnapshot);
  assert.deepEqual(afterMarker, beforeMarker);

  const exportSource = readFileSync(
    join(process.cwd(), "apps/web/lib/study/learning-tree-service.ts"),
    "utf8",
  );
  const exportFn = exportSource.slice(
    exportSource.indexOf("export async function exportLearningTreeImportCanonical"),
    exportSource.indexOf("\nfunction isUnique"),
  );
  assert.equal(/writeFile|mkdtemp|createWriteStream|tmpdir\(/.test(exportFn), false);
  assert.equal(/canonicalMarkdown/.test(exportFn), true);
  rmSync(exportMarker, { recursive: true, force: true });

  await prisma.examWorkspace.update({
    where: { id: seed.workspace.id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  try {
    const inactiveListItem = (await listLearningTreeImports(seed.user.id, { includeArchived: true }))
      .find((item) => item.id === detail.id);
    assert.equal(inactiveListItem?.workspaceStatus, "ARCHIVED");
    const inactiveDetail = await getLearningTreeImport(seed.user.id, detail.id);
    assert.equal(inactiveDetail.id, detail.id);
    assert.equal(inactiveDetail.workspaceStatus, "ARCHIVED");
    assert.equal((await exportLearningTreeImportCanonical(seed.user.id, detail.id)).workspaceId, seed.workspace.id);
    await assert.rejects(
      setLearningTreeImportArchived(seed.user.id, detail.id, true),
      (error: unknown) => error instanceof ApiError && error.code === "ACTIVE_WORKSPACE_NOT_FOUND",
    );
  } finally {
    await prisma.examWorkspace.update({
      where: { id: seed.workspace.id },
      data: { status: "ACTIVE", archivedAt: null },
    });
  }

  const other = await prisma.user.create({
    data: { email: `v11m5-other-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  await prisma.examWorkspace.create({
    data: {
      userId: other.id,
      stableKey: "other-ws",
      name: "Other",
      status: "ACTIVE",
    },
  });
  let denied = false;
  try {
    await getLearningTreeImport(other.id, detail.id);
  } catch (error) {
    denied =
      error instanceof ApiError &&
      (error.code === "LEARNING_TREE_IMPORT_NOT_FOUND" || error.code === "EXAM_WORKSPACE_NOT_FOUND");
  }
  assert.equal(denied, true);

  let exportDenied = false;
  try {
    await exportLearningTreeImportCanonical(other.id, detail.id);
  } catch (error) {
    exportDenied =
      error instanceof ApiError &&
      (error.code === "LEARNING_TREE_IMPORT_NOT_FOUND" || error.code === "EXAM_WORKSPACE_NOT_FOUND");
  }
  assert.equal(exportDenied, true);

  const archived = await setLearningTreeImportArchived(seed.user.id, detail.id, true);
  assert.ok(archived.archivedAt);
  assert.equal((await listLearningTreeImports(seed.user.id)).some((item) => item.id === detail.id), false);
  assert.equal(
    (await listLearningTreeImports(seed.user.id, { includeArchived: true })).some((item) => item.id === detail.id),
    true,
  );
  assert.ok((await getLearningTreeImport(seed.user.id, detail.id)).archivedAt);
  const restored = await setLearningTreeImportArchived(seed.user.id, detail.id, false);
  assert.equal(restored.archivedAt, null);
  assert.equal((await listLearningTreeImports(seed.user.id)).some((item) => item.id === detail.id), true);
  await verifyLearningTreeArchiveWorkspaceSwitchRace(seed, detail.id);

  pass("history_owner_export_no_temp", {
    batchId: detail.id,
    bytes: exported.markdown.length,
    ownerDenied: true,
    exportDenied: true,
    uploadDirUnchanged: true,
    noServerTempWrite: true,
    archiveHiddenAndRestored: true,
    inactiveWorkspaceHistoryReadable: true,
    inactiveWorkspaceMutationDenied: true,
    workspaceSwitchRaceDenied: true,
  });
}

async function verifyLearningTreeArchiveWorkspaceSwitchRace(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
  batchId: string,
): Promise<void> {
  const alternate = await prisma.examWorkspace.create({
    data: {
      userId: seed.user.id,
      stableKey: `m5-race-${randomUUID()}`,
      name: "M5 race alternate",
      status: "ARCHIVED",
      archivedAt: new Date(),
      revision: 1,
    },
  });
  let releaseLock = () => {};
  let reportLocked = () => {};
  const release = new Promise<void>((resolve) => { releaseLock = resolve; });
  const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
  const switchTransaction = prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, seed.user.id);
    reportLocked();
    await release;
    const archived = await tx.examWorkspace.updateMany({
      where: { id: seed.workspace.id, userId: seed.user.id, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: new Date(), revision: { increment: 1 } },
    });
    assert.equal(archived.count, 1);
    const activated = await tx.examWorkspace.updateMany({
      where: { id: alternate.id, userId: seed.user.id, status: "ARCHIVED" },
      data: { status: "ACTIVE", archivedAt: null, revision: { increment: 1 } },
    });
    assert.equal(activated.count, 1);
  });

  await locked;
  const before = await prisma.learningTreeImportBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { archivedAt: true },
  });
  const mutationAssertion = assert.rejects(
    setLearningTreeImportArchived(seed.user.id, batchId, true),
    (error: unknown) => error instanceof ApiError && error.code === "LEARNING_TREE_IMPORT_NOT_FOUND",
  );
  try {
    await waitForAdvisoryLockWait();
  } finally {
    releaseLock();
  }
  await switchTransaction;
  await mutationAssertion;
  const after = await prisma.learningTreeImportBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { archivedAt: true },
  });
  assert.equal(after.archivedAt?.toISOString() ?? null, before.archivedAt?.toISOString() ?? null);

  await prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, seed.user.id);
    const archivedAlternate = await tx.examWorkspace.updateMany({
      where: { id: alternate.id, userId: seed.user.id, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: new Date(), revision: { increment: 1 } },
    });
    assert.equal(archivedAlternate.count, 1);
    const restoredOriginal = await tx.examWorkspace.updateMany({
      where: { id: seed.workspace.id, userId: seed.user.id, status: "ARCHIVED" },
      data: { status: "ACTIVE", archivedAt: null, revision: { increment: 1 } },
    });
    assert.equal(restoredOriginal.count, 1);
  });
}

async function waitForAdvisoryLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'
    `;
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for learning-tree archive advisory lock contention");
}

async function verifyArchiveChunkRollback(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const parents = Array.from({ length: 501 }, (_, index) => ({
    stableKey: `archive_parent_${index}`,
    title: `Archive parent ${index}`,
  }));
  await prisma.syllabusNode.createMany({
    data: parents.map((parent) => ({
      subjectId: seed.subject.id,
      stableKey: parent.stableKey,
      title: parent.title,
      kind: "CHAPTER" as const,
    })),
  });
  const lastParent = await prisma.syllabusNode.findUniqueOrThrow({
    where: {
      subjectId_stableKey: {
        subjectId: seed.subject.id,
        stableKey: parents[500]!.stableKey,
      },
    },
  });
  const child = await prisma.syllabusNode.create({
    data: {
      subjectId: seed.subject.id,
      parentId: lastParent.id,
      stableKey: "archive_child_500",
      title: "Archive child 500",
      kind: "TOPIC",
    },
  });
  const childSchedule = await prisma.reviewSchedule.create({
    data: {
      workspaceId: seed.workspace.id,
      targetType: "SYLLABUS_NODE",
      syllabusNodeId: child.id,
      status: "ACTIVE",
      dueDate: new Date(),
      revision: 1,
      actorId: seed.user.id,
    },
  });
  const frontmatter = learningTreeSubjectFrontmatter(seed);
  const parentOnlyMarkdown = `${frontmatter}${parents.map((parent) => [
    `# ${parent.title}`,
    `::af-node{#${parent.stableKey} archived="true"}`,
  ].join("\n")).join("\n\n")}\n`;
  const preview = await previewLearningTreeImport(seed.user.id, {
    markdown: parentOnlyMarkdown,
    scope: "subject",
  });
  assert.equal(preview.blocking, false, JSON.stringify(preview.errors));
  assert.equal(preview.items.length, 501);
  assert.equal(preview.items.every((item) => item.diffType === "ARCHIVE"), true);

  const [batchCountBefore, auditCountBefore] = await Promise.all([
    prisma.learningTreeImportBatch.count({ where: { workspaceId: seed.workspace.id } }),
    prisma.auditEvent.count({
      where: { actorId: seed.user.id, action: "LEARNING_TREE_IMPORT_CONFIRMED" },
    }),
  ]);
  await installArchiveUpdateAttemptProbe();
  let observedWriteAttempts = 0;
  try {
    await assert.rejects(
      confirmLearningTreeImport(seed.user.id, {
        markdown: preview.canonicalMarkdown,
        previewToken: preview.previewToken,
        previewOperationId: preview.operationId,
        idempotencyKey: "idem-m5-archive-cross-chunk-rollback",
        selections: preview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
      }),
      (error: unknown) => error instanceof ApiError && error.code === "LEARNING_TREE_ARCHIVE_DESCENDANT_ACTIVE",
    );
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT CASE WHEN is_called THEN last_value ELSE 0 END::int AS count
      FROM "v11_m5_archive_update_attempt_seq"
    `;
    observedWriteAttempts = rows[0]?.count ?? 0;
  } finally {
    await removeArchiveUpdateAttemptProbe();
  }
  const [activeParents, activeChild, scheduleAfterRollback, batchCountAfter, auditCountAfter] = await Promise.all([
    prisma.syllabusNode.count({
      where: {
        subjectId: seed.subject.id,
        stableKey: { startsWith: "archive_parent_" },
        archivedAt: null,
      },
    }),
    prisma.syllabusNode.findUniqueOrThrow({ where: { id: child.id } }),
    prisma.reviewSchedule.findUniqueOrThrow({ where: { id: childSchedule.id } }),
    prisma.learningTreeImportBatch.count({ where: { workspaceId: seed.workspace.id } }),
    prisma.auditEvent.count({
      where: { actorId: seed.user.id, action: "LEARNING_TREE_IMPORT_CONFIRMED" },
    }),
  ]);
  assert.equal(activeParents, 501);
  assert.equal(observedWriteAttempts, 501);
  assert.equal(activeChild.archivedAt, null);
  assert.equal(scheduleAfterRollback.status, "ACTIVE");
  assert.equal(scheduleAfterRollback.revision, 1);
  assert.equal(batchCountAfter, batchCountBefore);
  assert.equal(auditCountAfter, auditCountBefore);

  const parentAndChildMarkdown = `${frontmatter}# ${parents[500]!.title}
::af-node{#${parents[500]!.stableKey} archived="true"}

## ${child.title}
::af-node{#${child.stableKey} archived="true"}
`;
  const successPreview = await previewLearningTreeImport(seed.user.id, {
    markdown: parentAndChildMarkdown,
    scope: "subject",
  });
  assert.equal(successPreview.blocking, false, JSON.stringify(successPreview.errors));
  assert.deepEqual(successPreview.items.map((item) => item.diffType), ["ARCHIVE", "ARCHIVE"]);
  const success = await confirmLearningTreeImport(seed.user.id, {
    markdown: successPreview.canonicalMarkdown,
    previewToken: successPreview.previewToken,
    previewOperationId: successPreview.operationId,
    idempotencyKey: "idem-m5-archive-parent-child",
    selections: successPreview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
  });
  const [archivedParent, archivedChild, pausedChildSchedule, itemCount, auditCount] = await Promise.all([
    prisma.syllabusNode.findUniqueOrThrow({ where: { id: lastParent.id } }),
    prisma.syllabusNode.findUniqueOrThrow({ where: { id: child.id } }),
    prisma.reviewSchedule.findUniqueOrThrow({ where: { id: childSchedule.id } }),
    prisma.learningTreeImportItem.count({ where: { batchId: success.batchId } }),
    prisma.auditEvent.count({
      where: {
        actorId: seed.user.id,
        action: "LEARNING_TREE_IMPORT_CONFIRMED",
        entityId: success.batchId,
      },
    }),
  ]);
  assert.ok(archivedParent.archivedAt);
  assert.ok(archivedChild.archivedAt);
  assert.equal(pausedChildSchedule.status, "PAUSED");
  assert.equal(pausedChildSchedule.dueDate, null);
  assert.equal(pausedChildSchedule.pausedReason, "TARGET_ARCHIVED");
  assert.equal(pausedChildSchedule.revision, 2);
  assert.equal(itemCount, 2);
  assert.equal(auditCount, 1);
  pass("learning_tree_archive_cross_chunk_atomicity", {
    attemptedObjects: 501,
    observedWriteAttempts,
    attemptedWriteBatches: Math.ceil(observedWriteAttempts / 500),
    rollbackPreservedParents: activeParents,
    parentAndChildArchived: true,
    schedulePausedAtomically: true,
  });
}

async function installArchiveUpdateAttemptProbe(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE SEQUENCE "v11_m5_archive_update_attempt_seq" START WITH 1 INCREMENT BY 1
  `);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "v11_m5_count_archive_update_attempt"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM nextval('"v11_m5_archive_update_attempt_seq"');
      RETURN NEW;
    END
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "v11_m5_archive_update_attempt_trigger"
    BEFORE UPDATE ON "SyllabusNode"
    FOR EACH ROW
    WHEN (OLD."stableKey" LIKE 'archive_parent_%')
    EXECUTE FUNCTION "v11_m5_count_archive_update_attempt"()
  `);
}

async function removeArchiveUpdateAttemptProbe(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS "v11_m5_archive_update_attempt_trigger" ON "SyllabusNode"
  `);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "v11_m5_count_archive_update_attempt"()`);
  await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "v11_m5_archive_update_attempt_seq"`);
}

async function verifyLearningTreeObjectLimitAndBulk(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const directives = Array.from(
    { length: 5_001 },
    (_, index) => `# Bulk ${index}\n::af-node{#bulk_node_${index}}`,
  );
  const frontmatter = [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    "scope: subject",
    `workspaceKey: ${seed.workspace.stableKey}`,
    `subjectKey: ${seed.subject.stableKey}`,
    "---",
    "",
  ].join("\n");
  const atLimitMarkdown = `${frontmatter}${directives.slice(0, 5_000).join("\n\n")}\n`;
  const preview = await previewLearningTreeImport(seed.user.id, {
    markdown: atLimitMarkdown,
    scope: "subject",
  });
  assert.equal(preview.blocking, false, JSON.stringify(preview.errors));
  assert.equal(preview.objectCount, 5_000);
  const result = await confirmLearningTreeImport(seed.user.id, {
    markdown: preview.canonicalMarkdown,
    previewToken: preview.previewToken,
    previewOperationId: preview.operationId,
    idempotencyKey: "idem-m5-bulk-5000",
    selections: preview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
  });
  assert.equal(result.appliedCount, 5_000);
  assert.equal(await prisma.syllabusNode.count({
    where: { subjectId: seed.subject.id, stableKey: { startsWith: "bulk_node_" } },
  }), 5_000);

  const updatedDirectives = Array.from(
    { length: 5_000 },
    (_, index) => `# Bulk updated ${index}\n::af-node{#bulk_node_${index}}`,
  );
  const updatePreview = await previewLearningTreeImport(seed.user.id, {
    markdown: `${frontmatter}${updatedDirectives.join("\n\n")}\n`,
    scope: "subject",
  });
  assert.equal(updatePreview.blocking, false, JSON.stringify(updatePreview.errors));
  assert.equal(updatePreview.items.length, 5_000);
  assert.equal(updatePreview.items.every((item) => item.diffType === "UPDATE"), true);
  const updateResult = await confirmLearningTreeImport(seed.user.id, {
    markdown: updatePreview.canonicalMarkdown,
    previewToken: updatePreview.previewToken,
    previewOperationId: updatePreview.operationId,
    idempotencyKey: "idem-m5-bulk-update-5000",
    selections: updatePreview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
  });
  assert.equal(updateResult.appliedCount, 5_000);
  assert.equal(await prisma.syllabusNode.count({
    where: {
      subjectId: seed.subject.id,
      stableKey: { startsWith: "bulk_node_" },
      title: { startsWith: "Bulk updated " },
    },
  }), 5_000);
  const updatedBatch = await prisma.learningTreeImportBatch.findUniqueOrThrow({
    where: { id: updateResult.batchId },
    select: { statsJson: true },
  });
  const updateStats = asJsonRecord(updatedBatch.statsJson);
  const bulkMutation = asJsonRecord(updateStats.bulkMutation);
  const diffTypeCounts = asJsonRecord(bulkMutation.diffTypeCounts);
  assert.equal(bulkMutation.objectCount, 5_000);
  assert.equal(bulkMutation.writeBatchCount, 10);
  assert.equal(diffTypeCounts.UPDATE, 5_000);

  const moveArchive = await verifyBulkMoveAndArchive(seed);

  const overLimit = await previewLearningTreeImport(seed.user.id, {
    markdown: `${frontmatter}${directives.join("\n\n")}\n`,
    scope: "subject",
  });
  assert.equal(overLimit.blocking, true);
  assert.ok(overLimit.errors.some((error) => error.code === "OBJECT_LIMIT"));
  assert.equal(overLimit.items.length, 0);
  pass("learning_tree_bulk_object_limit", {
    accepted: 5_000,
    rejected: 5_001,
    applied: result.appliedCount,
    updated: updateResult.appliedCount,
    updateWriteBatches: 10,
    moved: moveArchive.moved,
    archived: moveArchive.archived,
    moveWriteBatches: moveArchive.moveWriteBatches,
    archiveWriteBatches: moveArchive.archiveWriteBatches,
  });
}

async function verifyBulkMoveAndArchive(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<{ moved: number; archived: number; moveWriteBatches: number; archiveWriteBatches: number }> {
  const externalParent = await prisma.syllabusNode.create({
    data: {
      subjectId: seed.subject.id,
      stableKey: "bulk_external_parent",
      title: "Bulk external parent",
      kind: "CHAPTER",
    },
  });
  await prisma.syllabusNode.update({
    where: { subjectId_stableKey: { subjectId: seed.subject.id, stableKey: "bulk_node_0" } },
    data: { parentId: externalParent.id },
  });
  const subjectFrontmatter = learningTreeSubjectFrontmatter(seed);
  const moveDirectives = Array.from({ length: 5_000 }, (_, index) => [
    `${index === 0 ? "#" : "##"} Bulk updated ${index}`,
    `::af-node{#bulk_node_${index}}`,
  ].join("\n"));
  const movePreview = await previewLearningTreeImport(seed.user.id, {
    markdown: `${subjectFrontmatter}${moveDirectives.join("\n\n")}\n`,
    scope: "subject",
  });
  assert.equal(movePreview.blocking, false, JSON.stringify(movePreview.errors));
  assert.equal(movePreview.items.length, 5_000);
  assert.equal(movePreview.items.every((item) => item.diffType === "MOVE"), true);
  const moveResult = await confirmLearningTreeImport(seed.user.id, {
    markdown: movePreview.canonicalMarkdown,
    previewToken: movePreview.previewToken,
    previewOperationId: movePreview.operationId,
    idempotencyKey: "idem-m5-bulk-move-5000",
    selections: movePreview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
  });
  assert.equal(moveResult.appliedCount, 5_000);
  const root = await prisma.syllabusNode.findUniqueOrThrow({
    where: { subjectId_stableKey: { subjectId: seed.subject.id, stableKey: "bulk_node_0" } },
  });
  assert.equal(root.parentId, null);
  assert.equal(await prisma.syllabusNode.count({
    where: {
      subjectId: seed.subject.id,
      stableKey: { startsWith: "bulk_node_", not: "bulk_node_0" },
      parentId: root.id,
      archivedAt: null,
    },
  }), 4_999);
  const moveEvidence = await assertBulkImportEvidence(moveResult.batchId, "MOVE", 5_000, 11, seed.user.id);

  const archiveDirectives = Array.from({ length: 5_000 }, (_, index) => [
    `${index === 0 ? "#" : "##"} Bulk updated ${index}`,
    `::af-node{#bulk_node_${index} archived="true"}`,
  ].join("\n"));
  const archivePreview = await previewLearningTreeImport(seed.user.id, {
    markdown: `${subjectFrontmatter}${archiveDirectives.join("\n\n")}\n`,
    scope: "subject",
  });
  assert.equal(archivePreview.blocking, false, JSON.stringify(archivePreview.errors));
  assert.equal(archivePreview.items.length, 5_000);
  assert.equal(archivePreview.items.every((item) => item.diffType === "ARCHIVE"), true);
  const archiveResult = await confirmLearningTreeImport(seed.user.id, {
    markdown: archivePreview.canonicalMarkdown,
    previewToken: archivePreview.previewToken,
    previewOperationId: archivePreview.operationId,
    idempotencyKey: "idem-m5-bulk-archive-5000",
    selections: archivePreview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
  });
  assert.equal(archiveResult.appliedCount, 5_000);
  assert.equal(await prisma.syllabusNode.count({
    where: {
      subjectId: seed.subject.id,
      stableKey: { startsWith: "bulk_node_" },
      archivedAt: { not: null },
    },
  }), 5_000);
  const archiveEvidence = await assertBulkImportEvidence(
    archiveResult.batchId,
    "ARCHIVE",
    5_000,
    11,
    seed.user.id,
  );
  return {
    moved: moveResult.appliedCount,
    archived: archiveResult.appliedCount,
    moveWriteBatches: moveEvidence.writeBatchCount,
    archiveWriteBatches: archiveEvidence.writeBatchCount,
  };
}

async function assertBulkImportEvidence(
  batchId: string,
  diffType: "MOVE" | "ARCHIVE",
  objectCount: number,
  expectedWriteBatchCount: number,
  actorId: string,
): Promise<{ writeBatchCount: number }> {
  const [batch, items, auditCount] = await Promise.all([
    prisma.learningTreeImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { statsJson: true },
    }),
    prisma.learningTreeImportItem.findMany({
      where: { batchId },
      select: { diffType: true, applyResult: true, mappedTargetId: true },
    }),
    prisma.auditEvent.count({
      where: { actorId, action: "LEARNING_TREE_IMPORT_CONFIRMED", entityId: batchId },
    }),
  ]);
  const bulk = asJsonRecord(asJsonRecord(batch.statsJson).bulkMutation);
  const writeBatchCount = Number(bulk.writeBatchCount);
  assert.equal(bulk.objectCount, objectCount);
  assert.equal(writeBatchCount, expectedWriteBatchCount);
  assert.equal(asJsonRecord(bulk.diffTypeCounts)[diffType], objectCount);
  assert.equal(items.length, objectCount);
  assert.equal(items.every((item) =>
    item.diffType === diffType && item.applyResult === "applied" && Boolean(item.mappedTargetId)
  ), true);
  assert.equal(new Set(items.map((item) => item.mappedTargetId)).size, objectCount);
  assert.equal(auditCount, 1);
  return { writeBatchCount };
}

async function verifyConflictMapping(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const candidates = Array.from({ length: 501 }, (_, index) => ({ id: `legacy-conflict-${index}` }));
  await prisma.syllabusNode.createMany({
    data: candidates.map((candidate) => ({
      id: candidate.id,
      subjectId: seed.subject.id,
      title: "Ambiguous",
      kind: "CHAPTER" as const,
      stableKey: null,
    })),
  });
  const sharedCandidateMarkdown = `${learningTreeSubjectFrontmatter(seed)}${Array.from(
    { length: 502 },
    (_, index) => `# Ambiguous\n::af-node{#ambiguous_shared_${index}}`,
  ).join("\n\n")}\n`;
  const sharedPreview = await previewLearningTreeImport(seed.user.id, {
    markdown: sharedCandidateMarkdown,
    scope: "subject",
  });
  assert.equal(sharedPreview.items.length, 502);
  assert.equal(sharedPreview.items.every((item) =>
    item.diffType === "CONFLICT" && item.candidateMatches.length === 501
  ), true);
  const targetId = candidates[0]!.id;
  const batchCountBefore = await prisma.learningTreeImportBatch.count({
    where: { workspaceId: seed.workspace.id },
  });
  await assert.rejects(
    confirmLearningTreeImport(seed.user.id, {
      markdown: sharedPreview.canonicalMarkdown,
      previewToken: sharedPreview.previewToken,
      previewOperationId: sharedPreview.operationId,
      idempotencyKey: "idem-m5-cross-chunk-target-reuse",
      selections: sharedPreview.items.map((item, index) => ({
        stableKey: item.stableKey,
        choice: "apply" as const,
        mappedTargetId: candidates[index === 501 ? 0 : index]!.id,
      })),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "LEARNING_TREE_CONFIRM_TARGET_REUSED",
  );
  const [targetAfterReject, batchCountAfter] = await Promise.all([
    prisma.syllabusNode.findUniqueOrThrow({ where: { id: targetId } }),
    prisma.learningTreeImportBatch.count({ where: { workspaceId: seed.workspace.id } }),
  ]);
  assert.equal(targetAfterReject.stableKey, null);
  assert.equal(batchCountAfter, batchCountBefore);

  const markdown = [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    "scope: subject",
    "workspaceKey: example-workspace",
    "subjectKey: math",
    "---",
    "",
    "# Ambiguous",
    "",
  ].join("\n");
  const preview = await previewLearningTreeImport(seed.user.id, { markdown, scope: "subject" });
  const conflict = preview.items.find((item) => item.diffType === "CONFLICT");
  assert.ok(conflict);
  assert.equal(conflict.candidateMatches.length, 501);
  const result = await confirmLearningTreeImport(seed.user.id, {
    markdown: preview.canonicalMarkdown || markdown,
    previewToken: preview.previewToken,
    previewOperationId: preview.operationId,
    idempotencyKey: "idem-m5-conflict-map",
    selections: [{ stableKey: conflict.stableKey, choice: "apply", mappedTargetId: targetId }],
  });
  assert.equal(result.appliedCount, 1);
  const mapped = await prisma.syllabusNode.findUniqueOrThrow({ where: { id: targetId } });
  assert.equal(mapped.stableKey, conflict.stableKey);
  pass("conflict_mapping_resolves_block", {
    candidateCount: 501,
    mapped: true,
    crossChunkItems: 502,
    reusedTargetRejectedBeforeWrite: true,
  });
}

function pdfBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(pdfMagic);
  for (let index = pdfMagic.length; index < size; index += 1) bytes[index] = index % 251;
  return bytes;
}

function pdfScan(bytes: Uint8Array, originalName: string): BoundedFileScan {
  return {
    originalName,
    declaredMimeType: "application/pdf",
    sizeBytes: bytes.length,
    sha256Hex: createHash("sha256").update(bytes).digest("hex"),
    detectedMimeType: "application/pdf",
    bytes,
  };
}

function uploadScanIdentity(scan: BoundedFileScan) {
  return {
    originalName: scan.originalName,
    declaredMimeType: scan.declaredMimeType,
    detectedMimeType: scan.detectedMimeType,
    sizeBytes: scan.sizeBytes,
    sha256Hex: scan.sha256Hex,
    businessError: scan.businessError ?? null,
  };
}

async function stageSingleStudyResourceUpload(actorId: string, scan: BoundedFileScan) {
  const [item] = await stageStudyResourceUploadBatch(
    actorId,
    [scan],
    `m5-resource-upload-${randomUUID()}`,
  );
  assert.ok(item);
  assert.equal(item.error, null);
  assert.ok(item.staging);
  return item.staging;
}

function snapshotTree(root: string): string[] {
  const entries: string[] = [];
  const walk = (dir: string, prefix = "") => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full, rel);
      else entries.push(`${rel}:${stats.size}`);
    }
  };
  if (existsSync(root)) walk(root);
  return entries;
}

function expireLearningTreePreviewToken(token: string): string {
  const payload = token.split(".")[0];
  if (!payload) throw new Error("preview token payload missing");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  claims.expiry = Date.now() - 1;
  const expiredPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SESSION_SECRET!)
    .update(`${LEARNING_TREE_PREVIEW_PURPOSE}:${expiredPayload}`)
    .digest("base64url");
  return `${expiredPayload}.${signature}`;
}

function learningTreeSubjectFrontmatter(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): string {
  return [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    "scope: subject",
    `workspaceKey: ${seed.workspace.stableKey}`,
    `subjectKey: ${seed.subject.stableKey}`,
    "---",
    "",
  ].join("\n");
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}
