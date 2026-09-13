import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createSessionToken, hashPassword, hashSessionToken } from "../../packages/auth/src/index";
import { prisma } from "../../packages/db/src/index";
import { createAttachmentUri } from "../../packages/storage/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { verifyDataJobWorkerMigrations } from "./data-job-worker-runtime-fixture";

export async function requireDataExportFixture() {
  assert.equal(process.env.AREAFORGE_DATA_EXPORT_ISOLATED_DB, "1", "explicit export fixture guard required");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const databaseName = url.pathname.slice(1);
  assert.match(databaseName, /^areaforge_v20_export_[a-z0-9_]+$/);
  const [database] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database?.name, databaseName);
  const base = await realpath(process.env.AREAFORGE_DATA_EXPORT_FIXTURE_ROOT ?? "");
  assert.match(path.basename(base), /^areaforge-v20-export-[A-Za-z0-9]+$/);
  const stat = await lstat(base); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o077, 0);
  const roots = { exportRoot: path.join(base, "exports"), uploadRoot: path.join(base, "uploads") };
  await mkdir(roots.exportRoot, { mode: 0o700, recursive: true }); await mkdir(roots.uploadRoot, { mode: 0o700, recursive: true });
  const marker = { schemaVersion: 1, fixtureKind: "data-export", databaseName, ownerUid: process.getuid?.(), ownerGid: process.getgid?.(), repositoryHash: createHash("sha256").update(process.cwd()).digest("hex") };
  await writeOnce(path.join(base, ".areaforge-data-export-fixture.json"), marker);
  const secretsPath = path.join(base, ".fixture.private.json");
  await writeOnce(secretsPath, { sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }, false);
  const secrets = JSON.parse(await readFile(secretsPath, "utf8")) as { sessionSecret: string; actionSecret: string };
  assert.ok(secrets.sessionSecret.length >= 32 && secrets.actionSecret.length >= 32 && secrets.sessionSecret !== secrets.actionSecret);
  Object.assign(process.env, { DATA_LIFECYCLE_ENABLED: "true", DATA_EXPORT_ENABLED: "true", AUTH_MULTI_USER_ENABLED: "true", AUTH_RBAC_ENABLED: "true",
    AUTH_SESSION_SECRET: secrets.sessionSecret, AUTH_ACTION_TOKEN_SECRET: secrets.actionSecret, AI_ENABLED: "false", EXPORT_DIR: roots.exportRoot, UPLOAD_DIR: roots.uploadRoot });
  const migrations = await verifyDataJobWorkerMigrations();
  return { base, roots, secrets, databaseName, migrations };
}

async function writeOnce(file: string, value: unknown, compare = true) {
  try { await writeFile(file, JSON.stringify(value), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    const stat = await lstat(file); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o077, 0);
    if (compare) assert.deepEqual(JSON.parse(await readFile(file, "utf8")), value);
  }
}

