import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { hashPassword } from "../../packages/auth/src/index";
import { createPrismaClient, prisma } from "../../packages/db/src/index";
import { transferPrivateChallengeOwnership } from "../../apps/web/lib/ranking/challenge-service";
import { loadRankingFixture, rankingFixtureEnvironment, assertRankingFixtureContainer, verifyRankingFixtureLedger } from "./ranking-rebuild-fixture";
import { createRankingCase, type RankingCase } from "./ranking-rebuild-runtime-data";
import { startRankingFixtureWorker } from "./ranking-rebuild-process";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { rankingRebuildSourceFingerprint } from "./ranking-rebuild-source";
import { rankingViewerAndRevision, rankingBrowserFreeze } from "./ranking-rebuild-browser-lifecycle";
import { rankingBrowserOutput, requireRankingPool, rankingBrowserContext, loginRanking, rankingBrowserApi, rankingPanel,
  rankingJobRow, refreshRanking, requestRankingFromUi, captureRankingViews } from "./ranking-rebuild-browser-support";

let current = "fixture"; const passed: string[] = []; let diagnosticPage: Page | undefined;
async function check(name: string, run: () => Promise<void>) { current = name; await run(); passed.push(name); console.log(`PASS browser ${name}`); }

async function main() {
  const fixture = loadRankingFixture(process.argv[2] ?? ""); assertRankingFixtureContainer(fixture);
  const env = rankingFixtureEnvironment(fixture); Object.assign(process.env, env);
  const sourceFingerprint = rankingRebuildSourceFingerprint();
  const pool = requireRankingPool(fixture, env.DATABASE_URL!); const client = createPrismaClient(env.DATABASE_URL);
  await verifyRankingFixtureLedger(client, fixture);
  const password = `Synthetic-Ranking-${randomUUID()}!`; const passwordHash = await hashPassword(password);
  const data = await createRankingCase(client, fixture, "browser", passwordHash);
  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
  const errors: string[] = []; await mkdir(rankingBrowserOutput, { recursive: true });
  try {
    const context = await rankingBrowserContext(browser, pool, errors); const page = await context.newPage();
    diagnosticPage = page;
    await check("unauthenticated-and-real-login", async () => {
      assert.equal((await context.request.get(`/api/ranking/challenges/${data.challenge.id}/projection`)).status(), 401);
      await loginRanking(page, data.owner.email, password); await page.goto("/settings/data"); await rankingPanel(page, data.challenge.id).waitFor();
    });
    let firstJob = "";
    await check("incomplete-202-keeps-request-identity", async () => { firstJob = await lostReceipt(page, data); });
    await check("late-refresh-does-not-replace-new-job", async () => { firstJob = await lateRefresh(page, data, firstJob); });
    await check("worker-publishes-and-private-dto", async () => {
      assert.equal((await startRankingFixtureWorker(fixture, firstJob).done).code, 0); await refreshRanking(page, data.challenge.id);
      await rankingJobRow(page, firstJob).getByText("成功", { exact: true }).waitFor();
      await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").nth(1).waitFor();
      const response = await rankingBrowserApi(page, `/api/ranking/challenges/${data.challenge.id}/rebuilds`); assert.equal(response.status, 200);
      const encoded = JSON.stringify(response.body);
      for (const forbidden of ["authorization", "sourceFingerprint", "sessionSecret", fixture.password, fixture.root]) assert.equal(encoded.includes(forbidden), false);
    });
    await check("pause-ack-resume-and-cancel", async () => {
      const id = await requestRankingFromUi(page, data.challenge.id); const worker = startRankingFixtureWorker(fixture, id, "prepared");
      try {
        await worker.waitFor("prepared"); await refreshRanking(page, data.challenge.id);
        await rankingJobRow(page, id).getByRole("button", { name: "暂停", exact: true }).click();
        await rankingJobRow(page, id).getByText("等待安全暂停", { exact: true }).waitFor();
        assert.equal(await rankingJobRow(page, id).getByRole("button", { name: "恢复", exact: true }).count(), 0);
        worker.continue(); assert.equal((await worker.done).code, 0); await refreshRanking(page, data.challenge.id);
        await rankingJobRow(page, id).getByRole("button", { name: "恢复", exact: true }).click();
        await rankingJobRow(page, id).getByText("排队中", { exact: true }).waitFor();
        assert.equal((await startRankingFixtureWorker(fixture, id).done).code, 0); await refreshRanking(page, data.challenge.id);
        await rankingJobRow(page, id).getByText("成功", { exact: true }).waitFor();
      } finally { worker.stop(); await worker.done; }
      const cancelled = await requestRankingFromUi(page, data.challenge.id);
      await rankingJobRow(page, cancelled).getByRole("button", { name: "取消", exact: true }).click();
      await rankingJobRow(page, cancelled).getByText("已取消", { exact: true }).waitFor();
    });
    await check("failed-refresh-preserves-controls-and-hides-scores", async () => {
      await page.route(`**/challenges/${data.challenge.id}/rebuilds`, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SYNTHETIC_UNAVAILABLE"}' }));
      await page.route(`**/challenges/${data.challenge.id}/projection`, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SYNTHETIC_UNAVAILABLE"}' }));
      await refreshRanking(page, data.challenge.id); await rankingPanel(page, data.challenge.id).getByText(/暂时无法刷新排名/).waitFor();
      assert.ok(await rankingPanel(page, data.challenge.id).locator("[data-ranking-job-id]").count());
      assert.equal(await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").count(), 0);
      await page.unroute(`**/challenges/${data.challenge.id}/rebuilds`); await page.unroute(`**/challenges/${data.challenge.id}/projection`);
      await refreshRanking(page, data.challenge.id);
    });
    await check("member-and-cross-workspace-rejected", async () => {
      for (const actor of [data.member, data.stranger]) {
        const memberContext = await rankingBrowserContext(browser, pool, errors); const memberPage = await memberContext.newPage();
        await loginRanking(memberPage, actor.email, password);
        assert.equal((await rankingBrowserApi(memberPage, `/api/ranking/challenges/${data.challenge.id}/rebuilds`)).status, 404);
        assert.equal((await rankingBrowserApi(memberPage, `/api/ranking/challenges/${data.challenge.id}/projection`, "POST", { expectedRevision: 1, idempotencyKey: randomUUID() })).status, 404);
        assert.equal((await rankingBrowserApi(memberPage, `/api/ranking/challenges/${data.challenge.id}/rebuilds/${firstJob}`, "PATCH", { expectedRevision: 1, action: "CANCEL" })).status, 404);
        await memberContext.close();
      }
    });
    const lifecycle = { client, fixture, browser, pool, errors, password, passwordHash };
    await check("viewer-permission-and-challenge-revision", () => rankingViewerAndRevision(lifecycle, page, data));
    await check("desktop-390-320-and-keyboard", () => captureRankingViews(page, data.challenge.id));
    await check("strict-input-and-revoked-session-clears-view", async () => {
      assert.equal((await rankingBrowserApi(page, `/api/ranking/challenges/${data.challenge.id}/projection`, "POST",
        { expectedRevision: 1, idempotencyKey: randomUUID(), actorId: data.member.id })).status, 400);
      await refreshRanking(page, data.challenge.id); await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").first().waitFor();
      await client.authSession.updateMany({ where: { userId: data.owner.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await rankingPanel(page, data.challenge.id).getByRole("button", { name: "申请重建排名", exact: true }).click();
      await rankingPanel(page, data.challenge.id).getByText(/当前身份或挑战权限已失效/).waitFor();
      assert.equal(await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").count(), 0);
      assert.equal(await rankingPanel(page, data.challenge.id).locator("[data-ranking-job-id]").count(), 0);
    });
    await check("ownership-change-clears-pending-scope", async () => {
      const changed = await createRankingCase(client, fixture, "browser-transfer", passwordHash);
      const transferContext = await rankingBrowserContext(browser, pool, errors); const transferPage = await transferContext.newPage();
      await loginRanking(transferPage, changed.owner.email, password); await transferPage.goto("/settings/data");
      const oldJob = await pendingTransfer(transferPage, changed);
      assert.equal((await startRankingFixtureWorker(fixture, oldJob).done).code, 0);
      assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: oldJob } })).status, "FAILED");
      await transferContext.close();
    });
    await check("exit-freeze-rebuild-and-restore-visibility", () => rankingBrowserFreeze(lifecycle));
    assert.deepEqual(errors, []); assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash());
    assert.equal(rankingRebuildSourceFingerprint(), sourceFingerprint, "browser source changed while checking");
    await writeFile(path.join(rankingBrowserOutput, "evidence.json"), JSON.stringify({ scope: "RANKING local fixture browser/API",
      checkedAt: new Date().toISOString(), pool, sourceFingerprint, viewports: ["1440x1000", "390x844", "320x844"], passed, pageErrors: errors, productionTouched: false }, null, 2) + "\n");
    await context.close(); console.log(`PASS RANKING browser/API ${passed.length} groups`);
  } catch (error) {
    if (diagnosticPage && !diagnosticPage.isClosed()) {
      const buttons = await diagnosticPage.locator("[data-ranking-root] button").evaluateAll(nodes => nodes.map(node => ({ label: node.textContent?.trim(), disabled: (node as HTMLButtonElement).disabled }))).catch(() => []);
      console.error(JSON.stringify({ case: current, buttons }));
      await diagnosticPage.screenshot({ path: path.join(rankingBrowserOutput, "failure.png"), timeout: 3000 }).catch(() => undefined);
    }
    throw error;
  } finally { await browser.close(); await client.$disconnect(); await prisma.$disconnect(); }
}

async function lostReceipt(page: Page, data: RankingCase) {
  let lost = true; const bodies: unknown[] = []; const ids: string[] = [];
  const url = `**/challenges/${data.challenge.id}/projection`;
  await page.route(url, async route => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON()); const response = await route.fetch(); assert.equal(response.status(), 202);
    ids.push((await response.json()).job.id);
    if (lost) { lost = false; return route.fulfill({ status: 202, contentType: "application/json", body: "{" }); }
    return route.fulfill({ response });
  });
  const panel = rankingPanel(page, data.challenge.id);
  await panel.getByRole("button", { name: "申请重建排名", exact: true }).click();
  await panel.getByRole("button", { name: "重试同一重建请求", exact: true }).click();
  await rankingJobRow(page, ids[0]!).waitFor(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.deepEqual(bodies[0], bodies[1]);
  await page.unroute(url); return ids[0]!;
}

