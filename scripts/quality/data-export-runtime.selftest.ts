import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../packages/db/src/index";
import { createExportDownloadGrant, redeemExportDownloadGrant, getDataLifecycleJob } from "../../apps/web/lib/system/data-lifecycle-service";
import { requireDataExportFixture, seedDataExportFixture } from "./data-export-runtime-fixture";
import { runFixtureExport } from "./data-export-runtime-actions";
import { exportDownloadCapabilities, exportEpochAndSwitches, exportReceiptAdmission, exportRequestIdentityAndProtocol } from "./data-export-auth-runtime";
import { exportControlsAndExpiryCleanup, exportFileFailuresAndReplay, exportMissingSymlinkAndLimit, exportPreparedFailureAndDisable } from "./data-export-fault-runtime";
import { exportConfiguredWorkerCli, exportProcessCrashRecovery } from "./data-export-process-runtime";
import { seedExportRelationEvidence } from "./data-export-relations-runtime";
import { exportDownloadOpenFailures, exportDownloadReservationFencing } from "./data-export-download-runtime";
import { exportReclaimFailureFairness } from "./data-export-reclaim-runtime";


async function verifiedAccountAndWorkspaceArchives() {
  const fixture = await seedDataExportFixture();
  const relationEvidence = await seedExportRelationEvidence(fixture);
  const before = createHash("sha256").update(await readFile(fixture.sourcePath)).digest("hex");
  for (const scope of ["ACCOUNT", "WORKSPACE"] as const) {
    const job = await runFixtureExport(fixture, scope);
    const view = await getDataLifecycleJob(fixture.actor, job.id); assert.equal(view.downloadable, true); assert.equal(view.progress, 1);
    const grant = await createExportDownloadGrant(fixture.actor, job.id);
    const download = await redeemExportDownloadGrant(fixture.actor, grant.token);
    const content = Buffer.from(await new Response(download.body).arrayBuffer());
    const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId: job.id } });
    assert.equal(`sha256:${createHash("sha256").update(content).digest("hex")}`, pkg.archiveSha256);
    const file = path.join(fixture.base, `${job.id}.download.zip`);
    await writeFile(file, content, { flag: "wx", mode: 0o600 });
    execFileSync("unzip", ["-t", file], { stdio: "pipe" });
    const manifestBytes = execFileSync("unzip", ["-p", file, "manifest.json"]);
    const manifest = JSON.parse(manifestBytes.toString()) as { protocol: string; entries: Array<{ entryName: string; sha256: string; kind: string }> };
    assert.equal(manifest.protocol, "areaforge-data-export-archive");
    assert.equal(`sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`, pkg.manifestSha256);
    let allText = "";
    for (const entry of manifest.entries) {
      const bytes = execFileSync("unzip", ["-p", file, entry.entryName]);
      assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, entry.sha256);
      if (entry.kind === "attachmentFile") assert.deepEqual(bytes, fixture.fileBytes);
      else {
        allText += bytes.toString();
        const key = entry.entryName.replace(/^entries\//, "").replace(/\.json$/, "");
        const expected = relationEvidence.get(key);
        if (expected) for (const [field, value] of Object.entries(expected)) assert.equal(JSON.parse(bytes.toString())[field], value, key);
      }
    }
    for (const key of relationEvidence.keys()) assert.ok(manifest.entries.some(entry => entry.entryName === `entries/${key}.json`));
    assert.ok(allText.includes("OWN_NOTE_BODY"));
    assert.equal(allText.includes("OWN_HISTORICAL_BODY"), scope === "ACCOUNT");
    for (const marker of ["FOREIGN_WORKSPACE_PRIVATE", "FOREIGN_STAGE_PRIVATE", "FOREIGN_GROUP_PRIVATE", "FOREIGN_SUBJECT_PRIVATE", "FOREIGN_SYLLABUS_PRIVATE", "FOREIGN_BODY_PRIVATE", "tokenHash", "passwordHash", "storedName", "upload://", fixture.roots.uploadRoot]) assert.equal(allText.includes(marker), false, marker);
    assert.equal(allText.includes("ACCOUNT_ONLY_MOTIVATION"), scope === "ACCOUNT");
    assert.equal(allText.includes("ACCOUNT_ONLY_AUDIT"), scope === "ACCOUNT");
    await assert.rejects(redeemExportDownloadGrant(fixture.actor, grant.token));
    assert.equal(JSON.stringify(pkg.manifest).includes("OWN_NOTE_BODY"), false);
  }
  assert.equal(createHash("sha256").update(await readFile(fixture.sourcePath)).digest("hex"), before);
}

async function main() {
  const environment = await requireDataExportFixture();
  const cases = [verifiedAccountAndWorkspaceArchives, exportRequestIdentityAndProtocol, exportDownloadCapabilities, exportEpochAndSwitches, exportReceiptAdmission,
    exportFileFailuresAndReplay, exportMissingSymlinkAndLimit, exportPreparedFailureAndDisable, exportControlsAndExpiryCleanup,
    exportProcessCrashRecovery, exportConfiguredWorkerCli, exportDownloadOpenFailures, exportDownloadReservationFencing, exportReclaimFailureFairness];
  for (const verify of cases) { await verify(); console.log(`PASS ${verify.name}`); }
  console.log(JSON.stringify({ result: "PASS", cases: cases.length, migrations: environment.migrations, evidenceClass: "isolated-runtime", productionTouched: false, sharedDatabaseTouched: false, applicationSourceDeletionAttempted: false, syntheticFaultInjection: true, externalProviderCalled: false }));
}

main().catch(error => { console.error(error instanceof Error ? `${error.name}: ${error.message}` : "DATA_EXPORT_FIXTURE_FAILED"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
