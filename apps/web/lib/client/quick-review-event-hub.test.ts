import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createQuickReviewEventHub,
  type QuickReviewEventHubOptions,
  type QuickReviewEventMessage,
} from "@/lib/client/quick-review-event-hub";
import {
  createQuickReviewActivityClaim,
  createQuickReviewCommand,
  type QuickReviewCommandMessage,
} from "@/lib/client/quick-review-activity-protocol";
import type { StoragePort } from "@/lib/client/storage-port";

const CHANNEL_NAME = "areaforge.quick-review.activity.v3";
const MESSAGE_KEY = "af.quick-review.message.v3.user-1";
const MESSAGE_EVENT_NAME = "areaforge:quick-review-activity-message";

interface FakeEvent {
  type: string;
  detail?: unknown;
  key?: string;
  newValue?: string | null;
}

interface FakeMessageEvent {
  data: unknown;
}

type FakeEventListener = (event: FakeEvent) => void;
type FakeMessageListener = (event: FakeMessageEvent) => void;

test("Quick Review hub deduplicates BroadcastChannel, storage, and local events", () => {
  const browser = installBrowser(true);
  try {
    const storage = new SharedStorage(browser.window);
    const options = createOptions(storage);
    const first = createQuickReviewEventHub(options);
    const second = createQuickReviewEventHub(options);
    const firstReceived: QuickReviewEventMessage[] = [];
    const secondReceived: QuickReviewEventMessage[] = [];
    first.subscribe((message) => firstReceived.push(message as QuickReviewEventMessage));
    second.subscribe((message) => secondReceived.push(message as QuickReviewEventMessage));

    const command = createCommand();
    first.publish(command);

    assert.deepEqual(firstReceived, [command]);
    assert.deepEqual(secondReceived, [command]);
    assert.deepEqual(Object.keys(secondReceived[0] as object).sort(), Object.keys(command).sort());

    first.close();
    second.close();
  } finally {
    browser.restore();
  }
});

test("Quick Review hub accepts legacy raw messages and preserves their shape", () => {
  const browser = installBrowser(false);
  try {
    const hub = createQuickReviewEventHub(createOptions(new SharedStorage(browser.window)));
    const received: QuickReviewEventMessage[] = [];
    hub.subscribe((message) => received.push(message as QuickReviewEventMessage));
    const command = createCommand();

    browser.window.dispatchEvent({ type: MESSAGE_EVENT_NAME, detail: command });
    browser.window.dispatchEvent({ type: MESSAGE_EVENT_NAME, detail: command });

    assert.deepEqual(received, [command]);
    hub.close();
  } finally {
    browser.restore();
  }
});

test("Quick Review hub normalizes an EventChannel envelope before delivery", () => {
  const browser = installBrowser(false);
  try {
    const hub = createQuickReviewEventHub(createOptions(new SharedStorage(browser.window)));
    const received: QuickReviewEventMessage[] = [];
    hub.subscribe((message) => received.push(message as QuickReviewEventMessage));
    const command = createCommand();
    const envelope = {
      version: 1 as const,
      channelName: CHANNEL_NAME,
      sourceId: "remote-source",
      messageId: "remote-message",
      payload: {
        ...command,
        __areaforgeEventSourceId: "remote-source",
        __areaforgeEventMessageId: "remote-message",
      },
    };

    browser.window.dispatchEvent({ type: MESSAGE_EVENT_NAME, detail: envelope });

    assert.deepEqual(received, [command]);
    hub.close();
  } finally {
    browser.restore();
  }
});

function createOptions(storage: StoragePort): QuickReviewEventHubOptions {
  let nextId = 0;
  return {
    userId: "user-1",
    channelName: CHANNEL_NAME,
    messageKey: MESSAGE_KEY,
    messageEventName: MESSAGE_EVENT_NAME,
    storage,
    now: () => 1_000_000,
    randomUUID: () => `test-id-${++nextId}`,
  };
}

function createCommand(): QuickReviewCommandMessage {
  const claim = createQuickReviewActivityClaim({
    userId: "user-1",
    scheduleId: "schedule-1",
    draftId: "draft-1",
    ownerPageId: "owner-page",
    leaseId: "lease-1",
    now: 1_000_000,
  });
  return createQuickReviewCommand({
    commandId: "command-1",
    claim,
    action: "suspend",
    now: 1_000_000,
  });
}

class FakeWindow {
  private readonly listeners = new Map<string, Set<FakeEventListener>>();

  addEventListener(type: string, listener: FakeEventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<FakeEventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeEventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: FakeEvent): boolean {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
    return true;
  }
}

class SharedStorage implements StoragePort {
  private readonly values = new Map<string, string>();

  constructor(private readonly window: FakeWindow) {}

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.window.dispatchEvent({ type: "storage", key, newValue: value });
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function installBrowser(withBroadcast: boolean): { window: FakeWindow; restore: () => void } {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousWindow = globals.window;
  const previousBroadcastChannel = globals.BroadcastChannel;
  const window = new FakeWindow();
  globals.window = window;
  if (withBroadcast) globals.BroadcastChannel = createBroadcastChannelFactory();
  else delete globals.BroadcastChannel;
  return {
    window,
    restore() {
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
      if (previousBroadcastChannel === undefined) delete globals.BroadcastChannel;
      else globals.BroadcastChannel = previousBroadcastChannel;
    },
  };
}

function createBroadcastChannelFactory(): unknown {
  const channels = new Map<string, Set<TestBroadcastChannel>>();
  class TestBroadcastChannel {
    private readonly listeners = new Set<FakeMessageListener>();

    constructor(private readonly channelName: string) {
      const peers = channels.get(channelName) ?? new Set<TestBroadcastChannel>();
      peers.add(this);
      channels.set(channelName, peers);
    }

    addEventListener(_type: "message", listener: FakeMessageListener): void {
      this.listeners.add(listener);
    }

    removeEventListener(_type: "message", listener: FakeMessageListener): void {
      this.listeners.delete(listener);
    }

    postMessage(data: unknown): void {
      for (const peer of channels.get(this.channelName) ?? []) {
        if (peer === this) continue;
        for (const listener of peer.listeners) listener({ data: clone(data) });
      }
    }

    close(): void {
      channels.get(this.channelName)?.delete(this);
    }
  }
  return TestBroadcastChannel;
}

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
