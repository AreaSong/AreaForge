import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { CANONICAL_ROUTES } from "@/lib/navigation/canonical-routes";
import { getCanonicalRoute, getNavigationTrail, isContentDetailPath, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/app-navigation";
import { getConfirmationWindowRouteRequest } from "@/lib/navigation/confirmation-route";
import { getSourceContextLabel } from "@/lib/navigation/return-context";
import { getWorkbenchFallback } from "@/lib/navigation/workbench-context";
import { activitySourcePath, isKnowledgeReviewActivityForSchedule } from "@/lib/navigation/activity-route";

test("navigation trails keep reused secondary labels and object depth", () => {
  assert.deepEqual(getNavigationTrail("/roadmap/allocation"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/allocation", label: "投入安排" },
  ]);
  assert.deepEqual(getNavigationTrail("/roadmap/stages"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/stages", label: "阶段" },
  ]);
  assert.deepEqual(getNavigationTrail("/roadmap/reviews/daily"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/reviews", label: "周期复盘" },
    { href: "/roadmap/reviews/daily", label: "每日复盘" },
  ]);
  assert.deepEqual(getNavigationTrail("/roadmap/reviews/history/decision-1"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/reviews", label: "周期复盘" },
    { href: "/roadmap/reviews/history/decision-1", label: "冻结报告" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations"), [
    { href: "/confirmations", label: "确认中心" },
  ]);
  assert.deepEqual(getNavigationTrail("/test/simulations"), [
    { href: "/test/retests", label: "检验" },
    { href: "/test/simulations", label: "模拟考试" },
  ]);
  assert.deepEqual(getNavigationTrail("/test"), [
    { href: "/test/retests", label: "检验" },
    { href: "/test", label: "检验中心" },
  ]);
  assert.deepEqual(getNavigationTrail("/knowledge/points/point-1"), [
    { href: "/knowledge", label: "知识" },
    { href: "/knowledge/points", label: "知识点" },
    { href: "/knowledge/points/point-1", label: "知识点详情" },
  ]);
  assert.deepEqual(getNavigationTrail("/focus"), [
    { href: "/focus", label: "开始学习" },
  ]);
  assert.deepEqual(getNavigationTrail("/knowledge/reviews/review-1"), [
    { href: "/knowledge", label: "知识" },
    { href: "/knowledge/reviews", label: "复习" },
    { href: "/knowledge/reviews/review-1", label: "复习排期详情" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations/confirmation-1"), [
    { href: "/confirmations", label: "确认中心" },
    { href: "/confirmations/confirmation-1", label: "确认事项详情" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations/history"), [
    { href: "/confirmations", label: "确认中心" },
    { href: "/confirmations/history", label: "已处理" },
  ]);
});

test("simulation workbench copy stays under the test workbench", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "lib/routes/test-simulations-page.tsx"), "utf8");
  const formSource = readFileSync(resolve(process.cwd(), "components/simulation-list-client.tsx"), "utf8");
  assert.match(pageSource, /eyebrow="检验"/);
  assert.doesNotMatch(pageSource, /eyebrow="阶段"/);
  assert.match(formSource, /useState\("模拟考试"\)/);
});

test("invalid return paths fall back to the independent focus entry", () => {
  assert.equal(sanitizeReturnPath("https://outside.example/path"), "/focus");
  assert.equal(sanitizeReturnPath("/not-registered"), "/focus");
  assert.equal(sanitizeReturnPath("/knowledge/points?q=matrix"), "/knowledge/points?q=matrix");
});

test("source context labels identify the originating workbench", () => {
  assert.equal(getSourceContextLabel("/knowledge/points"), "知识点");
  assert.equal(getSourceContextLabel("/test/simulations"), "模拟考试");
  assert.equal(getSourceContextLabel("/today"), "今日行动");
  assert.equal(getSourceContextLabel(undefined), "来源页面");
});

test("content detail routes remain third-level object paths", () => {
  assert.equal(isContentDetailPath("/roadmap/allocation/tasks/task-1"), true);
  assert.equal(isContentDetailPath("/knowledge/resources/resource-1/preview"), true);
  assert.equal(isContentDetailPath("/test/retests/new"), true);
  assert.equal(isContentDetailPath("/roadmap/reviews/history/decision-1"), true);
  assert.equal(isContentDetailPath("/confirmations/confirmation-1"), true);
  assert.equal(isContentDetailPath("/confirmations/history"), false);
  assert.equal(isContentDetailPath("/roadmap/allocation"), false);
  assert.equal(isContentDetailPath("/knowledge/points"), false);
  assert.equal(isContentDetailPath("/settings/ai"), false);
});

test("workbench errors return to the canonical owner for every primary entry", () => {
  const cases = [
    ["/focus", "/focus", "返回开始学习"],
    ["/today", "/today", "返回今日"],
    ["/roadmap/allocation/tasks/task-1", "/roadmap/allocation", "返回投入安排"],
    ["/knowledge/points/point-1", "/knowledge", "返回知识工作台"],
    ["/test/simulations/exam-1", "/test/retests", "返回检验工作台"],
    ["/roadmap/stages/trend", "/roadmap/stages", "返回阶段工作台"],
    ["/roadmap/reviews/history/report-1", "/roadmap/reviews", "返回周期复盘"],
    ["/confirmations/history", "/today", "返回今日"],
    ["/settings/ai", "/settings", "返回设置"],
    ["/knowledge/reviews/review-1", "/knowledge", "返回知识工作台"],
  ] as const;

  for (const [pathname, href, label] of cases) {
    assert.deepEqual(getWorkbenchFallback(pathname), { href, label });
  }
});

test("registered list routes preserve only their safe filter query", () => {
  assert.equal(
    sanitizeReturnPath("/knowledge/points?subjectId=math&q=matrix&masteryStatus=weak&unsafe=drop"),
    "/knowledge/points?subjectId=math&q=matrix&masteryStatus=weak",
  );
  assert.equal(
    sanitizeReturnPath("/roadmap/allocation?date=2026-08-04&subjectId=math&status=open&q=limits&unsafe=drop"),
    "/roadmap/allocation?date=2026-08-04&subjectId=math&status=open&q=limits",
  );
  assert.equal(sanitizeReturnPath("/today?date=2026-08-04&unsafe=drop"), "/today?date=2026-08-04");
});

test("confirmation detail preserves a safe list return context", () => {
  assert.equal(
    withReturnTo("/confirmations/confirmation-1", "/confirmations"),
    "/confirmations/confirmation-1?returnTo=%2Fconfirmations",
  );
  assert.equal(
    sanitizeReturnPath("/confirmations/confirmation-1?returnTo=%2Fconfirmations"),
    "/confirmations/confirmation-1?returnTo=%2Fconfirmations",
  );
  assert.equal(
    sanitizeReturnPath("/confirmations/confirmation-1?returnTo=https%3A%2F%2Fevil.example"),
    "/confirmations/confirmation-1?returnTo=%2Ffocus",
  );
});

test("simulation detail falls back to its list instead of itself", () => {
  const source = readFileSync(resolve(process.cwd(), "lib/routes/test-simulation-detail-page.tsx"), "utf8");
  assert.match(source, /query\.returnTo \? sanitizeReturnPath\(query\.returnTo\) : "\/test\/simulations"/);
  assert.doesNotMatch(source, /: `\/test\/simulations\/\$\{encodeURIComponent\(examId\)\}`/);
});

test("global shell owns the activity slot, command palette, status bar, and confirmation window", () => {
  const shell = readFileSync(resolve(process.cwd(), "components/app-shell.tsx"), "utf8");
  const shellActivity = readFileSync(resolve(process.cwd(), "components/use-shell-activity-status.ts"), "utf8");
  const toolbar = readFileSync(resolve(process.cwd(), "components/shared-study-toolbar.tsx"), "utf8");
  const topbar = readFileSync(resolve(process.cwd(), "components/global-top-bar.tsx"), "utf8");
  const confirmation = readFileSync(resolve(process.cwd(), "components/global-confirmation-center.tsx"), "utf8");
  const confirmationAdapter = readFileSync(resolve(process.cwd(), "lib/api/confirmation.ts"), "utf8");
  const confirmationRoute = readFileSync(resolve(process.cwd(), "app/api/confirmations/route.ts"), "utf8");
  const focusLauncher = readFileSync(resolve(process.cwd(), "components/focus-launcher.tsx"), "utf8");
  const focusSession = readFileSync(resolve(process.cwd(), "components/focus-session-client.tsx"), "utf8");
  const focusCommand = readFileSync(resolve(process.cwd(), "components/focus-session-command.ts"), "utf8");
  assert.match(shell, /<GlobalTopBar/);
  assert.match(shell, /useShellActivityStatus/);
  assert.match(shellActivity, /readFocusOfflineSnapshot/);
  assert.match(topbar, /<GlobalActivitySlot/);
  assert.match(topbar, /<GlobalCommandPalette/);
  assert.match(shell, /offlineSession=\{offlineFocusSession\}/);
  assert.match(topbar, /<GlobalConfirmationCenter/);
  assert.match(toolbar, /data-layout-region="global-context-status-bar"/);
  assert.doesNotMatch(toolbar, /activitySourcePath\(active\)/);
  assert.match(confirmation, /listConfirmationViews/);
  assert.doesNotMatch(confirmation, /\bfetch\s*\(/);
  assert.match(confirmationAdapter, /export async function listConfirmationViews/);
  assert.match(confirmationAdapter, /`\/api\/confirmations\?\$\{search\.toString\(\)\}`/);
  assert.match(confirmation, /aria-label="确认中心视图"/);
  assert.match(confirmation, /onFilterChange/);
  assert.doesNotMatch(confirmation, /打开完整确认中心/);
  assert.match(confirmationRoute, /listConfirmationItems\(user\.id, filter\)/);
  assert.match(focusLauncher, /publishFocusSyncEvent\(userId, syncState, localSession\)/);
  assert.match(focusSession, /executeFocusSessionCommand/);
  assert.match(focusCommand, /publish: publishFocusSyncEvent/);
  assert.match(focusCommand, /queueProjectedSession\(dependencies, userId, session, action, body, "pending"\)/);
  assert.match(focusCommand, /dependencies\.publish\(userId, syncState, projected\)/);
});

test("global top bar keeps activity on the left and the command trigger content-only", () => {
  const topbar = readFileSync(resolve(process.cwd(), "components/global-top-bar.tsx"), "utf8");
  const activitySlot = readFileSync(resolve(process.cwd(), "components/global-activity-slot.tsx"), "utf8");
  const commandPalette = readFileSync(resolve(process.cwd(), "components/global-command-palette.tsx"), "utf8");
  const confirmation = readFileSync(resolve(process.cwd(), "components/global-confirmation-center.tsx"), "utf8");
  const assistant = readFileSync(resolve(process.cwd(), "components/global-ai-assistant.tsx"), "utf8");
  assert.match(topbar, /hasActivity = Boolean\(props\.activeSession \|\| props\.offlineSession \|\| props\.quickReviewClaim\)/);
  assert.match(topbar, /hasActivity \? \(\s*<GlobalActivitySlot/);
  assert.match(topbar, /trigger=\{<span className="text-zinc-500">搜索或输入命令…<\/span>\}/);
  assert.doesNotMatch(topbar, /trigger=\{<GlobalActivitySlot/);
  assert.match(topbar, /lg:grid-cols-\[minmax\(13rem,1fr\)_minmax\(14rem,42rem\)_minmax\(13rem,1fr\)\]/);
  assert.doesNotMatch(topbar, /sm:grid-cols-\[minmax\(0,1fr\)_minmax\(14rem,42rem\)_auto\]/);
  assert.match(commandPalette, /group mx-auto flex h-9 w-full min-w-0 max-w-\[42rem\]/);
  assert.doesNotMatch(activitySlot, /sm:min-w-\[13rem\]/);
  assert.match(activitySlot, /lg:min-w-\[13rem\]/);
  assert.match(confirmation, /<span className="hidden min-\[1720px\]:inline">确认<\/span>/);
  assert.match(assistant, /<span className="hidden min-\[1720px\]:inline">AI 助手<\/span>/);
  assert.match(topbar, /<span className="hidden min-\[1720px\]:inline">我学不下去了<\/span>/);
  const recoveryIndex = topbar.indexOf('aria-label="我学不下去了"');
  const quickCreateIndex = topbar.indexOf("<GlobalQuickCreate />");
  assert.ok(recoveryIndex >= 0 && quickCreateIndex > recoveryIndex, "快捷创建必须是顶栏最右侧入口");
});

test("mobile tools drawer reuses canonical settings navigation and exposes the account exit", () => {
  const navigation = readFileSync(resolve(process.cwd(), "components/shared-mobile-navigation.tsx"), "utf8");
  assert.match(navigation, /UTILITY_NAV_ITEM\.children/);
  assert.match(navigation, /aria-current=\{navigationAriaCurrent\(props\.pathname, item\)\}/);
  assert.match(navigation, /\{props\.email\}/);
  assert.match(navigation, /<LogoutButton userId=\{props\.userId\} \/>/);
  assert.match(navigation, /shrink-0 overflow-hidden/);
  assert.match(navigation, /flex w-full min-w-0 items-center/);
  assert.match(navigation, /h-12 min-w-0 flex-1 basis-0/);
  assert.match(navigation, /max-\[279px\]:sr-only/);
  assert.doesNotMatch(navigation, /min-w-max|w-16 shrink-0/);
  assert.doesNotMatch(navigation, /pathname\.startsWith\(item\.href\)/);
});

test("source activity pages keep the shared closeout recoverable for other tabs", () => {
  const closeout = readFileSync(resolve(process.cwd(), "components/global-session-closeout.tsx"), "utf8");
  const toolbar = readFileSync(resolve(process.cwd(), "components/shared-study-toolbar.tsx"), "utf8");
  assert.match(closeout, /isActivitySourcePath\(props\.pathname, props\.activeSession\)/);
  assert.match(closeout, /closeoutWindow && !closeoutWindow\.minimized\) minimizeWindow\("session-closeout"\)/);
  assert.match(closeout, /const entryKey = props\.activeSession\.id/);
  assert.match(closeout, /if \(!props\.activeSession \|\| props\.activeSession\.status !== "closing"\) \{\s*autoOpenedRef\.current = null/);
  assert.match(closeout, /if \(!shouldShowCloseout\) return/);
  assert.doesNotMatch(closeout, /const entryKey = `\$\{props\.activeSession\.id\}:\$\{props\.pathname\}`/);
  assert.doesNotMatch(closeout, /if \(!shouldShowCloseout \|\| !props\.activeSession\) \{\s*autoOpenedRef\.current = null/);
  assert.doesNotMatch(
    closeout,
    /if \(props\.activeSession && isActivitySourcePath\(props\.pathname, props\.activeSession\)\) \{\s*if \(hasCloseoutWindow\) closeWindow\("session-closeout"\)/,
  );
  assert.match(toolbar, /const \{ foregroundKey \} = useWindowSystem\(\)/);
  assert.match(toolbar, /const isActivitySource = Boolean\(active\?\.status === "closing" && isActivitySourcePath\(props\.pathname, active\)\)/);
  assert.match(toolbar, /isActivitySource\s*\? "正在收口"\s*: foregroundKey === "session-closeout"\s*\? "收口中"\s*: null/);
  assert.match(toolbar, /<WindowDock excludeKeys=\{isActivitySource \? \["session-closeout"\] : undefined\} \/>/);
  assert.match(toolbar, /active\?\.status === "closing" && light\.kind === "activity"/);
  assert.doesNotMatch(toolbar, /收口窗口已保留在后台|学习已冻结，等待收口/);
});

test("page templates and immersive pages retain stable layout contracts", () => {
  const page = readFileSync(resolve(process.cwd(), "components/ui/page.tsx"), "utf8");
  const shell = readFileSync(resolve(process.cwd(), "components/app-shell.tsx"), "utf8");
  const pageToolbar = readFileSync(resolve(process.cwd(), "components/page-toolbar.tsx"), "utf8");
  assert.match(page, /data-layout-region="page-frame"/);
  assert.match(page, /data-page-template=\{props\.variant\}/);
  assert.match(shell, /<PageToolbar(?:\s|>)/);
  assert.match(shell, /const canonicalRoute = getCanonicalRoute\(pathname\)/);
  assert.match(shell, /const showPageToolbar = canonicalRoute\?\.shell !== "app" \|\| canonicalRoute\.toolbar !== "none"/);
  assert.match(shell, /\{showPageToolbar \? \([\s\S]*?<PageToolbar>[\s\S]*?<WorkbenchBreadcrumbActions/);
  assert.match(pageToolbar, /min-h-14/);
  assert.match(pageToolbar, /border-b border-white\/10/);
  assert.match(pageToolbar, /px-4 py-2/);
  assert.doesNotMatch(pageToolbar, /\bmt-3\b|\bborder-t\b|\bpt-3\b/);
  assert.match(shell, /const fullCanvasPage = immersive \|\|/);
  assert.match(shell, /const showSecondaryNavigation = !immersive/);
  assert.match(shell, /data-immersive-content=\{immersive \? "true" : undefined\}/);
  assert.match(shell, /<GlobalTopBar/);
  assert.match(shell, /<GlobalRecoveryHelp/);
  assert.match(shell, /<WindowLayer \/>/);
  assert.match(shell, /relative isolate flex min-h-0 min-w-0 flex-1 flex-col/);
  assert.doesNotMatch(shell, /if \(immersive\) \{\s*return/);
});

test("recovery window refresh uses a stable close callback", () => {
  const shell = readFileSync(resolve(process.cwd(), "components/app-shell.tsx"), "utf8");
  const recovery = readFileSync(resolve(process.cwd(), "components/global-recovery-help.tsx"), "utf8");
  assert.match(recovery, /const closeRecoveryHelp = useCallback/);
  assert.match(recovery, /onClose=\{closeRecoveryHelp\}/);
  assert.doesNotMatch(recovery, /onClose:\s*\(\) => void/);
  const recoveryUsage = shell.match(/<GlobalRecoveryHelp[\s\S]*?\/>/)?.[0];
  assert.ok(recoveryUsage);
  assert.doesNotMatch(recoveryUsage, /onClose=/);
});

test("status and page-action surfaces keep narrow viewport boundaries", () => {
  const toolbar = readFileSync(resolve(process.cwd(), "components/shared-study-toolbar.tsx"), "utf8");
  const formatters = readFileSync(resolve(process.cwd(), "lib/formatters.ts"), "utf8");
  const dock = readFileSync(resolve(process.cwd(), "components/window-dock.tsx"), "utf8");
  const pageActions = readFileSync(resolve(process.cwd(), "components/workbench-breadcrumb-actions.tsx"), "utf8");
  assert.match(toolbar, /getBrowserStoragePort\("session"\)\?\.getItem\(RECENT_PAGE_KEY\)/);
  assert.match(toolbar, /grid h-8 min-w-0 grid-cols-\[minmax\(0,auto\)_minmax\(0,1fr\)_auto\]/);
  assert.match(toolbar, /data-status-region="persistent"/);
  assert.match(toolbar, /data-status-region="work"/);
  assert.match(toolbar, /data-status-region="system"/);
  assert.match(toolbar, /本机 · \{deviceIdentity\?\.label/);
  assert.match(toolbar, /其他设备 \{otherDeviceCount\}/);
  assert.match(toolbar, /hidden !?h-7 min-w-0 shrink items-center[\s\S]*lg:inline-flex[\s\S]*其他设备 \{otherDeviceCount\}/);
  const persistentRegionIndex = toolbar.indexOf('data-status-region="persistent"');
  const localDeviceIndex = toolbar.indexOf('aria-label={`本机：');
  const otherDeviceIndex = toolbar.indexOf('aria-label={`其他设备');
  const previousPageIndex = toolbar.indexOf('aria-label={`返回刚才的页面：');
  const workRegionIndex = toolbar.indexOf('data-status-region="work"');
  const systemRegionIndex = toolbar.indexOf('data-status-region="system"');
  assert.ok(persistentRegionIndex < localDeviceIndex);
  assert.ok(localDeviceIndex < otherDeviceIndex);
  assert.ok(otherDeviceIndex < previousPageIndex);
  assert.ok(previousPageIndex < workRegionIndex);
  assert.ok(workRegionIndex < systemRegionIndex);
  assert.match(toolbar, /setDetailsSide\("left"\)/);
  assert.match(toolbar, /setDetailsSide\("right"\)/);
  assert.match(toolbar, /detailsSide === "left" \? "left-4" : "right-4"/);
  assert.match(toolbar, /function LiveMillisecondClock/);
  assert.match(toolbar, /data-live-clock="millisecond"/);
  assert.match(toolbar, /window\.requestAnimationFrame\(update\)/);
  assert.match(toolbar, /formatClockTimeMillis/);
  assert.match(formatters, /fractionalSecondDigits: 3/);
  assert.match(toolbar, /font-mono tabular-nums/);
  assert.match(pageActions, /w-72 min-w-0 max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(pageActions, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(pageActions, /data-page-action-more-measure[\s\S]*hidden sm:inline/);
  assert.match(dock, /!props\.excludeKeys\?\.includes\(window\.key\)/);
  assert.match(dock, /md:hidden/);
  assert.match(dock, /后台 \{background\.length\}/);
  assert.match(dock, /calculateWindowDockLayout/);
  assert.match(dock, /data-window-measure-full/);
  assert.match(dock, /data-window-measure-compact/);
  assert.match(dock, /hidden\.length >= 2/);
});

test("canonical app routes carry the complete shared-shell contract", () => {
  const templates = new Set(["dashboard-wide", "split-view", "content-focus", "workspace-full"]);
  const toolbarlessRoutes = new Set([
    "/confirmations",
    "/confirmations/[confirmationId]",
    "/confirmations/history",
    "/focus",
    "/today",
  ]);
  for (const route of CANONICAL_ROUTES) {
    if (route.shell === "public") continue;
    assert.ok(route.workbench, `${route.path} must declare its workbench`);
    assert.ok(["primary", "secondary", "content"].includes(route.navigationLevel), `${route.path} must declare its navigation level`);
    assert.ok(templates.has(route.template), `${route.path} must declare its PageFrame template`);
    assert.equal(
      route.toolbar,
      toolbarlessRoutes.has(route.path) ? "none" : "standard",
      `${route.path} must declare the expected PageToolbar mode`,
    );
    assert.equal(getCanonicalRoute(route.returnFallback)?.shell, "app", `${route.path} must return to a canonical app route`);
  }

  assert.deepEqual(
    CANONICAL_ROUTES.filter((route) => route.shell === "app" && route.toolbar === "none").map((route) => route.path).sort(),
    [...toolbarlessRoutes].sort(),
  );

  const settings = readFileSync(resolve(process.cwd(), "app/(app)/settings/page.tsx"), "utf8");
  assert.match(settings, /<PageFrame variant="dashboard-wide"/);
  assert.match(settings, /title="设置总览"/);
  assert.doesNotMatch(settings, /redirect\("\/settings\/exams"\)/);
});

test("confirmation deep links own the foreground while closeout stays recoverable", () => {
  assert.deepEqual(getConfirmationWindowRouteRequest("/confirmations"), { filter: "pending" });
  assert.deepEqual(getConfirmationWindowRouteRequest("/confirmations/history"), { filter: "history" });
  assert.deepEqual(getConfirmationWindowRouteRequest("/confirmations/item%201"), { filter: "pending", confirmationId: "item 1" });
  assert.equal(getConfirmationWindowRouteRequest("/confirmations/a/b"), null);

  const confirmation = readFileSync(resolve(process.cwd(), "components/global-confirmation-center.tsx"), "utf8");
  const entry = readFileSync(resolve(process.cwd(), "components/confirmation-window-entry.tsx"), "utf8");
  const closeout = readFileSync(resolve(process.cwd(), "components/global-session-closeout.tsx"), "utf8");
  const toolbar = readFileSync(resolve(process.cwd(), "components/shared-study-toolbar.tsx"), "utf8");
  assert.match(confirmation, /getConfirmationWindowRouteRequest\(props\.pathname\)/);
  assert.doesNotMatch(entry, /dispatchEvent|CONFIRMATION_WINDOW_EVENT/);
  assert.match(closeout, /if \(isConfirmationWindowPath\(props\.pathname\)\) return/);
  assert.match(closeout, /isConfirmationWindowPath\(props\.pathname\)[\s\S]*minimizeWindow\("session-closeout"\)/);
  assert.doesNotMatch(toolbar, /openWindow\("session-closeout"\)/);
});

test("global tools refresh async content while only durable work enters the window system", () => {
  const recovery = readFileSync(resolve(process.cwd(), "components/global-recovery-help.tsx"), "utf8");
  const quickCreate = readFileSync(resolve(process.cwd(), "components/global-quick-create.tsx"), "utf8");
  const confirmation = readFileSync(resolve(process.cwd(), "components/global-confirmation-center.tsx"), "utf8");
  const confirmationEntry = readFileSync(resolve(process.cwd(), "components/confirmation-window-entry.tsx"), "utf8");
  const topbar = readFileSync(resolve(process.cwd(), "components/global-top-bar.tsx"), "utf8");
  const assistant = readFileSync(resolve(process.cwd(), "components/global-ai-assistant.tsx"), "utf8");
  assert.match(recovery, /refreshTool\("recovery-help"\)/);
  assert.match(recovery, /registerTool/);
  assert.doesNotMatch(recovery, /registerWindow|openWindow/);
  assert.match(quickCreate, /closeTool\(\)/);
  assert.match(quickCreate, /registerTool/);
  assert.doesNotMatch(quickCreate, /registerWindow|openWindow/);
  assert.match(confirmation, /pendingCount/);
  assert.match(confirmation, /aria-expanded=\{isOpen\}/);
  assert.match(assistant, /foregroundKey === "ai-assistant"/);
  assert.match(assistant, /onWorkStateChange=\{handleWorkStateChange\}/);
  assert.match(confirmation, /registerWindow/);
  assert.match(confirmation, /openWindow\("confirmation-center"\)/);
  assert.match(confirmation, /refreshWindow\("confirmation-center"\)/);
  assert.doesNotMatch(confirmation, /registerTool|refreshTool|toggleTool/);
  assert.match(topbar, /CONFIRMATION_WINDOW_EVENT/);
  assert.match(confirmationEntry, /router\.replace\(props\.returnTo\)/);
  assert.match(confirmationEntry, /return null/);
  assert.doesNotMatch(confirmationEntry, /确认中心窗口正在打开/);
  assert.match(assistant, /registerTool/);
  assert.match(assistant, /onExpand:/);
});

test("work windows render through a global modal portal instead of the L3 content container", () => {
  const shell = readFileSync(resolve(process.cwd(), "components/app-shell.tsx"), "utf8");
  const layer = readFileSync(resolve(process.cwd(), "components/window-layer.tsx"), "utf8");
  const focusScope = readFileSync(resolve(process.cwd(), "components/ui/focus-scope.ts"), "utf8");
  const tools = readFileSync(resolve(process.cwd(), "components/global-tool-system.tsx"), "utf8");
  assert.match(shell, /<GlobalToolLayer \/>/);
  assert.match(shell, /<WindowLayer \/>/);
  assert.match(layer, /createPortal\(/);
  assert.match(layer, /fixed inset-0/);
  assert.match(layer, /backdrop-blur-\[2px\]/);
  assert.match(layer, /usePortalReady\(\)/);
  assert.match(layer, /useFocusScope\(\{[\s\S]*allowEscape: true,[\s\S]*onEscape: foregroundWindowKey \? \(\) => minimizeWindow\(foregroundWindowKey\)/);
  assert.match(focusScope, /event\.key === "Escape" && input\.allowEscape && onEscapeRef\.current/);
  assert.match(layer, /<OverlayBackdrop/);
  assert.match(layer, /data-window-backdrop="true"/);
  assert.match(layer, /aria-label="返回页面并最小化窗口"/);
  assert.match(layer, /onPointerDown=\{\(event\) => \{[\s\S]*event\.preventDefault\(\);[\s\S]*minimizeWindow\(foreground\.key\)/);
  assert.match(layer, /onClick=\{\(\) => minimizeWindow\(foreground\.key\)\}/);
  assert.match(tools, /GlobalToolProvider/);
  assert.match(tools, /data-layout-region="global-tool-layer"/);
});

test("composite workbenches own their single page frame", () => {
  const importsPage = readFileSync(resolve(process.cwd(), "app/(app)/knowledge/imports/page.tsx"), "utf8");
  const importsView = readFileSync(resolve(process.cwd(), "components/learning-tree-import-workbench-view.tsx"), "utf8");
  assert.doesNotMatch(importsPage, /PageFrame/);
  assert.match(importsView, /<PageFrame variant="dashboard-wide"/);
});

test("activity source paths keep each timer in its own workbench", () => {
  assert.equal(activitySourcePath({ activityMode: "FREE_STUDY", reviewScheduleId: null, knowledgeRetestId: null, simulationExamId: null }), "/focus");
  assert.equal(activitySourcePath({ activityMode: "RETEST", reviewScheduleId: null, knowledgeRetestId: "retest-1", simulationExamId: null }), "/test/retests/retest-1");
  assert.equal(activitySourcePath({ activityMode: "SIMULATION", reviewScheduleId: null, knowledgeRetestId: null, simulationExamId: "exam-1" }), "/test/simulations/exam-1");
  assert.equal(activitySourcePath({ activityMode: "KNOWLEDGE_REVIEW", reviewScheduleId: "schedule-1", knowledgeRetestId: null, simulationExamId: null }), "/knowledge/reviews/schedule-1/run");
});

test("the current quick-review activity stays on its own source page", () => {
  assert.equal(isKnowledgeReviewActivityForSchedule({ activityMode: "KNOWLEDGE_REVIEW", reviewScheduleId: "schedule-1" }, "schedule-1"), true);
  assert.equal(isKnowledgeReviewActivityForSchedule({ activityMode: "KNOWLEDGE_REVIEW", reviewScheduleId: "schedule-2" }, "schedule-1"), false);
  assert.equal(isKnowledgeReviewActivityForSchedule({ activityMode: "FREE_STUDY", reviewScheduleId: null }, "schedule-1"), false);
});

test("quick-review page only redirects activities owned by another source", () => {
  const source = readFileSync(resolve(process.cwd(), "lib/routes/quick-review-page.tsx"), "utf8");
  assert.match(source, /isKnowledgeReviewActivityForSchedule\(active, schedule\.id\)/);
  assert.match(source, /if \(active && !isKnowledgeReviewActivityForSchedule/);
});

test("quick-review confirmation keeps the timer open until the event is saved", () => {
  const source = readFileSync(resolve(process.cwd(), "components/quick-review-client.tsx"), "utf8");
  assert.match(source, /await finishQuickReviewActivity\(props\.schedule\.id, currentDraft\.draftId\)/);
  assert.match(source, /resolveQuickReviewActivity\(props\.schedule\.id, currentDraft\.draftId, "suspend"\)/);
  assert.doesNotMatch(source, /finally \{[\s\S]*void finishQuickReviewActivity\(props\.schedule\.id, currentDraft\.draftId\)/);
});
