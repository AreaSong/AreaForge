import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { protectedPathFiles } from "../ops/operability-status";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const protectedFiles = [...protectedPathFiles];

const readOnlyCommands = [
  {
    label: "ops status json",
    args: ["ops:status"],
    mode: "offline_long_term_operability_status_projection",
  },
  {
    label: "ops status summary",
    args: ["ops:status", "--summary"],
    summaryToken: "safetyFacts:",
  },
  {
    label: "ops handoff json",
    args: ["ops:handoff"],
    mode: "read_only_operational_handoff",
  },
  {
    label: "ops handoff summary",
    args: ["ops:handoff", "--summary"],
    summaryToken: "safetyFacts:",
  },
  {
    label: "support bundle preview",
    args: ["ops:support:bundle-preview"],
    mode: "metadata_only_support_bundle_preview",
  },
  {
    label: "backup/restore preview",
    args: ["ops:backup-restore:preview"],
    mode: "metadata_only_backup_restore_preview",
  },
  {
    label: "residual evidence preflight",
    args: ["residuals:evidence:preflight"],
    mode: "residual_evidence_preflight",
  },
  {
    label: "residual closure review validator selftest",
    args: ["residuals:closure:selftest"],
    summaryToken: "residual closure review validator selftest passed",
  },
  {
    label: "OPS-001 evidence preflight",
    args: ["ops:ops-001:preflight"],
    mode: "read_only_ops001_evidence_preflight",
  },
  {
    label: "OPS-004 alert evidence preflight",
    args: ["ops:ops-004:preflight"],
    mode: "read_only_ops004_alert_evidence_preflight",
  },
  {
    label: "OPS-005 expected-before evidence preflight",
    args: ["ops:ops-005:preflight"],
    mode: "read_only_ops005_expected_before_preflight",
  },
  {
    label: "OPS-005 evidence validator selftest",
    args: ["ops:ops-005:evidence:selftest"],
    summaryToken: "OPS-005 production evidence validator selftest",
  },
  {
    label: "long-term evidence snapshot",
    args: ["ops:long-term:snapshot"],
    mode: "read_only_long_term_evidence_snapshot",
  },
  {
    label: "completion evidence validator selftest",
    args: ["completion:evidence:selftest"],
    summaryToken: "completion evidence validator selftest passed",
  },
  {
    label: "maintenance window index",
    args: ["maintenance:window:index"],
    mode: "read_only_maintenance_window_index",
  },
  {
    label: "maintenance window index selftest",
    args: ["maintenance:window:index:selftest"],
    summaryToken: "maintenance window index selftest passed",
  },
  {
    label: "saved maintenance window index validator",
    args: ["maintenance:window:index:validate", "docs/development/maintenance-window-index.json"],
    summaryToken: "maintenance window index validation passed",
  },
  {
    label: "rollback proof record validator selftest",
    args: ["rollback:proof:selftest"],
    summaryToken: "rollback proof record validator selftest passed",
  },
  {
    label: "attachment reconciliation summary selftest",
    args: ["attachment:reconciliation:summary:selftest"],
    summaryToken: "attachment reconciliation summary selftest passed",
  },
  {
    label: "release evidence validator selftest",
    args: ["release:evidence:selftest"],
    summaryToken: "release evidence validator selftest passed",
  },
  {
    label: "release closeout audit",
    args: ["release:closeout:audit", "--", "--version=0.1.7"],
    mode: "read_only_release_closeout_audit",
  },
  {
    label: "release closeout audit selftest",
    args: ["release:closeout:audit:selftest"],
    summaryToken: "release closeout audit selftest passed",
  },
  {
    label: "release evidence redacted export validator selftest",
    args: ["release:evidence:redacted-export:selftest"],
    summaryToken: "Release evidence redacted export selftest passed",
  },
  {
    label: "release evidence redacted export record selftest",
    args: ["release:evidence:redacted-export:record:selftest"],
    summaryToken: "release evidence redacted export record selftest passed",
  },
  {
    label: "changed path review selftest",
    args: ["governance:changed-paths:selftest"],
    summaryToken: "changed path review selftest passed",
  },
  {
    label: "protected path review record validator selftest",
    args: ["governance:protected-path-review:selftest"],
    summaryToken: "protected path review record validator selftest passed",
  },
  {
    label: "update center request guard selftest",
    args: ["update-center:request-guard:selftest"],
    summaryToken: "update center request guard selftest passed",
  },
];

function main(): void {
  const before = snapshotWorkspace();

  for (const command of readOnlyCommands) {
    const result = spawnSync("pnpm", command.args, {
      cwd: root,
      encoding: "utf8",
      env: readOnlyEnv(),
    });
    expectStatus(command.label, result, 0);
    if (command.mode) {
      assertJsonSafety(command.label, result.stdout, command.mode);
    }
    if (command.summaryToken && !result.stdout.includes(command.summaryToken)) {
      fail(`${command.label} summary missing ${command.summaryToken}`);
    }
  }

  const after = snapshotWorkspace();
  assertNoSideEffects(before, after);

  console.log("ops read-only side-effect selftest passed.");
}

function readOnlyEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AREAFORGE_")) {
      delete env[key];
    }
  }
  env.CI = "1";
  env.NO_COLOR = "1";
  env.AREAFORGE_OPERABILITY_STATUS_AS_OF = "2026-07-12";
  env.AREAFORGE_LONG_TERM_SNAPSHOT_NOW = "2026-07-12T00:00:00.000Z";
  return env;
}

