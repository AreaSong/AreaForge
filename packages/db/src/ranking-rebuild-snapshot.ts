import { createHash } from "node:crypto";
import { RankingRebuildError, RANKING_REBUILD_MAX_PARTICIPANTS, RANKING_REBUILD_MAX_SESSIONS,
  intersectRankingShareFields, rankingIdentifier, stableStringify, type RankingRebuildAuthorization } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { guardDerivedQueueTransaction, isDataJobScopeBusy } from "./data-job-derived-guard";

const challengeSelect = { id: true, workspaceId: true, ownerUserId: true, status: true, revision: true, scoreVersion: true,
  rulesVersion: true, timezone: true, startDate: true, endDate: true, targetEffectiveMinutesPerDay: true, publishedFields: true } as const;
const participantSelect = { id: true, userId: true, status: true, revision: true, nickname: true, authorizedFields: true } as const;
export type RankingChallenge = Prisma.PrivateChallengeGetPayload<{ select: typeof challengeSelect }>;
export type RankingParticipant = Prisma.PrivateChallengeParticipantGetPayload<{ select: typeof participantSelect }>;
export type RankingSourceSession = { id: string; userId: string; startedAt: Date; endedAt: Date | null; effectiveMinutes: number; isEffective: boolean | null; rowRevision: string };
export interface RankingRebuildSnapshot {
  challenge: RankingChallenge;
  participants: RankingParticipant[];
  authorization: RankingRebuildAuthorization;
  sessions: RankingSourceSession[];
  ruleFingerprint: string;
  sourceFingerprint: string;
  snapshotFingerprint: string;
  frozenProjectionIds: string[];
}

/** 所有原生/ORM读取都在删除共享栅栏之后；账户身份自身的冻结也必须显式排除。 */
export async function captureRankingSnapshot(tx: Prisma.TransactionClient, actorId: string, challengeId: string,
  ownerOnly = true): Promise<RankingRebuildSnapshot> {
  rankingIdentifier(actorId); rankingIdentifier(challengeId);
  await guardDerivedQueueTransaction(tx, ["RANKING_REBUILD"]);
  const visibility = await rankingVisibility(tx);
  if (visibility.hidden("User").includes(actorId) || visibility.hidden("PrivateChallenge").includes(challengeId)) notFound();
  if (ownerOnly) await tx.$queryRaw`SELECT id FROM "PrivateChallenge" WHERE id=${challengeId} FOR UPDATE NOWAIT`;
  else await tx.$queryRaw`SELECT id FROM "PrivateChallenge" WHERE id=${challengeId} FOR SHARE NOWAIT`;
  const challenge = await tx.privateChallenge.findUnique({ where: { id: challengeId }, select: challengeSelect });
  if (!challenge || challenge.status === "DISSOLVED" || visibility.hidden("ExamWorkspace").includes(challenge.workspaceId)
    || (ownerOnly && (challenge.ownerUserId !== actorId || challenge.status === "DRAFT"))) notFound();
  const participants = await rankingParticipants(tx, challengeId, visibility);
  const scoped = await rankingAuthorization(tx, challenge, participants, actorId, visibility);
  const sessions = await rankingSessions(tx, challenge, scoped.participants, visibility.hidden("StudySession"));
  const ruleFingerprint = rankingHash("rules", challenge);
  const sourceFingerprint = rankingHash("sessions", sessions.map(row => ({ ...row,
    startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null })));
  const snapshotFingerprint = rankingHash("snapshot", { ruleFingerprint, sourceFingerprint, authorization: scoped.authorization });
  return { challenge, ...scoped, sessions, ruleFingerprint, sourceFingerprint, snapshotFingerprint,
    frozenProjectionIds: visibility.hidden("RankingProjection") };
}

type Visibility = { revision: string; hidden: (model: string) => string[] };
async function rankingVisibility(tx: Prisma.TransactionClient): Promise<Visibility> {
  const epoch = await tx.dataDeletionVisibility.findUnique({ where: { id: 1 }, select: { revision: true } });
  if (!epoch) throw new RankingRebuildError("RANKING_REBUILD_MIGRATION_REQUIRED");
  const rows = await tx.dataDeletionFence.findMany({ where: { model: { in: ["User", "ExamWorkspace", "PrivateChallenge",
    "PrivateChallengeParticipant", "RankingPreference", "StudySession", "RankingProjection"] } }, select: { model: true, keyJson: true }, take: 20_001 });
  if (rows.length > 20_000) throw new RankingRebuildError("RANKING_REBUILD_VISIBILITY_LIMIT");
  const hidden = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.keyJson as Record<string, unknown> | null;
    if (!key || Array.isArray(key) || Object.keys(key).length !== 1 || typeof key.id !== "string") {
      throw new RankingRebuildError("RANKING_REBUILD_VISIBILITY_INVALID");
    }
    const ids = hidden.get(row.model) ?? []; ids.push(key.id); hidden.set(row.model, ids);
  }
  return { revision: epoch.revision.toString(), hidden: model => hidden.get(model) ?? [] };
}

