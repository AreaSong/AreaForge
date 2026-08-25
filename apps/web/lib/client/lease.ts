export interface LeaseRecord<TOwner = string> {
  owner: TOwner;
  expiresAt: number;
}

export type CasResult<T> =
  | { ok: true; value: T }
  | { ok: false; current: T };

export type LeaseResult<TOwner> =
  | { ok: true; lease: LeaseRecord<TOwner> | null }
  | { ok: false; current: LeaseRecord<TOwner> | null };

export type LeaseOwnerEquals<TOwner> = (left: TOwner, right: TOwner) => boolean;

// This decides against a supplied snapshot; atomic persistence remains the caller's responsibility.
export function compareAndSwap<T>(
  current: T,
  expected: T,
  next: T,
  equals: (left: T, right: T) => boolean = Object.is,
): CasResult<T> {
  return equals(current, expected)
    ? { ok: true, value: next }
    : { ok: false, current };
}

export function createLease<TOwner>(owner: TOwner, now: number, ttlMs: number): LeaseRecord<TOwner> {
  assertLeaseTime(now, ttlMs);
  return { owner, expiresAt: now + ttlMs };
}

export function isLeaseActive<TOwner>(lease: LeaseRecord<TOwner> | null, now: number): boolean {
  return Boolean(lease && Number.isFinite(now) && lease.expiresAt > now);
}

export function acquireLease<TOwner>(
  current: LeaseRecord<TOwner> | null,
  owner: TOwner,
  now: number,
  ttlMs: number,
  ownerEquals: LeaseOwnerEquals<TOwner> = Object.is,
): LeaseResult<TOwner> {
  if (isLeaseActive(current, now) && current && !ownerEquals(current.owner, owner)) {
    return { ok: false, current };
  }
  return { ok: true, lease: createLease(owner, now, ttlMs) };
}

export function renewLease<TOwner>(
  current: LeaseRecord<TOwner> | null,
  owner: TOwner,
  now: number,
  ttlMs: number,
  ownerEquals: LeaseOwnerEquals<TOwner> = Object.is,
): LeaseResult<TOwner> {
  if (!current || !ownerEquals(current.owner, owner)) return { ok: false, current };
  return { ok: true, lease: createLease(owner, now, ttlMs) };
}

export function releaseLease<TOwner>(
  current: LeaseRecord<TOwner> | null,
  owner: TOwner,
  ownerEquals: LeaseOwnerEquals<TOwner> = Object.is,
): LeaseResult<TOwner> {
  if (!current) return { ok: true, lease: null };
  if (!ownerEquals(current.owner, owner)) return { ok: false, current };
  return { ok: true, lease: null };
}

function assertLeaseTime(now: number, ttlMs: number): void {
  if (!Number.isFinite(now)) throw new RangeError("now must be finite");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("ttlMs must be positive and finite");
  if (!Number.isFinite(now + ttlMs)) throw new RangeError("lease expiry must be finite");
}
