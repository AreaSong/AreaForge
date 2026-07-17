import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOps006ConcurrencyPreflight, ops006PreflightExitCode } from "./ops006-concurrency-preflight";
import { buildDataIntegrityDoctor } from "../ops/data-integrity-doctor";
import type { AttachmentReconciliationSummary } from "./attachment-reconciliation-summary";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops006-preflight-"));
const now = new Date("2026-07-15T01:00:00.000Z");
try {
  writeFixture();
  const awaiting = expectStatus("awaiting_high_risk_confirmation");
  if (ops006PreflightExitCode(awaiting.status, false) !== 0 || ops006PreflightExitCode(awaiting.status, true) !== 1) {
    throw new Error("OPS-006 strict mode must fail closed when candidate evidence is missing");
  }
  if (!awaiting.evidence.schemaSha256?.startsWith("sha256:") || awaiting.evidence.candidateMigrationSha256 !== null) {
    throw new Error("OPS-006 preflight must bind the current schema preimage before a candidate exists");
  }
  assertSourceContract(awaiting);
  if (awaiting.evidenceClass !== "migration_preimage_candidate" || awaiting.candidateEvidenceStatus !== "incomplete") {
    throw new Error("OPS-006 preflight must classify missing candidate evidence without implying implementation readiness");
  }

  const migration = path.join(root, "candidate.sql");
  writeFileSync(migration, `CREATE UNIQUE INDEX "StudySession_one_active_idx" ON "StudySession" ((1)) WHERE "status" IN ('RUNNING', 'PAUSED');\n`);
  const doctor = path.join(root, "doctor.json");
  const doctorRecord = buildDataIntegrityDoctor({
    snapshot: {
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
    },
    attachmentSummary: cleanAttachmentSummary(),
    generatedAt: "2026-07-15T00:30:00.000Z",
    databaseReadAttempted: true,
  });
  writeFileSync(doctor, `${JSON.stringify(doctorRecord, null, 2)}\n`);
  const ready = expectStatus("awaiting_high_risk_confirmation", migration, doctor);
  if (ready.candidateEvidenceStatus !== "complete" || ops006PreflightExitCode(ready.status, true) !== 1) {
    throw new Error("OPS-006 complete candidate evidence must remain blocked by strict mode before implementation confirmation");
  }
  if (!ready.evidence.candidateMigrationSha256?.startsWith("sha256:") || !ready.evidence.doctorFileSha256?.startsWith("sha256:")) {
    throw new Error("OPS-006 candidate evidence hashes are missing");
  }
  if (ready.evidence.doctorHash !== doctorRecord.doctorHash) {
    throw new Error("OPS-006 preflight did not bind the validated internal doctor hash");
  }
  assertSourceContract(ready);
  if (!ready.doesNotProve.includes("business service CAS implementation")) {
    throw new Error("OPS-006 candidate evidence must explicitly exclude CAS implementation proof");
  }

  const design = path.join(root, "docs/development/ops-006-business-state-concurrency-design.md");
  const originalDesign = readFile(design);
  writeFileSync(design, originalDesign.replace("OPS-006-PREFLIGHT-CONTRACT-V1", "OPS-006-PREFLIGHT-CONTRACT-DRIFT"));
  const designDrift = expectStatus("invalid", migration, doctor);
  if (designDrift.evidence.designSha256 === ready.evidence.designSha256) {
    throw new Error("OPS-006 design source hash must change when the contract source changes");
  }
  writeFileSync(design, originalDesign);

  const packet = path.join(root, "docs/development/high-risk-confirmation-packets.md");
  const originalPacket = readFile(packet);
  writeFileSync(packet, originalPacket.replace("strict 必须非零退出", "strict contract removed"));
  const packetDrift = expectStatus("invalid", migration, doctor);
  if (packetDrift.evidence.confirmationPacketSha256 === ready.evidence.confirmationPacketSha256) {
    throw new Error("OPS-006 confirmation packet source hash must change when the contract source changes");
  }
  writeFileSync(packet, originalPacket);

  writeFileSync(migration, `${readFile(migration)}CREATE UNIQUE INDEX "extra_idx" ON "StudySession" ("id");\n`);
  expectStatus("invalid", migration, doctor);

  writeFileSync(migration, `-- no UPDATE is performed\nCREATE UNIQUE INDEX "StudySession_one_active_idx" ON "StudySession" ((1)) WHERE "status" IN ('RUNNING', 'PAUSED');\n`);
  expectStatus("awaiting_high_risk_confirmation", migration, doctor);

  writeFileSync(migration, `CREATE UNIQUE INDEX "StudySession_one_active_idx" ON "StudySession" ((1)) WHERE "status" IN ('RUNNING', 'PAUSED') INCLUDE ("id");\n`);
  expectStatus("invalid", migration, doctor);

  writeFileSync(migration, `CREATE UNIQUE INDEX "StudySession_one_active_idx" ON "StudySession" ((1)) WHERE "status" IN ('RUNNING', 'PAUSED'); /* unterminated\n`);
  expectStatus("invalid", migration, doctor);

  writeFileSync(migration, `CREATE UNIQUE INDEX "StudySession_one_active_idx" ON "StudySession" ((1)) WHERE "status" IN ('RUNNING', 'PAUSED');\n`);
  const fixtureDoctor = buildDataIntegrityDoctor({
    snapshot: cleanSnapshot(),
    generatedAt: "2026-07-15T00:30:00.000Z",
    databaseReadAttempted: false,
  });
  writeFileSync(doctor, `${JSON.stringify(fixtureDoctor, null, 2)}\n`);
  expectStatus("invalid", migration, doctor);

  const staleDoctor = buildDataIntegrityDoctor({
    snapshot: cleanSnapshot(),
    generatedAt: "2026-07-13T00:00:00.000Z",
    databaseReadAttempted: true,
  });
  writeFileSync(doctor, `${JSON.stringify(staleDoctor, null, 2)}\n`);
  expectStatus("invalid", migration, doctor);

  const staleActiveDoctor = buildDataIntegrityDoctor({
    snapshot: { ...cleanSnapshot(), staleActiveSessionCount: 1 },
    generatedAt: "2026-07-15T00:30:00.000Z",
    databaseReadAttempted: true,
  });
  writeFileSync(doctor, `${JSON.stringify(staleActiveDoctor, null, 2)}\n`);
  expectStatus("invalid", migration, doctor);

  const attachmentFailDoctor = buildDataIntegrityDoctor({
    snapshot: cleanSnapshot(),
    attachmentSummary: { ...cleanAttachmentSummary(), status: "mismatch", counts: { ...cleanAttachmentSummary().counts, fileOnlyCount: 1 } },
    generatedAt: "2026-07-15T00:30:00.000Z",
    databaseReadAttempted: true,
  });
  writeFileSync(doctor, `${JSON.stringify(attachmentFailDoctor, null, 2)}\n`);
  expectStatus("awaiting_high_risk_confirmation", migration, doctor);

  writeFileSync(migration, `${readFile(migration)}DELETE FROM "StudySession";\n`);
  const invalid = expectStatus("invalid", migration, doctor);
  if (invalid.evidence.candidateMigrationSha256 === ready.evidence.candidateMigrationSha256) {
    throw new Error("OPS-006 migration hash must change when candidate SQL changes");
  }
  console.log("PASS OPS-006 concurrency preflight selftest");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeFixture(): void {
  mkdirSync(path.join(root, "tasks/active"), { recursive: true });
  mkdirSync(path.join(root, "prisma"), { recursive: true });
  mkdirSync(path.join(root, "docs/development"), { recursive: true });
  writeFileSync(path.join(root, "tasks/active/0020-business-state-concurrency.md"), [
    "status: blocked",
    "phase: awaiting-high-risk-confirmation",
    "evidenceClass: migration_preimage_candidate",
    "preflightContract: OPS-006-PREFLIGHT-CONTRACT-V1",
    "确认执行 OPS-006 业务状态并发一致性本地实施",
  ].join("\n"));
  writeFileSync(path.join(root, "docs/development/ops-006-business-state-concurrency-design.md"), [
    "OPS-006-PREFLIGHT-CONTRACT-V1",
    "evidenceClass: migration_preimage_candidate",
    "不证明 CAS 已实现",
    "任务动作状态矩阵",
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "production_confirmation_required",
    "确认执行 OPS-006 业务状态并发一致性本地实施",
  ].join("\n"));
  writeFileSync(path.join(root, "docs/development/high-risk-confirmation-packets.md"), [
    "## OPS-006 业务状态并发一致性本地实施确认包",
    "状态：等待确认",
    "OPS-006-PREFLIGHT-CONTRACT-V1",
    "evidenceClass: migration_preimage_candidate",
    "strict 必须非零退出",
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "production_confirmation_required",
    "确认执行 OPS-006 业务状态并发一致性本地实施",
    "## NEXT",
  ].join("\n"));
  writeFileSync(path.join(root, "prisma/schema.prisma"), "model StudySession {\n  status String\n}\n");
}

function assertSourceContract(result: ReturnType<typeof buildOps006ConcurrencyPreflight>): void {
  const hashes = [
    result.evidence.taskSha256,
    result.evidence.designSha256,
    result.evidence.confirmationPacketSha256,
    result.evidence.implementationConfirmationPhraseSha256,
  ];
  if (result.evidence.sourceContractId !== "OPS-006-PREFLIGHT-CONTRACT-V1" || hashes.some((hash) => !hash?.startsWith("sha256:"))) {
    throw new Error("OPS-006 preflight must bind task/design/confirmation packet source hashes and the confirmation phrase contract");
  }
}

function expectStatus(status: string, migrationPath?: string, doctorPath?: string) {
  const result = buildOps006ConcurrencyPreflight({ root, migrationPath, doctorPath, now });
  if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  if (result.safetyFacts.readOnly !== true || result.safetyFacts.databaseWriteAttempted !== false || result.safetyFacts.migrationAttempted !== false) {
    throw new Error("OPS-006 preflight safety facts are invalid");
  }
  return result;
}

function cleanSnapshot() {
  return {
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
}

function readFile(file: string): string {
  return readFileSync(file, "utf8");
}

function cleanAttachmentSummary(): AttachmentReconciliationSummary {
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
    doesNotProve: ["automatic orphan cleanup", "production health"],
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
