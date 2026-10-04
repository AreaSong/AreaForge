import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadCapacityFixture, capacityFixtureEnvironment, assertCapacityFixtureContainer, verifyCapacityFixtureLedger } from "./capacity-fixture";
import { capacitySourceFingerprint } from "./capacity-source";

const passed: string[] = []; let current = "fixture";
const selected = process.argv[3]?.startsWith("--case=") ? process.argv[3].slice(7) : undefined;
async function check(name: string, run: () => Promise<void>) {
  if (selected && name !== selected && name !== "canonical-54-migration-ledger") return;
  current = name; await run(); passed.push(name); console.log(`PASS ${name}`);
}

async function main() {
  const fixture = loadCapacityFixture(process.argv[2] ?? ""); assertCapacityFixtureContainer(fixture);
  const env = capacityFixtureEnvironment(fixture); Object.assign(process.env, env);
  const { prisma } = await import("../../packages/db/src/index");
  const { capacityClient, capacityKinds } = await import("./capacity-runtime-data");
  const member = await import("./capacity-member-runtime"); const jobs = await import("./capacity-job-runtime");
  const concurrent = await import("./capacity-concurrency-runtime"); const processes = await import("./capacity-process-runtime");
  const sourceFingerprint = capacitySourceFingerprint(); const client = capacityClient(env.DATABASE_URL!);
  try {
    await check("canonical-54-migration-ledger", async () => { assert.equal(await verifyCapacityFixtureLedger(client, fixture), 54); });
    await check("member-seat-release-rejoin-and-token-replay", () => member.capacityMemberLifecycle(client, fixture));
    await check("registration-rejection-rolls-back-account-personal-space-and-audit", () => member.capacityRegistrationRollback(client, fixture));
    await check("member-suspension-freeze-and-cancel-preserve-occupancy", () => member.capacityMemberSuspensionAndFreeze(client, fixture));
    await check("workspace-archive-restore-owner-transfer-and-overlimit-exit", () => member.capacityMemberArchiveAndOwner(client, fixture));
    await check("member-config-disabled-existing-occupant-and-personal-workspace", () => member.capacityMemberPolicyAndPersonal(client, fixture));
    await check("invitation-authorization-expiry-revocation-and-mail-failure", () => member.capacityMemberAuthorizationAndMail(client, fixture));
    await check("user-total-spans-workspaces-and-account", () => jobs.capacityUserTotal(client, fixture));
    await check("workspace-total-spans-requesters", () => jobs.capacityWorkspaceTotal(client, fixture));
    await check("instance-total-spans-users-workspaces-and-kinds", () => jobs.capacityInstanceTotal(client, fixture));
    await check("old-and-new-switch-four-combinations", () => jobs.capacitySwitchCombinations(client, fixture));
    await check("partition-denial-rolls-back-total-admission-and-search-generation", () => jobs.capacityPartitionRollback(client, fixture));
    await check("invalid-policy-receipt-reuse-and-zero-limit-control", () => jobs.capacityInvalidAndExisting(client, fixture));
    await check("resumable-states-and-expiry-preserve-total-occupancy", () => jobs.capacityStatesAndExpiry(client, fixture));
    await check("frozen-job-hidden-read-does-not-refund-capacity", () => jobs.capacityFrozenJobs(client, fixture));
    for (const kind of capacityKinds) await check(`${kind}-pause-replay-and-running-cancel-release`, () => jobs.capacityExistingControls(client, fixture, kind));
    await check("authorization-and-nontarget-old-protocol-exclusion", () => jobs.capacityAuthorizationAndKinds(client, fixture));
    await check("three-real-domain-producers-compete-atomically", () => concurrent.capacityConcurrentDomains(client, fixture));
    await check("same-key-parallel-receipt-is-single-admission", () => concurrent.capacityConcurrentSameKey(client, fixture));
    await check("old-job-snapshot-aborts-after-other-commit", () => concurrent.capacityOldJobSnapshot(client, fixture));
    await check("old-member-snapshot-aborts-after-other-join", () => concurrent.capacityOldMemberSnapshot(client, fixture));
    await check("concurrent-invitations-admit-only-final-seat", () => concurrent.capacityConcurrentMembers(client, fixture));
    await check("unsupported-isolation-and-forced-abort-have-no-side-effect", () => concurrent.capacityIsolationAndAtomicAbort(client, fixture));
    await check("real-adapter-statement-and-lock-timeout-mapping", () => concurrent.capacityDatabaseErrorShapes(client, fixture));
    for (const axis of ["user", "workspace", "instance"] as const) await check(`${axis}-total-six-independent-processes`, () => processes.capacityMultiProcessJobs(client, fixture, axis));
    await check("member-final-seat-six-independent-processes", () => processes.capacityMultiProcessMembers(client, fixture));
    await check("search-count-and-precommit-SIGKILL-roll-back-generation-and-job", () => processes.capacitySearchProcessCrashes(client, fixture));
    await check("registration-count-and-precommit-SIGKILL-roll-back-account-and-space", () => processes.capacityRegistrationProcessCrashes(client, fixture));
    await check("no-domain-consumers-files-projections-or-physical-delete", () => jobs.capacityNoConsumers(client, fixture));
    assert.equal(capacitySourceFingerprint(), sourceFingerprint, "CAPACITY_SOURCE_CHANGED");
    if (selected) { assert.equal(passed.length, 2, "CAPACITY_SELECTED_CASE_MISSING"); return; }
    await mkdir(path.resolve("output/capacity"), { recursive: true });
    await writeFile(path.resolve("output/capacity/runtime-evidence.json"), JSON.stringify({ schemaVersion: 1, scope: "CAPACITY local admission runtime",
      checkedAt: new Date().toISOString(), fixtureId: fixture.scopeId, migrations: 54, sourceFingerprint, passed,
      domainConsumersExecuted: false, physicalDeletionExecuted: false, productionTouched: false }, null, 2) + "\n");
    console.log(`PASS CAPACITY runtime ${passed.length} groups; admission only`);
  } finally { await client.$disconnect(); await prisma.$disconnect(); }
}

main().catch(error => {
  const row = error as { name?: string; code?: string; stack?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
  const databaseCode = row.meta?.code ?? row.meta?.driverAdapterError?.cause?.originalCode;
  console.error(JSON.stringify({ event: "CAPACITY_RUNTIME_FAILED", case: current, name: row.name,
    code: /^[A-Z0-9_]{1,80}$/.test(row.code ?? "") ? row.code : undefined,
    databaseCode: /^[A-Z0-9]{5}$/.test(databaseCode ?? "") ? databaseCode : undefined,
    locations: row.stack?.split("\n").filter(line => line.trim().startsWith("at ") && line.includes("/scripts/quality/capacity-")).slice(0, 3) }));
  process.exitCode = 1;
});
