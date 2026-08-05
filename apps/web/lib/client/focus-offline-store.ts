import type { StudySessionDto, StudySessionLowReasonDto } from "@/lib/study/types";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";

const DATABASE_NAME = "areaforge-focus-local-v1";
const DATABASE_VERSION = 2;
const COMMAND_STORE = "commands";
const SNAPSHOT_STORE = "snapshots";
const LOCK_STORE = "locks";
const FALLBACK_COMMANDS_KEY = "areaforge.focus.commands.v1";
const FALLBACK_COMMAND_PREFIX = `${FALLBACK_COMMANDS_KEY}.`;
const FALLBACK_SNAPSHOT_PREFIX = "areaforge.focus.snapshot.v1.";
const FOCUS_SYNC_LOCK_PREFIX = "areaforge.focus.sync.lock.";
const FOCUS_SYNC_LOCK_TTL_MS = 20_000;

export const FOCUS_OFFLINE_SYNC_EVENT = "areaforge:focus-offline-sync";
const FOCUS_SYNC_CHANNEL = "areaforge-focus-sync-v1";

export type FocusOfflineAction = "start" | "pause" | "resume" | "end" | "context";
export type FocusOfflineSyncState = "current" | "pending" | "offline" | "blocked" | "deferred";

export type FocusOfflineConflictResolution = "adopt-server" | "defer" | "abandon";

export interface FocusOfflineCommand {
  id: string;
  userId: string;
  localSessionId: string;
  serverSessionId: string | null;
  action: FocusOfflineAction;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  state: "pending" | "blocked" | "deferred";
  lastError: string | null;
  conflictSession?: StudySessionDto | null;
  blockedAt?: string | null;
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
  knowledgePoints?: StudySessionDto["knowledgePoints"];
  goalMinutes?: number | null;
  clientDeviceId?: string | null;
  clientDeviceLabel?: string | null;
}

export interface FocusOfflineSyncResult {
  state: FocusOfflineSyncState;
  session: StudySessionDto | null;
  pendingCount: number;
}

export interface FocusOfflineConflictRecord {
  command: FocusOfflineCommand;
  localSession: StudySessionDto | null;
  latestSession: StudySessionDto | null;
}

const activeSyncs = new Map<string, Promise<FocusOfflineSyncResult>>();
let focusSyncChannel: BroadcastChannel | null = null;
const focusSyncSourceId = randomSourceId();

export function isLocalFocusSessionId(id: string): boolean {
  return id.startsWith("local-focus-");
}

export function createFocusStartIdempotencyKey(): string {
  return `focus-start-${randomId()}`;
}

export function subscribeFocusOfflineSync(listener: EventListener): () => void {
  if (!isBrowser()) return () => undefined;
  ensureFocusSyncChannel();
  window.addEventListener(FOCUS_OFFLINE_SYNC_EVENT, listener);
  return () => window.removeEventListener(FOCUS_OFFLINE_SYNC_EVENT, listener);
}

export function publishFocusSyncEvent(
  userId: string,
  state: FocusOfflineSyncState,
  session: StudySessionDto | null = null,
): void {
  if (!isBrowser()) return;
  emitSyncEvent(userId, state, session);
}

export function createLocalFocusSession(input: LocalFocusSessionInput, now = new Date()): StudySessionDto {
  const timestamp = now.toISOString();
  return {
    id: `local-focus-${randomId()}`,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    activityKind: "STUDY",
    activityMode: "FREE_STUDY",
    reviewScheduleId: null,
    knowledgeRetestId: null,
    simulationExamId: null,
    taskId: input.taskId ?? null,
    taskTitle: input.taskTitle ?? null,
    taskStatus: null,
    syllabusNodeId: input.syllabusNodeId ?? null,
    syllabusNodeTitle: input.syllabusNodeTitle ?? null,
    knowledgePoints: input.knowledgePoints ?? [],
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
    clientDeviceId: input.clientDeviceId ?? null,
    clientDeviceLabel: input.clientDeviceLabel ?? null,
    lastHeartbeatAt: timestamp,
    lowReasons: [],
    focusLevel: null,
    energyLevel: null,
    nextDisposition: null,
    devicePresences: input.clientDeviceId ? [{
      deviceId: input.clientDeviceId,
      deviceLabel: input.clientDeviceLabel ?? "当前设备",
      lastSeenAt: timestamp,
      isCurrentDevice: true,
    }] : [],
  };
}

