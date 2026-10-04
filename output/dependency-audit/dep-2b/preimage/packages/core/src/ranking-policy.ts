/**
 * v1.8 排名平台的无副作用策略。
 *
 * 这里集中维护状态机、字段白名单和退出/删除前置条件。Web 层只负责
 * 认证、持久化和把策略错误映射成 API 错误；任何调用方都不能通过传入
 * 额外字段或绕过状态转换来改变排名语义。
 */

export const RANKING_SHARE_FIELDS = [
  "score",
  "effective_minutes",
  "active_days",
  "minimum_action_days",
  "anomaly_count",
] as const;

export type RankingShareField = (typeof RANKING_SHARE_FIELDS)[number];

export const DEFAULT_RANKING_SHARE_FIELDS = ["score"] as const satisfies readonly RankingShareField[];

export type PrivateChallengeStatus = "DRAFT" | "ACTIVE" | "ENDED" | "CLOSED" | "DISSOLVED";
export type PrivateChallengeAction = "start" | "end" | "close" | "dissolve";
export type PrivateChallengeParticipantStatus = "INVITED" | "ACTIVE" | "LEFT" | "REMOVED";
export type PrivateChallengeParticipantAction = "join" | "leave" | "remove" | "reinvite";
export type RankingAppealStatus = "OPEN" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
export type RankingAppealAction = "review" | "accept" | "reject" | "withdraw";

export type RankingPolicyErrorCode =
  | "RANKING_FIELD_NOT_ALLOWED"
  | "RANKING_FIELD_DUPLICATE"
  | "RANKING_SCORE_FIELD_REQUIRED"
  | "RANKING_STATUS_TRANSITION_INVALID"
  | "RANKING_RULES_FROZEN"
  | "RANKING_PARTICIPANT_TRANSITION_INVALID"
  | "RANKING_OWNER_EXIT_REQUIRES_TRANSFER"
  | "RANKING_DELETION_BLOCKED"
  | "RANKING_DELETION_CONTRACT_MISMATCH"
  | "RANKING_APPEAL_STATUS_TRANSITION_INVALID"
  | "RANKING_APPEAL_REASON_INVALID"
  | "RANKING_APPEAL_ALREADY_OPEN";

export class RankingPolicyError extends Error {
  readonly code: RankingPolicyErrorCode;

  constructor(code: RankingPolicyErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "RankingPolicyError";
    this.code = code;
  }
}

const allowedFieldSet = new Set<string>(RANKING_SHARE_FIELDS);

/** Normalize a field list and reject unknown/sensitive fields instead of silently dropping them. */
export function normalizeRankingShareFields(
  fields: readonly string[] | null | undefined,
  options: { requireScore?: boolean } = {},
): RankingShareField[] {
  const normalized = [...new Set((fields ?? DEFAULT_RANKING_SHARE_FIELDS).map((field) =>
    typeof field === "string" ? field.trim() : ""))];
  for (const field of normalized) {
    if (!allowedFieldSet.has(field)) {
      throw new RankingPolicyError("RANKING_FIELD_NOT_ALLOWED", `field ${field || "<empty>"} is not shareable`);
    }
  }
  if ((fields ?? DEFAULT_RANKING_SHARE_FIELDS).length !== normalized.length) {
    throw new RankingPolicyError("RANKING_FIELD_DUPLICATE", "share fields must be unique and non-empty");
  }
  if (options.requireScore !== false && !normalized.includes("score")) {
    throw new RankingPolicyError("RANKING_SCORE_FIELD_REQUIRED", "score must remain visible for a ranking projection");
  }
  return normalized as RankingShareField[];
}

/** Participant fields can only narrow the challenge's published field set. */
export function intersectRankingShareFields(
  challengeFields: readonly string[],
  participantFields: readonly string[] | null | undefined,
): RankingShareField[] {
  const challenge = normalizeRankingShareFields(challengeFields);
  const participant = normalizeRankingShareFields(participantFields ?? challenge);
  const challengeSet = new Set(challenge);
  return participant.filter((field) => challengeSet.has(field));
}

export function transitionPrivateChallengeStatus(
  status: PrivateChallengeStatus,
  action: PrivateChallengeAction,
): PrivateChallengeStatus {
  const next: Partial<Record<PrivateChallengeStatus, Partial<Record<PrivateChallengeAction, PrivateChallengeStatus>>>> = {
    DRAFT: { start: "ACTIVE", dissolve: "DISSOLVED" },
    ACTIVE: { end: "ENDED", dissolve: "DISSOLVED" },
    ENDED: { close: "CLOSED", dissolve: "DISSOLVED" },
    CLOSED: { dissolve: "DISSOLVED" },
    DISSOLVED: {},
  };
  const result = next[status]?.[action];
  if (!result) {
    throw new RankingPolicyError(
      "RANKING_STATUS_TRANSITION_INVALID",
      `cannot ${action} challenge in ${status} status`,
    );
  }
  return result;
}

