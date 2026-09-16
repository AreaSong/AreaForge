import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright-core";
import type { PrismaClient } from "../../packages/db/src/index";
import { loadDevTestCapacityFixture } from "../dev/dev-test-capacity-fixture";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import type { CapacityFixture } from "./capacity-fixture";
import { quotaBrowserContext, quotaLogin, quotaApi, quotaButtonRequest, quotaExportPanel, quotaSearchPanel,
  quotaRankingPanel, quotaExportPreview, type QuotaPool } from "./quota-browser-support";

export { quotaApi as capacityApi, quotaButtonRequest as capacityButtonRequest, quotaExportPanel as capacityExportPanel,
  quotaSearchPanel as capacitySearchPanel, quotaRankingPanel as capacityRankingPanel, quotaExportPreview as capacityExportPreview };
export const capacityBrowserOutput = path.resolve("output/playwright/capacity");
export type CapacityPool = QuotaPool;
export interface CapacityBrowserHarness {
  browser: Browser; pool: CapacityPool; fixture: CapacityFixture; client: PrismaClient; password: string; passwordHash: string;
  errors: string[]; screenshots: string[]; check: (name: string, run: () => Promise<void>) => Promise<void>;
  diagnostic: (page: Page) => void;
}

export function requireCapacityPool(fixture: CapacityFixture, databaseUrl: string): CapacityPool {
  const expected = loadDevTestCapacityFixture(process.cwd(), { AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT: fixture.root,
    AREAFORGE_CAPACITY_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl });
  const result = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const pool = result.latest as CapacityPool;
  assert.ok(pool && expected); assert.equal(pool.slot, 3); assert.equal(pool.status, "running");
  assert.equal(pool.fixtureId, expected.id); assert.equal(pool.url, `http://127.0.0.1:${pool.port}`);
  assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash()); return pool;
}

export async function capacityPage(harness: CapacityBrowserHarness, email?: string) {
  const context = await quotaBrowserContext(harness.browser, harness.pool, harness.errors);
  const page = await context.newPage(); harness.diagnostic(page);
  if (email) {
    await quotaLogin(page, email, harness.password);
    assert.equal((await quotaApi(page, "/api/auth/reauthenticate", "POST", { password: harness.password })).status, 200);
  }
  return { context, page };
}

export async function capacityCaptureViews(page: Page, panel: Locator, label: string, message: RegExp, buttonName: string,
  focus: "button" | "notice" = "button") {
  const screenshots: string[] = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const notice = panel.locator('[role="alert"],[role="status"]').filter({ hasText: message }).first(); await notice.waitFor();
    const button = panel.getByRole("button", { name: buttonName, exact: true });
    if (focus === "button") await button.focus();
    await notice.scrollIntoViewIfNeeded();
    assert.equal(await (focus === "button" ? button : notice).evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.ok((await button.boundingBox())!.height >= 44);
    for (const target of [button, notice]) assert.equal(await target.evaluate(node => {
      const box = node.getBoundingClientRect(); const x = box.x + box.width / 2;
      return box.x >= 0 && box.right <= innerWidth + 1 && box.y >= 0 && box.bottom <= innerHeight
        && [box.y + 3, box.bottom - 3].every(y => { const hit = document.elementFromPoint(x, y); return hit !== null && node.contains(hit); });
    }), true, "CAPACITY_FEEDBACK_AND_RECOVERY_MUST_BE_VISIBLE");
    const name = `${width}-${label}.png`; await page.screenshot({ path: path.join(capacityBrowserOutput, name) }); screenshots.push(name);
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); return screenshots;
}
