import assert from "node:assert/strict";
import test from "node:test";
import {
  isExamWorkspaceDto,
  isWorkspaceEditDraft,
  isWorkspaceSetupDraft,
  toWorkspaceEditDraft,
  workspaceEditDraftsEqual,
} from "./workspace-settings-support";
import {
  subjectColors,
  subjectErrorMessage,
} from "./workspace-subject-manager-sections";
import {
  compareItems,
  emptyDraft,
  isEmptyDraft,
  isHttpsUrl,
  isMotivationItem,
  isMotivationLibraryDraft,
  motivationVaultOptions,
  parseTags,
  typeLabels,
} from "./motivation-library-support";
import {
  isAiProviderCredentialStatus,
  isAiProviderPreference,
  isAiRuntimeSettingStatus,
  providerSourceLabel,
} from "./ai-settings-model";
import type { UpdateCenterStatus } from "@/lib/system/update-center";
import {
  formatDateTime,
  labelAction,
  labelAutoApply,
  labelOperationStatus,
  normalizedTag,
  shortHash,
} from "@/lib/system/update-center-ui";
import { getUpdateCenterHealth } from "@/lib/system/update-center-health";
import type {
  ExamWorkspaceDto,
  MotivationItemDto,
  MotivationVaultDto,
} from "@/lib/contracts";

