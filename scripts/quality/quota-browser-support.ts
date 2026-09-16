import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright-core";
import { loadDevTestQuotaFixture } from "../dev/dev-test-quota-fixture";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import type { QuotaFixture } from "./quota-fixture";

export const quotaBrowserOutput = path.resolve("output/playwright/quota");
export interface QuotaPool { slot: number; port: number; url: string; status: string; fixtureId: string; sourceFingerprint: string; buildId: string }
export function quotaExportPanel(page: Page) { return page.getByRole("heading", { name: "创建数据任务", exact: true }).locator("xpath=../../.."); }
export function quotaSearchPanel(page: Page, workspaceId: string) { return page.locator(`[data-search-index-workspace="${workspaceId}"]`); }
export function quotaRankingPanel(page: Page, challengeId: string) { return page.locator(`[data-ranking-challenge-id="${challengeId}"]`); }

export function requireQuotaPool(fixture: QuotaFixture, databaseUrl: string): QuotaPool {
  const expected = loadDevTestQuotaFixture(process.cwd(), { AREAFORGE_DEV_TEST_QUOTA_FIXTURE_ROOT: fixture.root,
    AREAFORGE_DATA_JOB_QUOTA_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl });
  const result = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const pool = result.latest as QuotaPool;
  assert.ok(pool && expected); assert.equal(pool.slot, 3); assert.equal(pool.status, "running");
  assert.equal(pool.fixtureId, expected.id); assert.equal(pool.url, `http://127.0.0.1:${pool.port}`);
  assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash()); return pool;
}

export async function quotaBrowserContext(browser: Browser, pool: QuotaPool, errors: string[]) {
  const context = await browser.newContext({ baseURL: pool.url, viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce", extraHTTPHeaders: { Origin: pool.url } });
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.name));
    page.on("dialog", dialog => dialog.type() === "confirm" && dialog.message() === "确认取消此任务？运行中的任务将先收到取消请求。"
      ? dialog.accept() : dialog.dismiss());
  });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === pool.url || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  return context;
}

export async function quotaLogin(page: Page, email: string, password: string) {
  await page.goto("/login"); await page.getByLabel("邮箱", { exact: true }).fill(email); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并继续学习", exact: true }).click(); await page.waitForURL(url => url.pathname !== "/login");
}

export async function quotaApi(page: Page, url: string, method = "GET", body?: unknown) {
  return page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: "same-origin",
      ...(input.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url, method, body });
}

export async function quotaButtonRequest(page: Page, button: Locator, routePath: string, expectedStatus: number, method = "POST") {
  const response = page.waitForResponse(item => new URL(item.url()).pathname === routePath && item.request().method() === method);
  await button.click(); const result = await response; assert.equal(result.status(), expectedStatus);
  return result.json();
}

export async function quotaExportPreview(page: Page, workspaceId: string) {
  const panel = quotaExportPanel(page);
  await panel.getByLabel("范围", { exact: true }).selectOption("WORKSPACE");
  await panel.getByLabel("工作区", { exact: true }).selectOption(workspaceId);
  await quotaButtonRequest(page, panel.getByRole("button", { name: "生成范围预览", exact: true }), "/api/system/data-jobs/preview", 200);
}

export async function quotaCaptureViews(page: Page, panel: Locator, label: string, message: RegExp, buttonName: string) {
  const screenshots: string[] = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const notice = panel.locator('[role="alert"],[role="status"]').filter({ hasText: message }).first(); await notice.waitFor();
    const button = panel.getByRole("button", { name: buttonName, exact: true }); await button.focus();
    await notice.scrollIntoViewIfNeeded();
    assert.equal(await button.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    for (const target of [button, notice]) assert.equal(await target.evaluate(node => {
      const box = node.getBoundingClientRect(); const x = box.x + box.width / 2;
      return box.x >= 0 && box.right <= innerWidth + 1 && box.y >= 0 && box.bottom <= innerHeight
        && [box.y + 3, box.bottom - 3].every(y => { const hit = document.elementFromPoint(x, y); return hit !== null && node.contains(hit); });
    }), true, "QUOTA_FEEDBACK_AND_RECOVERY_MUST_BE_VISIBLE");
    const name = `${width}-${label}.png`; await page.screenshot({ path: path.join(quotaBrowserOutput, name) }); screenshots.push(name);
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); return screenshots;
}
