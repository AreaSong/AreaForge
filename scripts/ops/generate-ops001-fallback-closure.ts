import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const fallbackDirArg = process.argv[2];
const outputDirArg = process.argv[3];

function main(): void {
  if (!fallbackDirArg) {
    console.error("Usage: pnpm ops:ops-001:fallback:finalize <redacted-fallback-dir> [output-dir]");
    process.exit(2);
  }

  const fallbackDir = path.resolve(fallbackDirArg);
  const outputDir = path.resolve(outputDirArg ?? path.join(tmpdir(), `areaforge-ops001-local-${compactTimestamp(new Date().toISOString())}`));
  mkdirSync(outputDir, { recursive: true });

  const inputs = collectInputs(fallbackDir);
  validatePrerequisites(inputs.prerequisites);
  validateRemoteSummary(inputs.summary);

  const expectedVersion = stringField(inputs.prerequisites, "expectedVersion");
  const baseUrl = stringField(inputs.prerequisites, "baseUrl");
  const expectedAutoApply = stringField(inputs.prerequisites, "expectedAutoApply") || "none";
  const releaseTag = process.env.AREAFORGE_READINESS_RELEASE_TAG ?? versionTag(expectedVersion);
  const smokePasswordPlaceholder = process.env.AREAFORGE_SMOKE_PASSWORD_FILE ?? "/redacted/areaforge-smoke-password-file";
  const updateRecordSummary = process.env.AREAFORGE_UPDATE_RECORD_SUMMARY ??
    `redacted update-agent status hash sha256:${sha256(readFileSync(inputs.updateStatus, "utf8"))}`;

  requireReleaseIdentity();

  run("validate redacted update-agent status", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/quality/update-agent-status-validate.ts",
    inputs.updateStatus,
  ]);

  const smokeRecord = path.join(outputDir, "prod-readonly-smoke-record.txt");
  const smokeRecordResult = run("generate production read-only smoke record", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/ops/generate-prod-readonly-smoke-record.ts",
    inputs.smokeOutput,
  ], {
    AREAFORGE_READINESS_ENVIRONMENT: "production",
    AREAFORGE_READINESS_EXPECTED_VERSION: expectedVersion,
    AREAFORGE_READINESS_RELEASE_TAG: releaseTag,
    AREAFORGE_SMOKE_PASSWORD_FILE: smokePasswordPlaceholder,
    AREAFORGE_PROD_READONLY_SMOKE_COMMAND: "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    AREAFORGE_UPDATER_ENV_SUMMARY: "AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted",
    AREAFORGE_UPDATE_RECORD_SUMMARY: updateRecordSummary,
  });
  writeFileSync(smokeRecord, smokeRecordResult.stdout);

  run("validate production read-only smoke record", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/quality/prod-readonly-smoke-validate.ts",
    smokeRecord,
  ]);

  const evidenceBundle = path.join(outputDir, "operational-evidence-bundle.json");
  const bundleEnv: Record<string, string> = {
    AREAFORGE_READINESS_ENVIRONMENT: "production",
    AREAFORGE_READINESS_SCOPE: "daily",
    AREAFORGE_READINESS_EXPECTED_VERSION: expectedVersion,
    AREAFORGE_READINESS_RELEASE_TAG: releaseTag,
    AREAFORGE_READINESS_UPDATE_STATUS_FILE: inputs.updateStatus,
    AREAFORGE_READINESS_SMOKE_RESULT_FILE: inputs.smokeOutput,
    AREAFORGE_READINESS_EXPECTED_AUTO_APPLY: expectedAutoApply,
    AREAFORGE_SMOKE_PASSWORD_FILE: smokePasswordPlaceholder,
  };
  if (process.env.AREAFORGE_OPS001_FINALIZE_INCLUDE_NETWORK === "yes") {
    bundleEnv.AREAFORGE_READINESS_BASE_URL = baseUrl;
  }
  const bundleResult = run("generate operational evidence bundle", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/ops/operational-evidence-bundle.ts",
  ], bundleEnv);
  writeFileSync(evidenceBundle, bundleResult.stdout);

  run("validate operational evidence bundle", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/quality/operational-evidence-bundle-validate.ts",
    evidenceBundle,
  ]);

  const closurePacket = path.join(outputDir, "ops-001-closure-packet.txt");
  const closureResult = run("generate OPS-001 closure packet", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/ops/generate-ops001-closure-packet.ts",
    smokeRecord,
    inputs.updateStatus,
    evidenceBundle,
  ]);
  writeFileSync(closurePacket, closureResult.stdout);

  run("validate OPS-001 closure packet", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/quality/ops001-closure-packet-validate.ts",
    closurePacket,
  ]);

  const preflight = run("preflight OPS-001 closure evidence", [
    "pnpm",
    "exec",
    "tsx",
    "scripts/ops/ops001-evidence-preflight.ts",
  ], {
    AREAFORGE_OPS001_SMOKE_RECORD: smokeRecord,
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: inputs.updateStatus,
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: evidenceBundle,
    AREAFORGE_OPS001_CLOSURE_PACKET: closurePacket,
  });
  const preflightFile = path.join(outputDir, "ops001-preflight-after-closure.json");
  writeFileSync(preflightFile, preflight.stdout);
  const preflightStatus = parseJson(preflight.stdout, "OPS-001 preflight").status;
  if (preflightStatus !== "ready_for_human_close") {
    fail(`OPS-001 preflight expected ready_for_human_close, got ${String(preflightStatus)}`, 1);
  }

  console.log(JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "ops001_fallback_local_finalizer",
    status: "ready_for_human_close",
    inputDir: fallbackDir,
    outputDir,
    files: {
      prodReadonlySmokeRecord: smokeRecord,
      redactedUpdateAgentStatus: inputs.updateStatus,
      operationalEvidenceBundle: evidenceBundle,
      ops001ClosurePacket: closurePacket,
      ops001PreflightAfterClosure: preflightFile,
    },
    doesNotProve: [
      "residual ledger closure",
      "backup, restore, migration, updater apply, or rollback execution",
      "signed Release supply-chain closure",
      "long-term operability by itself",
    ],
    safetyFacts: {
      readOnly: true,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      updaterApplyAttempted: false,
      residualLedgerUpdated: false,
      secretValuePrinted: false,
      networkRequested: process.env.AREAFORGE_OPS001_FINALIZE_INCLUDE_NETWORK === "yes",
    },
  }, null, 2));
}

