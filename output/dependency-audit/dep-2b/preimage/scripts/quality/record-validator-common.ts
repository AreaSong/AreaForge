import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export interface ValidationIssue {
  field: string;
  message: string;
}

export const commonSecretPatterns = [
  { label: "DATABASE_URL", pattern: /postgres(?:ql)?:\/\/[^ \n]+/i },
  { label: "API key", pattern: /\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/ },
  { label: "AUTH_SESSION_SECRET", pattern: /AUTH_SESSION_SECRET\s*=\s*\S+/i },
  { label: "AI_API_KEY", pattern: /AI_API_KEY\s*=\s*\S+/i },
  { label: "smoke password env value", pattern: /\bAREAFORGE_SMOKE_PASSWORD\s*=\s*\S+/i },
  { label: "password env value", pattern: /\b(?:POSTGRES_PASSWORD|COSIGN_PASSWORD|GITHUB_TOKEN)\s*=\s*\S+/i },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { label: "cookie", pattern: /\b(?:session|cookie)\s*[:=]\s*[A-Za-z0-9._=-]{16,}/i },
  { label: "raw prompt or response", pattern: /\b(prompt|rawResponse|fullReviewText|attachmentContent)\b/i },
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export function parseIndentedKeyValueRecord(record: string): Map<string, string> {
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

export function parseStrictIndentedKeyValueRecord(
  record: string,
  issues: ValidationIssue[],
): Map<string, string> {
  const fields = new Map<string, string>();
  let currentSection = "";

  for (const [index, rawLine] of record.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    if (rawLine.includes("\t")) {
      issues.push({ field: `record.line${lineNumber}`, message: "tabs are not allowed" });
      continue;
    }
    const match = rawLine.match(/^( *)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) {
      issues.push({ field: `record.line${lineNumber}`, message: "must be a key/value field or comment" });
      continue;
    }

    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    const value = match[3]?.trim() ?? "";
    let fullKey: string;
    if (indent === 0) {
      currentSection = value ? "" : key;
      fullKey = key;
    } else if (indent === 2 && currentSection) {
      fullKey = `${currentSection}.${key}`;
    } else {
      issues.push({ field: `record.line${lineNumber}`, message: "nested fields require exactly two spaces under a section" });
      continue;
    }

    if (fields.has(fullKey)) {
      issues.push({ field: fullKey, message: `duplicate field at line ${lineNumber}` });
      continue;
    }
    fields.set(fullKey, value);
  }

  return fields;
}

export function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  return readFileSync(filePath, "utf8");
}

export function requireField(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field);
  if (!value || value.trim().length === 0) {
    issues.push({ field, message: "is required" });
  }
}

export function requireOneOf(
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

export function requireSha256(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field);
  if (value && !/^(sha256:)?[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be a 64-character sha256 hex digest with optional sha256: prefix" });
  }
}

export function requireIsoTimestamp(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field);
  if (value && Number.isNaN(Date.parse(value))) {
    issues.push({ field, message: "must be an ISO-8601 timestamp" });
  }
}

export function requireNo(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  if (fields.get(field)?.toLowerCase() !== "no") {
    issues.push({ field, message: "must be no" });
  }
}

export function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseLowerList(value: string): string[] {
  return parseList(value).map((item) => item.toLowerCase());
}

export function scanForSecrets(record: string, issues: ValidationIssue[], patterns = commonSecretPatterns): void {
  for (const item of patterns) {
    if (item.pattern.test(record)) {
      issues.push({ field: "record", message: `must not contain ${item.label}` });
    }
  }
}

export function buildEvidenceHash(fields: Map<string, string>, keys: readonly string[]): string {
  const bundle = [...new Set(keys)].sort().map((key) => [key, fields.get(key) ?? ""]);
  const hash = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return `sha256:${hash}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