export function applyLocalFocusCommand(
  session: StudySessionDto,
  action: Exclude<FocusOfflineAction, "start">,
  body: Record<string, unknown> = {},
  now = new Date(),
): StudySessionDto {
  const timestamp = now.toISOString();
  if (action === "context" && (session.status === "running" || session.status === "paused" || session.status === "closing")) {
    return {
      ...session,
      taskId: typeof body.taskId === "string" ? body.taskId : body.taskId === null ? null : session.taskId,
      taskTitle: typeof body.taskTitle === "string" ? body.taskTitle : body.taskTitle === null ? null : session.taskTitle,
      syllabusNodeId: typeof body.syllabusNodeId === "string" ? body.syllabusNodeId : body.syllabusNodeId === null ? null : session.syllabusNodeId,
      syllabusNodeTitle: typeof body.syllabusNodeTitle === "string" ? body.syllabusNodeTitle : body.syllabusNodeTitle === null ? null : session.syllabusNodeTitle,
      knowledgePoints: Array.isArray(body.knowledgePoints) ? body.knowledgePoints as StudySessionDto["knowledgePoints"] : session.knowledgePoints,
      updatedAt: timestamp,
    };
  }
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
  if (action === "end" && body.mode === "prepare" && (session.status === "running" || session.status === "paused")) {
    const pauseSeconds = session.status === "paused" && session.pausedAt
      ? session.accumulatedPauseSeconds + Math.max(0, Math.floor((now.getTime() - new Date(session.pausedAt).getTime()) / 1000))
      : session.accumulatedPauseSeconds;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(session.startedAt).getTime()) / 1000) - pauseSeconds,
    );
    return {
      ...session,
      status: "closing",
      endedAt: timestamp,
      pausedAt: null,
      accumulatedPauseSeconds: pauseSeconds,
      effectiveMinutes: Math.max(0, Math.floor(elapsedSeconds / 60)),
      closeoutVersion: session.closeoutVersion + 1,
      updatedAt: timestamp,
    };
  }
  if (action === "end" && body.mode !== "prepare" && session.status === "closing") {
    const endedAt = session.status === "closing" && session.endedAt ? new Date(session.endedAt) : now;
    const pauseSeconds = session.accumulatedPauseSeconds;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000) - pauseSeconds,
    );
    const isEffective = body.isEffective === true;
    const minimalOutput = typeof body.minimalOutput === "string" ? body.minimalOutput : null;
    const qualityScore = typeof body.qualityScore === "number" ? body.qualityScore : null;
    const lowReasons = Array.isArray(body.lowReasons)
      ? body.lowReasons.filter((value): value is StudySessionLowReasonDto => isLowReason(value))
      : [];
    return {
      ...session,
      // A local complete command is only a closeout proposal. The server must
      // confirm completion before the UI can present a saved record.
      status: "closing",
      endedAt: endedAt.toISOString(),
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
      lowReasons,
      focusLevel: typeof body.focusLevel === "number" ? body.focusLevel : null,
      energyLevel: typeof body.energyLevel === "number" ? body.energyLevel : null,
      nextDisposition: typeof body.nextDisposition === "string" ? body.nextDisposition : null,
      updatedAt: timestamp,
    };
  }
  return session;
}

/**
 * Offline commands are projected against the local timeline first, but the
 * server enforces CAS using its own `updatedAt`. Rebase only the CAS fields;
 * the user's queued action and closeout payload must remain untouched.
 */
