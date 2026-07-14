import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface ValidationIssue {
  field: string;
  message: string;
}

const requiredScalarFields = [
  "recordId",
  "reviewedAt",
  "reviewer",
  "environment",
  "baseUrl",
  "appVersion",
  "source",
  "reviewCommand",
  "reviewStatus",
  "reviewResultHash",
  "viewports",
  "journeys",
  "screenshotEvidence",
  "nextActionWithin5s",
  "recommendationsExplainWhy",
  "confirmOnlyBoundariesVisible",
  "recoveryPathVisible",
  "mobileReadable",
  "emptyUnauthorizedErrorStatesChecked",
  "residualRiskIds",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.destructiveActionAttempted",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.realStudyContentIncluded",
] as const;

const yesNoFields = [
  "nextActionWithin5s",
  "recommendationsExplainWhy",
  "confirmOnlyBoundariesVisible",
  "recoveryPathVisible",
  "mobileReadable",
  "emptyUnauthorizedErrorStatesChecked",
  ...requiredNestedFields,
] as const;

const requiredJourneys = [
  "login",
  "dashboard",
  "timer-closeout",
  "review",
  "notes",
  "syllabus",
  "reports",
  "simulation",
  "update-center",
];

const requiredViewports = ["desktop", "mobile"];

const secretPatterns = [
  { label: "DATABASE_URL", pattern: /postgres(?:ql)?:\/\/[^ \n]+/i },
  { label: "API key", pattern: /\b(?:sk-|rk-|sess-)[A-Za-z0-9_-]{16,}/ },
  { label: "AUTH_SESSION_SECRET", pattern: /AUTH_SESSION_SECRET\s*=\s*\S+/i },
  { label: "AI_API_KEY", pattern: /AI_API_KEY\s*=\s*\S+/i },
  { label: "smoke password env value", pattern: /\bAREAFORGE_SMOKE_PASSWORD\s*=\s*\S+/i },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { label: "cookie", pattern: /\b(?:session|cookie)\s*[:=]\s*[A-Za-z0-9._=-]{16,}/i },
  { label: "raw prompt or response", pattern: /\b(prompt|rawResponse|fullReviewText|attachmentContent)\b/i },
  { label: "private task title marker", pattern: /task title may contain private content/i },
];

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm experience:review:validate <product-experience-review-record.md|txt>");
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
    console.error(`product experience review validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("product experience review validation passed: required journeys, viewports, UX gates, residual ID, and safety facts are present.");
  console.log(`productExperienceReviewEvidenceHash: ${buildEvidenceHash(fields)}`);
  console.log("safetyFacts: productionWriteAttempted=false serverCommandAttempted=false destructiveActionAttempted=false secretValuePrinted=false realStudyContentIncluded=false");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireOneOf(fields, "environment", ["local", "staging", "production"], issues);
  requireOneOf(fields, "reviewStatus", ["pass", "fail"], issues);
  for (const field of yesNoFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
  }

  const baseUrl = fields.get("baseUrl");
  if (baseUrl && !/^https?:\/\/[^ \n]+$/i.test(baseUrl)) {
    issues.push({ field: "baseUrl", message: "must be an http or https URL" });
  }

  const reviewHash = fields.get("reviewResultHash");
  if (reviewHash && !/^(sha256:)?[a-f0-9]{64}$/i.test(reviewHash)) {
    issues.push({ field: "reviewResultHash", message: "must be a 64-character sha256 hex digest with optional sha256: prefix" });
  }

  const command = fields.get("reviewCommand") ?? "";
  if (!/(pnpm smoke:local-ux|pnpm smoke:prod-readonly|playwright|browser review|manual-browser-review)/i.test(command)) {
    issues.push({ field: "reviewCommand", message: "must reference local/prod smoke, Playwright, or an explicit browser review" });
  }

  if (fields.get("reviewStatus")?.toLowerCase() !== "pass") {
    issues.push({ field: "reviewStatus", message: "must be pass to close AF-RISK-UX-001" });
  }

  const viewports = parseList(fields.get("viewports") ?? "");
  const missingViewports = requiredViewports.filter((viewport) => !viewports.includes(viewport));
  if (missingViewports.length > 0) {
    issues.push({ field: "viewports", message: `missing ${missingViewports.join(", ")}` });
  }

  const journeys = parseList(fields.get("journeys") ?? "");
  const missingJourneys = requiredJourneys.filter((journey) => !journeys.includes(journey));
  if (missingJourneys.length > 0) {
    issues.push({ field: "journeys", message: `missing ${missingJourneys.join(", ")}` });
  }

  const screenshotEvidence = fields.get("screenshotEvidence")?.toLowerCase() ?? "";
  if (!screenshotEvidence.includes("desktop") || !screenshotEvidence.includes("mobile")) {
    issues.push({ field: "screenshotEvidence", message: "must include desktop and mobile/narrow screenshot or browser observation references" });
  }
  if (/\bnone\b|not-captured|missing/i.test(screenshotEvidence)) {
    issues.push({ field: "screenshotEvidence", message: "must not be none, missing, or not-captured" });
  }

  for (const field of [
    "nextActionWithin5s",
    "recommendationsExplainWhy",
    "confirmOnlyBoundariesVisible",
    "recoveryPathVisible",
    "mobileReadable",
    "emptyUnauthorizedErrorStatesChecked",
  ] as const) {
    if (fields.get(field)?.toLowerCase() !== "yes") {
      issues.push({ field, message: "must be yes for AF-RISK-UX-001 closure evidence" });
    }
  }

  if (!fields.get("residualRiskIds")?.includes("AF-RISK-UX-001")) {
    issues.push({ field: "residualRiskIds", message: "must include AF-RISK-UX-001" });
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

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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
