export const dataJobKinds = ["EXPORT", "DELETE", "RANKING_REBUILD", "NOTIFICATION"] as const;
export type DataJobKind = typeof dataJobKinds[number];

export const dataJobStatuses = [
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "CANCEL_REQUESTED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type DataJobStatus = typeof dataJobStatuses[number];

export interface DataJobState {
  status: DataJobStatus;
  attempt: number;
  progress: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  retryable: boolean;
}

export type DataJobCommand =
  | { type: "CLAIM"; workerId: string; now: string; leaseExpiresAt: string }
  | { type: "HEARTBEAT"; workerId: string; now: string; leaseExpiresAt: string; progress: number }
  | { type: "PAUSE"; workerId: string; now: string }
  | { type: "RESUME"; now?: string }
  | { type: "REQUEST_CANCEL"; now?: string }
  | { type: "CANCEL"; workerId: string; now: string }
  | { type: "SUCCEED"; workerId: string; now: string }
  | { type: "FAIL"; workerId: string; errorCode: string; retryable: boolean; now: string }
  | { type: "EXPIRE"; now: string };

export type DataJobTransitionError =
  | "INVALID_STATUS"
  | "LEASE_REQUIRED"
  | "LEASE_OWNER_MISMATCH"
  | "LEASE_EXPIRED"
  | "INVALID_PROGRESS"
  | "RETRY_NOT_ALLOWED";

export interface DataJobTransitionResult {
  state: DataJobState;
  error: DataJobTransitionError | null;
}

export function createQueuedDataJobState(): DataJobState {
  return {
    status: "QUEUED",
    attempt: 0,
    progress: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    retryable: false,
  };
}

export function transitionDataJob(state: DataJobState, command: DataJobCommand): DataJobTransitionResult {
  const fail = (error: DataJobTransitionError): DataJobTransitionResult => ({ state, error });
  const nowValue = "now" in command ? command.now : undefined;
  const nowMs = nowValue === undefined ? null : Date.parse(nowValue);

  if (command.type === "CLAIM") {
    if (state.status !== "QUEUED" && state.status !== "FAILED" && state.status !== "EXPIRED") return fail("INVALID_STATUS");
    if (state.status === "FAILED" && !state.retryable) return fail("RETRY_NOT_ALLOWED");
    const leaseMs = Date.parse(command.leaseExpiresAt);
    if (nowMs === null || !Number.isFinite(nowMs) || !Number.isFinite(leaseMs) || leaseMs <= nowMs) return fail("LEASE_EXPIRED");
    return {
      error: null,
      state: {
        ...state,
        status: "RUNNING",
        attempt: state.attempt + 1,
        leaseOwner: command.workerId,
        leaseExpiresAt: command.leaseExpiresAt,
        lastErrorCode: null,
        retryable: false,
      },
    };
  }

  if (command.type === "REQUEST_CANCEL") {
    if (state.status !== "QUEUED" && state.status !== "RUNNING" && state.status !== "PAUSED") return fail("INVALID_STATUS");
    return { error: null, state: { ...state, status: state.status === "QUEUED" ? "CANCELLED" : "CANCEL_REQUESTED" } };
  }

  if (command.type === "RESUME") {
    if (state.status !== "PAUSED") return fail("INVALID_STATUS");
    return { error: null, state: { ...state, status: "QUEUED", leaseOwner: null, leaseExpiresAt: null } };
  }

  if (command.type === "EXPIRE") {
    if (state.status !== "RUNNING" || !state.leaseExpiresAt) return fail("INVALID_STATUS");
    if (nowMs === null || !Number.isFinite(nowMs) || Date.parse(state.leaseExpiresAt) > nowMs) return fail("LEASE_EXPIRED");
    return { error: null, state: { ...state, status: "EXPIRED", leaseOwner: null, leaseExpiresAt: null, lastErrorCode: "LEASE_EXPIRED", retryable: true } };
  }

  const worker = command.workerId;
  if (state.status !== "RUNNING" && !(command.type === "CANCEL" && state.status === "CANCEL_REQUESTED")) return fail("INVALID_STATUS");
  if (!state.leaseOwner || state.leaseOwner !== worker) return fail("LEASE_OWNER_MISMATCH");
  if (nowMs === null || !Number.isFinite(nowMs) || !state.leaseExpiresAt || Date.parse(state.leaseExpiresAt) <= nowMs) return fail("LEASE_EXPIRED");

  if (command.type === "HEARTBEAT") {
    if (command.progress < 0 || command.progress > 1 || !Number.isFinite(command.progress)) return fail("INVALID_PROGRESS");
    const leaseMs = Date.parse(command.leaseExpiresAt);
    if (nowMs === null || !Number.isFinite(nowMs) || !Number.isFinite(leaseMs) || leaseMs <= nowMs) return fail("LEASE_EXPIRED");
    return { error: null, state: { ...state, progress: command.progress, leaseExpiresAt: command.leaseExpiresAt } };
  }
  if (command.type === "PAUSE") return { error: null, state: { ...state, status: "PAUSED", leaseOwner: null, leaseExpiresAt: null } };
  if (command.type === "CANCEL") return { error: null, state: { ...state, status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null } };
  if (command.type === "SUCCEED") return { error: null, state: { ...state, status: "SUCCEEDED", progress: 1, leaseOwner: null, leaseExpiresAt: null } };
  if (command.type === "FAIL") {
    return {
      error: null,
      state: {
        ...state,
        status: command.retryable ? "FAILED" : "FAILED",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: command.errorCode,
        retryable: command.retryable,
      },
    };
  }
  return fail("INVALID_STATUS");
}
