/** v1.9 platform-hardening primitives. Pure rules only: no clock, storage, DB or network access. */

export type QueueJobStatus = "QUEUED" | "RUNNING" | "RETRY_WAIT" | "DEAD_LETTER" | "SUCCEEDED" | "CANCELLED";

export interface QueueRetryPolicy {
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
}

export interface QueueRetryDecision {
  status: QueueJobStatus;
  attempt: number;
  nextAttemptAt: string | null;
  delaySeconds: number;
  reason: "RETRY_SCHEDULED" | "NON_RETRYABLE" | "ATTEMPT_LIMIT_REACHED";
}

export interface WorkspaceQuota {
  maxActiveJobs: number;
  maxDailyExports: number;
  maxMembers: number;
  maxStorageBytes: number;
}

export interface WorkspaceUsage {
  activeJobs: number;
  dailyExports: number;
  members: number;
  storageBytes: number;
}

export type WorkspaceQuotaResource = keyof WorkspaceUsage;

export interface WorkspaceQuotaDecision {
  allowed: boolean;
  violations: Array<{ resource: WorkspaceQuotaResource; current: number; requested: number; limit: number }>;
}

export interface FixedWindowRateLimitState {
  windowStartedAt: number;
  count: number;
}

export interface FixedWindowRateLimitDecision {
  accepted: boolean;
  state: FixedWindowRateLimitState;
  retryAfterSeconds: number;
}

export type CapacityState = "HEALTHY" | "WARNING" | "BLOCKED";

export interface CapacityDecision {
  state: CapacityState;
  storageRatio: number;
  queueRatio: number;
  reasons: Array<"STORAGE_THRESHOLD" | "QUEUE_THRESHOLD" | "INVALID_USAGE">;
}

export interface AuditSearchQuery {
  workspaceId: string | null;
  actorId: string | null;
  actionPrefix: string | null;
  from: string | null;
  to: string | null;
  limit: number;
}

export interface WorkspaceSearchCandidate {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  visibility: "OWNER" | "SHARED" | "WORKSPACE";
  sharedWithUserIds?: readonly string[];
}

export function decideQueueRetry(input: {
  attempt: number;
  retryable: boolean;
  errorCode: string;
  now: string;
  policy?: QueueRetryPolicy;
}): QueueRetryDecision {
  const policy = input.policy ?? { maxAttempts: 5, baseDelaySeconds: 30, maxDelaySeconds: 3600 };
  validatePositiveInt(policy.maxAttempts, "maxAttempts");
  validatePositiveInt(policy.baseDelaySeconds, "baseDelaySeconds");
  validatePositiveInt(policy.maxDelaySeconds, "maxDelaySeconds");
  if (policy.maxDelaySeconds < policy.baseDelaySeconds) throw new TypeError("maxDelaySeconds must be >= baseDelaySeconds");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) throw new TypeError("attempt must be a non-negative integer");
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new TypeError("queue retry timestamp is invalid");
  const errorCode = input.errorCode.trim();
  if (!/^[A-Z0-9_.:-]{1,80}$/.test(errorCode)) throw new TypeError("queue errorCode is invalid");
  const nextAttempt = input.attempt + 1;
  if (!input.retryable) return { status: "DEAD_LETTER", attempt: nextAttempt, nextAttemptAt: null, delaySeconds: 0, reason: "NON_RETRYABLE" };
  if (nextAttempt > policy.maxAttempts) return { status: "DEAD_LETTER", attempt: nextAttempt, nextAttemptAt: null, delaySeconds: 0, reason: "ATTEMPT_LIMIT_REACHED" };
  const delaySeconds = Math.min(policy.maxDelaySeconds, policy.baseDelaySeconds * 2 ** Math.max(0, nextAttempt - 1));
  return { status: "RETRY_WAIT", attempt: nextAttempt, nextAttemptAt: new Date(now + delaySeconds * 1000).toISOString(), delaySeconds, reason: "RETRY_SCHEDULED" };
}

export function evaluateWorkspaceQuota(input: { usage: WorkspaceUsage; requested: Partial<WorkspaceUsage>; quota: WorkspaceQuota }): WorkspaceQuotaDecision {
  const limits: Record<WorkspaceQuotaResource, number> = {
    activeJobs: input.quota.maxActiveJobs,
    dailyExports: input.quota.maxDailyExports,
    members: input.quota.maxMembers,
    storageBytes: input.quota.maxStorageBytes,
  };
  const violations: WorkspaceQuotaDecision["violations"] = [];
  for (const resource of Object.keys(limits) as WorkspaceQuotaResource[]) {
    const current = input.usage[resource];
    const requested = input.requested[resource] ?? 0;
    const limit = limits[resource];
    if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(requested) || requested < 0 || !Number.isSafeInteger(limit) || limit < 0) {
      violations.push({ resource, current, requested, limit });
    } else if (current + requested > limit) {
      violations.push({ resource, current, requested, limit });
    }
  }
  return { allowed: violations.length === 0, violations };
}

