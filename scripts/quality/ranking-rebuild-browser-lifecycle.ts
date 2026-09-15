import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { controlDatabaseDeletion, type PrismaClient } from "../../packages/db/src/index";
import { updateWorkspaceMemberRole } from "../../apps/web/lib/workspace/rbac-service";
import { updateRankingPreference } from "../../apps/web/lib/ranking/preference-service";
import { createRankingCase, type RankingCase } from "./ranking-rebuild-runtime-data";
import { freezeRankingAccount } from "./ranking-rebuild-delete-runtime";
import { startRankingFixtureWorker } from "./ranking-rebuild-process";
import type { RankingRebuildFixture } from "./ranking-rebuild-fixture";
import { rankingBrowserContext, loginRanking, rankingBrowserApi, rankingPanel, rankingJobRow, refreshRanking,
  requestRankingFromUi, type RankingPool } from "./ranking-rebuild-browser-support";

export interface RankingBrowserLifecycleContext { client: PrismaClient; fixture: RankingRebuildFixture; browser: Browser;
  pool: RankingPool; errors: string[]; password: string; passwordHash: string }

export async function rankingViewerAndRevision(context: RankingBrowserLifecycleContext, page: Page, data: RankingCase) {
  const member = await context.client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await updateWorkspaceMemberRole(data.owner, data.workspace.id, member.id, "VIEWER", member.revision);
  const viewerContext = await rankingBrowserContext(context.browser, context.pool, context.errors);
  try {
    const viewer = await viewerContext.newPage(); await loginRanking(viewer, data.member.email, context.password); await viewer.goto("/settings/data");
    const panel = rankingPanel(viewer, data.challenge.id); await panel.waitFor();
    assert.equal(await panel.getByRole("button", { name: "申请重建排名", exact: true }).count(), 0);
    assert.equal((await rankingBrowserApi(viewer, `/api/ranking/challenges/${data.challenge.id}/rebuilds`)).status, 404);
    assert.equal((await rankingBrowserApi(viewer, `/api/ranking/challenges/${data.challenge.id}/projection`, "POST", { expectedRevision: 1, idempotencyKey: "viewer-rejected" })).status, 404);
  } finally { await viewerContext.close(); }
  await refreshRanking(page, data.challenge.id);
  const rebuilt = await requestRankingFromUi(page, data.challenge.id);
  assert.equal((await startRankingFixtureWorker(context.fixture, rebuilt).done).code, 0); await refreshRanking(page, data.challenge.id);
  await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").nth(1).waitFor();
  const ended = page.waitForResponse(response => response.url().endsWith(`/challenges/${data.challenge.id}/end`) && response.request().method() === "POST");
  await page.locator("[data-ranking-root]").getByRole("button", { name: "结束", exact: true }).click(); assert.equal((await ended).status(), 200);
  await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").first().waitFor({ state: "detached" });
  const next = await requestRankingFromUi(page, data.challenge.id);
  assert.equal((await startRankingFixtureWorker(context.fixture, next).done).code, 0); await refreshRanking(page, data.challenge.id);
  await rankingJobRow(page, next).getByText("成功", { exact: true }).waitFor();
  await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").nth(1).waitFor();
}

export async function rankingBrowserFreeze(context: RankingBrowserLifecycleContext) {
  const { client, fixture } = context;
  const data = await createRankingCase(client, fixture, "browser-freeze", context.passwordHash);
  const ownerContext = await rankingBrowserContext(context.browser, context.pool, context.errors);
  const memberContext = await rankingBrowserContext(context.browser, context.pool, context.errors);
  const previous = { lifecycle: process.env.DATA_LIFECYCLE_ENABLED, deletion: process.env.DATA_DELETE_ENABLED };
  try {
    const page = await ownerContext.newPage(); await loginRanking(page, data.owner.email, context.password); await page.goto("/settings/data");
    const memberPage = await memberContext.newPage(); await loginRanking(memberPage, data.member.email, context.password);
    const job = await requestRankingFromUi(page, data.challenge.id);
    assert.equal((await startRankingFixtureWorker(fixture, job).done).code, 0); await refreshRanking(page, data.challenge.id);
    await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").nth(1).waitFor();
    await updateRankingPreference(data.member, data.workspace.id, { enabled: false, timezone: "UTC", authorizedFields: ["score"], expectedRevision: 1 });
    process.env.DATA_LIFECYCLE_ENABLED = "true"; process.env.DATA_DELETE_ENABLED = "true";
    const intent = await freezeRankingAccount(client, data.member);
    await refreshRanking(page, data.challenge.id);
    await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").first().waitFor({ state: "detached" });
    assert.equal((await rankingBrowserApi(memberPage, `/api/ranking/challenges/${data.challenge.id}/projection`)).status, 404);
    const rebuild = await requestRankingFromUi(page, data.challenge.id);
    assert.equal((await startRankingFixtureWorker(fixture, rebuild).done).code, 0); await refreshRanking(page, data.challenge.id);
    await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").first().waitFor();
    assert.equal(await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").count(), 1);
    const api = await rankingBrowserApi(page, `/api/ranking/challenges/${data.challenge.id}/projection`);
    assert.equal(api.body.projection.entries.length, 1);
    const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await controlDatabaseDeletion(client, { actor: data.member, intentId: row.id, expectedRevision: row.revision, action: "cancel" });
    await refreshRanking(page, data.challenge.id);
    await rankingPanel(page, data.challenge.id).locator("[data-ranking-participant-id]").first().waitFor({ state: "detached" });
  } finally {
    if (previous.lifecycle === undefined) delete process.env.DATA_LIFECYCLE_ENABLED; else process.env.DATA_LIFECYCLE_ENABLED = previous.lifecycle;
    if (previous.deletion === undefined) delete process.env.DATA_DELETE_ENABLED; else process.env.DATA_DELETE_ENABLED = previous.deletion;
    await ownerContext.close(); await memberContext.close();
  }
}
