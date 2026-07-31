export const QUICK_REVIEW_DRAFT_PREFIX = "areaforge.quick-review.v2.";
export const QUICK_REVIEW_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type QuickReviewResult = "PASSED" | "PARTIAL" | "FAILED";
export type QuickReviewAnswerMode = "TEXT" | "PAPER_OR_ORAL";
export type QuickReviewDraftCommand = "suspend" | "discard";

export interface QuickReviewDraft {
  version: 4;
  draftId: string;
  draftRevision: number;
  userId: string;
  scheduleId: string;
  createdAt: number;
  updatedAt: number;
  idempotencyKey: string;
  baseRevision: number | null;
  submittedDurationSeconds: number | null;
  elapsedSeconds: number;
  runningSince: number | null;
  suspended: boolean;
  result: QuickReviewResult;
  nextDueDate: string;
  note: string;
  answerMode: QuickReviewAnswerMode;
  answerText: string;
  paperOrOralCompleted: boolean;
  revealed: boolean;
}

export interface QuickReviewDraftSchedule {
  id: string;
  revision: number;
  targetType: string;
}

export interface QuickReviewDraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type QuickReviewDraftCasResult =
  | { ok: true; draft: QuickReviewDraft }
  | { ok: false; latest: QuickReviewDraft | null };

export type QuickReviewDraftCommandResult =
  | { ok: true; draft: QuickReviewDraft | null; draftRevision: number | null }
  | { ok: false; latest: QuickReviewDraft | null };

export function quickReviewDraftKey(userId: string, scheduleId: string): string {
  return `${QUICK_REVIEW_DRAFT_PREFIX}${userId}.${scheduleId}`;
}

export function createQuickReviewIdempotencyKey(scheduleId: string): string {
  return `quick-review-${scheduleId}-${randomId()}`;
}

export function createQuickReviewDraft(
  userId: string,
  schedule: QuickReviewDraftSchedule,
  now = Date.now(),
): QuickReviewDraft {
  return {
    version: 4,
    draftId: randomId(),
    draftRevision: 1,
    userId,
    scheduleId: schedule.id,
    createdAt: now,
    updatedAt: now,
    idempotencyKey: createQuickReviewIdempotencyKey(schedule.id),
    baseRevision: schedule.revision,
    submittedDurationSeconds: null,
    elapsedSeconds: 0,
    runningSince: null,
    suspended: true,
    result: "PARTIAL",
    nextDueDate: "",
    note: "",
    answerMode: "TEXT",
    answerText: "",
    paperOrOralCompleted: false,
    revealed: schedule.targetType !== "MISTAKE",
  };
}

export function readQuickReviewDraft(
  userId: string,
  schedule: QuickReviewDraftSchedule,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): QuickReviewDraft | null {
  return readStoredQuickReviewDraft(userId, schedule.id, null, storage, now);
}

export function readStoredQuickReviewDraft(
  userId: string,
  scheduleId: string,
  fallbackRevision: number | null,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): QuickReviewDraft | null {
  const raw = storage.getItem(quickReviewDraftKey(userId, scheduleId));
  if (!raw) return null;
  try {
    return normalizeQuickReviewDraft(JSON.parse(raw) as Record<string, unknown>, userId, scheduleId, fallbackRevision, now);
  } catch {
    return null;
  }
}

// Caller must hold draftLock(userId, scheduleId) for all three mutation helpers below.
export function createQuickReviewDraftIfAbsent(
  created: QuickReviewDraft,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): { created: boolean; draft: QuickReviewDraft } {
  const existing = readStoredQuickReviewDraft(created.userId, created.scheduleId, null, storage, now);
  if (existing) return { created: false, draft: existing };
  const stored = { ...created, version: 4 as const, updatedAt: now };
  storage.setItem(quickReviewDraftKey(stored.userId, stored.scheduleId), JSON.stringify(stored));
  return { created: true, draft: stored };
}

export function compareAndSwapQuickReviewDraft(
  expected: QuickReviewDraft,
  next: QuickReviewDraft,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): QuickReviewDraftCasResult {
  const current = readStoredQuickReviewDraft(expected.userId, expected.scheduleId, null, storage, now);
  if (!sameDraftRevision(current, expected)) return { ok: false, latest: current };
  if (next.userId !== expected.userId || next.scheduleId !== expected.scheduleId || next.draftId !== expected.draftId) {
    return { ok: false, latest: current };
  }
  const stored: QuickReviewDraft = {
    ...next,
    version: 4,
    draftRevision: expected.draftRevision + 1,
    updatedAt: now,
  };
  storage.setItem(quickReviewDraftKey(stored.userId, stored.scheduleId), JSON.stringify(stored));
  return { ok: true, draft: stored };
}

