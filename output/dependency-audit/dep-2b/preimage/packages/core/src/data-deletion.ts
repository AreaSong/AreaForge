import { hashDataExportValue } from "./data-lifecycle";

export const dataDeletionStatuses = ["PREVIEW", "REAUTH_REQUIRED", "COOLDOWN", "FROZEN", "READY_TO_EXECUTE", "EXECUTING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type DataDeletionStatus = typeof dataDeletionStatuses[number];
export type DataDeletionAction = "requestReauthentication" | "reauthenticate" | "freeze" | "approve" | "start" | "succeed" | "fail" | "compensate" | "cancel" | "retry";

export interface DataDeletionState {
  status: DataDeletionStatus;
  scope: "ACCOUNT" | "WORKSPACE";
  scopeFingerprint: string;
  cooldownUntil: string;
  killPointReached: boolean;
  attempt: number;
  failureCode: string | null;
  retryable: boolean;
  executionAllowed: boolean;
  compensationRequired: boolean;
  compensationCompleted: boolean;
}

export interface DataDeletionPreviewInput {
  scope: "ACCOUNT" | "WORKSPACE";
  workspaceIds: readonly string[];
  counts: Readonly<Record<string, number>>;
  generatedAt: string;
  cooldownUntil: string;
  blockers?: readonly string[];
}

export interface DataDeletionPreview {
  contractVersion: "data-delete-preview-v1";
  scope: "ACCOUNT" | "WORKSPACE";
  workspaceIds: string[];
  counts: Record<string, number>;
  totalObjects: number;
  scopeFingerprint: string;
  generatedAt: string;
  cooldownUntil: string;
  blockers: string[];
  physicalDeletionSupported: false;
  executionState: "PREVIEW_ONLY";
}

export function buildDataDeletionPreview(input: DataDeletionPreviewInput): DataDeletionPreview {
  if (!Number.isFinite(Date.parse(input.generatedAt)) || !Number.isFinite(Date.parse(input.cooldownUntil))) {
    throw new TypeError("Deletion timestamps must be valid ISO timestamps.");
  }
  if (Date.parse(input.cooldownUntil) <= Date.parse(input.generatedAt)) throw new TypeError("Deletion cooldown must end after preview generation.");
  const workspaceIds = [...new Set(input.workspaceIds.map(normalizeScopeId))].sort();
  for (const [kind, count] of Object.entries(input.counts)) {
    if (!kind.trim() || !Number.isSafeInteger(count) || count < 0) throw new TypeError("Deletion counts must be non-negative safe integers.");
  }
  const counts = Object.fromEntries(Object.entries(input.counts).sort(([a], [b]) => a.localeCompare(b))) as Record<string, number>;
  const totalObjects = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    contractVersion: "data-delete-preview-v1",
    scope: input.scope,
    workspaceIds,
    counts,
    totalObjects,
    scopeFingerprint: hashDataExportValue({ scope: input.scope, workspaceIds, counts, totalObjects }),
    generatedAt: input.generatedAt,
    cooldownUntil: input.cooldownUntil,
    blockers: [...new Set(input.blockers ?? ["DELETE_EXECUTION_NOT_IMPLEMENTED", "BACKUP_DELETION_LEDGER_NOT_CONFIRMED", "ATTACHMENT_PHYSICAL_DELETE_NOT_AUTHORIZED"])].sort(),
    physicalDeletionSupported: false,
    executionState: "PREVIEW_ONLY",
  };
}

export function createDataDeletionState(preview: DataDeletionPreview, options: { allowExecution?: boolean } = {}): DataDeletionState {
  return { status: "PREVIEW", scope: preview.scope, scopeFingerprint: preview.scopeFingerprint, cooldownUntil: preview.cooldownUntil, killPointReached: false, attempt: 0, failureCode: null, retryable: false, executionAllowed: options.allowExecution === true && preview.blockers.length === 0, compensationRequired: false, compensationCompleted: false };
}

export function transitionDataDeletion(state: DataDeletionState, action: DataDeletionAction, input: { now: string; scopeFingerprint: string; blockers?: readonly string[] }): { state: DataDeletionState; error: string | null } {
  const fail = (error: string) => ({ state, error });
  if (input.scopeFingerprint !== state.scopeFingerprint) return fail("SCOPE_FINGERPRINT_MISMATCH");
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return fail("TIME_INVALID");
  if (action === "requestReauthentication" && state.status === "PREVIEW") return { state: { ...state, status: "REAUTH_REQUIRED" }, error: null };
  if (action === "reauthenticate" && state.status === "REAUTH_REQUIRED") return { state: { ...state, status: "COOLDOWN" }, error: null };
  if (action === "freeze" && state.status === "COOLDOWN") {
    if (now < Date.parse(state.cooldownUntil)) return fail("COOLDOWN_ACTIVE");
    return { state: { ...state, status: "FROZEN" }, error: null };
  }
  if (action === "approve" && state.status === "FROZEN") {
    if (!state.executionAllowed) return fail("DELETE_EXECUTION_NOT_AUTHORIZED");
    if ((input.blockers ?? []).length > 0) return fail("DELETE_BLOCKED");
    return { state: { ...state, status: "READY_TO_EXECUTE" }, error: null };
  }
  if (action === "start" && state.status === "READY_TO_EXECUTE") return { state: { ...state, status: "EXECUTING", killPointReached: true, attempt: state.attempt + 1 }, error: null };
  if (action === "succeed" && state.status === "EXECUTING") return { state: { ...state, status: "SUCCEEDED", failureCode: null, retryable: false, compensationRequired: false }, error: null };
  if (action === "fail" && state.status === "EXECUTING") return { state: { ...state, status: "FAILED", failureCode: "DELETE_EXECUTION_FAILED", retryable: true, compensationRequired: true, compensationCompleted: false }, error: null };
  if (action === "compensate" && state.status === "FAILED" && state.compensationRequired) return { state: { ...state, compensationCompleted: true }, error: null };
  if (action === "retry" && state.status === "FAILED" && state.retryable) {
    if (state.compensationRequired && !state.compensationCompleted) return fail("COMPENSATION_REQUIRED");
    return { state: { ...state, status: "EXECUTING", killPointReached: true, attempt: state.attempt + 1, failureCode: null, retryable: false, compensationRequired: false, compensationCompleted: false }, error: null };
  }
  if (action === "cancel" && !state.killPointReached && ["PREVIEW", "REAUTH_REQUIRED", "COOLDOWN", "FROZEN", "READY_TO_EXECUTE"].includes(state.status)) return { state: { ...state, status: "CANCELLED" }, error: null };
  return fail(state.killPointReached ? "KILL_POINT_REACHED" : "INVALID_STATUS");
}

function normalizeScopeId(value: string): string {
  const id = value.trim();
  if (!id || id === "." || id === ".." || id.includes("/") || id.includes("\\")) throw new TypeError("Deletion scope IDs must be opaque identifiers.");
  return id;
}
