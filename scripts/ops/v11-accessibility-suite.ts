import { createHash } from "node:crypto";
import type { Browser, BrowserContext, Page, Response as PlaywrightResponse } from "playwright-core";
import {
  V11_ACCESSIBILITY_CHECK_IDS,
  V11_ACCESSIBILITY_CHECK_CONTRACTS,
  V11_ACCESSIBILITY_PROFILE_CONTRACT,
  V11_VIEWPORT_CONTRACT,
  assertV11AssertionListContract,
  categoryForCheck,
  type V11AccessibilityCategory,
  type V11AccessibilityCheck,
  type V11AccessibilityCheckId,
  type V11Assertion,
  type V11RedactedValue,
  type V11Viewport,
} from "../quality/v11-browser-evidence-contract";
import {
  prepareFixtureActiveSession,
  type BrowserEvidenceConfig,
  type FixtureAccount,
} from "./v11-browser-fixtures";

type MechanismByCategory = {
  keyboard: "keyboard";
  focus: "keyboard" | "dom";
  semantics: "cdp";
  live: "dom";
  color: "dom" | "viewport";
  zoom: "viewport";
  canvas: "keyboard" | "dom" | "api";
};

type CheckInput = {
  [Category in V11AccessibilityCategory]: Omit<
    V11AccessibilityCheck,
    "artifact" | "result" | "category" | "mechanism" | "checkKey" | "target" | "profile"
  > & {
    category: Category;
    mechanism: MechanismByCategory[Category];
    viewport?: V11Viewport;
  };
}[V11AccessibilityCategory];

export interface AccessibilityArtifactWriter {
  write(check: Omit<V11AccessibilityCheck, "artifact" | "result">): V11AccessibilityCheck["artifact"];
}

const artifactWriters = new WeakMap<
  Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
  AccessibilityArtifactWriter
>();

const artifactKinds: Record<V11AccessibilityCategory, V11AccessibilityCheck["artifact"]["kind"]> = {
  keyboard: "keyboard-trace",
  focus: "focus-trace",
  semantics: "accessibility-tree",
  live: "live-region-trace",
  color: "computed-style",
  zoom: "reflow-measurement",
  canvas: "canvas-equivalence",
};

export async function runAccessibilitySuite(input: {
  browser: Browser;
  nativeContext: BrowserContext;
  config: BrowserEvidenceConfig;
  fixture: FixtureAccount;
  artifacts: AccessibilityArtifactWriter;
}): Promise<V11AccessibilityCheck[]> {
  const checks = new Map<V11AccessibilityCheckId, V11AccessibilityCheck>();
  artifactWriters.set(checks, input.artifacts);
  try {
    await runUnauthenticatedLiveCheck(input, checks);
    await runDesktopChecks(input, checks);
    await runMobileChecks(input, checks);
    await runNativeZoomCheck(input, checks);
    const ordered = V11_ACCESSIBILITY_CHECK_IDS.map((id) => checks.get(id));
    const missing = ordered.filter((check) => !check).length;
    if (missing > 0) throw new Error(`accessibility suite did not produce ${missing} required check(s)`);
    return ordered as V11AccessibilityCheck[];
  } finally {
    artifactWriters.delete(checks);
  }
}

async function runUnauthenticatedLiveCheck(
  input: { browser: Browser; config: BrowserEvidenceConfig; fixture: FixtureAccount },
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const context = await newContext(input.browser, "desktop");
  const page = await context.newPage();
  configurePage(page, input.config);
  try {
    await page.goto(url(input.config, "/login"), { waitUntil: "domcontentloaded" });
    await page.getByLabel("邮箱").fill(`missing-${input.fixture.userId}@areasong.local`);
    await page.getByLabel("密码").fill(input.config.password);
    const response = await clickAndWaitForResponse(page, input.config, "/api/auth/login", 401, () =>
      page.getByRole("button", { name: "登录" }).click());
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await alert.waitFor();
    const observation = await alert.evaluate((element) => ({
      live: element.getAttribute("aria-live") ?? "",
      atomic: element.getAttribute("aria-atomic") ?? "",
      hasText: Boolean(element.textContent?.trim()),
    }));
    record(checks, {
      id: "LIVE-01",
      category: "live",
      route: "/login",
      viewport: viewport("desktop"),
      mechanism: "dom",
      assertions: [
        assertion("invalid-login-status", 401, response.status()),
        assertion("alert-is-assertive", "assertive", observation.live),
        assertion("alert-is-atomic", "true", observation.atomic),
        assertion("alert-has-message", true, observation.hasText),
      ],
    });
  } finally {
    await context.close();
  }
}

async function runDesktopChecks(
  input: { browser: Browser; config: BrowserEvidenceConfig; fixture: FixtureAccount },
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const context = await newContext(input.browser, "desktop");
  const page = await context.newPage();
  configurePage(page, input.config);
  try {
    await keyboardLogin(page, input.config, input.fixture, checks);
    await semanticsAndColorChecks(page, context, checks);
    await modalChecks(page, checks);
    await keyboardNavigationCheck(page, checks);
    await canvasDesktopChecks(page, context, input.config, input.fixture, checks);
    await noteFocusCheck(page, input.fixture, input.config, checks);
    await prepareFixtureActiveSession(input.fixture);
    await focusLiveChecks(page, input.fixture, input.config, checks);
    await reviewLiveChecks(page, input.config, checks);
    await notificationFallbackLiveCheck(page, input.config, checks);
  } finally {
    await context.close();
  }
}

async function keyboardLogin(
  page: Page,
  config: BrowserEvidenceConfig,
  fixture: FixtureAccount,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  await page.goto(url(config, "/login"), { waitUntil: "domcontentloaded" });
  await Promise.all([
    page.getByLabel("邮箱").waitFor(),
    page.getByLabel("密码").waitFor(),
  ]);
  await page.keyboard.press("Tab");
  const emailFocused = await page.getByLabel("邮箱").evaluate((element) => element === document.activeElement);
  await page.keyboard.type(fixture.email);
  await page.keyboard.press("Tab");
  const passwordFocused = await page.getByLabel("密码").evaluate((element) => element === document.activeElement);
  await page.keyboard.type(config.password);
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  const [response] = await Promise.all([responsePromise, page.keyboard.press("Enter")]);
  await page.waitForURL((candidate) => candidate.pathname === "/today");
  await page.getByRole("heading", { name: "今日", level: 1 }).waitFor();
  record(checks, {
    id: "KBD-01",
    category: "keyboard",
    route: "/login",
    viewport: viewport("desktop"),
    mechanism: "keyboard",
    assertions: [
      assertion("email-reached-by-tab", true, emailFocused),
      assertion("password-reached-by-tab", true, passwordFocused),
      assertion("enter-submitted-login", 200, response.status()),
      assertion("keyboard-login-terminal-route", "/today", pathname(page)),
    ],
  });
}

