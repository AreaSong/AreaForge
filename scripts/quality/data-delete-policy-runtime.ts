import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { type PrismaClient } from "../../packages/db/src/index";
import { DataDeleteError, type DataDeleteTarget } from "../../packages/core/src/index";
import { buildDatabaseDeletePlan } from "../../packages/db/src/data-delete-plan";
import { createDatabaseDeletion, controlDatabaseDeletion, deleteClock } from "../../packages/db/src/data-delete-intents";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { withDeletionVisibility } from "../../packages/db/src/data-delete-visibility";
import { listDeletionCandidates } from "../../packages/db/src/data-delete-candidates";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { queryKnowledgeCanvasIndexPage } from "../../apps/web/lib/study/knowledge-canvas-query";
import { createFixtureDeletion, makeDeletionEligible, seedDeletionCase, type DeletionCase } from "./data-delete-runtime-data";
import { type DataDeleteFixture } from "./data-delete-fixture";

export async function testDeletionResourceKinds(client: PrismaClient, fixture: DataDeleteFixture) {
  const data = await seedDeletionCase(client, fixture); const visible = withDeletionVisibility(client);
  const mistake = await client.mistake.create({ data: { ownerUserId: data.user.id, subjectId: data.subject.id, title: "合成错题删除", questionText: "SYNTHETIC" } });
  const task = await client.studyTask.create({ data: { ownerUserId: data.user.id, subjectId: data.subject.id, title: "合成任务删除", type: "study", plannedDate: new Date() } });
  const resource = await client.studyResource.create({ data: { ownerUserId: data.user.id, workspaceId: data.workspace.id, subjectId: data.subject.id,
    stableKey: randomUUID(), title: "合成资料删除", sourceType: "LINK", externalUrl: "https://example.test/synthetic" } });
  const point = await client.knowledgePoint.create({ data: { userId: data.user.id, workspaceId: data.workspace.id, primarySubjectId: data.subject.id,
    stableKey: randomUUID(), title: "合成知识点删除" } });
  const cases = [
    { kind: "Note", row: data.note, canvas: "NOTE", read: () => visible.note.findUnique({ where: { id: data.note.id } }) },
    { kind: "Mistake", row: mistake, canvas: "MISTAKE", read: () => visible.mistake.findUnique({ where: { id: mistake.id } }) },
    { kind: "StudyTask", row: task, canvas: "TASK", read: () => visible.studyTask.findUnique({ where: { id: task.id } }) },
    { kind: "StudyResource", row: resource, canvas: "STUDY_RESOURCE", read: () => visible.studyResource.findUnique({ where: { id: resource.id } }) },
    { kind: "KnowledgePoint", row: point, canvas: null, read: () => visible.knowledgePoint.findUnique({ where: { id: point.id } }) },
  ] as const;
  for (const item of cases) {
    const target: DataDeleteTarget = { requesterId: data.user.id, scope: "RESOURCE", workspaceId: data.workspace.id, resourceType: item.kind, resourceId: item.row.id };
    const before = item.canvas ? await canvas(data, item.canvas + ":" + item.row.id) : null;
    assert.ok(!before || before.focusFound);
    const pending = await freezeResource(client, data, target);
    assert.equal(await item.read(), null, item.kind + " must be hidden");
    assert.equal((await listDeletionCandidates(visible, { userId: data.user.id, workspaceId: data.workspace.id, resourceType: item.kind })).some(row => row.id === item.row.id), false);
    if (item.canvas) {
      const hidden = await canvas(data, item.canvas + ":" + item.row.id);
      assert.equal(hidden.focusFound, false, item.kind + " must be hidden from raw canvas queries");
      assert.equal(hidden.graphNodeCount, before!.graphNodeCount - 1);
      assert.equal(hidden.graphEdgeCount, before!.graphEdgeCount - 1);
      const search = await canvas(data, "WORKSPACE:" + data.workspace.id, item.row.title);
      assert.equal(search.nodes.some(row => row.entityId === item.row.id), false);
    }
    const restores = await Promise.allSettled([1, 2].map(() => controlDatabaseDeletion(client, { actor: data.actor, intentId: pending.id, expectedRevision: pending.revision, action: "restore" })));
    assert.equal(restores.filter(result => result.status === "fulfilled").length, 1);
    const rejected = restores.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.match(String(rejected.reason), /DATA_DELETE_REVISION_CONFLICT/);
    assert.ok(await item.read());
    if (item.canvas) assert.equal((await canvas(data, item.canvas + ":" + item.row.id)).focusFound, true);
    const purge = await freezeResource(client, data, target); await makeDeletionEligible(client, purge.id);
    const leases = await Promise.all([claimDatabaseDeletion(client, "claim-a", purge.id), claimDatabaseDeletion(client, "claim-b", purge.id)]);
    assert.equal(leases.filter(Boolean).length, 1, "concurrent claims must have exactly one winner");
    assert.equal((await executeDatabaseDeletion(client, leases.find(lease => lease !== null)!, roots(fixture))).state, "SUCCEEDED");
    assert.equal(await item.read(), null);
  }
  console.log("PASS DELETE resource kinds: all five trash/restore/purge paths, candidates, raw canvas nodes/edges/counts/search and concurrent claims");
}

