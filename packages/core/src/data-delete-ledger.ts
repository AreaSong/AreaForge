import { hashDataExportValue } from "./data-lifecycle";
import { DataDeleteError, requireHash, validateDataDeleteTarget, type DataDeleteTarget } from "./data-delete-plan";

export interface PersistedDeletionLedger {
  sequence: string; intentId: string; scope: string; scopeHash: string; previousHash: string | null;
  entryHash: string; completedAt: string; manifest: DeletionLedgerManifest;
}
export interface DeletionLedgerManifest {
  protocol: "data-delete-ledger-v1" | "data-delete-ledger-v2";
  target?: DataDeleteTarget;
  items: Array<{ model: string; key: Record<string, string>; identityHash: string }>;
  files: Array<{ identityHash: string; storageKind: string; storageKey: string; expectedHash: string | null; expectedSize: number | null }>;
  securityCleanup?: string[]; securityOwnerId?: string | null; securityCleanupCounts?: Record<string, number>;
}
export interface DeletionLedgerWatermark { sequence: string; entryHash: string | null }

/** 事务时间不等于提交水位；只重放数据库备份快照中缺失的可信账本后缀。 */
export function selectPersistedDeletionReplay(input: unknown, expectedHead: string | null, watermark: DeletionLedgerWatermark): PersistedDeletionLedger[] {
  const entries = validatePersistedDeletionLedger(input, expectedHead);
  const checkpoint = object(watermark);
  exactKeys(checkpoint, ["sequence", "entryHash"]);
  const sequence = Number(checkpoint.sequence);
  if (typeof checkpoint.sequence !== "string" || !/^(0|[1-9][0-9]*)$/.test(checkpoint.sequence)
    || !Number.isSafeInteger(sequence) || sequence > entries.length
    || checkpoint.entryHash !== (sequence === 0 ? null : entries[sequence - 1]!.entryHash)) {
    throw new DataDeleteError("DATA_DELETE_LEDGER_WATERMARK_MISMATCH");
  }
  return entries.slice(sequence);
}

/** 哈希链必须再绑定由可信源单独提供的 head；自带且可重算的 hash 不构成授权。 */
export function validatePersistedDeletionLedger(input: unknown, expectedHead: string | null): PersistedDeletionLedger[] {
  if (!Array.isArray(input) || input.length > 10000) invalid();
  let previous: string | null = null;
  const ids = new Set<string>();
  const entries = input.map((value, index) => {
    const row = object(value);
    exactKeys(row, ["sequence", "intentId", "scope", "scopeHash", "previousHash", "entryHash", "completedAt", "manifest"]);
    if (row.sequence !== String(index + 1) || typeof row.intentId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(row.intentId)
      || ids.has(row.intentId) || !["ACCOUNT", "WORKSPACE", "RESOURCE"].includes(String(row.scope)) || row.previousHash !== previous
      || typeof row.completedAt !== "string" || !Number.isFinite(Date.parse(row.completedAt)) || new Date(row.completedAt).toISOString() !== row.completedAt) invalid();
    requireHash(String(row.scopeHash)); requireHash(String(row.entryHash));
    const manifest = validateManifest(row.manifest, String(row.scope));
    if (hashDataExportValue({ intentId: row.intentId, scope: row.scope, scopeHash: row.scopeHash, previousHash: row.previousHash,
      completedAt: row.completedAt, manifest: row.manifest }) !== row.entryHash) invalid();
    ids.add(row.intentId); previous = row.entryHash as string;
    return { ...row, manifest } as unknown as PersistedDeletionLedger;
  });
  if (previous !== expectedHead) throw new DataDeleteError("DATA_DELETE_LEDGER_HEAD_MISMATCH");
  return entries;
}

function validateManifest(value: unknown, scope: string): DeletionLedgerManifest {
  const manifest = object(value);
  const keys = ["protocol", "target", "items", "files", "securityCleanup", "securityOwnerId", "securityCleanupCounts"];
  if (Object.keys(manifest).some(key => !keys.includes(key)) || !["data-delete-ledger-v1", "data-delete-ledger-v2"].includes(String(manifest.protocol))) invalid();
  if (manifest.protocol === "data-delete-ledger-v2") {
    const target = object(manifest.target) as unknown as DataDeleteTarget;
    exactKeys(target as unknown as Record<string, unknown>, ["requesterId", "scope", "workspaceId", "resourceType", "resourceId"]);
    validateDataDeleteTarget(target);
    if (target.scope !== scope) invalid();
    const expected = scope === "ACCOUNT" ? ["OWN_AUTH_SESSIONS", "OWN_AUTH_ACTION_TOKENS", "OWN_AUTH_AUDIT_EVENTS"] : [];
    if (hashDataExportValue(manifest.securityCleanup) !== hashDataExportValue(expected)
      || manifest.securityOwnerId !== (scope === "ACCOUNT" ? target.requesterId : null)) invalid();
  }
  if (!Array.isArray(manifest.items) || manifest.items.length > 100000 || !Array.isArray(manifest.files) || manifest.files.length > 100000) invalid();
  const identities = new Set<string>();
  for (const value of manifest.items) {
    const item = object(value); exactKeys(item, ["model", "key", "identityHash"]);
    if (!/^[A-Z][A-Za-z0-9]{0,80}$/.test(String(item.model))) invalid();
    const key = object(item.key);
    if (!Object.keys(key).length || Object.entries(key).some(([field, value]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(field) || typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value))) invalid();
    requireHash(String(item.identityHash));
    if (identities.has(String(item.identityHash))) invalid(); identities.add(String(item.identityHash));
  }
  for (const value of manifest.files) {
    const file = object(value); exactKeys(file, ["identityHash", "storageKind", "storageKey", "expectedHash", "expectedSize"]);
    requireHash(String(file.identityHash));
    if (!["UPLOAD", "EXPORT"].includes(String(file.storageKind)) || typeof file.storageKey !== "string" || /[\\/]/.test(file.storageKey)
      || file.storageKey.length > 200 || !/^[a-zA-Z0-9_.-]+$/.test(file.storageKey)) invalid();
    if (file.expectedHash !== null && !/^[a-f0-9]{64}$/.test(String(file.expectedHash))) invalid();
    if (file.expectedSize !== null && (!Number.isSafeInteger(file.expectedSize) || Number(file.expectedSize) < 0 || Number(file.expectedSize) > 512 * 1024 * 1024)) invalid();
  }
  return manifest as unknown as DeletionLedgerManifest;
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) invalid(); }
function invalid(): never { throw new DataDeleteError("DATA_DELETE_LEDGER_INVALID"); }
