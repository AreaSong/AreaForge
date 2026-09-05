import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function loadSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function sourceRange(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0 && end > start, `无法定位 ${startMarker} 源码范围`);
  return source.slice(start, end);
}

test("v1.4 Workspace 创建、切换与 takeover 都保持 owner 和活动学习门禁", () => {
  const source = loadSource("lib/study/exam-workspace-service.ts");
  const create = sourceRange(source, "export async function createExamWorkspace", "export async function updateExamWorkspace");
  const activate = sourceRange(source, "export async function activateExamWorkspace", "export async function previewWorkspaceTakeover");
  const takeover = sourceRange(source, "export async function applyWorkspaceTakeover", "async function ensureLegacyTemplateGroups");

  assert.match(create, /if \(activate\) \{\s*await assertWorkspaceSwitchHasNoActiveSession\(tx, actorId\)/);
  assert.match(create, /await tx\.workspaceMembership\.create/);
  assert.doesNotMatch(create, /if \(getAuthEnv\(\)\.AUTH_MULTI_USER_ENABLED\) \{\s*await tx\.workspaceMembership\.create/);
  assert.match(activate, /findWorkspaceSwitchBlockingSession\(tx, actorId\)/);
  assert.match(activate, /selection\?\.revision !== expectedSelectionRevision/);
  assert.match(activate, /where: \{ userId: actorId, revision: expectedSelectionRevision \}/);
  assert.equal((takeover.match(/workspaceOwnerWhere\(actorId\)/g) ?? []).length, 2);
});

test("v1.4 migration 对零个或多个活动 Workspace 的用户均 fail closed", () => {
  const migration = loadSource("../../prisma/migrations/20260905090000_v14_auth_foundation/migration.sql");
  const activeWorkspacePreimage = sourceRange(
    migration,
    "SELECT account.\"id\"",
    "RAISE EXCEPTION 'v1.4 active workspace preimage is ambiguous'",
  );

  assert.match(activeWorkspacePreimage, /FROM "User" AS account/);
  assert.match(activeWorkspacePreimage, /LEFT JOIN "ExamWorkspace" AS workspace/);
  assert.match(activeWorkspacePreimage, /HAVING count\(workspace\."id"\) <> 1/);
});

test("v1.4 UI 不向普通成员提供 owner-only Workspace 切换入口", () => {
  const sidebar = loadSource("components/workspace-settings-sidebar.tsx");
  const membership = loadSource("components/workspace-membership-client.tsx");

  assert.match(sidebar, /workspace\.membershipRole === "MEMBER"[\s\S]*?<Badge>成员<\/Badge>/);
  assert.match(membership, /workspace\.membershipRole === "OWNER" && workspace\.status === "ACTIVE" && !workspace\.current/);
});

test("v1.4 Workspace 生命周期 PATCH 不混入内容字段", () => {
  const route = loadSource("app/api/exam-workspaces/[id]/route.ts");

  assert.match(route, /value\.archived === undefined/);
  assert.match(route, /\[value\.name, value\.targetExamDate, value\.stageSummary\]/);
  assert.match(route, /archived cannot be combined with workspace content fields/);
});

test("v1.4 邀请失败统一 continuation 且成员只能看见本人目录", () => {
  const source = loadSource("lib/workspace/membership-service.ts");
  const listMembers = sourceRange(source, "export async function listWorkspaceMembers", "export async function listWorkspaceInvitations");
  const reject = sourceRange(source, "export async function rejectWorkspaceInvitation", "export async function removeWorkspaceMember");

  assert.match(listMembers, /actorMembership\.role === "OWNER"[\s\S]*?\{ id: actorMembership\.id/);
  assert.equal((reject.match(/throw invitationContinuationRequired\(\)/g) ?? []).length, 2);
  assert.match(source, /invitation\.workspace\.status !== "ACTIVE"/);
  assert.match(source, /requireActiveOwner\(tx, actor\.id, workspaceId\)/);
});

test("v1.4 密码重置邮件在统一响应返回后投递", () => {
  const route = loadSource("app/api/auth/password/forgot/route.ts");
  const service = loadSource("lib/auth/action-token-service.ts");

  assert.match(route, /after\(\(\) => deliverPasswordReset\(delivery\)\)/);
  assert.match(route, /finally \{\s*await enforcePasswordResetResponseTiming/);
  assert.match(service, /export async function preparePasswordReset/);
  assert.match(service, /export async function deliverPasswordReset/);
});

test("v1.4 一次性凭证 UI 有同步互斥并显式处理断网", () => {
  for (const file of [
    "components/invitation-accept-client.tsx",
    "components/token-password-reset-client.tsx",
    "components/email-verification-client.tsx",
  ]) {
    const source = loadSource(file);
    assert.match(source, /actionPendingRef\.current/);
    assert.match(source, /result\.status === 0/);
    assert.match(source, /aria-busy=\{pending\}/);
  }
});
