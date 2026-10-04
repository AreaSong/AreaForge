import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBroadcastChannelTransport,
  createEventChannel,
  type BroadcastChannelPort,
  type EventChannelTransport,
} from "@/lib/client/event-channel";
import {
  acquireLease,
  compareAndSwap,
  createLease,
  isLeaseActive,
  releaseLease,
  renewLease,
} from "@/lib/client/lease";
import { createMemoryStoragePort, listStorageKeys } from "@/lib/client/storage-port";

test("memory storage follows the minimal enumerable storage contract", () => {
  const storage = createMemoryStoragePort([["first", "1"]]);

  storage.setItem("second", "2");
  storage.setItem("first", "updated");

  assert.equal(storage.length, 2);
  assert.deepEqual(listStorageKeys(storage), ["first", "second"]);
  assert.equal(storage.getItem("first"), "updated");
  assert.equal(storage.key(-1), null);
  assert.equal(storage.key(2), null);

  storage.removeItem("first");
  assert.deepEqual(listStorageKeys(storage), ["second"]);
  assert.equal(storage.getItem("first"), null);
});

test("event channels deliver locally once and deduplicate multiple transports", () => {
  const firstBus = new TestTransportBus();
  const secondBus = new TestTransportBus();
  let nextId = 0;
  const channelA = createStringChannel("source-a", () => `message-${++nextId}`, [
    firstBus.endpoint(),
    secondBus.endpoint(),
  ]);
  const channelB = createStringChannel("source-b", () => "unused", [
    firstBus.endpoint(),
    secondBus.endpoint(),
  ]);
  const receivedA: string[] = [];
  const receivedB: string[] = [];
  channelA.subscribe((value) => receivedA.push(value));
  const unsubscribeB = channelB.subscribe((value) => receivedB.push(value));

  channelA.publish("ready");

  assert.deepEqual(receivedA, ["ready"]);
  assert.deepEqual(receivedB, ["ready"]);

  unsubscribeB();
  channelA.publish("after-unsubscribe");
  assert.deepEqual(receivedB, ["ready"]);

  channelA.close();
  channelB.close();
});

test("event channels reject malformed payloads and isolate transport failures", () => {
  const errors: unknown[] = [];
  const bus = new TestTransportBus();
  const failingTransport: EventChannelTransport = {
    postMessage() {
      throw new Error("transport unavailable");
    },
    subscribe() {
      return () => undefined;
    },
  };
  const channel = createEventChannel<string>({
    channelName: "test.channel",
    sourceId: "source-a",
    createMessageId: () => "message-1",
    isPayload: (value): value is string => typeof value === "string",
    transports: [bus.endpoint(), failingTransport],
    onError: (error) => errors.push(error),
  });
  const received: string[] = [];
  channel.subscribe((value) => received.push(value));

  channel.publish("local-still-delivered");
  bus.emit({
    version: 1,
    channelName: "test.channel",
    sourceId: "source-b",
    messageId: "malformed-message",
    payload: 42,
  });

  assert.deepEqual(received, ["local-still-delivered"]);
  assert.equal(errors.length, 1);
  channel.close();
});

test("broadcast transport adapts message events and closes its owned port", () => {
  const port = new TestBroadcastChannelPort();
  const transport = createBroadcastChannelTransport("ignored-by-factory", () => port);
  const received: unknown[] = [];
  const unsubscribe = transport.subscribe((value) => received.push(value));

  transport.postMessage({ outbound: true });
  port.emit({ inbound: true });
  unsubscribe();
  port.emit({ ignored: true });
  transport.close?.();

  assert.deepEqual(port.sent, [{ outbound: true }]);
  assert.deepEqual(received, [{ inbound: true }]);
  assert.equal(port.closed, true);
});

test("CAS decisions expose conflicts without mutating either snapshot", () => {
  const current = { revision: 2, value: "current" };
  const expected = { revision: 2, value: "stale-copy" };
  const next = { revision: 3, value: "next" };

  const applied = compareAndSwap(current, expected, next, (left, right) => left.revision === right.revision);
  const conflict = compareAndSwap(current, { revision: 1, value: "old" }, next, (left, right) => left.revision === right.revision);

  assert.deepEqual(applied, { ok: true, value: next });
  assert.deepEqual(conflict, { ok: false, current });
  assert.deepEqual(current, { revision: 2, value: "current" });
});

test("lease decisions enforce expiry and owner fencing", () => {
  const original = createLease("owner-a", 1_000, 100);
  assert.equal(isLeaseActive(original, 1_099), true);
  assert.equal(isLeaseActive(original, 1_100), false);

  assert.deepEqual(acquireLease(original, "owner-b", 1_050, 100), { ok: false, current: original });
  assert.deepEqual(acquireLease(original, "owner-b", 1_100, 100), {
    ok: true,
    lease: { owner: "owner-b", expiresAt: 1_200 },
  });
  assert.deepEqual(renewLease(original, "owner-b", 1_050, 100), { ok: false, current: original });
  assert.deepEqual(renewLease(original, "owner-a", 1_050, 100), {
    ok: true,
    lease: { owner: "owner-a", expiresAt: 1_150 },
  });
  assert.deepEqual(releaseLease(original, "owner-b"), { ok: false, current: original });
  assert.deepEqual(releaseLease(original, "owner-a"), { ok: true, lease: null });
  assert.deepEqual(releaseLease(null, "owner-a"), { ok: true, lease: null });
  assert.throws(() => createLease("owner-a", 1_000, 0), /ttlMs/);
});

function createStringChannel(
  sourceId: string,
  createMessageId: () => string,
  transports: readonly EventChannelTransport[],
) {
  return createEventChannel<string>({
    channelName: "test.channel",
    sourceId,
    createMessageId,
    isPayload: (value): value is string => typeof value === "string",
    transports,
  });
}

class TestTransportBus {
  private readonly listeners = new Set<(message: unknown) => void>();

  emit(message: unknown): void {
    for (const listener of [...this.listeners]) listener(message);
  }

  endpoint(): EventChannelTransport {
    return {
      postMessage: (message) => this.emit(message),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
  }
}

class TestBroadcastChannelPort implements BroadcastChannelPort {
  readonly sent: unknown[] = [];
  closed = false;
  private readonly listeners = new Set<EventListener>();

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  addEventListener(_type: "message", listener: EventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: EventListener): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of [...this.listeners]) listener(event);
  }
}