export function removeQuickReviewDraftCas(
  expected: QuickReviewDraft,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): QuickReviewDraftCasResult {
  const current = readStoredQuickReviewDraft(expected.userId, expected.scheduleId, null, storage, now);
  if (!sameDraftRevision(current, expected)) return { ok: false, latest: current };
  storage.removeItem(quickReviewDraftKey(expected.userId, expected.scheduleId));
  return { ok: true, draft: expected };
}

export function bindQuickReviewDraftToSchedule(
  draft: QuickReviewDraft,
  schedule: QuickReviewDraftSchedule,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): QuickReviewDraftCasResult {
  if (draft.baseRevision !== null) return { ok: true, draft };
  return compareAndSwapQuickReviewDraft(draft, {
    ...draft,
    baseRevision: schedule.revision,
    idempotencyKey: createQuickReviewIdempotencyKey(schedule.id),
  }, storage, now);
}

export function upgradeQuickReviewDraftStorage(
  draft: QuickReviewDraft,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): QuickReviewDraftCasResult {
  if (draft.draftRevision > 0) return { ok: true, draft };
  return compareAndSwapQuickReviewDraft(draft, draft, storage, now);
}

export function quickReviewElapsedAt(draft: QuickReviewDraft, now: number): number {
  if (draft.suspended || draft.runningSince === null) return draft.elapsedSeconds;
  return draft.elapsedSeconds + Math.max(0, Math.floor((now - draft.runningSince) / 1000));
}

export function suspendQuickReviewDraft(draft: QuickReviewDraft, now = Date.now()): QuickReviewDraft {
  return {
    ...draft,
    elapsedSeconds: quickReviewElapsedAt(draft, now),
    runningSince: null,
    suspended: true,
    updatedAt: now,
  };
}

export function resumeQuickReviewDraft(draft: QuickReviewDraft, now = Date.now()): QuickReviewDraft {
  if (!draft.suspended || draft.submittedDurationSeconds !== null) return draft;
  return {
    ...draft,
    runningSince: now,
    suspended: false,
    updatedAt: now,
  };
}

export function applyQuickReviewDraftCommand(
  input: {
    userId: string;
    scheduleId: string;
    draftId: string;
    action: QuickReviewDraftCommand;
    now?: number;
  },
  storage: QuickReviewDraftStorage = window.localStorage,
): QuickReviewDraftCommandResult {
  const now = input.now ?? Date.now();
  const draft = readStoredQuickReviewDraft(input.userId, input.scheduleId, null, storage, now);
  if (!draft || draft.draftId !== input.draftId) return { ok: false, latest: draft };
  if (input.action === "discard") {
    const removed = removeQuickReviewDraftCas(draft, storage, now);
    return removed.ok
      ? { ok: true, draft: null, draftRevision: null }
      : { ok: false, latest: removed.latest };
  }
  const suspended = compareAndSwapQuickReviewDraft(draft, suspendQuickReviewDraft(draft, now), storage, now);
  return suspended.ok
    ? { ok: true, draft: suspended.draft, draftRevision: suspended.draft.draftRevision }
    : { ok: false, latest: suspended.latest };
}

export function findRunningQuickReviewDraft(
  userId: string,
  storage: QuickReviewDraftStorage = window.localStorage,
  now = Date.now(),
): QuickReviewDraft | null {
  const prefix = `${QUICK_REVIEW_DRAFT_PREFIX}${userId}.`;
  const candidates: QuickReviewDraft[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(prefix)));
  for (const key of keys) {
    const scheduleId = key.slice(prefix.length);
    if (!scheduleId) continue;
    const draft = readStoredQuickReviewDraft(userId, scheduleId, null, storage, now);
    if (draft && !draft.suspended && draft.submittedDurationSeconds === null) candidates.push(draft);
  }
  return candidates.sort((a, b) => b.updatedAt - a.updatedAt || a.scheduleId.localeCompare(b.scheduleId))[0] ?? null;
}