async function semanticsAndColorChecks(
  page: Page,
  context: BrowserContext,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const client = await context.newCDPSession(page);
  await client.send("Accessibility.enable");
  const tree = await client.send("Accessibility.getFullAXTree") as { nodes?: Array<{ role?: { value?: string }; name?: { value?: string } }> };
  const nodes = tree.nodes ?? [];
  const axMainCount = nodes.filter((node) => node.role?.value === "main").length;
  const namedNavCount = nodes.filter((node) => node.role?.value === "navigation" && Boolean(node.name?.value)).length;
  const dom = await page.evaluate(() => ({
    mainCount: document.querySelectorAll("main").length,
    h1Count: document.querySelectorAll("h1").length,
  }));
  record(checks, {
    id: "SEM-01",
    category: "semantics",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "cdp",
    assertions: [
      assertion("unique-dom-main", 1, dom.mainCount),
      assertion("unique-page-h1", 1, dom.h1Count),
      assertion("unique-ax-main", 1, axMainCount),
      assertion("named-navigation-present", 1, namedNavCount, "gte"),
    ],
  });

  const colors = await page.locator('[aria-label="状态灯"] button').evaluateAll((buttons) => {
    const visible = buttons.filter((button) => {
      const element = button as HTMLElement;
      return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    });
    return {
      count: visible.length,
      textCount: visible.filter((button) => Boolean(button.textContent?.trim())).length,
      namedCount: visible.filter((button) => Boolean(button.getAttribute("aria-label")?.trim())).length,
      colorCount: new Set(visible.map((button) => getComputedStyle(button).color)).size,
    };
  });
  record(checks, {
    id: "COLOR-01",
    category: "color",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [
      assertion("five-status-indicators", 5, colors.count),
      assertion("all-statuses-have-text", 5, colors.textCount),
      assertion("all-statuses-have-accessible-name", 5, colors.namedCount),
      assertion("computed-colors-observed", 1, colors.colorCount, "gte"),
    ],
  });
}

async function modalChecks(
  page: Page,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const section = page.getByRole("heading", { name: "科目快捷计时" }).locator("..");
  const trigger = section.getByRole("button", { name: "开始", exact: true }).first();
  await trigger.focus();
  const triggerFocused = await trigger.evaluate((element) => element === document.activeElement);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "确认科目快捷计时" });
  await dialog.waitFor();
  await waitForFocusWithin(dialog);
  const dialogObservation = await dialog.evaluate((element) => ({
    containsFocus: element.contains(document.activeElement),
    modal: element.getAttribute("aria-modal") ?? "",
    labelled: Boolean(element.getAttribute("aria-labelledby")),
  }));
  const client = await page.context().newCDPSession(page);
  await client.send("Accessibility.enable");
  const tree = await client.send("Accessibility.getFullAXTree") as {
    nodes?: Array<{ role?: { value?: string }; name?: { value?: string } }>;
  };
  const dialogNodes = (tree.nodes ?? []).filter((node) => node.role?.value === "dialog");
  const namedDialog = dialogNodes.find((node) => node.name?.value === "确认科目快捷计时");
  record(checks, {
    id: "KBD-03",
    category: "keyboard",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "keyboard",
    assertions: [
      assertion("trigger-focused", true, triggerFocused),
      assertion("enter-opened-modal", true, await dialog.isVisible()),
    ],
  });
  record(checks, {
    id: "FOCUS-01",
    category: "focus",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [assertion("modal-received-focus", true, dialogObservation.containsFocus)],
  });
  record(checks, {
    id: "SEM-02",
    category: "semantics",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "cdp",
    assertions: [
      assertion("dialog-is-modal", "true", dialogObservation.modal),
      assertion("dialog-has-label-reference", true, dialogObservation.labelled),
      assertion("single-dialog-in-accessibility-tree", 1, dialogNodes.length),
      assertion("dialog-accessible-name-resolves", true, Boolean(namedDialog)),
    ],
  });

  const trap = await dialog.evaluate((element) => {
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const items = Array.from(element.querySelectorAll<HTMLElement>(selector)).filter((item) => item.tabIndex >= 0);
    return { count: items.length, firstIsActive: items[0] === document.activeElement };
  });
  await page.keyboard.press("Shift+Tab");
  const wrappedToLast = await dialog.evaluate((element) => {
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const items = Array.from(element.querySelectorAll<HTMLElement>(selector)).filter((item) => item.tabIndex >= 0);
    return items.at(-1) === document.activeElement;
  });
  await page.keyboard.press("Tab");
  const wrappedToFirst = await dialog.evaluate((element) => {
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const items = Array.from(element.querySelectorAll<HTMLElement>(selector)).filter((item) => item.tabIndex >= 0);
    return items[0] === document.activeElement;
  });
  record(checks, {
    id: "KBD-04",
    category: "keyboard",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "keyboard",
    assertions: [
      assertion("modal-has-focusable-controls", 2, trap.count, "gte"),
      assertion("modal-initial-focus-first", true, trap.firstIsActive),
      assertion("shift-tab-wraps-to-last", true, wrappedToLast),
      assertion("tab-wraps-to-first", true, wrappedToFirst),
    ],
  });

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await waitForElementFocus(trigger);
  const focusReturned = await trigger.evaluate((element) => element === document.activeElement);
  record(checks, {
    id: "FOCUS-02",
    category: "focus",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "keyboard",
    assertions: [
      assertion("escape-closed-modal", 0, await dialog.count()),
      assertion("focus-returned-to-trigger", true, focusReturned),
    ],
  });
}

