import { useCallback, useState } from "react";
import type { useRouter } from "next/navigation";
import type { StudySessionDto } from "@/lib/contracts";
import {
  getFocusOfflineConflict,
  isLocalFocusSessionId,
  resolveFocusOfflineConflict,
  retryDeferredFocusCommands,
  syncFocusOfflineQueue,
  type FocusOfflineSyncState,
} from "@/lib/client/focus-offline-store";
import {
  initialFocusPhase,
  type FocusPhase,
} from "@/components/focus-session-draft";
import type { FocusSessionConflict } from "@/components/focus-session-workspace";

export interface UseFocusSessionOfflineConflictsParams {
  userId: string;
  currentSessionRef: React.RefObject<StudySessionDto>;
  queuedOfflineRef: React.RefObject<boolean>;
  setSession: React.Dispatch<React.SetStateAction<StudySessionDto>>;
  setNow: React.Dispatch<React.SetStateAction<Date>>;
  setPhase: React.Dispatch<React.SetStateAction<FocusPhase>>;
  setSyncState: React.Dispatch<React.SetStateAction<FocusOfflineSyncState>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  onClearCommandKeys: (action: "start" | "pause" | "resume" | "end" | "context") => void;
  router: ReturnType<typeof useRouter>;
}

export function useFocusSessionOfflineConflicts(params: UseFocusSessionOfflineConflictsParams) {
  const {
    userId,
    currentSessionRef,
    queuedOfflineRef,
    setSession,
    setNow,
    setPhase,
    setSyncState,
    setError,
    onClearCommandKeys,
    router,
  } = params;

  const [conflict, setConflict] = useState<FocusSessionConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const loadOfflineConflict = useCallback(async (open: boolean, latestOverride?: StudySessionDto | null) => {
    const record = await getFocusOfflineConflict(userId);
    if (!record) return;
    setConflict({
      latest: latestOverride ?? record.latestSession ?? (!isLocalFocusSessionId(currentSessionRef.current.id) ? currentSessionRef.current : undefined),
      localSession: record.localSession,
      conflictFields: ["status", "updatedAt", "device", "timeline"],
      action: record.command.action,
      commandId: record.command.id,
      localSessionId: record.command.localSessionId,
    });
    if (open && record.command.state === "blocked") setConflictOpen(true);
  }, [currentSessionRef, userId]);

  async function adoptLatestSession() {
    if (!conflict?.latest) {
      setConflictOpen(false);
      router.refresh();
      return;
    }
    if (conflict.commandId && conflict.localSessionId) {
      await resolveFocusOfflineConflict({
        userId,
        localSessionId: conflict.localSessionId,
        commandId: conflict.commandId,
        resolution: "adopt-server",
      });
    }
    setSession(conflict.latest);
    setNow(new Date());
    onClearCommandKeys(conflict.action);
    if (conflict.latest.status === "completed") setPhase(initialFocusPhase(conflict.latest));
    setConflict(null);
    setConflictOpen(false);
    queuedOfflineRef.current = false;
    setSyncState("current");
    setError("已采用服务端最新活动状态；旧离线命令已按你的选择停止同步。");
  }

  async function deferOfflineConflict() {
    if (!conflict?.commandId || !conflict.localSessionId) return;
    await resolveFocusOfflineConflict({
      userId,
      localSessionId: conflict.localSessionId,
      commandId: conflict.commandId,
      resolution: "defer",
    });
    setConflictOpen(false);
    setSyncState("deferred");
    setError("已保留离线记录，稍后可从这里显式重新对账；系统不会自动覆盖当前活动。");
  }

  async function abandonOfflineConflict() {
    if (!conflict?.commandId || !conflict.localSessionId) return;
    const latest = await resolveFocusOfflineConflict({
      userId,
      localSessionId: conflict.localSessionId,
      commandId: conflict.commandId,
      resolution: "abandon",
    });
    if (latest) {
      setSession(latest);
      setNow(new Date());
    }
    setConflict(null);
    setConflictOpen(false);
    queuedOfflineRef.current = false;
    setSyncState("current");
    setError("已明确放弃旧离线命令；服务端当前活动仍保留。");
  }

  async function retryDeferredConflict() {
    const record = await getFocusOfflineConflict(userId);
    if (!record || record.command.state !== "deferred") {
      setSyncState("current");
      return;
    }
    await retryDeferredFocusCommands(userId, record.command.localSessionId);
    setSyncState("pending");
    await syncFocusOfflineQueue(userId);
    await loadOfflineConflict(true);
  }

  function mergeDraftOntoLatestSession() {
    if (!conflict?.latest) return;
    setSession(conflict.latest);
    setNow(new Date());
    onClearCommandKeys(conflict.action);
    setConflict(null);
    setConflictOpen(false);
    setError("已以服务端最新状态重建命令基线；本地草稿仍保留，请检查后显式重试。");
  }

  return {
    conflict,
    setConflict,
    conflictOpen,
    setConflictOpen,
    loadOfflineConflict,
    adoptLatestSession,
    deferOfflineConflict,
    abandonOfflineConflict,
    retryDeferredConflict,
    mergeDraftOntoLatestSession,
  };
}
