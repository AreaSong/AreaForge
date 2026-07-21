import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const implementationFiles = [
  "ops/github-release-updater/areaforge-updater.sh",
  "ops/update-agent/areaforge-update-agent.sh",
  "ops/update-agent/areaforge-updater-maintenance.sh",
  "ops/update-agent/lib/updater-phase-journal.sh",
  "ops/update-agent/lib/updater-maintenance-control.sh",
  "ops/update-agent/lib/update-request-state.sh",
] as const;

const requiredCheckIds = [
  "journal.hash_chain_and_no_clobber",
  "journal.kill_point_blocks_admission",
  "journal.fsync_failure_blocks_side_effects",
  "journal.corrupt_event_blocks_admission",
  "maintenance.hold_drain_waiting_and_drained",
  "maintenance.clear_cas_and_journal_gate",
  "maintenance.queue_control_lock_contention",
  "maintenance.stale_request_after_clear",
  "updater.record_persistence_maps_reconciliation",
] as const;

type RuntimeRecord = {
  schemaVersion?: unknown;
  mode?: unknown;
  generatedAt?: unknown;
  status?: unknown;
  source?: {
    fixtureRoot?: unknown;
    implementationSha256?: unknown;
  };
  checks?: Array<{ id?: unknown; status?: unknown; details?: Record<string, unknown> }>;
  doesNotProve?: unknown;
  safetyFacts?: Record<string, unknown>;
  recordHash?: unknown;
};

export function validateOps008RuntimeRecord(
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
  if (record.mode !== "temporary_directory_ops008_updater_selftest") issues.push("mode is invalid");
  if (record.status !== "pass") issues.push("status must be pass");
  validateFreshness(record.generatedAt, now, maxAgeHours, issues);

  if (record.source?.fixtureRoot !== "temporary_isolated_ops_state_directory") {
    issues.push("source fixtureRoot must be a temporary isolated ops-state directory");
  }
  if (record.source?.implementationSha256 !== calculateOps008ImplementationHash(root)) {
    issues.push("implementation hash does not match the current checkout");
  }

  const checks = new Map((record.checks ?? []).map((check) => [check.id, check]));
  if (checks.size !== requiredCheckIds.length) issues.push("checks must contain only the required OPS-008 runtime checks");
  for (const id of requiredCheckIds) {
    if (checks.get(id)?.status !== "pass") issues.push(`required runtime check did not pass: ${id}`);
  }
  validateCheckDetails(checks, issues);

  const safety = record.safetyFacts ?? {};
  const requiredTrue = ["temporaryOpsStateDirectoryUsed", "portableFlockUsed"];
  const requiredFalse = [
    "productionWriteAttempted",
    "timerChanged",
    "serverCommandAttempted",
    "secretValuePrinted",
    "updaterApplyExecutedAgainstProduction",
  ];
  for (const key of requiredTrue) if (safety[key] !== true) issues.push(`${key} must be true`);
  for (const key of requiredFalse) if (safety[key] !== false) issues.push(`${key} must be false`);

  const expectedDoesNotProve = [
    "production updater phase durability",
    "systemd timer suspension",
    "production queue drain",
    "backup or migration success",
    "signed Release readiness",
    "AF-RISK-OPS-008 residual closure",
  ];
  const doesNotProve = Array.isArray(record.doesNotProve) ? record.doesNotProve : [];
  if (!Array.isArray(record.doesNotProve) || expectedDoesNotProve.some((value) => !doesNotProve.includes(value))) {
    issues.push("doesNotProve is incomplete");
  }

  if (record.recordHash !== calculateOps008RecordHash(record)) issues.push("recordHash is invalid");
  return issues;
}

export function calculateOps008ImplementationHash(root = process.cwd()): string | null {
  const paths = implementationFiles.map((file) => path.join(root, file));
  if (paths.some((file) => !existsSync(file))) return null;
  return sha256(paths.map((file) => readFileSync(file)).join("\n"));
}

export function calculateOps008RecordHash(record: RuntimeRecord): string {
  const { recordHash: _recordHash, ...body } = record;
  return sha256(JSON.stringify(body));
}

export function ops008ImplementationFiles(): readonly string[] {
  return implementationFiles;
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
  const hashChain = checks.get("journal.hash_chain_and_no_clobber")?.details;
  if (
    typeof hashChain?.eventCount !== "number"
    || hashChain.eventCount < 14
    || hashChain.duplicatePublishRejected !== true
    || hashChain.scanStatus !== "clean"
  ) {
    issues.push("hash-chain/no-clobber details are invalid");
  }
  const killPoint = checks.get("journal.kill_point_blocks_admission")?.details;
  if (
    killPoint?.scanStatus !== "blocked"
    || killPoint.holdPublished !== true
    || killPoint.uncertainPhase !== "migration"
  ) {
    issues.push("kill-point admission details are invalid");
  }
  const fsync = checks.get("journal.fsync_failure_blocks_side_effects")?.details;
  if (fsync?.appendFailed !== true || fsync.dockerMarkerCreated !== false) {
    issues.push("fsync failure details are invalid");
  }
  const corrupt = checks.get("journal.corrupt_event_blocks_admission")?.details;
  if (corrupt?.scanStatus !== "blocked") issues.push("corrupt event details are invalid");
  const drain = checks.get("maintenance.hold_drain_waiting_and_drained")?.details;
  if (
    drain?.waitingActiveClaim !== true
    || drain?.waitingProductionLock !== true
    || drain?.drained !== true
    || drain?.claimPreserved !== true
  ) {
    issues.push("hold/drain details are invalid");
  }
  const clear = checks.get("maintenance.clear_cas_and_journal_gate")?.details;
  if (
    clear?.clearBlockedByNonTerminalJournal !== true
    || clear?.casMismatchRejected !== true
    || clear?.clearSucceededAfterTerminal !== true
  ) {
    issues.push("clear CAS details are invalid");
  }
  const contention = checks.get("maintenance.queue_control_lock_contention")?.details;
  if (contention?.secondAcquireFailed !== true || contention?.claimBlockedWhileHoldActive !== true) {
    issues.push("queue-control contention details are invalid");
  }
  const stale = checks.get("maintenance.stale_request_after_clear")?.details;
  if (stale?.staleRejected !== true || stale?.freshAccepted !== true) {
    issues.push("stale request isolation details are invalid");
  }
  const recordMap = checks.get("updater.record_persistence_maps_reconciliation")?.details;
  if (
    recordMap?.exitStatus !== 2
    || recordMap?.reasonCode !== "APPLIED_RECORD_PERSISTENCE_UNCERTAIN"
  ) {
    issues.push("record persistence reconciliation details are invalid");
  }
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const recordPath = process.argv[2];
  if (!recordPath || !existsSync(recordPath)) {
    console.error("OPS-008 runtime record path is required");
    process.exitCode = 1;
  } else {
    const issues = validateOps008RuntimeRecord(readFileSync(recordPath, "utf8"));
    if (issues.length > 0) {
      console.error(`OPS-008 runtime record validation failed: ${issues.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("OPS-008 runtime record validation passed.");
    }
  }
}
