"use client";

import type React from "react";
import type {
  GlobalCommandAction,
  GlobalCommandDefinition,
} from "@/lib/navigation/command-palette";
import type {
  DynamicIslandActiveItem,
  DynamicIslandAuraTheme,
  DynamicIslandEveningReviewProps,
  DynamicIslandHubTab,
} from "./dynamic-island-types";
import { getAuraThemeForStateKind } from "./dynamic-island-glow";
import {
  normalizeHubTab,
  HubViewModeTabs,
  HubCommandPaletteList,
  type HubViewMode,
} from "./dynamic-island-hub-nav";
import { HubSupervisionOverview } from "./dynamic-island-hub-overview";
import { HubFlowStopwatchPanel } from "./dynamic-island-hub-focus";
import { HubConfirmationClosureGuide } from "./dynamic-island-hub-closure";

export {
  normalizeHubTab,
  HubViewModeTabs,
  HubCommandPaletteList,
  HubSupervisionOverview,
  HubFlowStopwatchPanel,
  HubConfirmationClosureGuide,
  type HubViewMode,
};

export interface DynamicIslandHubProps {
  isOpen: boolean;
  viewMode: HubViewMode;
  onViewModeChange: (mode: HubViewMode) => void;
  onClose: () => void;
  activeStates: readonly DynamicIslandActiveItem[];
  dominantState: DynamicIslandActiveItem;
  elapsedSeconds: number;
  isResuming?: boolean;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  commands: readonly GlobalCommandDefinition[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  onExecuteCommand: (cmd: GlobalCommandDefinition) => void;
  onDirectResume: (e?: React.MouseEvent) => Promise<void> | void;
  onRetrySync?: () => void;
  onOpenRecovery?: () => void;
  onOpenAction?: (cmd: GlobalCommandAction) => void;
  eveningReview?: DynamicIslandEveningReviewProps | null;
  pendingConfirmationsCount?: number;
  auraTheme?: DynamicIslandAuraTheme;
  pathname?: string | null;
  defaultTab?: DynamicIslandHubTab;
}

function HubActivePanel(
  props: DynamicIslandHubProps & { auraTheme: DynamicIslandAuraTheme }
) {
  const {
    viewMode,
    commands,
    selectedIndex,
    onSelectIndex,
    onExecuteCommand,
    activeStates,
    dominantState,
    elapsedSeconds,
    isResuming = false,
    onDirectResume,
    onOpenRecovery,
    onRetrySync,
    onOpenAction,
    onClose,
    eveningReview,
    pendingConfirmationsCount = 0,
    auraTheme,
  } = props;

  const normalized = normalizeHubTab(viewMode);

  if (normalized === "search") {
    return (
      <HubCommandPaletteList
        commands={commands}
        selectedIndex={selectedIndex}
        onSelectIndex={onSelectIndex}
        onExecuteCommand={onExecuteCommand}
        auraTheme={auraTheme}
      />
    );
  }
  if (normalized === "overview") {
    return (
      <HubSupervisionOverview
        activeStates={activeStates}
        dominantState={dominantState}
        elapsedSeconds={elapsedSeconds}
        isResuming={isResuming}
        onDirectResume={onDirectResume}
        onOpenRecovery={onOpenRecovery}
        onRetrySync={onRetrySync}
        onOpenAction={onOpenAction}
        onClose={onClose}
        auraTheme={auraTheme}
      />
    );
  }
  if (normalized === "focus") {
    return (
      <HubFlowStopwatchPanel
        activeItem={activeStates.find((s) => s.session) || dominantState}
        dominantState={dominantState}
        elapsedSeconds={elapsedSeconds}
        isResuming={isResuming}
        onDirectResume={onDirectResume}
        onClose={onClose}
        auraTheme={auraTheme}
      />
    );
  }
  return (
    <HubConfirmationClosureGuide
      pendingConfirmationsCount={pendingConfirmationsCount}
      eveningReview={eveningReview}
      onOpenAction={onOpenAction}
      onClose={onClose}
      auraTheme={auraTheme}
    />
  );
}

export function DynamicIslandHub(props: DynamicIslandHubProps) {
  const {
    viewMode,
    onViewModeChange,
    activeStates,
    dominantState,
    eveningReview,
    pendingConfirmationsCount = 0,
  } = props;

  const auraTheme: DynamicIslandAuraTheme =
    props.auraTheme ??
    (dominantState ? getAuraThemeForStateKind(dominantState.kind) : "silver");

  const hasRunningSession = activeStates.some(
    (s) => s.kind === "live_session_running" || s.kind === "activity_paused"
  );
  const eveningDue = Boolean(eveningReview?.due);

  return (
    <div className="w-full text-xs">
      <HubViewModeTabs
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        activeStatesCount={activeStates.filter((s) => s.kind !== "idle").length}
        hasRunningSession={hasRunningSession}
        pendingConfirmationsCount={pendingConfirmationsCount}
        eveningDue={eveningDue}
        auraTheme={auraTheme}
        dominantState={dominantState}
      />
      <div className="pt-0.5">
        <HubActivePanel {...props} auraTheme={auraTheme} />
      </div>
    </div>
  );
}

export const MorphingFloatingHub = DynamicIslandHub;
