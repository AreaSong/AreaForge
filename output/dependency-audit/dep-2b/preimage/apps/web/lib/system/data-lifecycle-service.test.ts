import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDataDeletePreview,
  buildDataExportPreview,
  createDataRequestFingerprint,
  hashDataDownloadToken,
  isDataLifecycleEnabled,
  normalizeDataJobWorkerId,
  normalizeDataLifecycleRequest,
  serializeDataJob,
} from "./data-lifecycle-service";

test("data lifecycle flag is fail-closed and request normalization is strict", () => {
  assert.equal(isDataLifecycleEnabled({}), false);
  assert.equal(isDataLifecycleEnabled({ DATA_LIFECYCLE_ENABLED: "true" }), true);
  assert.deepEqual(normalizeDataLifecycleRequest({
    kind: "EXPORT",
    scope: "ACCOUNT",
    idempotencyKey: "request-2026-09-06",
  }), {
    kind: "EXPORT",
    scope: "ACCOUNT",
    workspaceId: undefined,
    idempotencyKey: "request-2026-09-06",
  });
  assert.throws(() => normalizeDataLifecycleRequest({
    kind: "DELETE",
    scope: "ACCOUNT",
    workspaceId: "workspace-leak",
    idempotencyKey: "request-2026-09-06",
  }), /DATA_WORKSPACE_NOT_ALLOWED/);
  assert.throws(() => normalizeDataLifecycleRequest({
    kind: "EXPORT",
    scope: "WORKSPACE",
    idempotencyKey: "request-2026-09-06",
  }), /DATA_WORKSPACE_REQUIRED/);
});

test("export preview contains only redacted manifest descriptors", () => {
  const preview = buildDataExportPreview("ACCOUNT", [
    { kind: "account", id: "u-1", data: { email: "owner@example.test", passwordHash: "never-export" } },
    { kind: "attachment", id: "a-1", data: { originalName: "notes.pdf", uri: "upload://private/a.pdf", storedName: "a.pdf" } },
  ], "2026-09-06T00:00:00.000Z");
  assert.equal(preview.recordCount, 2);
  assert.equal(preview.attachmentCount, 1);
  assert.equal(preview.packageStatus, "NOT_CREATED");
  assert.equal(preview.archiveStatus, "NOT_WRITTEN");
  assert.equal("data" in (preview.entries[0] ?? {}), false);
  assert.equal(preview.omittedFieldCount, 3);
  assert.match(preview.manifestSha256, /^sha256:[a-f0-9]{64}$/);
});

test("delete preview is explicitly non-executable and hash-bound", () => {
  const preview = buildDataDeletePreview(
    "WORKSPACE",
    ["workspace-1"],
    [
      { kind: "note", id: "note-1", data: { title: "x" } },
      { kind: "attachment", id: "attachment-1", data: {} },
    ],
    new Date("2026-09-06T00:00:00.000Z"),
  );
  assert.equal(preview.physicalDeletionSupported, false);
  assert.equal(preview.executionState, "PREVIEW_ONLY");
  assert.equal(preview.totalObjects, 2);
  assert.equal(preview.counts.attachment, 1);
  assert.equal(preview.blockers.includes("DELETE_EXECUTION_NOT_IMPLEMENTED"), true);
  assert.match(preview.scopeHash, /^sha256:[a-f0-9]{64}$/);

  const accountPreview = buildDataDeletePreview("ACCOUNT", [], [
    { kind: "account", id: "u-1", data: {} },
  ], new Date("2026-09-06T00:00:00.000Z"));
  assert.equal(accountPreview.counts.account, undefined);
  assert.equal(accountPreview.counts.User, 1);
});

test("download token hash is opaque and domain separated", () => {
  const token = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-";
  assert.match(hashDataDownloadToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashDataDownloadToken(token), token);
  assert.notEqual(hashDataDownloadToken(token), hashDataDownloadToken(`other:${token}`));
});

test("job serializer omits lease, fingerprint and result internals", () => {
  const dto = serializeDataJob({
    id: "job-1",
    kind: "EXPORT",
    scope: "ACCOUNT",
    status: "QUEUED",
    progress: 0,
    attempt: 0,
    errorCode: null,
    retryable: false,
    expiresAt: new Date("2026-09-06T01:00:00.000Z"),
    createdAt: new Date("2026-09-06T00:00:00.000Z"),
    updatedAt: new Date("2026-09-06T00:00:00.000Z"),
    resultJson: { previewVersion: "unknown", objectKey: "/srv/private/export.tar.gz" },
  });
  assert.equal("objectKey" in dto, false);
  assert.equal("requestFingerprint" in dto, false);
  assert.equal(dto.preview, null);
});

test("idempotency fingerprint binds kind, scope and workspace", () => {
  const account = createDataRequestFingerprint({ kind: "EXPORT", scope: "ACCOUNT" });
  const workspace = createDataRequestFingerprint({ kind: "EXPORT", scope: "WORKSPACE", workspaceId: "w-1" });
  assert.notEqual(account, workspace);
  assert.equal(account, createDataRequestFingerprint({ kind: "EXPORT", scope: "ACCOUNT" }));
});

test("worker identity accepts only bounded opaque ids", () => {
  assert.equal(normalizeDataJobWorkerId(" local.worker-1 "), "local.worker-1");
  assert.throws(() => normalizeDataJobWorkerId("worker/escape"), /DATA_JOB_WORKER_INVALID/);
  assert.throws(() => normalizeDataJobWorkerId(""), /DATA_JOB_WORKER_INVALID/);
});