export async function seedDataExportFixture() {
  const environment = await requireDataExportFixture();
  const prefix = `exp_${randomUUID().replaceAll("-", "")}`;
  const password = randomBytes(20).toString("base64url") + "!a1A";
  const passwordHash = await hashPassword(password);
  const owner = await prisma.user.create({ data: { id: `${prefix}_owner`, email: `${prefix}@example.test`, passwordHash, emailVerifiedAt: new Date() } });
  const other = await prisma.user.create({ data: { id: `${prefix}_other`, email: `${prefix}_other@example.test`, passwordHash, emailVerifiedAt: new Date() } });
  const workspace = await prisma.examWorkspace.create({ data: { userId: owner.id, stableKey: "own", name: "导出验收工作区", memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  const foreign = await prisma.examWorkspace.create({ data: { userId: other.id, stableKey: "foreign", name: "FOREIGN_WORKSPACE_PRIVATE", stageSummary: "FOREIGN_STAGE_PRIVATE", memberships: { create: [{ userId: other.id, role: "OWNER" }, { userId: owner.id, role: "MEMBER", status: "LEFT", revision: 2 }] } } });
  const group = await prisma.subjectGroup.create({ data: { workspaceId: workspace.id, stableKey: "group", name: "本人科目组" } });
  const foreignGroup = await prisma.subjectGroup.create({ data: { workspaceId: foreign.id, stableKey: "group", name: "FOREIGN_GROUP_PRIVATE" } });
  const subject = await prisma.subject.create({ data: { workspaceId: workspace.id, groupId: group.id, stableKey: "subject", name: "本人科目", color: "#14b8a6" } });
  const foreignSubject = await prisma.subject.create({ data: { workspaceId: foreign.id, groupId: foreignGroup.id, stableKey: "subject", name: "FOREIGN_SUBJECT_PRIVATE", color: "#ff0000" } });
  const foreignNode = await prisma.syllabusNode.create({ data: { subjectId: foreignSubject.id, title: "FOREIGN_SYLLABUS_PRIVATE", kind: "CHAPTER", actualMinutes: 999 } });
  const note = await prisma.note.create({ data: { ownerUserId: owner.id, subjectId: subject.id, title: "本人笔记", content: "OWN_NOTE_BODY" } });
  const historicalNote = await prisma.note.create({ data: { ownerUserId: owner.id, subjectId: foreignSubject.id, syllabusNodeId: foreignNode.id, title: "本人历史笔记", content: "OWN_HISTORICAL_BODY" } });
  await prisma.note.create({ data: { ownerUserId: other.id, subjectId: foreignSubject.id, title: "FOREIGN_NOTE_PRIVATE", content: "FOREIGN_BODY_PRIVATE" } });
  await prisma.motivationVault.create({ data: { userId: owner.id, whyStarted: "ACCOUNT_ONLY_MOTIVATION" } });
  await prisma.notificationPreference.create({ data: { userId: owner.id } });
  await prisma.auditEvent.create({ data: { actorId: owner.id, action: "ACCOUNT_ONLY_AUDIT", entityType: "User", entityId: owner.id } });
  const fileBytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 24, g: 125, b: 144 } } }).png().toBuffer();
  const storedName = `${randomUUID().replaceAll("-", "")}.png`;
  const sourcePath = path.join(environment.roots.uploadRoot, storedName);
  await writeFile(sourcePath, fileBytes, { flag: "wx", mode: 0o600 });
  const attachment = await prisma.attachment.create({ data: { ownerUserId: owner.id, noteId: note.id, originalName: "fixture.png", storedName, uri: createAttachmentUri(storedName), mimeType: "image/png", sizeBytes: fileBytes.length, hash: createHash("sha256").update(fileBytes).digest("hex"), status: "READY", protocolVersion: 0, finalizedAt: new Date() } });
  const actorSession = await fixtureSession(owner, environment.secrets.sessionSecret);
  const otherSession = await fixtureSession(other, environment.secrets.sessionSecret);
  return { ...environment, prefix, owner, other, actor: actorSession.actor, otherActor: otherSession.actor,
    token: actorSession.token, otherToken: otherSession.token, password, workspace, foreign, subject, foreignSubject, foreignNode, note, historicalNote, attachment, sourcePath, fileBytes };
}

async function fixtureSession(user: { id: string; email: string; authRevision: number }, secret: string) {
  const token = createSessionToken(); const now = new Date();
  const session = await prisma.authSession.create({ data: { userId: user.id, tokenHash: hashSessionToken(token, secret), authRevision: user.authRevision, expiresAt: new Date(now.getTime() + 7_200_000), reauthenticatedAt: now, lastSeenAt: now, deviceLabel: "EXPORT_FIXTURE" } });
  const actor: CurrentUser = { id: user.id, email: user.email, sessionId: session.id, status: "ACTIVE", emailVerifiedAt: now, reauthenticatedAt: now };
  return { actor, token };
}

export type ExportFixture = Awaited<ReturnType<typeof seedDataExportFixture>>;
