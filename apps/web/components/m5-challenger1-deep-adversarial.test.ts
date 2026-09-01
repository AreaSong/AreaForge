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
  type WorkspaceEditDraft,
  type WorkspaceSetupDraft,
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
import {
  buildFirstUseSubjects,
  canUseTakeoverPreview,
  nextAvailableGeneratedKey,
  workspaceSetupErrorMessage,
} from "@/lib/workspace/first-use";
import type {
  ExamWorkspaceDto,
  MotivationItemDto,
  MotivationVaultDto,
  TakeoverPreviewDto,
} from "@/lib/contracts";

// Helper to resolve workspace root regardless of whether cwd is repo root or apps/web
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

// ---------------------------------------------------------------------------
// 1. Dual-Column Responsiveness & Layout Architecture Verification
// ---------------------------------------------------------------------------

test("Adversarial M5: Settings subviews conform to canonical dual-column workbench contract", () => {
  const settingsPages = [
    { file: "apps/web/app/(app)/settings/page.tsx", name: "Settings Index" },
    { file: "apps/web/app/(app)/settings/exams/page.tsx", name: "Settings Exams" },
    { file: "apps/web/app/(app)/settings/profile/page.tsx", name: "Settings Profile" },
    { file: "apps/web/app/(app)/settings/learning/page.tsx", name: "Settings Learning" },
    { file: "apps/web/app/(app)/settings/ai/page.tsx", name: "Settings AI" },
    { file: "apps/web/app/(app)/settings/data/page.tsx", name: "Settings Data" },
    { file: "apps/web/app/(app)/settings/system/page.tsx", name: "Settings System" },
  ];

  for (const page of settingsPages) {
    const fullPath = findRepoPath(page.file);
    assert.ok(fs.existsSync(fullPath), `Page file ${page.file} must exist at ${fullPath}`);
    const content = fs.readFileSync(fullPath, "utf-8");

    // All pages must use dashboard-wide PageFrame
    assert.match(
      content,
      /<PageFrame\s+variant="dashboard-wide"/,
      `${page.name} (${page.file}) must render <PageFrame variant="dashboard-wide">`,
    );

    // If it's a page that directly renders the grid or delegates to dual-column client component:
    if (page.file.endsWith("exams/page.tsx")) {
      const clientPath = findRepoPath("apps/web/components/workspace-settings-client.tsx");
      const clientContent = fs.readFileSync(clientPath, "utf-8");
      assert.match(
        clientContent,
        /grid grid-cols-1 gap-6 lg:grid-cols-\[280px_1fr\] xl:grid-cols-\[320px_1fr\]/,
        "WorkspaceSettingsClient must contain canonical dual-column responsive grid",
      );
      assert.match(clientContent, /<aside className="space-y-5">/, "WorkspaceSettingsClient must contain <aside>");
      assert.match(clientContent, /<main className="space-y-6 min-w-0">/, "WorkspaceSettingsClient must contain <main>");
    } else if (page.file.endsWith("system/page.tsx")) {
      const workbenchPath = findRepoPath("apps/web/components/settings-workbench.tsx");
      const workbenchContent = fs.readFileSync(workbenchPath, "utf-8");
      assert.match(
        workbenchContent,
        /grid grid-cols-1 gap-6 lg:grid-cols-\[280px_1fr\] xl:grid-cols-\[320px_1fr\]/,
        "SettingsWorkbench must contain canonical dual-column responsive grid",
      );
      assert.match(workbenchContent, /<aside className="space-y-5">/, "SettingsWorkbench must contain <aside>");
      assert.match(workbenchContent, /<main className="space-y-6 min-w-0">/, "SettingsWorkbench must contain <main>");
    } else {
      assert.match(
        content,
        /grid grid-cols-1 gap-6 lg:grid-cols-\[280px_1fr\] xl:grid-cols-\[320px_1fr\]/,
        `${page.name} (${page.file}) must contain canonical dual-column responsive grid`,
      );
      assert.match(content, /<aside\b/, `${page.name} (${page.file}) must contain <aside>`);
      assert.match(content, /<main\b/, `${page.name} (${page.file}) must contain <main>`);
    }

    // Zero legacy dark backgrounds: no bg-[#0d1117], bg-[#101419], bg-[#151a20]
    assert.doesNotMatch(content, /bg-\[#0d1117\]/, `${page.file} must not contain legacy bg-[#0d1117]`);
    assert.doesNotMatch(content, /bg-\[#101419\]/, `${page.file} must not contain legacy bg-[#101419]`);
    assert.doesNotMatch(content, /bg-\[#151a20\]/, `${page.file} must not contain legacy bg-[#151a20]`);
  }
});

// ---------------------------------------------------------------------------
// 2. Workspace Setup Mode vs Normal Edit Mode Stress Testing
// ---------------------------------------------------------------------------

test("Adversarial M5: WorkspaceSetupDraft schema strictly guards against hostile inputs", () => {
  const valid: WorkspaceSetupDraft = {
    step: "goal",
    name: "2027 考研",
    stableKey: "ws-2027",
    targetExamDate: "2026-12-26",
    subjectName: "高等数学",
    subjectKey: "advanced-math",
    include408: true,
  };

  assert.equal(isWorkspaceSetupDraft(valid), true);
  assert.equal(isWorkspaceSetupDraft({ ...valid, step: "takeover" }), true);

  // Hostile / malformed variations
  assert.equal(isWorkspaceSetupDraft(null), false);
  assert.equal(isWorkspaceSetupDraft(undefined), false);
  assert.equal(isWorkspaceSetupDraft(123), false);
  assert.equal(isWorkspaceSetupDraft("valid string"), false);
  assert.equal(isWorkspaceSetupDraft([]), false);
  assert.equal(isWorkspaceSetupDraft({ ...valid, step: "unknown_step" }), false);
  assert.equal(isWorkspaceSetupDraft({ ...valid, name: null }), false);
  assert.equal(isWorkspaceSetupDraft({ ...valid, include408: "true" }), false);
  assert.equal(isWorkspaceSetupDraft({ ...valid, targetExamDate: 20261226 }), false);
  assert.equal(isWorkspaceSetupDraft({ ...valid, subjectKey: undefined }), false);

  // Missing fields
  const { include408: _, ...missingField } = valid;
  assert.equal(isWorkspaceSetupDraft(missingField), false);
});

test("Adversarial M5: WorkspaceEditDraft & ExamWorkspaceDto CAS validation & diffing", () => {
  const workspaceDto: ExamWorkspaceDto = {
    id: "ws-abc-123",
    stableKey: "ws-primary",
    name: "计算机考研攻坚",
    targetExamDate: "2026-12-26T00:00:00.000Z",
    stageSummary: "第一轮基础巩固中",
    status: "ACTIVE",
    revision: 5,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  };

  assert.equal(isExamWorkspaceDto(workspaceDto), true);

  // Hostile DTO checks
  assert.equal(isExamWorkspaceDto({ ...workspaceDto, id: 123 }), false);
  assert.equal(isExamWorkspaceDto({ ...workspaceDto, status: "PENDING" }), false);
  assert.equal(isExamWorkspaceDto({ ...workspaceDto, revision: 0 }), false);
  assert.equal(isExamWorkspaceDto({ ...workspaceDto, revision: -1 }), false);
  assert.equal(isExamWorkspaceDto({ ...workspaceDto, revision: 1.5 }), false); // non-integer

  // Draft extraction
  const draft = toWorkspaceEditDraft(workspaceDto);
  assert.equal(draft.name, "计算机考研攻坚");
  assert.equal(draft.targetExamDate, "2026-12-26");
  assert.equal(draft.stageSummary, "第一轮基础巩固中");
  assert.equal(draft.baseRevision, 5);
  assert.equal(isWorkspaceEditDraft(draft), true);

  // Nullable targetExamDate & stageSummary
  const emptyWorkspace: ExamWorkspaceDto = {
    ...workspaceDto,
    targetExamDate: null,
    stageSummary: null,
  };
  const emptyDraft = toWorkspaceEditDraft(emptyWorkspace);
  assert.equal(emptyDraft.targetExamDate, "");
  assert.equal(emptyDraft.stageSummary, "");
  assert.equal(isWorkspaceEditDraft(emptyDraft), true);

  // Equality checking
  const cloned = structuredClone(draft);
  assert.equal(workspaceEditDraftsEqual(draft, cloned), true);
  assert.equal(workspaceEditDraftsEqual(draft, { ...draft, name: "不同名称" }), false);
  assert.equal(workspaceEditDraftsEqual(draft, { ...draft, baseRevision: 6 }), false);
});

test("Adversarial M5: first-use subjects generation and takeover preview safety", () => {
  // 1. Basic first use without 408
  const subjectsWithout408 = buildFirstUseSubjects({
    subjectKey: "math-1",
    subjectName: "高等数学",
    include408: false,
    takeoverSubjects: [],
  });
  assert.equal(subjectsWithout408.length, 1);
  assert.equal(subjectsWithout408[0].name, "高等数学");
  assert.equal(subjectsWithout408[0].stableKey, "math-1");

  // 2. First use with 408
  const subjectsWith408 = buildFirstUseSubjects({
    subjectKey: "math-1",
    subjectName: "高等数学",
    include408: true,
    takeoverSubjects: [],
  });
  assert.equal(subjectsWith408.length, 5); // 1 Math + 4 CS 408 subjects
  assert.ok(subjectsWith408.some((s) => s.name === "数据结构"));
  assert.ok(subjectsWith408.some((s) => s.name === "计算机组成原理"));
  assert.ok(subjectsWith408.some((s) => s.name === "操作系统"));
  assert.ok(subjectsWith408.some((s) => s.name === "计算机网络"));

  // 3. Takeover deduplication
  const takeoverSubjects = [
    { legacyCode: "DATA_STRUCTURE" },
    { legacyCode: "MATH" },
  ];
  const mergedTakeover = buildFirstUseSubjects({
    subjectKey: "math",
    subjectName: "高等数学",
    include408: true,
    takeoverSubjects,
  });
  // Math was reused, so not duplicated. Data structures was reused, so remaining 408 subjects are 3
  const dsCount = mergedTakeover.filter((s) => s.name === "数据结构").length;
  assert.equal(dsCount, 0);
  const mathCount = mergedTakeover.filter((s) => s.name === "高等数学").length;
  assert.equal(mathCount, 0);
  assert.equal(mergedTakeover.length, 3); // OS, CO, CN

  // 4. canUseTakeoverPreview validator
  assert.equal(canUseTakeoverPreview(null), false);
  assert.equal(canUseTakeoverPreview(undefined), false);
  const validTakeover: TakeoverPreviewDto = {
    eligibleCount: 2,
    unresolvedCount: 0,
    crossOwnerBlockedCount: 0,
    affectedDateCount: 0,
    affectedPeriodCount: 0,
    eligibleSubjectIds: ["sub-1", "sub-2"],
    unresolvedSubjectIds: [],
    eligibleSubjects: [
      { id: "sub-1", name: "数学", stableKey: "math", legacyCode: "MATH" },
      { id: "sub-2", name: "英语", stableKey: "eng", legacyCode: null },
    ],
  };
  assert.equal(canUseTakeoverPreview(validTakeover), true);

  // Error message mapper
  assert.equal(
    workspaceSetupErrorMessage("SUBJECT_STABLE_KEY_CONFLICT_WITH_TAKEOVER"),
    "新科目与已有科目的内部标识重复。请返回修改，或选择沿用已有科目。",
  );
  assert.equal(
    workspaceSetupErrorMessage("TAKEOVER_SUBJECT_NOT_ELIGIBLE"),
    "旧数据状态已经变化，请刷新预览后重新确认。",
  );
  assert.equal(
    workspaceSetupErrorMessage("SUBJECT_STABLE_KEY_DUPLICATE"),
    "新科目的内部标识重复，请返回修改。",
  );
  assert.equal(
    workspaceSetupErrorMessage("INTERNAL_ERROR"),
    "设置未完成，请刷新后重试；草稿仍保留。",
  );
  assert.equal(workspaceSetupErrorMessage("WORKSPACE_ALREADY_EXISTS"), "WORKSPACE_ALREADY_EXISTS");
  assert.equal(workspaceSetupErrorMessage(undefined), "创建工作区失败，首次设置草稿已保留");
});

test("Adversarial M5: nextAvailableGeneratedKey prevents key collisions and handles gaps", () => {
  // Empty initial
  assert.equal(nextAvailableGeneratedKey("subject", []), "subject-1");

  // Dense list
  assert.equal(
    nextAvailableGeneratedKey("subject", ["subject-1", "subject-2", "subject-3"]),
    "subject-4",
  );

  // Gaps
  assert.equal(
    nextAvailableGeneratedKey("group", ["group-1", "group-3"]),
    "group-2",
  );

  // With custom non-matching prefixes
  assert.equal(
    nextAvailableGeneratedKey("subject", ["math-advanced", "ds-408", "os-408"]),
    "subject-1",
  );
});

// ---------------------------------------------------------------------------
// 3. Motivation Vault & Motivation Library Stress Testing
// ---------------------------------------------------------------------------

test("Adversarial M5: Motivation vault options, excerpt extraction, and tag parsing", () => {
  const fullVault: MotivationVaultDto = {
    id: "vault-xyz",
    whyStarted: "立志成为系统级研发工程师",
    neverReturnTo: "浅尝辄止、没有深度沉淀的状态",
    futureSelf: "冷静自律且精通底层原理的工程师",
    messageToFuture: "永远保持敬畏与好奇",
    firstSimulationDiary: "首轮模拟 125 分，继续攻克算法难题",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };

  const options = motivationVaultOptions(fullVault);
  assert.equal(options.length, 5);
  assert.deepEqual(
    options.map((o) => o.field),
    ["whyStarted", "neverReturnTo", "futureSelf", "messageToFuture", "firstSimulationDiary"],
  );

  // Partial vault
  const partialVault: MotivationVaultDto = {
    ...fullVault,
    neverReturnTo: null,
    firstSimulationDiary: "",
  };
  const partialOptions = motivationVaultOptions(partialVault);
  assert.equal(partialOptions.length, 3);
  assert.deepEqual(
    partialOptions.map((o) => o.field),
    ["whyStarted", "futureSelf", "messageToFuture"],
  );

  // Tag parsing robustness
  assert.deepEqual(parseTags("  数学, 考研 ,  408 , 冲刺 "), ["数学", "考研", "408", "冲刺"]);
  assert.deepEqual(parseTags("数学，考研，408"), ["数学", "考研", "408"]); // Chinese comma
  assert.deepEqual(parseTags(",,,  ,"), []);
  assert.deepEqual(parseTags(""), []);

  // URL security validator
  assert.equal(isHttpsUrl("https://bilibili.com/video/BV123456"), true);
  assert.equal(isHttpsUrl("https://youtu.be/dQw4w9WgXcQ"), true);
  assert.equal(isHttpsUrl("http://insecure.example.com"), false);
  assert.equal(isHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isHttpsUrl("data:text/html,<h1>test</h1>"), false);
  assert.equal(isHttpsUrl("ftp://file.server"), false);
  assert.equal(isHttpsUrl("not a url"), false);
  assert.equal(isHttpsUrl(""), false);
});

test("Adversarial M5: Motivation library item sorting, DTO validation and draft state", () => {
  const item1: MotivationItemDto = {
    id: "item-1",
    type: "QUOTE",
    title: "语录 1",
    body: "坚持到底",
    externalUrl: null,
    vaultSourceId: null,
    tags: ["激励"],
    sortOrder: 2,
    enabled: true,
    archivedAt: null,
    revision: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const item2: MotivationItemDto = {
    ...item1,
    id: "item-2",
    title: "语录 2",
    sortOrder: 1,
  };

  const item3: MotivationItemDto = {
    ...item1,
    id: "item-3",
    title: "语录 3",
    sortOrder: 3,
  };

  const list = [item1, item3, item2];
  list.sort(compareItems);
  assert.deepEqual(list.map((i) => i.id), ["item-2", "item-1", "item-3"]);

  // Type guard checks
  assert.equal(isMotivationItem(item1), true);
  assert.equal(isMotivationItem(null), false);
  assert.equal(isMotivationItem({ ...item1, id: 123 }), false);
  assert.equal(isMotivationItem({ ...item1, title: 123 }), false);
  assert.equal(isMotivationItem({ ...item1, revision: 1.5 }), false);

  // Empty draft
  assert.equal(isEmptyDraft(emptyDraft), true);
  assert.equal(isMotivationLibraryDraft(emptyDraft), true);
  assert.equal(isEmptyDraft({ ...emptyDraft, title: "非空标题" }), false);
  assert.equal(isMotivationLibraryDraft({ ...emptyDraft, type: "UNKNOWN_TYPE" as unknown as "QUOTE" }), false);
});

// ---------------------------------------------------------------------------
// 4. AI Provider & Settings Model Stress Testing
// ---------------------------------------------------------------------------

test("Adversarial M5: AI Provider credentials, preferences, and runtime gating logic", () => {
  // Provider source label mappings
  assert.equal(providerSourceLabel("account"), "当前账户");
  assert.equal(providerSourceLabel("environment"), "部署环境回退");
  assert.equal(providerSourceLabel("none"), "未配置");

  // Credential status discriminator
  const validCreds = {
    source: "account" as const,
    accountConfigured: true,
    effectiveConfigured: true,
    apiKeyConfigured: true,
    encryptionConfigured: true,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    revision: 1,
    globalEnabled: true,
  };
  assert.equal(isAiProviderCredentialStatus(validCreds), true);
  assert.equal(isAiProviderCredentialStatus(null), false);
  assert.equal(isAiProviderCredentialStatus({ ...validCreds, source: "invalid" }), false);
  assert.equal(isAiProviderCredentialStatus({ ...validCreds, baseUrl: 123 }), false);

  // Preference status discriminator
  const validPref = {
    externalProviderEnabled: true,
    scope: "current_browser" as const,
  };
  assert.equal(isAiProviderPreference(validPref), true);
  assert.equal(isAiProviderPreference({ ...validPref, scope: "global" }), false);
  assert.equal(isAiProviderPreference({ ...validPref, externalProviderEnabled: "true" }), false);

  // Runtime setting status
  const validRuntime = {
    serverEnabled: true,
    webEnabled: true,
    effectiveEnabled: true,
    bindingSecretConfigured: true,
    revision: 2,
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  assert.equal(isAiRuntimeSettingStatus(validRuntime), true);
  assert.equal(isAiRuntimeSettingStatus(null), false);
  assert.equal(isAiRuntimeSettingStatus({ ...validRuntime, webEnabled: "true" }), false);
  assert.equal(isAiRuntimeSettingStatus({ ...validRuntime, revision: "2" }), false);
});

// ---------------------------------------------------------------------------
// 5. Update Center Controlled Actions & Health State Machine Stress Testing
// ---------------------------------------------------------------------------

test("Adversarial M5: Update Center UI formatters, tags, hashes, and health transitions", () => {
  // Normalized tag
  assert.equal(normalizedTag("v1.1.2"), "v1.1.2");
  assert.equal(normalizedTag("1.1.2"), "v1.1.2");
  assert.equal(normalizedTag("v2.0.0-beta"), "v2.0.0-beta");

  // Short hash
  assert.equal(shortHash("3a0f6855c22c8885b435b76108b587778bbf6e8a6281b7814f04fecbafbdb362"), "3a0f6855c22c888...afbdb362");
  assert.equal(shortHash("5df38417b701f3511d06db235c5b94755ca03aba"), "5df38417b701f35...5ca03aba");
  assert.equal(shortHash(null), "未验证");
  assert.equal(shortHash(""), "未验证");
  assert.equal(shortHash(undefined), "未验证");

  // Action / Status mappings
  assert.equal(labelAction("check"), "检查更新");
  assert.equal(labelAction("apply"), "应用更新");
  assert.equal(labelAction("rollback"), "版本回退");

  assert.equal(labelAutoApply("none"), "只检查");
  assert.equal(labelAutoApply("patch"), "自动 patch");

  assert.equal(labelOperationStatus("queued"), "排队中");
  assert.equal(labelOperationStatus("running"), "执行中");
  assert.equal(labelOperationStatus("succeeded"), "成功");
  assert.equal(labelOperationStatus("failed"), "失败");
  assert.equal(labelOperationStatus("needs_reconciliation"), "需要人工协调");

  // Health state permutations
  const fixedNow = 1756200000000;
  const validStatus: UpdateCenterStatus = {
    currentVersion: "1.1.1",
    currentImage: "ghcr.io/areasong/areaforge:1.1.1",
    appUrl: "https://forge.areasong.top",
    latestVersion: "1.1.2",
    updateAvailable: true,
    statusUpdatedAt: new Date(fixedNow - 30_000).toISOString(),
    lastCheckedAt: new Date(fixedNow - 30_000).toISOString(),
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

  // 1. Update available
  assert.equal(getUpdateCenterHealth(validStatus, fixedNow), "update_available");

  // 2. Blocked status overrides update available
  assert.equal(
    getUpdateCenterHealth({ ...validStatus, blocker: "数据库 migration 待执行" }, fixedNow),
    "blocked",
  );

  // 3. Unverified snapshot hash -> unknown
  assert.equal(
    getUpdateCenterHealth({ ...validStatus, snapshotHash: null }, fixedNow),
    "unknown",
  );

  // 4. Stale status (older than 24 hours)
  assert.equal(
    getUpdateCenterHealth({ ...validStatus, statusUpdatedAt: new Date(fixedNow - 90_000_000).toISOString() }, fixedNow),
    "stale",
  );

  // 5. Up to date (latest == current, updateAvailable: false)
  assert.equal(
    getUpdateCenterHealth({ ...validStatus, latestVersion: "1.1.1", updateAvailable: false }, fixedNow),
    "healthy",
  );
});
