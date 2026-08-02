import type { StudySessionDto } from "@/lib/study/types";

const DATABASE_NAME = "areaforge-focus-local-v1";
const DATABASE_VERSION = 1;
const COMMAND_STORE = "commands";
const SNAPSHOT_STORE = "snapshots";
const FALLBACK_COMMANDS_KEY = "areaforge.focus.commands.v1";
const FALLBACK_SNAPSHOT_PREFIX = "areaforge.focus.snapshot.v1.";

export const FOCUS_OFFLINE_SYNC_EVENT = "areaforge:focus-offline-sync";

export type FocusOfflineAction = "start" | "pause" | "resume" | "end";
export type FocusOfflineSyncState = "current" | "pending" | "offline" | "blocked";

export interface FocusOfflineCommand {
  id: string;
  userId: string;
  localSessionId: string;
  serverSessionId: string | null;
  action: FocusOfflineAction;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  state: "pending" | "blocked";
  lastError: string | null;
}

export interface FocusOfflineSnapshot {
  userId: string;
  session: StudySessionDto;
  savedAt: string;
  syncState: FocusOfflineSyncState;
  pendingCount: number;
}

export interface LocalFocusSessionInput {
  userId: string;
  subjectId: string;
  subjectName: string;
  taskId?: string | null;
  taskTitle?: string | null;
  syllabusNodeId?: string | null;
  syllabusNodeTitle?: string | null;
  goalMinutes?: number | null;
}

export interface FocusOfflineSyncResult {
  state: FocusOfflineSyncState;
  session: StudySessionDto | null;
  pendingCount: number;
}

const activeSyncs = new Map<string, Promise<FocusOfflineSyncResult>>();

export function isLocalFocusSessionId(id: string): boolean {
  return id.startsWith("local-focus-");
}

export function createLocalFocusSession(input: LocalFocusSessionInput, now = new Date()): StudySessionDto {
  const timestamp = now.toISOString();
  return {
    id: `local-focus-${randomId()}`,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    taskId: input.taskId ?? null,
    taskTitle: input.taskTitle ?? null,
    taskStatus: null,
    syllabusNodeId: input.syllabusNodeId ?? null,
    syllabusNodeTitle: input.syllabusNodeTitle ?? null,
    status: "running",
    startedAt: timestamp,
    updatedAt: timestamp,
    pausedAt: null,
    endedAt: null,
    accumulatedPauseSeconds: 0,
    effectiveMinutes: 0,
    qualityScore: null,
    isEffective: null,
    understandingLevel: null,
    minimalOutput: null,
    nextAction: null,
    producedNote: false,
    producedMistake: false,
    isLowConversion: null,
    antiFakeReason: null,
    requiredOutput: null,
    closeoutVersion: 1,
    note: null,
    goalMinutes: input.goalMinutes ?? null,
    startSource: "SUBJECT_SHORTCUT",
  };
}

export function applyLocalFocusCommand(
  session: StudySessionDto,
  action: Exclude<FocusOfflineAction, "start">,
  body: Record<string, unknown> = {},
  now = new Date(),
): StudySessionDto {
  const timestamp = now.toISOString();
  if (action === "pause" && session.status === "running") {
    return { ...session, status: "paused", pausedAt: timestamp, updatedAt: timestamp };
  }
  if (action === "resume" && session.status === "paused") {
    const pauseSeconds = session.pausedAt
      ? Math.max(0, Math.floor((now.getTime() - new Date(session.pausedAt).getTime()) / 1000))
      : 0;
    return {
      ...session,
      status: "running",
      pausedAt: null,
      accumulatedPauseSeconds: session.accumulatedPauseSeconds + pauseSeconds,
      updatedAt: timestamp,
    };
  }
  if (action === "end" && (session.status === "running" || session.status === "paused")) {
    const pauseSeconds = session.status === "paused" && session.pausedAt
      ? session.accumulatedPauseSeconds + Math.max(0, Math.floor((now.getTime() - new Date(session.pausedAt).getTime()) / 1000))
      : session.accumulatedPauseSeconds;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(session.startedAt).getTime()) / 1000) - pauseSeconds,
    );
    const isEffective = body.isEffective === true;
    const minimalOutput = typeof body.minimalOutput === "string" ? body.minimalOutput : null;
    const qualityScore = typeof body.qualityScore === "number" ? body.qualityScore : null;
    return {
      ...session,
      status: "completed",
      endedAt: timestamp,
      pausedAt: null,
      accumulatedPauseSeconds: pauseSeconds,
      effectiveMinutes: Math.max(0, Math.floor(elapsedSeconds / 60)),
      qualityScore,
      isEffective,
      understandingLevel: typeof body.understandingLevel === "string" ? body.understandingLevel : null,
      minimalOutput,
      nextAction: typeof body.nextAction === "string" ? body.nextAction : null,
      producedNote: body.producedNote === true,
      producedMistake: body.producedMistake === true,
      isLowConversion: !isEffective || minimalOutput === null || minimalOutput.trim().length < 4,
      antiFakeReason: !isEffective ? "本地收口标记为低转化，联网后会继续进入补充流程。" : null,
      requiredOutput: !isEffective ? "补充一条可复核的学习产出。" : null,
      note: typeof body.note === "string" ? body.note : null,
      closeoutVersion: session.closeoutVersion + 1,
      updatedAt: timestamp,
    };
  }
  return session;
}

