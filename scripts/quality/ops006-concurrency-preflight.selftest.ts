import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOps006ConcurrencyPreflight, ops006PreflightExitCode } from "./ops006-concurrency-preflight";
import { buildDataIntegrityDoctor } from "../ops/data-integrity-doctor";
import {
  calculateOps006ImplementationHash,
  calculateOps006RecordHash,
} from "./ops006-concurrency-runtime-validate";
import type { AttachmentReconciliationSummary } from "./attachment-reconciliation-summary";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops006-preflight-"));
const now = new Date("2026-07-18T10:00:00.000Z");

try {
  writeFixture();
  const migration = path.join(root, "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql");
  const doctor = path.join(root, "doctor.json");
  const runtime = path.join(root, "runtime.json");

  const missing = expectStatus("local_validation", migration);
  if (ops006PreflightExitCode(missing.status, false) !== 0 || ops006PreflightExitCode(missing.status, true) !== 1) {
    throw new Error("OPS-006 strict mode must fail closed while local evidence is incomplete");
  }
  if (missing.evidenceClass !== "local_concurrency_verified" || missing.localEvidenceStatus !== "incomplete") {
    throw new Error("OPS-006 task phase must not imply verified evidence before runtime inputs pass");
  }

  const doctorRecord = buildDataIntegrityDoctor({
    snapshot: cleanSnapshot(),
    attachmentSummary: cleanAttachmentSummary(),
    generatedAt: "2026-07-18T09:30:00.000Z",
    databaseReadAttempted: true,
  });
  writeFileSync(doctor, `${JSON.stringify(doctorRecord, null, 2)}\n`);
  const runtimeRecord = createRuntimeRecord();
  writeFileSync(runtime, `${JSON.stringify(runtimeRecord, null, 2)}\n`);

  const ready = expectStatus("local_verified", migration, doctor, runtime);
  if (ready.localEvidenceStatus !== "complete" || ops006PreflightExitCode(ready.status, true) !== 0) {
    throw new Error("OPS-006 strict mode must pass only for local_verified evidence");
  }
  if (
    ready.evidence.doctorHash !== doctorRecord.doctorHash
    || ready.evidence.runtimeRecordHash !== runtimeRecord.recordHash
    || !ready.evidence.runtimeFileSha256?.startsWith("sha256:")
  ) {
    throw new Error("OPS-006 local evidence hashes are incomplete");
  }
  if (!ready.doesNotProve.includes("production migration or deployment authorization")) {
    throw new Error("OPS-006 local verification must keep production blocked");
  }

  const design = path.join(root, "docs/development/ops-006-business-state-concurrency-design.md");
  const originalDesign = readFile(design);
  writeFileSync(design, originalDesign.replace("OPS-006-PREFLIGHT-CONTRACT-V2", "OPS-006-PREFLIGHT-CONTRACT-DRIFT"));
  expectStatus("invalid", migration, doctor, runtime);
  writeFileSync(design, originalDesign);

  writeFileSync(migration, `${readFile(migration)}CREATE UNIQUE INDEX "extra_idx" ON "StudySession" ("id");\n`);
  expectStatus("invalid", migration, doctor, runtime);
  writeFileSync(migration, `CREATE UNIQUE INDEX "StudySession_one_active_idx" ON "StudySession" ((1)) WHERE "status" IN ('RUNNING', 'PAUSED');\n`);

  const staleDoctor = buildDataIntegrityDoctor({
    snapshot: cleanSnapshot(),
    generatedAt: "2026-07-15T00:00:00.000Z",
    databaseReadAttempted: true,
  });
  writeFileSync(doctor, `${JSON.stringify(staleDoctor, null, 2)}\n`);
  expectStatus("invalid", migration, doctor, runtime);
  writeFileSync(doctor, `${JSON.stringify(doctorRecord, null, 2)}\n`);

  const staleRuntime = { ...runtimeRecord, generatedAt: "2026-07-15T00:00:00.000Z" };
  staleRuntime.recordHash = calculateOps006RecordHash(staleRuntime);
  writeFileSync(runtime, `${JSON.stringify(staleRuntime, null, 2)}\n`);
  expectStatus("invalid", migration, doctor, runtime);

  console.log("PASS OPS-006 concurrency preflight selftest");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeFixture(): void {
  mkdirSync(path.join(root, "tasks/active"), { recursive: true });
  mkdirSync(path.join(root, "prisma/migrations/20260718010000_add_active_session_unique_index"), { recursive: true });
  mkdirSync(path.join(root, "docs/development"), { recursive: true });
  for (const file of implementationFiles()) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `fixture ${file}\n`);
  }
  writeFileSync(path.join(root, "tasks/active/0020-business-state-concurrency.md"), [
    "status: in-progress",
    "phase: local-verified",
    "evidenceClass: local_concurrency_verified",
    "preflightContract: OPS-006-PREFLIGHT-CONTRACT-V2",
    "production_confirmation_required",
    "确认执行 OPS-006 业务状态并发一致性本地实施",
  ].join("\n"));
  writeFileSync(path.join(root, "docs/development/ops-006-business-state-concurrency-design.md"), [
    "OPS-006-PREFLIGHT-CONTRACT-V2",
    "local_concurrency_verified",
    "任务动作状态矩阵",
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "local_verified",
    "production_confirmation_required",
    "确认执行 OPS-006 业务状态并发一致性本地实施",
  ].join("\n"));
  writeFileSync(path.join(root, "docs/development/high-risk-confirmation-packets.md"), [
    "## OPS-006 业务状态并发一致性本地实施确认包",
    "状态：已确认（2026-07-18）",
    "OPS-006-PREFLIGHT-CONTRACT-V2",
    "local_concurrency_verified",
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "production_confirmation_required",
    "确认执行 OPS-006 业务状态并发一致性本地实施",
    "## NEXT",
  ].join("\n"));
  writeFileSync(path.join(root, "prisma/schema.prisma"), "model StudySession {\n  status String\n}\n");
  writeFileSync(
    path.join(root, "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql"),
    `CREATE UNIQUE INDEX "StudySession_one_active_idx" ON "StudySession" ((1)) WHERE "status" IN ('RUNNING', 'PAUSED');\n`,
  );
}

