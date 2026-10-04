import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadStorageQuotaFixture, assertStorageQuotaFixtureContainer, storageQuotaFixtureEnvironment, verifyStorageQuotaFixtureLedger } from "./storage-quota-fixture";
import { storageQuotaSourceFingerprint } from "./storage-quota-source";
import { requireStoragePool, recordStorageAttempt, type StorageBrowserHarness } from "./storage-quota-browser-support";

async function main() {
  const fixture = loadStorageQuotaFixture(process.argv[2] ?? ""); assertStorageQuotaFixtureContainer(fixture);
  const output = path.resolve(process.argv[3] ?? ""); assert.ok(existsSync(path.join(output, "baseline.json")));
  const env = storageQuotaFixtureEnvironment(fixture);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  const { createPrismaClient, prisma } = await import("../../packages/db/src/index");
  const { hashPassword } = await import("../../packages/auth/src/index");
  const { createStorageCase } = await import("./storage-quota-runtime-data");
  const { storageApiJourney } = await import("./storage-quota-api-journey");
  const { storageBrowserJourney } = await import("./storage-quota-browser-journey");
  const { prepareStorageInvalid, storageInvalidJourney } = await import("./storage-quota-invalid-journey");
  const client = createPrismaClient(env.DATABASE_URL, { max: 6 });
  const pool = requireStoragePool(fixture, env.DATABASE_URL!, process.argv.includes("--invalid") ? "invalid" : "bounded"); await verifyStorageQuotaFixtureLedger(client, fixture);
  const password = `Synthetic-Storage-${randomUUID()}9!`; const passwordHash = await hashPassword(password);
  const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
  const sourceFingerprint = storageQuotaSourceFingerprint(); const runId = String(Date.now()); const passed: string[] = []; const failed: string[] = [];
  const h: StorageBrowserHarness = { browser, pool, fixture, client, password, passwordHash, output, runId, errors: [], screenshots: [],
    createCase: label => createStorageCase(client, fixture, label, passwordHash),
    check: async (name, run) => {
      if (process.argv.includes("--ui-only") && name.startsWith("API")) return;
      try { await run(); passed.push(name); recordStorageAttempt(h, { name, result: "pass" }); console.log("PASS " + name); }
      catch (error) {
        failed.push(name); const row = error as Error;
        const detail = row.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]");
        recordStorageAttempt(h, { name, result: "fail", detail, location: row.stack?.split("\n").filter(line => line.includes("storage-quota-")).slice(0, 2) }); console.error("FAIL " + name + " " + detail.slice(0, 350));
      }
    } };
  try {
    if (process.argv.includes("--invalid")) await storageInvalidJourney(h);
    else { await storageApiJourney(h); await storageBrowserJourney(h); await prepareStorageInvalid(h); }
    assert.equal(storageQuotaSourceFingerprint(), sourceFingerprint, "SOURCE_CHANGED_DURING_RUN");
    const result = { runId, sourceFingerprint, pool, fixtureScopeId: fixture.scopeId, migrations: 55,
      passed, failed, screenshots: h.screenshots, pageErrors: h.errors, viewports: [1440, 390, 320], productionTouched: false };
    writeFileSync(path.join(output, `journey-${runId}.json`), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    if (failed.length || h.errors.length) process.exitCode = 1;
  } finally { await browser.close(); await client.$disconnect(); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
