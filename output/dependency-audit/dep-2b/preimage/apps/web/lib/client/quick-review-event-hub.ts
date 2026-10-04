import {
  createBroadcastChannelTransport,
  createEventChannel,
  type EventChannelEnvelope,
  type EventChannelTransport,
} from "@/lib/client/event-channel";
import type { StoragePort } from "@/lib/client/storage-port";
import {
  parseQuickReviewCommand,
  parseQuickReviewCommandReceipt,
  type QuickReviewCommandMessage,
  type QuickReviewCommandReceipt,
} from "@/lib/client/quick-review-activity-protocol";

export type QuickReviewEventMessage = QuickReviewCommandMessage | QuickReviewCommandReceipt;

export interface QuickReviewEventHubOptions {
  userId: string;
  channelName: string;
  messageKey: string;
  messageEventName: string;
  storage: StoragePort;
  now: () => number;
  randomUUID: () => string;
}

interface QuickReviewEventTransportOptions extends QuickReviewEventHubOptions {
  localPayloads: WeakSet<object>;
}

const WIRE_SOURCE_ID = "__areaforgeEventSourceId";
const WIRE_MESSAGE_ID = "__areaforgeEventMessageId";

export interface QuickReviewEventHub {
  readonly subscriberCount: number;
  publish: (message: QuickReviewEventMessage) => void;
  subscribe: (listener: (message: unknown) => void) => () => void;
  close: () => void;
}

export function createQuickReviewEventHub(options: QuickReviewEventHubOptions): QuickReviewEventHub {
  const transportOptions: QuickReviewEventTransportOptions = {
    ...options,
    localPayloads: new WeakSet<object>(),
  };
  const transports = [
    createBroadcastTransport(transportOptions),
    createStorageTransport(transportOptions),
    createWindowEventTransport(transportOptions),
  ].filter((transport): transport is EventChannelTransport => transport !== null);
  const channel = createEventChannel<QuickReviewEventMessage>({
    channelName: options.channelName,
    sourceId: options.randomUUID(),
    createMessageId: options.randomUUID,
    isPayload: (value): value is QuickReviewEventMessage => isQuickReviewMessage(value, options),
    transports,
  });

  let closed = false;
  let subscriberCount = 0;

  return {
    get subscriberCount() {
      return subscriberCount;
    },
    publish(message) {
      if (!closed) channel.publish(message);
    },
    subscribe(listener) {
      if (closed) return () => undefined;
      subscriberCount += 1;
      const unsubscribe = channel.subscribe(listener);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        subscriberCount = Math.max(0, subscriberCount - 1);
        unsubscribe();
      };
    },
    close() {
      if (closed) return;
      closed = true;
      subscriberCount = 0;
      channel.close();
    },
  };
}

function createBroadcastTransport(options: QuickReviewEventTransportOptions): EventChannelTransport | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return createLegacyWireTransport(
      createBroadcastChannelTransport(options.channelName),
      options,
    );
  } catch {
    // 浏览器可能暴露 BroadcastChannel，但禁止实际构造；此时保留其他 transport。
    return null;
  }
}

function createLegacyWireTransport(
  transport: EventChannelTransport,
  options: QuickReviewEventTransportOptions,
): EventChannelTransport {
  return {
    postMessage(value) {
      const envelope = parseEnvelope(value, options.channelName);
      if (!envelope) return;
      transport.postMessage(toLegacyWire(envelope));
    },
    subscribe(listener) {
      return transport.subscribe((value) => {
        const envelope = normalizeIncoming(value, options);
        if (envelope) listener(envelope);
      });
    },
    close() {
      transport.close?.();
    },
  };
}

