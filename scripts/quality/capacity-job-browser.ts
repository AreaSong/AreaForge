import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";
import { createCapacityCase, requestCapacityCase, settleCapacityCase, type CapacityCase } from "./capacity-runtime-data";
import { capacityApi, capacityButtonRequest, capacityCaptureViews, capacityPage, capacityExportPanel, capacitySearchPanel,
  capacityRankingPanel, capacityExportPreview, type CapacityBrowserHarness } from "./capacity-browser-support";

export async function capacityJobBrowser(h: CapacityBrowserHarness) {
  await userQuotaBrowser(h); await workspaceQuotaBrowser(h); await instanceQuotaBrowser(h);
}

async function configurePanels(page: Page, data: CapacityCase) {
  await page.goto("/settings/data");
  await page.getByLabel("排名工作区", { exact: true }).selectOption(data.workspace.id);
  await capacityRankingPanel(page, data.challenge.id).waitFor();
  await page.getByLabel("索引工作区", { exact: true }).selectOption(data.workspace.id);
  await capacitySearchPanel(page, data.workspace.id).waitFor();
  await capacityExportPreview(page, data.workspace.id);
}

async function userQuotaBrowser(h: CapacityBrowserHarness) {
  const data = await createCapacityCase(h.client, h.fixture, "browser-user-total", h.passwordHash);
  const owned = await capacityPage(h, data.owner.email); const page = owned.page; const jobs: string[] = [];
  try {
    await h.check("real-exports-across-workspace-and-account-fill-user-total", async () => {
      for (const scope of ["WORKSPACE", "ACCOUNT"]) {
        const result = await capacityApi(page, "/api/system/data-jobs", "POST", { kind: "EXPORT", scope,
          workspaceId: scope === "WORKSPACE" ? data.workspace.id : undefined, idempotencyKey: randomUUID() });
        assert.equal(result.status, 202); jobs.push(result.body.job.id);
      }
      await configurePanels(page, data);
    });
    const targets = [
      { name: "export", panel: () => capacityExportPanel(page), button: "创建导出任务", route: "/api/system/data-jobs" },
      { name: "search", panel: () => capacitySearchPanel(page, data.workspace.id), button: "重建我的索引", route: "/api/search/index" },
      { name: "ranking", panel: () => capacityRankingPanel(page, data.challenge.id), button: "申请重建排名", route: `/api/ranking/challenges/${data.challenge.id}/projection` },
    ];
    for (const target of targets) await h.check(`${target.name}-user-total-feedback-desktop-and-narrow`, async () => {
      const panel = target.panel();
      const body = await capacityButtonRequest(page, panel.getByRole("button", { name: target.button, exact: true }), target.route, 429);
      assert.deepEqual(body, { error: "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" });
      h.screenshots.push(...await capacityCaptureViews(page, panel, `${target.name}-user-total`, /所有工作区.*总名额已满/, target.button));
    });
    await h.check("full-capacity-does-not-block-learning-write-or-safe-search", async () => {
      const task = await capacityApi(page, "/api/tasks", "POST", { idempotencyKey: randomUUID(), subjectId: data.subject.id,
        title: "CAPACITY 不限制学习任务", type: "study", estimatedMinutes: 30 });
      assert.equal(task.status, 201);
      const search = await capacityApi(page, `/api/search?workspaceId=${data.workspace.id}&q=CAPACITY`);
      assert.equal(search.status, 200); assert.equal(search.body.search.indexed, false);
      assert.ok(search.body.search.results.some((row: { id: string }) => row.id === task.body.task.id));
    });
    await h.check("forged-actor-and-cross-workspace-reject-before-quota", async () => {
      const before = await h.client.dataJob.count({ where: { requestedByUserId: data.owner.id } });
      assert.equal((await capacityApi(page, "/api/search/index", "POST", { workspaceId: data.workspace.id, expectedGeneration: 0,
        idempotencyKey: randomUUID(), actorId: data.member.id })).status, 400);
      assert.equal((await capacityApi(page, "/api/search/index", "POST", { workspaceId: "unknown-workspace", expectedGeneration: 0, idempotencyKey: randomUUID() })).status, 404);
      assert.equal(await h.client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), before);
    });
    await h.check("cancel-releases-capacity-and-three-real-entrypoints-recover", async () => {
      await page.getByRole("button", { name: "刷新任务", exact: true }).click();
      await page.locator(`[data-job-id="${jobs[0]}"]`).waitFor();
      await capacityButtonRequest(page, page.locator(`[data-job-id="${jobs[0]}"]`).getByRole("button", { name: "取消", exact: true }), `/api/system/data-jobs/${jobs[0]}`, 200, "PATCH");
      const search = await capacityButtonRequest(page, capacitySearchPanel(page, data.workspace.id).getByRole("button", { name: "重建我的索引", exact: true }), "/api/search/index", 202);
      await page.locator(`[data-search-index-job="${search.job.id}"]`).waitFor();
      await capacityButtonRequest(page, page.locator(`[data-search-index-job="${search.job.id}"]`).getByRole("button", { name: "取消", exact: true }), `/api/search/index/jobs/${search.job.id}`, 200, "PATCH");
      const ranking = await capacityButtonRequest(page, capacityRankingPanel(page, data.challenge.id).getByRole("button", { name: "申请重建排名", exact: true }), `/api/ranking/challenges/${data.challenge.id}/projection`, 202);
      await page.locator(`[data-ranking-job-id="${ranking.job.id}"]`).waitFor();
      await capacityButtonRequest(page, page.locator(`[data-ranking-job-id="${ranking.job.id}"]`).getByRole("button", { name: "取消", exact: true }), `/api/ranking/challenges/${data.challenge.id}/rebuilds/${ranking.job.id}`, 200, "PATCH");
      const exported = await capacityButtonRequest(page, capacityExportPanel(page).getByRole("button", { name: "创建导出任务", exact: true }), "/api/system/data-jobs", 202);
      jobs.push(exported.job.id);
      for (const id of jobs.slice(1)) {
        const row = await h.client.dataJob.findUniqueOrThrow({ where: { id } });
        assert.equal((await capacityApi(page, `/api/system/data-jobs/${id}`, "PATCH", { action: "cancel", expectedRevision: row.updatedAt.getTime() })).status, 200);
      }
    });
    await h.check("lost-search-receipt-reuses-same-key-at-full-total", () => lostReceipt(h, page, data));
  } finally { await settleCapacityCase(h.client, data); await owned.context.close(); }
}

