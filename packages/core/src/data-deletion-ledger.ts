import { hashDataExportValue } from "./data-lifecycle";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface DataDeletionLedgerEntry {
  protocol: "areaforge-deletion-ledger";
  schemaVersion: 1;
  sequence: number;
  deletionId: string;
  scope: "ACCOUNT" | "WORKSPACE";
  scopeFingerprint: string;
  completedAt: string;
  counts: Readonly<Record<string, number>>;
  previousEntryHash: string | null;
  entryHash: string;
}

export interface DataDeletionLedgerReplayPlan {
  protocol: "areaforge-deletion-ledger-replay";
  schemaVersion: 1;
  backupCreatedAt: string;
  headHash: string | null;
  entries: Array<Pick<DataDeletionLedgerEntry, "sequence" | "deletionId" | "scope" | "scopeFingerprint" | "completedAt" | "entryHash">>;
  executionAllowed: false;
}

export function createDataDeletionLedgerEntry(input: {
  sequence: number;
  deletionId: string;
  scope: "ACCOUNT" | "WORKSPACE";
  scopeFingerprint: string;
  completedAt: string;
  counts: Readonly<Record<string, number>>;
  previousEntryHash: string | null;
}): DataDeletionLedgerEntry {
  const normalized = normalizeLedgerInput(input);
  return { ...normalized, entryHash: hashLedgerEntry(normalized) };
}

export function validateDataDeletionLedger(entries: readonly DataDeletionLedgerEntry[]): { valid: true; headHash: string | null } {
  let previousHash: string | null = null;
  let previousTime = -Infinity;
  const deletionIds = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const normalized = normalizeLedgerInput(entry);
    if (entry.protocol !== "areaforge-deletion-ledger" || entry.schemaVersion !== 1) throw new TypeError("Deletion ledger protocol mismatch.");
    if (entry.sequence !== index + 1) throw new TypeError("Deletion ledger sequence is not contiguous.");
    if (entry.previousEntryHash !== previousHash) throw new TypeError("Deletion ledger hash chain is broken.");
    if (entry.entryHash !== hashLedgerEntry(normalized)) throw new TypeError("Deletion ledger entry hash mismatch.");
    const time = Date.parse(entry.completedAt);
    if (time <= previousTime) throw new TypeError("Deletion ledger timestamps must increase.");
    if (deletionIds.has(entry.deletionId)) throw new TypeError("Deletion ledger contains a duplicate deletion ID.");
    deletionIds.add(entry.deletionId);
    previousTime = time;
    previousHash = entry.entryHash;
  }
  return { valid: true, headHash: previousHash };
}

/** Compute replay work only; an independently confirmed worker must recheck scope before deleting. */
export function buildDataDeletionLedgerReplayPlan(input: {
  entries: readonly DataDeletionLedgerEntry[];
  backupCreatedAt: string;
  alreadyAppliedEntryHashes?: readonly string[];
}): DataDeletionLedgerReplayPlan {
  const backupTime = Date.parse(input.backupCreatedAt);
  if (!Number.isFinite(backupTime)) throw new TypeError("Backup timestamp is invalid.");
  const validated = validateDataDeletionLedger(input.entries);
  const applied = new Set(input.alreadyAppliedEntryHashes ?? []);
  for (const hash of applied) if (!SHA256_PATTERN.test(hash)) throw new TypeError("Applied ledger hash is invalid.");
  const entries = input.entries
    .filter((entry) => Date.parse(entry.completedAt) > backupTime && !applied.has(entry.entryHash))
    .map(({ sequence, deletionId, scope, scopeFingerprint, completedAt, entryHash }) => ({ sequence, deletionId, scope, scopeFingerprint, completedAt, entryHash }));
  return { protocol: "areaforge-deletion-ledger-replay", schemaVersion: 1, backupCreatedAt: new Date(backupTime).toISOString(), headHash: validated.headHash, entries, executionAllowed: false };
}

function normalizeLedgerInput(input: Omit<DataDeletionLedgerEntry, "protocol" | "schemaVersion" | "entryHash"> | DataDeletionLedgerEntry) {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new TypeError("Deletion ledger sequence is invalid.");
  const deletionId = normalizeIdentifier(input.deletionId, "deletion ID");
  if (input.scope !== "ACCOUNT" && input.scope !== "WORKSPACE") throw new TypeError("Deletion ledger scope is invalid.");
  if (!SHA256_PATTERN.test(input.scopeFingerprint)) throw new TypeError("Deletion scope fingerprint is invalid.");
  if (!Number.isFinite(Date.parse(input.completedAt))) throw new TypeError("Deletion completion timestamp is invalid.");
  if (input.previousEntryHash !== null && !SHA256_PATTERN.test(input.previousEntryHash)) throw new TypeError("Previous ledger hash is invalid.");
  const counts = Object.fromEntries(Object.entries(input.counts).sort(([left], [right]) => left.localeCompare(right)));
  for (const [kind, count] of Object.entries(counts)) {
    normalizeIdentifier(kind, "deletion kind");
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("Deletion ledger counts must be non-negative safe integers.");
  }
  return { protocol: "areaforge-deletion-ledger" as const, schemaVersion: 1 as const, sequence: input.sequence, deletionId, scope: input.scope, scopeFingerprint: input.scopeFingerprint, completedAt: new Date(input.completedAt).toISOString(), counts, previousEntryHash: input.previousEntryHash };
}

function hashLedgerEntry(entry: Omit<DataDeletionLedgerEntry, "entryHash">): string {
  return hashDataExportValue(entry);
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) throw new TypeError(`${label} must be an opaque identifier.`);
  return normalized;
}
