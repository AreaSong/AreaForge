import { activitySourcePath } from "@/lib/navigation/activity-route";
import {
  type CollectDynamicIslandStatesInput,
  type DynamicIslandActiveItem,
  type DynamicIslandCapsuleKind,
  type DynamicIslandCapsuleState,
  type DynamicIslandStateKind,
  type DynamicIslandStatePool,
  type DualTaskResolutionResult,
  IDLE_STATE_ITEM,
  PRIORITY_WEIGHTS,
} from "./dynamic-island-types";

/**
 * Checks if a specific dynamic island state kind should be suppressed on the given route.
 * Follows the "Context-Aware Anti-Redundancy" rule:
 * - /focus: suppresses stopwatch (live_session_running, live_session_closing, activity_paused)
 * - /today: suppresses recovery mode (recovery_active)
 * - /roadmap/reviews or /roadmap/reviews/*: suppresses evening review due (evening_review_due)
 *
 * @param kind - The dynamic island state/capsule kind
 * @param pathname - The current route pathname
 * @returns boolean indicating whether the state should be suppressed
 */
export function isStateSuppressedOnRoute(
  kind: DynamicIslandCapsuleKind | DynamicIslandStateKind,
  pathname?: string | null
): boolean {
  if (!pathname || typeof pathname !== "string") {
    return false;
  }

  // Strip query parameters, hash fragments, and normalize leading/trailing slashes
  const rawPath = pathname.split("?")[0].split("#")[0].trim();
  const normalized = rawPath.replace(/^\/+/, "/").replace(/\/+$/, "") || "/";
  const cleanPath = normalized.startsWith("/") ? normalized : `/${normalized}`;

  // 1. /focus suppression: live stopwatch states
  if (cleanPath === "/focus" || cleanPath.startsWith("/focus/")) {
    return (
      kind === "live_session_running" ||
      kind === "live_session_closing" ||
      kind === "activity_paused"
    );
  }

  // 2. /today suppression: recovery active
  if (cleanPath === "/today" || cleanPath.startsWith("/today/")) {
    return kind === "recovery_active";
  }

  // 3. /roadmap/reviews or /roadmap/reviews/* suppression: evening review due
  if (cleanPath === "/roadmap/reviews" || cleanPath.startsWith("/roadmap/reviews/")) {
    return kind === "evening_review_due";
  }

  return false;
}

/**
 * Filters dynamic island active states by route suppression rules.
 * Preserves the priority sorting of remaining unsuppressed states.
 *
 * @param states - Array of active state items
 * @param pathname - Current route pathname
 * @returns Array of unsuppressed active state items
 */
export function filterStatesByRouteContext(
  states: readonly DynamicIslandActiveItem[],
  pathname?: string | null
): DynamicIslandActiveItem[] {
  if (!states || states.length === 0) {
    return [];
  }
  if (!pathname || typeof pathname !== "string") {
    return [...states];
  }

  return states.filter((item) => !isStateSuppressedOnRoute(item.kind, pathname));
}

/**
 * Normalizes duration in seconds by flooring floating points and clamping negative / invalid values to 0.
 */
export function clampTimerDuration(seconds?: number): number {
  if (typeof seconds === "number" && Number.isFinite(seconds) && !Number.isNaN(seconds)) {
    return Math.max(0, Math.floor(seconds));
  }
  return 0;
}

/**
 * Returns numeric priority weight for a capsule kind.
 */
export function getPriorityWeight(kind: DynamicIslandCapsuleKind): number {
  return PRIORITY_WEIGHTS[kind] ?? 0;
}

/**
 * Returns a new instance of the idle state item.
 */
export function createIdleStateItem(): DynamicIslandActiveItem {
  return { ...IDLE_STATE_ITEM };
}

/**
 * Extracts all concurrently active states from shell input props.
 */
