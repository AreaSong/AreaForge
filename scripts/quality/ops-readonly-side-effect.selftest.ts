import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const protectedFiles = [
  "README.md",
  "package.json",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/operational-readiness.md",
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/validation-matrix.md",
  "tasks/indexes/residuals.md",
  "workflow/README.md",
];

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
    label: "long-term evidence snapshot",
    args: ["ops:long-term:snapshot"],
    mode: "read_only_long_term_evidence_snapshot",
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
  if ("residualLedgerUpdated" in safetyFacts) {
    assertFlag(label, safetyFacts, "residualLedgerUpdated", false);
  }
  if ("handoffWritten" in safetyFacts) {
    assertFlag(label, safetyFacts, "handoffWritten", false);
  }
  if ("supportBundleExported" in safetyFacts) {
    assertFlag(label, safetyFacts, "supportBundleExported", false);
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
