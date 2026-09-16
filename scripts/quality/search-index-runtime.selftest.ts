import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { controlWorkspaceSearchIndex, getWorkspaceSearchIndexStatus, prisma, type PrismaClient } from "../../packages/db/src/index";
import { loadSearchIndexFixture, searchIndexFixtureEnvironment, assertSearchIndexFixtureContainer, verifySearchIndexFixtureLedger, type SearchIndexFixture } from "./search-index-fixture";
import { createSearchCase, requestSearchCase, consumeSearchCase, querySearchCase, searchSourceState, searchFixtureClient } from "./search-index-runtime-data";
import { searchIndexSourceFingerprint } from "./search-index-source";
import { searchProcessCrashRecovery, searchRunningControl, searchLeaseExpiresDuringCommit, searchPreparedSourceDrift, searchCommitTailInvalidation } from "./search-index-process-runtime";
import { searchConcurrentRequests, searchPartitionLockFallback, searchDeleteBarrier, searchGates, searchConfiguredCli } from "./search-index-race-runtime";
import { searchDocumentCapacity, searchTitleCapacity, searchTotalTitleCapacity, searchGrantAndFenceCapacity } from "./search-index-capacity-runtime";
import { searchFrozenCopies, searchViewerDeletion, searchFiveResourceDeletes, searchMovedSourceDelete, searchForeignReferencesRemainBlocked } from "./search-index-delete-runtime";
import { searchRealPermissions, searchAccountRevocation, searchGrantTargets, searchGrantExpiryAtReturn, searchExportRedaction, searchDeadLetterReplay } from "./search-index-lifecycle-runtime";
import { searchSourceConstraints, searchTypedSourceIdentity, searchWorkspaceDeletion } from "./search-index-constraints-runtime";

const passed: string[] = []; let current = "fixture";
const selected = process.argv[3]?.startsWith("--case=") ? process.argv[3].slice(7) : undefined;
async function check(name: string, run: () => Promise<void>) {
  if (selected && name !== selected && name !== "canonical-54-migration-ledger") return;
  current = name; await run(); passed.push(name); console.log(`PASS ${name}`);
}

