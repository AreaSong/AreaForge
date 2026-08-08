export type WindowClosePolicy = "free" | "confirmDiscard" | "minimizeOnly";
export type WindowWorkState = "clean" | "dirty" | "submitting" | "syncPending" | "conflict" | "completed";

export interface WindowInstance {
  key: string;
  kind: string;
  title: string;
  minimized: boolean;
  focused: boolean;
  closePolicy: WindowClosePolicy;
  workState: WindowWorkState;
  openedAt: number;
  updatedAt: number;
}

export interface WindowDefinitionMeta {
  key: string;
  kind: string;
  title: string;
  closePolicy?: WindowClosePolicy;
}

export function upsertWindow(
  current: WindowInstance[],
  definition: WindowDefinitionMeta,
  now: number,
): WindowInstance[] {
  const existing = current.find((window) => window.key === definition.key);
  if (existing) {
    return current.map((window) => ({
      ...window,
      minimized: window.key === definition.key ? false : window.minimized,
      focused: window.key === definition.key,
      updatedAt: window.key === definition.key ? now : window.updatedAt,
    }));
  }

  return [
    ...current.map((window) => ({ ...window, focused: false })),
    {
      key: definition.key,
      kind: definition.kind,
      title: definition.title,
      minimized: false,
      focused: true,
      closePolicy: definition.closePolicy ?? "free",
      workState: "clean",
      openedAt: now,
      updatedAt: now,
    },
  ];
}

export function focusWindow(current: WindowInstance[], key: string, now: number): WindowInstance[] {
  return current.map((window) => ({
    ...window,
    minimized: window.key === key ? false : window.minimized,
    focused: window.key === key,
    updatedAt: window.key === key ? now : window.updatedAt,
  }));
}

export function minimizeWindow(current: WindowInstance[], key: string): WindowInstance[] {
  return current.map((window) => ({
    ...window,
    minimized: window.key === key ? true : window.minimized,
    focused: window.key === key ? false : window.focused,
  }));
}

export function closeWindow(current: WindowInstance[], key: string): WindowInstance[] {
  return current.filter((window) => window.key !== key);
}

export function closeOrMinimizeWindow(current: WindowInstance[], key: string): WindowInstance[] {
  const target = current.find((window) => window.key === key);
  if (!target) return current;
  if (target.closePolicy === "minimizeOnly") return minimizeWindow(current, key);
  return closeWindow(current, key);
}

export function nextForegroundKey(current: WindowInstance[], closedKey?: string): string | null {
  return current
    .filter((window) => window.key !== closedKey && !window.minimized)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.key ?? null;
}

/**
 * Calculate how many background windows can remain inline in the Dock.
 *
 * The Dock must reserve the actual width of the "more" affordance only when
 * at least one item is hidden. The old fixed-item-count calculation could
 * collapse a window even though the measured row still had room.
 */
export function calculateVisibleWindowCount(
  availableWidth: number,
  itemWidths: readonly number[],
  moreWidthByHiddenCount: ReadonlyMap<number, number> | Readonly<Record<number, number>> = new Map(),
  gap = 8,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || itemWidths.length === 0) return 0;

  const widthForHiddenCount = (hiddenCount: number): number => {
    if (moreWidthByHiddenCount instanceof Map) {
      return moreWidthByHiddenCount.get(hiddenCount) ?? moreWidthByHiddenCount.get(1) ?? 0;
    }
    const record = moreWidthByHiddenCount as Readonly<Record<number, number>>;
    return record[hiddenCount] ?? record[1] ?? 0;
  };

  const allWidth = itemWidths.reduce((sum, width) => sum + Math.max(0, width), 0)
    + gap * Math.max(0, itemWidths.length - 1);
  if (allWidth <= availableWidth) return itemWidths.length;

  let usedWidth = 0;
  let visibleCount = 0;
  for (const rawWidth of itemWidths) {
    const width = Math.max(0, rawWidth);
    const nextWidth = usedWidth + (visibleCount > 0 ? gap : 0) + width;
    const hiddenCount = itemWidths.length - visibleCount - 1;
    const moreWidth = hiddenCount > 0 ? gap + widthForHiddenCount(hiddenCount) : 0;
    if (nextWidth + moreWidth > availableWidth) break;
    usedWidth = nextWidth;
    visibleCount += 1;
  }
  return visibleCount;
}

export function normalizePersistedWindows(value: unknown): WindowInstance[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, WindowInstance>();
  for (const item of value) {
    if (!isWindowInstance(item)) continue;
    const previous = byKey.get(item.key);
    if (!previous || item.updatedAt >= previous.updatedAt) {
      byKey.set(item.key, { ...item, focused: false, minimized: true });
    }
  }
  return [...byKey.values()].sort((left, right) => left.openedAt - right.openedAt);
}

/**
 * Persistence is restored asynchronously to keep hydration deterministic. A
 * window opened during that gap is newer runtime state and must not be
 * replaced by the older storage snapshot.
 */
export function mergeRestoredWindows(
  current: WindowInstance[],
  persisted: WindowInstance[],
): WindowInstance[] {
  const byKey = new Map(persisted.map((window) => [window.key, window]));
  for (const window of current) byKey.set(window.key, window);
  return [...byKey.values()].sort((left, right) => left.openedAt - right.openedAt);
}

export function mergeExternalWindows(
  current: WindowInstance[],
  incoming: WindowInstance[],
  foregroundKey: string | null,
): { windows: WindowInstance[]; foregroundKey: string | null } {
  const currentByKey = new Map(current.map((window) => [window.key, window]));
  const windows = incoming.map((window) => {
    const local = currentByKey.get(window.key);
    if (!local) return { ...window, focused: false, minimized: true };
    return { ...window, minimized: local.minimized, focused: local.focused };
  });
  return {
    windows,
    foregroundKey: foregroundKey && windows.some((window) => window.key === foregroundKey) ? foregroundKey : null,
  };
}

export function isWindowInstance(value: unknown): value is WindowInstance {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WindowInstance>;
  return typeof item.key === "string"
    && typeof item.kind === "string"
    && typeof item.title === "string"
    && typeof item.openedAt === "number"
    && typeof item.updatedAt === "number"
    && (item.closePolicy === "free" || item.closePolicy === "confirmDiscard" || item.closePolicy === "minimizeOnly")
    && (item.workState === "clean" || item.workState === "dirty" || item.workState === "submitting" || item.workState === "syncPending" || item.workState === "conflict" || item.workState === "completed");
}
