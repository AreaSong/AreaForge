"use client";

import { Repeat2 } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { FocusSessionClient } from "@/components/focus-session-client";
import { GlobalConfiguredCloseout } from "@/components/global-configured-closeout";
import { useWindowSystem } from "@/components/window-system";
import { subscribeActivityStatus } from "@/lib/client/activity-status";
import { activityLabel, isActivitySourcePath } from "@/lib/study/activity-route";
import type { AppShellStatusDto } from "@/lib/study/app-shell-service";
import type { StudySessionDto } from "@/lib/study/types";

export function GlobalSessionCloseout(props: {
  userId: string;
  activeSession: AppShellStatusDto["activeSession"];
  returnTo: string;
  initialNow: string;
  pathname: string;
}) {
  const { registerWindow, ensureWindow, refreshWindow, updateWindowMetadata, closeWindow, openWindow, windows } = useWindowSystem();
  const session = props.activeSession;
  const content = useMemo(() => session ? renderCloseoutContent({
    session,
    userId: props.userId,
    returnTo: props.returnTo,
    initialNow: props.initialNow,
  }) : null, [props.initialNow, props.returnTo, props.userId, session]);
  const contentRef = useRef<ReactNode>(content);
  const delayedCloseRef = useRef<number | null>(null);
  const autoOpenTimerRef = useRef<number | null>(null);
  const windowsRef = useRef(windows);
  const autoOpenedRef = useRef<string | null>(null);
  const windowTitle = session ? `${activityLabel(session)}收口` : "活动收口";

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  const windowDefinition = useMemo(() => ({
    key: "session-closeout",
    kind: "session-closeout",
    title: "活动收口",
    closePolicy: "minimizeOnly" as const,
    render: () => contentRef.current,
  }), []);

  useEffect(() => registerWindow(windowDefinition), [registerWindow, windowDefinition]);

  useEffect(() => {
    const shouldShowCloseout = Boolean(props.activeSession?.status === "closing" && !isActivitySourcePath(props.pathname, props.activeSession));
    if (autoOpenTimerRef.current !== null) {
      window.clearTimeout(autoOpenTimerRef.current);
      autoOpenTimerRef.current = null;
    }
    if (!shouldShowCloseout || !props.activeSession) {
      autoOpenedRef.current = null;
      return;
    }

    // Ensure the definition and instance in the same effect before asking the
    // provider to focus it. This keeps a persisted/minimized closeout
    // recoverable after a full navigation, even when the shared toolbar and
    // the closeout host mount in different effect turns.
    ensureWindow(windowDefinition);

    // A persisted closeout may still be minimized from a previous page load.
    // Open it once for each activity/page entry, then leave subsequent focus
    // changes (including an explicit minimize) to the user.
    const entryKey = `${props.activeSession.id}:${props.pathname}`;
    if (autoOpenedRef.current === entryKey) return;
    autoOpenedRef.current = entryKey;
    // Window persistence is restored asynchronously by the provider. Defer
    // the foreground request one macrotask so a stale minimized snapshot
    // cannot overwrite the first-load closeout intent.
    autoOpenTimerRef.current = window.setTimeout(() => {
      autoOpenTimerRef.current = null;
      openWindow("session-closeout");
    }, 100);
    return () => {
      if (autoOpenTimerRef.current !== null) {
        window.clearTimeout(autoOpenTimerRef.current);
        autoOpenTimerRef.current = null;
      }
    };
  }, [ensureWindow, openWindow, props.activeSession, props.pathname, windowDefinition]);

  useEffect(() => {
    contentRef.current = content;
    refreshWindow("session-closeout");
  }, [content, refreshWindow]);

  useEffect(() => {
    updateWindowMetadata("session-closeout", { kind: "session-closeout", title: windowTitle, closePolicy: "minimizeOnly" });
  }, [updateWindowMetadata, windowTitle]);

  useEffect(() => {
    // `/focus` renders the active session as its primary content. Keeping a
    // second global window there would duplicate the closeout form and make
    // unsaved input appear to split between two surfaces.
    const hasCloseoutWindow = windows.some((window) => window.key === "session-closeout");
    if (delayedCloseRef.current !== null) {
      window.clearTimeout(delayedCloseRef.current);
      delayedCloseRef.current = null;
    }
    if (props.activeSession && isActivitySourcePath(props.pathname, props.activeSession)) {
      if (hasCloseoutWindow) closeWindow("session-closeout");
      return;
    }
    if (props.activeSession?.status === "closing") {
      // Keep an existing minimized instance in the background. Only create a
      // missing instance here; focusing is reserved for the first appearance
      // or an explicit Dock click.
      return;
    }
    if ((!props.activeSession || props.activeSession.status === "completed" || props.activeSession.status === "canceled") && hasCloseoutWindow) {
      // During a client navigation the server layout can briefly render with
      // no active session before the authoritative status refresh arrives.
      // Delay cleanup so that transient null cannot destroy a recoverable
      // closeout window. Explicit terminal activity events still close it
      // immediately below.
      if (!props.activeSession) {
        delayedCloseRef.current = window.setTimeout(() => {
          delayedCloseRef.current = null;
          closeWindow("session-closeout");
        }, 750);
      } else {
        closeWindow("session-closeout");
      }
    }
    return () => {
      if (delayedCloseRef.current !== null) {
        window.clearTimeout(delayedCloseRef.current);
        delayedCloseRef.current = null;
      }
    };
  }, [closeWindow, props.activeSession, props.pathname, windows]);

  useEffect(() => subscribeActivityStatus((event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string; session?: StudySessionDto | null }>).detail;
    if (detail?.userId !== props.userId) return;
    const hasCloseoutWindow = windowsRef.current.some((window) => window.key === "session-closeout");
    if ((!detail.session || detail.session.status === "completed" || detail.session.status === "canceled") && hasCloseoutWindow) closeWindow("session-closeout");
  }), [closeWindow, props.pathname, props.userId]);

  return null;
}

function renderCloseoutContent(props: {
  session: StudySessionDto;
  userId: string;
  returnTo: string;
  initialNow: string;
}): ReactNode {
  if (props.session.activityMode === "FREE_STUDY") {
    return (
      <FocusSessionClient
        userId={props.userId}
        session={props.session}
        activeConflictId={null}
        returnTo={props.returnTo}
        initialNow={props.initialNow}
        initialEvidenceReceipts={[]}
        contextOptions={{ tasks: [], syllabusNodes: [], knowledgePoints: [] }}
        embeddedInWorkbench
      />
    );
  }

  if (props.session.activityMode === "RETEST" && props.session.knowledgeRetestId) {
    return <GlobalConfiguredCloseout kind="RETEST" entityId={props.session.knowledgeRetestId} userId={props.userId} returnTo={props.returnTo} initialNow={props.initialNow} />;
  }
  if (props.session.activityMode === "SIMULATION" && props.session.simulationExamId) {
    return <GlobalConfiguredCloseout kind="SIMULATION" entityId={props.session.simulationExamId} userId={props.userId} returnTo={props.returnTo} initialNow={props.initialNow} />;
  }
  if (props.session.activityMode === "KNOWLEDGE_REVIEW" && props.session.reviewScheduleId) {
    return <div className="flex items-center gap-2 text-sm text-zinc-400"><Repeat2 size={16} aria-hidden="true" />复习活动请在当前复习对象中完成收口。</div>;
  }
  return <p className="text-sm text-zinc-400">当前活动缺少专属收口对象，请刷新页面后重试。</p>;
}
