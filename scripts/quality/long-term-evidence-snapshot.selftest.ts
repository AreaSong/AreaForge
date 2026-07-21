import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDataIntegrityDoctor, type DataIntegritySnapshot } from "../ops/data-integrity-doctor";
import { protectedPathFiles } from "../ops/operability-status";
import {
  longTermEvidenceSnapshotBindingStatus,
  validateLongTermEvidenceSnapshot,
} from "./long-term-evidence-snapshot-validate";
import type { AttachmentReconciliationSummary } from "./attachment-reconciliation-summary";
import { evaluateProductExperienceEvidence } from "./product-experience-review-validate";
import { resolveProductExperienceReviewPath } from "./product-experience-review-discovery";

type JsonRecord = Record<string, unknown>;

function main(): void {
  const readySnapshot = withHash(buildSnapshot("ready_for_long_term_operability_review"));
  const readyIssues = validateShape(JSON.stringify(readySnapshot, null, 2));
  assert(readyIssues.length === 0, `expected ready snapshot to pass, got ${JSON.stringify(readyIssues)}`);

  const needsEvidenceChecks = buildChecks({ ops001Status: "missing", ops001Actual: "needs_evidence" });
  const needsEvidenceSnapshot = withHash({
    ...buildSnapshot("needs_live_evidence"),
    nextCommand: fixtureNextCommand("needs_live_evidence", needsEvidenceChecks),
    checks: needsEvidenceChecks,
  });
  const needsEvidenceIssues = validateShape(JSON.stringify(needsEvidenceSnapshot, null, 2));
  assert(needsEvidenceIssues.length === 0, `expected needs-evidence snapshot to validate, got ${JSON.stringify(needsEvidenceIssues)}`);

  const tampered = { ...readySnapshot, snapshotHash: "0".repeat(64) };
  const tamperedIssues = validateShape(JSON.stringify(tampered, null, 2));
  assert(tamperedIssues.some((issue) => issue.field === "snapshotHash"), "expected tampered hash to fail");

  const badProtectedHash = withHash(withPatch(readySnapshot, (body) => {
    protectedFingerprint(body).hash = "not-a-hash";
  }));
  const badProtectedHashIssues = validateShape(JSON.stringify(badProtectedHash, null, 2));
  assert(
    badProtectedHashIssues.some((issue) => issue.field === "sourceSnapshot.protectedPathFingerprint.hash"),
    "expected bad protected path fingerprint hash to fail",
  );

  const missingProtectedPath = withHash(withPatch(readySnapshot, (body) => {
    protectedFingerprint(body).paths = ["README.md"];
  }));
  const missingProtectedPathIssues = validateShape(JSON.stringify(missingProtectedPath, null, 2));
  assert(
    missingProtectedPathIssues.some((issue) => issue.field === "sourceSnapshot.protectedPathFingerprint.paths"),
    "expected missing protected path to fail",
  );

  const greenwashed = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({ ops001Status: "pass", ops001Actual: "needs_evidence" }),
  });
  const greenwashIssues = validateShape(JSON.stringify(greenwashed, null, 2));
  assert(greenwashIssues.some((issue) => issue.field === "checks.ops001.status"), "expected OPS-001 greenwash to fail");

  const missingOps005 = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({}).filter((check) => check.key !== "ops005"),
  });
  const missingOps005Issues = validateShape(JSON.stringify(missingOps005, null, 2));
  assert(missingOps005Issues.some((issue) => issue.field === "checks"), "expected missing OPS-005 check to fail");

  const greenwashedOps005 = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({ ops005Actual: "needs_production_evidence" }),
  });
  const greenwashedOps005Issues = validateShape(JSON.stringify(greenwashedOps005, null, 2));
  assert(greenwashedOps005Issues.some((issue) => issue.field === "checks.ops005.status"), "expected OPS-005 greenwash to fail");

  const missingDataIntegrity = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({}).filter((check) => check.key !== "dataIntegrity"),
  });
  const missingDataIntegrityIssues = validateShape(JSON.stringify(missingDataIntegrity, null, 2));
  assert(missingDataIntegrityIssues.some((issue) => issue.field === "checks"), "expected missing data-integrity check to fail");

  const greenwashedDataIntegrity = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({ dataIntegrityActual: "warn" }),
  });
  const greenwashedDataIntegrityIssues = validateShape(JSON.stringify(greenwashedDataIntegrity, null, 2));
  assert(greenwashedDataIntegrityIssues.some((issue) => issue.field === "checks.dataIntegrity.status"), "expected data-integrity greenwash to fail");

  const mismatchedDataHash = withHash(withPatch(readySnapshot, (body) => {
    const checks = body.checks as JsonRecord[];
    const doctor = checks.find((item) => item.key === "dataIntegrity");
    if (doctor) doctor.evidenceHash = `sha256:${"7".repeat(64)}`;
  }));
  const mismatchedDataHashIssues = validateShape(JSON.stringify(mismatchedDataHash, null, 2));
  assert(mismatchedDataHashIssues.some((issue) => issue.field === "checks.dataIntegrity.evidenceHash"), "expected doctor file hash mismatch to fail");

  const mismatchedInputHash = withHash(withPatch(readySnapshot, (body) => {
    const source = body.sourceSnapshot as JsonRecord;
    const hashes = source.inputHashes as JsonRecord[];
    const doctorHash = hashes.find((item) => item.key === "dataIntegrityRecord");
    if (doctorHash) doctorHash.sha256 = `sha256:${"7".repeat(64)}`;
  }));
  const mismatchedInputHashIssues = validateShape(JSON.stringify(mismatchedInputHash, null, 2));
  assert(mismatchedInputHashIssues.some((issue) => issue.field === "sourceSnapshot.inputHashes"), "expected input hash drift to fail");

  const missingNextCommand = withHash(withPatch(readySnapshot, (body) => {
    delete body.nextCommand;
  }));
  const missingNextCommandIssues = validateShape(JSON.stringify(missingNextCommand, null, 2));
  assert(missingNextCommandIssues.some((issue) => issue.field === "nextCommand"), "expected missing nextCommand to fail");

  const unsafeNextCommand = withHash(withPatch(readySnapshot, (body) => {
    body.nextCommand = "review residual close conditions without automatic closure; then close residual automatically";
  }));
  const unsafeNextCommandIssues = validateShape(JSON.stringify(unsafeNextCommand, null, 2));
  assert(unsafeNextCommandIssues.some((issue) => issue.field === "nextCommand"), "expected non-canonical nextCommand to fail");

  const missingSignal = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({ omitSignal: "backup" }),
  });
  const missingSignalIssues = validateShape(JSON.stringify(missingSignal, null, 2));
  assert(
    missingSignalIssues.some((issue) => issue.field === "checks.operationalEvidenceBundle.metadata.signals"),
    "expected missing operational signal to fail",
  );

  const leaked = JSON.stringify({
    ...readySnapshot,
    metadata: "DATABASE_URL=postgresql://database.invalid:5432/db",
  }, null, 2);
  const leakedIssues = validateShape(leaked);
  assert(leakedIssues.some((issue) => issue.field === "record"), "expected secret-like value to fail");

  const historicalV1 = historicalSnapshotV1();
  const historicalIssues = validateShape(JSON.stringify(historicalV1, null, 2));
  assert(historicalIssues.length === 0, `expected historical non-ready v1 snapshot to pass, got ${JSON.stringify(historicalIssues)}`);
  const historicalReady = withHash({ ...historicalV1, status: "ready_for_long_term_operability_review" });
  const historicalReadyIssues = validateShape(JSON.stringify(historicalReady, null, 2));
  assert(historicalReadyIssues.some((issue) => issue.field === "status"), "expected ready v1 snapshot to fail");

  const historicalV2 = historicalSnapshotV2();
  const historicalV2Issues = validateShape(JSON.stringify(historicalV2, null, 2));
  assert(historicalV2Issues.length === 0, `expected historical non-ready v2 snapshot to pass, got ${JSON.stringify(historicalV2Issues)}`);
  const historicalV2Ready = withHash({ ...historicalV2, status: "ready_for_long_term_operability_review" });
  const historicalV2ReadyIssues = validateShape(JSON.stringify(historicalV2Ready, null, 2));
  assert(historicalV2ReadyIssues.some((issue) => issue.field === "status"), "expected ready v2 snapshot to fail");
  const historicalV2CurrentIssues = validateLongTermEvidenceSnapshot(JSON.stringify(historicalV2, null, 2));
  assert(historicalV2CurrentIssues.some((issue) => issue.field === "sourceSnapshot.currentBinding"), "historical v2 should require shape-only validation");
  const currentSchemaShapeOnlyIssues = validateLongTermEvidenceSnapshot(JSON.stringify(readySnapshot, null, 2), { bindingMode: "shape-only" });
  assert(currentSchemaShapeOnlyIssues.some((issue) => issue.field === "sourceSnapshot.currentBinding"), "schema v3 must reject public shape-only validation");

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/long-term-evidence-snapshot.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD: "" },
  });
  assert(generated.status === 0 || generated.status === 1, `expected real snapshot generator to emit a bounded snapshot, got ${generated.stderr}`);
  const generatedIssues = validateLongTermEvidenceSnapshot(generated.stdout);
  assert(generatedIssues.length === 0, `expected generated snapshot current binding to pass, got ${JSON.stringify(generatedIssues)}`);
  assert(longTermEvidenceSnapshotBindingStatus(generated.stdout) === "current", "generated snapshot should bind to current checkout");
  const generatedBody = JSON.parse(generated.stdout) as JsonRecord;
  const generatedEvidencePaths = (generatedBody.sourceSnapshot as JsonRecord).evidencePaths as JsonRecord[];
  const generatedUxPath = generatedEvidencePaths.find((item) => item.key === "uxReviewRecord")?.pathLabel;
  const expectedUxPath = resolveProductExperienceReviewPath(process.cwd());
  assert(expectedUxPath && generatedUxPath === path.basename(expectedUxPath), `generated snapshot should use the redacted discovered UX record label, got ${String(generatedUxPath)}`);
  const generatedChecks = generatedBody.checks as JsonRecord[];
  const generatedUxCheck = generatedChecks.find((item) => item.key === "uxReview");
  const expectedUxEvaluation = evaluateProductExperienceEvidence({
    now: new Date(String(generatedBody.generatedAt)),
    expectedVersion: String(generatedBody.expectedVersion),
  });
  const expectedUxStatus = expectedUxEvaluation.status === "fresh" ? "pass" : expectedUxEvaluation.status;
  assert(
    generatedUxCheck?.status === expectedUxStatus && generatedUxCheck?.actualStatus === expectedUxEvaluation.status,
    "generated snapshot must inherit the shared UX evaluator result",
  );
  const forgedVersion = withHash(withPatch(JSON.parse(generated.stdout) as JsonRecord, (body) => {
    body.expectedVersion = "9.9.9";
    body.packageVersion = "9.9.9";
    body.releaseTag = "v9.9.9";
  }));
  const forgedVersionIssues = validateLongTermEvidenceSnapshot(JSON.stringify(forgedVersion));
  assert(forgedVersionIssues.some((issue) => issue.field === "packageVersion.currentBinding"), "current binding must reject forged package versions");
  const staleGenerated = withHash(withPatch(JSON.parse(generated.stdout) as JsonRecord, (body) => {
    const source = body.sourceSnapshot as JsonRecord;
    source.controlPlaneSourceHash = "f".repeat(64);
  }));
  assert(longTermEvidenceSnapshotBindingStatus(JSON.stringify(staleGenerated)) === "stale", "tampered source binding should be stale");
  assert(validateShape(JSON.stringify(staleGenerated)).length === 0, "shape-only should preserve historical archive validation");

  testCurrentDoctorSemanticBinding();
  testExternalUxPathFailsClosed();

  console.log("PASS long-term evidence snapshot validator selftest");
}

