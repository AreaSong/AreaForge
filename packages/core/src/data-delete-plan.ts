import { hashDataExportValue } from "./data-lifecycle";

export const DATA_DELETE_PROTOCOL = "data-delete-plan-v1" as const;
export const DATA_DELETE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DATA_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const DATA_DELETE_MAX_ITEMS = 100_000;
export const dataTrashResourceTypes = ["Note", "Mistake", "StudyTask", "StudyResource", "KnowledgePoint"] as const;
export type DataTrashResourceType = typeof dataTrashResourceTypes[number];
export type DataDeleteScope = "ACCOUNT" | "WORKSPACE" | "RESOURCE";
export type DataDeleteState = "COOLDOWN" | "TRASHED" | "RUNNING" | "RETRY_WAIT" | "FAILED" | "SUCCEEDED" | "CANCELLED" | "RESTORED";

export interface DataDeleteTarget {
  requesterId: string;
  scope: DataDeleteScope;
  workspaceId: string | null;
  resourceType: DataTrashResourceType | null;
  resourceId: string | null;
}

export interface DataDeleteItem {
  model: string;
  key: Record<string, string>;
  identityHash: string;
  rowHash: string;
}

export interface DataDeletePlan {
  protocol: typeof DATA_DELETE_PROTOCOL;
  target: DataDeleteTarget;
  authorizationHash: string;
  schemaHash: string;
  items: DataDeleteItem[];
  blockers: string[];
  securityCleanup: readonly string[];
  fingerprint: string;
}

export class DataDeleteError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = "DataDeleteError";
    if (!/^DATA_DELETE_[A-Z0-9_]{1,80}$/.test(code)) throw new TypeError("Invalid deletion error code");
  }
}

export function deleteIdentifier(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new DataDeleteError("DATA_DELETE_IDENTIFIER_INVALID");
  return value;
}

export function validateDataDeleteTarget(target: DataDeleteTarget): void {
  deleteIdentifier(target.requesterId);
  if (target.workspaceId !== null) deleteIdentifier(target.workspaceId);
  if (target.scope === "ACCOUNT" && target.workspaceId === null && target.resourceType === null && target.resourceId === null) return;
  if (target.scope === "WORKSPACE" && target.workspaceId && target.resourceType === null && target.resourceId === null) return;
  if (target.scope === "RESOURCE" && target.workspaceId && target.resourceId && target.resourceType
    && dataTrashResourceTypes.includes(target.resourceType)) { deleteIdentifier(target.resourceId); return; }
  throw new DataDeleteError("DATA_DELETE_SCOPE_INVALID");
}

/** 删除凭据绑定逐对象身份和版本；相同计数不代表相同删除集合。 */
export function createDataDeletePlan(input: Omit<DataDeletePlan, "protocol" | "fingerprint" | "securityCleanup">): DataDeletePlan {
  validateDataDeleteTarget(input.target);
  requireHash(input.authorizationHash); requireHash(input.schemaHash);
  if (input.items.length > DATA_DELETE_MAX_ITEMS) throw new DataDeleteError("DATA_DELETE_LIMIT_EXCEEDED");
  const identities = new Set<string>();
  const items = input.items.map(item => {
    if (!/^[A-Z][A-Za-z0-9]{0,80}$/.test(item.model) || !Object.keys(item.key).length) throw new DataDeleteError("DATA_DELETE_ITEM_INVALID");
    for (const [field, value] of Object.entries(item.key)) { deleteIdentifier(field); deleteIdentifier(value); }
    requireHash(item.identityHash); requireHash(item.rowHash);
    if (identities.has(item.identityHash)) throw new DataDeleteError("DATA_DELETE_ITEM_DUPLICATE");
    identities.add(item.identityHash);
    return { ...item, key: Object.fromEntries(Object.entries(item.key).sort(([a], [b]) => a.localeCompare(b))) };
  }).sort((a, b) => a.model.localeCompare(b.model) || a.identityHash.localeCompare(b.identityHash));
  const blockers = [...new Set(input.blockers)].sort();
  if (blockers.some(code => !/^DATA_DELETE_[A-Z0-9_]{1,80}$/.test(code))) throw new DataDeleteError("DATA_DELETE_BLOCKER_INVALID");
  const value = { protocol: DATA_DELETE_PROTOCOL, target: { ...input.target }, authorizationHash: input.authorizationHash,
    schemaHash: input.schemaHash, items, blockers,
    securityCleanup: input.target.scope === "ACCOUNT" ? ["OWN_AUTH_SESSIONS", "OWN_AUTH_ACTION_TOKENS", "OWN_AUTH_AUDIT_EVENTS"] : [] };
  return { ...value, fingerprint: hashDataExportValue(value) };
}

export function dataDeleteSummary(plan: DataDeletePlan) {
  const counts: Record<string, number> = {};
  for (const item of plan.items) counts[item.model] = (counts[item.model] ?? 0) + 1;
  return { protocol: plan.protocol, scope: plan.target.scope, fingerprint: plan.fingerprint, counts,
    totalObjects: plan.items.length, blockers: plan.blockers, canConfirm: plan.items.length > 0 && plan.blockers.length === 0,
    retentionHours: plan.target.scope === "RESOURCE" ? 30 * 24 : 24, securityCleanup: plan.securityCleanup };
}

export function dataDeleteControlAllowed(state: DataDeleteState, irreversibleAt: Date | null) {
  const terminal = ["SUCCEEDED", "CANCELLED", "RESTORED"].includes(state);
  return { canCancel: !terminal && irreversibleAt === null && state !== "TRASHED",
    canRestore: state === "TRASHED" && irreversibleAt === null, canRetry: state === "FAILED" };
}

export function requireHash(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new DataDeleteError("DATA_DELETE_HASH_INVALID");
}
