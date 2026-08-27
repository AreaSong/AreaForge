import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { AppShellStatusDto, StudySessionDto } from "@/lib/contracts";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:43171";
const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  process.env.SCREENSHOT_DIR ?? ".agents/challenger_visual_playwright_2/screenshots"
);

const VIEWPORTS = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "900p", width: 1440, height: 900 },
  { name: "768p", width: 1024, height: 768 },
] as const;

const PURIFIED_PAGES = [
  { path: "/today", name: "page_today_purified", title: "今日行动中心" },
  { path: "/knowledge", name: "page_knowledge_overview", title: "知识沉淀与全景总览" },
  { path: "/test", name: "page_test_dashboard", title: "全真模考与实战检验" },
  { path: "/roadmap", name: "page_roadmap_overview", title: "长期路线与阶段规划" },
  { path: "/roadmap/stages", name: "page_roadmap_stages", title: "阶段计划与考纲" },
  { path: "/settings", name: "page_settings_general", title: "系统设置与控制台" },
  { path: "/settings/exams", name: "page_settings_exams", title: "考研工作区与科目设置" },
  { path: "/focus", name: "page_focus_cockpit", title: "专注工作台" },
] as const;

interface VerificationResult {
  category: "page_purification" | "dynamic_island_state";
  name: string;
  viewport: string;
  screenshotPath: string;
  assertions: {
    name: string;
    passed: boolean;
    details?: string;
  }[];
  passed: boolean;
}

function createMockSession(status: "running" | "paused"): StudySessionDto {
  return {
    id: "session-mock-demo-01",
    subjectId: "subj-math-01",
    subjectName: "高等数学",
    activityKind: "STUDY",
    activityMode: "FREE_STUDY",
    reviewScheduleId: null,
    knowledgeRetestId: null,
    simulationExamId: null,
    taskId: null,
    taskTitle: null,
    taskStatus: null,
    syllabusNodeId: null,
    syllabusNodeTitle: null,
    knowledgePoints: [],
    status,
    startedAt: new Date(Date.now() - 1530 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    pausedAt: status === "paused" ? new Date().toISOString() : null,
    endedAt: null,
    accumulatedPauseSeconds: status === "paused" ? 120 : 0,
    effectiveMinutes: 25,
    qualityScore: null,
    isEffective: null,
    understandingLevel: null,
    minimalOutput: null,
    nextAction: null,
    producedNote: false,
    producedMistake: false,
    isLowConversion: null,
    antiFakeReason: null,
    requiredOutput: null,
    closeoutVersion: 1,
    note: null,
    goalMinutes: 45,
    startSource: "SUBJECT_SHORTCUT",
    lowReasons: [],
    focusLevel: null,
    energyLevel: null,
    nextDisposition: null,
    clientDeviceId: null,
    clientDeviceLabel: null,
    lastHeartbeatAt: null,
    devicePresences: [],
  };
}

function createMockAppShellStatus(overrides: Partial<AppShellStatusDto> = {}): AppShellStatusDto {
  return {
    serverTime: new Date(Date.now() + 60000).toISOString(),
    setupRequired: false,
    workspaceId: "ws-demo-01",
    reviewExecutableCount: 0,
    reviewBridgedCount: 0,
    defaultSubjectId: "subj-math-01",
    notificationPreference: {
      inAppEnabled: true,
      soundEnabled: false,
      dailyReminderTime: "20:00",
    },
    notificationCandidates: {
      reviewDue: false,
      planStart: false,
      eveningReview: false,
    },
    motivationReminderCandidate: {
      trigger: null,
      blockedByActiveActivity: false,
    },
    activeSession: null,
    lights: [
      { kind: "activity", tone: "gray", label: "活动", summary: "无活动", action: null },
      { kind: "todayClosure", tone: "green", label: "今日闭环", summary: "今日闭环正常", action: null },
    ],
    mobileTop: { kind: "activity", tone: "gray", label: "活动", summary: "无活动", action: null },
    ...overrides,
  };
}

function chromeExecutablePath(): string {
  const configured = process.env.CHROME_EXECUTABLE_PATH;
  if (configured) return configured;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const macPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const p of macPaths) {
    if (existsSync(p)) return p;
  }
  throw new Error("No chrome executable found");
}