export function rebaseFocusCommand(
  action: FocusOfflineAction,
  body: Record<string, unknown>,
  session: Pick<StudySessionDto, "status" | "updatedAt">,
): Record<string, unknown> {
  if (action === "start") return body;
  return {
    ...body,
    expectedStatus: session.status,
    expectedUpdatedAt: session.updatedAt,
  };
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

export async function clearFocusOfflineData(userId: string): Promise<void> {
  if (!isBrowser()) return;
  await clearFocusOfflineSnapshot(userId);
  clearFallbackCommandsForUser(userId);
  if (!canUseIndexedDb()) return;
  try {
    const commands = await withCommandStore("readonly", (store) => requestPromise<FocusOfflineCommand[]>(store.getAll()));
    const userCommands = commands.filter((command) => command.userId === userId);
    await withCommandStore("readwrite", async (store) => {
      for (const command of userCommands) await requestPromise(store.delete(command.id));
    });
  } catch {
    // Logout remains best-effort when IndexedDB is unavailable.
  }
}

export async function enqueueFocusCommand(input: {
  userId: string;
  localSessionId: string;
  serverSessionId?: string | null;
  action: FocusOfflineAction;
  body: Record<string, unknown>;
}): Promise<FocusOfflineCommand> {
  const body = input.action === "start" && typeof input.body.idempotencyKey !== "string"
    ? { ...input.body, idempotencyKey: `focus-start-${randomId()}` }
    : input.body;
  const command: FocusOfflineCommand = {
    id: randomId(),
    userId: input.userId,
    localSessionId: input.localSessionId,
    serverSessionId: input.serverSessionId ?? null,
    action: input.action,
    body,
    createdAt: new Date().toISOString(),
    attempts: 0,
    state: "pending",
    lastError: null,
  };
  if (!isBrowser()) return command;
  if (!canUseIndexedDb()) {
    writeFallbackCommand(command);
    emitSyncEvent(input.userId, "pending");
    return command;
  }
  try {
    await withCommandStore("readwrite", (store) => requestPromise(store.add(command)));
  } catch {
    writeFallbackCommand(command);
  }
  emitSyncEvent(input.userId, "pending");
  return command;
}

export async function removeFocusCommand(commandId: string): Promise<void> {
  if (!isBrowser()) return;
  removeFallbackCommand(commandId);
  if (!canUseIndexedDb()) return;
  try {
    await withCommandStore("readwrite", (store) => requestPromise(store.delete(commandId)));
  } catch { /* The fallback copy was already removed. */ }
}

export async function countPendingCommands(userId: string): Promise<number> {
  const commands = await listFocusCommands(userId);
  return commands.length;
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
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  } catch {
    return fallback;
  }
}

export async function getFocusOfflineConflict(userId: string): Promise<FocusOfflineConflictRecord | null> {
  const commands = await listFocusCommands(userId);
  const command = commands.find((item) => item.state === "blocked" || item.state === "deferred");
  if (!command) return null;
  const snapshot = await readFocusOfflineSnapshot(userId);
  return {
    command,
    localSession: snapshot?.session && snapshot.session.id === command.localSessionId ? snapshot.session : null,
    latestSession: command.conflictSession ?? null,
  };
}

