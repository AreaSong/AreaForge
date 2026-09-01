import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelectedUploadItems,
  reduceUploadItems,
} from "./study-resource-upload-state";
import type { UploadItem } from "./study-resource-workbench-support";

const ready: UploadItem = {
  key: "upload-1",
  originalName: "讲义.pdf",
  status: "ready",
};

test("upload reducer keeps batch state transitions explicit", () => {
  const staging = reduceUploadItems([ready], {
    type: "mark-staging",
    keys: new Set([ready.key]),
  });
  assert.equal(staging[0]?.status, "staging");

  const failed = reduceUploadItems(staging, {
    type: "mark-failed",
    keys: new Set([ready.key]),
    message: "上传失败",
  });
  assert.deepEqual(failed[0], { ...ready, status: "failed", error: "上传失败" });
});

test("upload decisions invalidate stale submission snapshots", () => {
  const duplicate: UploadItem = {
    ...ready,
    status: "duplicate",
    decision: "reuse",
    reuseResourceId: "resource-1",
    submittedSnapshot: uploadRequest("reuse"),
  };
  const changed = reduceUploadItems([duplicate], {
    type: "update-decision",
    itemKey: ready.key,
    decision: "copy",
  });
  assert.equal(changed[0]?.decision, "copy");
  assert.equal(changed[0]?.submittedSnapshot, undefined);
});

test("adopting the server terminal state clears conflict-only fields", () => {
  const resolved = reduceUploadItems([{
    ...ready,
    status: "duplicate",
    decision: "copy",
    error: "服务端已有不同终态",
    submittedSnapshot: uploadRequest("copy"),
  }], {
    type: "adopt-resolved",
    itemKey: ready.key,
    resultTitle: "高数讲义",
  });
  assert.deepEqual(resolved[0], {
    ...ready,
    status: "done",
    decision: "copy",
    error: undefined,
    submittedSnapshot: undefined,
    resultTitle: "高数讲义",
  });
});

test("selected files receive stable per-item identities", () => {
  let counter = 0;
  const files = [
    { name: "a.pdf" } as File,
    { name: "b.pdf" } as File,
  ];
  assert.deepEqual(createSelectedUploadItems(files, () => `upload-${++counter}`), [
    { key: "upload-1", file: files[0], originalName: "a.pdf", status: "ready" },
    { key: "upload-2", file: files[1], originalName: "b.pdf", status: "ready" },
  ]);
});

function uploadRequest(decision: "reuse" | "copy") {
  return {
    attachmentId: "attachment-1",
    decision,
    title: "讲义",
    subjectId: "subject-1",
    category: "TEXTBOOK",
    tags: [],
  };
}
