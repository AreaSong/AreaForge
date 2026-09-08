/**
 * Pure request lifecycle for controlled operations.
 *
 * This module deliberately stops at a typed state machine. It does not execute
 * commands, read secrets, access Docker, or decide whether an actor is allowed
 * to approve a request. Persistence and actor authorization belong to the Web
 * and root-agent layers.
 */

export type ControlledOperationRequestRisk = "READ_ONLY" | "HIGH_RISK";

export type ControlledOperationRequestStatus =
  | "PREVIEWED"
  | "CONFIRMATION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "HELD"
  | "CANCEL_REQUESTED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface ControlledOperationRequestState {
  risk: ControlledOperationRequestRisk;
  requiresApproval: boolean;
  status: ControlledOperationRequestStatus;
  requestHash: string;
  expectedBeforeHash: string;
  idempotencyKey: string;
  expiresAt: string;
  attempt: number;
  workerId: string | null;
  leaseExpiresAt: string | null;
  failureCode: string | null;
  retryable: boolean;
}

export type ControlledOperationRequestCommand =
  | { type: "ACKNOWLEDGE_PREVIEW"; now: string }
  | { type: "CONFIRM"; now: string }
  | { type: "APPROVE"; now: string }
  | { type: "CLAIM"; workerId: string; now: string; leaseExpiresAt: string }
  | { type: "HEARTBEAT"; workerId: string; now: string; leaseExpiresAt: string }
  | { type: "PAUSE"; workerId: string; now: string }
  | { type: "HOLD"; now: string }
  | { type: "RESUME"; now: string }
  | { type: "REQUEST_CANCEL"; now: string }
  | { type: "CANCEL"; workerId: string; now: string }
  | { type: "SUCCEED"; workerId: string; now: string }
  | { type: "FAIL"; workerId: string; now: string; failureCode: string; retryable: boolean }
  | { type: "RETRY"; now: string }
  | { type: "EXPIRE"; now: string };

export type ControlledOperationTransitionError =
  | "INVALID_STATUS"
  | "EXPIRED"
  | "NOT_EXPIRED"
  | "LEASE_REQUIRED"
  | "LEASE_OWNER_MISMATCH"
  | "LEASE_EXPIRED"
  | "APPROVAL_REQUIRED"
  | "RETRY_NOT_ALLOWED";

export interface ControlledOperationTransitionResult {
  state: ControlledOperationRequestState;
  error: ControlledOperationTransitionError | null;
}

export function createControlledOperationRequestState(input: {
  risk: ControlledOperationRequestRisk;
  requiresApproval: boolean;
  requestHash: string;
  expectedBeforeHash: string;
  idempotencyKey: string;
  expiresAt: string;
}): ControlledOperationRequestState {
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new TypeError("expiresAt must be an ISO timestamp");
  if (input.risk === "HIGH_RISK" && !input.requiresApproval) {
    throw new TypeError("high-risk operation must require approval");
  }
  return {
    ...input,
    status: input.requiresApproval ? "CONFIRMATION_REQUIRED" : "PREVIEWED",
    attempt: 0,
    workerId: null,
    leaseExpiresAt: null,
    failureCode: null,
    retryable: false,
  };
}

