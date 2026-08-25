import {
  QUICK_REVIEW_CLAIM_TTL_MS,
  createQuickReviewActivityClaim,
  createQuickReviewCommand,
  createQuickReviewCommandReceipt,
  markQuickReviewActivityReleasing,
  parseQuickReviewActivityClaim,
  parseQuickReviewCommand,
  parseQuickReviewCommandReceipt,
  quickReviewActivityIdentityMatches,
  quickReviewCommandReceiptMatches,
  renewOwnedQuickReviewActivityClaim,
  type QuickReviewActivityClaim,
  type QuickReviewActivityCommand,
  type QuickReviewCommandMessage,
  type QuickReviewCommandReceipt,
} from "@/lib/client/quick-review-activity-protocol";
import type { StoragePort } from "@/lib/client/storage-port";

const HEARTBEAT_MS = 3_000;
const COMMAND_TIMEOUT_MS = 4_000;
// Keep the established claim key and Web Lock name so an older open tab cannot be bypassed.
const CLAIM_PREFIX = "af.quick-review.activity.v2.";

interface LockRequestOptions {
  ifAvailable: boolean;
}

export interface QuickReviewActivityEnvironment {
  localStorage: StoragePort;
  now: () => number;
  randomUUID: () => string;
  setInterval: (callback: () => void, delayMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  requestExclusiveLock?: (
    name: string,
    options: LockRequestOptions,
    callback: (acquired: boolean) => Promise<void>,
  ) => Promise<void>;
  subscribeClaimChanges: (userId: string, listener: () => void) => () => void;
  notifyClaimChange: (userId: string) => void;
  subscribeMessages: (userId: string, listener: (message: unknown) => void) => () => void;
  publishMessage: (userId: string, message: unknown) => void;
}

export interface QuickReviewActivityLease {
  readonly claim: QuickReviewActivityClaim;
  markReleasing: (commandId: string, action: QuickReviewActivityCommand) => boolean;
  release: () => void;
}

export interface QuickReviewDraftWriterLease {
  readonly userId: string;
  readonly scheduleId: string;
  readonly ownerPageId: string;
  readonly leaseId: string;
  release: () => void;
}

export interface QuickReviewActivityBarrierLease {
  release: () => void;
}

export interface QuickReviewCommandApplication {
  draftRevision: number | null;
  afterReceiptPublished: () => void;
}

export interface QuickReviewActivityRuntime {
  getPageInstanceId: () => string;
  readActiveClaim: (userId: string) => QuickReviewActivityClaim | null;
  readHandoffClaim: (userId: string) => QuickReviewActivityClaim | null;
  subscribeActivity: (
    userId: string,
    onChange: (claim: QuickReviewActivityClaim | null) => void,
  ) => () => void;
  acquireActivity: (input: {
    userId: string;
    scheduleId: string;
    draftId: string;
  }) => Promise<QuickReviewActivityLease | null>;
  acquireDraftWriter: (input: {
    userId: string;
    scheduleId: string;
  }) => Promise<QuickReviewDraftWriterLease | null>;
  tryAcquireBarrier: (userId: string) => Promise<QuickReviewActivityBarrierLease | null>;
  acquireBarrier: (userId: string) => Promise<QuickReviewActivityBarrierLease | null>;
  subscribeCommands: (input: {
    userId: string;
    ownerPageId: string;
    onCommand: (
      command: QuickReviewCommandMessage,
    ) => QuickReviewCommandApplication | null | Promise<QuickReviewCommandApplication | null>;
  }) => () => void;
  requestCommand: (
    claim: QuickReviewActivityClaim,
    action: QuickReviewActivityCommand,
  ) => Promise<QuickReviewCommandReceipt | null>;
}

interface ExclusiveLease {
  release: () => void;
}

export function createQuickReviewActivityRuntime(
  environment: QuickReviewActivityEnvironment,
): QuickReviewActivityRuntime {
  const localActivityLeases = new Map<string, QuickReviewActivityLease>();
  let pageInstanceId: string | null = null;

  function getPageInstanceId(): string {
    pageInstanceId ??= environment.randomUUID();
    return pageInstanceId;
  }

  function readActiveClaim(userId: string): QuickReviewActivityClaim | null {
    const key = quickReviewActivityClaimKey(userId);
    const raw = environment.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = parseJson(raw);
    const claim = parseQuickReviewActivityClaim(parsed, userId, environment.now());
    if (claim) return claim;
    if (parseQuickReviewActivityClaim(parsed, userId, environment.now(), { allowExpired: true })) return null;
    removeIfUnchanged(key, raw);
    return null;
  }

  function readHandoffClaim(userId: string): QuickReviewActivityClaim | null {
    const raw = environment.localStorage.getItem(quickReviewActivityClaimKey(userId));
    return raw
      ? parseQuickReviewActivityClaim(parseJson(raw), userId, environment.now(), { allowExpired: true })
      : null;
  }

  function subscribeActivity(
    userId: string,
    onChange: (claim: QuickReviewActivityClaim | null) => void,
  ): () => void {
    let expiryTimer: unknown = null;
    const notify = () => {
      if (expiryTimer !== null) environment.clearTimeout(expiryTimer);
      const claim = readActiveClaim(userId);
      onChange(claim);
      if (!claim) return;
      const remaining = Math.max(0, QUICK_REVIEW_CLAIM_TTL_MS - (environment.now() - claim.heartbeatAt));
      expiryTimer = environment.setTimeout(notify, remaining + 1);
    };
    const unsubscribe = environment.subscribeClaimChanges(userId, notify);
    notify();
    return () => {
      if (expiryTimer !== null) environment.clearTimeout(expiryTimer);
      unsubscribe();
    };
  }

  async function acquireActivity(input: {
    userId: string;
    scheduleId: string;
    draftId: string;
  }): Promise<QuickReviewActivityLease | null> {
    const local = localActivityLeases.get(input.userId);
    if (local) {
      return local.claim.scheduleId === input.scheduleId && local.claim.draftId === input.draftId
        ? local
        : null;
    }
    const lock = await acquireExclusiveLease(activityLockName(input.userId), true);
    if (!lock) return null;
    const ownerPageId = getPageInstanceId();
    try {
      const lease = createActivityLease(input, ownerPageId, lock);
      localActivityLeases.set(input.userId, lease);
      return lease;
    } catch {
      lock.release();
      return null;
    }
  }

  async function acquireDraftWriter(input: {
    userId: string;
    scheduleId: string;
  }): Promise<QuickReviewDraftWriterLease | null> {
    const lock = await acquireExclusiveLease(draftLockName(input.userId, input.scheduleId), true);
    if (!lock) return null;
    let released = false;
    return {
      userId: input.userId,
      scheduleId: input.scheduleId,
      ownerPageId: getPageInstanceId(),
      leaseId: environment.randomUUID(),
      release() {
        if (released) return;
        released = true;
        lock.release();
      },
    };
  }

  async function acquireBarrier(userId: string): Promise<QuickReviewActivityBarrierLease | null> {
    return acquireExclusiveLease(activityLockName(userId), false);
  }

  async function tryAcquireBarrier(userId: string): Promise<QuickReviewActivityBarrierLease | null> {
    return acquireExclusiveLease(activityLockName(userId), true);
  }

  function createActivityLease(
    input: { userId: string; scheduleId: string; draftId: string },
    ownerPageId: string,
    lock: ExclusiveLease,
  ): QuickReviewActivityLease {
    let claim = createQuickReviewActivityClaim({
      ...input,
      ownerPageId,
      leaseId: environment.randomUUID(),
      now: environment.now(),
    });
    let released = false;
    writeClaim(claim);

    const lease: QuickReviewActivityLease = {
      get claim() { return claim; },
      markReleasing(commandId, action) {
        if (released) return false;
        const key = quickReviewActivityClaimKey(input.userId);
        const raw = environment.localStorage.getItem(key);
        const releasing = markQuickReviewActivityReleasing(
          parseJson(raw),
          claim,
          commandId,
          action,
          environment.now(),
        );
        if (!releasing) return false;
        claim = releasing;
        writeClaim(claim);
        return true;
      },
      release() {
        if (released) return;
        released = true;
        environment.clearInterval(heartbeat);
        if (localActivityLeases.get(input.userId) === lease) localActivityLeases.delete(input.userId);
        removeOwnedClaim(claim);
        lock.release();
      },
    };
    const heartbeat = environment.setInterval(() => {
      const raw = environment.localStorage.getItem(quickReviewActivityClaimKey(input.userId));
      if (!raw) {
        claim = { ...claim, heartbeatAt: environment.now() };
        writeClaim(claim);
        return;
      }
      const renewed = renewOwnedQuickReviewActivityClaim(parseJson(raw), claim, environment.now());
      if (!renewed) {
        lease.release();
        return;
      }
      claim = renewed;
      writeClaim(claim);
    }, HEARTBEAT_MS);
    return lease;
  }

  function subscribeCommands(input: {
    userId: string;
    ownerPageId: string;
    onCommand: (
      command: QuickReviewCommandMessage,
    ) => QuickReviewCommandApplication | null | Promise<QuickReviewCommandApplication | null>;
  }): () => void {
    const seen = new Set<string>();
    return environment.subscribeMessages(input.userId, (value) => {
      const command = parseQuickReviewCommand(value, input.userId, environment.now());
      if (!command || command.ownerPageId !== input.ownerPageId || seen.has(command.commandId)) return;
      seen.add(command.commandId);
      void Promise.resolve(input.onCommand(command)).then((application) => {
        if (!application) return;
        try {
          environment.publishMessage(
            input.userId,
            createQuickReviewCommandReceipt(command, application.draftRevision, environment.now()),
          );
        } finally {
          application.afterReceiptPublished();
        }
      }).catch(() => undefined);
    });
  }

  function requestCommand(
    claim: QuickReviewActivityClaim,
    action: QuickReviewActivityCommand,
  ): Promise<QuickReviewCommandReceipt | null> {
    const command = createQuickReviewCommand({
      commandId: environment.randomUUID(),
      claim,
      action,
      now: environment.now(),
    });
    return new Promise((resolve) => {
      let settled = false;
      const unsubscribe = environment.subscribeMessages(claim.userId, (value) => {
        const receipt = parseQuickReviewCommandReceipt(value, claim.userId, environment.now());
        if (!receipt || !quickReviewCommandReceiptMatches(command, receipt)) return;
        finish(receipt);
      });
      const timeout = environment.setTimeout(() => finish(null), COMMAND_TIMEOUT_MS);
      function finish(result: QuickReviewCommandReceipt | null) {
        if (settled) return;
        settled = true;
        environment.clearTimeout(timeout);
        unsubscribe();
        resolve(result);
      }
      environment.publishMessage(claim.userId, command);
    });
  }

  function acquireExclusiveLease(name: string, ifAvailable: boolean): Promise<ExclusiveLease | null> {
    if (!environment.requestExclusiveLock) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      void environment.requestExclusiveLock?.(name, { ifAvailable }, async (acquired) => {
        if (!acquired) {
          settled = true;
          resolve(null);
          return;
        }
        let releaseLock: (() => void) | null = null;
        let released = false;
        const releasedPromise = new Promise<void>((release) => { releaseLock = release; });
        settled = true;
        resolve({
          release() {
            if (released) return;
            released = true;
            releaseLock?.();
          },
        });
        await releasedPromise;
      }).catch(() => {
        if (!settled) resolve(null);
      });
    });
  }

  function writeClaim(claim: QuickReviewActivityClaim): void {
    environment.localStorage.setItem(quickReviewActivityClaimKey(claim.userId), JSON.stringify(claim));
    environment.notifyClaimChange(claim.userId);
  }

  function removeOwnedClaim(claim: QuickReviewActivityClaim): void {
    const key = quickReviewActivityClaimKey(claim.userId);
    const raw = environment.localStorage.getItem(key);
    if (!raw) return;
    const current = parseQuickReviewActivityClaim(
      parseJson(raw),
      claim.userId,
      environment.now(),
      { allowExpired: true },
    );
    if (!current || !quickReviewActivityIdentityMatches(current, claim)) return;
    removeIfUnchanged(key, raw);
    environment.notifyClaimChange(claim.userId);
  }

  function removeIfUnchanged(key: string, raw: string): void {
    if (environment.localStorage.getItem(key) === raw) environment.localStorage.removeItem(key);
  }

  return {
    getPageInstanceId,
    readActiveClaim,
    readHandoffClaim,
    subscribeActivity,
    acquireActivity,
    acquireDraftWriter,
    tryAcquireBarrier,
    acquireBarrier,
    subscribeCommands,
    requestCommand,
  };
}

export function quickReviewActivityClaimKey(userId: string): string {
  return `${CLAIM_PREFIX}${userId}`;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function activityLockName(userId: string): string {
  return `areaforge:quick-review:${userId}`;
}

function draftLockName(userId: string, scheduleId: string): string {
  return `areaforge:quick-review:draft:${userId}:${scheduleId}`;
}