export function collectDynamicIslandActiveStates(
  input: CollectDynamicIslandStatesInput
): DynamicIslandActiveItem[] {
  if (!input) return [];

  const items: DynamicIslandActiveItem[] = [];
  const session = input.activeSession || input.offlineSession;
  const elapsed = clampTimerDuration(input.elapsedSeconds);

  // 1. Primary Session States (P0, P1, P2)
  if (session) {
    if (session.status === "running") {
      items.push({
        id: `session_running_${session.id}`,
        kind: "live_session_running",
        priorityWeight: PRIORITY_WEIGHTS.live_session_running,
        title: session.subjectName || "专注学习",
        subtitle: "正向心流计时",
        accentTone: "teal",
        session,
        elapsedSeconds: elapsed,
        quickAction: {
          label: "全屏/结束",
          type: "resume",
          href: activitySourcePath(session),
        },
      });
    } else if (session.status === "closing") {
      items.push({
        id: `session_closing_${session.id}`,
        kind: "live_session_closing",
        priorityWeight: PRIORITY_WEIGHTS.live_session_closing,
        title: session.subjectName || "专注学习",
        subtitle: "待收口沉淀",
        accentTone: "emerald",
        session,
        elapsedSeconds: elapsed,
        quickAction: {
          label: "去收口",
          type: "closeout",
          href: activitySourcePath(session),
        },
      });
    } else if (session.status === "paused") {
      items.push({
        id: `session_paused_${session.id}`,
        kind: "activity_paused",
        priorityWeight: PRIORITY_WEIGHTS.activity_paused,
        title: `${session.subjectName || "专注学习"} 暂停中`,
        subtitle: "已保存断点，随时可继续",
        accentTone: "amber",
        session,
        elapsedSeconds: elapsed,
        quickAction: {
          label: "继续",
          type: "resume",
        },
      });
    }
  }

  // 2. Recovery State (P3)
  if (input.recovery && input.recovery.active) {
    const stage = input.recovery.stage > 0 ? input.recovery.stage : 1;
    const targetMinutes = input.recovery.targetMinutes > 0 ? input.recovery.targetMinutes : 30;
    items.push({
      id: "recovery_active",
      kind: "recovery_active",
      priorityWeight: PRIORITY_WEIGHTS.recovery_active,
      title: `⚡ 恢复第${stage}阶`,
      subtitle: input.recovery.reason || `需完成${targetMinutes}分钟最小行动`,
      accentTone: "amber",
      stage,
      targetMinutes,
      reason: input.recovery.reason,
      quickAction: {
        label: "恢复指引",
        type: "recovery",
        action: input.recovery.onOpen,
      },
    });
  }

  // 3. Evening Review Due State (P4)
  if (input.eveningReview && input.eveningReview.due) {
    const reviewHref = input.eveningReview.reviewHref || "/roadmap/reviews/daily";
    items.push({
      id: "evening_review_due",
      kind: "evening_review_due",
      priorityWeight: PRIORITY_WEIGHTS.evening_review_due,
      title: "🌙 晚间复盘待收口",
      subtitle: input.eveningReview.minimumActionDone
        ? "最低行动已达成，完成每日复盘"
        : "最低行动与每日复盘待完成",
      accentTone: "indigo",
      minimumActionDone: Boolean(input.eveningReview.minimumActionDone),
      dailyReviewDone: Boolean(input.eveningReview.dailyReviewDone),
      reviewHref,
      quickAction: {
        label: "去收口",
        type: "closeout",
        href: reviewHref,
      },
    });
  }

  // 4. Offline Sync Issue (P5)
  if (input.syncState && input.syncState !== "current") {
    items.push({
      id: "sync_issue",
      kind: "sync_issue",
      priorityWeight: PRIORITY_WEIGHTS.sync_issue,
      title: input.syncState === "deferred" ? "离线待对账" : input.syncState === "blocked" ? "同步受阻" : "网络离线",
      subtitle: "本地专注记录待同步到云端",
      accentTone: "amber",
      syncState: input.syncState,
      quickAction: {
        label: "对账",
        type: "sync",
        action: input.onRetrySync,
      },
    });
  }

  // 5. Confirmations Pending (P6)
  const confCount =
    typeof input.pendingConfirmationsCount === "number" && Number.isFinite(input.pendingConfirmationsCount)
      ? input.pendingConfirmationsCount
      : typeof input.confirmationsCount === "number" && Number.isFinite(input.confirmationsCount)
      ? input.confirmationsCount
      : 0;

  if (confCount > 0) {
    items.push({
      id: "confirmations_pending",
      kind: "confirmations_pending",
      priorityWeight: PRIORITY_WEIGHTS.confirmations_pending,
      title: `${confCount}项待确认`,
      subtitle: "周期报告/阶段建议/AI草稿待审核",
      accentTone: "amber",
      pendingConfirmationsCount: confCount,
      quickAction: {
        label: "去确认",
        type: "confirmations",
      },
    });
  }

  return items;
}

/**
 * Sorts active items descending by deterministic priority weight.
 */
export function sortActiveStatesByPriority(
  states: readonly DynamicIslandActiveItem[]
): DynamicIslandActiveItem[] {
  return [...states].sort((a, b) => b.priorityWeight - a.priorityWeight);
}

/**
 * Gets the dominant state item from active states list, falling back to IDLE.
 */
export function getDominantState(
  states: readonly DynamicIslandActiveItem[]
): DynamicIslandActiveItem {
  if (!states || states.length === 0) return createIdleStateItem();
  return states[0];
}

/**
 * Alias for getDominantState.
 */
export const resolveDominantState = getDominantState;

/**
 * Resolves dual-task state representation (Dominant Main Capsule + Satellite Bubble).
 * Handles route-aware anti-redundancy filtering, sorting, and user-initiated fluid swap.
 *
 * @param states - Array of active items
 * @param pathname - Current route pathname for anti-redundancy suppression
 * @param swappedPrimaryKind - Optional state kind chosen by user to become dominant (fluid swap)
 * @returns DualTaskResolutionResult object with dominant, satellite, and unsuppressed states
 */