export function assertChallengeRulesMutable(status: PrivateChallengeStatus): void {
  if (status !== "DRAFT") {
    throw new RankingPolicyError(
      "RANKING_RULES_FROZEN",
      "计分窗口、时区、目标和分享字段在挑战开始后不可静默改写",
    );
  }
}

export function transitionPrivateChallengeParticipant(
  status: PrivateChallengeParticipantStatus,
  action: PrivateChallengeParticipantAction,
): PrivateChallengeParticipantStatus {
  const next: Partial<Record<PrivateChallengeParticipantStatus, Partial<Record<PrivateChallengeParticipantAction, PrivateChallengeParticipantStatus>>>> = {
    INVITED: { join: "ACTIVE", remove: "REMOVED", reinvite: "INVITED" },
    ACTIVE: { leave: "LEFT", remove: "REMOVED", reinvite: "INVITED" },
    LEFT: { reinvite: "INVITED", remove: "REMOVED" },
    REMOVED: { reinvite: "INVITED", remove: "REMOVED" },
  };
  const result = next[status]?.[action];
  if (!result) {
    throw new RankingPolicyError(
      "RANKING_PARTICIPANT_TRANSITION_INVALID",
      `cannot ${action} participant in ${status} status`,
    );
  }
  return result;
}

export function assertParticipantCanLeave(input: {
  isOwner: boolean;
  activeChallengeCount: number;
}): void {
  if (input.isOwner && input.activeChallengeCount > 0) {
    throw new RankingPolicyError(
      "RANKING_OWNER_EXIT_REQUIRES_TRANSFER",
      "challenge owner must transfer ownership or dissolve active challenges before leaving",
    );
  }
}

/**
 * 排名申诉状态机。OPEN/UNDER_REVIEW 之外的状态均为终态，任何未知状态
 * 或动作都 fail closed，避免通过手写 API payload 绕过人工复核链。
 */
export function transitionRankingAppealStatus(
  status: RankingAppealStatus,
  action: RankingAppealAction,
): RankingAppealStatus {
  const next: Partial<Record<RankingAppealStatus, Partial<Record<RankingAppealAction, RankingAppealStatus>>>> = {
    OPEN: { review: "UNDER_REVIEW", withdraw: "WITHDRAWN" },
    UNDER_REVIEW: { accept: "ACCEPTED", reject: "REJECTED", withdraw: "WITHDRAWN" },
    ACCEPTED: {},
    REJECTED: {},
    WITHDRAWN: {},
  };
  const result = next[status]?.[action];
  if (!result) {
    throw new RankingPolicyError(
      "RANKING_APPEAL_STATUS_TRANSITION_INVALID",
      `cannot ${action} appeal in ${status} status`,
    );
  }
  return result;
}

export function validateRankingAppealReason(reason: string): string {
  const normalized = typeof reason === "string" ? reason.trim() : "";
  if (!normalized || normalized.length > 500) {
    throw new RankingPolicyError(
      "RANKING_APPEAL_REASON_INVALID",
      "appeal reason must contain 1-500 non-whitespace characters",
    );
  }
  return normalized;
}

export interface RankingDeletionPlanInput {
  ownedNonDissolvedChallengeIds: readonly string[];
  ownedDissolvedChallengeIds: readonly string[];
  participationIds: readonly string[];
  rankingProjectionIds?: readonly string[];
  expectedFingerprint: string;
  actualFingerprint: string;
}

export interface RankingDeletionPlan {
  allowed: boolean;
  ownedDissolvedChallengeIds: string[];
  participationIds: string[];
  reason: "ready" | "owned_challenges_require_transfer_or_dissolve";
}

/**
 * Account deletion must not guess about ranking ownership. The caller supplies
 * a read fingerprint and the deletion worker rechecks it immediately before
 * mutating rows; any drift fails closed.
 */
export function buildRankingDeletionPlan(input: RankingDeletionPlanInput): RankingDeletionPlan {
  if (input.expectedFingerprint !== input.actualFingerprint) {
    throw new RankingPolicyError(
      "RANKING_DELETION_CONTRACT_MISMATCH",
      "ranking deletion preimage changed; refresh the plan before mutating",
    );
  }
  if (input.ownedNonDissolvedChallengeIds.length > 0) {
    throw new RankingPolicyError(
      "RANKING_DELETION_BLOCKED",
      "owned non-dissolved challenges require transfer or dissolution",
    );
  }
  if ((input.rankingProjectionIds?.length ?? 0) > 0) {
    throw new RankingPolicyError(
      "RANKING_DELETION_BLOCKED",
      "ranking projections require cleanup before deletion can proceed",
    );
  }
  return {
    allowed: true,
    ownedDissolvedChallengeIds: [...input.ownedDissolvedChallengeIds],
    participationIds: [...input.participationIds],
    reason: "ready",
  };
}

export function isRankingShareField(value: unknown): value is RankingShareField {
  return typeof value === "string" && allowedFieldSet.has(value);
}
