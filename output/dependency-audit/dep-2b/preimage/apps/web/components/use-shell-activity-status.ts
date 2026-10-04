"use client";

import { selectMobileTopLight } from "@areaforge/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { readAppShellStatus } from "@/lib/api/app-shell";
import { heartbeatStudySession } from "@/lib/api/session";
import { subscribeActivityStatus } from "@/lib/client/activity-status";
import { isUnauthorized } from "@/lib/client/api-errors";
import {
  isRenderableFocusSession,
  projectLocalFocusStatus,
  projectLocalQuickReviewStatus,
  readRenderableOfflineFocusSession,
  toShellSyncState,
  type ShellSyncState,
} from "@/lib/client/app-shell-projection";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import {
  isLocalFocusSessionId,
  readFocusOfflineSnapshot,
  subscribeFocusOfflineSync,
  syncFocusOfflineQueue,
} from "@/lib/client/focus-offline-store";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import {
  acceptMonotonicSnapshot,
  advanceMonotonicSequence,
  createMonotonicSnapshotClock,
} from "@/lib/client/monotonic-snapshot";
import {
  subscribeQuickReviewActivity,
  type QuickReviewActivityClaim,
} from "@/lib/client/quick-review-activity";
import type { AppShellStatusDto } from "@/lib/contracts";