async function keyboardNavigationCheck(
  page: Page,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const quickCreate = page.getByRole("button", { name: "快捷创建" }).first();
  await quickCreate.focus();
  const quickCreateFocused = await quickCreate.evaluate((element) => element === document.activeElement);
  await page.keyboard.press("Enter");
  const quickCreateDialog = page.getByRole("dialog", { name: "快捷创建" });
  await quickCreateDialog.waitFor();
  await waitForFocusWithin(quickCreateDialog);
  const quickCreateLinks = await quickCreateDialog.getByRole("link").count();
  await page.keyboard.press("Escape");
  await quickCreateDialog.waitFor({ state: "detached" });
  await waitForElementFocus(quickCreate);
  const quickCreateFocusReturned = await quickCreate.evaluate((element) => element === document.activeElement);

  const knowledgeLink = page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "知识", exact: true });
  await knowledgeLink.focus();
  const focused = await knowledgeLink.evaluate((element) => element === document.activeElement);
  await page.keyboard.press("Enter");
  await page.waitForURL((candidate) => candidate.pathname === "/knowledge/canvas");
  record(checks, {
    id: "KBD-02",
    category: "keyboard",
    route: "/today",
    viewport: viewport("desktop"),
    mechanism: "keyboard",
    assertions: [
      assertion("quick-create-trigger-focused", true, quickCreateFocused),
      assertion("quick-create-opened-by-enter", true, quickCreateLinks > 0),
      assertion("quick-create-exposes-four-actions", 4, quickCreateLinks),
      assertion("quick-create-escape-returned-focus", true, quickCreateFocusReturned),
      assertion("nav-link-focused", true, focused),
      assertion("enter-activated-navigation", "/knowledge/canvas", pathname(page)),
    ],
  });
}

