import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const migrationRelativePath = "prisma/migrations/20260721010000_attachment_staging_write_intent/migration.sql";
const implementationFiles = [
  "apps/web/lib/study/attachments-service.ts",
  "apps/web/lib/study/attachment-reconciliation-service.ts",
  "apps/web/app/api/notes/[noteId]/attachments/route.ts",
  "packages/storage/src/index.ts",
  "packages/storage/src/bounded-multipart.ts",
];
const requiredCheckIds = [
  "migration.apply_verify_legacy_defaults",
  "migration.repeat_and_duplicate_preimage_rejected",
  "upload.write_intent_happy_path",
  "upload.storage_identity_conflict_before_file",
  "upload.staging_failure_compensation",
  "upload.compensation_failure_auditable",
  "upload.ready_cas_conflict_preserves_final",
  "reconciliation.kill_point_matrix",
  "reconciliation.claim_lease_cas",
  "download.o_nofollow_and_status_gate",
];

type RuntimeRecord = {
  schemaVersion?: unknown;
  mode?: unknown;
  generatedAt?: unknown;
  status?: unknown;
  source?: {
    database?: unknown;
    uploadDirectory?: unknown;
    migration?: unknown;
    migrationSha256?: unknown;
    implementationSha256?: unknown;
  };
  checks?: Array<{ id?: unknown; status?: unknown; details?: Record<string, unknown> }>;
  doesNotProve?: unknown;
  safetyFacts?: Record<string, unknown>;
  recordHash?: unknown;
};

export function validateOps007RuntimeRecord(
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
  if (record.mode !== "isolated_postgresql_ops007_attachment_selftest") issues.push("mode is invalid");
  if (record.status !== "pass") issues.push("status must be pass");
  validateFreshness(record.generatedAt, now, maxAgeHours, issues);

  if (record.source?.database !== "isolated_local_postgresql") issues.push("source database must be isolated local PostgreSQL");
  if (record.source?.uploadDirectory !== "temporary_isolated_upload_directory") issues.push("source upload directory must be a temporary isolated directory");
  if (record.source?.migration !== migrationRelativePath) issues.push("migration source path is invalid");
  if (record.source?.migrationSha256 !== fileSha256(path.join(root, migrationRelativePath))) {
    issues.push("migration hash does not match the current checkout");
  }
  if (record.source?.implementationSha256 !== calculateOps007ImplementationHash(root)) {
    issues.push("implementation hash does not match the current checkout");
  }

  const checks = new Map((record.checks ?? []).map((check) => [check.id, check]));
  if (checks.size !== requiredCheckIds.length) issues.push("checks must contain only the required OPS-007 runtime checks");
  for (const id of requiredCheckIds) {
    if (checks.get(id)?.status !== "pass") issues.push(`required runtime check did not pass: ${id}`);
  }
  validateCheckDetails(checks, issues);

  const safety = record.safetyFacts ?? {};
  const requiredTrue = ["isolatedDatabaseRequired", "isolatedDatabaseWriteAttempted", "temporaryUploadDirectoryUsed"];
  const requiredFalse = [
    "productionWriteAttempted",
    "historicalOrphanMutated",
    "readyAttachmentDeleted",
    "serverCommandAttempted",
    "secretValuePrinted",
    "businessTextIncluded",
    "objectIdentifiersIncluded",
  ];
  for (const key of requiredTrue) if (safety[key] !== true) issues.push(`${key} must be true`);
  for (const key of requiredFalse) if (safety[key] !== false) issues.push(`${key} must be false`);

  const expectedDoesNotProve = [
    "production migration safety",
    "production attachment write safety",
    "historical orphan cleanup",
    "backup or restore success",
    "signed Release readiness",
    "AF-RISK-OPS-007 residual closure",
  ];
  const doesNotProve = Array.isArray(record.doesNotProve) ? record.doesNotProve : [];
  if (!Array.isArray(record.doesNotProve) || expectedDoesNotProve.some((value) => !doesNotProve.includes(value))) {
    issues.push("doesNotProve is incomplete");
  }

  if (record.recordHash !== calculateOps007RecordHash(record)) issues.push("recordHash is invalid");
  return issues;
}

export function calculateOps007ImplementationHash(root = process.cwd()): string | null {
  const paths = implementationFiles.map((file) => path.join(root, file));
  if (paths.some((file) => !existsSync(file))) return null;
  return sha256(paths.map((file) => readFileSync(file)).join("\n"));
}

export function calculateOps007RecordHash(record: RuntimeRecord): string {
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
  const happyPath = checks.get("upload.write_intent_happy_path")?.details;
  if (happyPath?.readyCount !== 1 || happyPath.stagingLeftoverCount !== 0 || happyPath.dtoHashExposed !== false) {
    issues.push("happy-path upload details are invalid");
  }
  const conflict = checks.get("upload.storage_identity_conflict_before_file")?.details;
  if (conflict?.conflictBeforeFileWrite !== true || conflict.newFileCount !== 0) {
    issues.push("storage identity conflict must fail before any file write");
  }
  const killPoints = checks.get("reconciliation.kill_point_matrix")?.details;
  if (
    killPoints?.finalizedFromStagingCount !== 1
    || killPoints.readyFromFinalCount !== 1
    || killPoints.failedMissingFileCount !== 1
    || killPoints.failedIntegrityMismatchCount !== 1
    || killPoints.blockedDualFileCount !== 1
    || killPoints.dualFileDeleted !== false
  ) {
    issues.push("kill-point reconciliation matrix details are invalid");
  }
  const claim = checks.get("reconciliation.claim_lease_cas")?.details;
  if (claim?.staleClaimCommitCount !== 0 || claim.expiredLeaseReclaimed !== true || claim.youngIntentSkipped !== true) {
    issues.push("claim/lease CAS details are invalid");
  }
  const download = checks.get("download.o_nofollow_and_status_gate")?.details;
  if (
    download?.symlinkRejected !== true
    || download.pendingRejected !== true
    || download.failedRejected !== true
    || download.hashMismatchRejected !== true
    || download.legacyReadCompatible !== true
  ) {
    issues.push("download gate details are invalid");
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
    console.error("OPS-007 runtime record path is required");
    process.exitCode = 1;
  } else {
    const issues = validateOps007RuntimeRecord(readFileSync(recordPath, "utf8"));
    if (issues.length > 0) {
      console.error(`OPS-007 runtime record validation failed: ${issues.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("OPS-007 runtime record validation passed.");
    }
  }
}
