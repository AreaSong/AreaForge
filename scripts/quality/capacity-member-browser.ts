import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCapacityCase, seedCapacityInvitation } from "./capacity-runtime-data";
import { capacitySignal, waitCapacityBarrier } from "./capacity-transaction-fixture";
import { capacityApi, capacityButtonRequest, capacityCaptureViews, capacityPage, type CapacityBrowserHarness } from "./capacity-browser-support";

export async function capacityMemberBrowser(h: CapacityBrowserHarness) {
  const data = await createCapacityCase(h.client, h.fixture, "browser-member", h.passwordHash);
  const pending = await seedCapacityInvitation(h.client, h.fixture, { workspaceId: data.workspace.id, owner: data.owner, email: data.stranger.email });
  const owner = await capacityPage(h, data.owner.email); const guest = await capacityPage(h, data.stranger.email);
  const page = guest.page; h.diagnostic(page);
  try {
    await h.check("invitation-preview-interruption-and-retry", async () => {
      let first = true;
      await page.route("**/api/workspace-invitations/preview", async route => {
        if (!first) return route.continue(); first = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SYNTHETIC_PREVIEW_UNAVAILABLE"}' });
      });
      await page.goto(`/invitations/accept#token=${encodeURIComponent(pending.token)}`);
      await page.getByText("暂时无法读取邀请，请稍后重试。", { exact: true }).waitFor();
      await capacityButtonRequest(page, page.getByRole("button", { name: "重新读取邀请", exact: true }), "/api/workspace-invitations/preview", 200);
      await page.getByText(`受邀邮箱：${data.stranger.email}`, { exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, ""); await page.unroute("**/api/workspace-invitations/preview");
    });
    await h.check("real-member-quota-busy-is-recoverable-and-double-click-is-single-request", async () => {
      const locked = capacitySignal(); const release = capacitySignal(); let requests = 0;
      const count = (request: { url(): string; method(): string }) => { if (new URL(request.url()).pathname === "/api/workspace-invitations/accept" && request.method() === "POST") requests++; };
      page.on("request", count);
      const holder = h.client.$transaction(async tx => {
        const key = `areaforge:workspace-member-quota:v1:${data.workspace.id}`;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`; locked.release(); await release.promise;
      }, { timeout: 15_000 });
      try {
        await waitCapacityBarrier(locked.promise, holder);
        const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/workspace-invitations/accept");
        await page.getByRole("button", { name: "接受邀请", exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
        const result = await response; assert.equal(result.status(), 503);
        assert.deepEqual(await result.json(), { error: "WORKSPACE_MEMBER_QUOTA_BUSY" });
        await page.getByText(/成员状态正在变化/).waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "status");
        assert.equal(requests, 1);
      } finally { release.release(); await holder; page.off("request", count); }
    });
    await h.check("real-full-member-seat-keeps-token-focus-and-narrow-layout", async () => {
      const body = await capacityButtonRequest(page, page.getByRole("button", { name: "接受邀请", exact: true }), "/api/workspace-invitations/accept", 429);
      assert.deepEqual(body, { error: "WORKSPACE_MEMBER_QUOTA_LIMIT" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "status");
      assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem("areaforge.workspace-invitation-token"))), true);
      h.screenshots.push(...await capacityCaptureViews(page, page.locator('[aria-busy]').first(), "member-full", /成员席位已满/, "接受邀请", "notice"));
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.getByRole("button", { name: "接受邀请", exact: true }).evaluate(node => node === document.activeElement), true);
    });
    await h.check("member-seat-release-real-retry-success-and-consumed-token-stays-409", async () => {
      const member = await h.client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
      assert.equal((await capacityApi(owner.page, `/api/exam-workspaces/${data.workspace.id}/members/${member.id}`, "DELETE", { expectedRevision: member.revision })).status, 200);
      await capacityButtonRequest(page, page.getByRole("button", { name: "接受邀请", exact: true }), "/api/workspace-invitations/accept", 200);
      await page.getByRole("link", { name: "进入工作区", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem("areaforge.workspace-invitation-token"))), false);
      const replay = await capacityApi(page, "/api/workspace-invitations/accept", "POST", { token: pending.token });
      assert.equal(replay.status, 409); assert.equal(replay.body.error, "WORKSPACE_INVITATION_CONTINUATION_REQUIRED");
      assert.equal(await h.client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
    });
  } finally { await guest.context.close(); await owner.context.close(); }
  await capacityRegistrationBrowser(h);
}

async function capacityRegistrationBrowser(h: CapacityBrowserHarness) {
  const data = await createCapacityCase(h.client, h.fixture, "browser-registration", h.passwordHash);
  const email = `${data.prefix}-new@example.test`;
  const pending = await seedCapacityInvitation(h.client, h.fixture, { workspaceId: data.workspace.id, owner: data.owner, email });
  const owner = await capacityPage(h, data.owner.email); const newcomer = await capacityPage(h); const page = newcomer.page;
  try {
    await h.check("registration-quota-rejection-retains-password-with-no-partial-account", async () => {
      await page.goto(`/invitations/accept#token=${encodeURIComponent(pending.token)}`);
      await page.getByText(`受邀邮箱：${email}`, { exact: true }).waitFor();
      await page.getByLabel("仅新账户需要设置密码", { exact: true }).fill(h.password);
      const before = await h.client.examWorkspace.count();
      await capacityButtonRequest(page, page.getByRole("button", { name: "接受邀请", exact: true }), "/api/workspace-invitations/accept", 429);
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "status");
      assert.equal(await page.getByLabel("仅新账户需要设置密码", { exact: true }).inputValue(), h.password);
      assert.equal(await h.client.user.count({ where: { email } }), 0); assert.equal(await h.client.examWorkspace.count(), before);
      assert.equal((await h.client.workspaceInvitation.findUniqueOrThrow({ where: { id: pending.invitation.id } })).status, "PENDING");
      h.screenshots.push(...await capacityCaptureViews(page, page.locator('[aria-busy]').first(), "registration-full", /成员席位已满/, "接受邀请", "notice"));
    });
    await h.check("registration-retry-creates-one-account-personal-owner-and-session", async () => {
      const member = await h.client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
      assert.equal((await capacityApi(owner.page, `/api/exam-workspaces/${data.workspace.id}/members/${member.id}`, "DELETE", { expectedRevision: member.revision })).status, 200);
      await capacityButtonRequest(page, page.getByRole("button", { name: "接受邀请", exact: true }), "/api/workspace-invitations/accept", 200);
      await page.getByRole("link", { name: "进入工作区", exact: true }).waitFor();
      const created = await h.client.user.findUniqueOrThrow({ where: { email } });
      const personal = await h.client.examWorkspace.findFirstOrThrow({ where: { userId: created.id, stableKey: "personal" } });
      assert.equal(await h.client.workspaceMembership.count({ where: { workspaceId: personal.id, userId: created.id, role: "OWNER" } }), 1);
      assert.equal((await capacityApi(page, "/api/system/data-jobs")).status, 200);
      assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem("areaforge.workspace-invitation-token"))), false);
      await page.getByRole("link", { name: "进入工作区", exact: true }).click(); await page.waitForURL(url => url.pathname === "/settings/workspaces");
      assert.equal((await capacityApi(page, "/api/exam-workspaces", "POST", { stableKey: `capacity-${randomUUID()}`, name: "浏览器个人空间", activate: false })).status, 201);
    });
  } finally { await newcomer.context.close(); await owner.context.close(); }
}