async function canvasDesktopChecks(
  page: Page,
  context: BrowserContext,
  config: BrowserEvidenceConfig,
  fixture: FixtureAccount,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const command = page.locator('[aria-label="画布布局键盘命令"]');
  const selectedNodeId = await page.getByLabel("画布焦点对象").inputValue();
  const selectedNode = page.locator(`.react-flow__node[data-id="${selectedNodeId}"]`);
  await command.focus();
  const responsePromise = layoutMutationResponse(page);
  const [response] = await Promise.all([responsePromise, page.keyboard.press("ArrowRight")]);
  const announcement = page.locator('[aria-label="画布布局命令"] [aria-live="polite"]');
  await waitForNonEmptyText(announcement);
  await selectedNode.waitFor();
  await waitForElementFocus(selectedNode);
  const focusRetained = await selectedNode.evaluate((element) => element === document.activeElement);
  const announcementLength = await announcement.evaluate((element) => element.textContent?.trim().length ?? 0);
  record(checks, {
    id: "KBD-05",
    category: "keyboard",
    route: "/knowledge/canvas",
    viewport: viewport("desktop"),
    mechanism: "keyboard",
    assertions: [
      assertion("arrow-command-saved-layout", 200, response.status()),
      assertion("arrow-command-focused-operated-node", true, focusRetained),
    ],
  });
  record(checks, {
    id: "LIVE-05",
    category: "live",
    route: "/knowledge/canvas",
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [
      assertion("layout-announcement-present", 1, announcementLength, "gte"),
      assertion("layout-announcement-polite", "polite", await announcement.getAttribute("aria-live") ?? "missing"),
    ],
  });

  const canvasPath = "/api/knowledge-canvas?depth=1&limit=40";
  const before = await getJson(context, config, canvasPath);
  await command.focus();
  const secondResponsePromise = layoutMutationResponse(page);
  const [secondResponse] = await Promise.all([secondResponsePromise, page.keyboard.press("ArrowDown")]);
  const after = await pollJson(context, config, canvasPath, (candidate) => candidate.sha256 !== before.sha256);
  await waitForElementFocus(selectedNode);
  const secondKeyboardFocusRetained = await selectedNode.evaluate(
    (element) => element === document.activeElement,
  );

  const hideButton = page.getByRole("button", { name: "隐藏对象" });
  const hideResponsePromise = layoutMutationResponse(page);
  const [hideResponse] = await Promise.all([hideResponsePromise, hideButton.click()]);
  const restoreSelect = page.getByRole("combobox", { name: "恢复隐藏对象" });
  await restoreSelect.waitFor();
  await waitForElementFocus(restoreSelect);
  const hideAnnouncement = await announcement.textContent() ?? "";
  const hideFocusMoved = await restoreSelect.evaluate((element) => element === document.activeElement);
  const restoreResponsePromise = layoutMutationResponse(page);
  const [restoreResponse] = await Promise.all([
    restoreResponsePromise,
    page.getByRole("button", { name: "恢复隐藏对象" }).click(),
  ]);
  await selectedNode.waitFor();
  await waitForElementFocus(selectedNode);

  const beforeReset = await getJson(context, config, canvasPath);
  const resetTrigger = page.getByRole("button", { name: "重置布局" });
  await resetTrigger.click({ trial: true });
  await resetTrigger.focus();
  await page.keyboard.press("Enter");
  const resetDialog = page.getByRole("dialog", { name: "重置个人布局？" });
  await resetDialog.waitFor();
  const resetResponsePromise = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/knowledge-canvas/layout"
      && candidate.request().method() === "DELETE");
  const [resetResponse] = await Promise.all([
    resetResponsePromise,
    resetDialog.getByRole("button", { name: "确认重置" }).click(),
  ]);
  await resetDialog.waitFor({ state: "detached" });
  await waitForElementFocus(resetTrigger);
  const resetAnnouncement = page.locator('[aria-label="画布布局命令"] [aria-live="polite"]')
    .filter({ hasText: "画布布局已重置" });
  await resetAnnouncement.waitFor();
  const resetAnnouncementObserved = (await resetAnnouncement.textContent() ?? "").includes("画布布局已重置");
  const resetFocusReturned = await resetTrigger.evaluate((element) => element === document.activeElement);
  const afterReset = await pollJson(context, config, canvasPath, (candidate) => candidate.sha256 !== beforeReset.sha256);

  const conflictPage = await context.newPage();
  configurePage(conflictPage, config);
  let primaryConflictBaselineStatus = 0;
  let staleConflictStatus = 0;
  let conflictRetryStatus = 0;
  let conflictModalBlockedEscape = false;
  let conflictCopyRetained = false;
  try {
    await conflictPage.goto(url(config, "/knowledge/canvas"), { waitUntil: "domcontentloaded" });
    const primaryCommand = page.locator('[aria-label="画布布局键盘命令"]');
    await primaryCommand.click({ trial: true });
    await primaryCommand.focus();
    const primaryConflictBaseline = layoutMutationResponse(page);
    const [primaryResponse] = await Promise.all([primaryConflictBaseline, page.keyboard.press("ArrowRight")]);
    primaryConflictBaselineStatus = primaryResponse.status();

    const staleConflict = layoutMutationResponse(conflictPage);
    const [staleResponse] = await Promise.all([
      staleConflict,
      conflictPage.getByRole("button", { name: "向左微调" }).click(),
    ]);
    staleConflictStatus = staleResponse.status();
    const conflictModal = conflictPage.getByRole("dialog", { name: "布局已在其他设备更新" });
    await conflictModal.waitFor();
    await waitForFocusWithin(conflictModal);
    conflictCopyRetained = await conflictModal.getByText(/本地修改仍保留/).isVisible();
    await conflictPage.keyboard.press("Escape");
    conflictModalBlockedEscape = await conflictModal.isVisible();
    const retryResponsePromise = layoutMutationResponse(conflictPage);
    const [retryResponse] = await Promise.all([
      retryResponsePromise,
      conflictModal.getByRole("button", { name: "保留本地修改并重试" }).click(),
    ]);
    conflictRetryStatus = retryResponse.status();
    await conflictModal.waitFor({ state: "detached" });
  } finally {
    await conflictPage.close();
  }
  record(checks, {
    id: "CANVAS-03",
    category: "canvas",
    route: "/knowledge/canvas",
    viewport: viewport("desktop"),
    mechanism: "api",
    assertions: [
      assertion("second-keyboard-layout-status", 200, secondResponse.status()),
      assertion("layout-get-before-status", 200, before.status),
      assertion("layout-get-after-status", 200, after.status),
      assertion("layout-get-oracle-changed", true, before.sha256 !== after.sha256),
      assertion("keyboard-operation-focus-still-retained", true, secondKeyboardFocusRetained),
      assertion("hide-layout-status", 200, hideResponse.status()),
      assertion("hide-focus-moved-to-restore-control", true, hideFocusMoved),
      assertion("hide-announcement-names-focus-destination", true, hideAnnouncement.includes("焦点移至")),
      assertion("restore-layout-status", 200, restoreResponse.status()),
      assertion("reset-layout-status", 200, resetResponse.status()),
      assertion("reset-layout-get-status", 200, afterReset.status),
      assertion("reset-layout-get-oracle-changed", true, beforeReset.sha256 !== afterReset.sha256),
      assertion("reset-layout-announced", true, resetAnnouncementObserved),
      assertion("reset-layout-focus-returned", true, resetFocusReturned),
      assertion("conflict-baseline-layout-status", 200, primaryConflictBaselineStatus),
      assertion("stale-layout-conflict-status", 409, staleConflictStatus),
      assertion("conflict-modal-retained-local-copy", true, conflictCopyRetained),
      assertion("conflict-modal-blocked-escape", true, conflictModalBlockedEscape),
      assertion("conflict-explicit-retry-status", 200, conflictRetryStatus),
    ],
  });

  const expandResponsePromise = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/knowledge-canvas"
      && candidate.request().method() === "GET");
  await page.getByRole("button", { name: "展开一层" }).click();
  const expandResponse = await expandResponsePromise;
  if (expandResponse.status() !== 200) throw new Error("accessibility canvas depth expansion failed");
  await page.getByText("刷新中…", { exact: true }).waitFor({ state: "detached" });

  const listButton = page.getByRole("button", { name: "等价列表" });
  await listButton.focus();
  await page.keyboard.press("Enter");
  const list = page.getByRole("list", { name: "画布等价列表" });
  await list.waitFor();
  const canvasBody = asRecord(asRecord(parseJson(await expandResponse.body())).canvas);
  const apiList = arrayRecords(canvasBody.list);
  const apiListCount = apiList.length;
  const domRowCount = await list.getByRole("listitem").count();
  const apiEdges = arrayRecords(canvasBody.edges);
  const relationKind = stringField(apiEdges[0], "kind");
  if (!relationKind) throw new Error("accessibility canvas fixture has no relation kind");
  const relationNodeIds = new Set(apiEdges
    .filter((edge) => edge.kind === relationKind)
    .flatMap((edge) => [stringField(edge, "sourceId"), stringField(edge, "targetId")])
    .filter((value): value is string => Boolean(value)));
  const expectedRelationRows = apiList.filter((row) => relationNodeIds.has(String(row.id))).length;
  const relationSelect = page.getByRole("combobox", { name: "按关系筛选" });
  await relationSelect.selectOption(relationKind);
  await page.waitForFunction((expected) =>
    document.querySelector('[aria-label="画布等价列表"]')?.children.length === expected,
  expectedRelationRows);
  const relationRowCount = await list.getByRole("listitem").count();
  await relationSelect.selectOption("");

  const subjectSelect = page.getByRole("combobox", { name: "按科目筛选" });
  const subjectOptions = subjectSelect.locator('option:not([value=""])');
  const subjectOptionCount = await subjectOptions.count();
  const subjectId = fixture.subjectId;
  if (await subjectSelect.locator(`option[value="${subjectId}"]`).count() === 0) {
    throw new Error("accessibility canvas fixture subject filter option is missing");
  }
  await subjectSelect.selectOption(subjectId);
  const subjectResponsePromise = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/knowledge-canvas"
      && candidate.request().method() === "GET");
  await page.getByRole("button", { name: "应用筛选" }).click();
  const subjectResponse = await subjectResponsePromise;
  await list.waitFor();
  const subjectBody = asRecord(asRecord(parseJson(await subjectResponse.body())).canvas);
  const subjectApiRowCount = arrayRecords(subjectBody.list).length;
  const subjectDomRowCount = await list.getByRole("listitem").count();
  const sourcePath = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
  record(checks, {
    id: "CANVAS-01",
    category: "canvas",
    route: "/knowledge/canvas?view=list",
    viewport: viewport("desktop"),
    mechanism: "api",
    assertions: [
      assertion("equivalent-list-named", true, await list.isVisible()),
      assertion("equivalent-list-nonempty", 1, domRowCount, "gte"),
      assertion("equivalent-list-matches-api", apiListCount, domRowCount),
      assertion("equivalent-list-has-open-link", 1, await list.getByRole("link", { name: "打开" }).count(), "gte"),
      assertion("relation-filter-kind-selected", relationKind, relationKind),
      assertion("relation-filter-matches-api-edges", expectedRelationRows, relationRowCount),
      assertion("subject-filter-request-status", 200, subjectResponse.status()),
      assertion("subject-filter-has-two-subjects", 2, subjectOptionCount),
      assertion("subject-filter-matches-api", subjectApiRowCount, subjectDomRowCount),
      assertion("subject-filter-reduces-list", true, subjectApiRowCount > 0 && subjectApiRowCount < apiListCount),
      assertion("subject-filter-bound-in-url", subjectId, new URL(page.url()).searchParams.get("subjectId") ?? "missing"),
    ],
  });

  const detailPath = `/knowledge/syllabus/${fixture.syllabusNodeId}`;
  const detailLink = list.locator(`a[href="${detailPath}"]`);
  await detailLink.waitFor();
  await detailLink.focus();
  const listLinkFocused = await detailLink.evaluate((element) => element === document.activeElement);
  await page.keyboard.press("Enter");
  await page.waitForURL((candidate) => candidate.pathname === detailPath);
  await page.waitForFunction(() => document.activeElement?.tagName === "H1");
  const detailHeadingFocused = await page.evaluate(() => document.activeElement?.tagName === "H1");
  const backLink = page.getByRole("link", { name: "返回考纲树" });
  await backLink.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((candidate) => candidate.pathname === "/knowledge/canvas" && candidate.searchParams.get("view") === "list");
  const restoredDetailLink = page.locator(`a[href="${detailPath}"]`);
  await waitForElementFocus(restoredDetailLink);
  record(checks, {
    id: "FOCUS-04",
    category: "focus",
    route: "/knowledge/canvas?view=list",
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [
      assertion("canvas-operation-focus-retained", true, focusRetained),
      assertion("hide-focus-used-deterministic-exception", true, hideFocusMoved),
      assertion("canvas-list-link-focused-before-enter", true, listLinkFocused),
      assertion("canvas-detail-heading-focused", true, detailHeadingFocused),
      assertion("canvas-return-url-restored", sourcePath, `${new URL(page.url()).pathname}${new URL(page.url()).search}`),
      assertion("canvas-list-row-focus-restored", true, await restoredDetailLink.evaluate((element) => element === document.activeElement)),
    ],
  });
}

