import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { loadQuotaFixture, quotaFixtureEnvironment, assertQuotaFixtureContainer, verifyQuotaFixtureLedger } from "./quota-fixture";
import { quotaSourceFingerprint } from "./quota-source";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { quotaBrowserOutput, requireQuotaPool, quotaBrowserContext, quotaLogin, quotaApi, quotaButtonRequest,
  quotaExportPanel, quotaSearchPanel, quotaRankingPanel, quotaExportPreview, quotaCaptureViews } from "./quota-browser-support";

let current = "fixture"; let diagnosticPage: Page | undefined;
const passed: string[] = []; const screenshots: string[] = [];
async function check(name: string, run: () => Promise<void>) { current = name; await run(); passed.push(name); console.log(`PASS browser ${name}`); }

async function main() {
  const fixture = loadQuotaFixture(process.argv[2] ?? ""); assertQuotaFixtureContainer(fixture);
  const env = quotaFixtureEnvironment(fixture); Object.assign(process.env, env);
  const { hashPassword } = await import("../../packages/auth/src/index");
  const { quotaClient, createQuotaCase } = await import("./quota-runtime-data");
  const { quotaNoDomainEffects } = await import("./quota-runtime-cases");
  const pool = requireQuotaPool(fixture, env.DATABASE_URL!); const client = quotaClient(env.DATABASE_URL!);
  await verifyQuotaFixtureLedger(client, fixture);
  const password = `Synthetic-Quota-${randomUUID()}!`;
  const data = await createQuotaCase(client, fixture, "browser", await hashPassword(password));
  const sourceFingerprint = quotaSourceFingerprint(); const errors: string[] = [];
  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
  await mkdir(quotaBrowserOutput, { recursive: true });
  try {
    const context = await quotaBrowserContext(browser, pool, errors); const page = await context.newPage(); diagnosticPage = page;
    await check("unauthenticated-and-real-login", async () => {
      assert.equal((await context.request.get("/api/system/data-jobs")).status(), 401);
      await quotaLogin(page, data.owner.email, password);
      assert.equal((await quotaApi(page, "/api/auth/reauthenticate", "POST", { password })).status, 200);
      await page.goto("/settings/data");
      await page.getByLabel("排名工作区", { exact: true }).selectOption(data.workspace.id);
      await quotaRankingPanel(page, data.challenge.id).waitFor();
      await page.getByLabel("索引工作区", { exact: true }).selectOption(data.workspace.id);
    });
    const exports: string[] = [];
    const exportRequest = () => quotaApi(page, "/api/system/data-jobs", "POST", { kind: "EXPORT", scope: "WORKSPACE", workspaceId: data.workspace.id, idempotencyKey: randomUUID() });
    await check("two-real-exports-fill-partition-without-consuming", async () => {
      for (let count = 0; count < 2; count++) { const result = await exportRequest(); assert.equal(result.status, 202); exports.push(result.body.job.id); }
      await page.getByRole("button", { name: "刷新任务", exact: true }).click();
      await page.locator(`[data-job-id="${exports[0]}"]`).waitFor();
      await quotaExportPreview(page, data.workspace.id);
    });
    await check("export-active-quota-feedback-desktop-and-narrow", async () => {
      const panel = quotaExportPanel(page);
      const body = await quotaButtonRequest(page, panel.getByRole("button", { name: "创建导出任务", exact: true }), "/api/system/data-jobs", 429);
      assert.deepEqual(body, { error: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
      screenshots.push(...await quotaCaptureViews(page, panel, "export-active", /当前分区的任务名额已满/, "创建导出任务"));
    });
    await check("search-active-quota-feedback-desktop-and-narrow", async () => {
      const panel = quotaSearchPanel(page, data.workspace.id);
      const body = await quotaButtonRequest(page, panel.getByRole("button", { name: "重建我的索引", exact: true }), "/api/search/index", 429);
      assert.deepEqual(body, { error: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
      screenshots.push(...await quotaCaptureViews(page, panel, "search-active", /当前分区的任务名额已满/, "重建我的索引"));
    });
    await check("ranking-active-quota-feedback-desktop-and-narrow", async () => {
      const panel = quotaRankingPanel(page, data.challenge.id);
      const body = await quotaButtonRequest(page, panel.getByRole("button", { name: "申请重建排名", exact: true }), `/api/ranking/challenges/${data.challenge.id}/projection`, 429);
      assert.deepEqual(body, { error: "DATA_JOB_QUOTA_ACTIVE_LIMIT" });
      screenshots.push(...await quotaCaptureViews(page, panel, "ranking-active", /当前分区的任务名额已满/, "申请重建排名"));
    });
    await check("learning-write-and-search-read-remain-available", async () => {
      const task = await quotaApi(page, "/api/tasks", "POST", { idempotencyKey: randomUUID(), subjectId: data.subject.id, title: "QUOTA 不限制学习任务", type: "study", estimatedMinutes: 30 });
      if (task.status !== 201) console.error(JSON.stringify({ event: "QUOTA_LEARNING_RESPONSE", status: task.status,
        code: /^[A-Z0-9_]{1,80}$/.test(task.body?.error ?? "") ? task.body.error : undefined, fields: Object.keys(task.body?.details?.fieldErrors ?? {}) }));
      assert.equal(task.status, 201);
      const search = await quotaApi(page, `/api/search?workspaceId=${data.workspace.id}&q=QUOTA`);
      assert.equal(search.status, 200); assert.equal(search.body.search.indexed, false);
      const found = search.body.search.results.some((row: { id: string }) => row.id === task.body.task.id);
      if (!found) console.error(JSON.stringify({ event: "QUOTA_LEARNING_SEARCH", status: search.status, hasTaskId: !!task.body?.task?.id, resultCount: search.body?.search?.results?.length }));
      assert.ok(found);
    });
    await check("forged-actor-and-cross-workspace-do-not-consume", async () => {
      const before = await client.dataJob.count({ where: { requestedByUserId: data.owner.id } });
      assert.equal((await quotaApi(page, "/api/search/index", "POST", { workspaceId: data.workspace.id, expectedGeneration: 0, idempotencyKey: randomUUID(), actorId: data.member.id })).status, 400);
      assert.equal((await quotaApi(page, "/api/search/index", "POST", { workspaceId: "unknown-workspace", expectedGeneration: 0, idempotencyKey: randomUUID() })).status, 404);
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), before);
    });
    await check("cancel-frees-slot-and-search-can-recover", async () => {
      const row = page.locator(`[data-job-id="${exports[0]}"]`);
      await quotaButtonRequest(page, row.getByRole("button", { name: "取消", exact: true }), `/api/system/data-jobs/${exports[0]}`, 200, "PATCH");
      const panel = quotaSearchPanel(page, data.workspace.id);
      const body = await quotaButtonRequest(page, panel.getByRole("button", { name: "重建我的索引", exact: true }), "/api/search/index", 202);
      assert.equal(body.job.status, "QUEUED"); await page.locator(`[data-search-index-job="${body.job.id}"]`).waitFor();
      await quotaButtonRequest(page, page.locator(`[data-search-index-job="${body.job.id}"]`).getByRole("button", { name: "取消", exact: true }), `/api/search/index/jobs/${body.job.id}`, 200, "PATCH");
    });
    await check("ranking-can-recover-after-slot-release", async () => {
      const panel = quotaRankingPanel(page, data.challenge.id);
      const body = await quotaButtonRequest(page, panel.getByRole("button", { name: "申请重建排名", exact: true }), `/api/ranking/challenges/${data.challenge.id}/projection`, 202);
      assert.equal(body.job.status, "QUEUED"); await page.locator(`[data-ranking-job-id="${body.job.id}"]`).waitFor();
      await quotaButtonRequest(page, page.locator(`[data-ranking-job-id="${body.job.id}"]`).getByRole("button", { name: "取消", exact: true }), `/api/ranking/challenges/${data.challenge.id}/rebuilds/${body.job.id}`, 200, "PATCH");
    });
    await check("export-can-recover-but-cancellation-does-not-refund-window", async () => {
      const panel = quotaExportPanel(page);
      const body = await quotaButtonRequest(page, panel.getByRole("button", { name: "创建导出任务", exact: true }), "/api/system/data-jobs", 202);
      exports.push(body.job.id);
      for (const id of exports.slice(1)) await quotaButtonRequest(page, page.locator(`[data-job-id="${id}"]`).getByRole("button", { name: "取消", exact: true }), `/api/system/data-jobs/${id}`, 200, "PATCH");
      await quotaExportPreview(page, data.workspace.id);
      const rejected = await quotaButtonRequest(page, panel.getByRole("button", { name: "创建导出任务", exact: true }), "/api/system/data-jobs", 429);
      assert.deepEqual(rejected, { error: "DATA_JOB_QUOTA_EXPORT_LIMIT" });
      screenshots.push(...await quotaCaptureViews(page, panel, "export-window", /24 小时导出额度已用尽/, "创建导出任务"));
    });
    await check("lost-search-receipt-reuses-key-when-quota-is-full", async () => {
      let first = true; let acceptedId = "";
      await page.route("**/api/search/index", async route => {
        if (route.request().method() !== "POST" || !first) return route.continue(); first = false;
        const response = await route.fetch(); assert.equal(response.status(), 202); acceptedId = (await response.json()).job.id;
        await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
      });
      const panel = quotaSearchPanel(page, data.workspace.id);
      await quotaButtonRequest(page, panel.getByRole("button", { name: "重建我的索引", exact: true }), "/api/search/index", 202);
      const ranking = quotaRankingPanel(page, data.challenge.id);
      await quotaButtonRequest(page, ranking.getByRole("button", { name: "申请重建排名", exact: true }), `/api/ranking/challenges/${data.challenge.id}/projection`, 202);
      const before = await client.dataJob.count({ where: { requestedByUserId: data.owner.id } });
      const replay = await quotaButtonRequest(page, panel.getByRole("button", { name: "重试同一索引请求", exact: true }), "/api/search/index", 202);
      assert.equal(replay.job.id, acceptedId); assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), before);
      await page.unroute("**/api/search/index");
    });
    await check("no-consumers-artifacts-or-browser-errors", async () => { await quotaNoDomainEffects(client, fixture); assert.deepEqual(errors, []); });
    assert.equal(quotaSourceFingerprint(), sourceFingerprint, "QUOTA_SOURCE_CHANGED");
    assert.equal(computeProductExperienceSourceHash(), pool.sourceFingerprint);
    await writeFile(path.join(quotaBrowserOutput, "evidence.json"), JSON.stringify({ schemaVersion: 1, scope: "QUOTA local admission browser/API",
      checkedAt: new Date().toISOString(), sourceFingerprint, pool, viewports: [1440, 390, 320], screenshots, passed, pageErrors: errors,
      domainConsumersExecuted: false, productionTouched: false }, null, 2) + "\n");
    await context.close(); console.log(`PASS QUOTA browser/API ${passed.length} groups`);
  } catch (error) {
    if (diagnosticPage && !diagnosticPage.isClosed()) await diagnosticPage.screenshot({ path: path.join(quotaBrowserOutput, "failure.png") }).catch(() => undefined);
    throw error;
  } finally { await browser.close(); await client.$disconnect(); }
}

main().catch(error => {
  console.error(`QUOTA_BROWSER_FAILED:${current}:${error instanceof Error ? error.name : "unknown"}`); process.exitCode = 1;
});
