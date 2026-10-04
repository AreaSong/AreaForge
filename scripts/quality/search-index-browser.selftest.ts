import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { hashPassword } from "../../packages/auth/src/index";
import { createPrismaClient, prisma } from "../../packages/db/src/index";
import { loadSearchIndexFixture, searchIndexFixtureEnvironment, assertSearchIndexFixtureContainer, verifySearchIndexFixtureLedger } from "./search-index-fixture";
import { createSearchCase } from "./search-index-runtime-data";
import { startSearchFixtureWorker } from "./search-index-process";
import { searchIndexSourceFingerprint } from "./search-index-source";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { freezeSearchTarget, restoreSearchTarget, withSearchDeletion } from "./search-index-delete-runtime";
import { searchLostReceipt, searchLateRefresh, searchWorkspacePendingReply, searchLatestQueryAndFailure } from "./search-index-browser-races";
import { searchNativeZoom } from "./search-index-browser-zoom";
import { searchBrowserOutput, requireSearchPool, searchBrowserContext, loginSearch, openSearchSettings, searchBrowserApi,
  searchPanel, searchJobRow, refreshSearch, requestSearchFromUi, dynamicSearch, captureSearchViews, searchBrowserViewports } from "./search-index-browser-support";

let current = "fixture"; const passed: string[] = []; let diagnosticPage: Page | undefined;
const selected = process.argv[3]?.startsWith("--case=") ? process.argv[3].slice(7) : undefined;
async function check(name: string, run: () => Promise<void>) {
  if (selected && name !== selected && name !== "unauthenticated-and-real-login") return;
  current = name; await run(); passed.push(name); console.log(`PASS browser ${name}`);
}

