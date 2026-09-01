import type { StudySessionDto } from "@/lib/contracts";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { FocusOfflineSyncState } from "@/lib/client/focus-offline-store";
import type { ShellSyncState } from "@/lib/client/app-shell-projection";

export type DynamicIslandCapsuleKind =
  | "live_session_running"
  | "live_session_closing"
  | "activity_paused"
  | "recovery_active"
  | "evening_review_due"
  | "sync_issue"
  | "confirmations_pending"
  | "idle";

export type DynamicIslandStateKind =
  | DynamicIslandCapsuleKind
  | "command_search";

export type DynamicIslandStateItem = DynamicIslandActiveItem;

export type DynamicIslandAuraTheme = "indigo" | "amber" | "teal" | "silver";

export type DynamicIslandHubTab =
  | "status"
  | "stopwatch"
  | "evening"
  | "search"
  | "overview"
  | "focus"
  | "closure";

export interface DualTaskResolutionResult {
  dominant: DynamicIslandStateItem;
  satellite: DynamicIslandStateItem | null;
  allUnsuppressed: DynamicIslandStateItem[];
  unsuppressedCount?: number;
}

export type DualTaskStateResolution = DualTaskResolutionResult;
export type DynamicIslandDualTaskState = DualTaskResolutionResult;

export type DynamicIslandSyncState = FocusOfflineSyncState | ShellSyncState;

export type DynamicIslandTone = "teal" | "emerald" | "amber" | "indigo" | "rose" | "zinc";

export interface DynamicIslandRecoveryProps {
  active: boolean;
  stage: number;
  targetMinutes: number;
  reason?: string;
  onOpen?: () => void;
}

export interface DynamicIslandEveningReviewProps {
  due: boolean;
  minimumActionDone: boolean;
  dailyReviewDone: boolean;
  reviewHref?: string;
  onOpen?: () => void;
}

export interface DynamicIslandQuickAction {
  label: string;
  type: "resume" | "closeout" | "sync" | "recovery" | "confirmations" | "search" | "review";
  action?: () => Promise<void> | void;
  href?: string;
}

export interface DynamicIslandActiveItem {
  id: string;
  kind: DynamicIslandCapsuleKind;
  priorityWeight: number; // P0: 1000, P1: 900, P2: 800, P3: 700, P4: 600, P5: 500, P6: 400, P7: 0
  title: string;
  subtitle?: string;
  accentTone: DynamicIslandTone;
  session?: StudySessionDto;
  elapsedSeconds?: number;
  stage?: number;
  targetMinutes?: number;
  reason?: string;
  minimumActionDone?: boolean;
  dailyReviewDone?: boolean;
  reviewHref?: string;
  syncState?: DynamicIslandSyncState;
  pendingConfirmationsCount?: number;
  quickReviewClaim?: QuickReviewActivityClaim;
  quickAction?: DynamicIslandQuickAction;
}

export interface DynamicIslandStatePool {
  activeStates: DynamicIslandActiveItem[];
  dominantState: DynamicIslandActiveItem;
  hasConcurrency: boolean;
  concurrencyCount: number;
}

export interface CollectDynamicIslandStatesInput {
  pathname?: string | null;
  activeSession?: StudySessionDto | null;
  offlineSession?: StudySessionDto | null;
  syncState?: DynamicIslandSyncState;
  recovery?: DynamicIslandRecoveryProps | null;
  eveningReview?: DynamicIslandEveningReviewProps | null;
  quickReviewClaim?: QuickReviewActivityClaim | null;
  confirmationsCount?: number;
  pendingConfirmationsCount?: number;
  elapsedSeconds?: number;
  onRetrySync?: () => void;
  onResumeSession?: (sessionId: string) => Promise<void>;
}

export type DynamicIslandStateEngineInput = CollectDynamicIslandStatesInput;

export interface DynamicIslandCapsuleState {
  kind: DynamicIslandCapsuleKind;
  session?: StudySessionDto;
  elapsedSeconds?: number;
  stage?: number;
  targetMinutes?: number;
  reason?: string;
  minimumActionDone?: boolean;
  dailyReviewDone?: boolean;
  reviewHref?: string;
  syncState?: DynamicIslandSyncState;
  pendingConfirmationsCount?: number;
}

export const PRIORITY_WEIGHTS: Record<DynamicIslandCapsuleKind, number> = {
  live_session_running: 1000,
  live_session_closing: 900,
  activity_paused: 800,
  recovery_active: 700,
  evening_review_due: 600,
  sync_issue: 500,
  confirmations_pending: 400,
  idle: 0,
} as const;

export const IDLE_STATE_ITEM: DynamicIslandActiveItem = {
  id: "state_idle",
  kind: "idle",
  priorityWeight: PRIORITY_WEIGHTS.idle,
  title: "AreaForge",
  subtitle: "搜索或输入命令… ⌘K",
  accentTone: "zinc",
  quickAction: {
    label: "搜索命令",
    type: "search",
  },
};

