export interface MonotonicSnapshotClock {
  requestSequence: number;
  serverTimeMs: number;
}

export function createMonotonicSnapshotClock(serverTime: string): MonotonicSnapshotClock {
  return {
    requestSequence: 0,
    serverTimeMs: parseServerTime(serverTime),
  };
}

export function acceptMonotonicSnapshot(
  current: MonotonicSnapshotClock,
  candidate: { requestSequence: number; serverTime: string },
): MonotonicSnapshotClock | null {
  const serverTimeMs = parseServerTime(candidate.serverTime);
  if (candidate.requestSequence <= current.requestSequence || serverTimeMs < current.serverTimeMs) {
    return null;
  }
  return { requestSequence: candidate.requestSequence, serverTimeMs };
}

export function advanceMonotonicSequence(
  current: MonotonicSnapshotClock,
  requestSequence: number,
): MonotonicSnapshotClock | null {
  return requestSequence > current.requestSequence ? { ...current, requestSequence } : null;
}

function parseServerTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
