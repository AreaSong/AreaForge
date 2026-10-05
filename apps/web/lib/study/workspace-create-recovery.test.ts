import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@areaforge/db";
import { createExamWorkspace } from "./exam-workspace-service";
import { recoverWorkspaceCreation, workspaceCreateFingerprint, type WorkspaceCreateInput } from "./workspace-create-recovery";

const input: WorkspaceCreateInput = {
  stableKey: "custom", name: "自定义考试", activate: true,
  groups: [{ stableKey: "g", name: "自定义组" }],
  subjects: [{ stableKey: "s", name: "自定义科目", color: "#ffffff", groupStableKey: "g" }],
};

function environment(t: test.TestContext, multi = false) {
  for (const [key, value] of Object.entries({ DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/unused",
    AUTH_SESSION_SECRET: "synthetic-test-secret-never-used-32-characters", AUTH_ACTION_TOKEN_SECRET: "synthetic-action-secret-never-used-32-characters",
    AUTH_MULTI_USER_ENABLED: String(multi), AUTH_RBAC_ENABLED: "false", AUTH_WORKSPACES_ENABLED: "false" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

function fixture() {
  let workspace: Record<string, unknown> | null = null;
  let metadata: Prisma.JsonValue | null = null;
  let selected: string | null = "workspace";
  let authorized = true;
  const writes: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    examWorkspace: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id && !authorized) return null;
        return workspace && Object.entries(where).every(([key, value]) => key === "memberships" || workspace?.[key] === value) ? workspace : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        assert.equal(workspace, null, "重复执行 create"); writes.push("workspace");
        workspace = { ...data, id: "workspace", revision: 1, createdAt: new Date(0), updatedAt: new Date(0) }; return workspace;
      },
    },
    auditEvent: {
      findFirst: async () => metadata === null ? null : { metadata },
      create: async ({ data }: { data: { metadata: Prisma.JsonValue } }) => { writes.push("audit"); metadata = data.metadata; },
    },
    studySession: { findFirst: async () => null },
    subjectGroup: { create: async ({ data }: { data: unknown }) => { writes.push("group"); return { ...(data as object), id: "group" }; } },
    subject: { createMany: async () => { writes.push("subjects"); return { count: 1 }; }, count: async () => 1 },
    workspaceMembership: { create: async () => { writes.push("membership"); } },
    workspaceSelection: {
      upsert: async () => { writes.push("selection"); }, findUnique: async () => selected ? { workspaceId: selected } : null,
    },
  } as unknown as Prisma.TransactionClient;
  const client = { $transaction: async (run: (value: Prisma.TransactionClient) => unknown) => run(tx) } as NonNullable<Parameters<typeof createExamWorkspace>[2]>;
  return { tx, client, writes, setMetadata: (value: Prisma.JsonValue) => { metadata = value; },
    selectOther: () => { selected = "other"; }, revoke: () => { authorized = false; },
    clearSelection: () => { selected = null; }, archive: () => { if (workspace) workspace.status = "ARCHIVED"; } };
}

test("首次提交已完成但丢失响应：原命令恢复同一工作区且所有写入只执行一次", async (t) => {
  environment(t);
  const db = fixture();
  await createExamWorkspace("actor", input, db.client); // 模拟提交后丢弃响应。
  const writes = [...db.writes];
  const replay = await createExamWorkspace("actor", input, db.client);
  assert.equal(replay.id, "workspace");
  assert.deepEqual(db.writes, writes);
  assert.deepEqual(writes, ["workspace", "group", "subjects", "membership", "selection", "audit"]);
});