export function useShellActivityStatus(input: {
  initialStatus: AppShellStatusDto;
  pathname: string;
  userId: string;
}) {
  const [status, setStatus] = useState(input.initialStatus);
  const [syncState, setSyncState] = useState<ShellSyncState>("current");
  const [quickReviewClaim, setQuickReviewClaim] = useState<QuickReviewActivityClaim | null>(null);
  const [offlineFocusSession, setOfflineFocusSession] = useState<AppShellStatusDto["activeSession"]>(null);
  const serverActiveSessionRef = useRef<AppShellStatusDto["activeSession"]>(input.initialStatus.activeSession);
  const candidateSequenceRef = useRef(0);
  const snapshotClockRef = useRef(createMonotonicSnapshotClock(input.initialStatus.serverTime));
  const activeSessionId = status.activeSession?.id;
  const activeSessionStatus = status.activeSession?.status;

  const nextCandidateSequence = useCallback(() => {
    candidateSequenceRef.current += 1;
    return candidateSequenceRef.current;
  }, []);

  const acceptServerStatus = useCallback((sequence: number, nextStatus: AppShellStatusDto): boolean => {
    if (sequence !== candidateSequenceRef.current) return false;
    const nextClock = acceptMonotonicSnapshot(snapshotClockRef.current, {
      requestSequence: sequence,
      serverTime: nextStatus.serverTime,
    });
    if (!nextClock) return false;
    snapshotClockRef.current = nextClock;
    serverActiveSessionRef.current = nextStatus.activeSession;
    setStatus(nextStatus);
    if (nextStatus.activeSession) setOfflineFocusSession(null);
    return true;
  }, []);

  const acceptServerSession = useCallback((
    sequence: number,
    session: AppShellStatusDto["activeSession"],
  ): boolean => {
    if (sequence !== candidateSequenceRef.current) return false;
    const nextClock = advanceMonotonicSequence(snapshotClockRef.current, sequence);
    if (!nextClock) return false;
    snapshotClockRef.current = nextClock;
    serverActiveSessionRef.current = session;
    setStatus((current) => ({ ...current, activeSession: session }));
    setOfflineFocusSession(null);
    return true;
  }, []);

  const refreshShellStatus = useCallback(async () => {
    const sequence = nextCandidateSequence();
    try {
      const result = await readAppShellStatus(getClientDeviceHeaders());
      if (isUnauthorized(result)) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      const nextStatus = result.body?.status;
      if (!result.ok || !nextStatus) throw new Error("APP_SHELL_STATUS_UNAVAILABLE");
      if (!acceptServerStatus(sequence, nextStatus)) return;
      setSyncState((current) => current === "pending" || current === "blocked" || current === "deferred"
        ? current
        : "current");
    } catch {
      if (sequence === candidateSequenceRef.current) {
        setSyncState(navigator.onLine ? "unavailable" : "offline");
      }
    }
  }, [acceptServerStatus, nextCandidateSequence]);

  useEffect(() => subscribeQuickReviewActivity(input.userId, setQuickReviewClaim), [input.userId]);

  useEffect(() => {
    let cancelled = false;
    const refreshOfflineSession = async () => {
      const snapshot = await readFocusOfflineSnapshot(input.userId);
      const session = snapshot?.session && isRenderableFocusSession(snapshot.session)
        && (isLocalFocusSessionId(snapshot.session.id) || !navigator.onLine)
        ? snapshot.session
        : null;
      if (cancelled) return;
      if (serverActiveSessionRef.current !== null) {
        setOfflineFocusSession(null);
        return;
      }
      setOfflineFocusSession(session);
      if (snapshot && snapshot.syncState !== "current") setSyncState(toShellSyncState(snapshot.syncState));
    };
    void refreshOfflineSession();
    const onConnectivityChange = () => void refreshOfflineSession();
    window.addEventListener("online", onConnectivityChange);
    window.addEventListener("offline", onConnectivityChange);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onConnectivityChange);
      window.removeEventListener("offline", onConnectivityChange);
    };
  }, [input.userId]);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      void syncFocusOfflineQueue(input.userId).then((result) => {
        if (!cancelled) setSyncState(toShellSyncState(result.state));
      }).catch(() => {
        if (!cancelled) setSyncState(navigator.onLine ? "unavailable" : "offline");
      });
    };
    sync();
    window.addEventListener("online", sync);
    const interval = window.setInterval(sync, 15_000);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
      window.clearInterval(interval);
    };
  }, [input.userId]);

  useEffect(() => {
    const unsubscribe = subscribeFocusOfflineSync((event: Event) => {
      const detail = (event as CustomEvent<{
        userId?: string;
        state?: string;
        session?: AppShellStatusDto["activeSession"] | null;
      }>).detail;
      if (detail?.userId !== input.userId || detail.session === undefined) return;
      if (detail.state) setSyncState(toShellSyncState(detail.state));
      const session = detail.session;
      if (session && isLocalFocusSessionId(session.id)) {
        if (serverActiveSessionRef.current !== null) return;
        setOfflineFocusSession(isRenderableFocusSession(session) ? session : null);
        return;
      }
      if (!session) {
        if (serverActiveSessionRef.current !== null) return;
        void readRenderableOfflineFocusSession(input.userId).then((localSession) => {
          if (serverActiveSessionRef.current === null) setOfflineFocusSession(localSession);
        });
        return;
      }
      const serverSession = isRenderableFocusSession(session) ? session : null;
      acceptServerSession(nextCandidateSequence(), serverSession);
    });
    return unsubscribe;
  }, [acceptServerSession, input.userId, nextCandidateSequence]);

  useEffect(() => {
    const unsubscribe = subscribeActivityStatus((event: Event) => {
      const detail = (event as CustomEvent<{
        userId?: string;
        session?: AppShellStatusDto["activeSession"] | null;
      }>).detail;
      if (detail?.userId !== input.userId || detail.session === undefined) return;
      const session = detail.session && isRenderableFocusSession(detail.session) ? detail.session : null;
      acceptServerSession(nextCandidateSequence(), session);
      if (!session) {
        setStatus((current) => {
          const lights = current.lights.map((light) => light.kind === "activity"
            ? { ...light, tone: "gray" as const, summary: "无活动", action: null }
            : light);
          return {
            ...current,
            activeSession: null,
            lights,
            mobileTop: selectMobileTopLight(lights),
          };
        });
      }
      void refreshShellStatus();
    });
    return unsubscribe;
  }, [acceptServerSession, input.userId, nextCandidateSequence, refreshShellStatus]);

  useEffect(() => {
    if (!activeSessionId || (activeSessionStatus !== "running"
      && activeSessionStatus !== "paused"
      && activeSessionStatus !== "closing")) return;
    let cancelled = false;
    const heartbeat = async () => {
      const sequence = nextCandidateSequence();
      try {
        const result = await heartbeatStudySession(activeSessionId, {}, getClientDeviceHeaders());
        const body = result.body;
        if (!cancelled && result.ok && body && body.session !== undefined) {
          acceptServerSession(sequence, body.session ?? null);
        }
      } catch {
        // The periodic status refresh remains the fallback.
      }
    };
    void heartbeat();
    const interval = window.setInterval(heartbeat, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [acceptServerSession, activeSessionId, activeSessionStatus, nextCandidateSequence]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void refreshShellStatus();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshShellStatus();
    }, 60_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [input.pathname, refreshShellStatus]);

  const displaySession = status.activeSession ?? offlineFocusSession;
  return {
    status,
    syncState,
    quickReviewClaim,
    offlineFocusSession,
    currentActivitySession: displaySession,
    displayStatus: projectLocalFocusStatus(
      projectLocalQuickReviewStatus(status, quickReviewClaim),
      displaySession,
    ),
  };
}