async function lateRefresh(page: Page, data: RankingCase, previous: string) {
  await rankingJobRow(page, previous).getByRole("button", { name: "取消", exact: true }).click();
  await rankingJobRow(page, previous).getByText("已取消", { exact: true }).waitFor();
  let release!: () => void; let fetched!: () => void;
  const ready = new Promise<void>(resolve => { fetched = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
  const url = `**/challenges/${data.challenge.id}/rebuilds`;
  let delivery: Promise<void> | undefined; let failure = false;
  await page.route(url, route => {
    if (delivery) return route.continue();
    delivery = (async () => { const response = await route.fetch(); fetched(); await pending; await route.fulfill({ response }); })()
      .catch(() => { failure = true; fetched(); });
    return delivery;
  });
  try {
    await rankingPanel(page, data.challenge.id).getByRole("button", { name: "刷新排名", exact: true }).click(); await ready;
    assert.equal(failure, false);
    const id = await requestRankingFromUi(page, data.challenge.id); release(); await delivery;
    assert.equal(failure, false);
    await rankingJobRow(page, id).waitFor();
    assert.equal(await rankingPanel(page, data.challenge.id).getByRole("button", { name: "申请重建排名", exact: true }).isEnabled(), false);
    return id;
  } finally { release(); await delivery; await page.unroute(url); }
}

async function pendingTransfer(page: Page, data: RankingCase) {
  let release!: () => void; let fetched!: () => void;
  const ready = new Promise<void>(resolve => { fetched = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
  const url = `**/challenges/${data.challenge.id}/projection`;
  let delivery: Promise<void> | undefined; let failure = false; let jobId = "";
  await page.route(url, route => {
    if (route.request().method() !== "POST") return route.continue();
    delivery = (async () => { const response = await route.fetch(); jobId = (await response.json()).job.id; fetched(); await pending; await route.fulfill({ response }); })()
      .catch(() => { failure = true; fetched(); });
    return delivery;
  });
  await rankingPanel(page, data.challenge.id).getByRole("button", { name: "申请重建排名", exact: true }).click(); await ready;
  try {
    const participant = await prisma.privateChallengeParticipant.findUniqueOrThrow({ where: { challengeId_userId: { challengeId: data.challenge.id, userId: data.member.id } } });
    await transferPrivateChallengeOwnership(data.owner, data.challenge.id, participant.id, 1);
    await page.locator("[data-ranking-root]").getByRole("button", { name: "刷新", exact: true }).click();
    await rankingPanel(page, data.challenge.id).getByRole("button", { name: "申请重建排名", exact: true }).waitFor({ state: "detached" });
    assert.equal(await rankingPanel(page, data.challenge.id).getByRole("button", { name: "刷新排名", exact: true }).isEnabled(), true);
  } finally { release(); await delivery; await page.unroute(url); assert.equal(failure, false); }
  return jobId;
}

main().catch(error => { console.error(`RANKING_BROWSER_FAILED:${current}:${error instanceof Error ? error.name : "unknown"}`); process.exitCode = 1; });
