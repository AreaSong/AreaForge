import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { publishActivityStatus } from "@/lib/client/activity-status";
import { getClientDeviceHeaders, getClientDeviceIdentity } from "@/lib/client/device-identity";
import { isFocusEvidenceFlowOpen, setFocusEvidenceFlowOpen } from "@/lib/client/focus-evidence";
import {
  isLocalFocusSessionId,
  publishFocusSyncEvent,
  saveFocusOfflineSnapshot,
  subscribeFocusOfflineSync,
  syncFocusOfflineQueue,
  type FocusOfflineSyncState,
} from "@/lib/client/focus-offline-store";
import { heartbeatStudySession } from "@/lib/api/session";
import type { StudySessionDto } from "@/lib/contracts";
import {
  mergeFocusCloseoutDraft,
  migrateFocusDraft,
  persistFocusDraft,
  readFocusDraft,
  type FocusCloseoutDraft,
  type FocusPhase,
} from "@/components/focus-session-draft";

interface FocusSessionEffectsOptions {
  userId: string;
  initialSessionId: string;
  session: StudySessionDto;
  syncState: FocusOfflineSyncState;
  draft: FocusCloseoutDraft;
  draftReady: boolean;
  queuedOfflineRef: MutableRefObject<boolean>;
  setSession: Dispatch<SetStateAction<StudySessionDto>>;
  setNow: Dispatch<SetStateAction<Date>>;
  setPhase: Dispatch<SetStateAction<FocusPhase>>;
  setSyncState: Dispatch<SetStateAction<FocusOfflineSyncState>>;
  setDraft: Dispatch<SetStateAction<FocusCloseoutDraft>>;
  setDraftReady: Dispatch<SetStateAction<boolean>>;
  loadOfflineConflict: (open: boolean, latestOverride?: StudySessionDto | null) => Promise<void>;
}

export function useFocusSessionEffects(options: FocusSessionEffectsOptions) {
  const {
    userId,
    initialSessionId,
    session,
    syncState,
    draft,
    draftReady,
    queuedOfflineRef,
    setSession,
    setNow,
    setPhase,
    setSyncState,
    setDraft,
    setDraftReady,
    loadOfflineConflict,
  } = options;
  const draftSessionIdRef = useRef(initialSessionId);

  useEffect(() => {
    if (isLocalFocusSessionId(session.id)) return;
    publishActivityStatus(
      userId,
      session.status === "running" || session.status === "paused" || session.status === "closing"
        ? session
        : null,
    );
  }, [session, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOfflineConflict(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadOfflineConflict]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDraft(mergeFocusCloseoutDraft(readFocusDraft(userId, initialSessionId)));
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialSessionId, setDraft, setDraftReady, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (session.status === "completed" && isFocusEvidenceFlowOpen(userId, session.id)) {
        setPhase("evidence");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session.id, session.status, setPhase, userId]);

  useEffect(() => {
    if (!draftReady || draftSessionIdRef.current === session.id) return;
    migrateFocusDraft(userId, draftSessionIdRef.current, session.id, draft);
    draftSessionIdRef.current = session.id;
  }, [draft, draftReady, session.id, userId]);

  useEffect(() => {
    if (!draftReady) return;
    persistFocusDraft(userId, session.id, draft);
  }, [draft, draftReady, session.id, userId]);

  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{
        userId?: string;
        state?: FocusOfflineSyncState;
        session?: StudySessionDto | null;
      }>).detail;
      if (detail?.userId !== userId) return;
      if (detail.state) setSyncState(detail.state);
      if (detail.state === "blocked") void loadOfflineConflict(true, detail.session);
      if (!detail.session) return;
      const foreignServerSession = isLocalFocusSessionId(session.id) && detail.session.id !== session.id;
      if (foreignServerSession && detail.state === "blocked") {
        void loadOfflineConflict(true, detail.session);
        return;
      }
      if (detail.session.id === session.id || (
        isLocalFocusSessionId(session.id)
        && detail.state !== "blocked"
        && detail.session.subjectId === session.subjectId
      )) {
        setSession(detail.session);
        if (detail.session.status === "completed") {
          if (detail.session.isLowConversion) setPhase("low-conversion");
          else if (isFocusEvidenceFlowOpen(userId, detail.session.id) || queuedOfflineRef.current) {
            setPhase("evidence");
          }
        }
        if (isLocalFocusSessionId(session.id) && !isLocalFocusSessionId(detail.session.id)) {
          if (detail.session.status === "completed" && isFocusEvidenceFlowOpen(userId, session.id)) {
            setFocusEvidenceFlowOpen(userId, detail.session.id, true);
            setFocusEvidenceFlowOpen(userId, session.id, false);
          }
          queuedOfflineRef.current = false;
        }
      }
    };
    const onOnline = () => void syncFocusOfflineQueue(userId);
    const unsubscribe = subscribeFocusOfflineSync(onSync);
    window.addEventListener("online", onOnline);
    void syncFocusOfflineQueue(userId).catch(() => undefined);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [loadOfflineConflict, queuedOfflineRef, session.id, session.subjectId, setPhase, setSession, setSyncState, userId]);

  useEffect(() => {
    if (isLocalFocusSessionId(session.id)) return;
    if (session.status !== "running" && session.status !== "paused" && session.status !== "closing") return;
    let cancelled = false;
    const device = getClientDeviceIdentity();
    const heartbeat = async () => {
      try {
        const result = await heartbeatStudySession(session.id, {
          clientDeviceId: device.id,
          clientDeviceLabel: device.label,
        }, getClientDeviceHeaders());
        const body = result.body;
        if (!cancelled && result.ok && body?.session) {
          setSession((current) => current.id === body.session?.id ? body.session : current);
          publishFocusSyncEvent(userId, "current", body.session);
        }
      } catch {
        // The timer remains usable offline; the next heartbeat will retry.
      }
    };
    void heartbeat();
    const interval = window.setInterval(heartbeat, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [session.id, session.status, setSession, userId]);

  useEffect(() => {
    if (session.status !== "running" && session.status !== "paused" && session.status !== "closing" && !queuedOfflineRef.current) return;
    void saveFocusOfflineSnapshot(userId, session, syncState);
  }, [queuedOfflineRef, session, syncState, userId]);

  useEffect(() => {
    if (session.status !== "running") return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [session.status, setNow]);
}
