import type { AutoApplyPolicy, UpdateCenterStatus, UpdateOperation } from "./update-center";
import { isPendingOperation } from "./update-center-ui";

export interface UpdateCenterCoordinatorState {
  serverStatus: UpdateCenterStatus;
  targetOperation: UpdateOperation | null;
  policyDraft: AutoApplyPolicy;
  policyDirty: boolean;
  acceptedReadSequence: number;
  submitting: boolean;
}

export type UpdateCenterCoordinatorAction =
  | { type: "read-status"; sequence: number; status: UpdateCenterStatus }
  | { type: "change-policy"; policy: AutoApplyPolicy }
  | { type: "submit-started" }
  | { type: "submit-failed" }
  | { type: "request-queued"; operation: UpdateOperation };

export function createUpdateCenterCoordinatorState(
  initialStatus: UpdateCenterStatus,
): UpdateCenterCoordinatorState {
  return {
    serverStatus: initialStatus,
    targetOperation: initialStatus.lastOperation && isPendingOperation(initialStatus.lastOperation.status)
      ? initialStatus.lastOperation
      : null,
    policyDraft: initialStatus.autoApply,
    policyDirty: false,
    acceptedReadSequence: 0,
    submitting: false,
  };
}

export function reduceUpdateCenterCoordinator(
  state: UpdateCenterCoordinatorState,
  action: UpdateCenterCoordinatorAction,
): UpdateCenterCoordinatorState {
  switch (action.type) {
    case "change-policy":
      return {
        ...state,
        policyDraft: action.policy,
        policyDirty: action.policy !== state.serverStatus.autoApply,
      };
    case "submit-started":
      return state.submitting || state.targetOperation ? state : { ...state, submitting: true };
    case "submit-failed":
      return state.submitting ? { ...state, submitting: false } : state;
    case "request-queued":
      return {
        ...state,
        submitting: false,
        targetOperation: isPendingOperation(action.operation.status) ? action.operation : null,
        serverStatus: {
          ...state.serverStatus,
          lastOperation: action.operation,
          requestQueueLength: Math.max(state.serverStatus.requestQueueLength ?? 0, 1),
        },
      };
    case "read-status": {
      if (action.sequence <= state.acceptedReadSequence) return state;
      const observed = action.status.lastOperation;
      const matchesTarget = Boolean(
        state.targetOperation && observed?.id === state.targetOperation.id,
      );
      const targetOperation = matchesTarget
        ? observed && isPendingOperation(observed.status) ? observed : null
        : state.targetOperation;
      const policyMatchesServer = state.policyDraft === action.status.autoApply;
      return {
        ...state,
        serverStatus: action.status,
        targetOperation,
        policyDraft: state.policyDirty && !policyMatchesServer
          ? state.policyDraft
          : action.status.autoApply,
        policyDirty: state.policyDirty && !policyMatchesServer,
        acceptedReadSequence: action.sequence,
      };
    }
  }
}

export function selectUpdateCenterStatus(
  state: UpdateCenterCoordinatorState,
): UpdateCenterStatus {
  if (!state.targetOperation) return state.serverStatus;
  return {
    ...state.serverStatus,
    lastOperation: state.targetOperation,
    requestQueueLength: Math.max(state.serverStatus.requestQueueLength ?? 0, 1),
  };
}

export function isUpdateCenterMutationLocked(state: UpdateCenterCoordinatorState): boolean {
  return state.submitting || state.targetOperation !== null;
}

export function shouldContinueTargetOperation(
  status: UpdateCenterStatus,
  targetOperationId: string,
): boolean {
  const observed = status.lastOperation;
  return !observed || observed.id !== targetOperationId || isPendingOperation(observed.status);
}