async function noteFocusCheck(
  page: Page,
  fixture: FixtureAccount,
  config: BrowserEvidenceConfig,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const noteId = required(fixture.noteId, "accessibility fixture note");
  await page.goto(new URL(`/knowledge/notes`, page.url()).toString(), { waitUntil: "domcontentloaded" });
  const link = page.getByRole("link", { name: "打开卡片详情" }).first();
  await link.focus();
  const focusedBefore = await link.evaluate((element) => element === document.activeElement);
  await page.keyboard.press("Enter");
  await page.waitForURL((candidate) => candidate.pathname === `/knowledge/notes/${noteId}`);
  await page.waitForFunction(() => document.activeElement?.tagName === "H1");
  const detailFocus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? "",
    tabIndex: document.activeElement instanceof HTMLElement ? document.activeElement.tabIndex : 0,
  }));

  await page.goto(url(config, `/knowledge/syllabus/${fixture.syllabusNodeId}`), { waitUntil: "domcontentloaded" });
  const editButton = page.getByRole("button", { name: "编辑节点" });
  await editButton.focus();
  await page.keyboard.press("Enter");
  const title = page.getByRole("textbox", { name: "标题" });
  await title.fill("合成基础节点 · 焦点核验");
  const saveResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/syllabus/nodes/${fixture.syllabusNodeId}`
      && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "保存节点" }).click();
  const response = await saveResponse;
  const status = page.getByRole("status").filter({ hasText: "考纲节点已保存" });
  await status.waitFor();
  await waitForElementFocus(editButton);
  record(checks, {
    id: "FOCUS-03",
    category: "focus",
    route: `/knowledge/notes/${noteId}`,
    viewport: viewport("desktop"),
    mechanism: "keyboard",
    assertions: [
      assertion("detail-link-focused-before-enter", true, focusedBefore),
      assertion("detail-heading-received-focus", "H1", detailFocus.tag),
      assertion("detail-heading-programmatic-tabindex", -1, detailFocus.tabIndex),
      assertion("syllabus-save-status", 200, response.status()),
      assertion("syllabus-save-result-is-live", true, await status.isVisible()),
      assertion("syllabus-save-returned-to-edit", true, await editButton.evaluate((element) => element === document.activeElement)),
    ],
  });
}

async function focusLiveChecks(
  page: Page,
  fixture: FixtureAccount,
  config: BrowserEvidenceConfig,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const sessionId = required(fixture.activeSessionId, "accessibility fixture session");
  await page.goto(url(config, `/focus/${sessionId}?returnTo=%2Ftoday`), { waitUntil: "domcontentloaded" });
  const live = page.locator('[aria-live="assertive"][aria-atomic="true"]').first();
  const initial = await live.evaluate((element) => ({
    hasText: Boolean(element.textContent?.trim()),
    live: element.getAttribute("aria-live") ?? "",
    atomic: element.getAttribute("aria-atomic") ?? "",
  }));
  record(checks, {
    id: "LIVE-02",
    category: "live",
    route: `/focus/${sessionId}`,
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [
      assertion("timer-status-has-text", true, initial.hasText),
      assertion("timer-status-assertive", "assertive", initial.live),
      assertion("timer-status-atomic", "true", initial.atomic),
    ],
  });
  const pause = page.getByRole("button", { name: "暂停" });
  await pause.focus();
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/study-sessions/${sessionId}/pause` && response.request().method() === "POST");
  const [response] = await Promise.all([responsePromise, page.keyboard.press("Enter")]);
  await page.getByText("已暂停", { exact: true }).first().waitFor();
  const paused = await live.evaluate((element) => Boolean(element.textContent?.trim()));
  record(checks, {
    id: "LIVE-03",
    category: "live",
    route: `/focus/${sessionId}`,
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [
      assertion("pause-ui-mutation-status", 200, response.status()),
      assertion("pause-announced", true, paused),
      assertion("pause-terminal-control-visible", true, await page.getByRole("button", { name: "继续" }).isVisible()),
    ],
  });
}

async function reviewLiveChecks(
  page: Page,
  config: BrowserEvidenceConfig,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  await page.goto(url(config, "/review/daily"), { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("今天完成了什么").fill("合成无障碍复盘");
  await page.getByPlaceholder("今天最该保留的一个动作").fill("合成无障碍保留动作");
  await page.getByPlaceholder("明天最小必须完成任务").fill("合成无障碍明日行动");
  const response = await clickAndWaitForResponse(page, config, "/api/daily-reviews", 201, () =>
    page.getByRole("button", { name: "保存复盘" }).click());
  const success = page.locator('[aria-live="polite"]').filter({ hasText: "复盘" });
  await success.waitFor();
  const successVisible = await success.isVisible();
  const successLive = await success.getAttribute("aria-live") ?? "missing";

  await page.route("**/api/daily-reviews/**", (route) => route.abort("failed"));
  await page.getByPlaceholder("今天完成了什么").fill("合成无障碍网络失败草稿");
  await page.getByRole("button", { name: "更新复盘" }).click();
  const alert = page.getByRole("alert").filter({ hasText: /\S/ });
  await alert.waitFor();
  const draftCount = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("areaforge.daily-review.draft.")).length);
  record(checks, {
    id: "LIVE-06",
    category: "live",
    route: "/review/daily",
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [
      assertion("review-save-status", 201, response.status()),
      assertion("review-success-live-region", true, successVisible),
      assertion("review-success-polite", "polite", successLive),
      assertion("network-error-alert-visible", true, await alert.isVisible()),
      assertion("network-error-has-message", true, await alert.evaluate((element) => Boolean(element.textContent?.trim()))),
      assertion("failed-review-draft-retained", 1, draftCount, "gte"),
    ],
  });
  await page.unroute("**/api/daily-reviews/**");
}

