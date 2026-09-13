import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { stableStringify } from "./ai-draft";
import { redactDataExportValue } from "./data-lifecycle";
import { assertDataExportJobBinding, dataExportJobFingerprint, parseDataExportJob, portableDataExportRecord, type DataExportJobPayload } from "./data-export-job";

const payload: DataExportJobPayload = {
  protocol: "data-export-job-v1", policyVersion: "owner-export-v1", requesterId: "owner", scope: "WORKSPACE", workspaceId: "workspace-a",
  requestedAt: "2026-09-13T00:00:00.000Z", authorization: { authRevision: 1, workspaces: [{
    id: "workspace-a", ownerId: "owner", status: "ACTIVE", revision: 1,
    membership: { id: "membership", role: "OWNER", status: "ACTIVE", revision: 1 },
  }] },
};

test("导出协议拒绝额外字段、路径、坏版本与不一致 scope", () => {
  assert.deepEqual(parseDataExportJob(payload), payload);
  for (const value of [null, [], { ...payload, body: "private" }, { ...payload, policyVersion: "unknown" },
    { ...payload, workspaceId: null }, { ...payload, requesterId: "../../escape" }, { ...payload, requestedAt: "2026-02-31T00:00:00.000Z" },
    { ...payload, authorization: { ...payload.authorization, authRevision: 0 } },
    { ...payload, authorization: { ...payload.authorization, workspaces: [...payload.authorization.workspaces, ...payload.authorization.workspaces] } },
  ]) assert.throws(() => parseDataExportJob(value), /DATA_EXPORT_PAYLOAD_INVALID/);
});

test("导出指纹绑定 authorization 且不使用会删除该字段的脱敏哈希", () => {
  const expected = `sha256:${createHash("sha256").update(`areaforge:data-export-job:v1\n${stableStringify(payload)}`).digest("hex")}`;
  assert.equal(dataExportJobFingerprint(payload), expected);
  assert.notEqual(dataExportJobFingerprint({ ...payload, authorization: { ...payload.authorization, authRevision: 2 } }), expected);
  const row = { queueVersion: 1, kind: "EXPORT", scope: "WORKSPACE", requestedByUserId: "owner", workspaceId: "workspace-a", requestFingerprint: expected, resultJson: payload };
  assert.deepEqual(assertDataExportJobBinding(row), payload);
  for (const override of [{ queueVersion: 0 }, { kind: "NOTIFICATION" }, { scope: "ACCOUNT" }, { requestedByUserId: "other" }, { workspaceId: "other" }, { requestFingerprint: "sha256:" + "0".repeat(64) }]) {
    assert.throws(() => assertDataExportJobBinding({ ...row, ...override }), /DATA_EXPORT_JOB_BINDING_INVALID/);
  }
});

test("学习 session 外键有显式导出别名，通用凭据脱敏不放宽", () => {
  const original = { sessionId: "study-session", sessionToken: "sensitive", secret: "sensitive", summary: "self-owned" };
  const result = portableDataExportRecord({ kind: "masteryEvidence", id: "evidence", data: original });
  assert.deepEqual(result.data, { studySessionId: "study-session", summary: "self-owned" });
  assert.equal(result.omittedFieldCount, 2);
  assert.deepEqual(redactDataExportValue(original), { summary: "self-owned" });
  assert.equal(original.sessionId, "study-session");
});
