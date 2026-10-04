import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface ValidationIssue {
  field: string;
  message: string;
}

const requiredScalarFields = [
  "recordId",
  "checkedAt",
  "environment",
  "baseUrl",
  "expectedVersion",
  "releaseTag",
  "webImageDigest",
  "migrationImageDigest",
  "smokeCommand",
  "smokeStatus",
  "smokeResultHash",
  "checks",
  "smokePasswordSource",
  "smokePasswordReadFromFile",
  "updateStatusIncluded",
  "updaterEnvSummary",
  "updateRecordSummary",
  "residualRiskIds",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.passwordValuePrinted",
  "safetyFacts.writeSmokeAttempted",
] as const;

const yesNoFields = [
  "smokePasswordReadFromFile",
  "updateStatusIncluded",
  ...requiredNestedFields,
] as const;

const requiredChecks = [
  "health",
  "login",
  "auth/me",
  "dashboard",
  "notes",
  "syllabus",
  "analytics",
  "reports",
  "long-term-risks",
  "update-status",
];

const secretPatterns = [
  { label: "DATABASE_URL", pattern: /postgres(?:ql)?:\/\/[^ \n]+/i },
  { label: "API key", pattern: /\b(?:sk-|rk-|sess-)[A-Za-z0-9_-]{16,}/ },
  { label: "AUTH_SESSION_SECRET", pattern: /AUTH_SESSION_SECRET\s*=\s*\S+/i },
  { label: "AI_API_KEY", pattern: /AI_API_KEY\s*=\s*\S+/i },
  { label: "smoke password env value", pattern: /\bAREAFORGE_SMOKE_PASSWORD\s*=\s*\S+/i },
  { label: "other password env value", pattern: /\b(?:POSTGRES_PASSWORD|COSIGN_PASSWORD)\s*=\s*\S+/i },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { label: "cookie", pattern: /\b(?:session|cookie)\s*[:=]\s*[A-Za-z0-9._=-]{16,}/i },
  { label: "raw prompt", pattern: /\b(prompt|rawResponse|fullReviewText|attachmentContent)\b/i },
];

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record.md|txt>");
    process.exit(2);
  }

  const absoluteRecordPath = path.resolve(recordPath);
  const record = readRequiredFile(absoluteRecordPath);
  const fields = parseIndentedKeyValueRecord(record);
  const issues = validateRecord(record, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`production readonly smoke record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("production readonly smoke record validation passed: required fields are present, smoke evidence is pass, OPS-001 is tracked, and secrets are absent.");
  console.log(`prodReadonlySmokeEvidenceHash: ${buildEvidenceHash(fields)}`);
  console.log(`smokeProofFreshnessStatus: ${smokeProofFreshness(fields).status}`);
  console.log(`smokeProofAgeSeconds: ${smokeProofFreshness(fields).ageSeconds ?? "unknown"}`);
  console.log(`smokeProofMaxAgeSeconds: ${smokeProofFreshness(fields).maxAgeSeconds}`);
  console.log("safetyFacts: serverCommandAttempted=false backupRestoreAttempted=false migrationAttempted=false productionWriteAttempted=false secretValuePrinted=false passwordValuePrinted=false writeSmokeAttempted=false");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireOneOf(fields, "environment", ["production", "staging"], issues);
  requireOneOf(fields, "smokeStatus", ["pass", "fail"], issues);
  for (const field of yesNoFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
  }

  const baseUrl = fields.get("baseUrl");
  if (baseUrl && !/^https:\/\/[^ \n]+$/i.test(baseUrl)) {
    issues.push({ field: "baseUrl", message: "must be an https URL" });
  }

  validateSmokeProofFreshness(fields, issues);

  const releaseTag = fields.get("releaseTag");
  if (releaseTag && !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
    issues.push({ field: "releaseTag", message: "must look like vX.Y.Z" });
  }

  for (const field of ["webImageDigest", "migrationImageDigest"] as const) {
    const value = fields.get(field);
    if (value && !/@sha256:[a-f0-9]{64}$/i.test(value)) {
      issues.push({ field, message: "must end with @sha256:<64-hex>" });
    }
  }

  const smokeResultHash = fields.get("smokeResultHash");
  if (smokeResultHash && !/^(sha256:)?[a-f0-9]{64}$/i.test(smokeResultHash)) {
    issues.push({ field: "smokeResultHash", message: "must be a 64-character sha256 hex digest with optional sha256: prefix" });
  }

  const command = fields.get("smokeCommand");
  if (command && !isAllowedSmokeCommand(command)) {
    issues.push({ field: "smokeCommand", message: "must reference pnpm smoke:prod-readonly or areaforge-ops001-readonly-fallback.sh" });
  }

  if (fields.get("smokeStatus")?.toLowerCase() !== "pass") {
    issues.push({ field: "smokeStatus", message: "must be pass for an OPS-001 closure smoke record" });
  }
  if (fields.get("smokePasswordReadFromFile")?.toLowerCase() !== "yes") {
    issues.push({ field: "smokePasswordReadFromFile", message: "must be yes and use a redacted password-file summary" });
  }
  if (fields.get("updateStatusIncluded")?.toLowerCase() !== "yes") {
    issues.push({ field: "updateStatusIncluded", message: "must be yes so update-agent state is covered" });
  }
  if (!fields.get("residualRiskIds")?.includes("AF-RISK-OPS-001")) {
    issues.push({ field: "residualRiskIds", message: "must include AF-RISK-OPS-001" });
  }

  const checks = parseList(fields.get("checks") ?? "");
  const missingChecks = requiredChecks.filter((check) => !checks.includes(check));
  if (missingChecks.length > 0) {
    issues.push({ field: "checks", message: `missing ${missingChecks.join(", ")}` });
  }

  for (const field of requiredNestedFields) {
    if (fields.get(field)?.toLowerCase() !== "no") {
      issues.push({ field, message: "must be no" });
    }
  }

  for (const item of secretPatterns) {
    if (item.pattern.test(record)) {
      issues.push({ field: "record", message: `must not contain ${item.label}` });
    }
  }

  return issues;
}

function validateSmokeProofFreshness(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const checkedAt = fields.get("checkedAt");
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) {
    issues.push({ field: "checkedAt", message: "must be an ISO-8601 timestamp" });
    return;
  }
  const freshness = smokeProofFreshness(fields);
  if (freshness.status === "future") {
    issues.push({ field: "checkedAt", message: "must not be in the future by more than 300 seconds" });
    return;
  }
  if (freshness.status !== "fresh") {
    issues.push({
      field: "checkedAt",
      message: `must be within smoke proof freshness window ${freshness.maxAgeSeconds}s; ageSeconds=${freshness.ageSeconds ?? "unknown"}`,
    });
  }
}

function smokeProofFreshness(fields: Map<string, string>): {
  status: "fresh" | "stale" | "unknown" | "future";
  ageSeconds: number | null;
  maxAgeSeconds: number;
} {
  const maxAgeSeconds = smokeProofMaxAgeSeconds();
  const checkedAt = fields.get("checkedAt");
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) {
    return { status: "unknown", ageSeconds: null, maxAgeSeconds };
  }
  const ageSeconds = Math.floor((smokeProofNowMs() - Date.parse(checkedAt)) / 1000);
  if (ageSeconds < -300) return { status: "future", ageSeconds, maxAgeSeconds };
  return {
    status: ageSeconds <= maxAgeSeconds ? "fresh" : "stale",
    ageSeconds,
    maxAgeSeconds,
  };
}

function smokeProofMaxAgeSeconds(): number {
  const raw = process.env.AREAFORGE_SMOKE_PROOF_MAX_AGE_SECONDS ??
    process.env.AREAFORGE_OPS001_SMOKE_PROOF_MAX_AGE_SECONDS ??
    "86400";
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 86400;
}

function smokeProofNowMs(): number {
  const raw = process.env.AREAFORGE_SMOKE_PROOF_NOW ?? process.env.AREAFORGE_OPS001_SMOKE_PROOF_NOW;
  if (raw && !Number.isNaN(Date.parse(raw))) return Date.parse(raw);
  return Date.now();
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedSmokeCommand(command: string): boolean {
  return command.includes("pnpm smoke:prod-readonly") ||
    command.includes("areaforge-ops001-readonly-fallback.sh");
}

function requireField(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field);
  if (!value || value.trim().length === 0) {
    issues.push({ field, message: "is required" });
  }
}

function requireOneOf(
  fields: Map<string, string>,
  field: string,
  allowed: string[],
  issues: ValidationIssue[],
): void {
  const value = fields.get(field);
  if (value && !allowed.includes(value.toLowerCase())) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
  }
}

function parseIndentedKeyValueRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentSection = "";

  for (const rawLine of record.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const match = rawLine.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    const value = match[3]?.trim() ?? "";
    if (indent === 0) {
      currentSection = value ? "" : key;
      fields.set(key, value);
      continue;
    }

    if (currentSection) {
      fields.set(`${currentSection}.${key}`, value);
    }
  }

  return fields;
}

function buildEvidenceHash(fields: Map<string, string>): string {
  const keys = [
    ...requiredScalarFields,
    ...requiredNestedFields,
  ].filter((key, index, array) => array.indexOf(key) === index).sort();
  const bundle = keys.map((key) => [key, fields.get(key) ?? ""]);
  const hash = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return `sha256:${hash}`;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  return readFileSync(filePath, "utf8");
}

main();
