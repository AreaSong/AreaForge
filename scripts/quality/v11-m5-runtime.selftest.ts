import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStudyResourceUploadPolicy,
  detectUploadMimeType,
  preferredDownloadDisposition,
  type BoundedFileScan,
} from "../../packages/storage/src/index";
import { canonicalizeHttpsUrl } from "../../packages/core/src/index";
import { prisma } from "../../packages/db/src/index";
import {
  confirmLearningTreeImport,
  exportLearningTreeImportCanonical,
  getLearningTreeImport,
  listLearningTreeImports,
  previewLearningTreeImport,
} from "../../apps/web/lib/study/learning-tree-service";
import {
  createLinkStudyResource,
  archiveStudyResource,
  linkStudyResource,
  resolveStudyResourceUpload,
  stageStudyResourceUpload,
} from "../../apps/web/lib/study/study-resource-service";
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
  await resetTables();
  const seed = await seedWorkspace();
  await verifyLinkResourceAndArchive(seed);
  await verifyHttpsZeroNetwork();
  await verifyDuplicateThreeWay(seed);
  await verifyResourceOwnerIsolation(seed);
  await verifyResourceDirectiveGate(seed);
  await verifyConfirmAtomicAndIdempotent(seed);
  await verifyHistoryOwnerAndExport(seed);

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m5-runtime-selftest-v1",
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
      AND tablename IN ('LearningTreeImportBatch', 'LearningTreeImportItem')
  `;
  assert.equal(tables.length, 2);
  pass("migration5_schema", { indexes: indexes.length, tables: tables.length });
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
  const resource = await createLinkStudyResource(seed.user.id, {
    title: "Official syllabus",
    url: "https://Example.COM/path",
    subjectId: seed.subject.id,
  });
  assert.equal(resource.sourceType, "LINK");
  assert.equal(resource.displayHost, "example.com");
  assert.equal(resource.organizeStatus, "READY_FOR_USE");
  const archived = await archiveStudyResource(seed.user.id, resource.id);
  assert.equal(archived.organizeStatus, "ARCHIVED");
  pass("link_resource_archive", { id: resource.id });
}

async function verifyHttpsZeroNetwork(): Promise<void> {
  assert.equal(canonicalizeHttpsUrl("https://127.0.0.1/x").ok, false);
  assert.equal(canonicalizeHttpsUrl("https://localhost/x").ok, false);
  pass("https_zero_network_rules", { ok: true });
}

async function verifyDuplicateThreeWay(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const bytes = pdfBytes(512);
  const firstStage = await stageStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-a.pdf"));
  const original = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: firstStage.attachment.id,
    decision: "copy",
    title: "Original PDF",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in original));
  assert.equal(original.sourceType, "FILE");

  const secondStage = await stageStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-b.pdf"));
  assert.ok(secondStage.duplicates.some((row) => row.resourceId === original.id));

  const skipped = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: secondStage.attachment.id,
    decision: "skip",
  });
  assert.deepEqual(skipped, { skipped: true });

  const thirdStage = await stageStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-c.pdf"));
  const reused = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: thirdStage.attachment.id,
    decision: "reuse",
    reuseResourceId: original.id,
  });
  assert.ok(!("skipped" in reused));
  assert.equal(reused.id, original.id);

  const fourthStage = await stageStudyResourceUpload(seed.user.id, pdfScan(bytes, "dup-d.pdf"));
  const copied = await resolveStudyResourceUpload(seed.user.id, {
    attachmentId: fourthStage.attachment.id,
    decision: "copy",
    title: "Copy PDF",
    subjectId: seed.subject.id,
  });
  assert.ok(!("skipped" in copied));
  assert.notEqual(copied.id, original.id);
  assert.equal(copied.duplicateOfResourceId, original.id);

  pass("duplicate_three_way", {
    originalId: original.id,
    copyId: copied.id,
    skipped: true,
    reused: true,
  });
}

async function verifyResourceOwnerIsolation(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const other = await seedOtherWorkspace();
  const staged = await stageStudyResourceUpload(seed.user.id, pdfScan(pdfBytes(384), "owner.pdf"));

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
  await archiveStudyResource(seed.user.id, resource.id);

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
    mappingDenied =
      error instanceof ApiError && error.code === "LEARNING_TREE_CONFIRM_MAPPING_NOT_ALLOWED";
  }
  assert.equal(mappingDenied, true);

  const beforeNodes = await prisma.syllabusNode.count({ where: { subjectId: seed.subject.id } });
  const beforeResources = await prisma.studyResource.count({
    where: { workspaceId: seed.workspace.id, stableKey: "res_m5" },
  });
  const first = await confirmLearningTreeImport(seed.user.id, {
    markdown: preview.canonicalMarkdown || markdown,
    previewToken: preview.previewToken,
    idempotencyKey: "idem-m5-1",
    selections,
    previewOperationId: preview.operationId,
  });
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
  try {
    await confirmLearningTreeImport(seed.user.id, {
      markdown: badPreview.canonicalMarkdown || badMarkdown,
      previewToken: badPreview.previewToken,
      idempotencyKey: "idem-m5-fail",
      selections: badPreview.items.map((item) => ({ stableKey: item.stableKey, choice: "apply" as const })),
    });
  } catch (error) {
    failed =
      error instanceof ApiError &&
      (error.code === "LEARNING_TREE_MILESTONE_MISSING" || error.code === "LEARNING_TREE_CONFIRM_BLOCKED");
  }
  assert.equal(failed, true);
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
    foreignMappingDenied: true,
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

  pass("history_owner_export_no_temp", {
    batchId: detail.id,
    bytes: exported.markdown.length,
    ownerDenied: true,
    exportDenied: true,
    uploadDirUnchanged: true,
    noServerTempWrite: true,
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

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}