function testExternalUxPathFailsClosed(): void {
  const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-snapshot-external-ux-"));
  const externalUxPath = path.join(tempDir, "external-ux-record.md");
  try {
    writeFileSync(externalUxPath, "externalSentinel: must-not-be-read.invalid\n");
    const generated = runSnapshotGenerator({
      AREAFORGE_LONG_TERM_UX_RECORD: externalUxPath,
      AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD: "",
    });
    assert(!generated.includes("must-not-be-read.invalid"), "snapshot must not read workspace-external UX evidence");
    const body = JSON.parse(generated) as JsonRecord;
    const source = body.sourceSnapshot as JsonRecord;
    const evidencePaths = source.evidencePaths as JsonRecord[];
    const uxPath = evidencePaths.find((item) => item.key === "uxReviewRecord");
    assert(uxPath?.sha256 === null && uxPath?.exists === false, "external UX evidence must not receive a file hash");
    const checks = body.checks as JsonRecord[];
    const uxCheck = checks.find((item) => item.key === "uxReview");
    const metadata = uxCheck?.metadata as JsonRecord | undefined;
    assert(
      uxCheck?.status === "invalid" && Array.isArray(metadata?.issueFields) && metadata.issueFields.includes("recordPath"),
      "external UX evidence must fail closed with recordPath issue",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const cleanSnapshot: DataIntegritySnapshot = {
  activeSessionCount: 1,
  staleActiveSessionCount: 0,
  runningWithPausedAtCount: 0,
  pausedWithoutPausedAtCount: 0,
  activeWithEndedAtCount: 0,
  terminalWithoutEndedAtCount: 0,
  terminalWithPausedAtCount: 0,
  negativeSessionMetricsCount: 0,
  doneWithoutCompletedAtCount: 0,
  nonDoneWithCompletedAtCount: 0,
  doneWithDebtCount: 0,
  negativeTaskMinutesCount: 0,
};

function testCurrentDoctorSemanticBinding(): void {
  const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-snapshot-doctor-"));
  const doctorPath = path.join(tempDir, "doctor.json");
  const now = "2026-07-15T00:00:00.000Z";
  try {
    const passDoctor = buildDataIntegrityDoctor({
      snapshot: cleanSnapshot,
      attachmentSummary: passAttachmentSummary(),
      generatedAt: now,
      databaseReadAttempted: true,
    });
    writeFileSync(doctorPath, `${JSON.stringify(passDoctor, null, 2)}\n`);
    withSnapshotEnvironment(doctorPath, now, () => {
      const generated = runSnapshotGenerator({
        AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD: doctorPath,
        AREAFORGE_LONG_TERM_SNAPSHOT_NOW: now,
      });
      const issues = validateLongTermEvidenceSnapshot(generated);
      assert(issues.length === 0, `fresh pass doctor snapshot should bind, got ${JSON.stringify(issues)}`);
    });

    const warningDoctor = buildDataIntegrityDoctor({
      snapshot: cleanSnapshot,
      generatedAt: now,
      databaseReadAttempted: true,
    });
    writeFileSync(doctorPath, `${JSON.stringify(warningDoctor, null, 2)}\n`);
    withSnapshotEnvironment(doctorPath, now, () => {
      const generated = runSnapshotGenerator({
        AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD: doctorPath,
        AREAFORGE_LONG_TERM_SNAPSHOT_NOW: now,
      });
      const body = JSON.parse(generated) as JsonRecord;
      const forged = withHash(withPatch(body, (snapshot) => {
        const checks = snapshot.checks as JsonRecord[];
        const doctor = checks.find((item) => item.key === "dataIntegrity");
        if (!doctor) return;
        doctor.status = "pass";
        doctor.actualStatus = "pass";
        doctor.freshness = { generatedAt: now, ageHours: 0, maxAgeHours: 24, status: "fresh" };
        doctor.metadata = {
          doctorMode: "read_only_data_integrity_doctor",
          overall: "pass",
          native: "integrity_clean",
          databaseSource: "configured_read_only_query",
          databaseReadAttempted: true,
          attachmentStatus: "pass",
          doctorHash: warningDoctor.doctorHash,
        };
        snapshot.nextCommand = fixtureNextCommand(String(snapshot.status), checks);
      }));
      const issues = validateLongTermEvidenceSnapshot(JSON.stringify(forged));
      assert(issues.some((issue) => issue.field === "checks.dataIntegrity.currentBinding"), "current binding must re-derive warning doctor semantics");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runSnapshotGenerator(env: Record<string, string>): string {
  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/long-term-evidence-snapshot.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert(generated.status === 0 || generated.status === 1, `snapshot generator failed to emit evidence: ${generated.stderr}`);
  return generated.stdout;
}

function withSnapshotEnvironment(doctorPath: string, now: string, callback: () => void): void {
  const previousDoctor = process.env.AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD;
  const previousNow = process.env.AREAFORGE_LONG_TERM_SNAPSHOT_NOW;
  process.env.AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD = doctorPath;
  process.env.AREAFORGE_LONG_TERM_SNAPSHOT_NOW = now;
  try {
    callback();
  } finally {
    restoreEnv("AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD", previousDoctor);
    restoreEnv("AREAFORGE_LONG_TERM_SNAPSHOT_NOW", previousNow);
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function passAttachmentSummary(): AttachmentReconciliationSummary {
  return {
    schemaVersion: 1,
    mode: "read_only_attachment_reconciliation_summary",
    generatedAt: "2026-07-15T00:00:00.000Z",
    status: "pass",
    action: "report_only",
    source: {
      reconciliationCsvSha256: `sha256:${"a".repeat(64)}`,
      uploadDirectory: "configured_private_upload_directory",
    },
    counts: {
      databaseRecordCount: 0,
      uploadFileCount: 0,
      dbOnlyCount: 0,
      fileOnlyCount: 0,
      hashMismatchCount: 0,
      sizeMismatchCount: 0,
      invalidUriCount: 0,
      duplicateReferenceCount: 0,
      unsafeEntryCount: 0,
      unexpectedEntryCount: 0,
    },
    fileOnlyEntryHashes: [],
    unsafeEntryHashes: [],
    doesNotProve: [
      "automatic orphan cleanup",
      "attachment metadata repair",
      "backup restore success outside the scanned directory",
      "production health",
    ],
    safetyFacts: {
      readOnly: true,
      databaseWriteAttempted: false,
      uploadWriteAttempted: false,
      fileDeleted: false,
      fileMoved: false,
      metadataRepaired: false,
      fileContentIncluded: false,
      absolutePathIncluded: false,
      secretValuePrinted: false,
    },
    summaryHash: `sha256:${"b".repeat(64)}`,
  };
}

function validateShape(raw: string) {
  return validateLongTermEvidenceSnapshot(raw, {
    bindingMode: "shape-only",
    allowCurrentSchemaShapeOnlyForSelftest: true,
  });
}

function buildSnapshot(status: "ready_for_long_term_operability_review" | "needs_live_evidence"): JsonRecord {
  const checks = buildChecks({});
  return {
    schemaVersion: 3,
    mode: "read_only_long_term_evidence_snapshot",
    generatedAt: "2026-07-12T12:30:00.000Z",
    snapshotHash: "",
    expectedVersion: "0.1.7",
    releaseTag: "v0.1.7",
    packageVersion: "0.1.7",
    scope: "long_term_operability_current_checkout",
    status,
    nextCommand: fixtureNextCommand(status, checks),
    sourceSnapshot: {
      controlPlaneSourceHash: "1".repeat(64),
      protectedPathFingerprint: protectedPathFingerprint(),
      files: [
        "docs/development/long-term-operability-control-plane.md",
        "scripts/ops/long-term-evidence-snapshot.ts",
      ],
      missingFiles: [],
      evidencePaths: [
        evidencePath("releaseEvidenceRecord"),
        evidencePath("releaseSupplyChainRecord"),
        evidencePath("uxReviewRecord"),
        evidencePath("operationalEvidenceBundle"),
        evidencePath("ops004AlertPreview"),
        evidencePath("ops005ProductionEvidence"),
        evidencePath("dataIntegrityRecord"),
      ],
      inputHashes: [
        inputHash("releaseEvidenceRecord"),
        inputHash("releaseSupplyChainRecord"),
        inputHash("uxReviewRecord"),
        inputHash("operationalEvidenceBundle"),
        inputHash("ops004AlertPreview"),
        inputHash("ops005ProductionEvidence"),
        inputHash("dataIntegrityRecord"),
      ],
    },
    checks,
    doesNotProve: [
      "current production health without post-version live smoke and update-agent evidence",
      "OPS-001 closure or residual ledger closure",
      "OPS-004 alert recovery drill completion or residual ledger closure",
      "OPS-005 expected-before V2 implementation, signed Release, production deployment, or residual ledger closure without ready_for_ops005_human_review evidence",
      "OPS-006 concurrency safety or residual closure from a passing data-integrity doctor record",
      "release evidence record validation when backup hashes are root-only or missing",
      "backup freshness, restore execution, migration execution, or rollback execution",
      "server updater apply completion for a future release",
      "GitHub Release creation or release asset download",
      "production write smoke safety",
    ],
    forbiddenActions: [
      "execute_server_command",
      "apply_update",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "trigger_production_write_smoke",
      "read_or_print_secret_values",
      "create_github_release",
      "push_git_tag",
      "download_release_assets",
      "call_github_api",
      "update_residual_ledger",
      "send_notification",
      "call_external_alert_receiver",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      githubApiCalled: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      updaterApplyAttempted: false,
      residualLedgerUpdated: false,
      secretValuePrinted: false,
      destructiveActionAttempted: false,
      realStudyContentIncluded: false,
      passwordValuePrinted: false,
      writeSmokeAttempted: false,
      releaseCreated: false,
      tagPushed: false,
      releaseAssetsDownloaded: false,
      productionEnvIncluded: false,
      backupIncluded: false,
      notificationSent: false,
      externalAlertReceiverCalled: false,
    },
  };
}

function fixtureNextCommand(status: string, checks: JsonRecord[]): string {
  if (status === "ready_for_long_term_operability_review") {
    return "review residual close conditions without automatic closure";
  }
  const keys = checks.filter((check) => check.status !== "pass").map((check) => String(check.key));
  return `collect or refresh evidence and rerun snapshot: ${keys.join(",")}`;
}

function protectedPathFingerprint(): JsonRecord {
  return {
    algorithm: "sha256",
    scope: "read_only_side_effect_guard_inputs",
    paths: [...protectedPathFiles],
    hash: "9".repeat(64),
    doesNotProve: [
      "production health",
      "absence of changes outside protected paths",
      "git worktree cleanliness",
    ],
  };
}

function withPatch(snapshot: JsonRecord, patch: (body: JsonRecord) => void): JsonRecord {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as JsonRecord;
  patch(cloned);
  return cloned;
}

function protectedFingerprint(snapshot: JsonRecord): JsonRecord {
  const sourceSnapshot = snapshot.sourceSnapshot as JsonRecord;
  return sourceSnapshot.protectedPathFingerprint as JsonRecord;
}

function buildChecks(options: {
  ops001Status?: string;
  ops001Actual?: string;
  ops005Actual?: string;
  dataIntegrityActual?: string;
  omitSignal?: string;
}): JsonRecord[] {
  const ops001Status = options.ops001Status ?? "pass";
  const ops001Actual = options.ops001Actual ?? "ready_for_human_close";
  return [
    check("controlPlane", "enterprise operability control plane", "pass", "pass", "pass", [], "sha256:1010101010101010101010101010101010101010101010101010101010101010"),
    check("ops001", "OPS-001 production read-only smoke and update-agent evidence", ops001Status, ops001Actual, "ready_for_human_close", ["AF-RISK-OPS-001"], "sha256:2020202020202020202020202020202020202020202020202020202020202020"),
    check("ops004", "OPS-004 alert and recovery drill evidence", "pass", "ready_for_human_close", "ready_for_human_close", ["AF-RISK-OPS-004"], "sha256:3030303030303030303030303030303030303030303030303030303030303030"),
    {
      ...check(
        "ops005",
        "OPS-005 expected-before V2 release and production evidence",
        "pass",
        options.ops005Actual ?? "ready_for_ops005_human_review",
        "ready_for_ops005_human_review",
        ["AF-RISK-OPS-005"],
        "sha256:9090909090909090909090909090909090909090909090909090909090909090",
      ),
      freshness: { recordedAt: "2026-07-12T12:00:00Z", ageHours: 0.5, maxAgeHours: 24, status: "fresh" },
      versionMatch: true,
      metadata: {
        localImplementation: "pass",
        signedRelease: "pass",
        productionDeployment: "pass",
        v2Check: "pass",
        expectedBeforeRejection: "pass",
        expectedBeforeRejectionExecutionAttempted: "no",
        sharedProductionStateLock: "pass",
        processingReconciliation: "pass",
        autoApply: "none",
        releaseTag: "v0.1.7",
        gitCommit: "a".repeat(40),
      },
    },
    {
      ...check(
        "dataIntegrity",
        "fresh business data integrity doctor",
        "pass",
        options.dataIntegrityActual ?? "pass",
        "pass",
        ["AF-RISK-OPS-006"],
        `sha256:${"8".repeat(64)}`,
      ),
      freshness: { generatedAt: "2026-07-12T12:00:00Z", ageHours: 0.5, maxAgeHours: 24, status: "fresh" },
      metadata: {
        doctorMode: "read_only_data_integrity_doctor",
        overall: "pass",
        native: "integrity_clean",
        databaseSource: "configured_read_only_query",
        databaseReadAttempted: true,
        attachmentStatus: "pass",
        doctorHash: "sha256:8181818181818181818181818181818181818181818181818181818181818181",
      },
    },
    {
      ...check(
        "releaseEvidenceRecord",
        "production release evidence record",
        "pass",
        "pass",
        "pass",
        ["AF-RISK-OPS-001", "AF-RISK-OPS-004", "AF-RISK-REL-001"],
        "sha256:7070707070707070707070707070707070707070707070707070707070707070",
      ),
      versionMatch: true,
      metadata: {
        releaseTag: "v0.1.7",
        releaseEvidenceBundleHashStatus: "valid_sha256",
        databaseBackupSha256Status: "valid_sha256",
        uploadsBackupSha256Status: "valid_sha256",
        envBackupSha256Status: "valid_sha256",
      },
    },
    check("supplyChain", "signed Release supply-chain evidence", "pass", "ready_for_sc001_sc002_review", "ready_for_sc001_sc002_review", ["AF-RISK-SC-001", "AF-RISK-SC-002"], "sha256:4040404040404040404040404040404040404040404040404040404040404040"),
    {
      ...check("uxReview", "fresh desktop/mobile product experience review", "pass", "pass", "pass", ["AF-RISK-UX-001"], "sha256:5050505050505050505050505050505050505050505050505050505050505050"),
      freshness: { reviewedAt: "2026-07-12T12:00:00Z", ageDays: 0, maxAgeDays: 14, status: "fresh" },
      versionMatch: true,
    },
    {
      ...check(
        "operationalEvidenceBundle",
        "operational evidence bundle",
        "pass",
        "bundle.status=ready; summary.overall=pass; freshness=fresh",
        "bundle.status=ready; summary.overall=pass; freshness=fresh",
        ["AF-RISK-OPS-001", "AF-RISK-OPS-004"],
        "sha256:6060606060606060606060606060606060606060606060606060606060606060",
      ),
      freshness: {
        latestEvidenceFreshnessStatus: "fresh",
        signals: {},
      },
      versionMatch: true,
      metadata: {
        bundleHash: "7".repeat(64),
        bundleStatus: "ready",
        summaryOverall: "pass",
        latestEvidenceFreshnessStatus: "fresh",
        signals: bundleSignals(options.omitSignal),
      },
    },
  ];
}

function historicalSnapshotV1(): JsonRecord {
  const current = historicalSnapshotV2();
  const source = current.sourceSnapshot as JsonRecord;
  const protectedPathFingerprint = source.protectedPathFingerprint as JsonRecord;
  const historicalProtectedPaths = (protectedPathFingerprint.paths as string[]).filter((item) => ![
    "docs/development/update-request-expected-before-design.md",
    "docs/development/ops-005-expected-before-production-evidence-template.md",
    "docs/development/high-risk-confirmation-packets.md",
    "tasks/active/0019-update-request-expected-before-binding.md",
  ].includes(item));
  const evidencePaths = (source.evidencePaths as JsonRecord[]).filter((item) => item.key !== "ops005ProductionEvidence");
  const inputHashes = (source.inputHashes as JsonRecord[]).filter((item) => item.key !== "ops005ProductionEvidence");
  const checks = (current.checks as JsonRecord[]).filter((item) => item.key !== "ops005");
  const doesNotProve = (current.doesNotProve as string[]).filter((item) => !item.startsWith("OPS-005 "));
  return withHash({
    ...current,
    schemaVersion: 1,
    sourceSnapshot: {
      ...source,
      protectedPathFingerprint: { ...protectedPathFingerprint, paths: historicalProtectedPaths },
      evidencePaths,
      inputHashes,
    },
    checks,
    doesNotProve,
  });
}

function historicalSnapshotV2(): JsonRecord {
  const current = buildSnapshot("needs_live_evidence");
  const source = current.sourceSnapshot as JsonRecord;
  const protectedPathFingerprint = source.protectedPathFingerprint as JsonRecord;
  const historicalProtectedPaths = (protectedPathFingerprint.paths as string[]).filter((item) => ![
    "docs/development/data-integrity-doctor.md",
    "tasks/active/0020-business-state-concurrency.md",
    "tasks/active/0021-attachment-staging-intent.md",
    "tasks/active/0022-updater-phase-journal-hold.md",
    "scripts/ops/data-integrity-doctor.ts",
    "scripts/quality/data-integrity-doctor-validate.ts",
    "scripts/quality/data-integrity-doctor.selftest.ts",
  ].includes(item));
  const evidencePaths = (source.evidencePaths as JsonRecord[]).filter((item) => item.key !== "dataIntegrityRecord");
  const inputHashes = (source.inputHashes as JsonRecord[]).filter((item) => item.key !== "dataIntegrityRecord");
  const checks = (current.checks as JsonRecord[]).filter((item) => item.key !== "dataIntegrity");
  const doesNotProve = (current.doesNotProve as string[]).filter((item) => !item.startsWith("OPS-006 "));
  return withHash({
    ...current,
    schemaVersion: 2,
    sourceSnapshot: {
      ...source,
      protectedPathFingerprint: { ...protectedPathFingerprint, paths: historicalProtectedPaths },
      evidencePaths,
      inputHashes,
    },
    checks,
    doesNotProve,
  });
}

function check(
  key: string,
  label: string,
  status: string,
  actualStatus: string,
  expectedStatus: string,
  residualRiskIds: string[],
  evidenceHash: string,
): JsonRecord {
  return {
    key,
    label,
    status,
    actualStatus,
    expectedStatus,
    validatorCommand: `pnpm exec tsx validator-for-${key}.ts`,
    evidenceHash,
    residualRiskIds,
    freshness: { source: "selftest" },
    versionMatch: "not_applicable",
    doesNotProve: ["production health", "residual ledger closure"],
    metadata: {},
  };
}

function bundleSignals(omitSignal?: string): JsonRecord {
  const signals: JsonRecord = {};
  for (const key of [
    "health",
    "releaseIdentity",
    "updateAgent",
    "authenticatedSmoke",
    "backup",
    "rollback",
    "infrastructure",
  ]) {
    if (key === omitSignal) continue;
    signals[key] = {
      status: "pass",
      freshnessStatus: "fresh",
      evidence: `${key} selftest evidence`,
    };
  }
  return signals;
}

function evidencePath(key: string): JsonRecord {
  return {
    key,
    pathLabel: `docs/development/${key}.json`,
    configured: true,
    exists: true,
    sha256: `sha256:${"8".repeat(64)}`,
  };
}

function inputHash(key: string): JsonRecord {
  return {
    key,
    pathLabel: `docs/development/${key}.json`,
    sha256: `sha256:${"8".repeat(64)}`,
  };
}

function withHash(snapshot: JsonRecord): JsonRecord {
  return {
    ...snapshot,
    snapshotHash: hashSnapshot(snapshot),
  };
}

function hashSnapshot(snapshot: JsonRecord): string {
  return createHash("sha256").update(stableStringify({ ...snapshot, snapshotHash: "" })).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main();
