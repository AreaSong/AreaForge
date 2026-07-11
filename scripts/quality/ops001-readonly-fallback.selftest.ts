import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-ops001-fallback-selftest-"));

try {
  const blocked = createFixture("blocked");
  writeFileSync(blocked.configPath, [
    "AREAFORGE_HEALTH_URL=https://forge.areasong.top/api/health",
    "AREAFORGE_AUTO_APPLY=none",
    "",
  ].join("\n"));
  const blockedResult = runFallback(blocked.configPath, blocked.stateDir, blocked.outputDir);

  if (blockedResult.status !== 10) {
    console.error(blockedResult.stdout);
    console.error(blockedResult.stderr);
    throw new Error(`expected fallback helper to exit 10 for missing prerequisites, got ${String(blockedResult.status)}`);
  }

  const blockedRedactedStatus = path.join(blocked.outputDir, "redacted-update-status.json");
  const blockedPrerequisites = path.join(blocked.outputDir, "remote-prerequisites.json");
  const blockedSummary = path.join(blocked.outputDir, "remote-summary.txt");
  for (const filePath of [blockedRedactedStatus, blockedPrerequisites, blockedSummary]) {
    if (!existsSync(filePath)) throw new Error(`missing expected fallback output: ${path.basename(filePath)}`);
  }

  const blockedPrereq = readJson(blockedPrerequisites);
  assert(blockedPrereq.mode === "ops001-readonly-fallback-prerequisites", "prerequisite mode mismatch");
  assert(blockedPrereq.extraSmokeCommandConfigured === "no", "extra smoke command should be marked missing");
  assert(blockedPrereq.smokeEmailConfigured === "no", "smoke email should be marked missing");
  assert(blockedPrereq.smokePasswordFileConfigured === "no", "smoke password file should be marked missing");
  const blockers = Array.isArray(blockedPrereq.blockers) ? blockedPrereq.blockers.join(" ") : "";
  assert(blockers.includes("extra smoke command missing"), "missing extra smoke blocker");
  assert(blockers.includes("smoke email missing"), "missing smoke email blocker");
  assert(blockers.includes("smoke password file env missing"), "missing smoke password file blocker");

  validateUpdateStatus(blockedRedactedStatus);

  const blockedSummaryText = readText(blockedSummary);
  for (const forbidden of [
    "updater apply",
    "database writes",
    "upload writes",
    "secret export",
  ]) {
    assert(blockedSummaryText.includes(forbidden), `summary should mention forbidden action: ${forbidden}`);
  }
  assert(blockedSummaryText.includes("redactedHandoffStatus:"), "summary should include redacted handoff status");
  assert(blockedSummaryText.includes("redactedHandoffScope: /tmp/areaforge-ops001-fallback-* only"), "summary should restrict handoff scope");

  const success = createFixture("success");
  const passwordPath = path.join(tempDir, "smoke-password.txt");
  const fakeBinDir = path.join(tempDir, "fake-bin");
  mkdirFixture(fakeBinDir);
  writeFileSync(passwordPath, "redacted-test-password\n");
  chmodSync(passwordPath, 0o600);
  writeFakeCurl(path.join(fakeBinDir, "curl"));
  writeFileSync(success.configPath, [
    "AREAFORGE_HEALTH_URL=https://forge.areasong.top/api/health",
    "AREAFORGE_SMOKE_BASE_URL=https://forge.areasong.top",
    "AREAFORGE_SMOKE_EXPECTED_VERSION=0.1.5",
    "AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none",
    "AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly'",
    "AREAFORGE_AUTO_APPLY=none",
    "AREAFORGE_SMOKE_EMAIL=smoke@example.invalid",
    `AREAFORGE_SMOKE_PASSWORD_FILE='${passwordPath}'`,
    "",
  ].join("\n"));

  const successResult = runFallback(success.configPath, success.stateDir, success.outputDir, {
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
  });
  if (successResult.status !== 0) {
    console.error(successResult.stdout);
    console.error(successResult.stderr);
    throw new Error(`expected fallback helper to exit 0 for complete prerequisites and passing smoke, got ${String(successResult.status)}`);
  }

  const successSmokeOutput = path.join(success.outputDir, "prod-readonly-smoke-output.log");
  const successSummary = path.join(success.outputDir, "remote-summary.txt");
  const successPrerequisites = path.join(success.outputDir, "remote-prerequisites.json");
  for (const filePath of [successSmokeOutput, successSummary, successPrerequisites]) {
    if (!existsSync(filePath)) throw new Error(`missing expected success output: ${path.basename(filePath)}`);
  }
  const successPrereq = readJson(successPrerequisites);
  assert(Array.isArray(successPrereq.blockers) && successPrereq.blockers.length === 0, "success prerequisites should have no blockers");

  const smoke = parseFinalJson(readText(successSmokeOutput));
  assert(smoke.ok === true, "success smoke output should end with ok=true JSON");
  const checks = Array.isArray(smoke.checks) ? smoke.checks.map((check) => check.name).join(",") : "";
  for (const required of ["health", "login", "auth/me", "dashboard", "notes", "syllabus", "analytics", "reports", "long-term-risks", "update-status"]) {
    assert(checks.includes(required), `success smoke output should include ${required}`);
  }
  assert(readText(successSummary).includes("smokeStatus: pass"), "success summary should record smokeStatus pass");

  const smokeRecordPath = path.join(tempDir, "prod-readonly-smoke-record.txt");
  const smokeRecord = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/ops/generate-prod-readonly-smoke-record.ts",
    successSmokeOutput,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_READINESS_EXPECTED_VERSION: "0.1.5",
      AREAFORGE_READINESS_RELEASE_TAG: "v0.1.5",
      AREAFORGE_READINESS_WEB_IMAGE_DIGEST: `ghcr.io/areasong/areaforge-web:v0.1.5@sha256:${"a".repeat(64)}`,
      AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST: `ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:${"b".repeat(64)}`,
      AREAFORGE_SMOKE_PASSWORD_FILE: passwordPath,
      AREAFORGE_PROD_READONLY_SMOKE_COMMAND: "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    },
  });
  if (smokeRecord.status !== 0) {
    console.error(smokeRecord.stdout);
    console.error(smokeRecord.stderr);
    throw new Error("fallback smoke output should generate a production readonly smoke record");
  }
  writeFileSync(smokeRecordPath, smokeRecord.stdout);
  validateSmokeRecord(smokeRecordPath);

  console.log("OPS-001 read-only fallback helper selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function runFallback(
  configPath: string,
  stateDir: string,
  outputDir: string,
  env: Record<string, string> = {},
): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [
    "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    "--config",
    configPath,
    "--state-dir",
    stateDir,
    "--output-dir",
    outputDir,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function validateUpdateStatus(redactedStatus: string): void {
  const statusValidation = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/update-agent-status-validate.ts",
    redactedStatus,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (statusValidation.status !== 0) {
    console.error(statusValidation.stdout);
    console.error(statusValidation.stderr);
    throw new Error("redacted update status from fallback helper should validate");
  }
}

function validateSmokeRecord(smokeRecordPath: string): void {
  const validation = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/prod-readonly-smoke-validate.ts",
    smokeRecordPath,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    console.error(validation.stdout);
    console.error(validation.stderr);
    throw new Error("fallback-generated production readonly smoke record should validate");
  }
}

