import { hashDataExportValue } from "./data-lifecycle";

export type DataTrashStatus = "ACTIVE" | "TRASHED" | "PURGE_ELIGIBLE";
export type DataTrashAction = "trash" | "restore" | "markPurgeEligible";

export interface DataTrashState {
  resourceType: string;
  resourceId: string;
  ownerUserId: string;
  workspaceId: string | null;
  status: DataTrashStatus;
  revision: number;
  sourceFingerprint: string;
  trashedAt: string | null;
  restoreUntil: string | null;
  purgeExecutionAllowed: false;
}

export interface DataTrashImpactPreview {
  contractVersion: "data-trash-preview-v1";
  resourceType: string;
  resourceId: string;
  ownerUserId: string;
  workspaceId: string | null;
  dependencyCounts: Readonly<Record<string, number>>;
  attachmentCount: number;
  rankingProjectionCount: number;
  blockers: string[];
  sourceFingerprint: string;
  action: "preview_only";
}

export function buildDataTrashImpactPreview(input: Omit<DataTrashImpactPreview, "contractVersion" | "sourceFingerprint" | "action">): DataTrashImpactPreview {
  const resourceType = opaque(input.resourceType, "resource type");
  const resourceId = opaque(input.resourceId, "resource ID");
  const ownerUserId = opaque(input.ownerUserId, "owner user ID");
  const workspaceId = input.workspaceId === null ? null : opaque(input.workspaceId, "workspace ID");
  const dependencyCounts = normalizeCounts(input.dependencyCounts);
  if (!Number.isSafeInteger(input.attachmentCount) || input.attachmentCount < 0) throw new TypeError("Attachment count is invalid.");
  if (!Number.isSafeInteger(input.rankingProjectionCount) || input.rankingProjectionCount < 0) throw new TypeError("Ranking projection count is invalid.");
  const blockers = [...new Set(input.blockers.map((value) => opaque(value, "trash blocker")))].sort();
  const sourceFingerprint = hashDataExportValue({ resourceType, resourceId, ownerUserId, workspaceId, dependencyCounts, attachmentCount: input.attachmentCount, rankingProjectionCount: input.rankingProjectionCount, blockers });
  return { contractVersion: "data-trash-preview-v1", resourceType, resourceId, ownerUserId, workspaceId, dependencyCounts, attachmentCount: input.attachmentCount, rankingProjectionCount: input.rankingProjectionCount, blockers, sourceFingerprint, action: "preview_only" };
}

export function createDataTrashState(preview: DataTrashImpactPreview): DataTrashState {
  return { resourceType: preview.resourceType, resourceId: preview.resourceId, ownerUserId: preview.ownerUserId, workspaceId: preview.workspaceId, status: "ACTIVE", revision: 1, sourceFingerprint: preview.sourceFingerprint, trashedAt: null, restoreUntil: null, purgeExecutionAllowed: false };
}

export function transitionDataTrash(state: DataTrashState, action: DataTrashAction, input: { expectedRevision: number; sourceFingerprint: string; now: string; retentionDays?: number }): { state: DataTrashState; error: string | null } {
  const fail = (error: string) => ({ state, error });
  if (input.expectedRevision !== state.revision) return fail("TRASH_REVISION_CONFLICT");
  if (input.sourceFingerprint !== state.sourceFingerprint) return fail("TRASH_FINGERPRINT_MISMATCH");
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return fail("TRASH_TIME_INVALID");
  if (action === "trash" && state.status === "ACTIVE") {
    const days = input.retentionDays ?? 30;
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) return fail("TRASH_RETENTION_INVALID");
    return { state: { ...state, status: "TRASHED", revision: state.revision + 1, trashedAt: new Date(now).toISOString(), restoreUntil: new Date(now + days * 86_400_000).toISOString() }, error: null };
  }
  if (action === "restore" && state.status === "TRASHED" && state.restoreUntil) {
    if (now >= Date.parse(state.restoreUntil)) return fail("TRASH_RESTORE_WINDOW_EXPIRED");
    return { state: { ...state, status: "ACTIVE", revision: state.revision + 1, trashedAt: null, restoreUntil: null }, error: null };
  }
  if (action === "markPurgeEligible" && state.status === "TRASHED" && state.restoreUntil) {
    if (now < Date.parse(state.restoreUntil)) return fail("TRASH_RETENTION_ACTIVE");
    return { state: { ...state, status: "PURGE_ELIGIBLE", revision: state.revision + 1 }, error: null };
  }
  return fail("TRASH_STATUS_INVALID");
}

function normalizeCounts(input: Readonly<Record<string, number>>): Record<string, number> {
  const entries = Object.entries(input).sort(([left], [right]) => left.localeCompare(right));
  for (const [kind, count] of entries) {
    opaque(kind, "dependency kind");
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("Dependency count is invalid.");
  }
  return Object.fromEntries(entries);
}

function opaque(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) throw new TypeError(`${label} must be an opaque identifier.`);
  return normalized;
}
