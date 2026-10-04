import {
  type QuickReviewActivityClaim,
  type QuickReviewActivityCommand,
  type QuickReviewCommandMessage,
  type QuickReviewCommandReceipt,
} from "@/lib/client/quick-review-activity-protocol";
import {
  createQuickReviewEventHub,
  type QuickReviewEventHub,
  type QuickReviewEventMessage,
} from "@/lib/client/quick-review-event-hub";
import {
  createQuickReviewActivityRuntime,
  quickReviewActivityClaimKey,
  type QuickReviewActivityBarrierLease,
  type QuickReviewActivityEnvironment,
  type QuickReviewActivityLease,
  type QuickReviewActivityRuntime,
  type QuickReviewCommandApplication,
  type QuickReviewDraftWriterLease,
} from "@/lib/client/quick-review-activity-runtime";
import { getBrowserStoragePortOrMemory } from "@/lib/client/storage-port";

const CHANNEL_NAME = "areaforge.quick-review.activity.v3";
const CLAIM_EVENT_NAME = "areaforge:quick-review-activity-change";
const MESSAGE_EVENT_NAME = "areaforge:quick-review-activity-message";
const MESSAGE_PREFIX = "af.quick-review.message.v3.";

export type {
  QuickReviewActivityClaim,
  QuickReviewActivityCommand,
  QuickReviewCommandMessage,
  QuickReviewCommandReceipt,
} from "@/lib/client/quick-review-activity-protocol";
export { createQuickReviewActivityRuntime } from "@/lib/client/quick-review-activity-runtime";
export type {
  QuickReviewActivityBarrierLease,
  QuickReviewActivityEnvironment,
  QuickReviewActivityLease,
  QuickReviewActivityRuntime,
  QuickReviewCommandApplication,
  QuickReviewDraftWriterLease,
} from "@/lib/client/quick-review-activity-runtime";

let browserRuntime: QuickReviewActivityRuntime | null = null;

export function getQuickReviewPageInstanceId(): string {
  return getBrowserRuntime().getPageInstanceId();
}

export function readActiveQuickReviewClaim(userId: string): QuickReviewActivityClaim | null {
  return getBrowserRuntime().readActiveClaim(userId);
}

export function readQuickReviewHandoffClaim(userId: string): QuickReviewActivityClaim | null {
  return getBrowserRuntime().readHandoffClaim(userId);
}

export function subscribeQuickReviewActivity(
  userId: string,
  onChange: (claim: QuickReviewActivityClaim | null) => void,
): () => void {
  return getBrowserRuntime().subscribeActivity(userId, onChange);
}

export function acquireQuickReviewActivity(input: {
  userId: string;
  scheduleId: string;
  draftId: string;
}): Promise<QuickReviewActivityLease | null> {
  return getBrowserRuntime().acquireActivity(input);
}

export function acquireQuickReviewDraftWriter(input: {
  userId: string;
  scheduleId: string;
}): Promise<QuickReviewDraftWriterLease | null> {
  return getBrowserRuntime().acquireDraftWriter(input);
}

export function acquireQuickReviewActivityBarrier(
  userId: string,
): Promise<QuickReviewActivityBarrierLease | null> {
  return getBrowserRuntime().acquireBarrier(userId);
}

export function tryAcquireQuickReviewActivityBarrier(
  userId: string,
): Promise<QuickReviewActivityBarrierLease | null> {
  return getBrowserRuntime().tryAcquireBarrier(userId);
}

export function subscribeQuickReviewCommands(input: {
  userId: string;
  ownerPageId: string;
  onCommand: (
    command: QuickReviewCommandMessage,
  ) => QuickReviewCommandApplication | null | Promise<QuickReviewCommandApplication | null>;
}): () => void {
  return getBrowserRuntime().subscribeCommands(input);
}

export function requestQuickReviewCommand(
  claim: QuickReviewActivityClaim,
  action: QuickReviewActivityCommand,
): Promise<QuickReviewCommandReceipt | null> {
  return getBrowserRuntime().requestCommand(claim, action);
}

function getBrowserRuntime(): QuickReviewActivityRuntime {
  browserRuntime ??= createQuickReviewActivityRuntime(createBrowserEnvironment());
  return browserRuntime;
}

function createBrowserEnvironment(): QuickReviewActivityEnvironment {
  const storage = getBrowserStoragePortOrMemory("local");
  const now = () => Date.now();
  const randomUUID = () => crypto.randomUUID();
  const messageHubs = new Map<string, QuickReviewEventHub>();
  const getMessageHub = (userId: string): QuickReviewEventHub => {
    const existing = messageHubs.get(userId);
    if (existing) return existing;
    const created = createQuickReviewEventHub({
      userId,
      channelName: CHANNEL_NAME,
      messageKey: messageKey(userId),
      messageEventName: MESSAGE_EVENT_NAME,
      storage,
      now,
      randomUUID,
    });
    messageHubs.set(userId, created);
    return created;
  };
  const releaseMessageHubIfIdle = (userId: string, hub: QuickReviewEventHub): void => {
    if (hub.subscriberCount !== 0 || messageHubs.get(userId) !== hub) return;
    hub.close();
    messageHubs.delete(userId);
  };
  const requestExclusiveLock: QuickReviewActivityEnvironment["requestExclusiveLock"] =
    typeof navigator !== "undefined" && navigator.locks
      ? async (name, options, callback) => {
          await navigator.locks.request(
            name,
            { mode: "exclusive", ...(options.ifAvailable ? { ifAvailable: true } : {}) },
            async (lock) => callback(Boolean(lock)),
          );
        }
      : undefined;

  return {
    localStorage: storage,
    now,
    randomUUID,
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (handle) => window.clearInterval(handle as number),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    requestExclusiveLock,
    subscribeClaimChanges(userId, listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === quickReviewActivityClaimKey(userId)) listener();
      };
      const onLocal = (event: Event) => {
        if ((event as CustomEvent<{ userId?: unknown }>).detail?.userId === userId) listener();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(CLAIM_EVENT_NAME, onLocal);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(CLAIM_EVENT_NAME, onLocal);
      };
    },
    notifyClaimChange(userId) {
      window.dispatchEvent(new CustomEvent(CLAIM_EVENT_NAME, { detail: { userId } }));
    },
    subscribeMessages(userId, listener) {
      const hub = getMessageHub(userId);
      const unsubscribe = hub.subscribe(listener);
      return () => {
        unsubscribe();
        releaseMessageHubIfIdle(userId, hub);
      };
    },
    publishMessage(userId, message) {
      const hub = getMessageHub(userId);
      hub.publish(message as QuickReviewEventMessage);
      releaseMessageHubIfIdle(userId, hub);
    },
  };
}

function messageKey(userId: string): string {
  return `${MESSAGE_PREFIX}${userId}`;
}
