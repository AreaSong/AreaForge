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

export interface WindowRegistryValue {
  kind: string;
  title: string;
  closePolicy: WindowClosePolicy;
  workState: WindowWorkState;
  openedAt: number;
  updatedAt: number;
}

export interface WindowVersionStamp {
  counter: number;
  actorId: string;
}

/** A null value is a tombstone. It prevents an older tab from reviving a closed window. */
export interface WindowRegistryRecord {
  key: string;
  value: WindowRegistryValue | null;
  stamp: WindowVersionStamp;
}

export interface WindowRegistryState {
  version: 2;
  records: WindowRegistryRecord[];
}

export const WINDOW_REGISTRY_VERSION = 2 as const;

export function emptyWindowRegistry(): WindowRegistryState {
  return { version: WINDOW_REGISTRY_VERSION, records: [] };
}

export function maxWindowRegistryCounter(state: WindowRegistryState): number {
  return state.records.reduce((maximum, record) => Math.max(maximum, record.stamp.counter), 0);
}

export function compareWindowStamps(left: WindowVersionStamp, right: WindowVersionStamp): number {
  if (left.counter !== right.counter) return left.counter - right.counter;
  if (left.actorId === right.actorId) return 0;
  return left.actorId < right.actorId ? -1 : 1;
}

export function upsertRegistryWindow(
  current: WindowRegistryState,
  definition: WindowDefinitionMeta,
  now: number,
  stamp: WindowVersionStamp,
): WindowRegistryState {
  const existing = getActiveRegistryRecord(current, definition.key);
  const closePolicy = definition.closePolicy ?? existing?.value?.closePolicy ?? "free";
  if (
    existing?.value
    && existing.value.kind === definition.kind
    && existing.value.title === definition.title
    && existing.value.closePolicy === closePolicy
  ) {
    return current;
  }

  return replaceRegistryRecord(current, {
    key: definition.key,
    stamp,
    value: {
      kind: definition.kind,
      title: definition.title,
      closePolicy,
      workState: existing?.value?.workState ?? "clean",
      openedAt: existing?.value?.openedAt ?? now,
      updatedAt: now,
    },
  });
}

export function updateRegistryWindowMetadata(
  current: WindowRegistryState,
  key: string,
  metadata: Pick<WindowDefinitionMeta, "kind" | "title" | "closePolicy">,
  now: number,
  stamp: WindowVersionStamp,
): WindowRegistryState {
  const existing = getActiveRegistryRecord(current, key);
  if (!existing?.value) return current;
  const closePolicy = metadata.closePolicy ?? existing.value.closePolicy;
  if (
    existing.value.kind === metadata.kind
    && existing.value.title === metadata.title
    && existing.value.closePolicy === closePolicy
  ) {
    return current;
  }
  return replaceRegistryRecord(current, {
    key,
    stamp,
    value: { ...existing.value, ...metadata, closePolicy, updatedAt: now },
  });
}

export function updateRegistryWindowWorkState(
  current: WindowRegistryState,
  key: string,
  workState: WindowWorkState,
  now: number,
  stamp: WindowVersionStamp,
): WindowRegistryState {
  const existing = getActiveRegistryRecord(current, key);
  if (!existing?.value || existing.value.workState === workState) return current;
  return replaceRegistryRecord(current, {
    key,
    stamp,
    value: { ...existing.value, workState, updatedAt: now },
  });
}

export function deleteRegistryWindow(
  current: WindowRegistryState,
  key: string,
  stamp: WindowVersionStamp,
): WindowRegistryState {
  const existing = current.records.find((record) => record.key === key);
  if (!existing || existing.value === null) return current;
  return replaceRegistryRecord(current, { key, value: null, stamp });
}

export function hasRegistryWindow(current: WindowRegistryState, key: string): boolean {
  return Boolean(getActiveRegistryRecord(current, key));
}

export function getRegistryWindow(current: WindowRegistryState, key: string): WindowRegistryValue | null {
  return getActiveRegistryRecord(current, key)?.value ?? null;
}

