import type { StudySessionDto } from "@/lib/contracts";
import { postStudySessionCommand, startStudySession } from "@/lib/api/session";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import {
  isFocusSyncState,
  isStudySessionDto,
  rebaseFocusCommand,
  type FocusOfflineAction,
  type FocusOfflineCommand,
  type FocusOfflineConflictRecord,
  type FocusOfflineConflictResolution,
  type FocusOfflineSnapshot,
  type FocusOfflineSyncResult,
  type FocusOfflineSyncState,
} from "./focus-offline-contract";
import { withFocusSyncLock } from "./focus-offline-lock";
import {
  canUseIndexedDb,
  clearFallbackCommandsForUser,
  isBrowser,
  randomId,
  randomSourceId,
  readFallbackCommand,
  readFallbackCommands,
  readFallbackSnapshot,
  removeFallbackCommand,
  removeFallbackSnapshot,
  requestPromise,
  stripSnapshotId,
  withCommandStore,
  withSnapshotStore,
  writeFallbackCommand,
  writeFallbackSnapshot,
} from "./focus-offline-storage";

export {
  applyLocalFocusCommand,
  createFocusStartIdempotencyKey,
  createLocalFocusSession,
  isFocusSyncState,
  isLowReason,
  isLocalFocusSessionId,
  isStudySessionDto,
  rebaseFocusCommand,
} from "./focus-offline-contract";
export type {
  FocusOfflineAction,
  FocusOfflineCommand,
  FocusOfflineConflictRecord,
  FocusOfflineConflictResolution,
  FocusOfflineSnapshot,
  FocusOfflineSyncResult,
  FocusOfflineSyncState,
  LocalFocusSessionInput,
} from "./focus-offline-contract";

export const FOCUS_OFFLINE_SYNC_EVENT = "areaforge:focus-offline-sync";
const FOCUS_SYNC_CHANNEL = "areaforge-focus-sync-v1";

const activeSyncs = new Map<string, Promise<FocusOfflineSyncResult>>();
let focusSyncChannel: BroadcastChannel | null = null;
const focusSyncSourceId = randomSourceId();

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
    removeFallbackSnapshot(userId);
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
    removeFallbackSnapshot(userId);
    return;
  }
  try {
    await withSnapshotStore("readwrite", (store) => requestPromise(store.delete(userId)));
    removeFallbackSnapshot(userId);
  } catch {
    removeFallbackSnapshot(userId);
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
  const promise = withFocusSyncLock(
    userId,
    focusSyncSourceId,
    () => countPendingCommands(userId),
    () => syncFocusOfflineQueueInternal(userId),
  );
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
    try {
      const result = command.action === "start"
        ? await startStudySession(requestBody, getClientDeviceHeaders())
        : await postStudySessionCommand(sessionId, command.action, requestBody, getClientDeviceHeaders());
      const payload = result.body;
      if (isUnauthorized(result)) {
        state = "pending";
        break;
      }
      if (!result.ok) {
        if (command.action === "start" && isConflict(result) && payload?.latest?.id) {
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
        state = isConflict(result) ? "blocked" : "pending";
        await updateCommand(command.id, {
          state: isConflict(result) ? "blocked" : "pending",
          attempts: command.attempts + 1,
          lastError: payload?.error ?? `同步失败（${result.status}）`,
          conflictSession: isConflict(result) ? (payload?.latest ?? null) : command.conflictSession,
          blockedAt: isConflict(result) ? new Date().toISOString() : command.blockedAt,
        });
        if (isConflict(result)) {
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
