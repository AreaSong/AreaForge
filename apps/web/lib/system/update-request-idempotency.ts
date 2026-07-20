const UPDATE_REQUEST_IDEMPOTENCY_STORAGE_KEY = "areaforge.update-request.pending.v2";

export interface UpdateRequestIdempotencyStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function shouldAcknowledgeUpdateRequestAttempt(input: {
  responseOk: boolean;
  responseStatus: number;
  responseBody: unknown;
}): boolean {
  const body = asRecord(input.responseBody);
  if (!isValidUpdateRequestResponseBody(input.responseOk, input.responseStatus, body)) return false;
  if (input.responseStatus === 408 || input.responseStatus === 429 || input.responseStatus >= 500) return false;
  if (!input.responseOk) return input.responseStatus >= 400 && input.responseStatus < 500;
  return asRecord(body.request).publishDurability === "synced";
}

interface PersistedUpdateRequestIdempotencyEntry {
  createdAt: number;
  intent: string;
  key: string;
  requestId?: string;
}

interface PersistedUpdateRequestIdempotency {
  entries: PersistedUpdateRequestIdempotencyEntry[];
}

const unavailableStorages = new WeakSet<UpdateRequestIdempotencyStorage>();
const MAX_PERSISTED_UPDATE_REQUEST_INTENTS = 8;
const CHECK_ATTEMPT_MAX_AGE_MS = 15 * 60_000 + 30_000;
const MUTATION_ATTEMPT_MAX_AGE_MS = 5 * 60_000 + 30_000;
const attemptMetadata = new Map<string, Pick<PersistedUpdateRequestIdempotencyEntry, "createdAt" | "requestId">>();
const settledAttempts = new Set<string>();

export function buildUpdateRequestIdempotencyIntent(input: {
  action: "check" | "apply" | "rollback" | "set_auto_apply";
  tag?: string;
  autoApply?: "none" | "patch";
  confirmedSnapshotHash?: string | null;
}): string {
  return JSON.stringify({
    action: input.action,
    params: {
      tag: input.action === "apply" ? input.tag ?? null : null,
      autoApply: input.action === "set_auto_apply" ? input.autoApply ?? null : null,
    },
    confirmedSnapshotHash: input.confirmedSnapshotHash ?? null,
  });
}

export function reuseUpdateRequestIdempotencyKey(
  pending: Map<string, string>,
  intent: string,
  createKey: () => string,
  storage: UpdateRequestIdempotencyStorage | null = browserSessionStorage(),
  now = Date.now(),
): string {
  const inMemory = pending.get(intent);
  if (inMemory) {
    const token = attemptToken(intent, inMemory);
    const metadata = attemptMetadata.get(token) ?? { createdAt: now };
    if (!settledAttempts.has(token) && !isExpiredIntent(intent, metadata.createdAt, now)) {
      attemptMetadata.set(token, metadata);
      return inMemory;
    }
    pending.delete(intent);
    removePersistedAttempt(storage, intent, inMemory, now);
  }

  if (storage && !unavailableStorages.has(storage)) {
    const persisted = readPersistedIdempotency(storage, now);
    const existing = persisted.entries.find((entry) => entry.intent === intent && !isExpiredIntent(intent, entry.createdAt, now));
    if (existing) {
      pending.set(intent, existing.key);
      attemptMetadata.set(attemptToken(intent, existing.key), {
        createdAt: existing.createdAt,
        ...(existing.requestId ? { requestId: existing.requestId } : {}),
      });
      return existing.key;
    }
  }

  const key = createKey();
  pending.set(intent, key);
  attemptMetadata.set(attemptToken(intent, key), { createdAt: now });
  const persisted = readPersistedIdempotency(storage, now);
  const entries = [...persisted.entries.filter((entry) => entry.intent !== intent && !isExpiredIntent(entry.intent, entry.createdAt, now)), { intent, key, createdAt: now }]
    .slice(-MAX_PERSISTED_UPDATE_REQUEST_INTENTS);
  writePersistedIdempotency(storage, { entries });
  return key;
}

export function bindUpdateRequestIdempotencyRequest(
  intent: string,
  key: string,
  requestId: string,
  storage: UpdateRequestIdempotencyStorage | null = browserSessionStorage(),
  now = Date.now(),
): void {
  if (!requestId) return;
  const token = attemptToken(intent, key);
  const metadata = attemptMetadata.get(token) ?? { createdAt: now };
  attemptMetadata.set(token, { ...metadata, requestId });
  const persisted = readPersistedIdempotency(storage, now);
  const entries = persisted.entries.map((entry) => entry.intent === intent && entry.key === key
    ? { ...entry, requestId }
    : entry);
  if (entries.some((entry) => entry.intent === intent && entry.key === key)) {
    writePersistedIdempotency(storage, { entries });
  }
}

export function settleUpdateRequestIdempotencyFromOperation(
  pending: Map<string, string>,
  operation: { id?: string | null; status?: string | null } | null | undefined,
  storage: UpdateRequestIdempotencyStorage | null = browserSessionStorage(),
  now = Date.now(),
): void {
  if (!operation?.id || !isTerminalOperationStatus(operation.status)) return;
  const persisted = readPersistedIdempotency(storage, now);
  const matches = new Map<string, string>();
  for (const entry of persisted.entries) {
    if (entry.requestId === operation.id) matches.set(entry.intent, entry.key);
  }
  for (const [intent, key] of pending) {
    if (attemptMetadata.get(attemptToken(intent, key))?.requestId === operation.id) matches.set(intent, key);
  }
  for (const [intent, key] of matches) {
    acknowledgeUpdateRequestIdempotencyKey(pending, intent, key, storage, now);
  }
}

