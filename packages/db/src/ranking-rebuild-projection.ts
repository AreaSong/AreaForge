import { calculatePrivateChallengeScore, evaluateRankingAntiCheat, rankPrivateChallengeScores, RankingRebuildError,
  stableStringify, parseRankingRebuildJob, rankingRebuildJobFingerprint, type RankingRebuildJob, type RankingShareField } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";
import { captureRankingSnapshot, type RankingRebuildSnapshot } from "./ranking-rebuild-snapshot";
import { assertLatestRankingGeneration } from "./ranking-rebuild-generation";

export function calculateRankingRebuild(snapshot: RankingRebuildSnapshot) {
  const challenge = snapshot.challenge;
  return snapshot.participants.map(participant => {
    const sessions = snapshot.sessions.filter(row => row.userId === participant.userId).flatMap(row => row.endedAt ? [{
      id: row.id, startedAt: row.startedAt, endedAt: row.endedAt, effectiveSeconds: row.effectiveMinutes * 60,
      minimumActionCompleted: row.isEffective === true,
    }] : []);
    const score = calculatePrivateChallengeScore({ timezone: challenge.timezone,
      window: { startDate: challenge.startDate, endDate: challenge.endDate },
      targetEffectiveMinutesPerDay: challenge.targetEffectiveMinutesPerDay, sessions });
    return { participantId: participant.id, score, eligible: evaluateRankingAntiCheat({ anomalies: score.anomalies }).eligible };
  });
}

export function assertRankingRebuildSnapshot(job: RankingRebuildJob, snapshot: RankingRebuildSnapshot): void {
  if (job.challengeId !== snapshot.challenge.id || job.workspaceId !== snapshot.challenge.workspaceId
    || job.actorUserId !== snapshot.challenge.ownerUserId || job.challengeRevision !== snapshot.challenge.revision
    || job.scoreVersion !== snapshot.challenge.scoreVersion || job.rulesVersion !== snapshot.challenge.rulesVersion
    || job.ruleFingerprint !== snapshot.ruleFingerprint || job.sourceFingerprint !== snapshot.sourceFingerprint
    || stableStringify(job.authorization) !== stableStringify(snapshot.authorization)) {
    throw new RankingRebuildError("RANKING_REBUILD_SNAPSHOT_CHANGED");
  }
}

export async function publishRankingRebuild(tx: Prisma.TransactionClient, job: RankingRebuildJob, prepared: RankingRebuildSnapshot, jobId: string) {
  const current = await captureRankingSnapshot(tx, job.actorUserId, job.challengeId);
  assertRankingRebuildSnapshot(job, current);
  await assertLatestRankingGeneration(tx, job.challengeId, job.generation);
  if (current.snapshotFingerprint !== prepared.snapshotFingerprint) throw new RankingRebuildError("RANKING_REBUILD_SNAPSHOT_CHANGED");
  const results = calculateRankingRebuild(prepared).filter(row => row.eligible);
  const ids = results.map(row => row.participantId);
  const frozen = await tx.rankingProjection.count({ where: { challengeId: job.challengeId, participantId: { in: ids }, id: { in: current.frozenProjectionIds } } });
  if (frozen) throw new RankingRebuildError("RANKING_REBUILD_FROZEN");
  await tx.rankingProjection.deleteMany({ where: { challengeId: job.challengeId, participantId: { notIn: ids }, id: { notIn: current.frozenProjectionIds } } });
  for (const row of results) {
    const data = { challengeId: job.challengeId, scoreVersion: job.scoreVersion, rulesVersion: job.rulesVersion,
      sourceFingerprint: current.snapshotFingerprint, score: row.score.score, effectiveMinutes: row.score.aggregate.effectiveMinutes,
      activeDays: row.score.aggregate.activeDays, minimumActionDays: row.score.aggregate.minimumActionDays,
      anomalyCount: row.score.anomalies.length, anomalies: row.score.anomalies.map(item => ({ code: item.code, window: item.window })),
      generatedAt: new Date(job.dataCutoff) };
    await tx.rankingProjection.upsert({ where: { participantId: row.participantId },
      create: { ...data, participantId: row.participantId }, update: data });
  }
  await tx.auditEvent.create({ data: { actorId: job.actorUserId, action: "RANKING_PROJECTION_REBUILT", entityType: "PrivateChallenge",
    entityId: job.challengeId, metadata: { workspaceId: job.workspaceId, jobId, scoreVersion: job.scoreVersion,
      rulesVersion: job.rulesVersion, participantCount: current.participants.length, eligibleParticipantCount: results.length } } });
}

export async function readRankingProjection(tx: Prisma.TransactionClient, actorId: string, challengeId: string) {
  const snapshot = await captureRankingSnapshot(tx, actorId, challengeId, false);
  const { challenge } = snapshot;
  const expected = calculateRankingRebuild(snapshot).filter(row => row.eligible).map(row => row.participantId);
  const rows = await tx.rankingProjection.findMany({ where: { challengeId, participantId: { in: expected },
    id: { notIn: snapshot.frozenProjectionIds } }, orderBy: [{ score: "desc" }, { participantId: "asc" }] });
  const base = { challengeId, scoreVersion: challenge.scoreVersion, rulesVersion: challenge.rulesVersion };
  if (challenge.status === "DRAFT" || (!expected.length && !await hasEmptyPublication(tx, snapshot)) || rows.length !== expected.length || rows.some(row => row.sourceFingerprint !== snapshot.snapshotFingerprint
    || row.scoreVersion !== challenge.scoreVersion || row.rulesVersion !== challenge.rulesVersion)) return { ...base, stale: true, entries: [] };
  const ranks = new Map(rankPrivateChallengeScores(rows.map(row => ({ participantKey: row.participantId, score: row.score })))
    .map(row => [row.participantKey, row]));
  const entries = rows.map(row => {
    const participant = snapshot.participants.find(item => item.id === row.participantId)!;
    const binding = snapshot.authorization.participants.find(item => item.participantId === row.participantId)!;
    const rank = ranks.get(row.participantId)!;
    const values: Record<RankingShareField, number> = { score: row.score, effective_minutes: row.effectiveMinutes,
      active_days: row.activeDays, minimum_action_days: row.minimumActionDays, anomaly_count: row.anomalyCount };
    return { participantId: row.participantId, displayName: participant.nickname || "匿名参与者", rank: rank.rank,
      tieGroup: rank.tieGroup, tied: rank.tied, scoreVersion: row.scoreVersion, generatedAt: row.generatedAt.toISOString(),
      fields: Object.fromEntries(binding.authorizedFields.map(field => [field, values[field]])) as Partial<Record<RankingShareField, number>> };
  });
  return { ...base, stale: false, entries };
}

async function hasEmptyPublication(tx: Prisma.TransactionClient, snapshot: RankingRebuildSnapshot): Promise<boolean> {
  const row = await tx.dataJob.findFirst({ where: { kind: "RANKING_REBUILD", queueVersion: 1, status: "SUCCEEDED",
    requestedByUserId: snapshot.challenge.ownerUserId, workspaceId: snapshot.challenge.workspaceId,
    resultJson: { path: ["challengeId"], equals: snapshot.challenge.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!row) return false;
  try {
    const job = parseRankingRebuildJob(row.resultJson);
    if (rankingRebuildJobFingerprint(job) !== row.requestFingerprint) return false;
    assertRankingRebuildSnapshot(job, snapshot); return true;
  } catch { return false; }
}
