import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  isExamWorkspaceDto,
  isWorkspaceEditDraft,
  isWorkspaceSetupDraft,
  toWorkspaceEditDraft,
  workspaceEditDraftsEqual,
} from "./workspace-settings-support";
import {
  canUseTakeoverPreview,
  materializeFirstUseTemplateSelection,
  workspaceSetupErrorMessage,
} from "@/lib/workspace/first-use";
import {
  compareItems,
  emptyDraft,
  isEmptyDraft,
  isHttpsUrl,
  isMotivationItem,
  isMotivationLibraryDraft,
  motivationVaultOptions,
  parseTags,
} from "./motivation-library-support";
import {
  isAiProviderCredentialStatus,
  isAiProviderPreference,
  isAiRuntimeSettingStatus,
  providerSourceLabel,
} from "./ai-settings-model";
import { getUpdateCenterHealth } from "@/lib/system/update-center-health";
import type { UpdateCenterStatus } from "@/lib/system/update-center";
import {
  formatDateTime,
  labelAction,
  labelAutoApply,
  labelOperationStatus,
  normalizedTag,
  shortHash,
} from "@/lib/system/update-center-ui";
import type { ExamWorkspaceDto, TakeoverPreviewDto, MotivationVaultDto, MotivationItemDto } from "@/lib/contracts";