async function main() {
  const fixture = loadSearchIndexFixture(process.argv[2] ?? ""); assertSearchIndexFixtureContainer(fixture);
  const env = searchIndexFixtureEnvironment(fixture); Object.assign(process.env, env);
  const sourceFingerprint = searchIndexSourceFingerprint(); const client = searchFixtureClient(env.DATABASE_URL!);
  try {
    await check("canonical-54-migration-ledger", async () => { assert.equal(await verifySearchIndexFixtureLedger(client, fixture), 54); });
    await basic(client, fixture);
    await idempotency(client, fixture);
    await controls(client, fixture);
    await revocation(client, fixture);
    await check("prepared-and-uncommitted-publication-SIGKILL", () => searchProcessCrashRecovery(client, fixture));
    await check("running-pause-cancel-acknowledgement", () => searchRunningControl(client, fixture));
    await check("lease-expires-after-index-write", () => searchLeaseExpiresDuringCommit(client, fixture));
    await check("source-changed-after-preparation", () => searchPreparedSourceDrift(client, fixture));
    await check("commit-tail-source-and-expiry-never-serve-stale-titles", () => searchCommitTailInvalidation(client, fixture));
    await check("concurrent-idempotency-and-single-claim", () => searchConcurrentRequests(client, fixture));
    await check("partition-lock-safe-source-fallback", () => searchPartitionLockFallback(client, fixture));
    await check("delete-barrier-still-fails-closed", () => searchDeleteBarrier(client, fixture));
    await check("five-switches-enqueue-prepare-commit", () => searchGates(client, fixture));
    await check("configured-standalone-worker-cli", () => searchConfiguredCli(client, fixture));
    await check("10000-and-10001-document-capacity", () => searchDocumentCapacity(client, fixture));
    await check("8192-and-8193-utf8-title-capacity", () => searchTitleCapacity(client, fixture));
    await check("16MiB-total-title-capacity", () => searchTotalTitleCapacity(client, fixture));
    await check("10001-grants-20000-fences-safe-direct-fallback", () => searchGrantAndFenceCapacity(client, fixture));
    await check("frozen-copies-rebuild-restore-and-erasure", () => searchFrozenCopies(client, fixture));
    await check("viewer-account-delete-preserves-foreign-sources", () => searchViewerDeletion(client, fixture));
    await check("five-source-types-real-erasure", () => searchFiveResourceDeletes(client, fixture));
    await check("moved-source-erases-old-workspace-copies", () => searchMovedSourceDelete(client, fixture));
    await check("foreign-references-remain-blocked", () => searchForeignReferencesRemainBlocked(client, fixture));
    await check("real-membership-role-and-ownership-history", () => searchRealPermissions(client, fixture));
    await check("real-account-suspend-and-session-revocation", () => searchAccountRevocation(client, fixture));
    await check("grant-target-access-and-owner-matrix", () => searchGrantTargets(client, fixture));
    await check("grant-expiry-before-response-is-rejected", () => searchGrantExpiryAtReturn(client, fixture));
    await check("account-workspace-export-excludes-shared-title-copies", () => searchExportRedaction(client, fixture));
    await check("dead-letter-explicit-replay", () => searchDeadLetterReplay(client, fixture));
    await check("six-source-fk-and-frozen-parent-guards", () => searchSourceConstraints(client, fixture));
    await check("same-id-different-source-kind-isolation", () => searchTypedSourceIdentity(client, fixture));
    await check("workspace-subject-deletion-clears-index", () => searchWorkspaceDeletion(client, fixture));
    assert.equal(searchIndexSourceFingerprint(), sourceFingerprint, "runtime source changed while checking");
    if (selected) { assert.equal(passed.length, 2, "selected runtime case must exist"); return; }
    await mkdir(path.resolve("output/search-index"), { recursive: true });
    await writeFile(path.resolve("output/search-index/runtime-evidence.json"), JSON.stringify({ schemaVersion: 1,
      scope: "SEARCH local fixture runtime", checkedAt: new Date().toISOString(), fixtureId: fixture.scopeId,
      migrations: 54, sourceFingerprint, passed, productionTouched: false }, null, 2) + "\n");
    console.log(`PASS SEARCH runtime ${passed.length} groups; local fixture only`);
  } finally { await client.$disconnect(); await prisma.$disconnect(); }
}

async function basic(client: PrismaClient, fixture: SearchIndexFixture) {
  await check("six-kinds-user-workspace-isolation-and-readonly-source", async () => {
    const data = await createSearchCase(client, fixture, "basic"); const before = await searchSourceState(client, data);
    const direct = await querySearchCase(data); assert.equal(direct.indexed, false); assert.equal(direct.results.length, 8);
    await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    const indexed = await querySearchCase(data); assert.equal(indexed.indexed, true); assert.deepEqual(indexed.results, direct.results);
    assert.deepEqual(new Set(indexed.results.map(row => row.kind)), new Set(["SUBJECT", "TASK", "KNOWLEDGE_POINT", "NOTE", "MISTAKE", "RESOURCE"]));
    assert.equal((await querySearchCase(data, data.viewer)).results.length, 3);
    await requestSearchCase(client, data, data.viewer); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    assert.equal((await querySearchCase(data, data.viewer)).indexed, true);
    await assert.rejects(querySearchCase(data, data.stranger), /NOT_FOUND/);
    await assert.rejects(querySearchCase(data, data.member, "SEARCH", data.secondary.id), /NOT_FOUND/);
    assert.equal((await querySearchCase(data, data.owner, "SECONDARY", data.secondary.id)).results.length, 1);
    assert.deepEqual(await searchSourceState(client, data), before);
    const encoded = JSON.stringify(indexed);
    for (const forbidden of ["private-note-body-sentinel", "private-review-sentinel", "sourceFingerprint", "sourceRevision", fixture.password]) assert.equal(encoded.includes(forbidden), false);
    assert.deepEqual(await consumeSearchCase(client, data), []);
  });
}

