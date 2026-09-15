import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { getSafeRankingProjection, previewDatabaseDeletion, createDatabaseDeletion, controlDatabaseDeletion, controlRankingRebuild, type PrismaClient } from "../../packages/db/src/index";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { updateRankingPreference } from "../../apps/web/lib/ranking/preference-service";
import { transitionPrivateChallenge } from "../../apps/web/lib/ranking/challenge-service";
import { createRankingCase, requestRankingCase, consumeRankingCase } from "./ranking-rebuild-runtime-data";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import type { RankingRebuildFixture } from "./ranking-rebuild-fixture";

export async function rankingDeletionLifecycle(client: PrismaClient, fixture: RankingRebuildFixture) {
  const previous = { lifecycle: process.env.DATA_LIFECYCLE_ENABLED, deletion: process.env.DATA_DELETE_ENABLED };
  let stage = "seed";
  process.env.DATA_LIFECYCLE_ENABLED = "true"; process.env.DATA_DELETE_ENABLED = "true";
  try {
    const data = await createRankingCase(client, fixture, "delete-member"); await requestRankingCase(client, data);
    assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
    const old = await requestRankingCase(client, data);
    await updateRankingPreference(data.member, data.workspace.id, { enabled: false, timezone: "UTC", authorizedFields: ["score"], expectedRevision: 1 });
    stage = "freeze"; const intent = await freezeRankingAccount(client, data.member);
    stage = "frozen-read";
    await assert.rejects(getSafeRankingProjection(client, data.member.id, data.challenge.id), /NOT_FOUND/);
    stage = "old-job"; assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: old.id } })).errorCode, "RANKING_REBUILD_SNAPSHOT_CHANGED");
    const frozen = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: intent.id } });
    stage = "cancel"; await controlDatabaseDeletion(client, { actor: data.member, intentId: intent.id, expectedRevision: frozen.revision, action: "cancel" });
    assert.equal(await client.dataDeletionFence.count({ where: { intentId: intent.id } }), 0);
    stage = "freeze-again"; const purge = await freezeRankingAccount(client, data.member);
    // 合成时钟推进同时保留24小时差值；不放宽数据库保留期约束。
    await client.dataDeletionIntent.update({ where: { id: purge.id }, data: {
      frozenAt: new Date(Date.now() - 86_400_000 - 10_000), availableAt: new Date(Date.now() - 5000) } });
    stage = "claim-delete"; const lease = await claimDatabaseDeletion(client, "ranking-fixture-delete", purge.id); assert.ok(lease);
    stage = "execute-delete"; const result = await executeDatabaseDeletion(client, lease, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") });
    assert.equal(result.state, "SUCCEEDED"); assert.equal(await client.user.findUnique({ where: { id: data.member.id } }), null);
    assert.equal(await client.privateChallengeParticipant.count({ where: { challengeId: data.challenge.id, userId: data.member.id } }), 0);
    stage = "rebuild-after-delete"; await requestRankingCase(client, data); assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
    const projection = await getSafeRankingProjection(client, data.owner.id, data.challenge.id); assert.equal(projection.entries.length, 1);
    assert.equal(await client.dataDeletionFile.count({ where: { intentId: purge.id } }), 0, "this package never deletes attachment/export files");
  } catch (error) { console.error(`RANKING_DELETE_LINK_STAGE:${stage}`); throw error; }
  finally { restoreFlag("DATA_LIFECYCLE_ENABLED", previous.lifecycle); restoreFlag("DATA_DELETE_ENABLED", previous.deletion); }
}

export async function rankingFrozenRequester(client: PrismaClient, fixture: RankingRebuildFixture) {
  const previous = { lifecycle: process.env.DATA_LIFECYCLE_ENABLED, deletion: process.env.DATA_DELETE_ENABLED };
  process.env.DATA_LIFECYCLE_ENABLED = "true"; process.env.DATA_DELETE_ENABLED = "true";
  try {
    const data = await createRankingCase(client, fixture, "frozen-requester", "synthetic-not-login", true);
    const job = await requestRankingCase(client, data);
    const target = { requesterId: data.owner.id, scope: "ACCOUNT" as const, workspaceId: null, resourceType: null, resourceId: null };
    const preview = await previewDatabaseDeletion(client, data.owner, target);
    assert.ok(preview.blockers.includes("DATA_DELETE_JOB_ACTIVE"));
    const cancelled = await controlRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
      challengeId: data.challenge.id, jobId: job.id, expectedRevision: job.revision, action: "CANCEL" });
    await transitionPrivateChallenge(data.owner, data.challenge.id, "dissolve", data.challenge.revision);
    const intent = await freezeRankingAccount(client, data.owner);
    assert.ok(await client.dataDeletionFence.count({ where: { intentId: intent.id, model: "DataJob", keyJson: { path: ["id"], equals: job.id } } }));
    assert.deepEqual(await consumeRankingCase(client, data), []);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "CANCELLED");
    await assert.rejects(controlRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
      challengeId: data.challenge.id, jobId: job.id, expectedRevision: cancelled.revision, action: "REPLAY" }), /NOT_FOUND/);
    const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await controlDatabaseDeletion(client, { actor: data.owner, intentId: intent.id, expectedRevision: row.revision, action: "cancel" });
    assert.deepEqual(await consumeRankingCase(client, data), []);
  } finally { restoreFlag("DATA_LIFECYCLE_ENABLED", previous.lifecycle); restoreFlag("DATA_DELETE_ENABLED", previous.deletion); }
}

export async function freezeRankingAccount(client: PrismaClient, actor: CurrentUser) {
  const target = { requesterId: actor.id, scope: "ACCOUNT" as const, workspaceId: null, resourceType: null, resourceId: null };
  const preview = await previewDatabaseDeletion(client, actor, target);
  if (preview.blockers.length) console.error(`RANKING_FIXTURE_DELETE_BLOCKERS:${preview.blockers.join(",")}`);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.items.some(item => ["Attachment", "DataExportArtifact"].includes(item.model)), false);
  return createDatabaseDeletion(client, { actor, target, fingerprint: preview.fingerprint,
    idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") });
}
function restoreFlag(key: string, value: string | undefined) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
