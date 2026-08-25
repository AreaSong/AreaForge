import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import {
  applyLocalFocusCommand,
  enqueueFocusCommand,
  isLocalFocusSessionId,
  publishFocusSyncEvent,
  removeFocusCommand,
  saveFocusOfflineSnapshot,
  type FocusOfflineCommand,
  type FocusOfflineSyncState,
} from "@/lib/client/focus-offline-store";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { postStudySessionCommand } from "@/lib/api/session";
import type { StudySessionDto } from "@/lib/contracts";

export type FocusSessionCommandAction = "pause" | "resume" | "end" | "context";

export type FocusSessionCommandOutcome =
  | {
    kind: "applied";
    session: StudySessionDto | null;
    syncState: FocusOfflineSyncState;
    queuedOffline: boolean;
  }
  | { kind: "unauthorized" }
  | {
    kind: "conflict";
    latest?: StudySessionDto;
    conflictFields: string[];
  }
  | { kind: "rejected"; message: string };

export interface FocusSessionCommandDependencies {
  enqueue: (input: {
    userId: string;
    localSessionId: string;
    serverSessionId?: string | null;
    action: FocusSessionCommandAction;
    body: Record<string, unknown>;
  }) => Promise<FocusOfflineCommand>;
  remove: (commandId: string) => Promise<void>;
  project: (
    session: StudySessionDto,
    action: FocusSessionCommandAction,
    body: Record<string, unknown>,
  ) => StudySessionDto;
  save: (
    userId: string,
    session: StudySessionDto,
    syncState: FocusOfflineSyncState,
  ) => Promise<void>;
  publish: (
    userId: string,
    syncState: FocusOfflineSyncState,
    session: StudySessionDto | null,
  ) => void;
  post: typeof postStudySessionCommand;
  headers: () => HeadersInit;
  isOnline: () => boolean;
}

const defaultDependencies: FocusSessionCommandDependencies = {
  enqueue: enqueueFocusCommand,
  remove: removeFocusCommand,
  project: applyLocalFocusCommand,
  save: saveFocusOfflineSnapshot,
  publish: publishFocusSyncEvent,
  post: postStudySessionCommand,
  headers: getClientDeviceHeaders,
  isOnline: () => typeof navigator === "undefined" || navigator.onLine,
};

export async function executeFocusSessionCommand(
  input: {
    userId: string;
    session: StudySessionDto;
    action: FocusSessionCommandAction;
    body: Record<string, unknown>;
  },
  dependencies: FocusSessionCommandDependencies = defaultDependencies,
): Promise<FocusSessionCommandOutcome> {
  const { userId, session, action, body } = input;
  const localSession = isLocalFocusSessionId(session.id);
  const queuedCommand = await dependencies.enqueue({
    userId,
    localSessionId: session.id,
    serverSessionId: localSession ? null : session.id,
    action,
    body,
  });

  if (localSession) {
    return queueProjectedSession(dependencies, userId, session, action, body, "pending");
  }

  try {
    const result = await dependencies.post(session.id, action, body, dependencies.headers());
    const data = result.body;
    if (result.ok) {
      await dependencies.remove(queuedCommand.id);
      if (data?.session) {
        await dependencies.save(userId, data.session, "current");
        dependencies.publish(userId, "current", data.session);
      }
      return {
        kind: "applied",
        session: data?.session ?? null,
        syncState: "current",
        queuedOffline: false,
      };
    }

    if (isUnauthorized(result)) return { kind: "unauthorized" };
    if (isConflict(result)) {
      await dependencies.remove(queuedCommand.id);
      return {
        kind: "conflict",
        latest: data?.latest ?? undefined,
        conflictFields: data?.conflictFields ?? ["status", "updatedAt"],
      };
    }
    if (result.status < 500) {
      await dependencies.remove(queuedCommand.id);
      return { kind: "rejected", message: data?.error ?? "请求失败" };
    }
    return queueProjectedSession(dependencies, userId, session, action, body, "pending");
  } catch (error) {
    if (!(error instanceof TypeError) && dependencies.isOnline()) throw error;
    const syncState = dependencies.isOnline() ? "pending" : "offline";
    return queueProjectedSession(dependencies, userId, session, action, body, syncState);
  }
}

async function queueProjectedSession(
  dependencies: FocusSessionCommandDependencies,
  userId: string,
  session: StudySessionDto,
  action: FocusSessionCommandAction,
  body: Record<string, unknown>,
  syncState: "pending" | "offline",
): Promise<FocusSessionCommandOutcome> {
  const projected = dependencies.project(session, action, body);
  await dependencies.save(userId, projected, syncState);
  dependencies.publish(userId, syncState, projected);
  return {
    kind: "applied",
    session: projected,
    syncState,
    queuedOffline: true,
  };
}
