import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { prisma } from "../../packages/db/src/index";
import { exportFileName } from "../../packages/storage/src/index";
import type { ExportFixture } from "./data-export-runtime-fixture";

export async function verifyExportBrowserApi(input: { owner: BrowserContext; other: BrowserContext; fixture: ExportFixture; jobId: string }) {
  const { owner, other, fixture, jobId } = input;
  const grantPath = `/api/system/data-jobs/${jobId}/download-grants`;
  assert.equal((await other.request.get(`/api/system/data-jobs/${jobId}`)).status(), 404, "other actor job lookup");
  assert.equal((await other.request.post(grantPath, { data: {} })).status(), 404, "other actor grant issuance");
  const forged = await owner.request.post("/api/system/data-jobs", { data: { kind: "EXPORT", scope: "ACCOUNT", idempotencyKey: randomUUID(), requestedByUserId: fixture.other.id } });
  assert.equal(forged.status(), 400);
  const issued = await owner.request.post(grantPath, { data: {} }); assert.equal(issued.status(), 201);
  const grant = (await issued.json() as { grant: { id: string; token: string } }).grant;
  assert.equal((await other.request.post("/api/system/data-jobs/download-grants/redeem", { data: { token: grant.token } })).status(), 404, "other actor grant redemption");
  const downloads = await Promise.all([1, 2].map(() => owner.request.post("/api/system/data-jobs/download-grants/redeem", { data: { token: grant.token } })));
  assert.equal(downloads.filter(response => response.status() === 200).length, 1);
  const response = downloads.find(value => value.status() === 200)!;
  assert.equal(response.headers()["content-type"], "application/zip");
  assert.equal(response.headers()["cache-control"], "private, no-store"); assert.equal(response.headers()["x-content-type-options"], "nosniff");
  assert.equal((await response.body()).byteLength, Number(response.headers()["content-length"]));
  assert.match(response.headers()["content-disposition"]!, /^attachment;/);
  const revoked = await owner.request.post(grantPath, { data: {} });
  const token = (await revoked.json() as { grant: { token: string } }).grant.token;
  assert.equal((await owner.request.delete(grantPath)).status(), 200);
  assert.equal((await owner.request.post("/api/system/data-jobs/download-grants/redeem", { data: { token } })).status(), 404, "revoked grant redemption");
  const expired = await owner.request.post(grantPath, { data: {} }); const expiry = (await expired.json() as { grant: { id: string; token: string } }).grant;
  await prisma.dataExportDownloadGrant.update({ where: { id: expiry.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await owner.request.post("/api/system/data-jobs/download-grants/redeem", { data: { token: expiry.token } })).status(), 404, "expired grant redemption");
}

export async function verifyExportBrowserRecovery(input: { page: Page; fixture: ExportFixture; jobId: string; output: string }) {
  const { page, fixture, jobId, output } = input;
  const center = page.locator('section[aria-labelledby="data-job-center-title"]'); const row = page.locator(`[data-job-id="${jobId}"]`);
  await page.route("**/api/system/data-jobs", route => route.request().method() === "GET" ? route.abort("failed") : route.fallback());
  await center.getByRole("button", { name: "刷新任务", exact: true }).click();
  await center.getByRole("status").filter({ hasText: "正在显示上次取得的状态" }).waitFor();
  assert.ok(await row.getByRole("button", { name: "下载 ZIP", exact: true }).isVisible());
  await page.unroute("**/api/system/data-jobs");
  const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId } });
  const archive = path.join(fixture.roots.exportRoot, exportFileName(pkg.objectKey, ".zip"));
  const backup = path.join(fixture.base, `${fixture.prefix}.browser-missing-copy`);
  await rename(archive, backup);
  try {
    await row.getByRole("button", { name: "下载 ZIP", exact: true }).click();
    await center.getByRole("alert").filter({ hasText: "文件缺失或校验不一致" }).waitFor();
    await page.screenshot({ path: path.join(output, "desktop-file-recovery.png"), fullPage: true });
  } finally { await rename(backup, archive); }
  const legacy = await prisma.dataJob.create({ data: { kind: "EXPORT", scope: "ACCOUNT", requestedByUserId: fixture.actor.id, status: "SUCCEEDED",
    queueVersion: 0, idempotencyKey: randomUUID(), requestFingerprint: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000) } });
  await center.getByRole("button", { name: "刷新任务", exact: true }).click();
  const old = page.locator(`[data-job-id="${legacy.id}"]`); await old.waitFor();
  assert.equal(await old.getByRole("button", { name: "下载 ZIP", exact: true }).count(), 0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await row.scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `unexpected horizontal page overflow at ${width}`);
    const download = row.getByRole("button", { name: "下载 ZIP", exact: true });
    const bounds = await download.boundingBox(); assert.ok(bounds && bounds.height >= 44);
    await download.focus(); assert.ok(await download.evaluate(element => element === document.activeElement));
    await page.screenshot({ path: path.join(output, `mobile-${width}-recovery.png`), fullPage: true });
  }
  await center.getByLabel("任务类型", { exact: true }).selectOption("DELETE");
  assert.ok(await center.getByRole("button", { name: "创建删除预览任务", exact: true }).isDisabled());
  assert.ok((await center.textContent())!.includes("未开放"));
}