export function materializeWindowInstances(
  registry: WindowRegistryState,
  foregroundKey: string | null,
): WindowInstance[] {
  return registry.records
    .filter((record): record is WindowRegistryRecord & { value: WindowRegistryValue } => record.value !== null)
    .map((record) => ({
      key: record.key,
      ...record.value,
      minimized: record.key !== foregroundKey,
      focused: record.key === foregroundKey,
    }))
    .sort((left, right) => left.openedAt - right.openedAt || left.key.localeCompare(right.key));
}

export function minimizeForegroundWindow(foregroundKey: string | null, key: string): string | null {
  return foregroundKey === key ? null : foregroundKey;
}

export function mergeWindowRegistries(
  left: WindowRegistryState,
  right: WindowRegistryState,
): WindowRegistryState {
  const records = new Map<string, WindowRegistryRecord>();
  for (const record of [...left.records, ...right.records]) {
    const existing = records.get(record.key);
    if (!existing || compareRegistryRecords(existing, record) < 0) records.set(record.key, record);
  }
  const merged = { version: WINDOW_REGISTRY_VERSION, records: [...records.values()].sort(compareRecordKeys) };
  if (windowRegistriesEqual(left, merged)) return left;
  if (windowRegistriesEqual(right, merged)) return right;
  return merged;
}

export function normalizeWindowRegistry(value: unknown): WindowRegistryState {
  if (!value || typeof value !== "object") return emptyWindowRegistry();
  const state = value as Partial<WindowRegistryState>;
  if (state.version !== WINDOW_REGISTRY_VERSION || !Array.isArray(state.records)) return emptyWindowRegistry();

  const records = new Map<string, WindowRegistryRecord>();
  for (const candidate of state.records) {
    const record = normalizeRegistryRecord(candidate);
    if (!record) continue;
    const existing = records.get(record.key);
    if (!existing || compareRegistryRecords(existing, record) < 0) records.set(record.key, record);
  }
  return { version: WINDOW_REGISTRY_VERSION, records: [...records.values()].sort(compareRecordKeys) };
}

export function migrateLegacyWindowRegistry(value: unknown): WindowRegistryState {
  const state = Array.isArray(value)
    ? { revision: 0, windows: value }
    : value && typeof value === "object"
      ? value as { revision?: unknown; windows?: unknown }
      : null;
  if (!state || !Array.isArray(state.windows)) return emptyWindowRegistry();

  const revision = typeof state.revision === "number" && Number.isFinite(state.revision)
    ? Math.max(0, Math.trunc(state.revision))
    : 0;
  const byKey = new Map<string, WindowInstance>();
  for (const item of state.windows) {
    if (!isWindowInstance(item)) continue;
    const previous = byKey.get(item.key);
    if (!previous || item.updatedAt >= previous.updatedAt) byKey.set(item.key, item);
  }

  const windows = [...byKey.values()].sort((left, right) => left.openedAt - right.openedAt || left.key.localeCompare(right.key));
  return {
    version: WINDOW_REGISTRY_VERSION,
    records: windows.map((window, index) => ({
      key: window.key,
      stamp: { counter: revision + index + 1, actorId: "legacy-v1" },
      value: {
        kind: window.kind,
        title: window.title,
        closePolicy: window.closePolicy,
        workState: window.workState,
        openedAt: window.openedAt,
        updatedAt: window.updatedAt,
      },
    })),
  };
}

export function windowRegistriesEqual(left: WindowRegistryState, right: WindowRegistryState): boolean {
  if (left.records.length !== right.records.length) return false;
  return left.records.every((record, index) => registryRecordKey(record) === registryRecordKey(right.records[index]!));
}

/**
 * Calculate how many background windows can remain inline in the Dock.
 * A single final item stays visible and is allowed to truncate to the width of
 * the overflow affordance; showing "more 1" would not save meaningful space.
 */