async function lostReceipt(h: CapacityBrowserHarness, page: Page, data: CapacityCase) {
  let first = true; let acceptedId = "";
  await page.route("**/api/search/index", async route => {
    if (route.request().method() !== "POST" || !first) return route.continue(); first = false;
    const response = await route.fetch(); assert.equal(response.status(), 202); acceptedId = (await response.json()).job.id;
    await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
  });
  try {
    const panel = capacitySearchPanel(page, data.workspace.id);
    await capacityButtonRequest(page, panel.getByRole("button", { name: "重建我的索引", exact: true }), "/api/search/index", 202);
    await capacityButtonRequest(page, capacityRankingPanel(page, data.challenge.id).getByRole("button", { name: "申请重建排名", exact: true }), `/api/ranking/challenges/${data.challenge.id}/projection`, 202);
    const before = await h.client.dataJob.count({ where: { requestedByUserId: data.owner.id } });
    const replay = await capacityButtonRequest(page, panel.getByRole("button", { name: "重试同一索引请求", exact: true }), "/api/search/index", 202);
    assert.equal(replay.job.id, acceptedId); assert.equal(await h.client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), before);
  } finally { await page.unroute("**/api/search/index"); }
}

async function workspaceQuotaBrowser(h: CapacityBrowserHarness) {
  const data = await createCapacityCase(h.client, h.fixture, "browser-workspace-total", h.passwordHash);
  const owner = await capacityPage(h, data.owner.email); const member = await capacityPage(h, data.member.email); h.diagnostic(owner.page);
  try {
    await h.check("workspace-total-counts-other-requesters-without-disclosing-them", async () => {
      assert.equal((await capacityApi(owner.page, "/api/system/data-jobs", "POST", { kind: "EXPORT", scope: "WORKSPACE", workspaceId: data.workspace.id, idempotencyKey: randomUUID() })).status, 202);
      for (let generation = 0; generation < 2; generation++) {
        assert.equal((await capacityApi(member.page, "/api/search/index", "POST", { workspaceId: data.workspace.id, expectedGeneration: generation, idempotencyKey: randomUUID() })).status, 202);
      }
      await configurePanels(owner.page, data);
      const panel = capacityRankingPanel(owner.page, data.challenge.id);
      const body = await capacityButtonRequest(owner.page, panel.getByRole("button", { name: "申请重建排名", exact: true }), `/api/ranking/challenges/${data.challenge.id}/projection`, 429);
      assert.deepEqual(body, { error: "DATA_JOB_QUOTA_WORKSPACE_ACTIVE_LIMIT" });
      h.screenshots.push(...await capacityCaptureViews(owner.page, panel, "ranking-workspace-total", /当前工作区的后台任务总名额已满/, "申请重建排名"));
    });
  } finally { await settleCapacityCase(h.client, data); await owner.context.close(); await member.context.close(); }
}

async function instanceQuotaBrowser(h: CapacityBrowserHarness) {
  const first = await createCapacityCase(h.client, h.fixture, "browser-instance-a", h.passwordHash);
  const second = await createCapacityCase(h.client, h.fixture, "browser-instance-b", h.passwordHash);
  const caller = await createCapacityCase(h.client, h.fixture, "browser-instance-c", h.passwordHash);
  const owned = await capacityPage(h, caller.owner.email); const page = owned.page;
  try {
    await h.check("instance-total-across-users-and-workspaces-has-bounded-ui-recovery", async () => {
      for (const data of [first, second]) {
        await requestCapacityCase(h.client, data, "EXPORT");
        await requestCapacityCase(h.client, data, "SEARCH_INDEX_REBUILD", { secondary: true });
      }
      await configurePanels(page, caller);
      const panel = capacityExportPanel(page);
      const body = await capacityButtonRequest(page, panel.getByRole("button", { name: "创建导出任务", exact: true }), "/api/system/data-jobs", 429);
      assert.deepEqual(body, { error: "DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT" });
      h.screenshots.push(...await capacityCaptureViews(page, panel, "export-instance-total", /系统后台任务总名额暂满/, "创建导出任务"));
      const task = await capacityApi(page, "/api/tasks", "POST", { idempotencyKey: randomUUID(), subjectId: caller.subject.id,
        title: "CAPACITY 实例满额仍可学习", type: "study", estimatedMinutes: 20 });
      assert.equal(task.status, 201);
    });
  } finally {
    for (const data of [first, second, caller]) await settleCapacityCase(h.client, data);
    await owned.context.close();
  }
}