export function transitionControlledOperationRequest(
  state: ControlledOperationRequestState,
  command: ControlledOperationRequestCommand,
): ControlledOperationTransitionResult {
  const fail = (error: ControlledOperationTransitionError): ControlledOperationTransitionResult => ({ state, error });
  const now = Date.parse(command.now);
  if (!Number.isFinite(now)) return fail("EXPIRED");
  if (now >= Date.parse(state.expiresAt) && !isTerminal(state.status)) {
    if (command.type !== "EXPIRE") return fail("EXPIRED");
  }

  if (command.type === "EXPIRE") {
    if (isTerminal(state.status)) return fail("INVALID_STATUS");
    if (now < Date.parse(state.expiresAt)) return fail("NOT_EXPIRED");
    return { error: null, state: clearLease({ ...state, status: "EXPIRED", failureCode: "REQUEST_EXPIRED", retryable: false }) };
  }
  if (command.type === "ACKNOWLEDGE_PREVIEW") {
    if (state.status !== "PREVIEWED" || state.requiresApproval) return fail("INVALID_STATUS");
    return { error: null, state: { ...state, status: "QUEUED" } };
  }
  if (command.type === "CONFIRM") {
    if (state.status !== "CONFIRMATION_REQUIRED") return fail("INVALID_STATUS");
    return { error: null, state: { ...state, status: state.requiresApproval ? "APPROVAL_REQUIRED" : "QUEUED" } };
  }
  if (command.type === "APPROVE") {
    if (state.status !== "APPROVAL_REQUIRED") return fail("APPROVAL_REQUIRED");
    return { error: null, state: { ...state, status: "QUEUED" } };
  }
  if (command.type === "HOLD") {
    if (state.status !== "QUEUED" && state.status !== "RUNNING" && state.status !== "PAUSED") return fail("INVALID_STATUS");
    return { error: null, state: clearLease({ ...state, status: "HELD" }) };
  }
  if (command.type === "RESUME") {
    if (state.status !== "HELD" && state.status !== "PAUSED") return fail("INVALID_STATUS");
    return { error: null, state: { ...state, status: "QUEUED" } };
  }
  if (command.type === "REQUEST_CANCEL") {
    if (isTerminal(state.status)) return fail("INVALID_STATUS");
    if (state.status === "RUNNING") return { error: null, state: { ...state, status: "CANCEL_REQUESTED" } };
    return { error: null, state: clearLease({ ...state, status: "CANCELLED" }) };
  }
  if (command.type === "RETRY") {
    if (state.status !== "FAILED" || !state.retryable) return fail("RETRY_NOT_ALLOWED");
    return { error: null, state: { ...state, status: "QUEUED", failureCode: null, retryable: false } };
  }

  if (command.type === "CLAIM") {
    if (state.status !== "QUEUED") return fail("INVALID_STATUS");
    const nextLeaseExpiry = Date.parse(command.leaseExpiresAt);
    if (!Number.isFinite(nextLeaseExpiry) || nextLeaseExpiry <= now) return fail("LEASE_EXPIRED");
    return {
      error: null,
      state: {
        ...state,
        status: "RUNNING",
        attempt: state.attempt + 1,
        workerId: command.workerId,
        leaseExpiresAt: command.leaseExpiresAt,
        failureCode: null,
        retryable: false,
      },
    };
  }

  if (state.status !== "RUNNING" && !(command.type === "CANCEL" && state.status === "CANCEL_REQUESTED")) return fail("INVALID_STATUS");
  if (!state.workerId || !state.leaseExpiresAt) return fail("LEASE_REQUIRED");
  if (state.workerId !== command.workerId) return fail("LEASE_OWNER_MISMATCH");
  const currentLeaseExpiry = Date.parse(state.leaseExpiresAt);
  if (!Number.isFinite(currentLeaseExpiry) || currentLeaseExpiry <= now) return fail("LEASE_EXPIRED");

  if (command.type === "HEARTBEAT") {
    const nextLeaseExpiry = Date.parse(command.leaseExpiresAt);
    if (!Number.isFinite(nextLeaseExpiry) || nextLeaseExpiry <= now) return fail("LEASE_EXPIRED");
    return { error: null, state: { ...state, leaseExpiresAt: command.leaseExpiresAt } };
  }
  if (command.type === "PAUSE") return { error: null, state: clearLease({ ...state, status: "PAUSED" }) };
  if (command.type === "CANCEL") return { error: null, state: clearLease({ ...state, status: "CANCELLED" }) };
  if (command.type === "SUCCEED") return { error: null, state: clearLease({ ...state, status: "SUCCEEDED", failureCode: null, retryable: false }) };
  if (command.type === "FAIL") {
    return {
      error: null,
      state: clearLease({ ...state, status: "FAILED", failureCode: command.failureCode, retryable: command.retryable }),
    };
  }
  return fail("INVALID_STATUS");
}

function clearLease(state: ControlledOperationRequestState): ControlledOperationRequestState {
  return { ...state, workerId: null, leaseExpiresAt: null };
}

function isTerminal(status: ControlledOperationRequestStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED" || status === "EXPIRED";
}
