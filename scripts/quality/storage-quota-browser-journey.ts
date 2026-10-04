import assert from "node:assert/strict";
import { storageUsedBytes } from "./storage-quota-runtime-data";
import { captureStorageViews, pdf, storagePage, recordStorageAttempt, httpUpload, storageApi, assertDownload, type StorageBrowserHarness } from "./storage-quota-browser-support";

export async function storageBrowserJourney(h: StorageBrowserHarness) {
  await h.check("UI note upload/pending/full-error/desktop-390-320", async () => {
    const d = await h.createCase("ui-note"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      await page.goto("/knowledge/cards");
      await page.getByText("附件 (0)", { exact: true }).click();
      const input = page.locator('input[type="file"]');
      let uploads = 0; let release!: () => void;
      const barrier = new Promise<void>(done => { release = done; });
      await page.route(`**/api/notes/${d.note.id}/attachments`, async route => { uploads++; const response = await route.fetch(); await barrier; await route.fulfill({ response }); });
      const accepted = page.waitForResponse(r => r.url().endsWith(`/api/notes/${d.note.id}/attachments`));
      await input.setInputFiles(pdf(256, "恰好满额.pdf"));
      await page.getByText("上传中", { exact: true }).waitFor(); assert.equal(await input.isDisabled(), true);
      release(); assert.equal((await accepted).status(), 201);
      await page.getByText("恰好满额.pdf", { exact: true }).waitFor(); await page.unroute(`**/api/notes/${d.note.id}/attachments`);
      assert.equal(await input.evaluate((n: HTMLInputElement) => n.files?.length), 0);
      assert.equal(uploads, 1); assert.equal(await storageUsedBytes(h.client, d.workspace.id), 256n);
      const refused = page.waitForResponse(r => r.url().endsWith(`/api/notes/${d.note.id}/attachments`));
      await input.setInputFiles(pdf(64, "满额保留.pdf")); assert.equal((await refused).status(), 429);
      const alert = page.locator('p[role="alert"]'); await alert.waitFor(); recordStorageAttempt(h, { observation: "note-alert", text: await alert.innerText() });
      await captureStorageViews(h, page, "note-limit", "当前工作区的附件存储额度已满");
      assert.equal(await page.getByText("恰好满额.pdf", { exact: true }).isVisible(), true);
      assert.equal(await input.isEnabled(), true); await input.focus(); assert.equal(await input.evaluate(n => n === document.activeElement), true);
      assert.equal(await input.evaluate((n: HTMLInputElement) => n.files?.[0]?.name), "满额保留.pdf");
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const response = page.waitForResponse(r => r.url().endsWith(`/api/notes/${d.note.id}/attachments`));
        const retry = page.getByRole("button", { name: "重试上传", exact: true }); await retry.focus(); await page.keyboard.press("Enter");
        assert.equal((await response).status(), 429);
        await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "重试上传");
        assert.equal(await input.evaluate((n: HTMLInputElement) => n.files?.[0]?.name), "满额保留.pdf");
      }
      const download = page.waitForEvent("download"); await page.getByRole("link", { name: "下载", exact: true }).click();
      assert.equal((await download).suggestedFilename(), "恰好满额.pdf");
    } finally { await context.close(); }
  });
  await h.check("UI FILE batch partial-failure/input-retention/no-silent-retry", async () => {
    const d = await h.createCase("ui-batch"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      await page.goto("/knowledge/resources?create=1");
      await page.getByLabel("标签", { exact: true }).fill("本轮验收保留输入");
      await page.locator('input[type="file"]').setInputFiles([pdf(180, "成功资料.pdf"), pdf(120, "额度不足资料.pdf")]);
      let requests = 0; page.on("request", r => { if (r.url().includes("/api/study-resources/uploads/staging") && r.method() === "POST") requests++; });
      let release!: () => void; const barrier = new Promise<void>(done => { release = done; });
      await page.route("**/api/study-resources/uploads/staging", async route => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch(); await barrier; await route.fulfill({ response });
      });
      const response = page.waitForResponse(r => r.url().includes("/api/study-resources/uploads/staging") && r.request().method() === "POST");
      await page.getByRole("button", { name: "上传并逐项检查", exact: true }).dblclick();
      assert.equal(await page.locator('input[type="file"]').isDisabled(), true);
      assert.equal(await page.getByLabel("标签", { exact: true }).isDisabled(), true);
      release(); assert.equal((await response).status(), 201); await page.unroute("**/api/study-resources/uploads/staging");
      await page.getByText("失败", { exact: true }).first().waitFor();
      recordStorageAttempt(h, { observation: "resource-dialog", text: await page.getByRole("dialog").innerText() });
      await captureStorageViews(h, page, "resource-partial", "当前工作区的附件存储额度已满");
      assert.equal(await page.getByLabel("标签", { exact: true }).inputValue(), "本轮验收保留输入");
      assert.equal(requests, 1); assert.equal(await storageUsedBytes(h.client, d.workspace.id), 180n);
      assert.equal(await h.client.studyResource.count({ where: { ownerUserId: d.owner.id, sourceType: "FILE" } }), 1);
      assert.equal(await page.locator('input[type="file"]').isEnabled(), true);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const retry = page.getByRole("button", { name: "重试失败文件", exact: true }); await retry.focus();
        assert.equal(await retry.evaluate(node => node === document.activeElement), true);
        const result = page.waitForResponse(r => r.url().includes("/uploads/staging") && r.request().method() === "POST");
        await page.keyboard.press("Enter"); const body = await (await result).json(); assert.equal(body.items.length, 1); assert.ok(body.items[0].error);
        await page.getByRole("button", { name: "重试失败文件", exact: true }).waitFor();
        await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "重试失败文件");
        assert.equal(await storageUsedBytes(h.client, d.workspace.id), 180n);
      }
    } finally { await context.close(); }
  });
  await h.check("UI duplicate decisions/copy/reuse/skip and keyboard narrow screens", async () => {
    const d = await h.createCase("ui-decisions"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      const staged = await httpUpload(page, "/api/study-resources/uploads/staging", [64]);
      const id = staged.body.items[0].staging.attachment.id;
      const original = await storageApi(page, "/api/study-resources/uploads/resolve", "POST", { attachmentId: id, decision: "copy", title: "复用目标" });
      assert.equal(original.status, 200);
      for (const [decision, width, expected] of [["reuse", 1440, 64n], ["skip", 390, 64n], ["copy", 320, 128n]] as const) {
        await page.setViewportSize({ width, height: 900 }); await page.goto("/knowledge/resources?create=1");
        await page.locator('input[type="file"]').setInputFiles(pdf(64, "重复资料.pdf"));
        await page.getByRole("button", { name: "上传并逐项检查", exact: true }).click();
        const select = page.getByLabel("重复资料.pdf重复处理", { exact: true }); await select.waitFor(); await select.selectOption(decision);
        const button = page.getByRole("button", { name: "应用全部决策", exact: true }); await button.focus();
        const response = page.waitForResponse(r => r.url().endsWith("/uploads/resolve")); await page.keyboard.press("Enter"); assert.equal((await response).status(), 200);
        assert.equal(await storageUsedBytes(h.client, d.workspace.id), expected);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      await assertDownload(page, `/api/study-resources/${original.body.resource.id}/download`, 64);
    } finally { await context.close(); }
  });
  await h.check("UI failed FILE explicit retry after precise release succeeds", async () => {
    const d = await h.createCase("ui-retry"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      const staged = await httpUpload(page, "/api/study-resources/uploads/staging", [192]); const id = staged.body.items[0].staging.attachment.id;
      await page.goto("/knowledge/resources?create=1");
      await page.locator('input[type="file"]').setInputFiles(pdf(128, "保留并重试.pdf"));
      await page.getByRole("button", { name: "上传并逐项检查", exact: true }).click();
      await page.getByText("当前工作区的附件存储额度已满", { exact: false }).waitFor();
      assert.equal((await storageApi(page, "/api/study-resources/uploads/resolve", "POST", { attachmentId: id, decision: "skip" })).status, 200);
      const response = page.waitForResponse(r => r.url().endsWith("/uploads/resolve"));
      await page.getByRole("button", { name: "重试失败文件", exact: true }).click(); assert.equal((await response).status(), 200);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 128n);
      await page.getByRole("button", { name: "重试失败文件", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await page.getByText("当前工作区的附件存储额度已满", { exact: false }).count(), 0);
    } finally { await context.close(); }
  });
  await h.check("UI accepted FILE response lost; explicit retry reuses request and finishes once", async () => {
    const d = await h.createCase("ui-lost-file"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      await page.goto("/knowledge/resources?create=1"); await page.locator('input[type="file"]').setInputFiles(pdf(64, "丢回执资料.pdf"));
      const keys: string[] = []; let lost = false;
      await page.route("**/api/study-resources/uploads/staging", async route => {
        if (route.request().method() !== "POST") return route.continue();
        keys.push(route.request().headers()["idempotency-key"]!);
        if (lost) return route.continue();
        lost = true; const accepted = await route.fetch(); assert.equal(accepted.status(), 201); await route.abort("failed");
      });
      await page.getByRole("button", { name: "上传并逐项检查", exact: true }).click();
      const retry = page.getByRole("button", { name: "重试失败文件", exact: true }); await retry.waitFor();
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 64n);
      const result = page.waitForResponse(r => r.url().endsWith("/uploads/resolve")); await retry.click(); assert.equal((await result).status(), 200);
      await retry.waitFor({ state: "hidden" }); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 64n);
      assert.equal(await h.client.attachment.count({ where: { ownerUserId: d.owner.id } }), 1);
    } finally { await context.close(); }
  });
}
