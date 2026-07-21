import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../../packages/db/src/index";
import { getLearningTreeTemplate } from "../../packages/core/src/index";
import { previewLearningTreeImport } from "../../apps/web/lib/study/learning-tree-service";

const checks: Array<{ id: string; status: "pass"; details: Record<string, string | number | boolean> }> = [];

try {
  await assertIsolatedDatabase();
  await verifyConfirmNotOpen();
  await verifyStudyResourceIndexes();
  await resetTables();
  const seed = await seedWorkspace();
  await verifyFileLinkExactlyOne(seed);
  await verifyAttachmentUnique(seed);
  await verifyDuplicateOfFileOnly(seed);
  await verifyWorkspaceStableKeyUnique(seed);
  await verifyPreviewZeroWrite(seed);

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m4-runtime-selftest-v2",
        status: "pass",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS v11 M4 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V11_M4_ISOLATED_DB !== "1") {
    throw new Error("v11 M4 runtime selftest requires AREAFORGE_V11_M4_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!rows[0]?.current_database.includes("v11m4")) {
    throw new Error("v11 M4 runtime selftest refused a database without the isolated name marker");
  }
  pass("isolated_database", { database: rows[0].current_database });
}

async function verifyStudyResourceIndexes(): Promise<void> {
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'StudyResource_workspaceId_stableKey_key',
        'StudyResource_attachmentId_key'
      )
  `;
  assert.equal(indexes.length, 2);

  const checksRows = await prisma.$queryRaw<Array<{ conname: string }>>`
    SELECT conname FROM pg_constraint
    WHERE conname IN (
      'StudyResource_source_exactly_one_check',
      'StudyResource_no_self_duplicate_check'
    )
  `;
  assert.equal(checksRows.length, 2);
  pass("study_resource_indexes_and_checks", { indexes: indexes.length, checks: checksRows.length });
}

async function resetTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "StudyResourceTag",
      "StudyResourceTaskLink",
      "StudyResourceNoteLink",
      "StudyResourceMistakeLink",
      "StudyResourceSyllabusNodeLink",
      "StudyResource",
      "Attachment",
      "Subject",
      "ExamWorkspace",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

async function seedWorkspace() {
  const user = await prisma.user.create({
    data: {
      email: `v11m4-${randomUUID()}@example.com`,
      passwordHash: "scrypt$16384$8$1$dGVzdA$dGVzdA",
    },
  });
  const workspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: "ws_m4",
      name: "M4 Workspace",
      status: "ACTIVE",
    },
  });
  const subject = await prisma.subject.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "subj_m4",
      name: "数据结构",
      color: "#336699",
      sortOrder: 1,
    },
  });
  const attachmentA = await prisma.attachment.create({
    data: {
      originalName: "a.pdf",
      storedName: `stored-${randomUUID()}`,
      mimeType: "application/pdf",
      sizeBytes: 12,
      hash: createHash("sha256").update("a").digest("hex"),
      uri: `areaforge://attachments/${randomUUID()}`,
      status: "READY",
    },
  });
  const attachmentB = await prisma.attachment.create({
    data: {
      originalName: "b.pdf",
      storedName: `stored-${randomUUID()}`,
      mimeType: "application/pdf",
      sizeBytes: 12,
      hash: createHash("sha256").update("b").digest("hex"),
      uri: `areaforge://attachments/${randomUUID()}`,
      status: "READY",
    },
  });
  return { user, workspace, subject, attachmentA, attachmentB };
}

async function verifyFileLinkExactlyOne(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  await prisma.studyResource.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: "res_file_1",
      title: "讲义",
      category: "TEXTBOOK",
      sourceType: "FILE",
      subjectId: seed.subject.id,
      attachmentId: seed.attachmentA.id,
      actorId: seed.user.id,
    },
  });

  await prisma.studyResource.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: "res_link_1",
      title: "外链",
      category: "OTHER",
      sourceType: "LINK",
      subjectId: seed.subject.id,
      externalUrl: "https://example.com/docs",
      displayHost: "example.com",
      actorId: seed.user.id,
    },
  });

  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(`
        INSERT INTO "StudyResource" (
          "id","workspaceId","stableKey","title","category","sourceType","attachmentId","externalUrl","updatedAt"
        ) VALUES (
          '${randomUUID()}','${seed.workspace.id}','bad_both','x','OTHER','FILE','${seed.attachmentB.id}','https://example.com',NOW()
        )
      `),
  );

  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(`
        INSERT INTO "StudyResource" (
          "id","workspaceId","stableKey","title","category","sourceType","updatedAt"
        ) VALUES (
          '${randomUUID()}','${seed.workspace.id}','bad_neither','x','OTHER','LINK',NOW()
        )
      `),
  );

  pass("file_link_exactly_one", { ok: true });
}

