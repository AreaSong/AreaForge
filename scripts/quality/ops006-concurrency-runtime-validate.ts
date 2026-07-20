import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const migrationRelativePath = "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql";
const implementationFiles = [
  "apps/web/lib/study/concurrency.ts",
  "apps/web/lib/study/check-in-service.ts",
  "apps/web/lib/study/service.ts",
  "apps/web/lib/study/simulation-service.ts",
  "apps/web/lib/study/task-debt-reorder-service.ts",
];
const requiredCheckIds = [
  "migration.apply_verify_negative_fixtures",
  "checkin.lock_key_contract",
  "session.concurrent_start",
  "session.pause_resume_end_cas",
  "task.command_cas",
  "task.simulation_complete_cas",
  "task.debt_reorder_cas",
  "checkin.concurrent_refresh",
];

type RuntimeRecord = {
  schemaVersion?: unknown;
  mode?: unknown;
  generatedAt?: unknown;
  status?: unknown;
  source?: {
    database?: unknown;
    migration?: unknown;
    migrationSha256?: unknown;
    implementationSha256?: unknown;
  };
  checks?: Array<{ id?: unknown; status?: unknown; details?: Record<string, unknown> }>;
  doesNotProve?: unknown;
  safetyFacts?: Record<string, unknown>;
  recordHash?: unknown;
};

export function validateOps006RuntimeRecord(
  raw: string,
  options: { root?: string; now?: Date; maxAgeHours?: number } = {},
): string[] {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const maxAgeHours = options.maxAgeHours ?? 24;
  const issues: string[] = [];
  let record: RuntimeRecord;

  try {
    record = JSON.parse(raw) as RuntimeRecord;
  } catch {
    return ["record is not valid JSON"];
  }

  if (record.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (record.mode !== "isolated_postgresql_ops006_concurrency_selftest") issues.push("mode is invalid");
  if (record.status !== "pass") issues.push("status must be pass");
  validateFreshness(record.generatedAt, now, maxAgeHours, issues);

  if (record.source?.database !== "isolated_local_postgresql") issues.push("source database must be isolated local PostgreSQL");
  if (record.source?.migration !== migrationRelativePath) issues.push("migration source path is invalid");
  if (record.source?.migrationSha256 !== fileSha256(path.join(root, migrationRelativePath))) {
    issues.push("migration hash does not match the current checkout");
  }
  if (record.source?.implementationSha256 !== calculateOps006ImplementationHash(root)) {
    issues.push("implementation hash does not match the current checkout");
  }

  const checks = new Map((record.checks ?? []).map((check) => [check.id, check]));
  if (checks.size !== requiredCheckIds.length) issues.push("checks must contain only the required OPS-006 runtime checks");
  for (const id of requiredCheckIds) {
    if (checks.get(id)?.status !== "pass") issues.push(`required runtime check did not pass: ${id}`);
  }
  validateCheckDetails(checks, issues);

  const safety = record.safetyFacts ?? {};
  const requiredTrue = ["isolatedDatabaseRequired", "isolatedDatabaseWriteAttempted"];
  const requiredFalse = [
    "productionWriteAttempted",
    "historicalRepairAttempted",
    "serverCommandAttempted",
    "secretValuePrinted",
    "businessTextIncluded",
    "objectIdentifiersIncluded",
  ];
  for (const key of requiredTrue) if (safety[key] !== true) issues.push(`${key} must be true`);
  for (const key of requiredFalse) if (safety[key] !== false) issues.push(`${key} must be false`);

  const expectedDoesNotProve = [
    "production migration safety",
    "production data integrity",
    "signed Release readiness",
    "AF-RISK-OPS-006 residual closure",
  ];
  const doesNotProve = Array.isArray(record.doesNotProve) ? record.doesNotProve : [];
  if (!Array.isArray(record.doesNotProve) || expectedDoesNotProve.some((value) => !doesNotProve.includes(value))) {
    issues.push("doesNotProve is incomplete");
  }

  if (record.recordHash !== calculateOps006RecordHash(record)) issues.push("recordHash is invalid");
  return issues;
}

export function calculateOps006ImplementationHash(root = process.cwd()): string | null {
  const paths = implementationFiles.map((file) => path.join(root, file));
  if (paths.some((file) => !existsSync(file))) return null;
  return sha256(paths.map((file) => readFileSync(file)).join("\n"));
}

export function calculateOps006RecordHash(record: RuntimeRecord): string {
  const { recordHash: _recordHash, ...body } = record;
  return sha256(JSON.stringify(body));
}

function validateFreshness(value: unknown, now: Date, maxAgeHours: number, issues: string[]): void {
  if (typeof value !== "string") {
    issues.push("generatedAt is missing");
    return;
  }
  const generatedAt = new Date(value);
  const ageHours = (now.getTime() - generatedAt.getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < -0.5 || ageHours > maxAgeHours) {
    issues.push(`record must be fresh within ${maxAgeHours} hours`);
  }
}

function validateCheckDetails(
  checks: Map<unknown, { id?: unknown; status?: unknown; details?: Record<string, unknown> }>,
  issues: string[],
): void {
  const exactOne = [
    "session.concurrent_start",
    "task.simulation_complete_cas",
    "task.debt_reorder_cas",
  ];
  for (const id of exactOne) {
    const details = checks.get(id)?.details;
    if (details?.successCount !== 1 || details.conflictCount !== 1) issues.push(`${id} must report one winner and one conflict`);
  }
  const session = checks.get("session.pause_resume_end_cas")?.details;
  if (session?.pauseWinnerCount !== 1 || session.resumeWinnerCount !== 1 || session.endWinnerCount !== 1) {
    issues.push("session transition winners are invalid");
  }
  const task = checks.get("task.command_cas")?.details;
  if (typeof task?.commandCount !== "number" || task.winnerCount !== task.commandCount || task.conflictCount !== task.commandCount) {
    issues.push("task command CAS counts are invalid");
  }
  const checkIn = checks.get("checkin.concurrent_refresh")?.details;
  if (checkIn?.committedTaskCount !== 2 || checkIn.doneTaskCount !== 2 || checkIn.taskCompletionRate !== 1) {
    issues.push("CheckIn committed aggregate is invalid");
  }
}

function fileSha256(filePath: string): string | null {
  return existsSync(filePath) ? sha256(readFileSync(filePath)) : null;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const recordPath = process.argv[2];
  if (!recordPath || !existsSync(recordPath)) {
    console.error("OPS-006 runtime record path is required");
    process.exitCode = 1;
  } else {
    const issues = validateOps006RuntimeRecord(readFileSync(recordPath, "utf8"));
    if (issues.length > 0) {
      console.error(`OPS-006 runtime record validation failed: ${issues.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("OPS-006 runtime record validation passed.");
    }
  }
}
