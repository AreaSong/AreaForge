import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { prisma } from "../../packages/db/src/index";
import { loadDevTestExportFixture } from "../dev/dev-test-export-fixture";
import { createDataExportHandler } from "../workers/data-export-handler";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { executeFixtureExport } from "./data-export-runtime-actions";
import { requireDataExportFixture, seedDataExportFixture, type ExportFixture } from "./data-export-runtime-fixture";
import { verifyExportBrowserApi, verifyExportBrowserRecovery } from "./data-export-browser-checks";

type PoolIdentity = { slot: number; port: number; url: string; container: string; status: string; sourceFingerprint: string; fixtureId: string; buildId: string };
const output = path.resolve("output/playwright/data-export");

async function main() {
  const environment = await requireDataExportFixture();
  const pool = await requireCurrentExportPool(environment.base);
  const fixture = await seedDataExportFixture();
  await mkdir(output, { recursive: true });
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ ...(existsSync(chrome) ? { executablePath: chrome } : {}), headless: true });
  try {
    const context = await authorizedContext(browser, pool, fixture.token);
    await context.storageState().then(state => writeFile(path.join(fixture.base, `${fixture.prefix}.browser-auth.json`), JSON.stringify(state), { flag: "wx", mode: 0o600 }));
    const other = await authorizedContext(browser, pool, fixture.otherToken);
    const anonymous = await browser.newContext({ baseURL: pool.url });
    assert.equal((await anonymous.request.get("/api/system/data-jobs")).status(), 401);
    const page = await context.newPage(); const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.name));
    await page.goto(`${pool.url}/settings/data`);
    await page.getByRole("heading", { name: "数据任务中心", exact: true }).waitFor();
    const jobId = await createFromBrowserWithLostResponse(page, fixture);
    await verifyPauseAndProgress(page, fixture, jobId);
    await verifyBrowserDownload(page, fixture, jobId);
    await verifyExportBrowserApi({ owner: context, other, fixture, jobId });
    await verifyExportBrowserRecovery({ page, fixture, jobId, output });
    await verifyLoginAndReadonlyPages(browser, pool, fixture);
    assert.equal(pageErrors.length, 0, "browser must not report unexplained page errors");
    const contents = await page.content();
    for (const secret of [fixture.token, fixture.otherToken, fixture.secrets.sessionSecret, fixture.secrets.actionSecret]) assert.equal(contents.includes(secret), false);
    assert.deepEqual(await readFile(fixture.sourcePath), fixture.fileBytes);
    assert.equal(computeProductExperienceSourceHash(), pool.sourceFingerprint, "source must remain unchanged during browser acceptance");
    console.log(JSON.stringify({ result: "PASS", evidenceClass: "local-browser-and-api", pool: { slot: pool.slot, port: pool.port, url: pool.url, sourceFingerprint: pool.sourceFingerprint, buildId: pool.buildId },
      viewports: ["1440x1000", "390x844", "320x844"], checks: ["anonymous-and-cross-user", "lost-response-idempotency", "pause-resume", "live-progress", "verified-zip-download", "grant-concurrency-and-revocation", "refresh-failure", "file-failure-recovery", "legacy-download-rejection", "keyboard-and-narrow-layout", "login-and-learning-readonly-pages"],
      productionTouched: false, sharedDatabaseTouched: false, sourceFilesUnchanged: true, externalProviderCalled: false }));
  } finally { await browser.close(); }
}

async function requireCurrentExportPool(base: string): Promise<PoolIdentity> {
  const fixture = loadDevTestExportFixture(process.cwd(), { AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT: base,
    AREAFORGE_DATA_EXPORT_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: process.env.DATABASE_URL });
  assert.ok(fixture);
  const result = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) as { latest: PoolIdentity | null };
  const latest = result.latest; assert.ok(latest);
  assert.equal(latest.fixtureId, fixture.id); assert.equal(latest.status, "running");
  assert.equal(latest.container, `areaforge-dev-test-${latest.slot}`);
  assert.equal(latest.url, `http://127.0.0.1:${latest.port}`);
  assert.equal(latest.sourceFingerprint, computeProductExperienceSourceHash());
  const response = await fetch(`${latest.url}/api/health`); assert.equal(response.status, 200);
  const health = await response.json() as { runtimeIdentity: { productExperienceSourceHash: string; buildId: string } };
  assert.equal(health.runtimeIdentity.productExperienceSourceHash, latest.sourceFingerprint);
  assert.equal(health.runtimeIdentity.buildId, latest.buildId);
  return latest;
}

async function authorizedContext(browser: Browser, pool: PoolIdentity, token: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: pool.url, viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: "reduce", extraHTTPHeaders: { Origin: pool.url } });
  await context.addCookies([{ name: `af_dev_test_${pool.slot}`, value: token, url: pool.url, httpOnly: true, sameSite: "Lax" }]);
  await context.route("**/*", route => {
    const request = new URL(route.request().url());
    return request.origin === pool.url || ["data:", "blob:"].includes(request.protocol) ? route.continue() : route.abort();
  });
  return context;
}

