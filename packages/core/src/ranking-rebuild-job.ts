import { stableStringify } from "./ai-draft";
import { hashDataExportBytes } from "./data-lifecycle";
import { RANKING_SHARE_FIELDS, type RankingShareField } from "./ranking-policy";
import type { DataJobStatus } from "./data-jobs";

export const RANKING_REBUILD_PROTOCOL = "ranking-rebuild-job-v1" as const;
export const RANKING_REBUILD_MAX_PARTICIPANTS = 100;
export const RANKING_REBUILD_MAX_SESSIONS = 10_000;

export class RankingRebuildError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); this.name = "RankingRebuildError"; }
}

export interface RankingParticipantBinding {
  participantId: string;
  userId: string;
  participantRevision: number;
  authRevision: number;
  membershipId: string;
  membershipRevision: number;
  preferenceRevision: number;
  authorizedFields: RankingShareField[];
}

export interface RankingRebuildAuthorization {
  workspaceRevision: number;
  deletionRevision: string;
  participants: RankingParticipantBinding[];
}

export interface RankingRebuildJob {
  protocol: typeof RANKING_REBUILD_PROTOCOL;
  actorUserId: string;
  workspaceId: string;
  challengeId: string;
  challengeRevision: number;
  generation: number;
  scoreVersion: "private-challenge-v1";
  rulesVersion: number;
  dataCutoff: string;
  ruleFingerprint: string;
  sourceFingerprint: string;
  authorization: RankingRebuildAuthorization;
}

export interface RankingRebuildJobView {
  id: string;
  status: DataJobStatus;
  revision: number;
  progress: number;
  attempt: number;
  maxAttempts: number;
  errorCode: string | null;
  retryable: boolean;
  pauseRequested: boolean;
  deadLettered: boolean;
  nextAttemptAt: string | null;
  createdAt: string;
  expiresAt: string;
  dataCutoff: string;
  controls: Array<"PAUSE" | "RESUME" | "CANCEL" | "REPLAY">;
}

export function rankingRebuildQueueEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return ["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "RANKING_ENABLED", "RANKING_PROJECTION_ENABLED",
    "RANKING_REBUILD_QUEUE_ENABLED", "DATA_JOB_WORKER_ENABLED"].every(key => env[key] === "true");
}

export function parseRankingRebuildJob(value: unknown): RankingRebuildJob {
  const row = exact(value, ["protocol", "actorUserId", "workspaceId", "challengeId", "challengeRevision", "generation", "scoreVersion",
    "rulesVersion", "dataCutoff", "ruleFingerprint", "sourceFingerprint", "authorization"]);
  if (row.protocol !== RANKING_REBUILD_PROTOCOL || row.scoreVersion !== "private-challenge-v1") invalid();
  const authorization = parseAuthorization(row.authorization);
  const actorUserId = rankingIdentifier(row.actorUserId);
  if (!authorization.participants.some(participant => participant.userId === actorUserId)) invalid();
  return {
    protocol: RANKING_REBUILD_PROTOCOL, actorUserId, workspaceId: rankingIdentifier(row.workspaceId),
    challengeId: rankingIdentifier(row.challengeId), challengeRevision: rankingRevision(row.challengeRevision), generation: rankingRevision(row.generation),
    scoreVersion: "private-challenge-v1", rulesVersion: rankingRevision(row.rulesVersion), dataCutoff: timestamp(row.dataCutoff),
    ruleFingerprint: fingerprint(row.ruleFingerprint), sourceFingerprint: fingerprint(row.sourceFingerprint), authorization,
  };
}

export function rankingRebuildJobFingerprint(value: unknown): string {
  const text = `areaforge:ranking-rebuild-job:v1\n${stableStringify(parseRankingRebuildJob(value))}`;
  return hashDataExportBytes(Uint8Array.from([...text].map(character => character.charCodeAt(0))));
}

export function rankingIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) invalid();
  return value;
}

export function rankingRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid();
  return value;
}

function parseAuthorization(value: unknown): RankingRebuildAuthorization {
  const row = exact(value, ["workspaceRevision", "deletionRevision", "participants"]);
  if (typeof row.deletionRevision !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(row.deletionRevision)
    || !Array.isArray(row.participants) || !row.participants.length || row.participants.length > RANKING_REBUILD_MAX_PARTICIPANTS) invalid();
  const participants = row.participants.map(parseParticipant);
  if (new Set(participants.map(item => item.participantId)).size !== participants.length
    || new Set(participants.map(item => item.userId)).size !== participants.length) invalid();
  participants.sort((a, b) => a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0);
  return { workspaceRevision: rankingRevision(row.workspaceRevision), deletionRevision: row.deletionRevision, participants };
}

function parseParticipant(value: unknown): RankingParticipantBinding {
  const row = exact(value, ["participantId", "userId", "participantRevision", "authRevision", "membershipId",
    "membershipRevision", "preferenceRevision", "authorizedFields"]);
  if (!Array.isArray(row.authorizedFields) || !row.authorizedFields.includes("score")
    || row.authorizedFields.some(field => !RANKING_SHARE_FIELDS.includes(field))
    || new Set(row.authorizedFields).size !== row.authorizedFields.length) invalid();
  return {
    participantId: rankingIdentifier(row.participantId), userId: rankingIdentifier(row.userId),
    participantRevision: rankingRevision(row.participantRevision), authRevision: rankingRevision(row.authRevision),
    membershipId: rankingIdentifier(row.membershipId), membershipRevision: rankingRevision(row.membershipRevision),
    preferenceRevision: rankingRevision(row.preferenceRevision), authorizedFields: [...row.authorizedFields].sort(),
  };
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const row = value as Record<string, unknown>;
  if (Reflect.ownKeys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) invalid();
  return row;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
function fingerprint(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}
function invalid(): never { throw new RankingRebuildError("RANKING_REBUILD_PAYLOAD_INVALID"); }