function createStorageTransport(options: QuickReviewEventTransportOptions): EventChannelTransport {
  return {
    postMessage(value) {
      const envelope = parseEnvelope(value, options.channelName);
      if (!envelope) return;
      const wire = JSON.stringify(toLegacyWire(envelope));
      options.storage.setItem(options.messageKey, wire);
      options.storage.removeItem(options.messageKey);
    },
    subscribe(listener) {
      if (typeof window === "undefined") return () => undefined;
      const onStorage = (event: StorageEvent) => {
        if (event.key !== options.messageKey || !event.newValue) return;
        const value = parseJson(event.newValue);
        if (value !== null) listener(normalizeIncoming(value, options));
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
  };
}

function createWindowEventTransport(options: QuickReviewEventTransportOptions): EventChannelTransport {
  return {
    postMessage(value) {
      const envelope = parseEnvelope(value, options.channelName);
      if (!envelope || typeof window === "undefined") return;
      const payload = toLegacyWire(envelope);
      options.localPayloads.add(payload);
      try {
        window.dispatchEvent(new CustomEvent(options.messageEventName, { detail: payload }));
      } finally {
        options.localPayloads.delete(payload);
      }
    },
    subscribe(listener) {
      if (typeof window === "undefined") return () => undefined;
      const onLocal = (event: Event) => {
        const value = (event as CustomEvent<unknown>).detail;
        if (isObject(value) && options.localPayloads.has(value)) {
          options.localPayloads.delete(value);
          return;
        }
        listener(normalizeIncoming(value, options));
      };
      window.addEventListener(options.messageEventName, onLocal);
      return () => window.removeEventListener(options.messageEventName, onLocal);
    },
  };
}

function isQuickReviewMessage(
  value: unknown,
  options: QuickReviewEventHubOptions,
): value is QuickReviewEventMessage {
  return Boolean(
    parseQuickReviewCommand(value, options.userId, options.now())
      || parseQuickReviewCommandReceipt(value, options.userId, options.now()),
  );
}

function normalizeIncoming(
  value: unknown,
  options: QuickReviewEventHubOptions,
): EventChannelEnvelope<QuickReviewEventMessage> | null {
  const envelope = parseEnvelope(value, options.channelName);
  if (envelope) {
    const payload = parseQuickReviewCommand(envelope.payload, options.userId, options.now())
      ?? parseQuickReviewCommandReceipt(envelope.payload, options.userId, options.now());
    if (!payload) return null;
    return { ...envelope, payload: stripWireMetadata(payload) };
  }

  const payload = parseQuickReviewCommand(value, options.userId, options.now())
    ?? parseQuickReviewCommandReceipt(value, options.userId, options.now());
  if (!payload) return null;
  const record = value as Record<string, unknown>;
  return {
    version: 1,
    channelName: options.channelName,
    sourceId: isNonEmptyString(record[WIRE_SOURCE_ID])
      ? record[WIRE_SOURCE_ID]
      : `legacy:${payload.ownerPageId}`,
    messageId: isNonEmptyString(record[WIRE_MESSAGE_ID])
      ? record[WIRE_MESSAGE_ID]
      : `legacy:${payload.type}:${payload.commandId}:${payload.leaseId}`,
    payload: stripWireMetadata(payload),
  };
}

function parseEnvelope(
  value: unknown,
  channelName: string,
): EventChannelEnvelope<QuickReviewEventMessage> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EventChannelEnvelope<unknown>>;
  if (candidate.version !== 1 || candidate.channelName !== channelName) return null;
  if (!isNonEmptyString(candidate.sourceId) || !isNonEmptyString(candidate.messageId)) return null;
  if (!("payload" in candidate)) return null;
  return candidate as EventChannelEnvelope<QuickReviewEventMessage>;
}

function toLegacyWire(
  envelope: EventChannelEnvelope<QuickReviewEventMessage>,
): Record<string, unknown> {
  return {
    ...envelope.payload,
    [WIRE_SOURCE_ID]: envelope.sourceId,
    [WIRE_MESSAGE_ID]: envelope.messageId,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function stripWireMetadata<T extends QuickReviewEventMessage>(payload: T): T {
  if (!isObject(payload)) return payload;
  const clean = { ...payload } as Record<string, unknown>;
  delete clean[WIRE_SOURCE_ID];
  delete clean[WIRE_MESSAGE_ID];
  return clean as T;
}
