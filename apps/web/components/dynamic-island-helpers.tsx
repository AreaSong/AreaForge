"use client";

import {
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import { getTimerElapsedSeconds } from "@areaforge/core";
import {
  GLOBAL_COMMANDS,
  getGlobalCommandHref,
  resolveGlobalCommand,
  type GlobalCommandAction,
  type GlobalCommandDefinition,
} from "@/lib/navigation/command-palette";
import { postStudySessionCommand } from "@/lib/api/session";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { publishActivityStatus } from "@/lib/client/activity-status";
import {
  MorphingFloatingHub,
  type HubViewMode,
  type DynamicIslandHubProps,
} from "./dynamic-island-hub";
import {
  CapsuleLeftSegment,
  CapsuleCenterSegment,
  CapsuleRightSegment,
} from "./dynamic-island-segments";
import type { StudySessionDto } from "@/lib/contracts";
import type {
  DynamicIslandCapsuleKind,
  DynamicIslandActiveItem,
} from "./dynamic-island-types";
import { getLiquidFoldAnimationClass, type LiquidMorphPhase } from "./dynamic-island-morph";

const serverNowSnapshot = 0;
let nowSnapshot = serverNowSnapshot;
let nowTimer: number | null = null;
const nowListeners = new Set<() => void>();

export function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null && typeof window !== "undefined") {
    nowSnapshot = Date.now();
    listener();
    nowTimer = window.setInterval(() => {
      nowSnapshot = Date.now();
      for (const currentListener of nowListeners) currentListener();
    }, 1_000);
  }
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer !== null) {
      window.clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

export function getNowSnapshot(): number {
  return nowSnapshot;
}

export function getServerNowSnapshot(): number {
  return serverNowSnapshot;
}

export function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tagName = el.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  return Boolean((el as HTMLElement).isContentEditable);
}

export function useDynamicIslandElapsed(
  activeSession: StudySessionDto | null,
  offlineSession: StudySessionDto | null
): { session: StudySessionDto | null; elapsedSeconds: number } {
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);
  const session = activeSession || offlineSession;

  const elapsedSeconds = session
    ? getTimerElapsedSeconds({
        status: session.status === "running" ? "running" : session.status === "paused" ? "paused" : "completed",
        startedAt: new Date(session.startedAt),
        pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
        endedAt: session.endedAt ? new Date(session.endedAt) : undefined,
        accumulatedPauseSeconds: session.accumulatedPauseSeconds,
        now: new Date(now),
      })
    : 0;

  return { session, elapsedSeconds };
}

export function resolveOverviewMode(kind: DynamicIslandCapsuleKind): HubViewMode {
  if (kind === "live_session_running" || kind === "activity_paused" || kind === "live_session_closing") {
    return "focus";
  }
  if (kind === "evening_review_due" || kind === "confirmations_pending") {
    return "closure";
  }
  return "overview";
}

export function useDynamicIslandHandlers(
  query: string,
  setQuery: (q: string) => void,
  commands: readonly GlobalCommandDefinition[],
  selectedIndex: number,
  setActiveIndex: Dispatch<SetStateAction<number>>,
  setIsOpen: (o: boolean) => void,
  setViewMode: (m: HubViewMode) => void,
  inputRef: RefObject<HTMLInputElement | null>,
  onOpenAction: (a: GlobalCommandAction) => void
) {
  const router = useRouter();

  function executeCommand(command: GlobalCommandDefinition) {
    const resolved = resolveGlobalCommand(query, commands);
    const execution = resolved?.definition.id === command.id
      ? resolved.execution : { rawQuery: query, argumentText: "", args: [], namedArgs: {} };
    const href = getGlobalCommandHref(command, execution);
    if (href) router.push(href);
    if (command.action) onOpenAction(command.action);
    setIsOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (commands.length ? (prev + 1) % commands.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (commands.length ? (prev - 1 + commands.length) % commands.length : 0));
    } else if (e.key === "Enter" && commands[selectedIndex]) {
      e.preventDefault();
      executeCommand(commands[selectedIndex]);
    }
  }

  return { executeCommand, handleInputKeyDown };
}