async function idempotency(client: PrismaClient, fixture: SearchIndexFixture) {
  await check("idempotency-generation-and-superseded-request", async () => {
    const data = await createSearchCase(client, fixture, "idempotency"); const key = randomUUID();
    const first = await requestSearchCase(client, data, data.owner, { key, generation: 0 });
    assert.equal((await requestSearchCase(client, data, data.owner, { key, generation: 0 })).id, first.id);
    await assert.rejects(requestSearchCase(client, data, data.owner, { key, generation: 1 }), /IDEMPOTENCY_CONFLICT/);
    const next = await requestSearchCase(client, data);
    await controlWorkspaceSearchIndex(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, workspaceId: data.workspace.id,
      jobId: next.id, expectedRevision: next.revision, action: "CANCEL" });
    assert.deepEqual(await consumeSearchCase(client, data), ["FAILED"]);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: first.id } })).errorCode, "SEARCH_INDEX_SUPERSEDED");
    assert.equal((await querySearchCase(data)).indexed, false);
  });
}

async function controls(client: PrismaClient, fixture: SearchIndexFixture) {
  await check("pause-resume-cancel-and-private-job-control", async () => {
    const data = await createSearchCase(client, fixture, "controls"); let job = await requestSearchCase(client, data);
    const control = (action: "PAUSE" | "RESUME" | "CANCEL", actor = data.owner) => controlWorkspaceSearchIndex(client, {
      actorId: actor.id, sessionId: actor.sessionId, workspaceId: data.workspace.id, jobId: job.id, expectedRevision: job.revision, action });
    await assert.rejects(control("CANCEL", data.member), /NOT_FOUND/);
    job = await control("PAUSE"); assert.equal(job.status, "PAUSED"); assert.deepEqual(await consumeSearchCase(client, data), []);
    job = await control("RESUME"); assert.equal(job.status, "QUEUED");
    assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    const status = await getWorkspaceSearchIndexStatus(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, workspaceId: data.workspace.id });
    assert.equal(status.index?.state, "CURRENT"); assert.equal(status.index.documentCount, 8);
    assert.deepEqual((await getWorkspaceSearchIndexStatus(client, { actorId: data.member.id, workspaceId: data.workspace.id })).jobs, []);
  });
}

async function revocation(client: PrismaClient, fixture: SearchIndexFixture) {
  await check("grant-revoke-expire-and-source-aba-invalidate-index", async () => {
    const data = await createSearchCase(client, fixture, "revocation");
    await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    await client.workspaceShareGrant.update({ where: { id: data.grants[0]!.id }, data: { revokedAt: new Date(), revision: { increment: 1 } } });
    const revoked = await querySearchCase(data); assert.equal(revoked.indexed, false); assert.equal(revoked.results.length, 7);
    assert.equal(revoked.results.some(row => row.id === data.foreign.note.id), false); assert.equal(revoked.indexedAt, null);
    await client.workspaceShareGrant.update({ where: { id: data.grants[0]!.id }, data: { revokedAt: null, revision: { increment: 1 } } });
    const job = await requestSearchCase(client, data);
    await client.note.update({ where: { id: data.own.note.id }, data: { title: "Changed SEARCH title" } });
    await client.note.update({ where: { id: data.own.note.id }, data: { title: data.own.note.title } });
    assert.deepEqual(await consumeSearchCase(client, data), ["FAILED"]);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "SEARCH_INDEX_SNAPSHOT_CHANGED");
    await client.workspaceShareGrant.update({ where: { id: data.grants[1]!.id }, data: { expiresAt: new Date(Date.now() + 50), revision: { increment: 1 } } });
    await delay(75);
    assert.equal((await querySearchCase(data)).results.some(row => row.id === data.foreign.mistake.id), false);
  });
}

main().catch(error => {
  const row = error as { name?: string; code?: string; meta?: { modelName?: string; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } };
  const cause = row.meta?.driverAdapterError?.cause;
  console.error(JSON.stringify({ event: "SEARCH_RUNTIME_FAILED", case: current, name: row.name,
    code: /^[A-Z0-9_]{1,80}$/.test(row.code ?? "") ? row.code : undefined,
    databaseCode: /^[A-Z0-9]{5}$/.test(cause?.originalCode ?? "") ? cause?.originalCode : undefined,
    guard: cause?.originalMessage?.match(/^(?:DATA_DELETE|SEARCH_INDEX)_[A-Z_]+/)?.[0],
    model: /^[A-Za-z]{1,80}$/.test(row.meta?.modelName ?? "") ? row.meta?.modelName : undefined }));
  process.exitCode = 1;
});
