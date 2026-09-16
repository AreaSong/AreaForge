import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { searchBrowserApi, searchPanel, searchJobRow, requestSearchFromUi, dynamicSearch } from "./search-index-browser-support";
import type { SearchCase } from "./search-index-runtime-data";

export async function searchLostReceipt(page: Page, data: SearchCase) {
  let lost = true; const bodies: unknown[] = []; const ids: string[] = []; const url = "**/api/search/index";
  await page.route(url, async route => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON()); const response = await route.fetch(); assert.equal(response.status(), 202);
    ids.push((await response.json()).job.id);
    if (lost) { lost = false; return route.fulfill({ status: 202, contentType: "application/json", body: "{" }); }
    return route.fulfill({ response });
  });
  const panel = searchPanel(page, data.workspace.id);
  await panel.getByRole("button", { name: "重建我的索引", exact: true }).click();
  await panel.getByRole("button", { name: "重试同一索引请求", exact: true }).click();
  await searchJobRow(page, ids[0]!).waitFor(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.deepEqual(bodies[0], bodies[1]);
  await page.unroute(url); return ids[0]!;
}

export async function searchLateRefresh(page: Page, data: SearchCase, previous: string) {
  await searchJobRow(page, previous).getByRole("button", { name: "取消", exact: true }).click();
  await searchJobRow(page, previous).getByText("已取消", { exact: true }).waitFor();
  let release!: () => void; let fetched!: () => void;
  const ready = new Promise<void>(resolve => { fetched = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
  const url = "**/api/search/index?*"; let delivery: Promise<void> | undefined; let failure = false;
  await page.route(url, route => {
    if (delivery) return route.continue();
    delivery = (async () => { const response = await route.fetch(); fetched(); await pending; await route.fulfill({ response }); })().catch(() => { failure = true; fetched(); });
    return delivery;
  });
  try {
    await searchPanel(page, data.workspace.id).getByRole("button", { name: "刷新索引状态", exact: true }).click(); await ready;
    assert.equal(failure, false); const id = await requestSearchFromUi(page, data.workspace.id); release(); await delivery;
    assert.equal(failure, false); await searchJobRow(page, id).waitFor();
    assert.equal(await searchPanel(page, data.workspace.id).getByRole("button", { name: "重建我的索引", exact: true }).isEnabled(), false);
    return id;
  } finally { release(); await delivery; await page.unroute(url); }
}

export async function searchWorkspacePendingReply(page: Page, data: SearchCase) {
  let release!: () => void; let fetched!: () => void;
  const ready = new Promise<void>(resolve => { fetched = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
  const url = "**/api/search/index"; let delivery: Promise<void> | undefined; let failure = false; let job: { id: string; revision: number } | undefined;
  await page.route(url, route => {
    if (route.request().method() !== "POST") return route.continue();
    delivery = (async () => { const response = await route.fetch(); job = (await response.json()).job; fetched(); await pending; await route.fulfill({ response }); })()
      .catch(() => { failure = true; fetched(); });
    return delivery;
  });
  try {
    await searchPanel(page, data.workspace.id).getByRole("button", { name: "重建我的索引", exact: true }).click(); await ready; assert.ok(job);
    await page.getByLabel("索引工作区", { exact: true }).selectOption(data.secondary.id);
    await searchPanel(page, data.secondary.id).waitFor(); release(); await delivery;
    assert.equal(failure, false); assert.equal(await searchJobRow(page, job.id).count(), 0);
    assert.equal((await searchBrowserApi(page, `/api/search/index/jobs/${job.id}`, "PATCH", { workspaceId: data.workspace.id, expectedRevision: job.revision, action: "CANCEL" })).status, 200);
    await page.getByLabel("索引工作区", { exact: true }).selectOption(data.workspace.id);
  } finally { release(); await delivery; await page.unroute(url); }
}

export async function searchLatestQueryAndFailure(page: Page) {
  let release!: () => void; let fetched!: () => void;
  const ready = new Promise<void>(resolve => { fetched = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
  const url = "**/api/search?*"; let delivery: Promise<void> | undefined;
  await page.route(url, route => {
    if (new URL(route.request().url()).searchParams.get("q") !== "SEARCH 本人") return route.continue();
    delivery = (async () => { const response = await route.fetch(); fetched(); await pending; await route.fulfill({ response }); })(); return delivery;
  });
  try {
    await page.keyboard.press("Meta+k"); const input = page.getByRole("textbox", { name: "全局灵动岛搜索与命令输入框", exact: true });
    await input.fill("SEARCH 本人"); await ready;
    const next = page.waitForResponse(response => new URL(response.url()).searchParams.get("q") === "SEARCH 他人");
    await input.fill("SEARCH 他人"); await next; await page.getByRole("option").filter({ hasText: "SEARCH 他人笔记" }).waitFor();
    release(); await delivery; assert.equal(await page.getByRole("option").filter({ hasText: "SEARCH 本人" }).count(), 0);
  } finally { release(); await delivery; await page.unroute(url); }
  await page.route(url, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SYNTHETIC_UNAVAILABLE"}' }));
  await dynamicSearch(page, "SEARCH 失败"); await page.getByText("工作区搜索暂时不可用，命令仍可使用", { exact: true }).waitFor();
  assert.equal(await page.getByRole("option").filter({ hasText: "SEARCH 他人笔记" }).count(), 0);
  await page.unroute(url); await page.keyboard.press("Escape");
}