function snapshotWorkspace(): { gitStatus: string; hashes: Record<string, string> } {
  return {
    gitStatus: gitStatus(),
    hashes: Object.fromEntries(protectedFiles.map((file) => [file, sha256(file)])),
  };
}

function gitStatus(): string {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("git status --short", result, 0);
  return result.stdout;
}

function sha256(file: string): string {
  if (!existsSync(file)) {
    fail(`protected file missing: ${file}`);
  }
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function protectedPathFingerprintSha256(): string {
  const entries = protectedFiles.map((file) => ({
    file,
    status: "present",
    sha256: sha256(file),
  }));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function assertJsonSafety(label: string, raw: string, expectedMode: string): void {
  const parsed = JSON.parse(raw) as JsonRecord;
  if (parsed.mode !== expectedMode) {
    fail(`${label} mode mismatch: ${String(parsed.mode)} expected ${expectedMode}`);
  }
  const safetyFacts = recordValue(parsed.safetyFacts);
  assertFlag(label, safetyFacts, "readOnly", true);
  assertFlag(label, safetyFacts, "networkRequested", false);
  assertFlag(label, safetyFacts, "serverCommandAttempted", false);
  assertFlag(label, safetyFacts, "productionWriteAttempted", false);
  assertFlag(label, safetyFacts, "secretValuePrinted", false);
  if ("protectedPathWriteAttempted" in safetyFacts) {
    assertFlag(label, safetyFacts, "protectedPathWriteAttempted", false);
  }
  if ("residualLedgerUpdated" in safetyFacts) {
    assertFlag(label, safetyFacts, "residualLedgerUpdated", false);
  }
  if ("handoffWritten" in safetyFacts) {
    assertFlag(label, safetyFacts, "handoffWritten", false);
  }
  if ("supportBundleExported" in safetyFacts) {
    assertFlag(label, safetyFacts, "supportBundleExported", false);
  }
  if (expectedMode === "offline_long_term_operability_status_projection") {
    assertStatusProtectedPathFingerprint(label, parsed);
  }
}

function assertStatusProtectedPathFingerprint(label: string, parsed: JsonRecord): void {
  const sourceSnapshot = recordValue(parsed.sourceSnapshot);
  const fingerprint = recordValue(sourceSnapshot.protectedPathFingerprint);
  if (fingerprint.algorithm !== "sha256") {
    fail(`${label} protectedPathFingerprint.algorithm=${String(fingerprint.algorithm)} expected sha256`);
  }
  if (fingerprint.scope !== "read_only_side_effect_guard_inputs") {
    fail(`${label} protectedPathFingerprint.scope=${String(fingerprint.scope)} expected read_only_side_effect_guard_inputs`);
  }
  if (typeof fingerprint.hash !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint.hash)) {
    fail(`${label} protectedPathFingerprint.hash must be a sha256 hex digest`);
  }
  if (fingerprint.hash !== protectedPathFingerprintSha256()) {
    fail(`${label} protectedPathFingerprint.hash does not match local protected path fingerprint`);
  }
  if (!Array.isArray(fingerprint.paths) || fingerprint.paths.some((item) => typeof item !== "string")) {
    fail(`${label} protectedPathFingerprint.paths must be an array of strings`);
  }
  const paths = fingerprint.paths as string[];
  const missing = protectedFiles.filter((file) => !paths.includes(file));
  const unexpected = paths.filter((file) => !protectedFiles.includes(file));
  const duplicate = paths.find((file, index) => paths.indexOf(file) !== index);
  if (missing.length > 0) {
    fail(`${label} protectedPathFingerprint.paths missing ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    fail(`${label} protectedPathFingerprint.paths includes unexpected ${unexpected.join(", ")}`);
  }
  if (duplicate) {
    fail(`${label} protectedPathFingerprint.paths includes duplicate ${duplicate}`);
  }
  if (!Array.isArray(fingerprint.doesNotProve) || fingerprint.doesNotProve.some((item) => typeof item !== "string")) {
    fail(`${label} protectedPathFingerprint.doesNotProve must be an array of strings`);
  }
  for (const boundary of ["production health", "absence of changes outside protected paths", "git worktree cleanliness"]) {
    if (!(fingerprint.doesNotProve as string[]).includes(boundary)) {
      fail(`${label} protectedPathFingerprint.doesNotProve missing ${boundary}`);
    }
  }
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("safetyFacts must be an object");
  }
  return value;
}

function assertFlag(label: string, values: JsonRecord, key: string, expected: boolean): void {
  if (values[key] !== expected) {
    fail(`${label} safetyFacts.${key}=${String(values[key])} expected ${String(expected)}`);
  }
}

function assertNoSideEffects(
  before: { gitStatus: string; hashes: Record<string, string> },
  after: { gitStatus: string; hashes: Record<string, string> },
): void {
  const changedHashes = Object.keys(before.hashes).filter((file) => before.hashes[file] !== after.hashes[file]);
  if (changedHashes.length > 0) {
    fail(`protected file hash changed: ${changedHashes.join(", ")}`);
  }
  if (before.gitStatus !== after.gitStatus) {
    fail(`git status changed after read-only commands:\nbefore:\n${before.gitStatus || "<clean>"}\nafter:\n${after.gitStatus || "<clean>"}`);
  }
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected exit ${expected}, got ${String(result.status)}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

main();