export async function testDeletionAuthorizationChanges(client: PrismaClient, fixture: DataDeleteFixture) {
  for (const change of ["membership", "ownership", "suspension"] as const) {
    const data = await seedDeletionCase(client, fixture); const pending = await createFixtureDeletion(client, data);
    const membership = await client.workspaceMembership.findFirstOrThrow({ where: { workspaceId: data.workspace.id, userId: data.user.id } });
    if (change === "membership") await client.workspaceMembership.update({ where: { id: membership.id }, data: { status: "REMOVED", revision: { increment: 1 } } });
    if (change === "ownership") {
      const other = await seedDeletionCase(client, fixture);
      await client.$transaction(async tx => {
        await tx.examWorkspace.update({ where: { id: data.workspace.id }, data: { userId: other.user.id, revision: { increment: 1 } } });
        await tx.workspaceMembership.update({ where: { id: membership.id }, data: { role: "MEMBER", revision: { increment: 1 } } });
        await tx.workspaceMembership.create({ data: { workspaceId: data.workspace.id, userId: other.user.id, role: "OWNER" } });
      });
    }
    if (change === "suspension") await client.user.update({ where: { id: data.user.id }, data: { status: "SUSPENDED", authRevision: { increment: 1 } } });
    await makeDeletionEligible(client, pending.id);
    const lease = await claimDatabaseDeletion(client, "revoked-delete", pending.id); assert.ok(lease);
    assert.equal((await executeDatabaseDeletion(client, lease, roots(fixture))).state, "FAILED");
    const failed = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(failed.irreversibleAt, null); await access(path.join(fixture.root, "uploads", data.storedName));
    assert.ok(await client.note.findUnique({ where: { id: data.note.id } }));
    if (change === "membership") await client.workspaceMembership.update({ where: { id: membership.id }, data: { status: "ACTIVE", revision: { increment: 1 } } });
    let actor = data.actor;
    if (change === "suspension") {
      const user = await client.user.update({ where: { id: data.user.id }, data: { status: "ACTIVE" } });
      await assert.rejects(() => controlDatabaseDeletion(client, { actor, intentId: pending.id, expectedRevision: failed.revision, action: "retry" }), /REAUTHENTICATION_REQUIRED/);
      const now = await deleteClock(client);
      const session = await client.authSession.create({ data: { userId: user.id, tokenHash: randomBytes(32).toString("hex"), authRevision: user.authRevision,
        reauthenticatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) } });
      actor = { id: user.id, sessionId: session.id };
    }
    await controlDatabaseDeletion(client, { actor, intentId: pending.id, expectedRevision: failed.revision, action: "retry" });
    const resumed = await claimDatabaseDeletion(client, "reconfirmed-delete", pending.id); assert.ok(resumed);
    assert.equal((await executeDatabaseDeletion(client, resumed, roots(fixture))).state, "SUCCEEDED");
  }
  console.log("PASS DELETE authorization: membership removal, ownership transfer and suspension stop before unlink; explicit current-epoch retry and old-session rejection");
}

