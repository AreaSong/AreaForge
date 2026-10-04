import { hashDataExportBytes } from "./data-lifecycle";
import { stableStringify } from "./ai-draft";
import { USER_NOTIFICATION_KINDS, type UserNotificationKind } from "./user-notification";

export type RankingNotificationSource = "PRIVATE_CHALLENGE" | "PRIVATE_CHALLENGE_PARTICIPANT" | "RANKING_APPEAL";
const sources: Record<UserNotificationKind, RankingNotificationSource> = {
  RANKING_INVITATION: "PRIVATE_CHALLENGE_PARTICIPANT", RANKING_CHALLENGE_STATUS: "PRIVATE_CHALLENGE",
  RANKING_APPEAL_SUBMITTED: "RANKING_APPEAL", RANKING_APPEAL_STATUS: "RANKING_APPEAL", RANKING_APPEAL_WITHDRAWN: "RANKING_APPEAL",
  RANKING_OWNERSHIP_TRANSFERRED: "PRIVATE_CHALLENGE", RANKING_PARTICIPANT_REMOVED: "PRIVATE_CHALLENGE_PARTICIPANT",
  RANKING_PARTICIPANT_STATUS: "PRIVATE_CHALLENGE_PARTICIPANT",
};

export interface RankingNotificationEvent {
  actorUserId: string;
  recipientUserId: string;
  workspaceId: string;
  kind: UserNotificationKind;
  sourceEntityType: RankingNotificationSource;
  sourceEntityId: string;
  eventVersion: number;
}

export interface NotificationAuthorizationBinding {
  actorAuthRevision: number;
  recipientAuthRevision: number;
  workspaceRevision: number;
  actorMembershipId: string;
  actorMembershipRevision: number;
  recipientMembershipId: string;
  recipientMembershipRevision: number;
}

export interface RankingNotificationJob {
  protocol: "ranking-notification-job-v1";
  event: RankingNotificationEvent;
  eventKey: string;
  authorization: NotificationAuthorizationBinding;
}

export class RankingNotificationError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); this.name = "RankingNotificationError"; }
}

export function parseRankingNotificationEvent(value: unknown): RankingNotificationEvent {
  const object = exactObject(value, ["actorUserId", "recipientUserId", "workspaceId", "kind", "sourceEntityType", "sourceEntityId", "eventVersion"]);
  const kind = object.kind as UserNotificationKind;
  if (!USER_NOTIFICATION_KINDS.includes(kind) || sources[kind] !== object.sourceEntityType) throw new RankingNotificationError("USER_NOTIFICATION_EVENT_INVALID");
  return {
    actorUserId: identifier(object.actorUserId), recipientUserId: identifier(object.recipientUserId), workspaceId: identifier(object.workspaceId),
    kind, sourceEntityType: sources[kind], sourceEntityId: identifier(object.sourceEntityId), eventVersion: revision(object.eventVersion),
  };
}

export function parseNotificationAuthorization(value: unknown): NotificationAuthorizationBinding {
  const object = exactObject(value, ["actorAuthRevision", "recipientAuthRevision", "workspaceRevision", "actorMembershipId", "actorMembershipRevision", "recipientMembershipId", "recipientMembershipRevision"]);
  return {
    actorAuthRevision: revision(object.actorAuthRevision), recipientAuthRevision: revision(object.recipientAuthRevision), workspaceRevision: revision(object.workspaceRevision),
    actorMembershipId: identifier(object.actorMembershipId), actorMembershipRevision: revision(object.actorMembershipRevision),
    recipientMembershipId: identifier(object.recipientMembershipId), recipientMembershipRevision: revision(object.recipientMembershipRevision),
  };
}

export function notificationEventKey(event: RankingNotificationEvent): string {
  return ["ranking", event.kind, event.sourceEntityType, event.sourceEntityId, event.eventVersion].join(":");
}

export function parseRankingNotificationJob(value: unknown): RankingNotificationJob {
  const object = exactObject(value, ["protocol", "event", "eventKey", "authorization"]);
  const event = parseRankingNotificationEvent(object.event);
  if (object.protocol !== "ranking-notification-job-v1" || object.eventKey !== notificationEventKey(event)) throw new RankingNotificationError("USER_NOTIFICATION_PAYLOAD_INVALID");
  return { protocol: "ranking-notification-job-v1", event, eventKey: notificationEventKey(event), authorization: parseNotificationAuthorization(object.authorization) };
}

/** 不使用导出脱敏 hash；绑定必须覆盖 eventKey 等每个协议字段，不能被脱敏规则省略。 */
export function notificationJobFingerprint(value: unknown): string {
  return hashAscii(`areaforge:ranking-notification-job:v1\n${stableStringify(parseRankingNotificationJob(value))}`);
}

export function notificationJobKey(event: RankingNotificationEvent): string {
  const hash = hashAscii(stableStringify({ workspaceId: event.workspaceId, recipientUserId: event.recipientUserId, eventKey: notificationEventKey(event) }));
  return `ranking-notification-${hash.slice(7)}`;
}

export function notificationQueueEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.PLATFORM_NOTIFICATIONS_ENABLED === "true" && env.PLATFORM_NOTIFICATION_QUEUE_ENABLED === "true";
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new RankingNotificationError("USER_NOTIFICATION_PAYLOAD_INVALID");
  const object = value as Record<string, unknown>;
  if (Reflect.ownKeys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) throw new RankingNotificationError("USER_NOTIFICATION_PAYLOAD_INVALID");
  return object;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new RankingNotificationError("USER_NOTIFICATION_IDENTIFIER_INVALID");
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new RankingNotificationError("USER_NOTIFICATION_REVISION_INVALID");
  return value;
}

// 协议字段及不透明 ID 被限制为 ASCII，保持 Core 不依赖环境编码 API。
function hashAscii(value: string): string {
  return hashDataExportBytes(Uint8Array.from([...value].map(character => character.charCodeAt(0))));
}