export function acknowledgeUpdateRequestIdempotencyKey(
  pending: Map<string, string>,
  intent: string,
  key: string,
  storage: UpdateRequestIdempotencyStorage | null = browserSessionStorage(),
  now = Date.now(),
): void {
  const token = attemptToken(intent, key);
  settledAttempts.add(token);
  attemptMetadata.delete(token);
  if (pending.get(intent) === key) pending.delete(intent);
  const persisted = readPersistedIdempotency(storage, now);
  const entries = persisted.entries.filter((entry) => entry.intent !== intent || entry.key !== key);
  if (entries.length === 0) {
    removePersistedIdempotency(storage);
  } else if (entries.length !== persisted.entries.length) {
    writePersistedIdempotency(storage, { entries });
  }
}

function browserSessionStorage(): UpdateRequestIdempotencyStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readPersistedIdempotency(
  storage: UpdateRequestIdempotencyStorage | null,
  now = Date.now(),
): PersistedUpdateRequestIdempotency {
  if (!storage || unavailableStorages.has(storage)) return { entries: [] };
  try {
    const raw = storage.getItem(UPDATE_REQUEST_IDEMPOTENCY_STORAGE_KEY);
    if (!raw) return { entries: [] };
    const value = JSON.parse(raw) as Partial<PersistedUpdateRequestIdempotency> & Partial<PersistedUpdateRequestIdempotencyEntry>;
    if (Array.isArray(value.entries)) {
      const entries = value.entries
        .map((entry) => normalizePersistedEntry(entry, now))
        .filter((entry): entry is PersistedUpdateRequestIdempotencyEntry => entry !== null)
        .slice(-MAX_PERSISTED_UPDATE_REQUEST_INTENTS);
      if (entries.length === value.entries.length) {
        const normalized = { entries };
        if (JSON.stringify(value) !== JSON.stringify(normalized)) {
          storage.setItem(UPDATE_REQUEST_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(normalized));
        }
        return normalized;
      }
    } else {
      const entry = normalizePersistedEntry(value, now);
      if (entry) {
        const normalized = { entries: [entry] };
        storage.setItem(UPDATE_REQUEST_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(normalized));
        return normalized;
      }
    }
    storage.removeItem(UPDATE_REQUEST_IDEMPOTENCY_STORAGE_KEY);
  } catch {
    unavailableStorages.add(storage);
  }
  return { entries: [] };
}

function writePersistedIdempotency(
  storage: UpdateRequestIdempotencyStorage | null,
  value: PersistedUpdateRequestIdempotency,
): void {
  if (!storage || unavailableStorages.has(storage)) return;
  try {
    storage.setItem(UPDATE_REQUEST_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(value));
  } catch {
    unavailableStorages.add(storage);
  }
}

function removePersistedIdempotency(storage: UpdateRequestIdempotencyStorage | null): void {
  if (!storage || unavailableStorages.has(storage)) return;
  try {
    storage.removeItem(UPDATE_REQUEST_IDEMPOTENCY_STORAGE_KEY);
  } catch {
    unavailableStorages.add(storage);
  }
}

function removePersistedAttempt(
  storage: UpdateRequestIdempotencyStorage | null,
  intent: string,
  key: string,
  now: number,
): void {
  const persisted = readPersistedIdempotency(storage, now);
  const entries = persisted.entries.filter((entry) => entry.intent !== intent || entry.key !== key);
  if (entries.length === 0) {
    removePersistedIdempotency(storage);
  } else if (entries.length !== persisted.entries.length) {
    writePersistedIdempotency(storage, { entries });
  }
}

function normalizePersistedEntry(value: unknown, now: number): PersistedUpdateRequestIdempotencyEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<PersistedUpdateRequestIdempotencyEntry>;
  if (typeof entry.intent !== "string" || typeof entry.key !== "string") return null;
  const createdAt = typeof entry.createdAt === "number" && Number.isSafeInteger(entry.createdAt) && entry.createdAt > 0
    ? entry.createdAt
    : now;
  return {
    intent: entry.intent,
    key: entry.key,
    createdAt,
    ...(typeof entry.requestId === "string" && entry.requestId.length > 0 ? { requestId: entry.requestId } : {}),
  };
}

function attemptToken(intent: string, key: string): string {
  return `${intent}\u0000${key}`;
}

function isExpiredIntent(intent: string, createdAt: number, now: number): boolean {
  return now - createdAt > maxAttemptAge(intent);
}

function maxAttemptAge(intent: string): number {
  try {
    const parsed = JSON.parse(intent) as { action?: unknown };
    return parsed.action === "check" ? CHECK_ATTEMPT_MAX_AGE_MS : MUTATION_ATTEMPT_MAX_AGE_MS;
  } catch {
    return intent.startsWith("check:") ? CHECK_ATTEMPT_MAX_AGE_MS : MUTATION_ATTEMPT_MAX_AGE_MS;
  }
}

function isTerminalOperationStatus(status: string | null | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "needs_reconciliation";
}

function isValidUpdateRequestResponseBody(
  responseOk: boolean,
  responseStatus: number,
  body: Record<string, unknown>,
): boolean {
  if (!responseOk) return typeof body.error === "string" && body.error.length > 0;
  if (responseStatus !== 202) return false;
  const request = asRecord(body.request);
  return typeof request.id === "string"
    && request.id.length > 0
    && typeof request.requestedAt === "string"
    && request.requestedAt.length > 0
    && request.status === "queued"
    && ["check", "apply", "rollback", "set_auto_apply"].includes(String(request.action))
    && (request.publishDurability === "synced" || request.publishDurability === "uncertain");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
