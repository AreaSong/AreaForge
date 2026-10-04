export type EventChannelListener<T> = (value: T) => void;

export interface EventChannelTransport {
  postMessage(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
  close?(): void;
}

export interface EventChannel<T> {
  publish(value: T): void;
  subscribe(listener: EventChannelListener<T>): () => void;
  close(): void;
}

export interface EventChannelEnvelope<T> {
  version: 1;
  channelName: string;
  sourceId: string;
  messageId: string;
  payload: T;
}

export interface EventChannelOptions<T> {
  channelName: string;
  sourceId: string;
  createMessageId: () => string;
  isPayload: (value: unknown) => value is T;
  transports?: readonly EventChannelTransport[];
  rememberedMessageLimit?: number;
  onError?: (error: unknown) => void;
}

export interface BroadcastChannelPort {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: EventListener): void;
  removeEventListener(type: "message", listener: EventListener): void;
  close(): void;
}

export type BroadcastChannelFactory = (channelName: string) => BroadcastChannelPort;

export function createBroadcastChannelTransport(
  channelName: string,
  createChannel: BroadcastChannelFactory = (name) => new BroadcastChannel(name),
): EventChannelTransport {
  const channel = createChannel(channelName);
  return {
    postMessage(message) {
      channel.postMessage(message);
    },
    subscribe(listener) {
      const onMessage: EventListener = (event) => listener((event as MessageEvent<unknown>).data);
      channel.addEventListener("message", onMessage);
      return () => channel.removeEventListener("message", onMessage);
    },
    close() {
      channel.close();
    },
  };
}

export function createEventChannel<T>(options: EventChannelOptions<T>): EventChannel<T> {
  assertNonEmpty(options.channelName, "channelName");
  assertNonEmpty(options.sourceId, "sourceId");
  const rememberedMessageLimit = options.rememberedMessageLimit ?? 256;
  if (!Number.isInteger(rememberedMessageLimit) || rememberedMessageLimit < 1) {
    throw new RangeError("rememberedMessageLimit must be a positive integer");
  }

  const transports = [...(options.transports ?? [])];
  const listeners = new Set<EventChannelListener<T>>();
  const remembered = new Set<string>();
  const rememberedOrder: string[] = [];
  const transportUnsubscribers: Array<() => void> = [];
  let closed = false;

  const reportError = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // Error reporting must not break best-effort event delivery.
    }
  };

  const deliver = (value: T) => {
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (error) {
        reportError(error);
      }
    }
  };

  const remember = (sourceId: string, messageId: string): boolean => {
    const key = `${sourceId}\u0000${messageId}`;
    if (remembered.has(key)) return false;
    remembered.add(key);
    rememberedOrder.push(key);
    if (rememberedOrder.length > rememberedMessageLimit) {
      const oldest = rememberedOrder.shift();
      if (oldest !== undefined) remembered.delete(oldest);
    }
    return true;
  };

  const receive = (value: unknown) => {
    if (closed) return;
    const envelope = parseEnvelope(value, options.channelName, options.isPayload);
    if (!envelope || envelope.sourceId === options.sourceId) return;
    if (!remember(envelope.sourceId, envelope.messageId)) return;
    deliver(envelope.payload);
  };

  for (const transport of transports) {
    try {
      transportUnsubscribers.push(transport.subscribe(receive));
    } catch (error) {
      reportError(error);
    }
  }

  return {
    publish(value) {
      if (closed) return;
      const messageId = options.createMessageId();
      assertNonEmpty(messageId, "messageId");
      const envelope: EventChannelEnvelope<T> = {
        version: 1,
        channelName: options.channelName,
        sourceId: options.sourceId,
        messageId,
        payload: value,
      };
      remember(envelope.sourceId, envelope.messageId);
      deliver(value);
      for (const transport of transports) {
        try {
          transport.postMessage(envelope);
        } catch (error) {
          reportError(error);
        }
      }
    },
    subscribe(listener) {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      for (const unsubscribe of transportUnsubscribers.splice(0).reverse()) {
        try {
          unsubscribe();
        } catch (error) {
          reportError(error);
        }
      }
      for (const transport of transports) {
        try {
          transport.close?.();
        } catch (error) {
          reportError(error);
        }
      }
    },
  };
}

function parseEnvelope<T>(
  value: unknown,
  channelName: string,
  isPayload: (value: unknown) => value is T,
): EventChannelEnvelope<T> | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<EventChannelEnvelope<unknown>>;
  if (envelope.version !== 1 || envelope.channelName !== channelName) return null;
  if (!isNonEmptyString(envelope.sourceId) || !isNonEmptyString(envelope.messageId)) return null;
  if (!("payload" in envelope) || !isPayload(envelope.payload)) return null;
  return envelope as EventChannelEnvelope<T>;
}

function assertNonEmpty(value: string, name: string): void {
  if (!isNonEmptyString(value)) throw new TypeError(`${name} must be a non-empty string`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
