import path from "node:path";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";

type JsonRecord = Record<string, unknown>;

function main(): void {
  const statusPath = process.argv[2];
  if (!statusPath) {
    console.error("Usage: pnpm update-agent:status:validate <redacted-update-status.json>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(statusPath));
  const issues = validateStatus(raw);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`update-agent status validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("update-agent status validation passed: required fields, signing policy, timer status, rollback summary, freshness, and redaction checks are present.");
  console.log(`updateAgentStatusEvidenceHash: sha256:${sha256(raw)}`);
  console.log("safetyFacts: redactedStatusOnly=true serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false");
}

function validateStatus(raw: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    return [{ field: "json", message: error instanceof Error ? error.message : "invalid JSON" }];
  }

  if (!isRecord(body)) {
    return [{ field: "json", message: "must be a JSON object" }];
  }

  const status = isRecord(body.status) ? body.status : body;
  const safetyFacts = isRecord(body.safetyFacts) ? body.safetyFacts : {};

  requireString(status, "currentVersion", issues);
  requireOneOfValue(status.autoApply, "autoApply", ["none", "patch", "minor", "all"], issues);
  requireBoolean(status.signatureRequired, "signatureRequired", issues);
  requireNullableBoolean(status.timerEnabled, "timerEnabled", issues);
  requireNullableBoolean(status.timerActive, "timerActive", issues);
  requireNullableString(status.blocker, "blocker", issues);
  requireNullableString(status.lastCheckedAt, "lastCheckedAt", issues);
  requireNullableString(status.statusUpdatedAt, "statusUpdatedAt", issues);

  if (typeof status.currentVersion === "string" && !/^\d+\.\d+\.\d+$/.test(status.currentVersion)) {
    issues.push({ field: "currentVersion", message: "must look like X.Y.Z" });
  }
  const expectedVersion = normalizeVersion(process.env.AREAFORGE_UPDATE_AGENT_EXPECTED_VERSION);
  if (expectedVersion && status.currentVersion !== expectedVersion) {
    issues.push({ field: "currentVersion", message: `must be ${expectedVersion} when AREAFORGE_UPDATE_AGENT_EXPECTED_VERSION is set` });
  }
  if (status.latestVersion != null && (typeof status.latestVersion !== "string" || !/^v?\d+\.\d+\.\d+$/.test(status.latestVersion))) {
    issues.push({ field: "latestVersion", message: "must look like X.Y.Z or vX.Y.Z when present" });
  }
  if (status.signatureRequired !== true) {
    issues.push({ field: "signatureRequired", message: "must be true" });
  }
  if (status.blocker != null) {
    issues.push({ field: "blocker", message: "must be null for a healthy update-agent status record" });
  }
  if (status.autoApply !== "none") {
    issues.push({ field: "autoApply", message: "must remain none unless AF-RISK-REL-001 has explicit closure evidence" });
  }

  if (typeof status.lastCheckedAt === "string" && Number.isNaN(Date.parse(status.lastCheckedAt))) {
    issues.push({ field: "lastCheckedAt", message: "must be ISO-8601 when present" });
  }
  if (typeof status.statusUpdatedAt === "string" && Number.isNaN(Date.parse(status.statusUpdatedAt))) {
    issues.push({ field: "statusUpdatedAt", message: "must be ISO-8601 when present" });
  }
  validateFreshness(status, issues);

  if (isRecord(status.rollback)) {
    requireBoolean(status.rollback.available, "rollback.available", issues);
    requireNullableString(status.rollback.targetVersion, "rollback.targetVersion", issues);
    requireNullableString(status.rollback.targetImage, "rollback.targetImage", issues);
    if (typeof status.rollback.targetImage === "string" && status.rollback.targetImage && !/@sha256:[a-f0-9]{64}$/i.test(status.rollback.targetImage)) {
      issues.push({ field: "rollback.targetImage", message: "must use image@sha256 digest when present" });
    }
  } else {
    issues.push({ field: "rollback", message: "is required as an object" });
  }

  requireFalseSafety(safetyFacts, "serverCommandAttempted", issues);
  requireFalseSafety(safetyFacts, "productionWriteAttempted", issues);
  requireFalseSafety(safetyFacts, "secretValuePrinted", issues);
  requireFalseSafety(safetyFacts, "backupRestoreAttempted", issues);
  requireFalseSafety(safetyFacts, "migrationAttempted", issues);
  requireFalseSafety(safetyFacts, "updaterApplyAttempted", issues);
  scanForSecrets(raw, issues);

  return issues;
}

function validateFreshness(status: JsonRecord, issues: ValidationIssue[]): void {
  const maxAgeSeconds = parsePositiveNumber(process.env.AREAFORGE_UPDATE_AGENT_MAX_AGE_SECONDS);
  if (maxAgeSeconds == null) return;
  const timestamp = typeof status.statusUpdatedAt === "string" && status.statusUpdatedAt.trim()
    ? status.statusUpdatedAt
    : typeof status.lastCheckedAt === "string" && status.lastCheckedAt.trim() ? status.lastCheckedAt : "";
  if (!timestamp) {
    issues.push({ field: "statusUpdatedAt", message: "or lastCheckedAt is required when AREAFORGE_UPDATE_AGENT_MAX_AGE_SECONDS is set" });
    return;
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return;
  const ageSeconds = Math.max(0, (validationNow().getTime() - parsed) / 1000);
  if (ageSeconds > maxAgeSeconds) {
    issues.push({ field: "statusUpdatedAt", message: `must be within ${maxAgeSeconds} seconds when AREAFORGE_UPDATE_AGENT_MAX_AGE_SECONDS is set` });
  }
}

function parsePositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeVersion(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

function validationNow(): Date {
  const raw = process.env.AREAFORGE_UPDATE_AGENT_NOW?.trim();
  return raw ? new Date(raw) : new Date();
}

function requireString(record: JsonRecord, field: string, issues: ValidationIssue[]): void {
  if (typeof record[field] !== "string" || String(record[field]).trim() === "") {
    issues.push({ field, message: "is required and must be a non-empty string" });
  }
}

function requireNullableString(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (value != null && typeof value !== "string") {
    issues.push({ field, message: "must be a string or null" });
  }
}

function requireBoolean(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "boolean") {
    issues.push({ field, message: "must be boolean" });
  }
}

function requireNullableBoolean(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (value != null && typeof value !== "boolean") {
    issues.push({ field, message: "must be boolean or null" });
  }
}

function requireOneOfValue(value: unknown, field: string, allowed: string[], issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
  }
}

function requireFalseSafety(safetyFacts: JsonRecord, field: string, issues: ValidationIssue[]): void {
  if (safetyFacts[field] !== false) {
    issues.push({ field: `safetyFacts.${field}`, message: "must be false" });
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
