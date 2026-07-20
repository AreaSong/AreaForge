import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  calculateOps006ImplementationHash,
  calculateOps006RecordHash,
  validateOps006RuntimeRecord,
} from "./ops006-concurrency-runtime-validate";

const root = process.cwd();
const record = createFixture();
assertValid(JSON.stringify(record));

const tampered = structuredClone(record);
const startCheck = tampered.checks.find((check) => check.id === "session.concurrent_start");
if (!startCheck) throw new Error("OPS-006 runtime selftest fixture is missing the start check");
startCheck.details.successCount = 2;
tampered.recordHash = calculateOps006RecordHash(tampered);
assertInvalid(JSON.stringify(tampered), "session.concurrent_start must report one winner and one conflict");

const stale = structuredClone(record);
stale.generatedAt = "2026-07-01T00:00:00.000Z";
stale.recordHash = calculateOps006RecordHash(stale);
assertInvalid(JSON.stringify(stale), "record must be fresh within 24 hours");

console.log("PASS OPS-006 runtime record validator selftest");

function createFixture() {
  const body = {
    schemaVersion: 1,
    mode: "isolated_postgresql_ops006_concurrency_selftest",
    generatedAt: new Date().toISOString(),
    status: "pass",
    source: {
      database: "isolated_local_postgresql",
      migration: "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql",
      migrationSha256: sha256(readFileSync(path.join(root, "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql"))),
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

function pass(id: string, details: Record<string, string | number | boolean>) {
  return { id, status: "pass" as const, details };
}

function assertValid(value: string): void {
  const issues = validateOps006RuntimeRecord(value, { root });
  if (issues.length > 0) throw new Error(`expected valid OPS-006 runtime record: ${issues.join(", ")}`);
}

function assertInvalid(value: string, expectedIssue: string): void {
  const issues = validateOps006RuntimeRecord(value, { root });
  if (!issues.includes(expectedIssue)) throw new Error(`expected issue '${expectedIssue}', got ${issues.join(", ")}`);
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
