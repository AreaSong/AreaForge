import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { hashPassword } from "../../packages/auth/src/index";
import { createPrismaClient } from "../../packages/db/src/index";
import { loadDataDeleteFixture, deleteFixtureEnvironment, verifyDeleteFixtureLedger } from "./data-delete-fixture";
import { loadDevTestDeleteFixture } from "../dev/dev-test-delete-fixture";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { seedDeletionCase, makeDeletionEligible } from "./data-delete-runtime-data";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";

type Pool = { slot: number; port: number; url: string; status: string; sourceFingerprint: string; fixtureId: string; buildId: string };
const output = path.resolve("output/playwright/data-delete");
const panel = (page: Page) => page.locator('section[aria-labelledby="data-deletion-title"]');
const password = "Synthetic-Deletion-Only-42!";

async function main() {
  const fixture = loadDataDeleteFixture(process.argv[2] ?? process.env.AREAFORGE_DATA_DELETE_FIXTURE_ROOT ?? "");
  const env = deleteFixtureEnvironment(fixture);
  const pool = requireDeletePool(fixture.root, env.DATABASE_URL!);
  const client = createPrismaClient(env.DATABASE_URL);
  await verifyDeleteFixtureLedger(client);
  const passwordHash = await hashPassword(password);
  const data = await seedDeletionCase(client, fixture, passwordHash);
  const other = await seedDeletionCase(client, fixture, passwordHash);
  await mkdir(output, { recursive: true });
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ ...(existsSync(chrome) ? { executablePath: chrome } : {}), headless: true });
  const errors: string[] = [];
  try {
    const context = await contextFor(browser, pool, errors);
    assert.equal((await context.request.get("/api/system/deletions")).status(), 401);
    const page = await context.newPage();
    await login(page, data.user.email);
    assert.equal((await browserApi(page, "/api/system/deletions")).status, 200, "real browser login must authenticate API probes");
    assert.ok((await context.cookies()).some(cookie => cookie.secure && cookie.httpOnly));
    await page.goto("/settings/data"); await panel(page).getByRole("heading", { name: "回收站与删除" }).waitFor();
    await selectResource(page, data.note.id);
    await panel(page).getByLabel("删除范围", { exact: true }).selectOption("ACCOUNT");
    await panel(page).getByLabel("删除范围", { exact: true }).selectOption("RESOURCE");
    assert.equal(await panel(page).getByLabel("选择本人对象", { exact: true }).inputValue(), "");
    assert.equal(await panel(page).getByRole("button", { name: "预览删除影响", exact: true }).isDisabled(), true);
    await selectResource(page, data.note.id); await verify(page);
    await preview(page, "放入回收站");
    let lost = true; const keys: string[] = []; const tokens: string[] = []; const intentIds: string[] = [];
    await page.route("**/api/system/deletions", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const input = route.request().postDataJSON(); keys.push(input.idempotencyKey); tokens.push(input.receiptToken);
      const response = await route.fetch(); const result = await response.json();
      assert.equal(response.status(), 200); intentIds.push(result.intent.id);
      if (lost) { lost = false; return route.abort(); }
      return route.fulfill({ response });
    });
    await panel(page).getByRole("button", { name: "放入回收站", exact: true }).click();
    await panel(page).getByText(/请求结果尚未确认/).waitFor();
    await panel(page).getByRole("button", { name: "放入回收站", exact: true }).click();
    await panel(page).getByText("已放入回收站，恢复期内可恢复对象。", { exact: true }).waitFor();
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(tokens[0], tokens[1]);
    assert.equal(intentIds.length, 2); assert.equal(intentIds[0], intentIds[1]);
    assert.equal(await client.dataDeletionIntent.count({ where: { requesterId: data.user.id, idempotencyKey: keys[0] } }), 1);
    const intentId = intentIds[0];
    await page.unroute("**/api/system/deletions");
    assert.equal((await browserApi(page, "/api/notes/" + data.note.id)).status, 404, "trashed note must be hidden from its owner");
    assert.equal((await browserApi(page, "/api/attachments/" + data.attachment.id)).status, 404, "trashed attachment must be hidden from its owner");
    await verifyCanvasHidden(page, data.workspace.id, data.note.id, data.note.title);
    const stranger = await contextFor(browser, pool, errors); const strangerPage = await stranger.newPage();
    await login(strangerPage, other.user.email);
    assert.equal((await browserApi(strangerPage, "/api/auth/reauthenticate", "POST", { password })).status, 200);
    const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: intentId } });
    assert.equal((await browserApi(strangerPage, "/api/system/deletions/" + intentId, "PATCH", { action: "restore", expectedRevision: row.revision })).status, 404, "stranger cannot restore another owner's intent");
    assert.equal((await browserApi(strangerPage, "/api/system/deletions/preview", "POST", { scope: "WORKSPACE", workspaceId: data.workspace.id })).status, 404, "stranger cannot preview another workspace");
    await stranger.close();
    await captureViews(page, "trash");
    await page.locator('[data-deletion-id="' + intentId + '"]').getByRole("button", { name: "恢复对象", exact: true }).click();
    await panel(page).getByText("对象已恢复。", { exact: true }).waitFor();
    assert.equal((await browserApi(page, "/api/notes/" + data.note.id)).status, 200);
    assert.equal((await browserApi(page, "/api/knowledge-canvas?workspaceId=" + data.workspace.id + "&focus=NOTE:" + data.note.id + "&depth=0")).status, 200);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await testFailedRefresh(page, data.workspace.id, data.note.id);
    await panel(page).getByLabel("删除范围", { exact: true }).selectOption("WORKSPACE");
    await panel(page).getByLabel("对象所在工作区", { exact: true }).selectOption(data.workspace.id);
    await verify(page); await preview(page, "删除此工作区");
    const pendingResponse = page.waitForResponse(response => response.url().endsWith("/api/system/deletions") && response.request().method() === "POST");
    await panel(page).getByRole("button", { name: "删除此工作区", exact: true }).click();
    const pending = (await (await pendingResponse).json()).intent;
    await page.locator('[data-deletion-id="' + pending.id + '"]').getByRole("button", { name: "取消删除", exact: true }).waitFor();
    await capturePage(page, "desktop-cooldown.png");
    await page.locator('[data-deletion-id="' + pending.id + '"]').getByRole("button", { name: "取消删除", exact: true }).click();
    await panel(page).getByText("删除已取消。", { exact: true }).waitFor();
    await context.close();
    const account = await seedDeletionCase(client, fixture, passwordHash);
    const accountContext = await contextFor(browser, pool, errors); const accountPage = await accountContext.newPage();
    await login(accountPage, account.user.email); await accountPage.goto("/settings/data");
    await panel(accountPage).getByLabel("删除范围", { exact: true }).selectOption("ACCOUNT");
    await verify(accountPage); await preview(accountPage, "删除我的账户");
    const accountResponse = accountPage.waitForResponse(response => response.url().endsWith("/api/system/deletions") && response.request().method() === "POST");
    await panel(accountPage).getByRole("button", { name: "删除我的账户", exact: true }).click();
    const accountIntent = (await (await accountResponse).json()).intent;
    await makeDeletionEligible(client, accountIntent.id);
    process.env.DATA_DELETE_ENABLED = "true"; process.env.DATA_LIFECYCLE_ENABLED = "true";
    const lease = await claimDatabaseDeletion(client, "browser-delete", accountIntent.id); assert.ok(lease);
    assert.equal((await executeDatabaseDeletion(client, lease, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") })).state, "SUCCEEDED");
    await panel(accountPage).getByRole("button", { name: "刷新删除状态", exact: true }).click();
    await accountPage.locator('[data-deletion-id="' + accountIntent.id + '"]').getByText("已完成删除", { exact: true }).waitFor();
    await capturePage(accountPage, "desktop-complete.png");
    assert.equal((await browserApi(accountPage, "/api/system/deletions")).status, 401, "deleted account session must no longer authenticate in the browser");
    await accountContext.close();
    assert.deepEqual(errors, []);
    assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash());
    await writeFile(path.join(output, "evidence.json"), JSON.stringify({ scope: "DATA-DELETE synthetic browser/API", checkedAt: new Date().toISOString(),
      pool, viewports: ["1440x1000", "390x844", "320x844"], passed: ["unauthenticated-rejected", "scope-reset", "reauth", "preview-confirm", "lost-response-idempotency", "trash-hide-restore",
        "cross-user", "canvas-frozen-projection", "failed-refresh-retains-controls", "cooldown-cancel", "account-erasure-receipt", "keyboard-targets"], pageErrors: errors, productionTouched: false }, null, 2) + "\n");
    console.log("PASS DELETE browser/API: desktop, 390px, 320px; scoped confirmation, recovery, real account deletion and receipt");
  } finally { await browser.close(); await client.$disconnect(); }
}

