import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { storageUsedBytes } from "./storage-quota-runtime-data";
import { storagePage, httpUpload, storageApi, assertDownload, assertPrivate, pdf, type StorageBrowserHarness } from "./storage-quota-browser-support";

const staging = "/api/study-resources/uploads/staging";
const resolve = "/api/study-resources/uploads/resolve";
export async function storageApiJourney(h: StorageBrowserHarness) {
  await h.check("API normal note/exact-limit/over-limit/replay/download", async () => {
    const d = await h.createCase("api-note"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      const url = `/api/notes/${d.note.id}/attachments`; const key = randomUUID();
      const first = await httpUpload(page, url, [127], key); assert.equal(first.status, 201); assertPrivate(first.body);
      const metadata = await h.client.attachment.findUniqueOrThrow({ where: { id: first.body.attachment.id } });
      assert.equal(metadata.sizeBytes, 127); assert.equal(metadata.hash, createHash("sha256").update(pdf(127).buffer).digest("hex"));
      assert.equal(first.body.attachment.mimeType, "application/pdf"); assert.equal(first.body.attachment.sizeBytes, 127);
      assert.equal((await httpUpload(page, url, [127], key)).body.attachment.id, first.body.attachment.id);
      await assertDownload(page, first.body.attachment.downloadApiPath, 127);
      assert.equal((await httpUpload(page, url, [129])).status, 201);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 256n);
      const rejected = await httpUpload(page, url, [64]); assert.equal(rejected.status, 429); assertPrivate(rejected.body);
      assert.equal(await h.client.attachment.count({ where: { ownerUserId: d.owner.id } }), 2);
      await assertDownload(page, first.body.attachment.downloadApiPath, 127);
      const before = await storageApi(page, `/api/notes/${d.note.id}`); assert.equal(before.status, 200);
      assert.equal((await storageApi(page, `/api/notes/${d.note.id}`, "PATCH", { expectedRevision: before.body.note.revision, content: "满额仍可保存学习正文" })).status, 200);
      const task = await storageApi(page, "/api/tasks", "POST", { idempotencyKey: randomUUID(), subjectId: d.subject.id, title: "满额学习", type: "study", estimatedMinutes: 20 });
      assert.equal(task.status, 201);
      const detail = await storageApi(page, `/api/tasks/${task.body.task.id}`); assert.equal(detail.status, 200);
      assert.equal((await storageApi(page, `/api/tasks/${task.body.task.id}/drop`, "POST", {})).status, 200);
    } finally { await context.close(); }
  });
  await h.check("API FILE partial-batch/fixed-error-receipt/new-explicit-retry", async () => {
    const d = await h.createCase("api-batch"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      assert.equal((await httpUpload(page, `/api/notes/${d.note.id}/attachments`, [257])).status, 429);
      const key = randomUUID(); const batch = await httpUpload(page, staging, [180, 120], key);
      assert.equal(batch.status, 201); assert.ok(batch.body.items[0].staging); assert.ok(batch.body.items[1].error);
      assert.deepEqual((await httpUpload(page, staging, [180, 120], key)).body, batch.body);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 180n);
      const id = batch.body.items[0].staging.attachment.id;
      assert.equal((await storageApi(page, resolve, "POST", { attachmentId: id, decision: "skip" })).status, 200);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 0n);
      assert.deepEqual((await httpUpload(page, staging, [180, 120], key)).body, batch.body);
      assert.ok((await httpUpload(page, staging, [120])).body.items[0].staging);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 120n);
    } finally { await context.close(); }
  });
  await h.check("API copy/finalize/reuse/skip/cleanup-failure-and-recovery", async () => {
    const d = await h.createCase("api-decisions"); const { context, page } = await storagePage(h, d.owner.email);
    try {
      const stage = async (size = 64) => { const r = await httpUpload(page, staging, [size]); assert.equal(r.status, 201); assert.ok(r.body.items[0].staging); return r.body.items[0].staging; };
      const first = await stage(); const copy = { attachmentId: first.attachment.id, decision: "copy", title: "API 正式资料" };
      const created = await storageApi(page, resolve, "POST", copy); assert.equal(created.status, 200); assertPrivate(created.body);
      assert.equal((await storageApi(page, resolve, "POST", copy)).body.resource.id, created.body.resource.id);
      await assertDownload(page, `/api/study-resources/${created.body.resource.id}/download`, 64);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 64n);
      const second = await stage(); assert.ok(second.duplicates.length);
      const reuse = { attachmentId: second.attachment.id, decision: "reuse", reuseResourceId: created.body.resource.id };
      assert.equal((await storageApi(page, resolve, "POST", reuse)).status, 200);
      const released = await h.client.attachment.findUniqueOrThrow({ where: { id: second.attachment.id } }); assert.ok(released.storageReleasedAt);
      await storageApi(page, resolve, "POST", reuse);
      assert.deepEqual((await h.client.attachment.findUniqueOrThrow({ where: { id: second.attachment.id } })).storageReleasedAt, released.storageReleasedAt);
      const third = await stage(192); const skip = { attachmentId: third.attachment.id, decision: "skip" };
      const uploadRoot = path.join(h.fixture.root, "uploads");
      const target = await h.client.attachment.findUniqueOrThrow({ where: { id: third.attachment.id } });
      const filePath = target.stagingName ? path.join(uploadRoot, ".staging", target.stagingName) : path.join(uploadRoot, target.storedName);
      const containerFile = target.stagingName ? `/app/uploads/.staging/${target.stagingName}` : `/app/uploads/${target.storedName}`;
      const alterLink = (create: boolean) => execFileSync("docker", ["exec", "areaforge-dev-test-3", "node", "-e",
        create ? 'const f=require("fs"),p=process.argv[1]; f.linkSync(p,p+".fixture-failure"); if(f.lstatSync(p).nlink!==2)throw Error("LINK_NOT_INJECTED")'
          : 'const f=require("fs"),p=process.argv[1]; if(f.existsSync(p+".fixture-failure"))f.unlinkSync(p+".fixture-failure"); if(f.lstatSync(p).nlink!==1)throw Error("LINK_NOT_RESTORED")', containerFile]);
      try { alterLink(true); assert.equal((await storageApi(page, resolve, "POST", skip)).status, 200); }
      finally { alterLink(false); }
      const failed = await h.client.attachment.findUniqueOrThrow({ where: { id: third.attachment.id } });
      assert.equal(failed.storageReleasedAt, null); assert.equal(await storageUsedBytes(h.client, d.workspace.id), 256n);
      await access(filePath);
      assert.equal((await httpUpload(page, `/api/notes/${d.note.id}/attachments`, [64])).status, 429);
      assert.equal((await storageApi(page, resolve, "POST", skip)).status, 200);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 64n);
      assert.ok((await h.client.attachment.findUniqueOrThrow({ where: { id: third.attachment.id } })).storageReleaseProof);
      await assert.rejects(access(filePath));
    } finally { await context.close(); }
  });
  await h.check("API Owner-only/anonymous/member/outsider/cross-workspace", async () => {
    const d = await h.createCase("api-permissions"); const owned = await storagePage(h, d.owner.email);
    try {
      const file = await httpUpload(owned.page, `/api/notes/${d.note.id}/attachments`, [256]); assert.equal(file.status, 201);
      for (const actor of [undefined, d.member.email, d.outsider.email]) {
        const { context, page } = await storagePage(h, actor);
        try {
          for (const url of [`/api/notes/${d.note.id}/attachments`, staging]) {
            const result = await httpUpload(page, url, [64]); assert.equal(result.status, actor ? 404 : 401); assertPrivate(result.body);
            assert.doesNotMatch(JSON.stringify(result.body), /256|合成文件|storage-/);
          }
          assert.equal((await storageApi(page, file.body.attachment.downloadApiPath)).status, actor ? 404 : 401);
        } finally { await context.close(); }
      }
      const grant = await h.client.workspaceShareGrant.create({ data: { workspaceId: d.workspace.id, resourceOwnerUserId: d.owner.id,
        grantedByUserId: d.owner.id, scope: "USER", granteeUserId: d.member.id, resourceType: "ATTACHMENT", resourceId: file.body.attachment.id, access: "VIEW" } });
      const shared = await storagePage(h, d.member.email);
      try {
        await assertDownload(shared.page, file.body.attachment.downloadApiPath, 256);
        assert.equal((await httpUpload(shared.page, `/api/notes/${d.note.id}/attachments`, [64])).status, 404);
        await h.client.workspaceShareGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revokedByUserId: d.owner.id } });
        assert.equal((await storageApi(shared.page, file.body.attachment.downloadApiPath)).status, 404);
      } finally { await shared.context.close(); }
      await h.client.workspaceSelection.update({ where: { userId: d.owner.id }, data: { workspaceId: d.secondary.workspace.id } });
      const other = await httpUpload(owned.page, `/api/notes/${d.note.id}/attachments`, [64]); assert.equal(other.status, 404); assertPrivate(other.body);
      assert.equal((await httpUpload(owned.page, `/api/notes/${d.secondary.note.id}/attachments`, [64])).status, 201);
      assert.equal(await storageUsedBytes(h.client, d.workspace.id), 256n);
      assert.equal(await storageUsedBytes(h.client, d.secondary.workspace.id), 64n);
    } finally { await owned.context.close(); }
  });
}