test("workspace-settings-support: validates setup drafts and edit drafts deterministically", () => {
  const validSetup = {
    step: "goal",
    name: "2027 考研工作区",
    stableKey: "ws-2027",
    targetExamDate: "2026-12-26",
    subjectName: "高等数学",
    subjectKey: "math-advanced",
    include408: true,
  };

  assert.equal(isWorkspaceSetupDraft(validSetup), true);
  assert.equal(isWorkspaceSetupDraft({ ...validSetup, step: "invalid-step" }), false);
  assert.equal(isWorkspaceSetupDraft({ ...validSetup, name: 123 }), false);
  assert.equal(isWorkspaceSetupDraft(null), false);
  assert.equal(isWorkspaceSetupDraft(undefined), false);

  const sampleWorkspace: ExamWorkspaceDto = {
    id: "ws-1",
    stableKey: "ws-2027",
    name: "计算机考研",
    targetExamDate: "2026-12-26T00:00:00.000Z",
    stageSummary: "强化阶段进行中",
    status: "ACTIVE",
    revision: 3,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const editDraft = toWorkspaceEditDraft(sampleWorkspace);
  assert.equal(editDraft.name, "计算机考研");
  assert.equal(editDraft.stageSummary, "强化阶段进行中");
  assert.equal(editDraft.baseRevision, 3);
  assert.equal(isWorkspaceEditDraft(editDraft), true);
  assert.equal(isExamWorkspaceDto(sampleWorkspace), true);

  const modifiedDraft = { ...editDraft, name: "计算机考研（冲刺）" };
  assert.equal(workspaceEditDraftsEqual(editDraft, modifiedDraft), false);
  assert.equal(workspaceEditDraftsEqual(editDraft, { ...editDraft }), true);

  // Invalid exam workspace DTO checks
  assert.equal(isExamWorkspaceDto({ id: "ws-1", revision: 0 }), false);
  assert.equal(isExamWorkspaceDto({ id: "ws-1", name: "test", status: "DELETED", revision: 1 }), false);
});

test("workspace-subject-manager-sections: verifies error mapping and color palette constraints", () => {
  assert.ok(subjectColors.length >= 6);
  for (const color of subjectColors) {
    assert.match(color, /^#[0-9a-fA-F]{6}$/);
  }

  assert.equal(
    subjectErrorMessage("WORKSPACE_NOT_FOUND", "default"),
    "当前工作区已切换，页面正在刷新；请在新工作区中重新操作。",
  );
  assert.equal(
    subjectErrorMessage("WORKSPACE_REVISION_CONFLICT", "default"),
    "工作区刚刚发生变化，页面已刷新；请检查后再次提交。",
  );
  assert.equal(
    subjectErrorMessage("WORKSPACE_ACTIVE_SUBJECT_REQUIRED", "default"),
    "至少需要保留一个使用中的科目。",
  );
  assert.equal(
    subjectErrorMessage("ACTIVE_SESSION_BLOCKS_SUBJECT_ARCHIVE", "default"),
    "这个科目仍有进行中的计时，请先结束计时。",
  );
  assert.equal(
    subjectErrorMessage("SUBJECT_GROUP_NOT_FOUND", "default"),
    "所选分组已不可用，请刷新后重新选择。",
  );
  assert.equal(
    subjectErrorMessage("SUBJECT_STABLE_KEY_ALREADY_EXISTS", "default"),
    "该科目内部标识已存在，请修改后重试。",
  );
  assert.equal(
    subjectErrorMessage("SUBJECT_GROUP_STABLE_KEY_ALREADY_EXISTS", "default"),
    "该分组内部标识已存在，请修改后重试。",
  );
  assert.equal(
    subjectErrorMessage("INTERNAL_ERROR", "default"),
    "保存失败，请刷新后重试；若持续出现，请通过支持入口反馈。",
  );
  assert.equal(subjectErrorMessage(undefined, "自定义错误"), "自定义错误");
});

test("motivation-library-support: verifies URL validation, tag parsing, and vault excerpt options", () => {
  assert.equal(isHttpsUrl("https://bilibili.com/video/BV1xx411c7mD"), true);
  assert.equal(isHttpsUrl("http://insecure.example.com"), false);
  assert.equal(isHttpsUrl("ftp://files.example.com"), false);
  assert.equal(isHttpsUrl("not-a-url"), false);

  assert.deepEqual(parseTags("  考研, 冲刺,  数学 , 408 "), ["考研", "冲刺", "数学", "408"]);
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags("   "), []);

  const vault: MotivationVaultDto = {
    id: "vault-1",
    whyStarted: "为了掌握底层计算机知识并拥有更多自主选择。",
    neverReturnTo: "被动应付、无目标消耗的状态。",
    futureSelf: "冷静、专注且具备系统化工程能力的自己。",
    messageToFuture: "当感到疲惫时，回看最初承诺。",
    firstSimulationDiary: "首轮模考 110 分，基础扎实，继续突破大题。",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
  };

  const options = motivationVaultOptions(vault);
  assert.equal(options.length, 5);
  assert.equal(options[0].field, "whyStarted");
  assert.equal(options[0].text, vault.whyStarted);

  const emptyOptions = motivationVaultOptions(null);
  assert.equal(emptyOptions.length, 0);

  assert.equal(isEmptyDraft(emptyDraft), true);
  assert.equal(isMotivationLibraryDraft(emptyDraft), true);

  const itemA: MotivationItemDto = {
    id: "item-1",
    type: "QUOTE",
    title: "语录 A",
    body: "坚持到底",
    externalUrl: null,
    vaultSourceId: null,
    tags: ["激励"],
    sortOrder: 0,
    enabled: true,
    archivedAt: null,
    revision: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const itemB: MotivationItemDto = {
    ...itemA,
    id: "item-2",
    title: "语录 B",
    sortOrder: 1,
  };

  assert.equal(isMotivationItem(itemA), true);
  assert.equal(compareItems(itemA, itemB) < 0, true);
  assert.equal(typeLabels.QUOTE, "语录");
  assert.equal(typeLabels.VIDEO_LINK, "HTTPS 视频链接");
  assert.equal(typeLabels.VAULT_EXCERPT, "动机封存摘录");
});

test("ai-settings-model: verifies status discriminators and label mapping", () => {
  assert.equal(providerSourceLabel("account"), "当前账户");
  assert.equal(providerSourceLabel("environment"), "部署环境回退");
  assert.equal(providerSourceLabel("none"), "未配置");

  const validCredentialStatus = {
    source: "account" as const,
    accountConfigured: true,
    effectiveConfigured: true,
    apiKeyConfigured: true,
    encryptionConfigured: true,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    revision: 2,
    globalEnabled: true,
  };
  assert.equal(isAiProviderCredentialStatus(validCredentialStatus), true);
  assert.equal(isAiProviderCredentialStatus({ ...validCredentialStatus, source: "invalid_source" }), false);
  assert.equal(isAiProviderCredentialStatus({ ...validCredentialStatus, globalEnabled: "invalid" }), false);

  const validPreference = {
    externalProviderEnabled: true,
    scope: "current_browser" as const,
  };
  assert.equal(isAiProviderPreference(validPreference), true);
  assert.equal(isAiProviderPreference({ externalProviderEnabled: false, scope: "other_scope" }), false);

  const validRuntime = {
    serverEnabled: true,
    webEnabled: true,
    effectiveEnabled: true,
    bindingSecretConfigured: true,
    revision: 1,
    updatedAt: null,
  };
  assert.equal(isAiRuntimeSettingStatus(validRuntime), true);
  assert.equal(isAiRuntimeSettingStatus({ ...validRuntime, webEnabled: "invalid" }), false);
});

test("update-center-ui and health: verifies version metrics and operational state machine", () => {
  assert.equal(normalizedTag("v1.1.2"), "v1.1.2");
  assert.equal(normalizedTag("1.1.2"), "v1.1.2");

  assert.equal(shortHash("5df38417b701f3511d06db235c5b94755ca03aba"), "5df38417b701f35...5ca03aba");
  assert.equal(shortHash(null), "未验证");

  assert.equal(labelAction("check"), "检查更新");
  assert.equal(labelAction("apply"), "应用更新");
  assert.equal(labelAction("rollback"), "版本回退");

  assert.equal(labelAutoApply("none"), "只检查");
  assert.equal(labelAutoApply("patch"), "自动 patch");

  assert.equal(labelOperationStatus("succeeded"), "成功");
  assert.equal(labelOperationStatus("failed"), "失败");
  assert.equal(labelOperationStatus("needs_reconciliation"), "需要人工协调");

  const fixedNow = 1756200000000;
  const baseStatus: UpdateCenterStatus = {
    currentVersion: "1.1.1",
    currentImage: "ghcr.io/areasong/areaforge:1.1.1",
    appUrl: "https://forge.areasong.top",
    latestVersion: "1.1.2",
    updateAvailable: true,
    statusUpdatedAt: new Date(fixedNow - 60_000).toISOString(),
    lastCheckedAt: new Date(fixedNow - 60_000).toISOString(),
    latestPublishedAt: new Date(fixedNow - 3600_000).toISOString(),
    deployMode: "release",
    autoApply: "none",
    timerEnabled: true,
    timerActive: true,
    signatureRequired: true,
    releaseUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v1.1.2",
    snapshotHash: "5df38417b701f3511d06db235c5b94755ca03aba",
    snapshotSchemaVersion: 2,
    requestQueueLength: 0,
    blocker: null,
    rollback: {
      available: true,
      targetVersion: "1.1.0",
      targetImage: null,
    },
    lastOperation: null,
  };

  assert.equal(getUpdateCenterHealth(baseStatus, fixedNow), "update_available");

  const blockedStatus: UpdateCenterStatus = {
    ...baseStatus,
    blocker: "数据库 migration 待执行，无法自动更新",
  };
  assert.equal(getUpdateCenterHealth(blockedStatus, fixedNow), "blocked");

  const unverifiedStatus: UpdateCenterStatus = {
    ...baseStatus,
    snapshotHash: null,
  };
  assert.equal(getUpdateCenterHealth(unverifiedStatus, fixedNow), "unknown");
});
