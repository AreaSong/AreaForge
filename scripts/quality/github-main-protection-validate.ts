import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type ValidationIssue = { field: string; message: string };
export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
  readbackHash?: string;
  evidenceHash?: string;
  freshness?: { status: "fresh" | "stale" | "future"; ageSeconds: number; maxAgeSeconds: number };
  maintenanceWindowId?: string;
};

const READBACK_KEYS = [
  "schemaVersion", "repository", "branch", "sourceKind", "observedAt", "maintenanceWindowId",
  "requiredPullRequest", "requiredApprovingReviewCount", "requiredStatusChecks", "enforceAdmins",
  "allowForcePushes", "allowDeletions", "adminBypassActors", "redaction", "readbackHash",
];
const PR_KEYS = [
  "schemaVersion", "repository", "branch", "observedAt", "maintenanceWindowId", "prUrl", "prNumber", "headSha",
  "failedRequiredCheck", "failedCheckConclusion", "failedCheckRunUrl", "passingRequiredCheck", "passingCheckConclusion",
  "passingCheckRunUrl", "failureOutcome", "successOutcome", "prMerged", "secretValuesPresent", "evidenceHash",
];
const COMMON_SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']+/i,
  /\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/,
  /(?:AUTH_SESSION_SECRET|AI_API_KEY|GITHUB_TOKEN|AREAFORGE_SMOKE_PASSWORD)\s*[=:]\s*[^\s"']+/i,
  /Bearer\s+[A-Za-z0-9._-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_PATH_TERMS = /(?:\.env|secret|token|password|private|key|dump|archive|backup|upload)/i;

export type SafeJsonFile = { path: string; raw: string };

export function projectRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
}

export function readSafeJsonFile(inputPath: string, root = projectRoot()): SafeJsonFile {
  const resolved = path.resolve(inputPath);
  if (path.extname(resolved) !== ".json") throw new Error("evidence path must end with .json");
  if (FORBIDDEN_PATH_TERMS.test(resolved)) throw new Error("evidence path contains a forbidden term");
  const allowedRoots = [path.resolve(root), path.resolve(tmpdir())];
  if (!allowedRoots.some((allowedRoot) => isWithin(allowedRoot, resolved))) throw new Error("evidence path is outside the project or temporary directory");
  let realAllowedRoots: string[];
  try { realAllowedRoots = allowedRoots.map((allowedRoot) => realpathSync(allowedRoot)); } catch { throw new Error("allowed evidence root could not be resolved"); }
  try { rejectSymlinkedPath(resolved, allowedRoots, realAllowedRoots); } catch (error) {
    if (error instanceof Error && error.message.startsWith("evidence ")) throw error;
    throw new Error("evidence path could not be safely inspected");
  }
  let before;
  try { before = lstatSync(resolved); } catch { throw new Error("evidence path could not be safely inspected"); }
  if (!before.isFile()) throw new Error("evidence path must be a regular file");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("evidence file changed during safe open");
    if (opened.size > MAX_RECORD_BYTES) throw new Error("evidence file exceeds 2MB");
    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = fstatSync(descriptor);
    if (offset !== buffer.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error("evidence file changed while being read");
    }
    return { path: resolved, raw: buffer.toString("utf8") };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("evidence ")) throw error;
    throw new Error("evidence file could not be safely opened");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function validateReadback(raw: string, now = Date.now(), maxAgeSeconds = configuredMaxAge()): ValidationResult {
  const issues: ValidationIssue[] = [];
  const value = parseJson(raw, issues);
  if (!isRecord(value)) return finish(issues, raw);
  exactKeys(value, READBACK_KEYS, "readback", issues);
  if (value.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (value.repository !== "AreaSong/AreaForge") issues.push({ field: "repository", message: "must be AreaSong/AreaForge" });
  if (value.branch !== "main") issues.push({ field: "branch", message: "must be main" });
  if (value.sourceKind !== "branch_protection" && value.sourceKind !== "ruleset" && value.sourceKind !== "combined") {
    issues.push({ field: "sourceKind", message: "must be branch_protection, ruleset, or combined" });
  }
  const observedAt = requireTimestamp(value.observedAt, "observedAt", issues);
  const freshness = observedAt === undefined ? undefined : checkFreshness(observedAt, now, maxAgeSeconds, issues);
  if (typeof value.maintenanceWindowId !== "string" || value.maintenanceWindowId.trim() === "") {
    issues.push({ field: "maintenanceWindowId", message: "must be a non-empty string" });
  }
  if (value.requiredPullRequest !== true) issues.push({ field: "requiredPullRequest", message: "must be true" });
  if (typeof value.requiredApprovingReviewCount !== "number" || !Number.isInteger(value.requiredApprovingReviewCount) || value.requiredApprovingReviewCount < 1) {
    issues.push({ field: "requiredApprovingReviewCount", message: "must be an integer >= 1" });
  }
  if (!Array.isArray(value.requiredStatusChecks) || value.requiredStatusChecks.length !== 1 || value.requiredStatusChecks[0] !== "ci / verify") {
    issues.push({ field: "requiredStatusChecks", message: "must be exactly [\"ci / verify\"]" });
  }
  for (const key of ["enforceAdmins", "allowForcePushes", "allowDeletions"] as const) {
    if (typeof value[key] !== "boolean") issues.push({ field: key, message: "must be boolean" });
  }
  if (value.enforceAdmins !== true) issues.push({ field: "enforceAdmins", message: "must be true" });
  if (value.allowForcePushes !== false) issues.push({ field: "allowForcePushes", message: "must be false" });
  if (value.allowDeletions !== false) issues.push({ field: "allowDeletions", message: "must be false" });
  if (!Array.isArray(value.adminBypassActors) || value.adminBypassActors.length !== 0) {
    issues.push({ field: "adminBypassActors", message: "must be an empty array" });
  }
  validateRedaction(value.redaction, issues);
  validateHash(value, "readbackHash", issues, canonicalHash(value, "readbackHash"));
  scanSecrets(raw, issues);
  return finish(issues, raw, value.readbackHash, undefined, freshness, stringValue(value.maintenanceWindowId));
}

export function validateControlledPr(raw: string, now = Date.now(), maxAgeSeconds = configuredMaxAge()): ValidationResult {
  const issues: ValidationIssue[] = [];
  const value = parseJson(raw, issues);
  if (!isRecord(value)) return finish(issues, raw);
  exactKeys(value, PR_KEYS, "controlledPr", issues);
  if (value.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (value.repository !== "AreaSong/AreaForge") issues.push({ field: "repository", message: "must be AreaSong/AreaForge" });
  if (value.branch !== "main") issues.push({ field: "branch", message: "must be main" });
  const observedAt = requireTimestamp(value.observedAt, "observedAt", issues);
  const freshness = observedAt === undefined ? undefined : checkFreshness(observedAt, now, maxAgeSeconds, issues);
  for (const key of ["maintenanceWindowId", "prUrl", "headSha", "failedRequiredCheck", "failedCheckRunUrl", "passingRequiredCheck", "passingCheckRunUrl"] as const) {
    if (typeof value[key] !== "string" || value[key].trim() === "") issues.push({ field: key, message: "must be a non-empty string" });
  }
  if (typeof value.prNumber !== "number" || !Number.isInteger(value.prNumber) || value.prNumber < 1) {
    issues.push({ field: "prNumber", message: "must be a positive integer" });
  }
  if (typeof value.prUrl === "string" && !/^https:\/\/github\.com\/AreaSong\/AreaForge\/pull\/\d+$/.test(value.prUrl)) {
    issues.push({ field: "prUrl", message: "must be an AreaSong/AreaForge pull request URL" });
  }
  if (typeof value.prNumber === "number" && typeof value.prUrl === "string" && !value.prUrl.endsWith(`/pull/${value.prNumber}`)) {
    issues.push({ field: "prUrl", message: "must match prNumber" });
  }
  if (typeof value.headSha !== "string" || !/^[a-f0-9]{40}$/.test(value.headSha)) {
    issues.push({ field: "headSha", message: "must be a 40-character lowercase commit SHA" });
  }
  if (value.failedRequiredCheck !== "ci / verify") {
    issues.push({ field: "failedRequiredCheck", message: "must be exactly ci / verify" });
  }
  if (value.passingRequiredCheck !== "ci / verify") {
    issues.push({ field: "passingRequiredCheck", message: "must be exactly ci / verify" });
  }
  if (value.failedCheckConclusion !== "failure") issues.push({ field: "failedCheckConclusion", message: "must be failure" });
  if (value.passingCheckConclusion !== "success") issues.push({ field: "passingCheckConclusion", message: "must be success" });
  for (const key of ["failedCheckRunUrl", "passingCheckRunUrl"] as const) {
    if (typeof value[key] === "string" && !/^https:\/\/github\.com\/AreaSong\/AreaForge\/actions\/runs\/\d+(?:\/job\/\d+)?$/.test(value[key])) {
      issues.push({ field: key, message: "must be an AreaSong/AreaForge Actions run or job URL" });
    }
  }
  if (value.failureOutcome !== "blocked") issues.push({ field: "failureOutcome", message: "must be blocked" });
  if (value.successOutcome !== "allowed") issues.push({ field: "successOutcome", message: "must be allowed" });
  if (value.prMerged !== false) issues.push({ field: "prMerged", message: "must be false" });
  if (value.secretValuesPresent !== false) issues.push({ field: "secretValuesPresent", message: "must be false" });
  validateHash(value, "evidenceHash", issues, canonicalHash(value, "evidenceHash"));
  scanSecrets(raw, issues);
  return finish(issues, raw, undefined, value.evidenceHash, freshness, stringValue(value.maintenanceWindowId));
}

export function configuredMaxAge(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AREAFORGE_SC004_MAX_AGE_SECONDS;
  if (raw === undefined || raw.trim() === "") return 24 * 60 * 60;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 60 || value > 604800) {
    throw new Error("AREAFORGE_SC004_MAX_AGE_SECONDS must be an integer from 60 to 604800");
  }
  return value;
}

function main(): void {
  const readbackPath = process.argv[2];
  const controlledPrPath = process.argv[3];
  if (!readbackPath || process.argv.length > 4) {
    console.error("Usage: pnpm exec tsx scripts/quality/github-main-protection-validate.ts <readback.json> [controlled-pr.json]");
    process.exit(2);
  }
  let maxAge: number;
  try { maxAge = configuredMaxAge(); } catch (error) { console.error(`FAIL configuration: ${String(error)}`); process.exit(2); }
  let readbackFile: SafeJsonFile;
  try { readbackFile = readSafeJsonFile(readbackPath); } catch (error) { console.error(`FAIL readback path: ${String(error)}`); process.exit(1); }
  const readback = validateReadback(readbackFile.raw, Date.now(), maxAge);
  const results = [readback];
  if (controlledPrPath) {
    let controlledPrFile: SafeJsonFile;
    try { controlledPrFile = readSafeJsonFile(controlledPrPath); } catch (error) { console.error(`FAIL controlled PR path: ${String(error)}`); process.exit(1); }
    results.push(validateControlledPr(controlledPrFile.raw, Date.now(), maxAge));
  }
  const issues = results.flatMap((result) => result.issues);
  if (readback.valid && controlledPrPath && readback.maintenanceWindowId !== results[1]?.maintenanceWindowId) {
    issues.push({ field: "maintenanceWindowId", message: "readback and controlled PR must use the same maintenance window" });
  }
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`github main protection validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("github main protection validation passed: local normalized evidence contract is valid.");
  console.log(`readbackEvidenceHash: ${readback.readbackHash}`);
  if (controlledPrPath) console.log(`controlledPrEvidenceHash: ${results[1]?.evidenceHash}`);
  console.log(`freshness: maxAgeSeconds=${maxAge}`);
}

function parseJson(raw: string, issues: ValidationIssue[]): unknown {
  try { return JSON.parse(raw); } catch { issues.push({ field: "record", message: "must be valid JSON" }); return undefined; }
}
function requireTimestamp(value: unknown, field: string, issues: ValidationIssue[]): number | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) { issues.push({ field, message: "must be an ISO-8601 timestamp" }); return undefined; }
  return Date.parse(value);
}
function checkFreshness(observedAt: number, now: number, maxAgeSeconds: number, issues: ValidationIssue[]): ValidationResult["freshness"] {
  const ageSeconds = Math.floor((now - observedAt) / 1000);
  if (ageSeconds < 0) { issues.push({ field: "observedAt", message: "must not be in the future" }); return { status: "future", ageSeconds, maxAgeSeconds }; }
  if (ageSeconds > maxAgeSeconds) { issues.push({ field: "observedAt", message: `is stale; age ${ageSeconds}s exceeds ${maxAgeSeconds}s` }); return { status: "stale", ageSeconds, maxAgeSeconds }; }
  return { status: "fresh", ageSeconds, maxAgeSeconds };
}
function validateRedaction(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) { issues.push({ field: "redaction", message: "must be an object" }); return; }
  exactKeys(value, ["secretsRemoved", "tokenRemoved"], "redaction", issues);
  if (value.secretsRemoved !== true) issues.push({ field: "redaction.secretsRemoved", message: "must be true" });
  if (value.tokenRemoved !== true) issues.push({ field: "redaction.tokenRemoved", message: "must be true" });
}
function validateHash(value: Record<string, unknown>, field: string, issues: ValidationIssue[], expected: string): void {
  if (typeof value[field] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value[field])) issues.push({ field, message: "must be sha256:<64 lowercase hex>" });
  else if (value[field] !== expected) issues.push({ field, message: "does not match canonical content" });
}
function scanSecrets(raw: string, issues: ValidationIssue[]): void {
  if (COMMON_SECRET_PATTERNS.some((pattern) => pattern.test(raw))) issues.push({ field: "record", message: "must not contain secret-like values" });
}
function exactKeys(value: Record<string, unknown>, expected: string[], field: string, issues: ValidationIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) issues.push({ field, message: `keys must be exactly ${expected.join(", ")}` });
}
function canonicalHash(value: Record<string, unknown>, hashField: string): string {
  const clone = { ...value, [hashField]: "" };
  return `sha256:${createHash("sha256").update(stableStringify(clone)).digest("hex")}`;
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function finish(issues: ValidationIssue[], _raw: string, readbackHash?: unknown, evidenceHash?: unknown, freshness?: ValidationResult["freshness"], maintenanceWindowId?: string): ValidationResult {
  return { valid: issues.length === 0, issues, readbackHash: typeof readbackHash === "string" ? readbackHash : undefined, evidenceHash: typeof evidenceHash === "string" ? evidenceHash : undefined, freshness, maintenanceWindowId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();

function rejectSymlinkedPath(resolved: string, allowedRoots: string[], realAllowedRoots: string[]): void {
  const root = allowedRoots.find((allowedRoot) => isWithin(allowedRoot, resolved));
  if (!root) throw new Error("evidence path is outside an allowed root");
  const relativeParts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("evidence path or parent directory is a symlink");
  }
  const real = realpathSync(resolved);
  if (!realAllowedRoots.some((allowedRoot) => isWithin(allowedRoot, real))) throw new Error("evidence realpath is outside an allowed root");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
