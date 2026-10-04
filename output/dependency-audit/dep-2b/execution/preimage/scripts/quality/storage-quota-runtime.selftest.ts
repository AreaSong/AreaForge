import assert from "node:assert/strict";
import { saveStorageQuotaEvidence } from "./storage-quota-evidence";
import { loadStorageQuotaFixture, storageQuotaFixtureEnvironment, assertStorageQuotaFixtureContainer, verifyStorageQuotaFixtureLedger } from "./storage-quota-fixture";
import { storageQuotaSourceFingerprint } from "./storage-quota-source";

const passed: string[] = []; let current = "fixture";
const stage = process.argv.includes("--stage=1B-5") ? "1B-5" : process.argv.includes("--stage=1B-4") ? "1B-4" : process.argv.includes("--stage=1B-3") ? "1B-3" : process.argv.includes("--stage=1B-2") ? "1B-2" : process.argv.includes("--stage=1B-1") ? "1B-1" : "1A";
const selected = process.argv.find(value => value.startsWith("--case="))?.slice(7);
async function check(name: string, run: () => Promise<void>) {
  if (selected && selected !== name && name !== "canonical-55-migration-ledger") return;
  current = name; await run(); passed.push(name); console.log("PASS STORAGE " + name);
}
async function main() {
  const fixture = loadStorageQuotaFixture(process.argv[2] ?? ""); assertStorageQuotaFixtureContainer(fixture);
  const env = storageQuotaFixtureEnvironment(fixture);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  const { createPrismaClient, prisma } = await import("../../packages/db/src/index");
  const upload = await import("./storage-quota-upload-runtime");
  const admission = await import("./storage-quota-admission-runtime");
  const client = createPrismaClient(env.DATABASE_URL, { max: 10, connectionTimeoutMillis: 5000 });
  const sourceFingerprint = storageQuotaSourceFingerprint();
  const deletion = await import("./storage-quota-deletion-data");
  const release = await import("./storage-quota-release-runtime");
  let ordinaryBefore: Awaited<ReturnType<typeof deletion.priorState>> | null = null;
  let preservation: object = {};
  try {
    await check("canonical-55-migration-ledger", async () => { assert.equal(await verifyStorageQuotaFixtureLedger(client, fixture), 55); });
    if (["1A", "1B-1", "1B-4"].includes(stage)) {
      ordinaryBefore = await deletion.priorState(client, fixture);
      console.log(JSON.stringify({ event: "STORAGE_PRIOR_PROTECTION", phase: "before", rows: Object.values(ordinaryBefore.rows).reduce((n, rows) => n + rows.length, 0),
        files: Object.keys(ordinaryBefore.files).length, visibility: String(ordinaryBefore.visibility) }));
    }
    const crash = await import("./storage-quota-process-runtime");
    const untouched = stage === "1B-1" ? await client.attachment.findMany({ orderBy: { id: "asc" } }) : [];
    if (stage === "1B-5") {
      assert.equal(selected, undefined, "STORAGE_OMIT_REQUIRES_FULL_MATRIX");
      preservation = await (await import("./storage-quota-omit-runtime")).runStorageOmitMatrix(client, fixture, check);
      await check("prior-objects-and-files-unchanged", async () => {});
    } else if (stage === "1B-4") {
      await release.runStorageReleaseMatrix(client, fixture, check);
      await check("prior-objects-and-files-unchanged", async () => {
        preservation = await deletion.assertPriorState(client, fixture, ordinaryBefore!);
        assert.equal((await deletion.priorState(client, fixture)).visibility, ordinaryBefore!.visibility);
      });
    } else if (stage === "1B-3") {
      preservation = await (await import("./storage-quota-restore-runtime")).runStorageRestoreMatrix(client, fixture, check);
    } else if (stage === "1B-2") {
      const before = await deletion.priorState(client, fixture);
      try { await (await import("./storage-quota-deletion-runtime")).runStorageDeletionMatrix(client, fixture, check); }
      finally { preservation = await deletion.assertPriorState(client, fixture, before); }
      await check("prior-objects-and-files-unchanged", async () => {});
    } else if (stage === "1B-1") {
      for (const point of ["intent", "staging", "renamed"] as const) await check("sigkill-upload-" + point, () => crash.storageUploadKill(client, fixture, point));
      for (const point of ["removed", "released"] as const) for (const final of [false, true]) {
        await check("sigkill-cleanup-" + point + (final ? "-final" : "-staging"), () => crash.storageCleanupKill(client, fixture, point, final));
      }
      await check("sigkill-ambiguous-dual-file", () => crash.storageAmbiguousKill(client, fixture));
      await check("cleanup-path-drift-and-partial-file", () => crash.storageCleanupPathDrift(client, fixture));
      await check("reconciliation-empty-selection-and-old-rows-unchanged", async () => {
        await crash.storageReconciliationSelection(client);
        assert.deepEqual(await client.attachment.findMany({ where: { id: { in: untouched.map(row => row.id) } }, orderBy: { id: "asc" } }), untouched);
      });
    } else {
    await check("note-limit-idempotency-download-and-privacy", () => upload.storageNoteQuota(client, fixture));
    await check("quota-rejection-rolls-back-upload-claim", () => upload.storageRejectedClaim(client, fixture));
    await check("workspace-budget-spans-members-not-other-workspaces", () => upload.storageWorkspaceBudgets(client, fixture));
    await check("resource-copy-reuse-skip-and-release-replay", () => upload.storageResourceDecisions(client, fixture));
    await check("cleanup-failure-retry-and-reappeared-file-refusal", () => upload.storageCleanupRetry(client, fixture));
    await check("disabled-invalid-config-and-recovery", () => upload.storageDisabledAndInvalid(client, fixture));
    await check("independent-connections-last-byte-race", () => admission.storageLastByteRace(client, fixture));
    await check("stale-snapshot-serialization-abort", () => admission.storageStaleSnapshot(client, fixture));
    await check("atomic-pending-before-write-and-concurrent-replay", () => admission.storageAtomicPending(client, fixture));
    await check("intent-transaction-rollback", () => admission.storageIntentRollback(client, fixture));
    await check("initial-same-key-concurrent-claims", () => admission.storageInitialSameKeyRace(client, fixture));
    await check("unknown-corrupt-and-legacy-usage", () => admission.storageCorruptAdmission(client, fixture));
    await check("legacy-resource-bucket-and-dual-reference", () => admission.storageLegacyResourceBuckets(client, fixture));
    await check("full-invalid-text-read-download-and-controls", () => admission.storageNonUploadPaths(client, fixture));
    await check("resource-batch-rejection-and-success-replay", () => admission.storageBatchRejectionReplay(client, fixture));
    }
    assert.equal(storageQuotaSourceFingerprint(), sourceFingerprint, "STORAGE_SOURCE_CHANGED");
    if (ordinaryBefore) {
      const protectedState = await deletion.assertPriorState(client, fixture, ordinaryBefore);
      assert.equal(protectedState.visibilityBefore, protectedState.visibilityAfter);
      preservation = protectedState;
    }
    if (selected) { assert.equal(passed.length, 2, "STORAGE_SELECTED_CASE_MISSING"); return; }
    if (process.argv.includes("--no-save")) { console.log("PASS STORAGE runtime " + passed.length + " groups; evidence not saved"); return; }
    await saveStorageQuotaEvidence({ scope: "STORAGE stage " + stage,
      checkedAt: new Date().toISOString(), fixtureId: fixture.scopeId, migrations: 55, sourceFingerprint, passed, stage,
      status: "complete", overallStorageStatus: "partial",
      ...preservation,
      ...(stage === "1B-5" ? { ...preservation, concurrency: "query completion observer; controlled freeze commit before normal response recheck" }
        : stage === "1B-4" ? { cases: release.storageReleaseEvidence,
        processBoundary: "IPC nonce/PID/PPID/UID/fixture/source; real transaction PID/xid; independent observer and rollback row-lock reacquisition",
        doesNotProve: ["COMMIT sent with network acknowledgement lost", "CAS predicate conflict behind normal attachment lock", "production recovery gate"] }
        : stage === "1B-3" ? preservation : stage === "1B-2" ? { cases: deletion.storageDeletionEvidence, ...preservation } : stage === "1B-1" ? { cases: crash.storageCrashEvidence, priorAttachmentRowsUnchanged: untouched.length,
        processBoundary: "IPC nonce/PID/PPID/UID/fixture/source binding; independent database observer; fresh recovery process" } : {
        concurrency: "independent PostgreSQL backends, barriers and stale snapshot SSI abort" }),
      deferred: ["dependency-audit", ...(stage === "1B-3" ? [] : ["trusted-ledger-restore"]), "full-browser"],
      syntheticFileCleanupExecuted: stage !== "1B-5", productionTouched: false, externalCalls: false });
    console.log("PASS STORAGE runtime " + passed.length + " groups");
  } finally {
    try { if (ordinaryBefore) {
      const protectedState = await deletion.assertPriorState(client, fixture, ordinaryBefore);
      assert.equal(protectedState.visibilityBefore, protectedState.visibilityAfter);
      console.log(JSON.stringify({ event: "STORAGE_PRIOR_PROTECTION", phase: "after", ...protectedState }));
    } }
    finally { await client.$disconnect(); await prisma.$disconnect(); }
  }
}
main().catch(error => {
  const row = error as { name?: string; code?: string; stack?: string };
  console.error(JSON.stringify({ event: "STORAGE_RUNTIME_FAILED", case: current, name: row.name,
    validation: (error as Error).message.match(/Unknown argument `[^`]+`/)?.[0],
    code: /^[A-Z0-9_]{1,80}$/.test(row.code ?? "") ? row.code : undefined,
    locations: row.stack?.split("\n").filter(line => line.trim().startsWith("at ") && line.includes("/scripts/quality/storage-quota-")).slice(0, 3) }));
  process.exitCode = 1;
});