function createFixture(name: string): {
  stateDir: string;
  outputDir: string;
  configPath: string;
} {
  const fixtureDir = path.join(tempDir, name);
  const stateDir = path.join(fixtureDir, "state");
  const outputDir = path.join(fixtureDir, "out");
  const configPath = path.join(fixtureDir, "updater.env");
  mkdirFixture(stateDir);
  mkdirFixture(outputDir);
  writeFileSync(path.join(stateDir, "status.json"), JSON.stringify(createStatus(), null, 2));
  return { stateDir, outputDir, configPath };
}

function writeFakeCurl(filePath: string): void {
  writeFileSync(filePath, `#!/usr/bin/env bash
set -Eeuo pipefail
out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -w|-c|-b|-H|-m|-X|--data-binary)
      shift 2
      ;;
    -sS)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
path="\${url#https://forge.areasong.top}"
case "$path" in
  /api/health)
    body='{"ok":true,"service":"AreaForge","version":"0.1.5"}'
    ;;
  /api/auth/login)
    body='{"user":{"email":"smoke@example.invalid"}}'
    ;;
  /api/auth/me)
    body='{"user":{"email":"smoke@example.invalid"}}'
    ;;
  /api/dashboard/today)
    body='{"dashboard":{"ok":true}}'
    ;;
  /api/notes)
    body='{"notes":[]}'
    ;;
  /api/syllabus)
    body='{"items":[]}'
    ;;
  /api/analytics/summary)
    body='{"analytics":{"ok":true}}'
    ;;
  /api/reports/periodic)
    body='{"reports":[]}'
    ;;
  /api/analytics/long-term-risks)
    body='{"longTermRisks":[]}'
    ;;
  /api/system/update-status)
    body='{"status":{"currentVersion":"0.1.5","autoApply":"none"}}'
    ;;
  *)
    body='{"error":"not found"}'
    ;;
esac
printf '%s' "$body" > "$out"
if [[ "$body" == '{"error":"not found"}' ]]; then
  printf '404'
else
  printf '200'
fi
`);
  chmodSync(filePath, 0o700);
}

function parseFinalJson(raw: string): JsonRecord {
  const jsonLine = raw
    .split(/\r?\n/)
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) throw new Error("smoke output should contain final JSON result");
  return JSON.parse(jsonLine) as JsonRecord;
}

function mkdirFixture(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function createStatus(): JsonRecord {
  return {
    currentVersion: "0.1.5",
    currentImage: "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9",
    releaseUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.5",
    latestVersion: "0.1.5",
    updateAvailable: false,
    autoApply: "none",
    signatureRequired: true,
    timerEnabled: true,
    timerActive: true,
    lastCheckedAt: "2026-07-11T09:00:09Z",
    blocker: null,
    rollback: {
      available: true,
      targetVersion: "0.1.1",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.1@sha256:908b3ce28ab12df003b934690156a7e054e221eff8e44f827c012c711c373e6b",
    },
    statusUpdatedAt: "2026-07-11T09:00:09Z",
    appUrl: "https://forge.areasong.top",
  };
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