async function createFromBrowserWithLostResponse(page: Page, fixture: ExportFixture): Promise<string> {
  const center = page.locator('section[aria-labelledby="data-job-center-title"]');
  await center.getByRole("button", { name: "生成范围预览", exact: true }).click();
  await center.getByRole("heading", { name: "导出范围预览", exact: true }).waitFor();
  assert.equal((await center.textContent())!.includes("OWN_NOTE_BODY"), false);
  let lost = false; let jobId = "";
  await page.route("**/api/system/data-jobs", async route => {
    if (route.request().method() !== "POST" || lost) return route.fallback();
    lost = true;
    const response = await route.fetch(); assert.equal(response.status(), 202);
    jobId = (await response.json() as { job: { id: string } }).job.id;
    await route.abort("failed");
  });
  await center.getByRole("button", { name: "创建导出任务", exact: true }).click();
  await center.getByRole("alert").filter({ hasText: "网络响应未确认" }).waitFor();
  assert.ok(jobId);
  await center.getByRole("button", { name: "创建导出任务", exact: true }).click();
  await page.locator(`[data-job-id="${jobId}"]`).waitFor();
  assert.equal(await prisma.dataJob.count({ where: { requestedByUserId: fixture.actor.id } }), 1);
  await page.unroute("**/api/system/data-jobs");
  return jobId;
}

async function verifyPauseAndProgress(page: Page, fixture: ExportFixture, jobId: string) {
  const row = page.locator(`[data-job-id="${jobId}"]`);
  await row.getByRole("button", { name: "暂停", exact: true }).click(); await row.getByText("已暂停", { exact: true }).waitFor();
  await row.getByRole("button", { name: "恢复", exact: true }).click(); await row.getByText("排队中", { exact: true }).waitFor();
  let release!: () => void; let reached!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const handler = createDataExportHandler(prisma);
  const execution = executeFixtureExport(fixture, jobId, { kind: "EXPORT", prepare: context => handler.prepare({ ...context,
    heartbeat: async progress => { await context.heartbeat(progress); if (progress === 0.25) { reached(); await hold; } } }) });
  try {
    await Promise.race([ready, execution.then(() => { throw new Error("EXPORT_BROWSER_PROGRESS_POINT_NOT_REACHED"); })]);
    await page.getByRole("button", { name: "刷新任务", exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`[data-job-id="${id}"] progress`)?.getAttribute("value") === "25", jobId);
    await page.screenshot({ path: path.join(output, "desktop-progress.png"), fullPage: true });
  } finally { release(); assert.equal((await execution).result, "SUCCEEDED"); }
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
  await row.getByRole("button", { name: "下载 ZIP", exact: true }).waitFor();
  assert.equal(await row.getByRole("progressbar").getAttribute("value"), "100");
}

async function verifyBrowserDownload(page: Page, fixture: ExportFixture, jobId: string) {
  const row = page.locator(`[data-job-id="${jobId}"]`);
  const pending = page.waitForEvent("download");
  await row.getByRole("button", { name: "下载 ZIP", exact: true }).click();
  const download = await pending; assert.match(download.suggestedFilename(), /^areaforge-account-[A-Za-z0-9_-]+\.zip$/);
  const destination = path.join(fixture.base, `${jobId}.browser.zip`); await download.saveAs(destination); await chmod(destination, 0o600);
  execFileSync("unzip", ["-t", destination], { stdio: "pipe" });
  const bytes = await readFile(destination); const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId } });
  assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, pkg.archiveSha256);
  const manifest = execFileSync("unzip", ["-p", destination, "manifest.json"]);
  assert.equal(`sha256:${createHash("sha256").update(manifest).digest("hex")}`, pkg.manifestSha256);
  assert.equal(JSON.parse(manifest.toString()).scope, "ACCOUNT");
  await page.getByRole("status").filter({ hasText: "文件已交给浏览器保存" }).waitFor();
  await page.screenshot({ path: path.join(output, "desktop-success.png"), fullPage: true });
}

async function verifyLoginAndReadonlyPages(browser: Browser, pool: PoolIdentity, fixture: ExportFixture) {
  const context = await browser.newContext({ baseURL: pool.url });
  try {
    const page = await context.newPage(); await page.goto("/login");
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill(fixture.owner.email);
    await page.getByRole("textbox", { name: "密码", exact: true }).fill(fixture.password);
    const response = page.waitForResponse(value => value.url().endsWith("/api/auth/login") && value.request().method() === "POST");
    await page.getByRole("button", { name: "登录并继续学习", exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.waitForURL(value => value.pathname !== "/login");
    for (const route of ["/today", "/focus", "/settings/notifications"]) {
      const result = await page.goto(route); assert.equal(result?.status(), 200);
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal((await page.locator("body").innerText()).includes("Application error"), false);
    }
  } finally { await context.close(); }
}

main().catch(error => { console.error(error instanceof Error ? `${error.name}: ${error.message}` : "DATA_EXPORT_BROWSER_FAILED"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