export async function resolveFocusOfflineConflict(input: {
  userId: string;
  localSessionId: string;
  commandId: string;
  resolution: FocusOfflineConflictResolution;
}): Promise<StudySessionDto | null> {
  const commands = await listFocusCommands(input.userId);
  const related = commands.filter((command) => command.localSessionId === input.localSessionId);
  const source = related.find((command) => command.id === input.commandId) ?? related.find((command) => command.conflictSession);
  const latestSession = source?.conflictSession ?? null;

  if (input.resolution === "defer") {
    for (const command of related) {
      if (command.state === "blocked" || command.state === "pending") {
        await updateCommand(command.id, {
          state: "deferred",
          lastError: "用户选择保留离线记录，等待下次显式对账。",
        });
      }
    }
    emitSyncEvent(input.userId, "deferred", latestSession);
    return latestSession;
  }

  for (const command of related) await removeFocusCommand(command.id);
  const snapshot = await readFocusOfflineSnapshot(input.userId);
  if (input.resolution === "abandon") {
    if (snapshot?.session.id === input.localSessionId) await clearFocusOfflineSnapshot(input.userId);
    emitSyncEvent(input.userId, "current", latestSession);
    return latestSession;
  }

  if (latestSession) {
    await saveFocusOfflineSnapshot(input.userId, latestSession, "current", 0);
  } else if (snapshot?.session.id === input.localSessionId) {
    await clearFocusOfflineSnapshot(input.userId);
  }
  emitSyncEvent(input.userId, "current", latestSession);
  return latestSession;
}

export async function retryDeferredFocusCommands(userId: string, localSessionId?: string): Promise<number> {
  const commands = await listFocusCommands(userId);
  const deferred = commands.filter((command) => command.state === "deferred" && (!localSessionId || command.localSessionId === localSessionId));
  for (const command of deferred) await updateCommand(command.id, { state: "pending", lastError: null });
  if (deferred.length > 0) emitSyncEvent(userId, "pending");
  return deferred.length;
}

export function syncFocusOfflineQueue(userId: string): Promise<FocusOfflineSyncResult> {
  const active = activeSyncs.get(userId);
  if (active) return active;
  const promise = withFocusSyncLock(userId, () => syncFocusOfflineQueueInternal(userId));
  activeSyncs.set(userId, promise);
  const clear = () => {
    if (activeSyncs.get(userId) === promise) activeSyncs.delete(userId);
  };
  void promise.then(clear, clear);
  return promise;
}