export function consumeFixedWindowRateLimit(input: { state: FixedWindowRateLimitState; nowMs: number; maxRequests: number; windowMs: number }): FixedWindowRateLimitDecision {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0 || !Number.isSafeInteger(input.maxRequests) || input.maxRequests < 1 || !Number.isSafeInteger(input.windowMs) || input.windowMs < 1) throw new TypeError("rate-limit values are invalid");
  if (!Number.isSafeInteger(input.state.windowStartedAt) || input.state.windowStartedAt < 0 || !Number.isSafeInteger(input.state.count) || input.state.count < 0) throw new TypeError("rate-limit state is invalid");
  if (input.nowMs < input.state.windowStartedAt) throw new TypeError("rate-limit clock moved backwards");
  const windowStartedAt = input.nowMs - input.state.windowStartedAt >= input.windowMs ? input.nowMs : input.state.windowStartedAt;
  const count = windowStartedAt === input.state.windowStartedAt ? input.state.count : 0;
  if (count >= input.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStartedAt + input.windowMs - input.nowMs) / 1000));
    return { accepted: false, state: { windowStartedAt, count }, retryAfterSeconds };
  }
  return { accepted: true, state: { windowStartedAt, count: count + 1 }, retryAfterSeconds: 0 };
}

export function evaluateCapacity(input: { storageBytes: number; storageLimitBytes: number; activeJobs: number; activeJobLimit: number; warningRatio?: number }): CapacityDecision {
  const warningRatio = input.warningRatio ?? 0.8;
  const valid = [input.storageBytes, input.storageLimitBytes, input.activeJobs, input.activeJobLimit, warningRatio].every(Number.isFinite)
    && input.storageBytes >= 0 && input.storageLimitBytes > 0 && input.activeJobs >= 0 && input.activeJobLimit > 0 && warningRatio > 0 && warningRatio < 1;
  if (!valid) return { state: "BLOCKED", storageRatio: 1, queueRatio: 1, reasons: ["INVALID_USAGE"] };
  const storageRatio = input.storageBytes / input.storageLimitBytes;
  const queueRatio = input.activeJobs / input.activeJobLimit;
  const reasons: CapacityDecision["reasons"] = [];
  if (storageRatio >= 1 || storageRatio >= warningRatio) reasons.push("STORAGE_THRESHOLD");
  if (queueRatio >= 1 || queueRatio >= warningRatio) reasons.push("QUEUE_THRESHOLD");
  return { state: storageRatio >= 1 || queueRatio >= 1 ? "BLOCKED" : reasons.length > 0 ? "WARNING" : "HEALTHY", storageRatio, queueRatio, reasons };
}

export function normalizeAuditSearchQuery(input: Partial<AuditSearchQuery>): AuditSearchQuery {
  const workspaceId = input.workspaceId == null ? null : opaque(input.workspaceId, "workspaceId");
  const actorId = input.actorId == null ? null : opaque(input.actorId, "actorId");
  const actionPrefix = input.actionPrefix == null ? null : input.actionPrefix.trim().toUpperCase();
  if (actionPrefix !== null && !/^[A-Z0-9_.:-]{1,80}$/.test(actionPrefix)) throw new TypeError("audit actionPrefix is invalid");
  const from = normalizeOptionalTime(input.from, "from");
  const to = normalizeOptionalTime(input.to, "to");
  if (from && to && Date.parse(from) >= Date.parse(to)) throw new TypeError("audit time range is invalid");
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError("audit limit is invalid");
  return { workspaceId, actorId, actionPrefix, from, to, limit };
}

/** Search visibility is evaluated before returning a candidate; private fields never enter this rule. */
export function filterWorkspaceSearchCandidates(input: { actorId: string; workspaceId: string; activeWorkspaceIds: readonly string[]; candidates: readonly WorkspaceSearchCandidate[] }): WorkspaceSearchCandidate[] {
  const actorId = opaque(input.actorId, "actorId");
  const workspaceId = opaque(input.workspaceId, "workspaceId");
  const memberships = new Set(input.activeWorkspaceIds.map((id) => opaque(id, "activeWorkspaceId")));
  if (!memberships.has(workspaceId)) return [];
  return input.candidates.filter((candidate) => {
    opaque(candidate.id, "candidate id");
    const candidateWorkspaceId = opaque(candidate.workspaceId, "candidate workspaceId");
    const candidateOwnerUserId = opaque(candidate.ownerUserId, "candidate ownerUserId");
    const sharedWithUserIds = new Set((candidate.sharedWithUserIds ?? []).map((id) => opaque(id, "candidate sharedWithUserId")));
    if (candidateWorkspaceId !== workspaceId) return false;
    if (candidate.visibility === "OWNER") return candidateOwnerUserId === actorId;
    if (candidate.visibility === "SHARED") return candidateOwnerUserId === actorId || sharedWithUserIds.has(actorId);
    return candidate.visibility === "WORKSPACE";
  });
}

function validatePositiveInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
}

function normalizeOptionalTime(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`audit ${label} is invalid`);
  return new Date(time).toISOString();
}

function opaque(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) throw new TypeError(`${label} must be an opaque identifier`);
  return normalized;
}