export function calculateVisibleWindowCount(
  availableWidth: number,
  itemWidths: readonly number[],
  moreWidthByHiddenCount: ReadonlyMap<number, number> | Readonly<Record<number, number>> = new Map(),
  gap = 8,
): number {
  if (itemWidths.length === 0) return 0;
  if (itemWidths.length === 1) return 1;
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 0;

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

  return visibleCount === itemWidths.length - 1 ? itemWidths.length : visibleCount;
}

export function isWindowInstance(value: unknown): value is WindowInstance {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WindowInstance>;
  return typeof item.key === "string"
    && typeof item.kind === "string"
    && typeof item.title === "string"
    && typeof item.openedAt === "number"
    && Number.isFinite(item.openedAt)
    && typeof item.updatedAt === "number"
    && Number.isFinite(item.updatedAt)
    && (item.closePolicy === "free" || item.closePolicy === "confirmDiscard" || item.closePolicy === "minimizeOnly")
    && isWindowWorkState(item.workState);
}

function getActiveRegistryRecord(current: WindowRegistryState, key: string): WindowRegistryRecord | null {
  const record = current.records.find((candidate) => candidate.key === key);
  return record?.value ? record : null;
}

function replaceRegistryRecord(current: WindowRegistryState, record: WindowRegistryRecord): WindowRegistryState {
  const records = current.records.filter((candidate) => candidate.key !== record.key);
  records.push(record);
  records.sort(compareRecordKeys);
  return { version: WINDOW_REGISTRY_VERSION, records };
}

function normalizeRegistryRecord(value: unknown): WindowRegistryRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<WindowRegistryRecord>;
  if (typeof record.key !== "string" || !record.key || !isWindowStamp(record.stamp)) return null;
  if (record.value === null) return { key: record.key, value: null, stamp: record.stamp };
  if (!isWindowRegistryValue(record.value)) return null;
  return { key: record.key, value: { ...record.value }, stamp: { ...record.stamp } };
}

function isWindowStamp(value: unknown): value is WindowVersionStamp {
  if (!value || typeof value !== "object") return false;
  const stamp = value as Partial<WindowVersionStamp>;
  return typeof stamp.counter === "number"
    && Number.isSafeInteger(stamp.counter)
    && stamp.counter >= 0
    && typeof stamp.actorId === "string"
    && stamp.actorId.length > 0;
}

function isWindowRegistryValue(value: unknown): value is WindowRegistryValue {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WindowRegistryValue>;
  return typeof item.kind === "string"
    && typeof item.title === "string"
    && typeof item.openedAt === "number"
    && Number.isFinite(item.openedAt)
    && typeof item.updatedAt === "number"
    && Number.isFinite(item.updatedAt)
    && (item.closePolicy === "free" || item.closePolicy === "confirmDiscard" || item.closePolicy === "minimizeOnly")
    && isWindowWorkState(item.workState);
}

function isWindowWorkState(value: unknown): value is WindowWorkState {
  return value === "clean"
    || value === "dirty"
    || value === "submitting"
    || value === "syncPending"
    || value === "conflict"
    || value === "completed";
}

function compareRegistryRecords(left: WindowRegistryRecord, right: WindowRegistryRecord): number {
  const stampResult = compareWindowStamps(left.stamp, right.stamp);
  if (stampResult !== 0) return stampResult;
  const leftPayload = registryRecordPayload(left);
  const rightPayload = registryRecordPayload(right);
  if (leftPayload === rightPayload) return 0;
  return leftPayload < rightPayload ? -1 : 1;
}

function compareRecordKeys(left: WindowRegistryRecord, right: WindowRegistryRecord): number {
  return left.key.localeCompare(right.key);
}

function registryRecordKey(record: WindowRegistryRecord): string {
  return `${record.key}\u0000${record.stamp.counter}\u0000${record.stamp.actorId}\u0000${registryRecordPayload(record)}`;
}

function registryRecordPayload(record: WindowRegistryRecord): string {
  const value = record.value;
  if (!value) return "deleted";
  return [
    value.kind,
    value.title,
    value.closePolicy,
    value.workState,
    value.openedAt,
    value.updatedAt,
  ].join("\u0000");
}