export function subscribeQuickReviewDraft(
  userId: string,
  scheduleId: string,
  onExternalChange: (draft: QuickReviewDraft | null) => void,
): () => void {
  const key = quickReviewDraftKey(userId, scheduleId);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return;
    onExternalChange(readStoredQuickReviewDraft(userId, scheduleId, null, window.localStorage));
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function normalizeQuickReviewDraft(
  parsed: Record<string, unknown>,
  userId: string,
  scheduleId: string,
  fallbackRevision: number | null,
  now: number,
): QuickReviewDraft | null {
  const version = parsed.version;
  if (version !== 2 && version !== 3 && version !== 4) return null;
  if (parsed.userId !== userId || parsed.scheduleId !== scheduleId) return null;
  if (!isTimestamp(parsed.createdAt, now) || !isTimestamp(parsed.updatedAt, now)) return null;
  if (Number(parsed.createdAt) > Number(parsed.updatedAt)) return null;
  if (now - Number(parsed.updatedAt) > QUICK_REVIEW_DRAFT_TTL_MS) return null;
  if (typeof parsed.idempotencyKey !== "string" || !parsed.idempotencyKey) return null;
  if (!isNonNegativeInteger(parsed.elapsedSeconds)) return null;
  if (parsed.runningSince !== null && !isTimestamp(parsed.runningSince, now)) return null;
  if (typeof parsed.suspended !== "boolean") return null;
  if (!isReviewResult(parsed.result)) return null;
  if (typeof parsed.nextDueDate !== "string" || typeof parsed.note !== "string") return null;
  if (!isAnswerMode(parsed.answerMode) || typeof parsed.answerText !== "string") return null;
  if (typeof parsed.paperOrOralCompleted !== "boolean" || typeof parsed.revealed !== "boolean") return null;
  if (!parsed.suspended && parsed.runningSince === null) return null;

  const submittedDurationSeconds = version !== 2 && isPositiveInteger(parsed.submittedDurationSeconds)
    ? Number(parsed.submittedDurationSeconds)
    : null;
  const parsedBaseRevision = version !== 2 && isPositiveInteger(parsed.baseRevision)
    ? Number(parsed.baseRevision)
    : null;
  const baseRevision = parsedBaseRevision ?? (isPositiveInteger(fallbackRevision) ? fallbackRevision : null);
  const draftId = version === 4 && isNonEmptyString(parsed.draftId)
    ? parsed.draftId
    : legacyDraftId(userId, scheduleId, parsed.idempotencyKey);
  const draftRevision = version === 4 && isPositiveInteger(parsed.draftRevision)
    ? Number(parsed.draftRevision)
    : 0;
  return {
    version: 4,
    draftId,
    draftRevision,
    userId,
    scheduleId,
    createdAt: Number(parsed.createdAt),
    updatedAt: Number(parsed.updatedAt),
    idempotencyKey: parsed.idempotencyKey,
    baseRevision,
    submittedDurationSeconds,
    elapsedSeconds: submittedDurationSeconds ?? Number(parsed.elapsedSeconds),
    runningSince: submittedDurationSeconds === null ? parsed.runningSince as number | null : null,
    suspended: submittedDurationSeconds === null ? parsed.suspended : true,
    result: parsed.result,
    nextDueDate: parsed.nextDueDate,
    note: parsed.note,
    answerMode: parsed.answerMode,
    answerText: parsed.answerText,
    paperOrOralCompleted: parsed.paperOrOralCompleted,
    revealed: parsed.revealed,
  };
}

function sameDraftRevision(left: QuickReviewDraft | null, right: QuickReviewDraft): boolean {
  return Boolean(left && left.draftId === right.draftId && left.draftRevision === right.draftRevision);
}

function legacyDraftId(userId: string, scheduleId: string, idempotencyKey: unknown): string {
  const source = `${userId}:${scheduleId}:${String(idempotencyKey)}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(16)}`;
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isTimestamp(value: unknown, now: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= now + MAX_FUTURE_SKEW_MS;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isReviewResult(value: unknown): value is QuickReviewResult {
  return value === "PASSED" || value === "PARTIAL" || value === "FAILED";
}

function isAnswerMode(value: unknown): value is QuickReviewAnswerMode {
  return value === "TEXT" || value === "PAPER_OR_ORAL";
}