export async function saveFocusOfflineSnapshot(
  userId: string,
  session: StudySessionDto,
  syncState: FocusOfflineSyncState,
  pendingCount?: number,
): Promise<void> {
  if (!isBrowser()) return;
  const snapshot: FocusOfflineSnapshot = {
    userId,
    session,
    savedAt: new Date().toISOString(),
    syncState,
    pendingCount: pendingCount ?? await countPendingCommands(userId),
  };
  if (!canUseIndexedDb()) {
    writeFallbackSnapshot(snapshot);
    return;
  }
  try {
    await withSnapshotStore("readwrite", (store) => requestPromise(store.put({ ...snapshot, id: userId })));
    window.localStorage.removeItem(fallbackSnapshotKey(userId));
  } catch {
    writeFallbackSnapshot(snapshot);
  }
}

export async function readFocusOfflineSnapshot(userId: string): Promise<FocusOfflineSnapshot | null> {
  if (!isBrowser()) return null;
  const fallback = readFallbackSnapshot(userId);
  if (!canUseIndexedDb()) return fallback;
  try {
    const value = await withSnapshotStore("readonly", (store) => requestPromise<FocusOfflineSnapshot & { id: string }>(store.get(userId)));
    const indexed = value ? stripSnapshotId(value) : null;
    if (!indexed) return fallback;
    if (!fallback) return indexed;
    return new Date(indexed.savedAt).getTime() >= new Date(fallback.savedAt).getTime() ? indexed : fallback;
  } catch {
    return fallback;
  }
}

export async function clearFocusOfflineSnapshot(userId: string): Promise<void> {
  if (!isBrowser()) return;
  if (!canUseIndexedDb()) {
    window.localStorage.removeItem(fallbackSnapshotKey(userId));
    return;
  }
  try {
    await withSnapshotStore("readwrite", (store) => requestPromise(store.delete(userId)));
    window.localStorage.removeItem(fallbackSnapshotKey(userId));
  } catch {
    window.localStorage.removeItem(fallbackSnapshotKey(userId));
  }
}

export async function enqueueFocusCommand(input: {
  userId: string;
  localSessionId: string;
  serverSessionId?: string | null;
  action: FocusOfflineAction;
  body: Record<string, unknown>;
}): Promise<FocusOfflineCommand> {
  const command: FocusOfflineCommand = {
    id: randomId(),
    userId: input.userId,
    localSessionId: input.localSessionId,
    serverSessionId: input.serverSessionId ?? null,
    action: input.action,
    body: input.body,
    createdAt: new Date().toISOString(),
    attempts: 0,
    state: "pending",
    lastError: null,
  };
  if (!isBrowser()) return command;
  if (!canUseIndexedDb()) {
    const commands = readFallbackCommands();
    commands.push(command);
    writeFallbackCommands(commands);
    emitSyncEvent(input.userId, "pending");
    return command;
  }
  try {
    await withCommandStore("readwrite", (store) => requestPromise(store.add(command)));
  } catch {
    const commands = readFallbackCommands();
    commands.push(command);
    writeFallbackCommands(commands);
  }
  emitSyncEvent(input.userId, "pending");
  return command;
}

