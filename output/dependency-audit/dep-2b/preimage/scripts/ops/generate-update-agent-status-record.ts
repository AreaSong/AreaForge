import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const sourcePath = process.argv[2] ?? process.env.AREAFORGE_UPDATE_AGENT_STATUS_SOURCE_FILE;

function main(): void {
  if (!sourcePath) {
    console.error("Usage: pnpm update-agent:status:record <status.json>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(sourcePath));
  const source = parseJson(raw);
  const status = isRecord(source.status) ? source.status : source;
  const output = buildStatusRecord(status);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function buildStatusRecord(status: JsonRecord): JsonRecord {
  return {
    currentVersion: stringOrDefault(status.currentVersion, "unknown"),
    currentImage: nullableString(status.currentImage),
    releaseUrl: nullableString(status.releaseUrl),
    latestVersion: nullableString(status.latestVersion),
    updateAvailable: booleanOrDefault(status.updateAvailable, false),
    autoApply: stringOrDefault(status.autoApply, "none"),
    signatureRequired: booleanOrDefault(status.signatureRequired, false),
    timerEnabled: nullableBoolean(status.timerEnabled),
    timerActive: nullableBoolean(status.timerActive),
    lastCheckedAt: nullableString(status.lastCheckedAt),
    blocker: nullableString(status.blocker),
    rollback: normalizeRollback(status.rollback),
    statusUpdatedAt: nullableString(status.statusUpdatedAt) ?? new Date().toISOString(),
    safetyFacts: {
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      updaterApplyAttempted: false,
    },
  };
}

function normalizeRollback(value: unknown): JsonRecord {
  const rollback = isRecord(value) ? value : {};
  return {
    available: booleanOrDefault(rollback.available, false),
    targetVersion: nullableString(rollback.targetVersion),
    targetImage: nullableString(rollback.targetImage),
  };
}

function parseJson(raw: string): JsonRecord {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "invalid JSON");
  }
  if (!isRecord(body)) {
    throw new Error("status source must be a JSON object");
  }
  return body;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? redact(value.trim()) : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? redact(value.trim()) : null;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/\b(?:AI_API_KEY|AUTH_SESSION_SECRET|POSTGRES_PASSWORD|COSIGN_PASSWORD|GITHUB_TOKEN|AREAFORGE_GITHUB_TOKEN)=\S+/gi, "$1=<redacted>");
}

try {
  main();
} catch (error) {
  console.error(`FAIL update-agent status record generation: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