export async function testDeletionBlockingReferences(client: PrismaClient, fixture: DataDeleteFixture) {
  const data = await seedDeletionCase(client, fixture);
  const challenge = await client.privateChallenge.create({ data: { workspaceId: data.workspace.id, ownerUserId: data.user.id, name: "合成未解散挑战",
    timezone: "Asia/Shanghai", startDate: "2026-09-14", endDate: "2026-09-20", targetEffectiveMinutesPerDay: 30 } });
  const account: DataDeleteTarget = { requesterId: data.user.id, scope: "ACCOUNT", workspaceId: null, resourceType: null, resourceId: null };
  const blocked = await client.$transaction(tx => buildDatabaseDeletePlan(tx, account), { timeout: 60_000 });
  assert.ok(blocked.blockers.includes("DATA_DELETE_CHALLENGE_OWNED"));
  assert.ok(await client.privateChallenge.findUnique({ where: { id: challenge.id } }));
  await assert.rejects(() => client.attachment.create({ data: { ownerUserId: data.user.id, noteId: data.note.id, storedName: data.storedName, uri: data.attachment.uri,
    originalName: "synthetic-duplicate.pdf", mimeType: data.attachment.mimeType, hash: data.attachment.hash, sizeBytes: data.attachment.sizeBytes, status: "READY" } }), /Unique constraint failed/);
  const other = await seedDeletionCase(client, fixture);
  const mistake = await client.mistake.create({ data: { ownerUserId: other.user.id, subjectId: other.subject.id, title: "他人合成错题" } });
  await client.noteMistakeLink.create({ data: { noteId: data.note.id, mistakeId: mistake.id } });
  const target: DataDeleteTarget = { requesterId: data.user.id, scope: "RESOURCE", workspaceId: data.workspace.id, resourceType: "Note", resourceId: data.note.id };
  const linked = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { timeout: 60_000 });
  assert.ok(linked.blockers.includes("DATA_DELETE_FOREIGN_REFERENCE"));
  await access(path.join(fixture.root, "uploads", data.storedName));
  console.log("PASS DELETE blockers: undissolved challenges, foreign-owner links and duplicate file identities fail closed without deleting their source");
}

export async function testDeletionRetryBudget(client: PrismaClient, fixture: DataDeleteFixture) {
  const data = await seedDeletionCase(client, fixture); const pending = await createFixtureDeletion(client, data);
  await makeDeletionEligible(client, pending.id);
  await client.dataDeletionIntent.update({ where: { id: pending.id }, data: { maxAttempts: 2 } });
  for (const attempt of [1, 2]) {
    const lease = await claimDatabaseDeletion(client, "retry-budget", pending.id); assert.ok(lease);
    const result = await executeDatabaseDeletion(client, lease, roots(fixture), { afterIntent: async () => { throw new DataDeleteError("DATA_DELETE_SCOPE_BUSY", true); } });
    assert.equal(result.state, attempt === 1 ? "RETRY_WAIT" : "FAILED");
    const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(row.attempt, attempt); assert.equal(row.leaseOwner, null);
    await access(path.join(fixture.root, "uploads", data.storedName));
    assert.equal(await claimDatabaseDeletion(client, "too-early-retry", pending.id), null);
    if (attempt === 1) {
      assert.ok(row.nextAttemptAt && row.nextAttemptAt > await deleteClock(client));
      await client.dataDeletionIntent.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(0) } });
    }
  }
  const failed = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: pending.id } });
  await controlDatabaseDeletion(client, { actor: data.actor, intentId: pending.id, expectedRevision: failed.revision, action: "retry" });
  const resumed = await claimDatabaseDeletion(client, "manual-retry", pending.id); assert.ok(resumed);
  assert.equal((await executeDatabaseDeletion(client, resumed, roots(fixture))).state, "SUCCEEDED");
  assert.equal(await client.dataDeletionLedger.count({ where: { intentId: pending.id } }), 1);
  console.log("PASS DELETE retry budget: durable backoff, bounded dead letter and explicit replay preserve one physical result and ledger");
}

function roots(fixture: DataDeleteFixture) { return { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") }; }
async function freezeResource(client: PrismaClient, data: DeletionCase, target: DataDeleteTarget) {
  const plan = await client.$transaction(tx => buildDatabaseDeletePlan(tx, target), { timeout: 60_000 }); assert.deepEqual(plan.blockers, []);
  return createDatabaseDeletion(client, { actor: data.actor, target, fingerprint: plan.fingerprint, idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") });
}
function canvas(data: DeletionCase, focusId: string, query?: string) {
  return queryKnowledgeCanvasIndexPage({ workspaceId: data.workspace.id, ownerUserId: data.user.id, focusId, depth: 0, includeAllStatuses: true, query });
}