async function notificationFallbackLiveCheck(
  page: Page,
  config: BrowserEvidenceConfig,
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  await page.goto(url(config, "/settings/notifications"), { waitUntil: "domcontentloaded" });
  const response = await clickAndWaitForResponse(page, config, "/api/notifications/test", 200, () =>
    page.getByRole("button", { name: "测试通知" }).click());
  const status = page.getByRole("status").filter({ hasText: "已降级为应用内提示" });
  await status.waitFor();
  record(checks, {
    id: "LIVE-04",
    category: "live",
    route: "/settings/notifications",
    viewport: viewport("desktop"),
    mechanism: "dom",
    assertions: [
      assertion("notification-test-status", 200, response.status()),
      assertion("notification-fallback-visible", true, await status.isVisible()),
      assertion("notification-fallback-polite", "polite", await status.getAttribute("aria-live") ?? "missing"),
      assertion("notification-fallback-atomic", "true", await status.getAttribute("aria-atomic") ?? "missing"),
    ],
  });
}

async function runNativeZoomCheck(
  input: {
    browser: Browser;
    nativeContext: BrowserContext;
    config: BrowserEvidenceConfig;
    fixture: FixtureAccount;
  },
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const page = input.nativeContext.pages().find((candidate) => !candidate.url().startsWith("chrome://"))
    ?? await input.nativeContext.newPage();
  configurePage(page, input.config);
  const zoom100 = await setChromeDefaultZoom(input.nativeContext, 1);
  await authenticateWithClick(page, input.config, input.fixture, "/today");
  const baseline = await nativeWindowMetrics(page);

  const zoom200 = await setChromeDefaultZoom(input.nativeContext, 2);
  await page.reload({ waitUntil: "domcontentloaded" });
  const zoomed = await nativeWindowMetrics(page);
  const authenticatedRoutes = [
    { journey: "dashboard", path: "/today" },
    { journey: "timer-closeout", path: `/focus/${required(input.fixture.activeSessionId, "accessibility fixture session")}?returnTo=%2Ftoday` },
    { journey: "review", path: "/review/daily" },
    { journey: "notes", path: "/knowledge/notes" },
    { journey: "syllabus", path: "/knowledge/syllabus" },
    { journey: "reports", path: "/review/reports?tab=current&period=week" },
    { journey: "simulation", path: "/stage/simulation" },
    { journey: "update-center", path: "/settings/system" },
  ] as const;
  const routeMetrics: Array<Awaited<ReturnType<typeof nativeRouteMetrics>>> = [];
  for (const route of authenticatedRoutes) {
    routeMetrics.push(await nativeRouteMetrics(page, input.config, route.journey, route.path));
  }

  const loginContext = await input.browser.newContext({
    viewport: null,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  try {
    const loginPage = await loginContext.newPage();
    configurePage(loginPage, input.config);
    routeMetrics.unshift(await nativeRouteMetrics(loginPage, input.config, "login", "/login"));
  } finally {
    await loginContext.close();
  }

  const failedRoutes = routeMetrics
    .filter((metrics) => !metrics.routeMatched || !metrics.noHorizontalOverflow
      || metrics.unreachableControlCount > 0 || metrics.coveredControlCount > 0)
    .map((metrics) => metrics.journey);
  const cssViewportRatio = baseline.innerWidth / zoomed.innerWidth;
  const dprRatio = zoomed.devicePixelRatio / baseline.devicePixelRatio;
  record(checks, {
    id: "ZOOM-01",
    category: "zoom",
    route: "/today",
    mechanism: "viewport",
    assertions: [
      assertion("native-zoom-setting-before", "1", zoom100),
      assertion("native-zoom-setting-after", "2", zoom200),
      assertion("native-window-width-fixed", baseline.outerWidth, zoomed.outerWidth),
      assertion("native-window-height-fixed", baseline.outerHeight, zoomed.outerHeight),
      assertion("native-visual-scale-remains-one", 1, zoomed.visualScale),
      assertion("native-css-viewport-ratio-is-two", { min: 1.9, max: 2.1 }, cssViewportRatio, "between-inclusive"),
      assertion("native-device-pixel-ratio-doubles", { min: 1.9, max: 2.1 }, dprRatio, "between-inclusive"),
      assertion("nine-journey-routes-covered", 9, routeMetrics.length),
      assertion("native-zoom-route-reflow", { routeCount: 9, failures: [] }, {
        routeCount: routeMetrics.length,
        failures: failedRoutes,
      }),
      assertion("native-zoom-metrics-captured", true, routeMetrics.every((metrics) =>
        metrics.innerWidth > 0 && metrics.innerHeight > 0 && metrics.focusableControlCount >= 0)),
    ],
  });
}

async function runMobileChecks(
  input: { browser: Browser; config: BrowserEvidenceConfig; fixture: FixtureAccount },
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
): Promise<void> {
  const context = await newContext(input.browser, "mobile");
  const page = await context.newPage();
  configurePage(page, input.config);
  try {
    await authenticateWithClick(page, input.config, input.fixture, "/today");
    const narrow = await reflowMetrics(page);
    record(checks, {
      id: "ZOOM-02",
      category: "zoom",
      route: "/today",
      viewport: viewport("mobile"),
      mechanism: "viewport",
      assertions: [
        assertion("mobile-css-width", 390, narrow.innerWidth),
        assertion("mobile-no-horizontal-overflow", true, narrow.noHorizontalOverflow),
        assertion("mobile-controls-reachable", true, narrow.controlsWithinHorizontalBounds),
      ],
    });

    await page.goto(url(input.config, "/knowledge/canvas"), { waitUntil: "domcontentloaded" });
    const layoutButtonsDisabled = await page.locator('[aria-label$="微调"]').evaluateAll((buttons) =>
      buttons.length > 0 && buttons.every((button) => (button as HTMLButtonElement).disabled));
    const resetCount = await page.getByRole("button", { name: "重置布局" }).count();
    const expandResponsePromise = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/knowledge-canvas"
        && candidate.request().method() === "GET");
    await page.getByRole("button", { name: "展开一层" }).click();
    const expandResponse = await expandResponsePromise;
    if (expandResponse.status() !== 200) throw new Error("mobile accessibility canvas depth expansion failed");
    await page.getByText("刷新中…", { exact: true }).waitFor({ state: "detached" });

    const toggle = page.getByRole("button", { name: "等价列表" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("list", { name: "画布等价列表" });
    await list.waitFor();
    const detailPath = `/knowledge/syllabus/${input.fixture.syllabusNodeId}`;
    const open = list.locator(`a[href="${detailPath}"]`);
    const linkCount = await list.getByRole("link", { name: "打开" }).count();
    await open.waitFor();
    await open.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((candidate) => candidate.pathname === detailPath);
    await page.waitForFunction(() => document.activeElement?.tagName === "H1");
    const destination = pathname(page);
    const headingFocused = await page.evaluate(() => document.activeElement?.tagName === "H1");
    record(checks, {
      id: "CANVAS-02",
      category: "canvas",
      route: "/knowledge/canvas?view=list",
      viewport: viewport("mobile"),
      mechanism: "keyboard",
      assertions: [
        assertion("mobile-layout-buttons-disabled", true, layoutButtonsDisabled),
        assertion("mobile-reset-layout-absent", 0, resetCount),
        assertion("mobile-equivalent-list-open-link", 1, linkCount, "gte"),
        assertion("mobile-list-opened-canonical-detail", true, destination !== "/knowledge/canvas"),
        assertion("mobile-detail-heading-focused", true, headingFocused),
      ],
    });

    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(url(input.config, "/settings/system"), { waitUntil: "domcontentloaded" });
    const landscape = await reflowMetrics(page);
    record(checks, {
      id: "ZOOM-03",
      category: "zoom",
      route: "/settings/system",
      viewport: viewport("mobile"),
      mechanism: "viewport",
      assertions: [
        assertion("landscape-width-observed", 844, landscape.innerWidth),
        assertion("landscape-height-observed", 390, landscape.innerHeight),
        assertion("landscape-no-horizontal-overflow", true, landscape.noHorizontalOverflow),
        assertion("landscape-controls-reachable", true, landscape.controlsWithinHorizontalBounds),
      ],
    });
  } finally {
    await context.close();
  }
}

function record(
  checks: Map<V11AccessibilityCheckId, V11AccessibilityCheck>,
  input: CheckInput,
): void {
  const derivedCategory = categoryForCheck(input.id);
  if (derivedCategory !== input.category) throw new Error(`accessibility category mismatch for ${input.id}`);
  if (checks.has(input.id)) throw new Error(`duplicate accessibility check ${input.id}`);
  const writer = artifactWriters.get(checks);
  if (!writer) throw new Error("accessibility artifact writer is unavailable");
  const contract = V11_ACCESSIBILITY_CHECK_CONTRACTS[input.id];
  assertV11AssertionListContract(input.assertions, contract.assertions, `accessibility ${input.id}`);
  const { viewport: _legacyViewport, ...evidenceInput } = input;
  void _legacyViewport;
  const evidence = {
    ...evidenceInput,
    checkKey: contract.checkKey,
    target: contract.target,
    profile: V11_ACCESSIBILITY_PROFILE_CONTRACT[contract.profile],
  } as Omit<V11AccessibilityCheck, "artifact" | "result">;
  const failed = input.assertions.filter((item) => !item.passed);
  const artifact = writer.write(evidence);
  checks.set(input.id, {
    ...evidence,
    artifact: {
      ...artifact,
      kind: artifactKinds[input.category],
      observationCount: input.assertions.length,
    },
    result: failed.length === 0 ? "pass" : "fail",
  });
}

function assertion(
  id: string,
  expected: V11RedactedValue,
  actual: V11RedactedValue,
  predicate: V11Assertion["predicate"] = "equals",
): V11Assertion {
  return {
    id,
    predicate,
    expected,
    actual,
    passed: evaluateAssertion(predicate, expected, actual),
  };
}

function evaluateAssertion(
  predicate: V11Assertion["predicate"],
  expected: V11RedactedValue,
  actual: V11RedactedValue,
): boolean {
  if (predicate === "equals") {
    return Object.is(expected, actual) || JSON.stringify(expected) === JSON.stringify(actual);
  }
  if (predicate === "gte") {
    return typeof expected === "number" && typeof actual === "number" && actual >= expected;
  }
  if (predicate === "between-inclusive") {
    const range = typeof expected === "object" && expected !== null && !Array.isArray(expected)
      ? expected as { min?: V11RedactedValue; max?: V11RedactedValue }
      : null;
    return typeof range?.min === "number"
      && typeof range.max === "number"
      && typeof actual === "number"
      && actual >= range.min
      && actual <= range.max;
  }
  throw new Error(`unsupported runner assertion predicate: ${predicate}`);
}

async function newContext(browser: Browser, id: "desktop" | "mobile"): Promise<BrowserContext> {
  const contract = V11_VIEWPORT_CONTRACT[id];
  return browser.newContext({
    viewport: { width: contract.width, height: contract.height },
    deviceScaleFactor: contract.deviceScaleFactor,
    isMobile: id === "mobile",
    hasTouch: id === "mobile",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
}

function configurePage(page: Page, config: BrowserEvidenceConfig): void {
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);
}

async function authenticateWithClick(
  page: Page,
  config: BrowserEvidenceConfig,
  fixture: FixtureAccount,
  returnTo: string,
): Promise<void> {
  await page.goto(url(config, `/login?returnTo=${encodeURIComponent(returnTo)}`), { waitUntil: "domcontentloaded" });
  await page.getByLabel("邮箱").fill(fixture.email);
  await page.getByLabel("密码").fill(config.password);
  await clickAndWaitForResponse(page, config, "/api/auth/login", 200, () =>
    page.getByRole("button", { name: "登录" }).click());
  await page.waitForURL((candidate) => candidate.pathname === new URL(returnTo, config.baseUrl).pathname);
}

async function clickAndWaitForResponse(
  page: Page,
  config: BrowserEvidenceConfig,
  expectedPath: string,
  expectedStatus: number,
  action: () => Promise<unknown>,
): Promise<PlaywrightResponse> {
  const promise = page.waitForResponse((response) => {
    const candidate = new URL(response.url());
    return candidate.origin === config.baseUrl.origin
      && candidate.pathname === expectedPath
      && response.request().method() === "POST";
  });
  const [response] = await Promise.all([promise, action()]);
  if (response.status() !== expectedStatus) throw new Error(`accessibility UI request returned HTTP ${response.status()}`);
  return response;
}

function layoutMutationResponse(page: Page): Promise<PlaywrightResponse> {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/knowledge-canvas/layout"
      && response.request().method() === "PUT");
}

async function getJson(context: BrowserContext, config: BrowserEvidenceConfig, path: string) {
  const response = await context.request.get(url(config, path), { headers: { accept: "application/json" } });
  const bytes = await response.body();
  return { status: response.status(), sha256: sha256(bytes), body: parseJson(bytes) };
}

async function pollJson(
  context: BrowserContext,
  config: BrowserEvidenceConfig,
  path: string,
  accept: (capture: Awaited<ReturnType<typeof getJson>>) => boolean,
) {
  const deadline = Date.now() + config.timeoutMs;
  let capture = await getJson(context, config, path);
  while (!accept(capture) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    capture = await getJson(context, config, path);
  }
  if (!accept(capture)) throw new Error("accessibility GET oracle did not reach the expected state");
  return capture;
}

async function waitForNonEmptyText(locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.waitFor();
  await locator.evaluate((element) => new Promise<void>((resolve, reject) => {
    if (element.textContent?.trim()) return resolve();
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error("live region remained empty"));
    }, 10_000);
    const observer = new MutationObserver(() => {
      if (!element.textContent?.trim()) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    observer.observe(element, { childList: true, characterData: true, subtree: true });
  }));
}

async function waitForElementFocus(locator: ReturnType<Page["locator"]>): Promise<void> {
  await waitForFocus(locator, false);
}

async function waitForFocusWithin(locator: ReturnType<Page["locator"]>): Promise<void> {
  await waitForFocus(locator, true);
}

async function waitForFocus(locator: ReturnType<Page["locator"]>, within: boolean): Promise<void> {
  await locator.evaluate((element, contains) => new Promise<void>((resolve, reject) => {
    const deadline = performance.now() + 5_000;
    const interval = window.setInterval(() => {
      const matched = contains ? element.contains(document.activeElement) : element === document.activeElement;
      if (matched) {
        window.clearInterval(interval);
        resolve();
      } else if (performance.now() >= deadline) {
        window.clearInterval(interval);
        reject(new Error("focus did not reach the expected target"));
      }
    }, 16);
  }), within);
}

async function setChromeDefaultZoom(context: BrowserContext, zoom: 1 | 2): Promise<string> {
  const settings = await context.newPage();
  try {
    await settings.goto("chrome://settings/appearance", { waitUntil: "domcontentloaded" });
    const select = settings.locator("select#zoomLevel");
    await select.waitFor();
    await select.selectOption(String(zoom));
    await select.evaluate((element, expected) => new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 5_000;
      const interval = window.setInterval(() => {
        if ((element as HTMLSelectElement).value === expected) {
          window.clearInterval(interval);
          resolve();
        } else if (performance.now() >= deadline) {
          window.clearInterval(interval);
          reject(new Error("native browser zoom setting did not settle"));
        }
      }, 16);
    }), String(zoom));
    return await select.inputValue();
  } finally {
    await settings.close();
  }
}

