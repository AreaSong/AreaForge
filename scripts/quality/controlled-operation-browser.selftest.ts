import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { hashPassword } from "../../packages/auth/src/index";
import { createPrismaClient, prisma } from "../../packages/db/src/index";
import { loadOperationFixture, operationFixtureEnvironment, verifyOperationFixtureLedger } from "./controlled-operation-fixture";
import { loadDevTestOpsFixture } from "../dev/dev-test-ops-fixture";
import { prepareOperationCase } from "./controlled-operation-fixture-driver";
import { seedOperationActors, operationRequestBinding, createOperationFixtureRequest } from "./controlled-operation-runtime-data";
import { startOperationFixtureAgent } from "./controlled-operation-process";
import { computeProductExperienceSourceHash } from "./product-experience-source";

const password = "Synthetic-OPS-Only-42!";
const output = path.resolve("output/playwright/controlled-operations");
type Pool = { slot: number; port: number; url: string; status: string; fixtureId: string; sourceFingerprint: string; buildId: string };
const panel = (page: Page) => page.locator('section[aria-label="受控运维请求"]');
const row = (page: Page, id: string) => page.locator(`[data-operation-id="${id}"]`);

async function main() {
  const fixture = loadOperationFixture(process.argv[2] ?? ""); const env = operationFixtureEnvironment(fixture);
  Object.assign(process.env, env);
  const pool = requirePool(fixture.root, env.DATABASE_URL!);
  const client = createPrismaClient(env.DATABASE_URL); await verifyOperationFixtureLedger(client, fixture);
  const actors = await seedOperationActors(client, fixture, await hashPassword(password));
  const data = await prepareOperationCase(fixture, `browser-${randomUUID().slice(0, 8)}`);
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ ...(existsSync(chrome) ? { executablePath: chrome } : {}), headless: true });
  const errors: string[] = [];
  await mkdir(output, { recursive: true });
  try {
    const context = await browserContext(browser, pool, errors);
    assert.equal((await context.request.get("/api/system/operations")).status(), 401);
    const page = await context.newPage(); page.on("dialog", dialog => void dialog.accept());
    await login(page, fixture.operatorEmail); await page.goto("/settings/system");
    await panel(page).getByRole("heading", { name: "已绑定执行前态", exact: true }).waitFor();
    assert.equal(await panel(page).getByLabel("expected-before hash", { exact: true }).getAttribute("readonly"), "");
    await panel(page).getByLabel("运维操作的当前密码", { exact: true }).fill(password);
    await panel(page).getByRole("button", { name: "验证运维身份", exact: true }).click();
    await panel(page).getByText("身份已验证，可以确认和审批运维请求。", { exact: true }).waitFor();
    await panel(page).getByLabel("申请理由", { exact: true }).fill("OPS 浏览器合成诊断");
    let lost = true; const bodies: Record<string, unknown>[] = []; const requestIds: string[] = [];
    await page.route("**/api/system/operations/requests", async route => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postDataJSON()); const response = await route.fetch();
      assert.equal(response.status(), 202); requestIds.push((await response.json()).request.id);
      if (lost) { lost = false; return route.abort(); }
      return route.fulfill({ response });
    });
    await panel(page).getByRole("button", { name: "提交受控请求", exact: true }).click();
    await panel(page).getByRole("button", { name: "重试同一请求", exact: true }).waitFor();
    await panel(page).getByRole("button", { name: "重试同一请求", exact: true }).click();
    await row(page, requestIds[0]).waitFor();
    assert.equal(requestIds.length, 2); assert.equal(requestIds[0], requestIds[1]); assert.deepEqual(bodies[0], bodies[1]);
    await page.unroute("**/api/system/operations/requests");
    await row(page, requestIds[0]).getByRole("button", { name: "确认", exact: true }).click();
    await row(page, requestIds[0]).getByText("排队中", { exact: true }).waitFor();
    assert.equal((await startOperationFixtureAgent(fixture, data.name, requestIds[0]).done).code, 0);
    await refresh(page); await row(page, requestIds[0]).getByText("成功", { exact: true }).waitFor();
    await row(page, requestIds[0]).getByText("阶段证据历史", { exact: true }).click();
    await row(page, requestIds[0]).getByText(/原始证据：sha256:/).first().waitFor();
    const detail = await api(page, `/api/system/operations/requests/${requestIds[0]}`);
    assert.equal(detail.status, 200); assert.ok(detail.body.evidence.length >= 5);
    const encoded = JSON.stringify(detail.body);
    for (const forbidden of [fixture.root, env.DATABASE_URL!, fixture.password, fixture.sessionSecret, fixture.actionSecret]) assert.equal(encoded.includes(forbidden), false);
    assert.ok(detail.body.evidence.every((event: { environment: string }) => event.environment === "local_fixture"));
    await captureViews(page);

    const memberContext = await browserContext(browser, pool, errors); const memberPage = await memberContext.newPage();
    await login(memberPage, actors.member.email);
    assert.equal((await api(memberPage, "/api/system/operations")).status, 404);
    assert.equal((await api(memberPage, `/api/system/operations/requests/${requestIds[0]}`)).status, 404);
    assert.equal((await api(memberPage, "/api/system/operations/requests", "POST", bodies[0])).status, 404);
    await memberContext.close();
    const invalid = { ...bodies[0], idempotencyKey: randomUUID(), operation: { operation: "DIAGNOSTIC_HEALTH", includeCapacity: false, command: "forbidden" } };
    assert.equal((await api(page, "/api/system/operations/requests", "POST", invalid)).status, 400);
    assert.equal((await api(page, "/api/system/operations/requests", "POST", { ...bodies[0], idempotencyKey: randomUUID(), executionSnapshotHash: `sha256:${"f".repeat(64)}` })).status, 409);

    const apply = await prepareOperationCase(fixture, `browser-apply-${randomUUID().slice(0, 8)}`);
    await page.setViewportSize({ width: 1440, height: 1000 }); await refresh(page);
    await panel(page).getByLabel("白名单操作", { exact: true }).selectOption("APPLY_RELEASE");
    await panel(page).getByLabel("申请理由", { exact: true }).fill("独立合成应用，不操作生产");
    const createdResponse = page.waitForResponse(response => response.url().endsWith("/api/system/operations/requests") && response.request().method() === "POST");
    await panel(page).getByRole("button", { name: "提交受控请求", exact: true }).click();
    const pending = (await (await createdResponse).json()).request;
    await row(page, pending.id).getByText("待确认", { exact: true }).waitFor();
    await row(page, pending.id).getByRole("button", { name: "确认", exact: true }).click();
    await row(page, pending.id).getByRole("button", { name: "审批", exact: true }).waitFor();
    await row(page, pending.id).getByRole("button", { name: "审批", exact: true }).click();
    await row(page, pending.id).getByText("排队中", { exact: true }).waitFor();
    const agent = startOperationFixtureAgent(fixture, apply.name, pending.id, { pauseAt: "validation:started" });
    try {
      await agent.waitFor("validation:started"); await refresh(page);
      await row(page, pending.id).getByRole("button", { name: "挂起", exact: true }).click();
      await row(page, pending.id).getByText("等待安全挂起", { exact: true }).waitFor();
      assert.equal(await row(page, pending.id).getByRole("button", { name: "恢复", exact: true }).count(), 0);
      await row(page, pending.id).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, "desktop-stop-pending.png") });
      agent.continue(); assert.equal((await agent.done).code, 0);
    } finally { agent.stop(); await agent.done; }
    await refresh(page); await row(page, pending.id).getByRole("button", { name: "恢复", exact: true }).click();
    await row(page, pending.id).getByText("排队中", { exact: true }).waitFor();
    assert.equal((await startOperationFixtureAgent(fixture, apply.name, pending.id).done).code, 0);
    await refresh(page); await row(page, pending.id).getByText("成功", { exact: true }).waitFor();

    const cancelledContext = await prepareOperationCase(fixture, `browser-cancel-${randomUUID().slice(0, 8)}`);
    const cancelled = await createOperationFixtureRequest(actors.operator, cancelledContext.context, { operation: "DIAGNOSTIC_HEALTH", includeCapacity: false });
    await refresh(page); await row(page, cancelled.id).getByRole("button", { name: "取消", exact: true }).click();
    await row(page, cancelled.id).getByText("已取消", { exact: true }).waitFor();
    assert.equal((await api(page, `/api/system/operations/requests/${cancelled.id}/resume`, "POST", operationRequestBinding(cancelled))).status, 409);
    assert.deepEqual(errors, []); assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash());
    await writeFile(path.join(output, "evidence.json"), JSON.stringify({ scope: "OPS local fixture browser/API", checkedAt: new Date().toISOString(), pool,
      viewports: ["1440x1000", "390x844", "320x844"], passed: ["real-login", "operator-only", "reauth", "immutable-context", "lost-response-same-request", "two-step-approval", "root-execution", "phase-history-hashes", "hold-pending-barrier", "resume", "cancel", "strict-input", "no-secret", "keyboard", "no-horizontal-overflow"],
      pageErrors: errors, productionTouched: false }, null, 2) + "\n");
    await context.close(); console.log("PASS OPS browser/API: authenticated Operator, root fixture, history, desktop/390px/320px");
  } finally { await browser.close(); await client.$disconnect(); await prisma.$disconnect(); }
}
function requirePool(root: string, databaseUrl: string): Pool {
  const fixture = loadDevTestOpsFixture(process.cwd(), { AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT: root, AREAFORGE_OPS_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl });
  const pool = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).latest as Pool;
  assert.ok(pool && fixture); assert.equal(pool.fixtureId, fixture.id); assert.equal(pool.status, "running");
  assert.equal(pool.url, `http://127.0.0.1:${pool.port}`); assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash()); return pool;
}
async function browserContext(browser: Browser, pool: Pool, errors: string[]) {
  const context = await browser.newContext({ baseURL: pool.url, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", extraHTTPHeaders: { Origin: pool.url } });
  context.on("page", page => page.on("pageerror", error => errors.push(error.name)));
  await context.route("**/*", route => { const url = new URL(route.request().url()); return url.origin === pool.url || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort(); });
  return context;
}
async function login(page: Page, email: string) {
  await page.goto("/login"); await page.getByLabel("邮箱", { exact: true }).fill(email); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录并继续学习", exact: true }).click(); await page.waitForURL(url => url.pathname !== "/login");
}
async function api(page: Page, url: string, method = "GET", body?: unknown) {
  return page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: "same-origin", ...(input.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { url, method, body });
}
async function refresh(page: Page) {
  const response = page.waitForResponse(result => result.url().includes("/api/system/operations/requests?") && result.request().method() === "GET");
  await panel(page).getByRole("button", { name: "刷新请求", exact: true }).click(); await response;
  await panel(page).getByRole("button", { name: "刷新请求", exact: true }).waitFor({ state: "visible" });
}
async function captureViews(page: Page) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await panel(page).getByRole("heading", { name: "已绑定执行前态", exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const targets = await panel(page).getByRole("button").evaluateAll(elements => elements.map(element => ({ label: element.textContent?.trim(), height: element.getBoundingClientRect().height })));
    await page.screenshot({ path: path.join(output, `${width === 1440 ? "desktop" : `mobile-${width}`}-context.png`) });
    assert.ok(targets.every(target => target.height >= 44), JSON.stringify(targets.filter(target => target.height < 44)));
    const button = panel(page).getByRole("button", { name: "刷新请求", exact: true }); await button.focus(); assert.equal(await button.evaluate(element => element === document.activeElement), true);
    await button.press("Enter");
    await panel(page).getByRole("heading", { name: "已绑定执行前态", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${width === 1440 ? "desktop" : `mobile-${width}`}-context.png`) });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.stack : "OPS_BROWSER_FAILED"); process.exitCode = 1; });