async function verifyAttachmentUnique(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  await assert.rejects(() =>
    prisma.studyResource.create({
      data: {
        workspaceId: seed.workspace.id,
        stableKey: "res_file_dup_attach",
        title: "重复附件",
        category: "OTHER",
        sourceType: "FILE",
        attachmentId: seed.attachmentA.id,
      },
    }),
  );
  pass("attachment_unique", { ok: true });
}

async function verifyDuplicateOfFileOnly(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const original = await prisma.studyResource.findFirstOrThrow({
    where: { stableKey: "res_file_1" },
  });
  await prisma.studyResource.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: "res_file_copy",
      title: "副本",
      category: "OTHER",
      sourceType: "FILE",
      attachmentId: seed.attachmentB.id,
      duplicateOfResourceId: original.id,
    },
  });

  await assert.rejects(
    () =>
      prisma.$executeRawUnsafe(`
        INSERT INTO "StudyResource" (
          "id","workspaceId","stableKey","title","category","sourceType","externalUrl","displayHost","duplicateOfResourceId","updatedAt"
        ) VALUES (
          '${randomUUID()}','${seed.workspace.id}','bad_link_dup','x','OTHER','LINK','https://example.com/x','example.com','${original.id}',NOW()
        )
      `),
  );
  pass("duplicate_of_file_only", { ok: true });
}

async function verifyWorkspaceStableKeyUnique(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const attachment = await prisma.attachment.create({
    data: {
      originalName: "c.pdf",
      storedName: `stored-${randomUUID()}`,
      mimeType: "application/pdf",
      sizeBytes: 8,
      hash: createHash("sha256").update("c").digest("hex"),
      uri: `areaforge://attachments/${randomUUID()}`,
      status: "READY",
    },
  });
  await assert.rejects(() =>
    prisma.studyResource.create({
      data: {
        workspaceId: seed.workspace.id,
        stableKey: "res_file_1",
        title: "冲突键",
        category: "OTHER",
        sourceType: "FILE",
        attachmentId: attachment.id,
      },
    }),
  );
  pass("workspace_stable_key_unique", { ok: true });
}

async function verifyConfirmNotOpen(): Promise<void> {
  const confirmRoute = join(
    process.cwd(),
    "apps/web/app/api/learning-tree/imports/confirm/route.ts",
  );
  assert.equal(existsSync(confirmRoute), false);
  const serviceSource = readFileSync(
    join(process.cwd(), "apps/web/lib/study/learning-tree-service.ts"),
    "utf8",
  );
  assert.equal(/confirmLearningTree|imports\/confirm/.test(serviceSource), false);
  pass("confirm_not_open", { confirmRouteExists: false, serviceHasConfirm: false });
}

async function verifyPreviewZeroWrite(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  if (!process.env.AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET.length < 32) {
    process.env.AUTH_SESSION_SECRET = "v11-m4-preview-zero-write-secret-32b";
  }

  const before = await snapshotDomainCounts(seed.workspace.id);
  const markdown = getLearningTreeTemplate("subject").replaceAll("example-workspace", seed.workspace.stableKey);
  const preview = await previewLearningTreeImport(seed.user.id, {
    markdown,
    scope: "subject",
  });
  assert.ok(preview.operationId);
  assert.ok(preview.previewToken.includes("."));
  assert.equal(preview.workspaceId, seed.workspace.id);

  const after = await snapshotDomainCounts(seed.workspace.id);
  assert.deepEqual(after, before);
  pass("preview_zero_write", {
    studyResource: after.studyResource,
    auditEvent: after.auditEvent,
    subject: after.subject,
    syllabusNode: after.syllabusNode,
    note: after.note,
    planInboxItem: after.planInboxItem,
    blocking: preview.blocking,
  });
}

async function snapshotDomainCounts(workspaceId: string) {
  const [studyResource, auditEvent, subject, syllabusNode, note, planInboxItem] = await Promise.all([
    prisma.studyResource.count({ where: { workspaceId } }),
    prisma.auditEvent.count(),
    prisma.subject.count({ where: { workspaceId } }),
    prisma.syllabusNode.count({ where: { subject: { workspaceId } } }),
    prisma.note.count({ where: { subject: { workspaceId } } }),
    prisma.planInboxItem.count({ where: { workspaceId } }),
  ]);
  return { studyResource, auditEvent, subject, syllabusNode, note, planInboxItem };
}

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}