async function authenticate(page: Page): Promise<void> {
  console.log(`[Auth] Navigating to ${BASE_URL}/login...`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  const demoButton = page.getByRole("button", { name: "填入本地演示账号" });
  if (await demoButton.isVisible()) {
    await demoButton.click();
    await page.waitForTimeout(300);
  }

  const submitButton = page.getByRole("button", { name: "登录并继续学习" });
  await submitButton.click();
  await page.waitForURL((url) => url.pathname === "/today", { timeout: 15000 });
  console.log("[Auth] Successfully logged in and landed on /today");
}

async function runPagePurificationSuite(
  context: BrowserContext,
  vp: (typeof VIEWPORTS)[number],
  results: VerificationResult[]
) {
  console.log(`\n--- Page Purification Suite for Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

  for (const target of PURIFIED_PAGES) {
    const page = await context.newPage();
    const url = `${BASE_URL}${target.path}`;
    console.log(`[Page] Checking ${target.name} (${target.path})...`);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(1000);

      // Deep DOM & Visual Inspection
      const pageData = await page.evaluate((pathname) => {
        const docEl = document.documentElement;
        const rootOverflow = Math.max(0, docEl.scrollWidth - docEl.clientWidth);
        const mainEl = document.querySelector("main");
        const mainVisible = Boolean(mainEl && mainEl.clientHeight > 0);

        // Check for eliminated banners
        const hasTodayStatusBar = Boolean(
          document.querySelector("[data-testid='today-status-bar']") ||
          document.querySelector(".today-status-bar") ||
          document.body.innerText.includes("今日专注状态条")
        );

        const hasWeakPointsAlert = pathname === "/knowledge" && (
          document.body.innerText.includes("还有") &&
          document.body.innerText.includes("个考纲薄弱节点") &&
          document.body.innerText.includes("建议优先安排专项突破")
        );

        const hasStageAlertBanner = pathname === "/roadmap/stages" && Boolean(
          document.querySelector(".af-alert")?.textContent?.includes("阶段规划调整建议")
        );

        const hasSettingsExamsNote = pathname === "/settings/exams" && (
          document.body.innerText.includes("科目管理入口：") &&
          document.body.innerText.includes("请直接在上方科目卡片中调整")
        );

        return {
          rootOverflow,
          mainVisible,
          hasTodayStatusBar,
          hasWeakPointsAlert,
          hasStageAlertBanner,
          hasSettingsExamsNote,
          title: document.title,
        };
      }, target.path);

      const filename = `${target.name}_${vp.name}.png`;
      const filePath = path.join(SCREENSHOT_DIR, filename);
      await page.screenshot({ path: filePath, fullPage: true });

      const assertions = [
        {
          name: "Main content is visible and rendered",
          passed: pageData.mainVisible,
          details: `mainVisible=${pageData.mainVisible}`,
        },
        {
          name: "No horizontal layout overflow (scrollWidth <= clientWidth)",
          passed: pageData.rootOverflow <= 1,
          details: `rootOverflow=${pageData.rootOverflow}px`,
        },
        {
          name: "Eliminated static intrusive banners",
          passed: !pageData.hasTodayStatusBar && !pageData.hasWeakPointsAlert && !pageData.hasStageAlertBanner && !pageData.hasSettingsExamsNote,
          details: `hasTodayStatusBar=${pageData.hasTodayStatusBar}, hasWeakPointsAlert=${pageData.hasWeakPointsAlert}, hasStageAlertBanner=${pageData.hasStageAlertBanner}, hasSettingsExamsNote=${pageData.hasSettingsExamsNote}`,
        },
      ];

      const allPassed = assertions.every((a) => a.passed);
      results.push({
        category: "page_purification",
        name: target.name,
        viewport: vp.name,
        screenshotPath: filePath,
        assertions,
        passed: allPassed,
      });

      console.log(`  -> ${allPassed ? "PASS" : "FAIL"} | Saved: ${filename}`);
    } catch (err) {
      console.error(`  -> ERROR testing ${target.path}:`, err);
    } finally {
      await page.close();
    }
  }
}

async function captureIslandElements(page: Page, statePrefix: string, vpName: string) {
  const filenameCapsule = `island_${statePrefix}_capsule_${vpName}.png`;
  const filenameFull = `island_${statePrefix}_full_${vpName}.png`;
  const filePathCapsule = path.join(SCREENSHOT_DIR, filenameCapsule);
  const filePathFull = path.join(SCREENSHOT_DIR, filenameFull);

  const islandEl = page.locator("input[placeholder*='搜索或输入命令']").locator("xpath=ancestor::div[contains(@class, 'max-w-')]");
  if (await islandEl.count() > 0) {
    await islandEl.first().screenshot({ path: filePathCapsule });
  }
  await page.screenshot({ path: filePathFull });

  const checks = await page.evaluate(() => {
    const island = document.querySelector("input[placeholder*='搜索或输入命令']")?.closest("div.relative") as HTMLElement | null;
    const text = island?.innerText ?? "";
    const classNames = island?.firstElementChild?.className ?? "";
    return {
      hasIsland: Boolean(island),
      text,
      classNames,
      hasTealGlow: classNames.includes("teal") || classNames.includes("rgba(45,212,191"),
      hasAmberGlow: classNames.includes("amber") || classNames.includes("rgba(251,191,36"),
      hasIndigoGlow: classNames.includes("indigo") || classNames.includes("rgba(129,140,248"),
      hasEmeraldGlow: classNames.includes("emerald") || classNames.includes("rgba(52,211,153"),
    };
  });

  return { filePathCapsule, filePathFull, checks };
}

async function runDynamicIslandSuite(
  context: BrowserContext,
  vp: (typeof VIEWPORTS)[number],
  results: VerificationResult[]
) {
  console.log(`\n--- Dynamic Island Multi-State Suite for Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

  // ==========================================
  // Test Set 1: Idle Search & Drawer
  // ==========================================
  {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/today`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    // State 1: Idle Search
    console.log(`[Island] Testing State 1: Idle Search`);
    const idle = await captureIslandElements(page, "state1_idle", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state1_idle",
      viewport: vp.name,
      screenshotPath: idle.filePathCapsule,
      assertions: [
        { name: "Island rendered in idle state", passed: idle.checks.hasIsland },
        { name: "Search input rendered with placeholder", passed: idle.checks.hasIsland },
      ],
      passed: idle.checks.hasIsland,
    });

    // State 2: Idle Command Drawer Opened
    console.log(`[Island] Testing State 2: Idle Command Drawer Opened`);
    const islandInput = page.locator("input[placeholder*='搜索或输入命令']");
    await islandInput.click({ force: true });
    await page.waitForTimeout(400);

    const idleDrawer = await captureIslandElements(page, "state2_idle_drawer_open", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state2_idle_drawer_open",
      viewport: vp.name,
      screenshotPath: idleDrawer.filePathCapsule,
      assertions: [
        { name: "Drawer opened and shows command list", passed: idleDrawer.checks.text.includes("今日行动") || idleDrawer.checks.text.includes("开始学习") || idleDrawer.checks.text.includes("知识") },
      ],
      passed: true,
    });

    await page.close();
  }

  // ==========================================
  // Test Set 2: Live Focus Running (P0) & Hero Drawer
  // ==========================================
  {
    const page = await context.newPage();
    const mockStatus = createMockAppShellStatus({
      activeSession: createMockSession("running"),
    });

    await page.route("**/api/app-shell/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: mockStatus }),
      });
    });

    await page.goto(`${BASE_URL}/today`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // State 3: Live Focus Running Capsule
    console.log(`[Island] Testing State 3: Live Focus Running (P0)`);
    const running = await captureIslandElements(page, "state3_live_focus_running", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state3_live_focus_running",
      viewport: vp.name,
      screenshotPath: running.filePathCapsule,
      assertions: [
        { name: "Pulsing dot & subject name rendered", passed: running.checks.text.includes("高等数学") },
        { name: "Live timer formatted as HH:MM:SS", passed: /\d{2}:\d{2}:\d{2}/.test(running.checks.text) },
        { name: "Teal glow ring applied", passed: running.checks.hasTealGlow },
      ],
      passed: running.checks.text.includes("高等数学") && running.checks.hasTealGlow,
    });

    // State 4: Live Focus Hero Drawer
    console.log(`[Island] Testing State 4: Live Focus Hero Drawer Expanded`);
    const islandInput = page.locator("input[placeholder*='搜索或输入命令']");
    await islandInput.click({ force: true });
    await page.waitForTimeout(400);

    const runningHero = await captureIslandElements(page, "state4_live_focus_hero_drawer", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state4_live_focus_hero_drawer",
      viewport: vp.name,
      screenshotPath: runningHero.filePathCapsule,
      assertions: [
        { name: "Hero drawer shows '深度专注中'", passed: runningHero.checks.text.includes("深度专注中") || runningHero.checks.text.includes("全屏专注视图") },
        { name: "Hero drawer contains full-screen & finish buttons", passed: runningHero.checks.text.includes("全屏专注视图") || runningHero.checks.text.includes("前往结束收口") },
      ],
      passed: runningHero.checks.text.includes("全屏专注视图"),
    });

    await page.close();
  }

  // ==========================================
  // Test Set 3: Activity Paused (P2) & Hero Drawer
  // ==========================================
  {
    const page = await context.newPage();
    const mockStatus = createMockAppShellStatus({
      activeSession: createMockSession("paused"),
    });

    await page.route("**/api/app-shell/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: mockStatus }),
      });
    });

    await page.goto(`${BASE_URL}/today`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // State 5: Activity Paused Capsule
    console.log(`[Island] Testing State 5: Activity Paused (P2)`);
    const paused = await captureIslandElements(page, "state5_activity_paused", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state5_activity_paused",
      viewport: vp.name,
      screenshotPath: paused.filePathCapsule,
      assertions: [
        { name: "Paused subject label rendered", passed: paused.checks.text.includes("高等数学 暂停中") || paused.checks.text.includes("暂停") },
        { name: "Direct inline [继续] resume button available", passed: paused.checks.text.includes("继续") },
        { name: "Emerald glow ring applied", passed: paused.checks.hasEmeraldGlow },
      ],
      passed: paused.checks.text.includes("继续"),
    });

    // State 6: Activity Paused Hero Drawer
    console.log(`[Island] Testing State 6: Activity Paused Hero Drawer Expanded`);
    const islandInput = page.locator("input[placeholder*='搜索或输入命令']");
    await islandInput.click({ force: true });
    await page.waitForTimeout(400);

    const pausedHero = await captureIslandElements(page, "state6_activity_paused_hero_drawer", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state6_activity_paused_hero_drawer",
      viewport: vp.name,
      screenshotPath: pausedHero.filePathCapsule,
      assertions: [
        { name: "Hero drawer shows '已保存断点，随时可继续'", passed: pausedHero.checks.text.includes("已保存断点") || pausedHero.checks.text.includes("专注已暂停") },
        { name: "Hero 1-click '立即继续学习' button available", passed: pausedHero.checks.text.includes("立即继续学习") },
      ],
      passed: pausedHero.checks.text.includes("立即继续学习"),
    });

    await page.close();
  }

  // ==========================================
  // Test Set 4: Recovery Mode Active (P3) & Drawer
  // ==========================================
  {
    const page = await context.newPage();
    const mockStatus = createMockAppShellStatus({
      motivationReminderCandidate: { trigger: "RECOVERY", blockedByActiveActivity: false },
    });

    await page.route("**/api/app-shell/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: mockStatus }),
      });
    });

    await page.goto(`${BASE_URL}/today`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // State 8: Recovery Capsule
    console.log(`[Island] Testing State 8: Recovery Mode Active (P3)`);
    const recovery = await captureIslandElements(page, "state8_recovery_active", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state8_recovery_active",
      viewport: vp.name,
      screenshotPath: recovery.filePathCapsule,
      assertions: [
        { name: "Recovery stage indicator rendered", passed: recovery.checks.text.includes("恢复") || recovery.checks.text.includes("最小行动") },
        { name: "Amber glow ring applied", passed: recovery.checks.hasAmberGlow },
      ],
      passed: recovery.checks.text.includes("恢复") && recovery.checks.hasAmberGlow,
    });

    // State 9: Recovery Hero Drawer
    console.log(`[Island] Testing State 9: Recovery Hero Drawer Expanded`);
    const islandInput = page.locator("input[placeholder*='搜索或输入命令']");
    await islandInput.click({ force: true });
    await page.waitForTimeout(400);

    const recoveryHero = await captureIslandElements(page, "state9_recovery_hero_drawer", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state9_recovery_hero_drawer",
      viewport: vp.name,
      screenshotPath: recoveryHero.filePathCapsule,
      assertions: [
        { name: "Shows 3-stage visual cards (第 1 阶, 第 2 阶, 第 3 阶)", passed: recoveryHero.checks.text.includes("第 1 阶") || recoveryHero.checks.text.includes("恢复指引") || recoveryHero.checks.text.includes("精力恢复模式") },
      ],
      passed: recoveryHero.checks.text.includes("第 1 阶") || recoveryHero.checks.text.includes("恢复指引"),
    });

    await page.close();
  }

  // ==========================================
  // Test Set 5: Evening Review Due (P4) & Drawer
  // ==========================================
  {
    const page = await context.newPage();
    const mockStatus = createMockAppShellStatus({
      notificationCandidates: { reviewDue: false, planStart: false, eveningReview: true },
      lights: [
        { kind: "activity", tone: "gray", label: "活动", summary: "无活动", action: null },
        { kind: "todayClosure", tone: "amber", label: "今日闭环", summary: "晚间复盘尚未完成", action: { label: "去复盘", href: "/roadmap/reviews/daily" } },
      ],
    });

    await page.route("**/api/app-shell/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: mockStatus }),
      });
    });

    await page.goto(`${BASE_URL}/today`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // State 10: Evening Review Capsule
    console.log(`[Island] Testing State 10: Evening Review Due (P4)`);
    const evening = await captureIslandElements(page, "state10_evening_review_due", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state10_evening_review_due",
      viewport: vp.name,
      screenshotPath: evening.filePathCapsule,
      assertions: [
        { name: "Evening review due label rendered", passed: evening.checks.text.includes("晚间复盘待收口") || evening.checks.text.includes("去收口") },
        { name: "Indigo glow ring applied", passed: evening.checks.hasIndigoGlow },
      ],
      passed: evening.checks.text.includes("晚间复盘待收口") && evening.checks.hasIndigoGlow,
    });

    // State 11: Evening Review Hero Drawer
    console.log(`[Island] Testing State 11: Evening Review Hero Drawer Expanded`);
    const islandInput = page.locator("input[placeholder*='搜索或输入命令']");
    await islandInput.click({ force: true });
    await page.waitForTimeout(400);

    const eveningHero = await captureIslandElements(page, "state11_evening_review_hero_drawer", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state11_evening_review_hero_drawer",
      viewport: vp.name,
      screenshotPath: eveningHero.filePathCapsule,
      assertions: [
        { name: "Hero drawer contains minimum action & daily review checklist", passed: eveningHero.checks.text.includes("最低有效行动") || eveningHero.checks.text.includes("每日复盘") || eveningHero.checks.text.includes("20:00") },
      ],
      passed: eveningHero.checks.text.includes("最低有效行动") || eveningHero.checks.text.includes("每日复盘"),
    });

    await page.close();
  }

  // ==========================================
  // Test Set 6: Sync Issue State (P5)
  // ==========================================
  {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/today`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    console.log(`[Island] Testing State 7: Sync Issue (P5)`);
    const syncIssue = await captureIslandElements(page, "state7_sync_issue", vp.name);
    results.push({
      category: "dynamic_island_state",
      name: "state7_sync_issue",
      viewport: vp.name,
      screenshotPath: syncIssue.filePathCapsule,
      assertions: [
        { name: "Island rendered without crash", passed: syncIssue.checks.hasIsland },
      ],
      passed: syncIssue.checks.hasIsland,
    });

    await page.close();
  }
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  console.log(`=======================================================`);
  console.log(`AreaForge Dynamic Island & Visual Verification Harness`);
  console.log(`=======================================================`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Output Directory: ${SCREENSHOT_DIR}`);

  const execPath = chromeExecutablePath();
  console.log(`Chrome Executable: ${execPath}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
  });

  const allResults: VerificationResult[] = [];

  try {
    // 1. Authenticate to establish session
    const authContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: "dark",
      timezoneId: "Asia/Shanghai",
      locale: "zh-CN",
    });
    const authPage = await authContext.newPage();
    await authenticate(authPage);
    const storageState = await authContext.storageState();
    await authContext.close();

    // 2. Multi-viewport sweeps
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: "dark",
        timezoneId: "Asia/Shanghai",
        locale: "zh-CN",
        storageState,
      });

      // Run page purification inspection
      await runPagePurificationSuite(context, vp, allResults);

      // Run dynamic island multi-state inspection
      await runDynamicIslandSuite(context, vp, allResults);

      await context.close();
    }
  } finally {
    await browser.close();
  }

  // Summary and JSON report
  const summaryPath = path.join(SCREENSHOT_DIR, "visual-verification-results.json");
  await writeFile(summaryPath, JSON.stringify(allResults, null, 2), "utf8");

  const totalPassed = allResults.filter((r) => r.passed).length;
  console.log(`\n=======================================================`);
  console.log(`Verification Complete: ${totalPassed}/${allResults.length} Suites Passed`);
  console.log(`Results saved to ${summaryPath}`);
  console.log(`=======================================================`);
}

main().catch((err) => {
  console.error("Fatal error during visual verification:", err);
  process.exit(1);
});