async function withFocusSyncLock<T>(userId: string, callback: () => Promise<T>): Promise<T> {
  if (!isBrowser()) return callback();
  const locks = (navigator as Navigator & {
    locks?: {
      request: <R>(name: string, options: { mode: "exclusive" }, callback: () => Promise<R>) => Promise<R>;
    };
  }).locks;
  if (locks) return locks.request(`${FOCUS_SYNC_LOCK_PREFIX}${userId}`, { mode: "exclusive" }, callback);

  if (canUseIndexedDb()) {
    const key = `${FOCUS_SYNC_LOCK_PREFIX}${userId}`;
    const deadline = Date.now() + FOCUS_SYNC_LOCK_TTL_MS;
    let lock: FocusSyncLease | null = null;
    let indexedDbAvailable = true;
    while (Date.now() < deadline) {
      const attempt = await acquireIndexedDbLease(key);
      if (attempt === "unavailable") {
        indexedDbAvailable = false;
        break;
      }
      if (attempt) {
        lock = attempt;
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (lock) {
      const renew = window.setInterval(() => {
        void renewIndexedDbLease(lock.key, lock.owner);
      }, Math.max(1_000, Math.floor(FOCUS_SYNC_LOCK_TTL_MS / 3)));
      try {
        return await callback();
      } finally {
        window.clearInterval(renew);
        await releaseIndexedDbLease(lock.key, lock.owner);
      }
    }
    if (indexedDbAvailable) {
      const pendingCount = await countPendingCommands(userId);
      return { state: pendingCount > 0 ? "pending" : "current", session: null, pendingCount } as T;
    }
  }

  const owner = `${focusSyncSourceId}:${randomId()}`;
  const key = `${FOCUS_SYNC_LOCK_PREFIX}${userId}`;
  const deadline = Date.now() + FOCUS_SYNC_LOCK_TTL_MS;
  while (Date.now() < deadline) {
    const acquired = tryAcquireFocusLease(key, owner);
    if (acquired === "unavailable") {
      const pendingCount = await countPendingCommands(userId);
      return { state: pendingCount > 0 ? "pending" : "current", session: null, pendingCount } as T;
    }
    if (acquired) {
      const renew = window.setInterval(() => {
        renewFocusLease(key, owner);
      }, Math.max(1_000, Math.floor(FOCUS_SYNC_LOCK_TTL_MS / 3)));
      try {
        return await callback();
      } finally {
        window.clearInterval(renew);
        releaseFocusLease(key, owner);
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  const pendingCount = await countPendingCommands(userId);
  return { state: pendingCount > 0 ? "pending" : "current", session: null, pendingCount } as T;
}

interface FocusSyncLease {
  key: string;
  owner: string;
  expiresAt: number;
}

async function acquireIndexedDbLease(key: string): Promise<FocusSyncLease | null | "unavailable"> {
  const owner = `${focusSyncSourceId}:${randomId()}`;
  const now = Date.now();
  try {
    const result = await withLockStore("readwrite", async (store) => {
      const current = await requestPromise<FocusSyncLease | undefined>(store.get(key));
      if (current?.owner && current.expiresAt > now && current.owner !== owner) return null;
      const lease = { key, owner, expiresAt: now + FOCUS_SYNC_LOCK_TTL_MS };
      await requestPromise(store.put(lease));
      return lease;
    });
    return result;
  } catch {
    return "unavailable";
  }
}

async function renewIndexedDbLease(key: string, owner: string): Promise<void> {
  try {
    await withLockStore("readwrite", async (store) => {
      const current = await requestPromise<FocusSyncLease | undefined>(store.get(key));
      if (current?.owner === owner) await requestPromise(store.put({ ...current, expiresAt: Date.now() + FOCUS_SYNC_LOCK_TTL_MS }));
    });
  } catch {
    // The lease naturally expires if the browser closes or IndexedDB fails.
  }
}

async function releaseIndexedDbLease(key: string, owner: string): Promise<void> {
  try {
    await withLockStore("readwrite", async (store) => {
      const current = await requestPromise<FocusSyncLease | undefined>(store.get(key));
      if (current?.owner === owner) await requestPromise(store.delete(key));
    });
  } catch {
    // Lease expiry is the recovery path for a failed release.
  }
}

function tryAcquireFocusLease(key: string, owner: string): boolean | "unavailable" {
  try {
    const now = Date.now();
    const current = JSON.parse(window.localStorage.getItem(key) ?? "null") as { owner?: string; expiresAt?: number } | null;
    if (current?.owner && typeof current.expiresAt === "number" && current.expiresAt > now && current.owner !== owner) return false;
    window.localStorage.setItem(key, JSON.stringify({ owner, expiresAt: now + FOCUS_SYNC_LOCK_TTL_MS }));
    const claimed = JSON.parse(window.localStorage.getItem(key) ?? "null") as { owner?: string } | null;
    return claimed?.owner === owner;
  } catch {
    return "unavailable";
  }
}

function renewFocusLease(key: string, owner: string): void {
  try {
    const current = JSON.parse(window.localStorage.getItem(key) ?? "null") as { owner?: string } | null;
    if (current?.owner === owner) window.localStorage.setItem(key, JSON.stringify({ owner, expiresAt: Date.now() + FOCUS_SYNC_LOCK_TTL_MS }));
  } catch {
    // The lease expires on its own when storage is unavailable.
  }
}

function releaseFocusLease(key: string, owner: string): void {
  try {
    const current = JSON.parse(window.localStorage.getItem(key) ?? "null") as { owner?: string } | null;
    if (current?.owner === owner) window.localStorage.removeItem(key);
  } catch {
    // The lease expires on its own when storage is unavailable.
  }
}

async function syncFocusOfflineQueueInternal(userId: string): Promise<FocusOfflineSyncResult> {
  if (!isBrowser()) return { state: "current", session: null, pendingCount: 0 };
  if (!navigator.onLine) {
    const pendingCount = await countPendingCommands(userId);
    emitSyncEvent(userId, "offline");
    return { state: pendingCount > 0 ? "offline" : "current", session: null, pendingCount };
  }

  const commands = await listFocusCommands(userId);
  const serverSessionIds = new Map<string, string>();
  let latestSession: StudySessionDto | null = null;
  let state: FocusOfflineSyncState = "current";

  for (const command of commands) {
    if (command.state === "deferred") {
      state = "deferred";
      latestSession = command.conflictSession ?? latestSession;
      continue;
    }
    if (command.state === "blocked") {
      state = "blocked";
      latestSession = command.conflictSession ?? null;
      break;
    }
    const sessionId = command.serverSessionId
      ?? serverSessionIds.get(command.localSessionId)
      ?? command.localSessionId;
    const snapshot = latestSession;
    let requestBody = command.action === "start" && typeof command.body.idempotencyKey !== "string"
      ? { ...command.body, idempotencyKey: `focus-start-${command.id}` }
      : command.body;
    if (command.action !== "start" && snapshot && snapshot.id === sessionId) {
      requestBody = rebaseFocusCommand(command.action, requestBody, snapshot);
    }
    if (requestBody !== command.body) await updateCommand(command.id, { body: requestBody });
    const path = command.action === "start"
      ? "/api/study-sessions/start"
      : `/api/study-sessions/${encodeURIComponent(sessionId)}/${command.action}`;
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
        body: JSON.stringify(requestBody),
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
          // A server-side active session is a real synchronization conflict. Keep
          // the local record and queued commands intact until the user chooses how
          // to reconcile the two timelines; never silently merge them.
          latestSession = payload.latest;
          state = "blocked";
          await updateCommand(command.id, {
            state: "blocked",
            attempts: command.attempts + 1,
            lastError: payload.error ?? "服务端已有活动学习，等待人工对账。",
            conflictSession: latestSession,
            blockedAt: new Date().toISOString(),
          });
          emitSyncEvent(userId, "blocked", latestSession);
          break;
        }
        state = response.status === 409 ? "blocked" : "pending";
        await updateCommand(command.id, {
          state: response.status === 409 ? "blocked" : "pending",
          attempts: command.attempts + 1,
          lastError: payload?.error ?? `同步失败（${response.status}）`,
          conflictSession: response.status === 409 ? (payload?.latest ?? null) : command.conflictSession,
          blockedAt: response.status === 409 ? new Date().toISOString() : command.blockedAt,
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
          serverSessionIds.set(command.localSessionId, synced.id);
          await remapLocalSession(userId, command.localSessionId, synced.id);
          await remapQueuedCommands(userId, command.localSessionId, synced.id);
        }
        if (command.action !== "start") serverSessionIds.set(command.localSessionId, synced.id);
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

function isLowReason(value: unknown): value is StudySessionLowReasonDto {
  return value === "NOT_UNDERSTOOD"
    || value === "DISTRACTED"
    || value === "MATERIAL_BLOCKED"
    || value === "FATIGUE"
    || value === "METHOD_MISMATCH"
    || value === "TIME_FRAGMENTED"
    || value === "OTHER";
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
    migrateLegacyFallbackCommands();
    const commands: FocusOfflineCommand[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(FALLBACK_COMMAND_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const command = JSON.parse(raw) as FocusOfflineCommand;
        if (command.id && key === fallbackCommandKey(command.id)) commands.push(command);
      } catch {
        // 单条命令损坏时跳过它，保证其余队列仍可读取。
      }
    }
    return commands;
  } catch {
    return [];
  }
}

function fallbackCommandKey(commandId: string): string {
  return `${FALLBACK_COMMAND_PREFIX}${commandId}`;
}

function migrateLegacyFallbackCommands(): void {
  try {
    const raw = window.localStorage.getItem(FALLBACK_COMMANDS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const command of parsed) {
        if (!command || typeof command !== "object" || typeof (command as { id?: unknown }).id !== "string") continue;
        window.localStorage.setItem(fallbackCommandKey((command as { id: string }).id), JSON.stringify(command));
      }
    }
    window.localStorage.removeItem(FALLBACK_COMMANDS_KEY);
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

function writeFallbackCommand(command: FocusOfflineCommand): void {
  try {
    window.localStorage.setItem(fallbackCommandKey(command.id), JSON.stringify(command));
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

function readFallbackCommand(commandId: string): FocusOfflineCommand | null {
  try {
    const raw = window.localStorage.getItem(fallbackCommandKey(commandId));
    return raw ? JSON.parse(raw) as FocusOfflineCommand : null;
  } catch {
    return null;
  }
}

function removeFallbackCommand(commandId: string): void {
  try {
    window.localStorage.removeItem(fallbackCommandKey(commandId));
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

function clearFallbackCommandsForUser(userId: string): void {
  for (const command of readFallbackCommands()) {
    if (command.userId === userId) removeFallbackCommand(command.id);
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
    const current = readFallbackCommand(commandId);
    if (current) writeFallbackCommand({ ...current, ...patch });
    return;
  }
  try {
    const current = await withCommandStore("readonly", (store) => requestPromise<FocusOfflineCommand | undefined>(store.get(commandId)));
    if (current) await withCommandStore("readwrite", (store) => requestPromise(store.put({ ...current, ...patch })));
  } catch {
    const current = readFallbackCommand(commandId);
    if (current) writeFallbackCommand({ ...current, ...patch });
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
  const detail = { userId, state, session };
  ensureFocusSyncChannel();
  window.dispatchEvent(new CustomEvent(FOCUS_OFFLINE_SYNC_EVENT, { detail }));
  try {
    focusSyncChannel?.postMessage({ ...detail, sourceId: focusSyncSourceId });
  } catch {
    // BroadcastChannel is an enhancement; the local event still updates this tab.
  }
}

function ensureFocusSyncChannel(): void {
  if (!isBrowser() || focusSyncChannel || typeof BroadcastChannel === "undefined") return;
  try {
    focusSyncChannel = new BroadcastChannel(FOCUS_SYNC_CHANNEL);
    focusSyncChannel.addEventListener("message", (event: MessageEvent) => {
      const value = event.data as {
        userId?: unknown;
        state?: unknown;
        session?: unknown;
        sourceId?: unknown;
      } | null;
      if (!value || value.sourceId === focusSyncSourceId || typeof value.userId !== "string") return;
      if (!isFocusSyncState(value.state)) return;
      window.dispatchEvent(new CustomEvent(FOCUS_OFFLINE_SYNC_EVENT, {
        detail: {
          userId: value.userId,
          state: value.state,
          session: isStudySessionDto(value.session) ? value.session : null,
        },
      }));
    });
  } catch {
    focusSyncChannel = null;
  }
}

function isFocusSyncState(value: unknown): value is FocusOfflineSyncState {
  return value === "current" || value === "pending" || value === "offline" || value === "blocked" || value === "deferred";
}

function isStudySessionDto(value: unknown): value is StudySessionDto {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StudySessionDto>;
  return typeof session.id === "string"
    && typeof session.subjectId === "string"
    && typeof session.status === "string";
}

function randomSourceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type StoreName = typeof COMMAND_STORE | typeof SNAPSHOT_STORE | typeof LOCK_STORE;
type StoreMode = "readonly" | "readwrite";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COMMAND_STORE)) database.createObjectStore(COMMAND_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(LOCK_STORE)) database.createObjectStore(LOCK_STORE, { keyPath: "key" });
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

function withLockStore<T>(mode: StoreMode, callback: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return withStore(LOCK_STORE, mode, callback);
}

function requestPromise<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}