export async function removeFocusCommand(commandId: string): Promise<void> {
  if (!isBrowser()) return;
  writeFallbackCommands(readFallbackCommands().filter((command) => command.id !== commandId));
  if (!canUseIndexedDb()) return;
  try {
    await withCommandStore("readwrite", (store) => requestPromise(store.delete(commandId)));
  } catch { /* The fallback copy was already removed. */ }
}

export async function countPendingCommands(userId: string): Promise<number> {
  const commands = await listFocusCommands(userId);
  return commands.filter((command) => command.state === "pending").length;
}

export async function listFocusCommands(userId: string): Promise<FocusOfflineCommand[]> {
  if (!isBrowser()) return [];
  const fallback = readFallbackCommands().filter((command) => command.userId === userId);
  if (!canUseIndexedDb()) return fallback;
  try {
    const commands = await withCommandStore("readonly", (store) => requestPromise<FocusOfflineCommand[]>(store.getAll()));
    const merged = new Map<string, FocusOfflineCommand>();
    for (const command of fallback) merged.set(command.id, command);
    for (const command of commands.filter((item) => item.userId === userId)) merged.set(command.id, command);
    return [...merged.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } catch {
    return fallback;
  }
}

export function syncFocusOfflineQueue(userId: string): Promise<FocusOfflineSyncResult> {
  const active = activeSyncs.get(userId);
  if (active) return active;
  const promise = syncFocusOfflineQueueInternal(userId);
  activeSyncs.set(userId, promise);
  const clear = () => {
    if (activeSyncs.get(userId) === promise) activeSyncs.delete(userId);
  };
  void promise.then(clear, clear);
  return promise;
}

async function syncFocusOfflineQueueInternal(userId: string): Promise<FocusOfflineSyncResult> {
  if (!isBrowser()) return { state: "current", session: null, pendingCount: 0 };
  if (!navigator.onLine) {
    const pendingCount = await countPendingCommands(userId);
    emitSyncEvent(userId, "offline");
    return { state: pendingCount > 0 ? "offline" : "current", session: null, pendingCount };
  }

  const commands = await listFocusCommands(userId);
  let latestSession: StudySessionDto | null = null;
  let state: FocusOfflineSyncState = "current";

  for (const command of commands) {
    if (command.state === "blocked") {
      state = "blocked";
      break;
    }
    const sessionId = command.serverSessionId ?? command.localSessionId;
    const path = command.action === "start"
      ? "/api/study-sessions/start"
      : `/api/study-sessions/${encodeURIComponent(sessionId)}/${command.action}`;
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command.body),
      });
      const payload = await response.json().catch(() => null) as {
        session?: StudySessionDto;
        latest?: StudySessionDto;
        error?: string;
      } | null;
      if (response.status === 401) {
        state = "pending";
        break;
      }
      if (!response.ok) {
        if (command.action === "start" && response.status === 409 && payload?.latest?.id) {
          latestSession = payload.latest;
          await remapLocalSession(userId, command.localSessionId, payload.latest.id);
          await remapQueuedCommands(userId, command.localSessionId, payload.latest.id);
          await removeFocusCommand(command.id);
          emitSyncEvent(userId, "current", latestSession);
          continue;
        }
        state = response.status === 409 ? "blocked" : "pending";
        await updateCommand(command.id, {
          state: response.status === 409 ? "blocked" : "pending",
          attempts: command.attempts + 1,
          lastError: payload?.error ?? `同步失败（${response.status}）`,
        });
        if (response.status === 409) {
          latestSession = payload?.latest ?? null;
          emitSyncEvent(userId, state, latestSession);
          break;
        }
        break;
      }

      const synced = payload?.session ?? null;
      if (synced) {
        latestSession = synced;
        if (command.action === "start" && synced.id !== command.localSessionId) {
          await remapLocalSession(userId, command.localSessionId, synced.id);
          await remapQueuedCommands(userId, command.localSessionId, synced.id);
        }
        await saveFocusOfflineSnapshot(userId, synced, "current");
        emitSyncEvent(userId, "current", synced);
      }
      await removeFocusCommand(command.id);
    } catch {
      state = "offline";
      break;
    }
  }

  const pendingCount = await countPendingCommands(userId);
  if (pendingCount > 0 && state === "current") state = "pending";
  if (latestSession) await saveFocusOfflineSnapshot(userId, latestSession, state, pendingCount);
  emitSyncEvent(userId, state, latestSession);
  return { state, session: latestSession, pendingCount };
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function canUseIndexedDb(): boolean {
  return isBrowser() && typeof indexedDB !== "undefined";
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fallbackSnapshotKey(userId: string): string {
  return `${FALLBACK_SNAPSHOT_PREFIX}${userId}`;
}

function readFallbackSnapshot(userId: string): FocusOfflineSnapshot | null {
  try {
    const raw = window.localStorage.getItem(fallbackSnapshotKey(userId));
    return raw ? JSON.parse(raw) as FocusOfflineSnapshot : null;
  } catch {
    return null;
  }
}

function writeFallbackSnapshot(snapshot: FocusOfflineSnapshot): void {
  try {
    window.localStorage.setItem(fallbackSnapshotKey(snapshot.userId), JSON.stringify(snapshot));
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

function readFallbackCommands(): FocusOfflineCommand[] {
  try {
    const raw = window.localStorage.getItem(FALLBACK_COMMANDS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed as FocusOfflineCommand[] : [];
  } catch {
    return [];
  }
}

function writeFallbackCommands(commands: FocusOfflineCommand[]): void {
  try {
    window.localStorage.setItem(FALLBACK_COMMANDS_KEY, JSON.stringify(commands));
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

function stripSnapshotId(snapshot: FocusOfflineSnapshot & { id: string }): FocusOfflineSnapshot {
  const value = { ...snapshot } as FocusOfflineSnapshot & { id?: string };
  delete value.id;
  return value;
}

async function updateCommand(commandId: string, patch: Partial<FocusOfflineCommand>): Promise<void> {
  if (!isBrowser()) return;
  if (!canUseIndexedDb()) {
    writeFallbackCommands(readFallbackCommands().map((command) => command.id === commandId ? { ...command, ...patch } : command));
    return;
  }
  try {
    const current = await withCommandStore("readonly", (store) => requestPromise<FocusOfflineCommand | undefined>(store.get(commandId)));
    if (current) await withCommandStore("readwrite", (store) => requestPromise(store.put({ ...current, ...patch })));
  } catch {
    writeFallbackCommands(readFallbackCommands().map((command) => command.id === commandId ? { ...command, ...patch } : command));
  }
}

async function remapLocalSession(userId: string, localSessionId: string, serverSessionId: string): Promise<void> {
  const snapshot = await readFocusOfflineSnapshot(userId);
  if (snapshot?.session.id === localSessionId) {
    await saveFocusOfflineSnapshot(userId, { ...snapshot.session, id: serverSessionId }, snapshot.syncState, snapshot.pendingCount);
  }
}

async function remapQueuedCommands(userId: string, localSessionId: string, serverSessionId: string): Promise<void> {
  const commands = await listFocusCommands(userId);
  for (const command of commands) {
    if (command.localSessionId !== localSessionId) continue;
    await updateCommand(command.id, { serverSessionId });
  }
}

function emitSyncEvent(userId: string, state: FocusOfflineSyncState, session: StudySessionDto | null = null): void {
  window.dispatchEvent(new CustomEvent(FOCUS_OFFLINE_SYNC_EVENT, { detail: { userId, state, session } }));
}

type StoreName = typeof COMMAND_STORE | typeof SNAPSHOT_STORE;
type StoreMode = "readonly" | "readwrite";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COMMAND_STORE)) database.createObjectStore(COMMAND_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function withStore<T>(storeName: StoreName, mode: StoreMode, callback: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result: T | undefined;
    let callbackSettled = false;
    let transactionCompleted = false;
    let callbackError: unknown;
    let callbackFailed = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      if (callbackFailed) {
        settled = true;
        reject(callbackError);
        return;
      }
      if (callbackSettled && transactionCompleted) {
        settled = true;
        resolve(result as T);
      }
    };

    callback(store).then((value) => {
      callbackSettled = true;
      result = value;
      finish();
    }, (error: unknown) => {
      callbackSettled = true;
      callbackFailed = true;
      callbackError = error;
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed; the original error is enough.
      }
      finish();
    });
    transaction.oncomplete = () => {
      transactionCompleted = true;
      finish();
    };
    transaction.onerror = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    };
  }).finally(() => database.close());
}

function withCommandStore<T>(mode: StoreMode, callback: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return withStore(COMMAND_STORE, mode, callback);
}

function withSnapshotStore<T>(mode: StoreMode, callback: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return withStore(SNAPSHOT_STORE, mode, callback);
}

function requestPromise<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}
