import assert from "node:assert/strict";
import test from "node:test";
import type { UpdateCenterStatus } from "../system/update-center";
import {
  readSystemUpdateStatus,
  startSystemUpdateStatusPolling,
  submitSystemUpdateRequest,
  SystemUpdateApiError,
} from "./system-update";

const statusFixture: UpdateCenterStatus = {
  currentVersion: "1.1.1",
  currentImage: null,
  appUrl: null,
  deployMode: "release",
  releaseUrl: null,
  latestVersion: "1.1.2",
  latestPublishedAt: null,
  updateAvailable: true,
  autoApply: "none",
  signatureRequired: true,
  timerEnabled: false,
  timerActive: false,
  lastCheckedAt: null,
  lastOperation: null,
  rollback: {
    available: true,
    targetVersion: "1.1.0",
    targetImage: null,
  },
  blocker: null,
  requestQueueLength: 0,
  statusUpdatedAt: null,
};

test("readSystemUpdateStatus uses the shared transport and requires a status body", async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return Response.json({ status: statusFixture });
  };
  try {
    assert.deepEqual(await readSystemUpdateStatus(), statusFixture);
    assert.equal(requestInit?.cache, "no-store");

    globalThis.fetch = async () => Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
    await assert.rejects(
      () => readSystemUpdateStatus(),
      (error: unknown) => error instanceof SystemUpdateApiError
        && error.kind === "response"
        && error.status === 500
        && error.code === "INTERNAL_ERROR",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitSystemUpdateRequest preserves response metadata for idempotency handling", async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return Response.json({ error: "STATUS_SNAPSHOT_CHANGED" }, { status: 409 });
  };
  try {
    const payload = {
      action: "apply" as const,
      tag: "v1.1.2",
      confirmedSnapshotHash: `sha256:${"a".repeat(64)}`,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    };
    const result = await submitSystemUpdateRequest(payload);
    assert.equal(requestInit?.method, "POST");
    assert.equal(new Headers(requestInit?.headers).get("Content-Type"), "application/json");
    assert.equal(requestInit?.body, JSON.stringify(payload));
    assert.equal(result.responseOk, false);
    assert.equal(result.responseStatus, 409);
    assert.equal(result.errorCode, "STATUS_SNAPSHOT_CHANGED");
    assert.deepEqual(result.responseBody, { error: "STATUS_SNAPSHOT_CHANGED" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("status polling retries network failures and stops after a terminal status", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) throw new TypeError("network unavailable");
    return Response.json({ status: statusFixture });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("polling timed out")), 1_000);
      let stop = () => {};
      stop = startSystemUpdateStatusPolling({
        initialDelayMs: 0,
        intervalMs: 0,
        maxAttempts: 3,
        shouldContinue: () => false,
        onStatus: () => {
          clearTimeout(timeout);
          stop();
          resolve();
        },
      });
    });
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("status polling retries 429 and 5xx responses before succeeding", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
    if (fetchCount === 2) return Response.json({ error: "UNAVAILABLE" }, { status: 503 });
    return Response.json({ status: statusFixture });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("polling timed out")), 1_000);
      startSystemUpdateStatusPolling({
        initialDelayMs: 0,
        intervalMs: 0,
        maxAttempts: 4,
        shouldContinue: () => false,
        onStatus: () => {
          clearTimeout(timeout);
          resolve();
        },
      });
    });
    assert.equal(fetchCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("status polling reports exhaustion without treating the target as settled", async () => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("polling did not exhaust")), 1_000);
    startSystemUpdateStatusPolling({
      initialDelayMs: 0,
      intervalMs: 0,
      maxAttempts: 2,
      readStatus: async () => {
        throw new SystemUpdateApiError("UNAVAILABLE", "response", 503, null);
      },
      shouldContinue: () => true,
      onStatus: () => reject(new Error("unexpected status")),
      onExhausted: (error) => {
        clearTimeout(timeout);
        assert.equal(error?.status, 503);
        resolve();
      },
    });
  });
});

test("stopping status polling aborts an in-flight read", async () => {
  let resolveStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  let aborted = false;
  const stop = startSystemUpdateStatusPolling({
    initialDelayMs: 0,
    readStatus: (signal) => new Promise<UpdateCenterStatus>((_resolve, reject) => {
      resolveStarted?.();
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
    shouldContinue: () => true,
    onStatus: () => undefined,
  });
  await started;
  stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(aborted, true);
});