function requireDeletePool(root: string, databaseUrl: string): Pool {
  const fixture = loadDevTestDeleteFixture(process.cwd(), { AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT: root, AREAFORGE_DATA_DELETE_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl });
  const result = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const pool = result.latest as Pool; assert.ok(pool && fixture); assert.equal(pool.fixtureId, fixture.id);
  assert.equal(pool.status, "running"); assert.equal(pool.url, "http://127.0.0.1:" + pool.port);
  assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash()); return pool;
}
async function contextFor(browser: Browser, pool: Pool, errors: string[]): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: pool.url, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", extraHTTPHeaders: { Origin: pool.url } });
  context.on("page", page => page.on("pageerror", error => errors.push(error.name)));
  await context.route("**/*", route => { const url = new URL(route.request().url()); return url.origin === pool.url || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort(); });
  return context;
}
async function login(page: Page, email: string) {
  await page.goto("/login"); await page.getByLabel("邮箱", { exact: true }).fill(email); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并继续学习", exact: true }).click(); await page.waitForURL(url => url.pathname !== "/login");
}
async function browserApi(page: Page, url: string, method: "GET" | "POST" | "PATCH" = "GET", body?: Record<string, unknown>) {
  // Playwright 的独立 HTTP 客户端不发送 loopback IP 上的 Secure cookie；探针复用真实浏览器会话，不降低生产 Cookie 安全。
  return page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: "same-origin",
      ...(input.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url, method, body });
}
async function selectResource(page: Page, id: string) {
  await panel(page).getByRole("button", { name: "加载本人对象", exact: true }).click();
  await panel(page).locator('option[value="' + id + '"]').waitFor({ state: "attached" });
  await panel(page).getByLabel("选择本人对象", { exact: true }).selectOption(id);
}
async function verifyCanvasHidden(page: Page, workspaceId: string, id: string, title: string) {
  const base = "/api/knowledge-canvas?workspaceId=" + workspaceId;
  assert.equal((await browserApi(page, base + "&focus=NOTE:" + id + "&depth=0")).status, 404);
  const result = await browserApi(page, base + "&entityType=NOTE&q=" + encodeURIComponent(title));
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.body.canvas.nodes).includes(id), false);
  assert.equal(JSON.stringify(result.body.canvas.list).includes(title), false);
  assert.equal(JSON.stringify(result.body.canvas.edges).includes("NOTE:" + id), false);
}
async function verify(page: Page) {
  await panel(page).getByLabel("删除操作的当前密码", { exact: true }).fill(password);
  await panel(page).getByRole("button", { name: "验证身份", exact: true }).click();
  await panel(page).getByText("身份已重新验证，可以继续核对范围。", { exact: true }).waitFor();
}
async function preview(page: Page, phrase: string) {
  await panel(page).getByRole("button", { name: "预览删除影响", exact: true }).click();
  await panel(page).getByLabel("删除影响预览", { exact: true }).waitFor();
  await panel(page).getByLabel("输入“" + phrase + "”以确认", { exact: true }).fill(phrase);
}
async function captureViews(page: Page, suffix: string) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await panel(page).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const targets = await panel(page).getByRole("button").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    assert.ok(targets.every(height => height >= 44));
    await verifyKeyboardRefresh(page);
    await capturePage(page, (width === 1440 ? "desktop" : "mobile-" + width) + "-" + suffix + ".png");
  }
}
async function verifyKeyboardRefresh(page: Page) {
  const refresh = panel(page).getByRole("button", { name: "刷新删除状态", exact: true });
  await refresh.focus(); await page.keyboard.press("Tab");
  const restore = panel(page).getByRole("button", { name: "恢复对象", exact: true }).first();
  assert.equal(await restore.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await refresh.evaluate(element => element === document.activeElement), true);
  const response = page.waitForResponse(result => result.url().endsWith("/api/system/deletions") && result.request().method() === "GET");
  await page.keyboard.press("Enter"); assert.equal((await response).status(), 200);
}
async function capturePage(page: Page, filename: string) {
  await panel(page).getByRole("button", { name: "刷新删除状态", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, filename.replace(/\.png$/, "-controls.png")), animations: "disabled" });
  // 应用在独立 main 中滚动；分别记录控制区与范围表单，不能用被固定头部遮挡的长 locator 截图。
  await panel(page).evaluate(element => {
    const container = element.closest<HTMLElement>(".af-shell-main");
    if (!container) throw new Error("DATA_DELETE_SCROLL_CONTAINER_MISSING");
    container.scrollTo({ top: container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - 12, behavior: "instant" });
  });
  await page.screenshot({ path: path.join(output, filename), animations: "disabled" });
}
async function testFailedRefresh(page: Page, workspaceId: string, noteId: string) {
  const response = await browserApi(page, "/api/system/deletions/preview", "POST", { scope: "RESOURCE", workspaceId, resourceType: "Note", resourceId: noteId });
  const current = response.body.preview; assert.equal(response.status, 200);
  const request = await browserApi(page, "/api/system/deletions", "POST", { scope: "RESOURCE", workspaceId, resourceType: "Note", resourceId: noteId,
    fingerprint: current.fingerprint, confirmation: "放入回收站", idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") });
  const intent = request.body.intent; assert.equal(request.status, 200);
  await page.reload(); await page.locator('[data-deletion-id="' + intent.id + '"]').waitFor();
  const before = await panel(page).locator("[data-deletion-id]").count();
  await page.route("**/api/system/deletions", route => route.request().method() === "GET"
    ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"INTERNAL_ERROR"}' }) : route.continue());
  await panel(page).getByRole("button", { name: "刷新删除状态", exact: true }).click();
  await panel(page).getByText(/上次完整状态/).waitFor();
  assert.equal(await panel(page).locator("[data-deletion-id]").count(), before);
  assert.equal(await page.locator('[data-deletion-id="' + intent.id + '"]').getByRole("button", { name: "恢复对象", exact: true }).isEnabled(), true);
  await capturePage(page, "desktop-recovery.png");
  await page.unroute("**/api/system/deletions");
  await page.locator('[data-deletion-id="' + intent.id + '"]').getByRole("button", { name: "恢复对象", exact: true }).click();
  await panel(page).getByText("对象已恢复。", { exact: true }).waitFor();
}

main().catch(error => { console.error(error instanceof Error ? error.message.replaceAll(password, "[REDACTED]") : "DATA_DELETE_BROWSER_FAILED"); process.exitCode = 1; });