function collectInputs(fallbackDir: string): {
  prerequisites: JsonRecord;
  summary: Map<string, string>;
  updateStatus: string;
  smokeOutput: string;
} {
  requireDirectory(fallbackDir);
  const prerequisites = path.join(fallbackDir, "remote-prerequisites.json");
  const summary = path.join(fallbackDir, "remote-summary.txt");
  const updateStatus = path.join(fallbackDir, "redacted-update-status.json");
  const smokeOutput = path.join(fallbackDir, "prod-readonly-smoke-output.log");

  for (const file of [prerequisites, summary, updateStatus, smokeOutput]) {
    requireFile(file);
  }

  return {
    prerequisites: parseJson(readFileSync(prerequisites, "utf8"), "remote prerequisites"),
    summary: parseKeyValue(readFileSync(summary, "utf8")),
    updateStatus,
    smokeOutput,
  };
}

function validatePrerequisites(prerequisites: JsonRecord): void {
  if (prerequisites.mode !== "ops001-readonly-fallback-prerequisites") {
    fail("remote-prerequisites.json mode must be ops001-readonly-fallback-prerequisites", 1);
  }
  const blockers = prerequisites.blockers;
  if (!Array.isArray(blockers)) {
    fail("remote-prerequisites.json blockers must be an array", 1);
  }
  if (blockers.length > 0) {
    fail(`remote fallback prerequisites are blocked: ${blockers.map(String).join(", ")}`, 10);
  }
  for (const [field, expected] of [
    ["extraSmokeCommandConfigured", "yes"],
    ["smokeEmailConfigured", "yes"],
    ["smokePasswordFileConfigured", "yes"],
    ["smokePasswordFileReadable", "yes"],
    ["expectedAutoApply", "none"],
  ] as const) {
    if (prerequisites[field] !== expected) {
      fail(`remote-prerequisites.json ${field} must be ${expected}`, 1);
    }
  }
  const baseUrl = stringField(prerequisites, "baseUrl");
  if (!/^https:\/\/[^ \n]+$/i.test(baseUrl)) {
    fail("remote-prerequisites.json baseUrl must be https", 1);
  }
  const expectedVersion = stringField(prerequisites, "expectedVersion");
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    fail("remote-prerequisites.json expectedVersion must look like X.Y.Z", 1);
  }
}

function validateRemoteSummary(summary: Map<string, string>): void {
  if (summary.get("mode") !== "ops001-readonly-fallback-export") {
    fail("remote-summary.txt mode must be ops001-readonly-fallback-export", 1);
  }
  if (summary.get("smokeStatus") !== "pass") {
    fail("remote-summary.txt smokeStatus must be pass", 1);
  }
  if (summary.get("redactedHandoffStatus") !== "granted") {
    fail("remote-summary.txt redactedHandoffStatus must be granted", 1);
  }
}

function requireReleaseIdentity(): void {
  const manifestFile = process.env.AREAFORGE_READINESS_RELEASE_MANIFEST_FILE;
  if (manifestFile) {
    requireFile(path.resolve(manifestFile));
    return;
  }
  const webDigest = process.env.AREAFORGE_READINESS_WEB_IMAGE_DIGEST;
  const migrationDigest = process.env.AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST;
  if (isImageDigest(webDigest) && isImageDigest(migrationDigest)) return;
  fail("set AREAFORGE_READINESS_RELEASE_MANIFEST_FILE or both AREAFORGE_READINESS_WEB_IMAGE_DIGEST and AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST", 2);
}

function run(label: string, command: string[], env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  const [binary, ...args] = command;
  const result = spawnSync(binary ?? "pnpm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      AREAFORGE_READINESS_BASE_URL: env.AREAFORGE_READINESS_BASE_URL ?? "",
      AREAFORGE_SMOKE_PASSWORD: "",
    },
  });
  if (result.status !== 0) {
    console.error(`FAIL ${label}: exit ${result.status}`);
    if (result.stdout.trim()) console.error(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
}

function stringField(record: JsonRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${field} is required`, 1);
  }
  return value.trim();
}

function parseJson(raw: string, label: string): JsonRecord {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    fail(`${label} must be a JSON object`, 1);
  }
  return parsed;
}

function parseKeyValue(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (match) fields.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return fields;
}

function requireDirectory(directoryPath: string): void {
  if (!existsSync(directoryPath)) {
    fail(`directory not found: ${directoryPath}`, 2);
  }
}

function requireFile(filePath: string): void {
  if (!existsSync(filePath)) {
    fail(`file not found: ${filePath}`, 2);
  }
}

function versionTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isImageDigest(value: string | undefined): boolean {
  return Boolean(value && /@sha256:[a-f0-9]{64}$/i.test(value));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string, code: number): never {
  console.error(`FAIL OPS-001 fallback local finalizer: ${message}`);
  process.exit(code);
}

main();
