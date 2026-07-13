import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-release-evidence-redacted-export-"));
const outputDirs: string[] = [];
let outputCounter = 0;

try {
  const helperSource = readText(path.join(root, "ops/update-agent/areaforge-release-evidence-redacted-export.sh"));
  const summaryWriteIndex = helperSource.lastIndexOf('write_summary "$SUMMARY_FILE"');
  const handoffIndex = helperSource.lastIndexOf("handoff_redacted_outputs\n  append_handoff_result");
  const handoffSummaryIndex = helperSource.lastIndexOf('append_handoff_result "$SUMMARY_FILE"');
  assert(
    summaryWriteIndex >= 0 && summaryWriteIndex < handoffIndex && handoffIndex < handoffSummaryIndex,
    "redacted handoff must run after remote-summary.txt is written so every exported file is readable by the sudo user",
  );

  const updateRecord = path.join(tempDir, "update-record.txt");
  const stateDir = path.join(tempDir, "ops-state");
  const statusFile = path.join(stateDir, "status.json");
  const smokeLog = path.join(tempDir, "extra-smoke.log");
  const outputDir = makeOutputDir("main");

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(updateRecord, updateRecordFixture());
  writeFileSync(statusFile, JSON.stringify(statusFixture(), null, 2));
  writeFileSync(smokeLog, smokeLogFixture());

  const result = spawnSync("bash", [
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "--update-record",
    updateRecord,
    "--status",
    statusFile,
    "--smoke-log",
    smokeLog,
    "--output-dir",
    outputDir,
  ], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`redacted export helper should pass, got ${String(result.status)}`);
  }

  const safeFields = path.join(outputDir, "release-update-safe-fields.txt");
  const redactedStatus = path.join(outputDir, "redacted-update-status.json");
  const smokeOutput = path.join(outputDir, "prod-readonly-smoke-output.log");
  const summary = path.join(outputDir, "remote-summary.txt");
  for (const filePath of [safeFields, redactedStatus, smokeOutput, summary]) {
    if (!existsSync(filePath)) throw new Error(`missing expected output: ${path.basename(filePath)}`);
  }

  const safeText = readText(safeFields);
  for (const required of [
    "releaseTag: v0.1.7",
    "databaseBackupPath: <redacted-root-only-path>",
    "databaseBackupSha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "uploadsBackupPath: <redacted-root-only-path>",
    "uploadsBackupSha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "envBackupPath: <redacted-root-only-path>",
    "envBackupSha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "composeConfigBackupPath: <redacted-root-only-path>",
    "nginxConfigBackupPath: <redacted-root-only-path>",
    "extraSmokeLogPath: <redacted-root-only-path>",
    "failureReason: none",
  ]) {
    assert(safeText.includes(required), `safe fields should include ${required}`);
  }
  for (const forbidden of [
    "/opt/areaforge/backups",
    "/etc/nginx/sites-enabled",
    tempDir,
    "DATABASE_URL=postgresql://areaforge:secret@db/areaforge",
    "AUTH_SESSION_SECRET=super-secret",
    "AI_API_KEY=sk-12345678901234567890",
    "unrelatedSecretLine",
  ]) {
    assert(!safeText.includes(forbidden), `safe fields should not include ${forbidden}`);
  }

  const status = readJson(redactedStatus);
  assert(status.currentVersion === "0.1.7", "redacted status currentVersion mismatch");
  validateUpdateStatus(redactedStatus);
  const validationStdout = validateRedactedExport(outputDir);
  assert(!validationStdout.includes("/opt/areaforge"), "validator output should not print root-only backup paths");
  assert(!validationStdout.includes("/etc/nginx"), "validator output should not print root-only nginx paths");
  assert(!validationStdout.includes(tempDir), "validator output should not print local temp paths");
  const jsonTamperOut = makeOutputDir("json-extra");
  runSuccessfulExport(updateRecord, statusFile, smokeLog, jsonTamperOut);
  const tamperedSmokeOutput = path.join(jsonTamperOut, "prod-readonly-smoke-output.log");
  writeFileSync(tamperedSmokeOutput, [
    "PASS health: ok (10ms)",
    "PASS login: ok (20ms)",
    "PASS update-status: ok (30ms)",
    '{"ok":true,"baseUrl":"https://forge.areasong.top","checkedAt":"2026-07-12T11:25:00Z","debug":"not-allowed","checks":[{"name":"health","ok":true,"durationMs":10},{"name":"login","ok":true,"durationMs":20},{"name":"update-status","ok":true,"durationMs":30}]}',
    "",
  ].join("\n"));
  rewriteSummaryHash(jsonTamperOut, "prodReadonlySmokeOutput", "prod-readonly-smoke-output.log");
  expectRedactedExportValidationFailure(jsonTamperOut, "prodReadonlySmokeOutput.debug");
  const staleSmokeOut = makeOutputDir("stale-smoke");
  runSuccessfulExport(updateRecord, statusFile, smokeLog, staleSmokeOut);
  const staleSmokeOutput = path.join(staleSmokeOut, "prod-readonly-smoke-output.log");
  writeFileSync(staleSmokeOutput, [
    "PASS health: ok (10ms)",
    "PASS login: ok (20ms)",
    "PASS update-status: ok (30ms)",
    '{"ok":true,"baseUrl":"https://forge.areasong.top","checkedAt":"2026-07-12T11:22:00Z","checks":[{"name":"health","ok":true,"durationMs":10},{"name":"login","ok":true,"durationMs":20},{"name":"update-status","ok":true,"durationMs":30}]}',
    "",
  ].join("\n"));
  rewriteSummaryHash(staleSmokeOut, "prodReadonlySmokeOutput", "prod-readonly-smoke-output.log");
  expectRedactedExportValidationFailure(staleSmokeOut, "prodReadonlySmokeOutput.checkedAt");
  writeFileSync(safeFields, `${readText(safeFields)}healthUrl: http://127.0.0.1:3020/api/health\n`);
  expectRedactedExportValidationFailure(outputDir, "releaseUpdateSafeFields");

  const smokeText = readText(smokeOutput);
  assert(smokeText.includes("PASS health: ok"), "smoke output should include PASS health");
  assert(smokeText.includes("\"ok\":true"), "smoke output should include final JSON");
  assert(!smokeText.includes("cookie=session-secret"), "smoke output should omit non-allowlisted log noise");
  assert(!smokeText.includes("\"cookie\""), "smoke output should omit non-allowlisted final JSON cookie field");
  assert(!smokeText.includes("\"token\""), "smoke output should omit non-allowlisted final JSON token field");
  assert(!smokeText.includes("AUTH_SESSION_SECRET"), "smoke output should redact secret-like values");

  const summaryText = readText(summary);
  for (const required of [
    "mode: release-evidence-redacted-export-no-secret-read",
    "outputDir: <redacted-tmp-output-dir>",
    "sourceUpdateRecord: <redacted-root-only-update-record-path>",
    "sourceStatus: <redacted-root-only-status-path>",
    "sourceSmokeLog: <redacted-smoke-log-path>",
    "updateRecordSha256: sha256:",
    "smokePasswordFileReadAttempted: no",
    "secretFileReadAttempted: no",
    "residualLedgerUpdated: no",
    "forbiddenActions:",
  ]) {
    assert(summaryText.includes(required), `summary should include ${required}`);
  }

  const missingSmokeOut = makeOutputDir("missing-smoke");
  const missingSmokeResult = spawnSync("bash", [
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "--update-record",
    updateRecord,
    "--status",
    statusFile,
    "--smoke-log",
    path.join(tempDir, "missing.log"),
    "--output-dir",
    missingSmokeOut,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (missingSmokeResult.status !== 0) {
    console.error(missingSmokeResult.stdout);
    console.error(missingSmokeResult.stderr);
    throw new Error("missing smoke log should not fail redacted export");
  }
  assert(
    readText(path.join(missingSmokeOut, "prod-readonly-smoke-output.log")).includes("prodReadonlySmokeOutput: missing"),
    "missing smoke output should be recorded as missing",
  );
  expectRedactedExportValidationFailure(missingSmokeOut, "prodReadonlySmokeOutput");
  expectMissingInputPathFailure(statusFile, smokeLog, "update-record");
  expectMissingInputPathFailure(updateRecord, smokeLog, "status-file");
  expectForbiddenSmokePathFailure(updateRecord, statusFile);
  expectForbiddenOutputDirFailure(updateRecord, statusFile, smokeLog);

  console.log("Release evidence redacted export selftest passed.");
} finally {
  for (const outputDir of outputDirs) {
    rmSync(outputDir, { force: true, recursive: true });
  }
  rmSync(tempDir, { force: true, recursive: true });
}

function updateRecordFixture(): string {
  return [
    "releaseId: github-0.1.7-20260712112325",
    "updatedAt: 2026-07-12T11:23:25Z",
    "status: success",
    "githubRepo: AreaSong/AreaForge",
    "releaseTag: v0.1.7",
    "targetVersion: 0.1.7",
    "targetChannel: stable",
    "gitCommit: c1a25e4f897330fea493ad4c6dd889b62ef8f63a",
    "previousAppVersion: 0.1.5",
    "previousImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9",
    "targetWebImage: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    "targetWebImageDigest: sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    "migrationApplied: true",
    "migrationImageDigest: sha256:c2c27da7ed85be0796d4f6535557d3759bc14975a0238b725b99c1c0e232e654",
    "sbomAsset: areaforge-sbom.spdx.json",
    "sbomSha256: 4dd56f6c72db5e32528df4d2d443fe8e2510df9fe7be20a3d8c8c4d3cff24303",
    "provenanceAsset: areaforge-provenance.json",
    "provenanceSha256: 69f93bd9e4b7f6b8b9390ae2f0e3fa80650796ce3ac2451858e2ca8bd57c692f",
    "composeUpdated: false",
    "databaseBackupPath: /opt/areaforge/backups/github-release-updates/github-0.1.7-20260712112325/db/areaforge-before-update.dump",
    "databaseBackupSha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "uploadsBackupPath: /opt/areaforge/backups/github-release-updates/github-0.1.7-20260712112325/uploads/uploads-before-update.tar.gz",
    "uploadsBackupSha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "envBackupPath: /opt/areaforge/backups/github-release-updates/github-0.1.7-20260712112325/config/production.env",
    "envBackupSha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "composeConfigBackupPath: /opt/areaforge/backups/github-release-updates/github-0.1.7-20260712112325/config/docker-compose.prod.yml",
    "composeHash: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "nginxConfigBackupPath: /etc/nginx/sites-enabled/areaforge.conf",
    "healthUrl: postgres://areaforge:secret@db/areaforge",
    "smokeHealth: PASS",
    "extraSmoke: PASS",
    `extraSmokeLogPath: ${path.join(tempDir, "extra-smoke.log")}`,
    "rollbackAttempted: no",
    "databaseRestoreAttempted: no",
    "uploadsRestoreAttempted: no",
    "failureReason: none",
    "releaseNotesUrl: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7",
    "unrelatedSecretLine: DATABASE_URL=postgresql://areaforge:secret@db/areaforge AUTH_SESSION_SECRET=super-secret AI_API_KEY=sk-12345678901234567890",
    "",
  ].join("\n");
}

function statusFixture(): JsonRecord {
  return {
    currentVersion: "0.1.7",
    currentImage: "ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd",
    releaseUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7",
    latestVersion: "0.1.7",
    updateAvailable: false,
    autoApply: "none",
    signatureRequired: true,
    timerEnabled: true,
    timerActive: true,
    lastCheckedAt: "2026-07-12T11:23:25Z",
    blocker: null,
    rollback: {
      available: true,
      targetVersion: "0.1.5",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9",
    },
    statusUpdatedAt: "2026-07-12T11:23:25Z",
  };
}

function smokeLogFixture(): string {
  return [
    "debug cookie=session-secret AUTH_SESSION_SECRET=should-not-appear",
    "PASS health: ok (10ms)",
    "PASS login: ok (20ms)",
    "PASS update-status: ok (30ms)",
    '{"ok":true,"baseUrl":"https://forge.areasong.top","checkedAt":"2026-07-12T11:25:00Z","cookie":"session-secret-12345678901234567890","checks":[{"name":"health","ok":true,"durationMs":10,"token":"abc123"},{"name":"login","ok":true,"durationMs":20},{"name":"update-status","ok":true,"durationMs":30}]}',
    "",
  ].join("\n");
}

function runSuccessfulExport(updateRecord: string, statusFile: string, smokeLog: string, outputDir: string): void {
  const result = spawnSync("bash", [
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "--update-record",
    updateRecord,
    "--status",
    statusFile,
    "--smoke-log",
    smokeLog,
    "--output-dir",
    outputDir,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`redacted export helper should pass, got ${String(result.status)}`);
  }
}

function expectForbiddenSmokePathFailure(updateRecord: string, statusFile: string): void {
  const forbiddenSmokePath = path.join(tempDir, "smoke-password");
  writeFileSync(forbiddenSmokePath, "PASS health: should-not-read\n");
  const result = spawnSync("bash", [
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "--update-record",
    updateRecord,
    "--status",
    statusFile,
    "--smoke-log",
    forbiddenSmokePath,
    "--output-dir",
    makeOutputDir("forbidden-smoke"),
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) {
    console.error(result.stdout);
    throw new Error("forbidden smoke log path should fail before export");
  }
  if (!result.stderr.includes("refusing forbidden smoke log path")) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error("forbidden smoke log path failure should be explicit");
  }
  assertNoLeakedPath(result, forbiddenSmokePath, "forbidden smoke log failure");
}

function expectForbiddenOutputDirFailure(updateRecord: string, statusFile: string, smokeLog: string): void {
  const forbiddenOutputDir = path.join(tempDir, "unsafe-out");
  const result = spawnSync("bash", [
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "--update-record",
    updateRecord,
    "--status",
    statusFile,
    "--smoke-log",
    smokeLog,
    "--output-dir",
    forbiddenOutputDir,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) {
    console.error(result.stdout);
    throw new Error("forbidden output dir should fail before export");
  }
  if (!result.stderr.includes("refusing output dir outside /tmp")) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error("forbidden output dir failure should be explicit");
  }
  assertNoLeakedPath(result, forbiddenOutputDir, "forbidden output dir failure");
}

function expectMissingInputPathFailure(existingInput: string, smokeLog: string, kind: "update-record" | "status-file"): void {
  const missingPath = path.join(tempDir, `${kind}-missing-root-only`);
  const args = kind === "update-record"
    ? [
        "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
        "--update-record",
        missingPath,
        "--status",
        existingInput,
        "--smoke-log",
        smokeLog,
        "--output-dir",
        makeOutputDir(`missing-${kind}`),
      ]
    : [
        "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
        "--update-record",
        existingInput,
        "--status",
        missingPath,
        "--smoke-log",
        smokeLog,
        "--output-dir",
        makeOutputDir(`missing-${kind}`),
      ];
  const result = spawnSync("bash", args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) {
    console.error(result.stdout);
    throw new Error(`${kind} missing path should fail before export`);
  }
  const expected = kind === "update-record" ? "update record not found" : "status file not found";
  if (!result.stderr.includes(expected)) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${kind} missing path failure should be explicit`);
  }
  assertNoLeakedPath(result, missingPath, `${kind} missing path failure`);
}

function assertNoLeakedPath(result: ReturnType<typeof spawnSync>, forbiddenPath: string, label: string): void {
  const combined = `${result.stdout}\n${result.stderr}`;
  if (combined.includes(forbiddenPath) || combined.includes(tempDir)) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${label} should not print root-only or temp paths`);
  }
}

