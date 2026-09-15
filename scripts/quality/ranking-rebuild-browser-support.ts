import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { loadDevTestRankingFixture } from "../dev/dev-test-ranking-fixture";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import type { RankingRebuildFixture } from "./ranking-rebuild-fixture";

export const rankingBrowserOutput = path.resolve("output/playwright/ranking-rebuild");
export interface RankingPool { slot: number; port: number; url: string; status: string; fixtureId: string; sourceFingerprint: string; buildId: string }
export function rankingPanel(page: Page, challengeId: string) { return page.locator(`[data-ranking-challenge-id="${challengeId}"]`); }
export function rankingJobRow(page: Page, jobId: string) { return page.locator(`[data-ranking-job-id="${jobId}"]`); }

export function requireRankingPool(fixture: RankingRebuildFixture, databaseUrl: string): RankingPool {
  const expected = loadDevTestRankingFixture(process.cwd(), { AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT: fixture.root,
    AREAFORGE_RANKING_REBUILD_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl });
  const result = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const pool = result.latest as RankingPool;
  assert.ok(pool && expected); assert.equal(pool.slot, 3); assert.equal(pool.status, "running");
  assert.equal(pool.fixtureId, expected.id); assert.equal(pool.url, `http://127.0.0.1:${pool.port}`);
  assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash()); return pool;
}

export async function rankingBrowserContext(browser: Browser, pool: RankingPool, errors: string[]): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: pool.url, viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce", extraHTTPHeaders: { Origin: pool.url } });
  context.on("page", page => page.on("pageerror", error => errors.push(error.name)));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === pool.url || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  return context;
}

export async function loginRanking(page: Page, email: string, password: string) {
  await page.goto("/login"); await page.getByLabel("邮箱", { exact: true }).fill(email); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并继续学习", exact: true }).click();
  await page.waitForURL(url => url.pathname !== "/login");
}

export async function rankingBrowserApi(page: Page, url: string, method = "GET", body?: unknown) {
  return page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: "same-origin",
      ...(input.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url, method, body });
}

export async function refreshRanking(page: Page, challengeId: string, owner = true) {
  const suffix = owner ? `/challenges/${challengeId}/rebuilds` : `/challenges/${challengeId}/projection`;
  const response = page.waitForResponse(item => item.url().endsWith(suffix) && item.request().method() === "GET");
  await rankingPanel(page, challengeId).getByRole("button", { name: "刷新排名", exact: true }).click(); await response;
}

export async function requestRankingFromUi(page: Page, challengeId: string): Promise<string> {
  const response = page.waitForResponse(item => item.url().endsWith(`/challenges/${challengeId}/projection`) && item.request().method() === "POST");
  await rankingPanel(page, challengeId).getByRole("button", { name: "申请重建排名", exact: true }).click();
  const result = await response; assert.equal(result.status(), 202); const body = await result.json();
  await rankingJobRow(page, body.job.id).waitFor(); return body.job.id;
}

export async function captureRankingViews(page: Page, challengeId: string) {
  const panel = rankingPanel(page, challengeId);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await panel.getByRole("heading", { name: "持久排名与重建", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const targets = await panel.getByRole("button").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    assert.ok(targets.every(height => height >= 44));
    const history = panel.locator("details"); const summary = history.locator("summary");
    await summary.focus(); await summary.press("Enter");
    await history.locator("[data-ranking-job-id]").first().waitFor();
    assert.equal(await history.evaluate(node => (node as HTMLDetailsElement).open), true);
    await summary.press("Enter");
    assert.equal(await history.evaluate(node => (node as HTMLDetailsElement).open), false);
    const refresh = panel.getByRole("button", { name: "刷新排名", exact: true }); await refresh.focus();
    assert.equal(await refresh.evaluate(node => node === document.activeElement), true);
    const refreshed = page.waitForResponse(response => response.url().endsWith(`/challenges/${challengeId}/projection`) && response.request().method() === "GET");
    await refresh.press("Enter"); await refreshed;
    await panel.locator("[data-ranking-participant-id]").nth(1).waitFor();
    await panel.screenshot({ path: path.join(rankingBrowserOutput, `${width === 1440 ? "desktop" : `mobile-${width}`}-ranking.png`) });
  }
}
