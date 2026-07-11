import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type SmokeOutput = {
  ok?: unknown;
  baseUrl?: unknown;
  checkedAt?: unknown;
  checks?: Array<{
    name?: unknown;
    ok?: unknown;
    durationMs?: unknown;
  }>;
};

type ReleaseManifest = {
  schemaVersion?: unknown;
  app?: unknown;
  version?: unknown;
  webImageDigest?: unknown;
  migrationImageDigest?: unknown;
};

const smokeResultPath = process.argv[2] ??
  process.env.AREAFORGE_SMOKE_RESULT_FILE ??
  process.env.AREAFORGE_READINESS_SMOKE_RESULT_FILE;

async function main(): Promise<void> {
  if (!smokeResultPath) {
    console.error("Usage: pnpm smoke:prod-readonly:record <prod-readonly-smoke-output.log>");
    process.exit(2);
  }

  const absoluteSmokePath = path.resolve(smokeResultPath);
  const smokeLog = readRequiredFile(absoluteSmokePath);
  const smoke = parseSmokeOutput(smokeLog);
  const manifest = await collectManifest();

  const expectedVersion = stringOrNull(process.env.AREAFORGE_READINESS_EXPECTED_VERSION) ??
    stringOrNull(process.env.AREAFORGE_SMOKE_EXPECTED_VERSION) ??
    stringOrNull(process.env.APP_VERSION) ??
    stringOrNull(manifest?.version);
  const releaseTag = stringOrNull(process.env.AREAFORGE_READINESS_RELEASE_TAG) ??
    (expectedVersion ? versionTag(expectedVersion) : null);
  const webImageDigest = stringOrNull(process.env.AREAFORGE_READINESS_WEB_IMAGE_DIGEST) ??
    stringOrNull(manifest?.webImageDigest);
  const migrationImageDigest = stringOrNull(process.env.AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST) ??
    stringOrNull(manifest?.migrationImageDigest);

  const missing = [
    expectedVersion ? null : "expected version",
    releaseTag ? null : "release tag",
    webImageDigest ? null : "web image digest",
    migrationImageDigest ? null : "migration image digest",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`FAIL record generation: missing ${missing.join(", ")}`);
    process.exit(1);
  }

  const checks = normalizeChecks(smoke);
  const checkedAt = stringOrNull(smoke.checkedAt) ?? new Date().toISOString();
  const recordId = stringOrNull(process.env.AREAFORGE_PROD_READONLY_SMOKE_RECORD_ID) ??
    `prod-readonly-smoke-${compactTimestamp(checkedAt)}`;
  const passwordFromFile = Boolean(process.env.AREAFORGE_SMOKE_PASSWORD_FILE);
  const smokeCommand = stringOrNull(process.env.AREAFORGE_PROD_READONLY_SMOKE_COMMAND) ??
    stringOrNull(process.env.AREAFORGE_SMOKE_COMMAND_LABEL) ??
    "pnpm smoke:prod-readonly";

  const record = [
    `recordId: ${recordId}`,
    `checkedAt: ${checkedAt}`,
    `environment: ${normalizeEnvironment(process.env.AREAFORGE_READINESS_ENVIRONMENT ?? process.env.APP_ENV)}`,
    `baseUrl: ${stringOrNull(smoke.baseUrl) ?? normalizeBaseUrl(process.env.AREAFORGE_SMOKE_BASE_URL ?? process.env.APP_URL ?? "")}`,
    `expectedVersion: ${expectedVersion}`,
    `releaseTag: ${releaseTag}`,
    `webImageDigest: ${webImageDigest}`,
    `migrationImageDigest: ${migrationImageDigest}`,
    `smokeCommand: ${smokeCommand}`,
    `smokeStatus: ${smoke.ok === true ? "pass" : "fail"}`,
    `smokeResultHash: sha256:${sha256(smokeLog)}`,
    `checks: ${checks.join(",")}`,
    `smokePasswordSource: ${passwordSource(passwordFromFile)}`,
    `smokePasswordReadFromFile: ${passwordFromFile ? "yes" : "no"}`,
    `updateStatusIncluded: ${checks.includes("update-status") ? "yes" : "no"}`,
    `updaterEnvSummary: ${updaterEnvSummary()}`,
    `updateRecordSummary: ${stringOrNull(process.env.AREAFORGE_UPDATE_RECORD_SUMMARY) ?? "none"}`,
    "residualRiskIds: AF-RISK-OPS-001",
    `followUpTasks: ${stringOrNull(process.env.AREAFORGE_PROD_READONLY_SMOKE_FOLLOW_UPS) ?? "tasks/indexes/residuals.md"}`,
    "safetyFacts:",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  productionWriteAttempted: no",
    "  secretValuePrinted: no",
    "  passwordValuePrinted: no",
    "  writeSmokeAttempted: no",
    "",
  ].join("\n");

  process.stdout.write(record);
}