async function main() {
  const fixture = loadSearchIndexFixture(process.argv[2] ?? ""); assertSearchIndexFixtureContainer(fixture);
  const env = searchIndexFixtureEnvironment(fixture); Object.assign(process.env, env);
  const sourceFingerprint = searchIndexSourceFingerprint(); const pool = requireSearchPool(fixture, env.DATABASE_URL!);
  const client = createPrismaClient(env.DATABASE_URL); await verifySearchIndexFixtureLedger(client, fixture);
  const password = `Synthetic-Search-${randomUUID()}!`; const passwordHash = await hashPassword(password);
  const data = await createSearchCase(client, fixture, "browser", passwordHash);
  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
  const errors: string[] = []; await mkdir(searchBrowserOutput, { recursive: true });
  try {
    const context = await searchBrowserContext(browser, pool, errors); const page = await context.newPage(); diagnosticPage = page;
    await check("unauthenticated-and-real-login", async () => {
      assert.equal((await context.request.get(`/api/search/index?workspaceId=${data.workspace.id}`)).status(), 401);
      await loginSearch(page, data.owner.email, password); await openSearchSettings(page, data.workspace.id);
    });
    let firstJob = "";
    await check("incomplete-202-keeps-request-identity", async () => { firstJob = await searchLostReceipt(page, data); });
    await check("late-refresh-does-not-replace-new-job", async () => { firstJob = await searchLateRefresh(page, data, firstJob); });
    await check("independent-worker-publishes-private-index", async () => {
      assert.equal((await startSearchFixtureWorker(fixture, firstJob).done).code, 0); await refreshSearch(page, data.workspace.id);
      await searchJobRow(page, firstJob).getByText("成功", { exact: true }).waitFor(); await searchPanel(page, data.workspace.id).getByText("索引已验证", { exact: true }).waitFor();
      const response = await searchBrowserApi(page, `/api/search/index?workspaceId=${data.workspace.id}`); assert.equal(response.status, 200);
      const encoded = JSON.stringify(response.body);
      for (const forbidden of ["sourceFingerprint", "sourceRevision", "sessionSecret", fixture.password, fixture.root]) assert.equal(encoded.includes(forbidden), false);
    });
    await check("global-dynamic-search-uses-current-title-only-index", async () => {
      const result = await dynamicSearch(page, "SEARCH"); assert.equal(result.status, 200); assert.equal(result.body.search.indexed, true);
      assert.equal(result.body.search.results.length, 8); await page.getByRole("option").filter({ hasText: "SEARCH 本人笔记" }).waitFor();
      assert.equal(JSON.stringify(result.body).includes("private-note-body-sentinel"), false); await page.keyboard.press("Escape");
    });
    await check("latest-query-wins-and-error-recovery", () => searchLatestQueryAndFailure(page));
    await check("pause-acknowledge-resume-and-cancel", async () => {
      const id = await requestSearchFromUi(page, data.workspace.id); const worker = startSearchFixtureWorker(fixture, id, "prepared");
      try {
        await worker.waitFor("prepared"); await refreshSearch(page, data.workspace.id);
        await searchJobRow(page, id).getByRole("button", { name: "暂停", exact: true }).click();
        await searchJobRow(page, id).getByText("等待安全暂停", { exact: true }).waitFor();
        assert.equal(await searchJobRow(page, id).getByRole("button", { name: "恢复", exact: true }).count(), 0);
        worker.continue(); assert.equal((await worker.done).code, 0); await refreshSearch(page, data.workspace.id);
        await searchJobRow(page, id).getByRole("button", { name: "恢复", exact: true }).click(); await searchJobRow(page, id).getByText("排队中", { exact: true }).waitFor();
        assert.equal((await startSearchFixtureWorker(fixture, id).done).code, 0); await refreshSearch(page, data.workspace.id);
        await searchJobRow(page, id).getByText("成功", { exact: true }).waitFor();
      } finally { worker.stop(); await worker.done; }
      const cancelled = await requestSearchFromUi(page, data.workspace.id);
      await searchJobRow(page, cancelled).getByRole("button", { name: "取消", exact: true }).click(); await searchJobRow(page, cancelled).getByText("已取消", { exact: true }).waitFor();
    });
    await check("failed-refresh-hides-index-count-and-keeps-recovery", async () => {
      await page.route("**/api/search/index?*", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SYNTHETIC_UNAVAILABLE"}' }));
      await refreshSearch(page, data.workspace.id); await searchPanel(page, data.workspace.id).getByText(/无法确认索引状态/).waitFor();
      await searchPanel(page, data.workspace.id).getByText("安全直查", { exact: true }).waitFor();
      assert.ok(await searchPanel(page, data.workspace.id).locator("[data-search-index-job]").count());
      assert.equal(await searchPanel(page, data.workspace.id).getByText("8 个名称与标题", { exact: true }).count(), 0);
      await page.unroute("**/api/search/index?*"); await refreshSearch(page, data.workspace.id);
    });
    await check("viewer-own-index-and-cross-user-workspace-rejection", async () => {
      for (const actor of [data.viewer, data.stranger]) {
        const other = await searchBrowserContext(browser, pool, errors); const otherPage = await other.newPage();
        await loginSearch(otherPage, actor.email, password);
        assert.equal((await searchBrowserApi(otherPage, `/api/search/index/jobs/${firstJob}`, "PATCH",
          { workspaceId: data.workspace.id, expectedRevision: 1, action: "CANCEL" })).status, 404);
        assert.equal((await searchBrowserApi(otherPage, `/api/search/index?workspaceId=${data.secondary.id}`)).status, 404);
        if (actor.id === data.viewer.id) {
          await openSearchSettings(otherPage, data.workspace.id); const viewerJob = await requestSearchFromUi(otherPage, data.workspace.id);
          assert.equal((await startSearchFixtureWorker(fixture, viewerJob).done).code, 0);
          const result = await dynamicSearch(otherPage, "SEARCH"); assert.equal(result.body.search.results.length, 3);
          assert.ok(result.body.search.results.every((row: { id: string }) => row.id !== data.own.note.id));
        } else assert.equal((await searchBrowserApi(otherPage, `/api/search/index?workspaceId=${data.workspace.id}`)).status, 404);
        await other.close();
      }
    });
    await check("workspace-switch-discards-pending-old-receipt", () => searchWorkspacePendingReply(page, data));
    await check("selected-workspace-also-binds-global-search", async () => {
      const selection = await client.workspaceSelection.findUniqueOrThrow({ where: { userId: data.owner.id } });
      assert.equal((await searchBrowserApi(page, `/api/exam-workspaces/${data.secondary.id}/activate`, "POST",
        { expectedRevision: data.secondary.revision, expectedSelectionRevision: selection.revision })).status, 200);
      await page.reload(); const other = await dynamicSearch(page, "SECONDARY");
      assert.equal(other.body.search.workspaceId, data.secondary.id); assert.equal(other.body.search.results.length, 1);
      await page.keyboard.press("Escape"); const currentSelection = await client.workspaceSelection.findUniqueOrThrow({ where: { userId: data.owner.id } });
      assert.equal((await searchBrowserApi(page, `/api/exam-workspaces/${data.workspace.id}/activate`, "POST",
        { expectedRevision: data.workspace.revision, expectedSelectionRevision: currentSelection.revision })).status, 200);
      await openSearchSettings(page, data.workspace.id);
    });
    await check("renamed-source-invalidates-old-title-and-rebuilds", async () => {
      await client.note.update({ where: { id: data.own.note.id }, data: { title: "SEARCH 本人更新笔记" } });
      await refreshSearch(page, data.workspace.id); await searchPanel(page, data.workspace.id).getByText("安全直查", { exact: true }).waitFor();
      const result = await dynamicSearch(page, "SEARCH 本人更新"); assert.equal(result.body.search.indexed, false);
      assert.equal(result.body.search.results[0].label, "SEARCH 本人更新笔记"); await page.keyboard.press("Escape");
      const id = await requestSearchFromUi(page, data.workspace.id); assert.equal((await startSearchFixtureWorker(fixture, id).done).code, 0); await refreshSearch(page, data.workspace.id);
    });
    await check("freeze-rebuild-restore-does-not-revive-old-index", async () => {
      await withSearchDeletion(async () => {
        const intent = await freezeSearchTarget(client, data.member, { requesterId: data.member.id, scope: "RESOURCE", workspaceId: data.workspace.id,
          resourceType: "Note", resourceId: data.foreign.note.id });
        try {
          const hidden = await dynamicSearch(page, "SEARCH 他人笔记"); assert.deepEqual(hidden.body.search.results, []); await page.keyboard.press("Escape");
          const id = await requestSearchFromUi(page, data.workspace.id); assert.equal((await startSearchFixtureWorker(fixture, id).done).code, 0); await refreshSearch(page, data.workspace.id);
        } finally { await restoreSearchTarget(client, data.member, intent.id); }
        const restored = await dynamicSearch(page, "SEARCH 他人"); assert.equal(restored.body.search.indexed, false); assert.equal(restored.body.search.results.length, 2);
        await page.keyboard.press("Escape"); const id = await requestSearchFromUi(page, data.workspace.id);
        assert.equal((await startSearchFixtureWorker(fixture, id).done).code, 0); await refreshSearch(page, data.workspace.id);
      });
    });
    await check("seven-viewports-search-and-keyboard", () => captureSearchViews(page, data.workspace.id));
    let nativeZoom: Awaited<ReturnType<typeof searchNativeZoom>> | undefined;
    await check("native-browser-125-percent-zoom", async () => { nativeZoom = await searchNativeZoom({ pool, workspaceId: data.workspace.id, executablePath,
      credentials: { email: data.owner.email, password } }); });
    await check("strict-input-and-revoked-session-clears-private-view", async () => {
      assert.equal((await searchBrowserApi(page, "/api/search/index", "POST", { workspaceId: data.workspace.id, expectedGeneration: 0,
        idempotencyKey: randomUUID(), actorId: data.member.id })).status, 400);
      await client.authSession.updateMany({ where: { userId: data.owner.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await refreshSearch(page, data.workspace.id); await searchPanel(page, data.workspace.id).getByText(/当前身份或工作区权限已失效/).waitFor();
      assert.equal(await searchPanel(page, data.workspace.id).locator("[data-search-index-job]").count(), 0);
      const denied = await dynamicSearch(page, "SEARCH 已撤销"); assert.equal(denied.status, 401);
      assert.equal(await page.getByRole("option").filter({ hasText: "SEARCH 本人" }).count(), 0);
    });
    assert.deepEqual(errors, []); assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash());
    assert.equal(searchIndexSourceFingerprint(), sourceFingerprint, "browser source changed while checking");
    if (selected) { assert.equal(passed.length, 2, "selected browser case must exist"); await context.close(); return; }
    await writeFile(path.join(searchBrowserOutput, "evidence.json"), JSON.stringify({ scope: "SEARCH local fixture browser/API", checkedAt: new Date().toISOString(),
      pool, sourceFingerprint, viewports: searchBrowserViewports.map(({ width, height, zoom }) => ({ width, height, cssZoom: zoom })), nativeZoom, passed, pageErrors: errors, productionTouched: false }, null, 2) + "\n");
    await context.close(); console.log(`PASS SEARCH browser/API ${passed.length} groups`);
  } catch (error) {
    if (diagnosticPage && !diagnosticPage.isClosed()) {
      const buttons = await diagnosticPage.locator("[data-search-index-root] button").evaluateAll(nodes => nodes.map(node => ({ label: node.textContent?.trim(), disabled: (node as HTMLButtonElement).disabled }))).catch(() => []);
      console.error(JSON.stringify({ case: current, buttons }));
      await diagnosticPage.screenshot({ path: path.join(searchBrowserOutput, "failure.png"), timeout: 3000 }).catch(() => undefined);
    }
    throw error;
  } finally { await browser.close(); await client.$disconnect(); await prisma.$disconnect(); }
}
main().catch(error => { console.error(`SEARCH_BROWSER_FAILED:${current}:${error instanceof Error ? error.name : "unknown"}`); process.exitCode = 1; });
