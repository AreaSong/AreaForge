import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storageUsedBytes } from "./storage-quota-runtime-data";
import { storagePage, storageApi, httpUpload, assertDownload, captureStorageViews, pdf, type StorageBrowserHarness } from "./storage-quota-browser-support";

const privateFile = ".browser-invalid.private.json";
export async function prepareStorageInvalid(h: StorageBrowserHarness) {
  const file = path.join(h.fixture.root, privateFile);
  if (existsSync(file)) return;
  const data = await h.createCase("invalid-policy"); const { context, page } = await storagePage(h, data.owner.email);
  try {
    const uploaded = await httpUpload(page, `/api/notes/${data.note.id}/attachments`, [128]); assert.equal(uploaded.status, 201);
    const task = await storageApi(page, "/api/tasks", "POST", { idempotencyKey: randomUUID(), subjectId: data.subject.id, title: "配置错误前的已有任务", type: "study", estimatedMinutes: 20 });
    assert.equal(task.status, 201);
    writeFileSync(file, JSON.stringify({ fixtureScope: h.fixture.scopeId, password: h.password, email: data.owner.email,
      noteId: data.note.id, workspaceId: data.workspace.id, download: uploaded.body.attachment.downloadApiPath, taskId: task.body.task.id }), { flag: "wx", mode: 0o600 });
  } finally { await context.close(); }
}
export async function storageInvalidJourney(h: StorageBrowserHarness) {
  const state = JSON.parse(readFileSync(path.join(h.fixture.root, privateFile), "utf8"));
  assert.equal(state.fixtureScope, h.fixture.scopeId); h.password = state.password;
  await h.check("API/UI invalid-policy blocks-only-upload; read/download/text/task-control survive", async () => {
    const { context, page } = await storagePage(h, state.email);
    try {
      const result = await httpUpload(page, `/api/notes/${state.noteId}/attachments`, [64]);
      assert.equal(result.status, 503); assert.equal(result.body.error, "WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID");
      const detail = await storageApi(page, `/api/notes/${state.noteId}`); assert.equal(detail.status, 200);
      assert.equal((await storageApi(page, `/api/notes/${state.noteId}`, "PATCH", { expectedRevision: detail.body.note.revision, content: "坏配置时仍可保存学习正文" })).status, 200);
      await assertDownload(page, state.download, 128);
      assert.equal((await storageApi(page, `/api/tasks/${state.taskId}/drop`, "POST", {})).status, 200);
      assert.equal(await storageUsedBytes(h.client, state.workspaceId), 128n);
      await page.goto("/knowledge/cards"); await page.getByText("附件 (1)", { exact: true }).click();
      await page.locator('input[type="file"]').setInputFiles(pdf(64, "配置恢复后重试.pdf"));
      await captureStorageViews(h, page, "invalid-policy", "存储额度配置暂不可用");
      const retry = page.getByRole("button", { name: "重试上传", exact: true }); await retry.focus();
      assert.equal(await retry.evaluate(node => node === document.activeElement), true);
      await page.goto("/knowledge/resources?create=1");
      await page.locator('input[type="file"]').setInputFiles(pdf(64, "坏配置资料.pdf"));
      const batch = page.waitForResponse(r => r.url().endsWith("/uploads/staging") && r.request().method() === "POST");
      await page.getByRole("button", { name: "上传并逐项检查", exact: true }).click();
      const response = await batch; assert.equal(response.status(), 201); assert.ok((await response.json()).items[0].error);
      await page.getByText("存储额度配置暂不可用", { exact: false }).waitFor();
      assert.equal(await storageUsedBytes(h.client, state.workspaceId), 128n);
    } finally { await context.close(); }
  });
}
