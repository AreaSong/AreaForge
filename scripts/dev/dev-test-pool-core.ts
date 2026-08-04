export const DEV_TEST_POOL = "areaforge-dev-test";
export const DEV_TEST_SLOT_COUNT = 3;
export const DEFAULT_DEV_TEST_PORTS = [43171, 43172, 43173] as const;

export const DEV_TEST_LABELS = {
  pool: "com.areaforge.dev-test.pool",
  slot: "com.areaforge.dev-test.slot",
  generation: "com.areaforge.dev-test.generation",
  sourceFingerprint: "com.areaforge.dev-test.source-fingerprint",
  gitCommit: "com.areaforge.dev-test.git-commit",
  buildId: "com.areaforge.dev-test.build-id",
  port: "com.areaforge.dev-test.port",
  note: "com.areaforge.dev-test.note",
} as const;

export type PoolMode = "refresh" | "snapshot";
export type SlotNumber = 1 | 2 | 3;

export type PoolInstance = {
  id: string;
  name: string;
  slot: SlotNumber;
  port: number;
  generation: number;
  createdAt: string;
  running: boolean;
  imageId: string;
  sourceFingerprint: string;
  gitCommit: string;
  buildId: string;
  note: string;
};

export type SlotSelection = {
  slot: SlotNumber;
  port: number;
  replacing: PoolInstance | null;
  reason: "empty-pool" | "refresh-latest" | "refresh-selected" | "empty-slot" | "fifo-oldest";
};

export function containerName(slot: SlotNumber): string {
  return `${DEV_TEST_POOL}-${slot}`;
}

export function parseConfiguredPorts(value = process.env.AREAFORGE_DEV_TEST_PORTS): number[] {
  if (!value?.trim()) return [...DEFAULT_DEV_TEST_PORTS];
  const ports = value.split(",").map((item) => Number(item.trim()));
  if (ports.length !== DEV_TEST_SLOT_COUNT || ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) {
    throw new Error("AREAFORGE_DEV_TEST_PORTS must contain exactly three unique ports between 1024 and 65535");
  }
  if (new Set(ports).size !== DEV_TEST_SLOT_COUNT) {
    throw new Error("AREAFORGE_DEV_TEST_PORTS must contain three unique ports");
  }
  return ports;
}

export function parseSlot(value: string): SlotNumber {
  const slot = Number(value);
  if (slot !== 1 && slot !== 2 && slot !== 3) throw new Error("slot must be 1, 2, or 3");
  return slot;
}

export function validatePool(instances: PoolInstance[], ports: number[]): void {
  const seenSlots = new Set<number>();
  for (const instance of instances) {
    if (seenSlots.has(instance.slot)) throw new Error(`duplicate owned containers found for slot ${instance.slot}`);
    if (instance.name !== containerName(instance.slot)) throw new Error(`owned container has unexpected name: ${instance.name}`);
    if (instance.port !== ports[instance.slot - 1]) throw new Error(`slot ${instance.slot} uses unexpected port ${instance.port}`);
    seenSlots.add(instance.slot);
  }
}

export function selectSlot(
  mode: PoolMode,
  instances: PoolInstance[],
  ports: number[],
  requestedSlot?: SlotNumber,
): SlotSelection {
  validatePool(instances, ports);
  if (mode === "snapshot" && requestedSlot) throw new Error("snapshot does not accept --slot; it always uses an empty or FIFO slot");
  if (mode === "refresh") return selectRefreshSlot(instances, ports, requestedSlot);
  const empty = firstEmptySlot(instances);
  if (empty) return selection(empty, ports, null, "empty-slot");
  const oldest = [...instances].sort(compareOldest)[0];
  if (!oldest) throw new Error("unable to choose the oldest test instance");
  return selection(oldest.slot, ports, oldest, "fifo-oldest");
}

export function compareOldest(left: PoolInstance, right: PoolInstance): number {
  return left.generation - right.generation
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.id.localeCompare(right.id);
}

function selectRefreshSlot(instances: PoolInstance[], ports: number[], requestedSlot?: SlotNumber): SlotSelection {
  if (requestedSlot) {
    const existing = instances.find((instance) => instance.slot === requestedSlot) ?? null;
    return selection(requestedSlot, ports, existing, "refresh-selected");
  }
  if (instances.length === 0) return selection(1, ports, null, "empty-pool");
  const latest = [...instances].sort((left, right) => compareOldest(right, left))[0];
  if (!latest) throw new Error("unable to choose the latest test instance");
  return selection(latest.slot, ports, latest, "refresh-latest");
}

function firstEmptySlot(instances: PoolInstance[]): SlotNumber | null {
  const occupied = new Set(instances.map((instance) => instance.slot));
  for (let slot = 1; slot <= DEV_TEST_SLOT_COUNT; slot += 1) {
    const candidate = slot as SlotNumber;
    if (!occupied.has(candidate)) return candidate;
  }
  return null;
}

function selection(
  slot: SlotNumber,
  ports: number[],
  replacing: PoolInstance | null,
  reason: SlotSelection["reason"],
): SlotSelection {
  const port = ports[slot - 1];
  if (!port) throw new Error(`missing configured port for slot ${slot}`);
  return { slot, port, replacing, reason };
}