test("同标识不同设置和缺少历史指纹均明确冲突，不追加任何写入", async (t) => {
  environment(t); const db = fixture();
  await createExamWorkspace("actor", input, db.client);
  const count = db.writes.length;
  for (const changed of [{ ...input, name: "其他考试" }, { ...input, activate: false }, { ...input, takeoverSubjectIds: ["legacy"] }]) {
    await assert.rejects(createExamWorkspace("actor", changed, db.client), { message: "WORKSPACE_CREATE_IDEMPOTENCY_CONFLICT" });
  }
  db.setMetadata({ subjectCount: 1 });
  await assert.rejects(createExamWorkspace("actor", input, db.client), { message: "WORKSPACE_STABLE_KEY_ALREADY_EXISTS" });
  assert.equal(db.writes.length, count);
});

test("恢复重验当前选择和权限，不切回工作区、不重放接管", async (t) => {
  environment(t, true); const db = fixture();
  await createExamWorkspace("actor", input, db.client);
  const takeover = { ...input, takeoverSubjectIds: ["already-moved-legacy"] };
  db.setMetadata({ requestFingerprint: workspaceCreateFingerprint(takeover) });
  // 未提供接管查询的 mock：恢复若重新进入接管流程会失败。
  assert.equal((await createExamWorkspace("actor", takeover, db.client)).id, "workspace");
  db.selectOther();
  await assert.rejects(createExamWorkspace("actor", takeover, db.client), { message: "WORKSPACE_CREATE_SELECTION_CHANGED" });
  db.revoke();
  await assert.rejects(recoverWorkspaceCreation(db.tx, "actor", takeover, workspaceCreateFingerprint(takeover)), { message: "WORKSPACE_NOT_FOUND" });
  assert.equal(db.writes.length, 6);
});

test("指纹覆盖所有创建输入，保留顺序语义并规范化默认值", () => {
  const fingerprint = workspaceCreateFingerprint(input);
  assert.equal(workspaceCreateFingerprint({ ...input, name: " 自定义考试 ", activate: undefined, targetExamDate: null }), fingerprint);
  for (const changed of [
    { ...input, targetExamDate: "2026-12-01T00:00:00Z" }, { ...input, stageSummary: "新阶段" },
    { ...input, subjects: [{ ...input.subjects![0], color: "#000000" }] },
    { ...input, groups: [{ stableKey: "g", name: "其他组" }] },
  ]) assert.notEqual(workspaceCreateFingerprint(changed), fingerprint);
  assert.equal(workspaceCreateFingerprint({ ...input, takeoverSubjectIds: ["b", "a", "a"] }),
    workspaceCreateFingerprint({ ...input, takeoverSubjectIds: ["a", "b"] }));
  const subjects = [...input.subjects!, { ...input.subjects![0], stableKey: "second" }];
  const groups = [...input.groups!, { stableKey: "second", name: "第二组" }];
  assert.notEqual(workspaceCreateFingerprint({ ...input, subjects }), workspaceCreateFingerprint({ ...input, subjects: subjects.toReversed() }));
  assert.notEqual(workspaceCreateFingerprint({ ...input, groups }), workspaceCreateFingerprint({ ...input, groups: groups.toReversed() }));
});

test("原请求不激活时可恢复且不写选择；已激活后归档则拒绝自动恢复", async (t) => {
  environment(t);
  const inactive = fixture();
  const command = { ...input, activate: false };
  await createExamWorkspace("actor", command, inactive.client);
  assert.equal((await createExamWorkspace("actor", command, inactive.client)).status, "ARCHIVED");
  assert.equal(inactive.writes.includes("selection"), false);
  const active = fixture();
  await createExamWorkspace("actor", input, active.client);
  active.archive();
  await assert.rejects(createExamWorkspace("actor", input, active.client), { message: "WORKSPACE_CREATE_SELECTION_CHANGED" });
});

test("多人模式当前选择丢失时不悄悄补回", async (t) => {
  environment(t, true); const db = fixture();
  await createExamWorkspace("actor", input, db.client);
  db.clearSelection();
  await assert.rejects(createExamWorkspace("actor", input, db.client), { message: "WORKSPACE_CREATE_SELECTION_CHANGED" });
  assert.equal(db.writes.length, 6);
});