export function resolveDualTaskStates(
  states: readonly DynamicIslandActiveItem[],
  pathname?: string | null,
  swappedPrimaryKind?: DynamicIslandCapsuleKind | DynamicIslandStateKind | null
): DualTaskResolutionResult {
  const unsuppressed = filterStatesByRouteContext(states, pathname);
  const sorted = sortActiveStatesByPriority(unsuppressed);
  const unsuppressedCount = sorted.length;

  // Case 0: No unsuppressed states -> Idle dominant, null satellite
  if (unsuppressedCount === 0) {
    return {
      dominant: createIdleStateItem(),
      satellite: null,
      allUnsuppressed: [],
      unsuppressedCount: 0,
    };
  }

  // Case 1: Exactly 1 unsuppressed state -> Single dominant, null satellite
  if (unsuppressedCount === 1) {
    return {
      dominant: sorted[0],
      satellite: null,
      allUnsuppressed: sorted,
      unsuppressedCount: 1,
    };
  }

  // Case 2: >= 2 unsuppressed states -> Dual-task mode
  // If user requested a swap, select that state as dominant and the top/other as satellite
  if (swappedPrimaryKind) {
    const targetIdx = sorted.findIndex((s) => s.kind === swappedPrimaryKind);
    if (targetIdx !== -1) {
      const dominant = sorted[targetIdx];
      const satellite = targetIdx === 0 ? sorted[1] : sorted[0];
      return {
        dominant,
        satellite,
        allUnsuppressed: sorted,
        unsuppressedCount,
      };
    }
  }

  // Default dual-task: highest priority is dominant, 2nd highest is satellite
  return {
    dominant: sorted[0],
    satellite: sorted[1],
    allUnsuppressed: sorted,
    unsuppressedCount,
  };
}

/**
 * Main state engine function computing the full multi-state pool,
 * incorporating route context suppression.
 */
export function computeDynamicIslandStatePool(
  input: CollectDynamicIslandStatesInput
): DynamicIslandStatePool {
  const rawStates = collectDynamicIslandActiveStates(input ?? {});
  const filteredStates = input?.pathname
    ? filterStatesByRouteContext(rawStates, input.pathname)
    : rawStates;
  const sortedStates = sortActiveStatesByPriority(filteredStates);
  const dominantState = getDominantState(sortedStates);

  return {
    activeStates: sortedStates,
    dominantState,
    hasConcurrency: sortedStates.length > 1,
    concurrencyCount: sortedStates.length,
  };
}

/**
 * Alias for computeDynamicIslandStatePool.
 */
export const collectDynamicIslandStatePool = computeDynamicIslandStatePool;


/**
 * Validates invariant consistency of a computed DynamicIslandStatePool.
 */
export function validateStatePoolInvariants(pool: DynamicIslandStatePool): boolean {
  if (!pool || !pool.dominantState) return false;
  if (pool.concurrencyCount !== pool.activeStates.length) return false;
  if (pool.hasConcurrency !== (pool.activeStates.length > 1)) return false;

  for (let i = 0; i < pool.activeStates.length - 1; i++) {
    if (pool.activeStates[i].priorityWeight < pool.activeStates[i + 1].priorityWeight) {
      return false;
    }
  }

  if (pool.activeStates.length > 0) {
    if (pool.dominantState.id !== pool.activeStates[0].id) return false;
  } else {
    if (pool.dominantState.kind !== "idle") return false;
  }

  return true;
}

/**
 * Backward compatibility resolver matching the legacy signature.
 */
export function resolveDynamicIslandState(input: {
  activeSession?: CollectDynamicIslandStatesInput["activeSession"];
  offlineSession?: CollectDynamicIslandStatesInput["offlineSession"];
  syncState?: CollectDynamicIslandStatesInput["syncState"];
  recovery?: CollectDynamicIslandStatesInput["recovery"];
  eveningReview?: CollectDynamicIslandStatesInput["eveningReview"];
  confirmationsCount?: number;
  pendingConfirmationsCount?: number;
  elapsedSeconds?: number;
}): DynamicIslandCapsuleState {
  const pool = computeDynamicIslandStatePool(input ?? {});
  const dominant = pool.dominantState;

  if (dominant.kind === "idle") {
    return { kind: "idle" };
  }

  return {
    kind: dominant.kind,
    session: dominant.session,
    elapsedSeconds:
      dominant.elapsedSeconds ??
      (typeof input?.elapsedSeconds === "number" ? clampTimerDuration(input.elapsedSeconds) : 0),
    stage: dominant.stage,
    targetMinutes: dominant.targetMinutes,
    reason: dominant.reason,
    minimumActionDone: dominant.minimumActionDone,
    dailyReviewDone: dominant.dailyReviewDone,
    reviewHref: dominant.reviewHref,
    syncState: dominant.syncState,
    pendingConfirmationsCount: dominant.pendingConfirmationsCount,
  };
}
