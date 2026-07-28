export const QUICK_REVIEW_CLAIM_TTL_MS = 12_000;
export const QUICK_REVIEW_COMMAND_TTL_MS = 10_000;

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,240}$/;

export type QuickReviewActivityCommand = "suspend" | "discard";

export interface QuickReviewActivityIdentity {
  userId: string;
  scheduleId: string;
  draftId: string;
  ownerPageId: string;
  leaseId: string;
}

export interface QuickReviewActivityClaim extends QuickReviewActivityIdentity {
  version: 3;
  phase: "running" | "releasing";
  href: string;
  startedAt: number;
  heartbeatAt: number;
  commandId: string | null;
  commandAction: QuickReviewActivityCommand | null;
}

export interface QuickReviewCommandMessage extends QuickReviewActivityIdentity {
  version: 3;
  type: "command";
  commandId: string;
  action: QuickReviewActivityCommand;
  createdAt: number;
}

export interface QuickReviewCommandReceipt extends QuickReviewActivityIdentity {
  version: 3;
  type: "receipt";
  commandId: string;
  action: QuickReviewActivityCommand;
  status: "applied";
  draftRevision: number | null;
  createdAt: number;
}

export function quickReviewClaimHref(scheduleId: string): string {
  return `/quick-review/${encodeURIComponent(scheduleId)}`;
}

export function createQuickReviewActivityClaim(input: QuickReviewActivityIdentity & {
  now: number;
}): QuickReviewActivityClaim {
  return {
    version: 3,
    phase: "running",
    userId: input.userId,
    scheduleId: input.scheduleId,
    draftId: input.draftId,
    ownerPageId: input.ownerPageId,
    leaseId: input.leaseId,
    href: quickReviewClaimHref(input.scheduleId),
    startedAt: input.now,
    heartbeatAt: input.now,
    commandId: null,
    commandAction: null,
  };
}

export function parseQuickReviewActivityClaim(
  value: unknown,
  expectedUserId: string,
  now: number,
  options: { allowExpired?: boolean } = {},
): QuickReviewActivityClaim | null {
  if (!value || typeof value !== "object") return null;
  const claim = value as Partial<QuickReviewActivityClaim>;
  if (claim.version !== 3 || (claim.phase !== "running" && claim.phase !== "releasing")) return null;
  if (!isId(claim.userId) || claim.userId !== expectedUserId) return null;
  if (!isId(claim.scheduleId) || !isId(claim.draftId) || !isId(claim.ownerPageId) || !isId(claim.leaseId)) return null;
  if (claim.href !== quickReviewClaimHref(claim.scheduleId)) return null;
  if (!isTimestamp(claim.startedAt, now) || !isTimestamp(claim.heartbeatAt, now)) return null;
  if (claim.startedAt > claim.heartbeatAt) return null;
  if (!options.allowExpired && now - claim.heartbeatAt > QUICK_REVIEW_CLAIM_TTL_MS) return null;
  if (claim.phase === "running" && (claim.commandId !== null || claim.commandAction !== null)) return null;
  if (claim.phase === "releasing" && (!isId(claim.commandId) || !isCommand(claim.commandAction))) return null;
  return claim as QuickReviewActivityClaim;
}

export function markQuickReviewActivityReleasing(
  value: unknown,
  identity: QuickReviewActivityIdentity,
  commandId: string,
  action: QuickReviewActivityCommand,
  now: number,
): QuickReviewActivityClaim | null {
  if (!isId(commandId)) return null;
  const claim = parseQuickReviewActivityClaim(value, identity.userId, now, { allowExpired: true });
  if (!claim || claim.phase !== "running" || !quickReviewActivityIdentityMatches(claim, identity)) return null;
  return { ...claim, phase: "releasing", commandId, commandAction: action, heartbeatAt: now };
}

export function renewOwnedQuickReviewActivityClaim(
  value: unknown,
  identity: QuickReviewActivityIdentity,
  now: number,
): QuickReviewActivityClaim | null {
  const claim = parseQuickReviewActivityClaim(value, identity.userId, now, { allowExpired: true });
  if (!claim || !quickReviewActivityIdentityMatches(claim, identity)) return null;
  return { ...claim, heartbeatAt: now };
}

export function quickReviewActivityIdentityMatches(
  left: QuickReviewActivityIdentity,
  right: QuickReviewActivityIdentity,
): boolean {
  return left.userId === right.userId
    && left.scheduleId === right.scheduleId
    && left.draftId === right.draftId
    && left.ownerPageId === right.ownerPageId
    && left.leaseId === right.leaseId;
}

export function createQuickReviewCommand(input: {
  commandId: string;
  claim: QuickReviewActivityClaim;
  action: QuickReviewActivityCommand;
  now: number;
}): QuickReviewCommandMessage {
  return {
    version: 3,
    type: "command",
    commandId: input.commandId,
    userId: input.claim.userId,
    scheduleId: input.claim.scheduleId,
    draftId: input.claim.draftId,
    ownerPageId: input.claim.ownerPageId,
    leaseId: input.claim.leaseId,
    action: input.action,
    createdAt: input.now,
  };
}

export function parseQuickReviewCommand(
  value: unknown,
  expectedUserId: string,
  now: number,
): QuickReviewCommandMessage | null {
  if (!isMessageBase(value, "command", expectedUserId, now)) return null;
  const message = value as Partial<QuickReviewCommandMessage>;
  if (!isId(message.commandId) || !isCommand(message.action)) return null;
  return message as QuickReviewCommandMessage;
}

export function createQuickReviewCommandReceipt(
  command: QuickReviewCommandMessage,
  draftRevision: number | null,
  now: number,
): QuickReviewCommandReceipt {
  return {
    version: 3,
    type: "receipt",
    commandId: command.commandId,
    userId: command.userId,
    scheduleId: command.scheduleId,
    draftId: command.draftId,
    ownerPageId: command.ownerPageId,
    leaseId: command.leaseId,
    action: command.action,
    status: "applied",
    draftRevision,
    createdAt: now,
  };
}

export function parseQuickReviewCommandReceipt(
  value: unknown,
  expectedUserId: string,
  now: number,
): QuickReviewCommandReceipt | null {
  if (!isMessageBase(value, "receipt", expectedUserId, now)) return null;
  const message = value as Partial<QuickReviewCommandReceipt>;
  if (!isId(message.commandId) || !isCommand(message.action) || message.status !== "applied") return null;
  if (message.draftRevision !== null && !isPositiveInteger(message.draftRevision)) return null;
  return message as QuickReviewCommandReceipt;
}

export function quickReviewCommandReceiptMatches(
  command: QuickReviewCommandMessage,
  receipt: QuickReviewCommandReceipt,
): boolean {
  return receipt.commandId === command.commandId
    && receipt.action === command.action
    && quickReviewActivityIdentityMatches(command, receipt);
}

function isMessageBase(
  value: unknown,
  type: "command" | "receipt",
  expectedUserId: string,
  now: number,
): boolean {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<QuickReviewCommandMessage | QuickReviewCommandReceipt>;
  return message.version === 3
    && message.type === type
    && isId(message.userId)
    && message.userId === expectedUserId
    && isId(message.scheduleId)
    && isId(message.draftId)
    && isId(message.ownerPageId)
    && isId(message.leaseId)
    && isTimestamp(message.createdAt, now)
    && now - message.createdAt <= QUICK_REVIEW_COMMAND_TTL_MS;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isTimestamp(value: unknown, now: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= now + MAX_FUTURE_SKEW_MS;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCommand(value: unknown): value is QuickReviewActivityCommand {
  return value === "suspend" || value === "discard";
}
