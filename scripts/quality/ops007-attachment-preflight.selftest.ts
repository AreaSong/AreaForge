import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOps007AttachmentPreflight,
  ops007PreflightExitCode,
  type Ops007PreflightStatus,
} from "./ops007-attachment-preflight";
import {
  calculateOps007ImplementationHash,
  calculateOps007RecordHash,
} from "./ops007-attachment-runtime-validate";

const repositoryRoot = process.cwd();
const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops007-preflight-"));
const now = new Date();
const migrationRelative = "prisma/migrations/20260721010000_attachment_staging_write_intent/migration.sql";
const taskRelative = "tasks/active/0021-attachment-staging-intent.md";

try {
  copySources();
  const runtime = path.join(root, "runtime.json");

  const missingRuntime = expectStatus("local_validation");
  if (ops007PreflightExitCode(missingRuntime.status, false) !== 0 || ops007PreflightExitCode(missingRuntime.status, true) !== 1) {
    throw new Error("OPS-007 strict mode must fail closed while local runtime evidence is incomplete");
  }
  if (missingRuntime.evidenceClass !== "local_attachment_protocol_verified" || missingRuntime.localEvidenceStatus !== "incomplete") {
    throw new Error("OPS-007 task phase must not imply verified evidence before runtime inputs pass");
  }
  assertHashes(missingRuntime);
  assertClaimBoundaries(missingRuntime);

  const runtimeRecord = createRuntimeRecord();
  writeFileSync(runtime, `${JSON.stringify(runtimeRecord, null, 2)}\n`);
  const ready = expectStatus("local_verified", runtime);
  if (ready.localEvidenceStatus !== "complete" || ops007PreflightExitCode(ready.status, true) !== 0) {
    throw new Error("OPS-007 strict mode must pass only for local_verified evidence");
  }
  if (
    ready.evidence.runtimeRecordHash !== runtimeRecord.recordHash
    || !ready.evidence.runtimeFileSha256?.startsWith("sha256:")
    || !ready.evidence.migrationSha256?.startsWith("sha256:")
  ) {
    throw new Error("OPS-007 local evidence hashes are incomplete");
  }
  if (!ready.doesNotProve.includes("candidate or applied production database migration")) {
    throw new Error("OPS-007 local verification must keep production blocked");
  }

  const awaiting = withAwaitingTask(() => expectStatus("awaiting_high_risk_confirmation", runtime));
  if (ops007PreflightExitCode(awaiting.status, false) !== 0 || ops007PreflightExitCode(awaiting.status, true) !== 1) {
    throw new Error("OPS-007 awaiting confirmation must pass projection mode and fail strict mode");
  }
  if (awaiting.evidenceClass !== "protocol_preimage_candidate") {
    throw new Error("OPS-007 awaiting phase must keep the preimage candidate evidence class");
  }

  expectSourceDrift(
    "docs/development/ops-007-attachment-crash-window-design.md",
    "OPS-007-PREFLIGHT-CONTRACT-V2",
    "OPS-007-PREFLIGHT-CONTRACT-DRIFT",
    "designSha256",
    ready,
    runtime,
  );
  expectSourceDrift(
    "docs/development/high-risk-confirmation-packets.md",
    "状态：已确认",
    "状态：漂移",
    "confirmationPacketSha256",
    ready,
    runtime,
  );
  expectSourceDrift(
    "prisma/schema.prisma",
    "AttachmentStatus @default(PENDING)",
    "AttachmentStatus @default(READY)",
    "schemaSha256",
    ready,
    runtime,
  );

  const migration = path.join(root, migrationRelative);
  const originalMigration = readFileSync(migration, "utf8");
  writeFileSync(migration, `${originalMigration}UPDATE "Attachment" SET "status" = 'READY';\n`);
  expectStatus("invalid", runtime);
  writeFileSync(migration, originalMigration);

  const staleRuntime = { ...runtimeRecord, generatedAt: new Date(now.getTime() - 48 * 3_600_000).toISOString() };
  staleRuntime.recordHash = calculateOps007RecordHash(staleRuntime);
  writeFileSync(runtime, `${JSON.stringify(staleRuntime, null, 2)}\n`);
  expectStatus("invalid", runtime);
  writeFileSync(runtime, `${JSON.stringify(runtimeRecord, null, 2)}\n`);

  const fixture = path.join(root, "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json");
  const originalFixture = readFileSync(fixture, "utf8");
  writeFileSync(fixture, originalFixture.replace('"status": "pass"', '"status": "invalid"'));
  const fixtureDrift = expectStatus("invalid", runtime);
  if (fixtureDrift.evidence.sourceBindingHash === ready.evidence.sourceBindingHash) {
    throw new Error("OPS-007 sourceBindingHash must change after fixture tampering");
  }
  writeFileSync(fixture, originalFixture);

  console.log("ops007 attachment preflight selftest passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function copySources(): void {
  const relativeFiles = [
    taskRelative,
    "docs/development/ops-007-attachment-crash-window-design.md",
    "docs/development/high-risk-confirmation-packets.md",
    "prisma/schema.prisma",
    migrationRelative,
    "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json",
    "apps/web/lib/study/attachments-service.ts",
    "apps/web/lib/study/attachment-reconciliation-service.ts",
    "apps/web/app/api/notes/[noteId]/attachments/route.ts",
    "packages/storage/src/index.ts",
    "packages/storage/src/bounded-multipart.ts",
  ];
  for (const relative of relativeFiles) {
    const destination = path.join(root, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(repositoryRoot, relative), destination);
  }
}

function createRuntimeRecord() {
  const body = {
    schemaVersion: 1,
    mode: "isolated_postgresql_ops007_attachment_selftest",
    generatedAt: now.toISOString(),
    status: "pass",
    source: {
      database: "isolated_local_postgresql",
      uploadDirectory: "temporary_isolated_upload_directory",
      migration: migrationRelative,
      migrationSha256: sha256(readFileSync(path.join(root, migrationRelative))),
      implementationSha256: calculateOps007ImplementationHash(root),
    },
    checks: [
      pass("migration.apply_verify_legacy_defaults", { legacyReadyCount: 1, legacyProtocolVersionZeroCount: 1 }),
      pass("migration.repeat_and_duplicate_preimage_rejected", { repeatApplyRejected: true, duplicatePreimageRejected: true }),
      pass("upload.write_intent_happy_path", { readyCount: 1, stagingLeftoverCount: 0, dtoHashExposed: false }),
      pass("upload.storage_identity_conflict_before_file", { conflictBeforeFileWrite: true, newFileCount: 0 }),
      pass("upload.staging_failure_compensation", { failedCount: 1, stagingRemoved: true }),
      pass("upload.compensation_failure_auditable", { failureCodeStable: true, stagingRetained: true }),
      pass("upload.ready_cas_conflict_preserves_final", { finalFileRetained: true, pendingRetained: true }),
      pass("reconciliation.kill_point_matrix", {
        finalizedFromStagingCount: 1,
        readyFromFinalCount: 1,
        failedMissingFileCount: 1,
        failedIntegrityMismatchCount: 1,
        blockedDualFileCount: 1,
        dualFileDeleted: false,
      }),
      pass("reconciliation.claim_lease_cas", { staleClaimCommitCount: 0, expiredLeaseReclaimed: true, youngIntentSkipped: true }),
      pass("download.o_nofollow_and_status_gate", {
        symlinkRejected: true,
        pendingRejected: true,
        failedRejected: true,
        hashMismatchRejected: true,
        legacyReadCompatible: true,
      }),
    ],
    doesNotProve: [
      "production migration safety",
      "production attachment write safety",
      "historical orphan cleanup",
      "backup or restore success",
      "signed Release readiness",
      "AF-RISK-OPS-007 residual closure",
    ],
    safetyFacts: {
      isolatedDatabaseRequired: true,
      isolatedDatabaseWriteAttempted: true,
      temporaryUploadDirectoryUsed: true,
      productionWriteAttempted: false,
      historicalOrphanMutated: false,
      readyAttachmentDeleted: false,
      serverCommandAttempted: false,
      secretValuePrinted: false,
      businessTextIncluded: false,
      objectIdentifiersIncluded: false,
    },
  };
  return { ...body, recordHash: calculateOps007RecordHash(body) };
}

function withAwaitingTask<T>(run: () => T): T {
  const task = path.join(root, taskRelative);
  const original = readFileSync(task, "utf8");
  writeFileSync(task, [
    "status: blocked",
    "phase: awaiting-high-risk-confirmation",
    "evidenceClass: protocol_preimage_candidate",
    "preflightContract: OPS-007-PREFLIGHT-CONTRACT-V2",
    "> 确认执行 OPS-007 附件 staging/write-intent 本地实施：占位。",
  ].join("\n"));
  try {
    return run();
  } finally {
    writeFileSync(task, original);
  }
}

function expectStatus(expected: Ops007PreflightStatus, runtimePath?: string) {
  const result = buildOps007AttachmentPreflight({ root, runtimePath, now });
  if (result.status !== expected) {
    throw new Error(`expected OPS-007 status ${expected}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  }
  return result;
}

function expectSourceDrift(
  relative: string,
  before: string,
  after: string,
  evidenceKey: "taskSha256" | "designSha256" | "confirmationPacketSha256" | "schemaSha256",
  baseline: ReturnType<typeof buildOps007AttachmentPreflight>,
  runtimePath: string,
): void {
  const file = path.join(root, relative);
  const original = readFileSync(file, "utf8");
  if (!original.includes(before)) throw new Error(`selftest source marker missing: ${relative}: ${before}`);
  writeFileSync(file, original.replaceAll(before, after));
  const drift = expectStatus("invalid", runtimePath);
  if (drift.evidence[evidenceKey] === baseline.evidence[evidenceKey]) {
    throw new Error(`OPS-007 ${evidenceKey} must change after source drift`);
  }
  if (drift.evidence.sourceBindingHash === baseline.evidence.sourceBindingHash) {
    throw new Error("OPS-007 sourceBindingHash must change after source drift");
  }
  writeFileSync(file, original);
}

function assertHashes(result: ReturnType<typeof buildOps007AttachmentPreflight>): void {
  const hashes = [
    result.evidence.taskSha256,
    result.evidence.designSha256,
    result.evidence.confirmationPacketSha256,
    result.evidence.schemaSha256,
    result.evidence.migrationSha256,
    result.evidence.fixtureFileSha256,
    result.evidence.fixtureHash,
    result.evidence.sourceBindingHash,
    result.evidence.implementationConfirmationPhraseSha256,
  ];
  if (hashes.some((value) => !value || !/^sha256:[a-f0-9]{64}$/.test(value))) {
    throw new Error("OPS-007 preflight must bind every source, migration, and fixture hash");
  }
}

function assertClaimBoundaries(result: ReturnType<typeof buildOps007AttachmentPreflight>): void {
  const required = [
    "candidate or applied production database migration",
    "production attachment safety or production state",
    "filesystem durability guarantees outside the isolated fixture",
    "backup or restore success",
    "historical orphan cleanup or residual ledger closure",
    "signed Release readiness",
  ];
  for (const claim of required) {
    if (!result.doesNotProve.includes(claim)) {
      throw new Error(`OPS-007 preflight must explicitly exclude proof of ${claim}`);
    }
  }
  if (
    !result.safetyFacts.readOnly ||
    result.safetyFacts.databaseConnectionAttempted ||
    result.safetyFacts.uploadDirectoryReadAttempted ||
    result.safetyFacts.migrationAttempted ||
    result.safetyFacts.productionWriteAttempted ||
    result.safetyFacts.secretValueReadOrPrinted
  ) {
    throw new Error("OPS-007 preflight safety facts must remain strictly read-only and offline");
  }
}

function pass(id: string, details: Record<string, string | number | boolean>) {
  return { id, status: "pass" as const, details };
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