async function rankingParticipants(tx: Prisma.TransactionClient, challengeId: string, visibility: Visibility) {
  const rows = await tx.privateChallengeParticipant.findMany({ where: { challengeId, status: "ACTIVE",
    id: { notIn: visibility.hidden("PrivateChallengeParticipant") }, userId: { notIn: visibility.hidden("User") } },
  select: participantSelect, orderBy: { id: "asc" }, take: RANKING_REBUILD_MAX_PARTICIPANTS + 1 });
  if (rows.length > RANKING_REBUILD_MAX_PARTICIPANTS) throw new RankingRebuildError("RANKING_REBUILD_PARTICIPANT_LIMIT");
  if (rows.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "PrivateChallengeParticipant"
    WHERE id IN (${Prisma.join(rows.map(row => row.id))}) ORDER BY id FOR SHARE NOWAIT`);
  return rows;
}

async function rankingAuthorization(tx: Prisma.TransactionClient, challenge: RankingChallenge, participants: RankingParticipant[], actorId: string, visibility: Visibility) {
  const ids = [...new Set([actorId, ...participants.map(row => row.userId)])].sort();
  const accounts = await tx.$queryRaw<Array<{ id: string; status: string; authRevision: number }>>(Prisma.sql`
    SELECT id,status,"authRevision" FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE NOWAIT`);
  const [workspace] = await tx.$queryRaw<Array<{ status: string; revision: number }>>`
    SELECT status,revision FROM "ExamWorkspace" WHERE id=${challenge.workspaceId} FOR SHARE NOWAIT`;
  const memberships = await tx.$queryRaw<Array<{ id: string; userId: string; status: string; revision: number }>>(Prisma.sql`
    SELECT id,"userId",status,revision FROM "WorkspaceMembership" WHERE "workspaceId"=${challenge.workspaceId}
      AND "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR SHARE NOWAIT`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "RankingPreference" WHERE "workspaceId"=${challenge.workspaceId}
    AND "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR SHARE NOWAIT`);
  const preferences = await tx.rankingPreference.findMany({ where: { workspaceId: challenge.workspaceId, enabled: true,
    userId: { in: ids }, id: { notIn: visibility.hidden("RankingPreference") } }, select: { userId: true, revision: true, authorizedFields: true } });
  if (workspace?.status !== "ACTIVE" || accounts.find(row => row.id === actorId)?.status !== "ACTIVE"
    || memberships.find(row => row.userId === actorId)?.status !== "ACTIVE") notFound();
  const active = participants.flatMap(participant => {
    const account = accounts.find(row => row.id === participant.userId);
    const membership = memberships.find(row => row.userId === participant.userId);
    const preference = preferences.find(row => row.userId === participant.userId);
    if (account?.status !== "ACTIVE" || membership?.status !== "ACTIVE" || !preference) return [];
    const authorizedFields = intersectRankingShareFields(intersectRankingShareFields(challenge.publishedFields,
      participant.authorizedFields), preference.authorizedFields).sort();
    return [{ participant, binding: { participantId: participant.id, userId: participant.userId,
      participantRevision: participant.revision, authRevision: account.authRevision, membershipId: membership.id,
      membershipRevision: membership.revision, preferenceRevision: preference.revision, authorizedFields } }];
  });
  if (!active.some(row => row.participant.userId === actorId)) notFound();
  const bindings = active.map(row => row.binding).sort((a, b) => a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0);
  return { participants: active.map(row => row.participant), authorization: { workspaceRevision: workspace.revision,
    deletionRevision: visibility.revision, participants: bindings } };
}

async function rankingSessions(tx: Prisma.TransactionClient, challenge: RankingChallenge, participants: RankingParticipant[], hidden: string[]): Promise<RankingSourceSession[]> {
  const rows = await tx.studySession.findMany({ where: { workspaceId: challenge.workspaceId,
    userId: { in: participants.map(row => row.userId) }, id: { notIn: hidden }, status: "COMPLETED", endedAt: { not: null },
    startedAt: { gte: expandedBoundary(challenge.startDate, -2), lt: expandedBoundary(challenge.endDate, 2) } },
  // 严格白名单：不读取任务标题、笔记、复盘、情绪、附件或 AI 内容。
  select: { id: true, userId: true, startedAt: true, endedAt: true, effectiveMinutes: true, isEffective: true },
  orderBy: [{ userId: "asc" }, { id: "asc" }], take: RANKING_REBUILD_MAX_SESSIONS + 1 });
  if (rows.length > RANKING_REBUILD_MAX_SESSIONS) throw new RankingRebuildError("RANKING_REBUILD_SESSION_LIMIT");
  const versions = rows.length ? await tx.$queryRaw<Array<{ id: string; revision: string }>>(Prisma.sql`
    SELECT id,xmin::text AS revision FROM "StudySession" WHERE id IN (${Prisma.join(rows.map(row => row.id))}) ORDER BY id FOR SHARE NOWAIT`) : [];
  const revisions = new Map(versions.map(row => [row.id, row.revision]));
  return rows.map(row => {
    const rowRevision = revisions.get(row.id);
    if (!row.userId || !rowRevision) throw new RankingRebuildError("RANKING_REBUILD_SOURCE_INVALID");
    return { ...row, userId: row.userId, rowRevision };
  });
}

export function rankingHash(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`areaforge:ranking-rebuild:${domain}:v1\n${stableStringify(value)}`).digest("hex")}`;
}

export function rankingDatabaseError(error: unknown): never {
  if (error instanceof RankingRebuildError) throw error;
  if (isDataJobScopeBusy(error)) throw new RankingRebuildError("RANKING_REBUILD_SCOPE_BUSY", true);
  throw error;
}

function expandedBoundary(date: string, days: number): Date { return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000); }
function notFound(): never { throw new RankingRebuildError("RANKING_REBUILD_NOT_FOUND"); }