export function useDirectResumeSession(
  userId: string,
  currentItem: DynamicIslandActiveItem,
  session: StudySessionDto | null,
  onResumeSession?: (id: string) => Promise<void>
) {
  const [isResuming, setIsResuming] = useState(false);

  async function handleDirectResume(e?: MouseEvent) {
    e?.stopPropagation();
    const resumeSession = currentItem.session || session;
    if (!resumeSession?.id || isResuming) return;
    setIsResuming(true);
    try {
      if (onResumeSession) {
        await onResumeSession(resumeSession.id);
      } else {
        const res = await postStudySessionCommand(resumeSession.id, "resume", {}, getClientDeviceHeaders());
        if (res.ok && res.body?.session) publishActivityStatus(userId, res.body.session);
      }
    } finally {
      setIsResuming(false);
    }
  }

  return { isResuming, handleDirectResume };
}

export function useDirectPauseSession(
  userId: string,
  currentItem: DynamicIslandActiveItem,
  session: StudySessionDto | null
) {
  const [isPausing, setIsPausing] = useState(false);

  async function handleDirectPause(e?: MouseEvent) {
    e?.stopPropagation();
    const pauseSession = currentItem.session || session;
    if (!pauseSession?.id || isPausing) return;
    setIsPausing(true);
    try {
      const res = await postStudySessionCommand(pauseSession.id, "pause", {}, getClientDeviceHeaders());
      if (res.ok && res.body?.session) publishActivityStatus(userId, res.body.session);
    } finally {
      setIsPausing(false);
    }
  }

  return { isPausing, handleDirectPause };
}

export function DynamicIslandCollapsedBar(props: {
  currentItem: DynamicIslandActiveItem;
  tickerTotalStates: number;
  tickerCurrentIndex: number;
  query: string;
  onQueryChange: (q: string) => void;
  onOpenSearch: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClearQuery: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isOpen: boolean;
  isResuming: boolean;
  isPausing?: boolean;
  elapsedSeconds: number;
  onOpenOverview: (e?: MouseEvent) => void;
  onOpenFocus: (e?: MouseEvent) => void;
  onDirectResume: (e?: MouseEvent) => Promise<void>;
  onDirectPause?: (e?: MouseEvent) => Promise<void>;
  onRetrySync?: () => void;
  onCloseDrawer: () => void;
}) {
  return (
    <div className="flex h-9 w-full min-w-0 items-center justify-between gap-2 px-3 text-xs">
      <CapsuleLeftSegment
        activeItem={props.currentItem}
        activeCount={props.tickerTotalStates}
        tickerIndex={props.tickerCurrentIndex}
        onOpenOverview={props.onOpenOverview}
        onTriggerOpen={props.onOpenOverview}
      />
      <CapsuleCenterSegment
        query={props.query}
        onQueryChange={props.onQueryChange}
        onOpenSearch={props.onOpenSearch}
        onKeyDown={props.onKeyDown}
        onClearQuery={props.onClearQuery}
        inputRef={props.inputRef}
        activeKind={props.currentItem.kind}
      />
      <CapsuleRightSegment
        activeItem={props.currentItem}
        isOpen={props.isOpen}
        isResuming={props.isResuming}
        isPausing={props.isPausing}
        elapsedSeconds={props.elapsedSeconds}
        onTriggerOpen={props.onOpenOverview}
        onOpenFocus={props.onOpenFocus}
        onDirectResume={props.onDirectResume}
        onDirectPause={props.onDirectPause}
        onRetrySync={props.onRetrySync}
        onCloseDrawer={props.onCloseDrawer}
      />
    </div>
  );
}

export function DynamicIslandExpandedFold(props: {
  isOpen: boolean;
  phase?: LiquidMorphPhase;
  hubProps: DynamicIslandHubProps;
}) {
  const currentPhase: LiquidMorphPhase = props.phase ?? (props.isOpen ? "expanded_p2" : "collapsing_p1");
  const foldStyles = getLiquidFoldAnimationClass(currentPhase);

  return (
    <div className={foldStyles.containerGridClass}>
      <div className="overflow-hidden">
        <div className={foldStyles.innerContentClass}>
          <MorphingFloatingHub {...props.hubProps} />
        </div>
      </div>
    </div>
  );
}