async function collectManifest(): Promise<ReleaseManifest | null> {
  const manifestFile = process.env.AREAFORGE_READINESS_RELEASE_MANIFEST_FILE;
  if (manifestFile) {
    return normalizeManifest(JSON.parse(readRequiredFile(path.resolve(manifestFile))));
  }

  const releaseTag = process.env.AREAFORGE_READINESS_RELEASE_TAG ??
    (process.env.AREAFORGE_READINESS_EXPECTED_VERSION ? versionTag(process.env.AREAFORGE_READINESS_EXPECTED_VERSION) : null);
  const manifestUrl = process.env.AREAFORGE_READINESS_RELEASE_MANIFEST_URL ??
    githubReleaseManifestUrl(process.env.AREAFORGE_READINESS_GITHUB_REPO, releaseTag);
  if (!manifestUrl) return null;

  const response = await fetch(manifestUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`cannot fetch release manifest: HTTP ${response.status}`);
  }
  return normalizeManifest(await response.json());
}

function parseSmokeOutput(smokeLog: string): SmokeOutput {
  const jsonLine = [...smokeLog.split(/\r?\n/)]
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error("smoke output does not contain final JSON result");
  }
  return JSON.parse(jsonLine) as SmokeOutput;
}

function normalizeChecks(smoke: SmokeOutput): string[] {
  if (!Array.isArray(smoke.checks)) return [];
  return smoke.checks
    .map((check) => stringOrNull(check.name)?.trim().toLowerCase() ?? "")
    .filter(Boolean);
}

function normalizeManifest(value: unknown): ReleaseManifest {
  const manifest = asRecord(value) as ReleaseManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error(`release manifest schemaVersion is ${String(manifest.schemaVersion)}`);
  }
  if (manifest.app !== "AreaForge") {
    throw new Error(`release manifest app is ${String(manifest.app)}`);
  }
  return manifest;
}

function passwordSource(fromFile: boolean): string {
  if (fromFile) return "AREAFORGE_SMOKE_PASSWORD_FILE=<redacted path>";
  if (process.env.AREAFORGE_SMOKE_PASSWORD) return "AREAFORGE_SMOKE_PASSWORD=<redacted env>";
  return "none";
}

function updaterEnvSummary(): string {
  const customSummary = stringOrNull(process.env.AREAFORGE_UPDATER_ENV_SUMMARY);
  if (customSummary) return customSummary;
  return process.env.AREAFORGE_EXTRA_SMOKE_COMMAND
    ? "AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted"
    : "AREAFORGE_EXTRA_SMOKE_COMMAND not supplied to record generator";
}

function normalizeEnvironment(value: string | undefined): "production" | "staging" {
  return value === "staging" ? "staging" : "production";
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function githubReleaseManifestUrl(repo: string | undefined, tag: string | null): string | null {
  if (!repo || !tag || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/areaforge-release-manifest.json`;
}

function versionTag(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

main().catch((error) => {
  console.error(`FAIL production readonly smoke record generation: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
