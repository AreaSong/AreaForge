import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright-core";
import type { PrismaClient } from "../../packages/db/src/index";
import { loadDevTestStorageFixture } from "../dev/dev-test-storage-fixture";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { quotaBrowserContext, quotaLogin, quotaApi, type QuotaPool } from "./quota-browser-support";
import type { StorageQuotaFixture } from "./storage-quota-fixture";
import type { StorageCase } from "./storage-quota-runtime-data";

export { quotaApi as storageApi };
export interface StorageBrowserHarness {
  browser: Browser; pool: QuotaPool; fixture: StorageQuotaFixture; client: PrismaClient;
  password: string; passwordHash: string; output: string; runId: string; screenshots: string[]; errors: string[];
  check: (name: string, run: () => Promise<void>) => Promise<void>;
  createCase: (label: string) => Promise<StorageCase>;
}
export function requireStoragePool(fixture: StorageQuotaFixture, databaseUrl: string, policy: "bounded" | "invalid" = "bounded") {
  const expected = loadDevTestStorageFixture(process.cwd(), { AREAFORGE_DEV_TEST_STORAGE_FIXTURE_ROOT: fixture.root,
    AREAFORGE_STORAGE_QUOTA_ISOLATED_DB: "1", AREAFORGE_DEV_TEST_DATABASE_URL: databaseUrl })!;
  const pool = JSON.parse(execFileSync("pnpm", ["dev:test:latest", "--", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).latest as QuotaPool;
  assert.equal(pool.slot, 3); assert.equal(pool.status, "running"); assert.equal(pool.fixtureId, expected.id);
  assert.equal(pool.url, `http://127.0.0.1:${pool.port}`); assert.equal(pool.sourceFingerprint, computeProductExperienceSourceHash());
  const [container] = JSON.parse(execFileSync("docker", ["inspect", "areaforge-dev-test-3"], { encoding: "utf8" }));
  const env = Object.fromEntries(container.Config.Env.map((entry: string) => { const i = entry.indexOf("="); return [entry.slice(0, i), entry.slice(i + 1)]; }));
  assert.equal(env.WORKSPACE_STORAGE_QUOTA_MAX_BYTES, policy === "bounded" ? "256" : "invalid");
  for (const key of ["AI_ENABLED", "DATA_JOB_WORKER_ENABLED", "OPS_EXECUTION_ENABLED", "DATA_DELETE_WORKER_ENABLED"])
    assert.equal(env[key], "false");
  assert.ok(!env.SMTP_HOST && !env.AI_API_KEY);
  assert.deepEqual(container.HostConfig.PortBindings, { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: String(pool.port) }] });
  assert.equal(container.Mounts.length, 2);
  for (const [name, writable] of [["uploads", true], ["exports", false]] as const) {
    const mount = container.Mounts.find((m: { Destination: string }) => m.Destination === `/app/${name}`);
    assert.equal(mount.Source, path.join(fixture.root, name)); assert.equal(mount.RW, writable);
  }
  return { ...pool, storagePolicy: policy };
}
export async function storagePage(h: StorageBrowserHarness, email?: string) {
  const context = await quotaBrowserContext(h.browser, h.pool, h.errors);
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  if (email) await quotaLogin(page, email, h.password); else await page.goto("/login");
  return { context, page };
}
export function pdf(size: number, name = "合成附件.pdf") {
  const prefix = "%PDF-1.4\n%STORAGE-BROWSER\n";
  assert.ok(size >= prefix.length + 6);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(prefix + " ".repeat(size - prefix.length - 6) + "%%EOF\n") };
}
export async function httpUpload(page: Page, url: string, sizes: number[], key = randomUUID()) {
  return page.evaluate(async input => {
    const form = new FormData();
    for (const file of input.files) form.append("file", new Blob([file.text], { type: "application/pdf" }), file.name);
    const response = await fetch(input.url, { method: "POST", headers: { "idempotency-key": input.key }, body: form });
    return { status: response.status, body: await response.json() };
  }, { url, key, files: sizes.map((size, index) => ({ name: `合成文件-${index}.pdf`, text: pdf(size).buffer.toString() })) });
}
export async function assertDownload(page: Page, url: string, size: number) {
  const result = await page.evaluate(async url => {
    const response = await fetch(url); return { status: response.status, cache: response.headers.get("cache-control"), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, url);
  assert.equal(result.status, 200); assert.match(result.cache ?? "", /private|no-store/);
  assert.deepEqual(Buffer.from(result.bytes), pdf(size).buffer);
}
export function assertPrivate(body: unknown) {
  assert.doesNotMatch(JSON.stringify(body), /storageWorkspaceId|storageReleasedAt|storageReleaseProof|storedName|upload:\/\/|\/app\/uploads|postgresql:/);
}
export async function captureStorageViews(h: StorageBrowserHarness, page: Page, label: string, text: string) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const notice = page.getByText(text, { exact: false }).last(); await notice.waitFor(); await notice.scrollIntoViewIfNeeded();
    assert.equal(await notice.isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "HORIZONTAL_OVERFLOW");
    assert.equal(await notice.evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight; }), true, "FEEDBACK_CLIPPED");
    const screenshot = `${h.runId}-${label}-${width}.png`;
    await page.screenshot({ path: path.join(h.output, screenshot) }); h.screenshots.push(screenshot);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
export function recordStorageAttempt(h: StorageBrowserHarness, result: object) {
  appendFileSync(path.join(h.output, "cases.jsonl"), JSON.stringify({ runId: h.runId, ...result }) + "\n");
}