function findRepoPath(relativePath: string): string {
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), "..", "..", relativePath),
    path.resolve(process.cwd(), relativePath.replace(/^apps\/web\//, "")),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(process.cwd(), relativePath);
}

test("Challenger 2 - Dual-Column Layout Contract & AST Verification across all Settings Pages", () => {
  const settingsPages = [
    { name: "Settings Index", file: "apps/web/app/(app)/settings/page.tsx" },
    { name: "Settings Exams Client", file: "apps/web/components/workspace-settings-client.tsx" },
    { name: "Settings Profile", file: "apps/web/app/(app)/settings/profile/page.tsx" },
    { name: "Settings Learning", file: "apps/web/app/(app)/settings/learning/page.tsx" },
    { name: "Settings AI", file: "apps/web/app/(app)/settings/ai/page.tsx" },
    { name: "Settings Data", file: "apps/web/app/(app)/settings/data/page.tsx" },
    { name: "Settings System Workbench", file: "apps/web/components/settings-workbench.tsx" },
  ];

  for (const item of settingsPages) {
    const filePath = findRepoPath(item.file);
    assert.ok(fs.existsSync(filePath), `File exists: ${item.file}`);
    const content = fs.readFileSync(filePath, "utf-8");
    const semanticContent = item.file.endsWith("workspace-settings-client.tsx")
      ? `${content}\n${fs.readFileSync(findRepoPath("apps/web/components/workspace-settings-sidebar.tsx"), "utf-8")}`
      : content;

    // Must have standard dual-column grid class
    assert.match(
      content,
      /grid-cols-1 gap-6 lg:grid-cols-\[280px_1fr\] xl:grid-cols-\[320px_1fr\]/,
      `${item.name} must have canonical dual-column responsive grid`,
    );

    // Must have aside and main semantic elements
    assert.match(semanticContent, /<aside[\s\S]*?>/, `${item.name} must have <aside> semantic container`);
    assert.match(content, /<main[\s\S]*?>/, `${item.name} must have <main> semantic container`);

    // Must have min-w-0 on main container to prevent grid blowout on small screens
    assert.match(content, /<main[^>]*min-w-0[^>]*>/, `${item.name} main must have min-w-0`);

    // Must not have legacy raw background color overrides
    assert.doesNotMatch(semanticContent, /bg-\[#0d1117\]/, `${item.name} must not contain raw bg-[#0d1117]`);
    assert.doesNotMatch(semanticContent, /bg-\[#101419\]/, `${item.name} must not contain raw bg-[#101419]`);
    assert.doesNotMatch(semanticContent, /bg-\[#151a20\]/, `${item.name} must not contain raw bg-[#151a20]`);
  }
});

test("Challenger 2 - Workspace Setup vs Normal Edit Mode State Machine & Edge Cases", () => {
  const initial = {
    subjects: [{ id: "custom", stableKey: "custom-one", name: "自定义科目", color: "#35d7c5", groupStableKey: null }],
    groups: [],
  };
  const templated = materializeFirstUseTemplateSelection({
    ...initial,
    templateId: "computer-science-408",
  });
  assert.equal(templated.subjects.length, 5);
  assert.equal(templated.groups.length, 1);
  assert.deepEqual(materializeFirstUseTemplateSelection({
    ...templated,
    templateId: "computer-science-408",
  }), templated);

  // Test takeover eligibility checks under adversarial conditions
  assert.equal(canUseTakeoverPreview(null), false);
  const emptyTakeover: TakeoverPreviewDto = {
    eligibleSubjects: [],
    eligibleSubjectIds: [],
    unresolvedSubjectIds: [],
    eligibleCount: 0,
    unresolvedCount: 0,
    crossOwnerBlockedCount: 0,
    affectedDateCount: 0,
    affectedPeriodCount: 0,
  };
  assert.equal(canUseTakeoverPreview(emptyTakeover), true);

  // Test setup error message mapping
  assert.equal(workspaceSetupErrorMessage("SUBJECT_STABLE_KEY_CONFLICT_WITH_TAKEOVER"), "新科目与已有科目的内部标识重复。请返回修改，或选择沿用已有科目。");
  assert.equal(workspaceSetupErrorMessage("TAKEOVER_SUBJECT_NOT_ELIGIBLE"), "旧数据状态已经变化，请刷新预览后重新确认。");
  assert.equal(workspaceSetupErrorMessage("SUBJECT_STABLE_KEY_DUPLICATE"), "新科目的内部标识重复，请返回修改。");
  assert.equal(workspaceSetupErrorMessage("INTERNAL_ERROR"), "设置未完成，请刷新后重试；草稿仍保留。");

  // Test CAS workspace edit baseline and conflict detection
  const workspaceA: ExamWorkspaceDto = {
    id: "ws-test",
    stableKey: "ws-k",
    name: "考研2027",
    targetExamDate: "2026-12-26T00:00:00.000Z",
    stageSummary: "基础阶段",
    status: "ACTIVE",
    revision: 5,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const draftBaseline = toWorkspaceEditDraft(workspaceA);
  assert.equal(draftBaseline.baseRevision, 5);
  assert.equal(draftBaseline.name, "考研2027");

  // Draft equality check under variations
  const identicalDraft = { ...draftBaseline };
  assert.equal(workspaceEditDraftsEqual(draftBaseline, identicalDraft), true);

  const changedNameDraft = { ...draftBaseline, name: "考研2027（复试）" };
  assert.equal(workspaceEditDraftsEqual(draftBaseline, changedNameDraft), false);

  const changedSummaryDraft = { ...draftBaseline, stageSummary: "冲刺阶段" };
  assert.equal(workspaceEditDraftsEqual(draftBaseline, changedSummaryDraft), false);

  const changedRevisionDraft = { ...draftBaseline, baseRevision: 6 };
  assert.equal(workspaceEditDraftsEqual(draftBaseline, changedRevisionDraft), false);
});

test("Challenger 2 - Motivation Vault & AI Privacy Boundary Guarantees", () => {
  const vault: MotivationVaultDto = {
    id: "vault-secret",
    whyStarted: "追求学术与工程卓越，绝不妥协。",
    neverReturnTo: "荒废时光与无序内耗。",
    futureSelf: "冷静自律且富有创造力的计算机学者。",
    messageToFuture: "永远保持饥渴与敬畏。",
    firstSimulationDiary: "首轮模考总结分析。",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
  };

  const excerpts = motivationVaultOptions(vault);
  assert.equal(excerpts.length, 5);
  assert.equal(excerpts.some((e) => e.field === "whyStarted" && e.text.includes("追求学术")), true);
  assert.equal(excerpts.some((e) => e.field === "neverReturnTo" && e.text.includes("荒废时光")), true);
  assert.equal(excerpts.some((e) => e.field === "futureSelf" && e.text.includes("冷静自律")), true);

  // Test URL security: only HTTPS allowed for video/external links
  assert.equal(isHttpsUrl("https://www.bilibili.com/video/BV1234567"), true);
  assert.equal(isHttpsUrl("https://youtube.com/watch?v=12345"), true);
  assert.equal(isHttpsUrl("http://insecure.site/video.mp4"), false);
  assert.equal(isHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isHttpsUrl("data:text/html,<script>"), false);
  assert.equal(isHttpsUrl(""), false);

  // Tag parser robustness against commas, spaces, tabs, and malicious inputs
  assert.deepEqual(parseTags("  tag1, tag2 , , tag3 ,"), ["tag1", "tag2", "tag3"]);
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags("   \t\n  "), []);
});

test("Challenger 2 - AI Provider Configuration & Credential Shielding", () => {
  // Provider source label robustness
  assert.equal(providerSourceLabel("account"), "当前账户");
  assert.equal(providerSourceLabel("environment"), "部署环境回退");
  assert.equal(providerSourceLabel("none"), "未配置");

  // Credential status discriminator validation
  const validStatus = {
    source: "account" as const,
    accountConfigured: true,
    effectiveConfigured: true,
    apiKeyConfigured: true,
    encryptionConfigured: true,
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    revision: 1,
    globalEnabled: true,
  };
  assert.equal(isAiProviderCredentialStatus(validStatus), true);

  // Reject malicious or malformed schemas
  assert.equal(isAiProviderCredentialStatus({ ...validStatus, source: "hack" as unknown as "account" }), false);
  assert.equal(isAiProviderCredentialStatus({ ...validStatus, baseUrl: 123 as unknown as string }), false);
  assert.equal(isAiProviderCredentialStatus(null), false);
  assert.equal(isAiProviderCredentialStatus(undefined), false);

  // Browser preference scoping
  assert.equal(isAiProviderPreference({ externalProviderEnabled: true, scope: "current_browser" }), true);
  assert.equal(isAiProviderPreference({ externalProviderEnabled: false, scope: "current_browser" }), true);
  assert.equal(isAiProviderPreference({ externalProviderEnabled: true, scope: "global" as unknown as "current_browser" }), false);
});

test("Challenger 2 - Update Center Controlled Buttons & Health Failsafes", () => {
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

  // 1. Normal state with update available
  assert.equal(getUpdateCenterHealth(baseStatus, fixedNow), "update_available");

  // 2. Blocked by database migration or policy
  const blockedStatus: UpdateCenterStatus = {
    ...baseStatus,
    blocker: "数据库 migration 待执行，无法自动更新",
  };
  assert.equal(getUpdateCenterHealth(blockedStatus, fixedNow), "blocked");

  // 3. Stale status (more than 7 days without check)
  const staleStatus: UpdateCenterStatus = {
    ...baseStatus,
    statusUpdatedAt: new Date(fixedNow - 8 * 86400_000).toISOString(),
    lastCheckedAt: new Date(fixedNow - 8 * 86400_000).toISOString(),
  };
  assert.equal(getUpdateCenterHealth(staleStatus, fixedNow), "stale");

  // 4. Unknown status when snapshotHash is null / unverified
  const unverifiedStatus: UpdateCenterStatus = {
    ...baseStatus,
    snapshotHash: null,
  };
  assert.equal(getUpdateCenterHealth(unverifiedStatus, fixedNow), "unknown");

  // 5. Normal up-to-date healthy state
  const upToDateStatus: UpdateCenterStatus = {
    ...baseStatus,
    latestVersion: "1.1.1",
    updateAvailable: false,
  };
  assert.equal(getUpdateCenterHealth(upToDateStatus, fixedNow), "healthy");
});