function createRuntimeRecord() {
  const migration = path.join(root, "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql");
  const body = {
    schemaVersion: 1,
    mode: "isolated_postgresql_ops006_concurrency_selftest",
    generatedAt: "2026-07-18T09:45:00.000Z",
    status: "pass",
    source: {
      database: "isolated_local_postgresql",
      migration: "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql",
      migrationSha256: sha256(readFileSync(migration)),
      implementationSha256: calculateOps006ImplementationHash(root),
    },
    checks: [
      pass("migration.apply_verify_negative_fixtures", { publicIndexPresent: true }),
      pass("checkin.lock_key_contract", { orderedDayCount: 2 }),
      pass("session.concurrent_start", { successCount: 1, conflictCount: 1 }),
      pass("session.pause_resume_end_cas", { pauseWinnerCount: 1, resumeWinnerCount: 1, endWinnerCount: 1 }),
      pass("task.command_cas", { commandCount: 7, winnerCount: 7, conflictCount: 7 }),
      pass("task.simulation_complete_cas", { successCount: 1, conflictCount: 1 }),
      pass("task.debt_reorder_cas", { successCount: 1, conflictCount: 1 }),
      pass("checkin.concurrent_refresh", { committedTaskCount: 2, doneTaskCount: 2, taskCompletionRate: 1 }),
    ],
    doesNotProve: [
      "production migration safety",
      "production data integrity",
      "signed Release readiness",
      "AF-RISK-OPS-006 residual closure",
    ],
    safetyFacts: {
      isolatedDatabaseRequired: true,
      isolatedDatabaseWriteAttempted: true,
      productionWriteAttempted: false,
      historicalRepairAttempted: false,
      serverCommandAttempted: false,
      secretValuePrinted: false,
      businessTextIncluded: false,
      objectIdentifiersIncluded: false,
    },
  };
  return { ...body, recordHash: calculateOps006RecordHash(body) };
}

function expectStatus(status: string, migrationPath?: string, doctorPath?: string, runtimePath?: string) {
  const result = buildOps006ConcurrencyPreflight({ root, migrationPath, doctorPath, runtimePath, now });
  if (result.status !== status) throw new Error(`expected ${status}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  if (result.safetyFacts.readOnly !== true || result.safetyFacts.databaseWriteAttempted !== false || result.safetyFacts.migrationAttempted !== false) {
    throw new Error("OPS-006 preflight safety facts are invalid");
  }
  return result;
}

function pass(id: string, details: Record<string, string | number | boolean>) {
  return { id, status: "pass" as const, details };
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

function implementationFiles(): string[] {
  return [
    "apps/web/lib/study/concurrency.ts",
    "apps/web/lib/study/check-in-service.ts",
    "apps/web/lib/study/service.ts",
    "apps/web/lib/study/simulation-service.ts",
    "apps/web/lib/study/task-debt-reorder-service.ts",
  ];
}

function readFile(file: string): string {
  return readFileSync(file, "utf8");
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function cleanAttachmentSummary(): AttachmentReconciliationSummary {
  return {
    schemaVersion: 1,
    mode: "read_only_attachment_reconciliation_summary",
    generatedAt: "2026-07-18T09:00:00.000Z",
    status: "pass",
    action: "report_only",
    source: { reconciliationCsvSha256: `sha256:${"a".repeat(64)}`, uploadDirectory: "configured_private_upload_directory" },
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
