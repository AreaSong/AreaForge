import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { dynamicSearch, loginSearch, openSearchSettings, refreshSearch, searchBrowserOutput, type SearchPool } from "./search-index-browser-support";

export async function searchNativeZoom(input: { pool: SearchPool; workspaceId: string; executablePath: string; credentials: { email: string; password: string } }) {
  const profile = await mkdtemp(path.join(tmpdir(), "areaforge-search-zoom-"));
  const context = await chromium.launchPersistentContext(profile, { headless: false, executablePath: input.executablePath, viewport: null,
    args: ["--window-size=1440,1000", "--no-first-run", "--no-default-browser-check"], reducedMotion: "reduce", baseURL: input.pool.url,
    extraHTTPHeaders: { Origin: input.pool.url } });
  let stage = "launch";
  try {
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin === input.pool.url || ["chrome:", "data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    // 使用独立合成登录，不保存 storage-state 文件或修改用户浏览器配置。
    const page = await context.newPage(); stage = "baseline-setting"; await setZoom(context, "1");
    stage = "login"; await loginSearch(page, input.credentials.email, input.credentials.password); await openSearchSettings(page, input.workspaceId);
    const baseline = await metrics(page); stage = "zoom-setting"; const selectedValue = await setZoom(context, "1.25");
    await page.reload(); await page.locator("main").first().waitFor();
    stage = "native-metrics";
    await page.waitForFunction(previous => window.innerWidth < previous.innerWidth && window.devicePixelRatio > previous.devicePixelRatio, baseline);
    const zoomed = await metrics(page); assert.equal(selectedValue, "1.25");
    assert.ok(Math.abs(zoomed.devicePixelRatio / baseline.devicePixelRatio - 1.25) < 0.01);
    await page.getByLabel("索引工作区", { exact: true }).selectOption(input.workspaceId); await refreshSearch(page, input.workspaceId);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole("heading", { name: "我的搜索索引", exact: true }).scrollIntoViewIfNeeded();
    // 原生缩放下使用实际视口截图，避免 element clip 的 CSS/device-pixel 换算裁掉控件。
    await page.screenshot({ path: path.join(searchBrowserOutput, "native-125-index.png") });
    stage = "zoom-search"; const result = await dynamicSearch(page, "SEARCH 本人资料"); assert.equal(result.status, 200);
    await page.getByRole("option").first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(searchBrowserOutput, "native-125-search.png") });
    return { requested: "125%", mechanism: "Chrome default zoom in temporary profile", selectedValue, baseline, zoomed, passed: true };
  } catch (error) { console.error(`SEARCH_NATIVE_ZOOM_STAGE:${stage}`); throw error; }
  finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}

async function setZoom(context: BrowserContext, value: string) {
  const settings = await context.newPage();
  try {
    await settings.goto("chrome://settings/appearance", { waitUntil: "domcontentloaded" });
    const select = settings.locator("select#zoomLevel"); await select.waitFor(); await select.selectOption(value); return await select.inputValue();
  } finally { await settings.close(); }
}

function metrics(page: Page) { return page.evaluate(() => ({ innerWidth: window.innerWidth, devicePixelRatio: window.devicePixelRatio })); }
