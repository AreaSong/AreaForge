import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadQuotaFixture, quotaFixtureEnvironment, assertQuotaFixtureContainer, verifyQuotaFixtureLedger } from "./quota-fixture";
import { quotaSourceFingerprint } from "./quota-source";

const passed: string[] = []; let current = "fixture";
const selected = process.argv[3]?.startsWith("--case=") ? process.argv[3].slice(7) : undefined;
async function check(name: string, run: () => Promise<void>) {
  if (selected && name !== selected && name !== "canonical-54-migration-ledger") return;
  current = name; await run(); passed.push(name); console.log(`PASS ${name}`);
}

async function main() {
  const fixture = loadQuotaFixture(process.argv[2] ?? ""); assertQuotaFixtureContainer(fixture);
  const env = quotaFixtureEnvironment(fixture); Object.assign(process.env, env);
  const { prisma } = await import("../../packages/db/src/index");
  const { quotaClient, quotaKinds } = await import("./quota-runtime-data");
  const cases = await import("./quota-runtime-cases");
  const concurrency = await import("./quota-concurrency-runtime");
  const processes = await import("./quota-process-runtime");
  const sourceFingerprint = quotaSourceFingerprint(); const client = quotaClient(env.DATABASE_URL!);
  try {
    await check("canonical-54-migration-ledger", async () => { assert.equal(await verifyQuotaFixtureLedger(client, fixture), 54); });
    for (const kind of quotaKinds) await check(`${kind}-admission-idempotency-and-control`, () => cases.quotaDomainAdmission(client, fixture, kind));
    await check("requester-workspace-and-account-partitions", () => cases.quotaPartitions(client, fixture));
    await check("disabled-and-invalid-policy-do-not-break-existing-controls", () => cases.quotaDisabledAndInvalid(client, fixture));
    await check("authorization-precedes-quota", () => cases.quotaAuthorizationFirst(client, fixture));
    await check("cancelled-exports-still-charge-24h-window", () => cases.quotaExportWindow(client, fixture));
    await check("half-open-window-and-clock-rollback", () => cases.quotaTimeBoundary(client, fixture));
    await check("all-resumable-states-reserve-active-slots", () => cases.quotaActiveStates(client, fixture));
    for (const kind of quotaKinds) await check(`${kind}-failure-replay-and-running-cancel`, () => cases.quotaFailureReplayAndCancel(client, fixture, kind));
    await check("notifications-and-deletion-are-not-quota-gated", () => cases.quotaNonTarget(client, fixture));
    await check("three-real-domain-producers-share-atomic-quota", () => concurrency.quotaConcurrentDomains(client, fixture));
    await check("parallel-same-key-is-one-admission", () => concurrency.quotaConcurrentKeys(client, fixture, true));
    await check("parallel-distinct-keys-never-exceed-active-limit", () => concurrency.quotaConcurrentKeys(client, fixture, false));
    await check("parallel-exports-never-exceed-window-limit", () => concurrency.quotaConcurrentExportWindow(client, fixture));
    await check("late-old-snapshot-is-aborted-not-overadmitted", () => concurrency.quotaOldSnapshot(client, fixture));
    await check("unsupported-isolation-and-abort-leave-no-admission", () => concurrency.quotaIsolationAndRollback(client, fixture));
    await check("admission-clock-and-disabled-default-clock", () => concurrency.quotaAdmissionClock(client, fixture));
    await check("independent-processes-share-database-quota", () => processes.quotaMultiProcess(client, fixture));
    await check("counted-and-written-SIGKILL-roll-back-admission", () => processes.quotaProducerCrashes(client, fixture));
    await check("no-domain-consumers-files-or-projections", () => cases.quotaNoDomainEffects(client, fixture));
    assert.equal(quotaSourceFingerprint(), sourceFingerprint, "QUOTA_SOURCE_CHANGED");
    if (selected) { assert.equal(passed.length, 2, "QUOTA_SELECTED_CASE_MISSING"); return; }
    await mkdir(path.resolve("output/quota"), { recursive: true });
    await writeFile(path.resolve("output/quota/runtime-evidence.json"), JSON.stringify({ schemaVersion: 1, scope: "QUOTA local admission runtime",
      checkedAt: new Date().toISOString(), fixtureId: fixture.scopeId, migrations: 54, sourceFingerprint, passed,
      domainConsumersExecuted: false, productionTouched: false }, null, 2) + "\n");
    console.log(`PASS QUOTA runtime ${passed.length} groups; admission only`);
  } finally { await client.$disconnect(); await prisma.$disconnect(); }
}

main().catch(error => {
  const row = error as { name?: string; code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } };
  const databaseCode = row.meta?.driverAdapterError?.cause?.originalCode;
  console.error(JSON.stringify({ event: "QUOTA_RUNTIME_FAILED", case: current, name: row.name,
    code: /^[A-Z0-9_]{1,80}$/.test(row.code ?? "") ? row.code : undefined,
    databaseCode: /^[A-Z0-9]{5}$/.test(databaseCode ?? "") ? databaseCode : undefined })); process.exitCode = 1;
});