function rewriteSummaryHash(outputDir: string, summaryField: string, fileName: string): void {
  const summaryPath = path.join(outputDir, "remote-summary.txt");
  const targetPath = path.join(outputDir, fileName);
  const targetHash = sha256(readText(targetPath));
  const updated = readText(summaryPath)
    .split(/\r?\n/)
    .map((line) => line.startsWith(`${summaryField}: `)
      ? line.replace(/sha256:[a-f0-9]{64}/i, `sha256:${targetHash}`)
      : line)
    .join("\n");
  writeFileSync(summaryPath, updated);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateUpdateStatus(redactedStatus: string): void {
  const validation = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/update-agent-status-validate.ts",
    redactedStatus,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    console.error(validation.stdout);
    console.error(validation.stderr);
    throw new Error("redacted update status from helper should validate");
  }
}

function validateRedactedExport(outputDir: string): string {
  const validation = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/release-evidence-redacted-export-validate.ts",
    outputDir,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    console.error(validation.stdout);
    console.error(validation.stderr);
    throw new Error("complete redacted export directory should validate");
  }
  return validation.stdout;
}

function expectRedactedExportValidationFailure(outputDir: string, expectedField: string): void {
  const validation = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/release-evidence-redacted-export-validate.ts",
    outputDir,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (validation.status === 0) {
    console.error(validation.stdout);
    throw new Error("redacted export without smoke output should fail validation");
  }
  if (!validation.stderr.includes(expectedField)) {
    console.error(validation.stdout);
    console.error(validation.stderr);
    throw new Error(`validation failure should name ${expectedField}`);
  }
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(readFileSync(filePath, "utf8")) as JsonRecord;
}

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function makeOutputDir(label: string): string {
  outputCounter += 1;
  const safeLabel = label.replace(/[^A-Za-z0-9._-]/g, "-");
  const outputDir = path.join(
    "/tmp",
    `areaforge-release-evidence-redacted-selftest-${process.pid}-${Date.now()}-${outputCounter}-${safeLabel}`,
  );
  outputDirs.push(outputDir);
  return outputDir;
}
