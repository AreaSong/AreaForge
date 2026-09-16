import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { loadCapacityFixture, capacityFixtureEnvironment, assertCapacityFixtureContainer, verifyCapacityFixtureLedger } from "./capacity-fixture";
import { capacitySourceFingerprint } from "./capacity-source";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { capacityBrowserOutput, requireCapacityPool, capacityPage, type CapacityBrowserHarness } from "./capacity-browser-support";

let current = "fixture"; let diagnosticPage: Page | undefined;
const passed: string[] = []; const screenshots: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  current = name;
  try { await run(); passed.push(name); console.log(`PASS browser ${name}`); }
  catch (error) {
    if (diagnosticPage && !diagnosticPage.isClosed()) await diagnosticPage.screenshot({ path: path.join(capacityBrowserOutput, "failure.png") }).catch(() => undefined);
    throw error;
  }
}

async function main() {
  const fixture = loadCapacityFixture(process.argv[2] ?? ""); assertCapacityFixtureContainer(fixture);
  const env = capacityFixtureEnvironment(fixture); Object.assign(process.env, env);
  const { hashPassword } = await import("../../packages/auth/src/index");
  const { capacityClient } = await import("./capacity-runtime-data");
  const { capacityNoConsumers } = await import("./capacity-job-runtime");
  const { capacityMemberBrowser } = await import("./capacity-member-browser");
  const { capacityJobBrowser } = await import("./capacity-job-browser");
  const { prisma } = await import("../../packages/db/src/index");
  const pool = requireCapacityPool(fixture, env.DATABASE_URL!); const client = capacityClient(env.DATABASE_URL!);
  await verifyCapacityFixtureLedger(client, fixture);
  const password = `Synthetic-Capacity-${randomUUID()}9!`; const sourceFingerprint = capacitySourceFingerprint(); const errors: string[] = [];
  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
  await mkdir(capacityBrowserOutput, { recursive: true });
  const harness: CapacityBrowserHarness = { browser, pool, fixture, client, password, passwordHash: await hashPassword(password), errors, screenshots,
    check, diagnostic: page => { diagnosticPage = page; } };
  try {
    await check("unauthenticated-private-paths-remain-closed", async () => {
      const anonymous = await capacityPage(harness);
      try { assert.equal((await anonymous.context.request.get("/api/system/data-jobs")).status(), 401); }
      finally { await anonymous.context.close(); }
    });
    await capacityMemberBrowser(harness); await capacityJobBrowser(harness);
    await check("no-domain-consumers-artifacts-or-browser-errors", async () => { await capacityNoConsumers(client, fixture); assert.deepEqual(errors, []); });
    assert.equal(capacitySourceFingerprint(), sourceFingerprint, "CAPACITY_SOURCE_CHANGED");
    assert.equal(computeProductExperienceSourceHash(), pool.sourceFingerprint);
    await writeFile(path.join(capacityBrowserOutput, "evidence.json"), JSON.stringify({ schemaVersion: 1, scope: "CAPACITY local admission browser/API",
      checkedAt: new Date().toISOString(), sourceFingerprint, pool, viewports: [1440, 390, 320], screenshots, passed, pageErrors: errors,
      simulatedTransportFailures: ["invitation preview 503", "search accepted receipt body lost"],
      domainConsumersExecuted: false, physicalDeletionExecuted: false, productionTouched: false }, null, 2) + "\n");
    console.log(`PASS CAPACITY browser/API ${passed.length} groups`);
  } finally { await browser.close(); await client.$disconnect(); await prisma.$disconnect(); }
}

main().catch(error => {
  const row = error as { name?: string; code?: string; stack?: string };
  console.error(JSON.stringify({ event: "CAPACITY_BROWSER_FAILED", case: current, name: row.name,
    code: /^[A-Z0-9_]{1,80}$/.test(row.code ?? "") ? row.code : undefined,
    locations: row.stack?.split("\n").filter(line => line.trim().startsWith("at ") && line.includes("/scripts/quality/capacity-")).slice(0, 3) }));
  process.exitCode = 1;
});
