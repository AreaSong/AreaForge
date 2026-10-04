import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { loadDevTestSearchFixture } from "../dev/dev-test-search-fixture";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import type { SearchIndexFixture } from "./search-index-fixture";

export const searchBrowserOutput = path.resolve("output/playwright/search-index");
export const searchBrowserViewports = [
  { label: "desktop", width: 1440, height: 1000, query: "本人", zoom: 1 },
  { label: "mobile-390", width: 390, height: 844, query: "他人笔记", zoom: 1 },
  { label: "mobile-320", width: 320, height: 844, query: "他人错题", zoom: 1 },
  { label: "tablet-768", width: 768, height: 1024, query: "本人任务", zoom: 1 },
  { label: "tablet-820", width: 820, height: 1180, query: "本人更新", zoom: 1 },
  { label: "landscape-1024", width: 1024, height: 768, query: "本人知识", zoom: 1 },
  { label: "desktop-1280", width: 1280, height: 800, query: "合成科目", zoom: 1 },
  { label: "desktop-125pct", width: 1440, height: 1000, query: "本人资料", zoom: 1.25 },
] as const;
export interface SearchPool { slot: number; port: number; url: string; status: string; fixtureId: string; sourceFingerprint: string; buildId: string }
export function searchPanel(page: Page, workspaceId: string) { return page.locator(`[data-search-index-workspace="${workspaceId}"]`); }
export function searchJobRow(page: Page, id: string) { return page.locator(`[data-search-index-job="${id}"]`); }

export function requireSearchPool(fixture: SearchIndexFixture, databaseUrl: string): SearchPool {
  const expected = loadDevTestSearchFixture(process.cwd(), { AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT: fixture.root,
    AREAFORGE_SEARCH_INDEX_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl });
  const result = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const pool = result.latest as SearchPool;
  assert.ok(pool && expected); assert.equal(pool.slot, 3); assert.equal(pool.status, "running");
  assert.equal(pool.fixtureId, expected.id); assert.equal(pool.url, `http://127.0.0.1:${pool.port}`);
  assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash()); return pool;
}

export async function searchBrowserContext(browser: Browser, pool: SearchPool, errors: string[]): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: pool.url, viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce", extraHTTPHeaders: { Origin: pool.url } });
  context.on("page", page => page.on("pageerror", error => errors.push(error.name)));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === pool.url || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  return context;
}

export async function loginSearch(page: Page, email: string, password: string) {
  await page.goto("/login"); await page.getByLabel("邮箱", { exact: true }).fill(email); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并继续学习", exact: true }).click(); await page.waitForURL(url => url.pathname !== "/login");
}

export async function openSearchSettings(page: Page, workspaceId: string) {
  await page.goto("/settings/data"); await page.getByLabel("索引工作区", { exact: true }).selectOption(workspaceId);
  await searchPanel(page, workspaceId).waitFor(); await refreshSearch(page, workspaceId);
}

export async function searchBrowserApi(page: Page, url: string, method = "GET", body?: unknown) {
  return page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: "same-origin",
      ...(input.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url, method, body });
}

export async function refreshSearch(page: Page, workspaceId: string) {
  const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/search/index"
    && new URL(item.url()).searchParams.get("workspaceId") === workspaceId && item.request().method() === "GET");
  await searchPanel(page, workspaceId).getByRole("button", { name: "刷新索引状态", exact: true }).click(); await response;
}

export async function requestSearchFromUi(page: Page, workspaceId: string): Promise<string> {
  const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/search/index" && item.request().method() === "POST");
  await searchPanel(page, workspaceId).getByRole("button", { name: "重建我的索引", exact: true }).click();
  const result = await response; assert.equal(result.status(), 202); const body = await result.json();
  await searchJobRow(page, body.job.id).waitFor(); return body.job.id;
}

export async function dynamicSearch(page: Page, query: string) {
  const compact = page.getByRole("button", { name: "打开全局搜索", exact: true });
  if ((page.viewportSize()?.width ?? 1440) < 360 && await compact.isVisible()) await compact.click();
  else await page.keyboard.press("Meta+k");
  const input = page.getByRole("textbox", { name: "全局灵动岛搜索与命令输入框", exact: true });
  const [result] = await Promise.all([
    page.waitForResponse(item => new URL(item.url()).pathname === "/api/search" && new URL(item.url()).searchParams.get("q") === query),
    input.fill(query),
  ]);
  return { status: result.status(), body: await result.json() };
}

export async function captureSearchViews(page: Page, workspaceId: string) {
  await page.keyboard.press("Escape"); const root = page.locator("[data-search-index-root]"); const panel = searchPanel(page, workspaceId);
  for (const viewport of searchBrowserViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, viewport.zoom);
    await root.getByRole("heading", { name: "我的搜索索引", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const heights = await panel.locator("button:visible").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    assert.ok(heights.every(height => height >= 44));
    const history = panel.locator("details"); const summary = history.locator("summary");
    await summary.focus(); await summary.press("Enter"); assert.equal(await history.evaluate(node => (node as HTMLDetailsElement).open), true);
    await summary.press("Enter"); assert.equal(await history.evaluate(node => (node as HTMLDetailsElement).open), false);
    const refresh = panel.getByRole("button", { name: "刷新索引状态", exact: true }); await refresh.focus();
    assert.equal(await refresh.evaluate(node => node === document.activeElement), true);
    await root.screenshot({ path: path.join(searchBrowserOutput, `${viewport.label}-index.png`) });
    const result = await dynamicSearch(page, `SEARCH ${viewport.query}`); assert.equal(result.status, 200);
    await page.getByRole("option").first().waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(searchBrowserOutput, `${viewport.label}-search.png`) });
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
}