async function nativeWindowMetrics(page: Page): Promise<{
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  visualScale: number;
}> {
  return page.evaluate(() => ({
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    visualScale: window.visualViewport?.scale ?? 1,
  }));
}

async function nativeRouteMetrics(
  page: Page,
  config: BrowserEvidenceConfig,
  journey: string,
  route: string,
): Promise<{
  journey: string;
  expectedPath: string;
  resolvedPath: string;
  routeMatched: boolean;
  innerWidth: number;
  innerHeight: number;
  noHorizontalOverflow: boolean;
  focusableControlCount: number;
  unreachableControlCount: number;
  coveredControlCount: number;
}> {
  const expectedPath = new URL(route, config.baseUrl).pathname;
  await page.goto(url(config, route), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(100);
  const observed = await page.evaluate(async () => {
    const selector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusables = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => element.getClientRects().length > 0
        && element.closest("details:not([open])") === null
        && getComputedStyle(element).visibility !== "hidden"
        && getComputedStyle(element).display !== "none")
      .slice(0, 300);
    let unreachableControlCount = 0;
    let coveredControlCount = 0;
    for (const element of focusables) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const rect = element.getBoundingClientRect();
      const centerX = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const centerY = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const topmost = document.elementFromPoint(centerX, centerY);
      const inViewport = rect.width > 0 && rect.height > 0
        && rect.right > 0 && rect.bottom > 0
        && rect.left < window.innerWidth && rect.top < window.innerHeight;
      if (document.activeElement !== element || !inViewport) unreachableControlCount += 1;
      if (!topmost || !(topmost === element || element.contains(topmost) || topmost.contains(element))) {
        coveredControlCount += 1;
      }
    }
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      focusableControlCount: focusables.length,
      unreachableControlCount,
      coveredControlCount,
    };
  });
  const resolvedPath = pathname(page);
  return {
    journey,
    expectedPath,
    resolvedPath,
    routeMatched: resolvedPath === expectedPath,
    ...observed,
  };
}

async function reflowMetrics(page: Page): Promise<{
  innerWidth: number;
  innerHeight: number;
  visualScale: number;
  noHorizontalOverflow: boolean;
  controlsWithinHorizontalBounds: boolean;
}> {
  return page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'))
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const tolerance = 1;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualScale: window.visualViewport?.scale ?? 1,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + tolerance,
      controlsWithinHorizontalBounds: controls.every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -tolerance && rect.right <= window.innerWidth + tolerance;
      }),
    };
  });
}

function viewport(id: "desktop" | "mobile"): V11Viewport {
  return { id, ...V11_VIEWPORT_CONTRACT[id] };
}

function url(config: BrowserEvidenceConfig, path: string): string {
  return new URL(path, config.baseUrl).toString();
}

function pathname(page: Page): string {
  return new URL(page.url()).pathname;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringField(value: unknown, field: string): string | null {
  const candidate = asRecord(value)[field];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined || value === "") throw new Error(`${label} is missing`);
  return value as T;
}
