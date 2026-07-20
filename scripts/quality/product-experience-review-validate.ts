import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  canonicalSha256,
  computeProductExperienceSourceHash,
  currentGitCommit,
  findWorkspaceRoot,
} from "./product-experience-source";
import { validateRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";
import { resolveProductExperienceReviewPath } from "./product-experience-review-discovery";
import { evaluateReleaseCloseoutBinding } from "./release-closeout-binding";

export interface ValidationIssue {
  field: string;
  message: string;
}

export type ProductExperienceEvidenceStatus = "fresh" | "stale" | "invalid" | "missing";

export type ProductExperienceEvidenceEvaluation = {
  status: ProductExperienceEvidenceStatus;
  recordPathLabel: string | null;
  recordSha256: string | null;
  reviewedAt: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number;
  appVersion: string | null;
  expectedVersion: string;
  detail: string;
  issueFields: string[];
  command: string;
};

type ValidateRecordOptions = {
  shapeOnly: boolean;
  root: string;
  now: Date;
  checkFreshness: boolean;
};

type EvaluateOptions = {
  root?: string;
  configuredPath?: string;
  now?: Date;
  maxAgeSeconds?: number;
  expectedVersion?: string;
};

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

const requiredBindingFields = [
  "gitCommit",
  "sourceFingerprintSchema",
  "productExperienceSourceHash",
  "runtimeIdentityEvidence",
  "runtimeIdentityEvidenceHash",
  "runtimeIdentityHash",
  "screenshotEvidenceHash",
] as const;

export const defaultReviewMaxAgeSeconds = 14 * 24 * 60 * 60;
const reviewFutureSkewSeconds = 300;
const runtimeEvidenceMaxLeadSeconds = 30 * 60;

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
  const root = findWorkspaceRoot();
  if (process.argv.includes("--print-current-binding")) {
    const binding = currentBinding(root);
    console.log(`appVersion: ${binding.appVersion}`);
    console.log(`gitCommit: ${binding.gitCommit}`);
    console.log(`sourceFingerprintSchema: ${PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA}`);
    console.log(`productExperienceSourceHash: ${binding.sourceHash}`);
    return;
  }
  const recordPath = process.argv[2];
  const shapeOnly = process.argv.includes("--shape-only");
  const printRecordHashes = process.argv.includes("--print-record-hashes");
  if (!recordPath) {
    console.error("Usage: pnpm experience:review:validate <product-experience-review-record.md|txt>");
    process.exit(2);
  }

  const absoluteRecordPath = path.resolve(recordPath);
  const record = readRequiredFile(absoluteRecordPath);
  const fields = parseIndentedKeyValueRecord(record);
  if (printRecordHashes) {
    const issues: ValidationIssue[] = [];
    const runtimeBinding = buildRuntimeEvidenceBinding(fields, issues, false, root);
    const screenshotHash = buildScreenshotEvidenceHash(fields, issues, root);
    if (!runtimeBinding || !screenshotHash || issues.length > 0) {
      for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
      process.exit(1);
    }
    fields.set("runtimeIdentityEvidenceHash", runtimeBinding.evidenceHash);
    fields.set("runtimeIdentityHash", runtimeBinding.identityHash);
    fields.set("screenshotEvidenceHash", screenshotHash);
    console.log(`runtimeIdentityEvidenceHash: ${runtimeBinding.evidenceHash}`);
    console.log(`runtimeIdentityHash: ${runtimeBinding.identityHash}`);
    console.log(`screenshotEvidenceHash: ${screenshotHash}`);
    console.log(`reviewResultHash: ${buildEvidenceHash(fields)}`);
    return;
  }
  const issues = validateProductExperienceReviewRecord(record, fields, {
    shapeOnly,
    root,
    now: new Date(),
    checkFreshness: true,
  });

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`product experience review validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log(shapeOnly
    ? "product experience review shape validation passed: historical record structure is valid but does not prove current checkout UX."
    : "product experience review validation passed: current checkout binding, required journeys, viewports, UX gates, residual ID, and safety facts are present.");
  console.log(`bindingStatus: ${shapeOnly ? "shape-only" : "current"}`);
  if (!shapeOnly) console.log(`reviewFreshnessStatus: fresh maxAgeSeconds=${reviewMaxAgeSeconds()}`);
  console.log(`productExperienceReviewEvidenceHash: ${buildEvidenceHash(fields)}`);
  console.log("safetyFacts: productionWriteAttempted=false serverCommandAttempted=false destructiveActionAttempted=false secretValuePrinted=false realStudyContentIncluded=false");
}

export function validateProductExperienceReviewRecord(
  record: string,
  fields: Map<string, string>,
  options: ValidateRecordOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { shapeOnly, root, now, checkFreshness } = options;

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }
  if (!shapeOnly) {
    for (const field of requiredBindingFields) requireField(fields, field, issues);
  }

  requireOneOf(fields, "environment", ["local", "staging", "production"], issues);
  requireOneOf(fields, "reviewStatus", ["pass", "fail"], issues);
  validateReviewTimestamp(fields, issues, { shapeOnly, now, checkFreshness });
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

  if (!shapeOnly) {
    validateCurrentBinding(fields, issues, root);
    buildRuntimeEvidenceBinding(fields, issues, true, root);
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
  if (!shapeOnly) {
    const screenshotHash = buildScreenshotEvidenceHash(fields, issues, root);
    if (screenshotHash && fields.get("screenshotEvidenceHash") !== screenshotHash) {
      issues.push({ field: "screenshotEvidenceHash", message: "must bind the current screenshot evidence files and paths" });
    }
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

  if (!shapeOnly && reviewHash && reviewHash !== buildEvidenceHash(fields)) {
    issues.push({ field: "reviewResultHash", message: "must match the canonical current review record projection" });
  }

  return issues;
}

function validateCurrentBinding(fields: Map<string, string>, issues: ValidationIssue[], root: string): void {
  const binding = currentBinding(root);
  if (fields.get("appVersion") !== binding.appVersion) {
    issues.push({ field: "appVersion", message: `must match current package version ${binding.appVersion}` });
  }
  const recordGitCommit = fields.get("gitCommit") ?? "";
  if (recordGitCommit !== binding.gitCommit) {
    const closeout = evaluateReleaseCloseoutBinding({
      root,
      releaseGitCommit: recordGitCommit,
      currentGitCommit: binding.gitCommit,
      requireCleanWorktree: false,
    });
    if (closeout.status !== "evidence_only") {
      issues.push({
        field: "gitCommit",
        message: `must match current checkout or an evidence-only ancestor: ${closeout.issues.join(", ") || closeout.status}`,
      });
    }
  }
  if (fields.get("sourceFingerprintSchema") !== PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA) {
    issues.push({ field: "sourceFingerprintSchema", message: `must be ${PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA}` });
  }
  if (fields.get("productExperienceSourceHash") !== binding.sourceHash) {
    issues.push({ field: "productExperienceSourceHash", message: "must match the current product experience source fingerprint" });
  }
}

function validateReviewTimestamp(
  fields: Map<string, string>,
  issues: ValidationIssue[],
  options: { shapeOnly: boolean; now: Date; checkFreshness: boolean },
): void {
  const value = fields.get("reviewedAt");
  if (!value) return;
  const reviewedAt = Date.parse(value);
  if (Number.isNaN(reviewedAt)) {
    issues.push({ field: "reviewedAt", message: "must be an ISO-8601 timestamp" });
    return;
  }
  if (options.shapeOnly) return;
  const ageSeconds = Math.floor((options.now.getTime() - reviewedAt) / 1000);
  if (ageSeconds < -reviewFutureSkewSeconds) {
    issues.push({ field: "reviewedAt", message: `must not be more than ${reviewFutureSkewSeconds} seconds in the future` });
  }
  if (options.checkFreshness && ageSeconds > reviewMaxAgeSeconds()) {
    issues.push({ field: "reviewedAt", message: `is stale; maximum age is ${reviewMaxAgeSeconds()} seconds` });
  }
}

function reviewMaxAgeSeconds(): number {
  return defaultReviewMaxAgeSeconds;
}

function currentBinding(root: string): { appVersion: string; gitCommit: string; sourceHash: string } {
  const packageJson = JSON.parse(readFileSync(path.resolve(root, "package.json"), "utf8")) as { version?: string };
  return {
    appVersion: packageJson.version ?? "unknown",
    gitCommit: currentGitCommit(root),
    sourceHash: computeProductExperienceSourceHash(root),
  };
}

function buildRuntimeEvidenceBinding(
  fields: Map<string, string>,
  issues: ValidationIssue[],
  compareCurrent: boolean,
  root: string,
): { evidenceHash: string; identityHash: string } | null {
  const evidencePath = fields.get("runtimeIdentityEvidence");
  if (!evidencePath) return null;
  const absolutePath = resolveRepoEvidencePath(root, evidencePath, ".json");
  if (!absolutePath) {
    issues.push({ field: "runtimeIdentityEvidence", message: "must be a repo-relative regular non-symlink JSON file" });
    return null;
  }
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;
  } catch {
    issues.push({ field: "runtimeIdentityEvidence", message: "must contain valid JSON" });
    return null;
  }
  const expectedKeys = ["baseUrl", "observedAt", "responseHash", "runtimeIdentity", "safetyFacts", "schemaVersion"].sort();
  if (Object.keys(value).sort().join(",") !== expectedKeys.join(",") || value.schemaVersion !== 1) {
    issues.push({ field: "runtimeIdentityEvidence", message: "must use exact probe schema V1" });
    return null;
  }
  const baseUrl = normalizedReviewBaseUrl(fields, issues);
  if (!baseUrl || value.baseUrl !== baseUrl) issues.push({ field: "runtimeIdentityEvidence", message: "baseUrl must match the review record" });
  const safety = value.safetyFacts as Record<string, unknown> | undefined;
  if (!safety || safety.requestMethod !== "GET" || safety.productionWriteAttempted !== false || safety.serverCommandAttempted !== false || safety.secretValueIncluded !== false) {
    issues.push({ field: "runtimeIdentityEvidence", message: "must retain read-only no-secret safety facts" });
  }
  let identity;
  try {
    identity = validateRuntimeIdentity(value.runtimeIdentity);
  } catch (error) {
    issues.push({ field: "runtimeIdentityEvidence", message: error instanceof Error ? error.message : "runtime identity is invalid" });
    return null;
  }
  const expectedResponseHash = canonicalSha256({ ok: true, service: "AreaForge", version: identity.appVersion, runtimeIdentity: identity });
  if (value.responseHash !== expectedResponseHash) issues.push({ field: "runtimeIdentityEvidence", message: "responseHash does not match runtime identity" });
  validateRuntimeEvidenceTime(fields.get("reviewedAt"), value.observedAt, identity.observedAt, issues);
  if (compareCurrent) {
    const binding = currentBinding(root);
    if (identity.appVersion !== binding.appVersion || identity.appVersion !== fields.get("appVersion")) issues.push({ field: "runtimeIdentityHash", message: "runtime appVersion must match record and checkout" });
    if (identity.gitCommit !== fields.get("gitCommit")) issues.push({ field: "runtimeIdentityHash", message: "runtime gitCommit must match the review source commit" });
    if (identity.sourceFingerprintSchema !== PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA || identity.sourceFingerprintSchema !== fields.get("sourceFingerprintSchema")) issues.push({ field: "runtimeIdentityHash", message: "runtime source schema must match record and checkout" });
    if (identity.productExperienceSourceHash !== binding.sourceHash || identity.productExperienceSourceHash !== fields.get("productExperienceSourceHash")) issues.push({ field: "runtimeIdentityHash", message: "runtime source hash must match record and checkout" });
    if (fields.get("runtimeIdentityHash") !== identity.identityHash) issues.push({ field: "runtimeIdentityHash", message: "must match the probed runtime identity" });
  }
  const evidenceHash = `sha256:${createHash("sha256").update(readFileSync(absolutePath)).digest("hex")}`;
  if (compareCurrent && fields.get("runtimeIdentityEvidenceHash") !== evidenceHash) issues.push({ field: "runtimeIdentityEvidenceHash", message: "must bind the runtime identity evidence file" });
  return { evidenceHash, identityHash: identity.identityHash };
}

function normalizedReviewBaseUrl(fields: Map<string, string>, issues: ValidationIssue[]): string | null {
  const raw = fields.get("baseUrl");
  const environment = fields.get("environment");
  if (!raw || !environment) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    issues.push({ field: "baseUrl", message: "must be a valid URL" });
    return null;
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    issues.push({ field: "baseUrl", message: "must be an origin without credentials, path, query, or fragment" });
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (environment === "local" && (!local || !["http:", "https:"].includes(url.protocol))) {
    issues.push({ field: "baseUrl", message: "local reviews must use localhost, 127.0.0.1, or ::1" });
  }
  if (environment === "production" && url.origin !== "https://forge.areasong.top") {
    issues.push({ field: "baseUrl", message: "production reviews must use https://forge.areasong.top" });
  }
  if (environment === "staging") {
    const allowed = (process.env.AREAFORGE_EXPERIENCE_STAGING_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!allowed.includes(url.origin)) issues.push({ field: "baseUrl", message: "staging origin is not explicitly allowed" });
  }
  return url.origin;
}

function validateRuntimeEvidenceTime(reviewedAt: string | undefined, probedAt: unknown, runtimeObservedAt: string, issues: ValidationIssue[]): void {
  const review = reviewedAt ? Date.parse(reviewedAt) : Number.NaN;
  const probe = typeof probedAt === "string" ? Date.parse(probedAt) : Number.NaN;
  const runtime = Date.parse(runtimeObservedAt);
  if (Number.isNaN(probe)) issues.push({ field: "runtimeIdentityEvidence", message: "probe observedAt must be ISO-8601" });
  if (!Number.isNaN(probe) && !Number.isNaN(runtime) && Math.abs(probe - runtime) > 60_000) issues.push({ field: "runtimeIdentityEvidence", message: "probe and runtime observations must be within 60 seconds" });
  if (!Number.isNaN(review) && !Number.isNaN(probe) && (probe > review + reviewFutureSkewSeconds * 1000 || review - probe > runtimeEvidenceMaxLeadSeconds * 1000)) {
    issues.push({ field: "runtimeIdentityEvidence", message: "runtime probe must be within 30 minutes before the review and not more than 300 seconds after it" });
  }
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
    ...requiredBindingFields,
    ...requiredNestedFields,
  ].filter((key, index, array) => key !== "reviewResultHash" && array.indexOf(key) === index).sort();
  const bundle = keys.map((key) => [key, fields.get(key) ?? ""]);
  const hash = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return `sha256:${hash}`;
}

function buildScreenshotEvidenceHash(fields: Map<string, string>, issues: ValidationIssue[], root: string): string | null {
  const raw = fields.get("screenshotEvidence") ?? "";
  const entries: Array<{ viewport: string; evidencePath: string; sha256: string }> = [];
  const seenViewports = new Set<string>();
  const segments = raw.split(";").map((item) => item.trim()).filter(Boolean);

  for (const segment of segments) {
    const separator = segment.indexOf("=");
    if (separator <= 0) {
      issues.push({ field: "screenshotEvidence", message: `invalid evidence segment ${segment}` });
      continue;
    }
    const viewport = segment.slice(0, separator).trim().toLowerCase();
    if (!requiredViewports.includes(viewport)) {
      issues.push({ field: "screenshotEvidence", message: `unsupported viewport label ${viewport}` });
      continue;
    }
    seenViewports.add(viewport);
    const evidencePaths = segment.slice(separator + 1).split(",").map((item) => item.trim()).filter(Boolean);
    if (evidencePaths.length === 0) {
      issues.push({ field: "screenshotEvidence", message: `${viewport} must include at least one file` });
      continue;
    }
    for (const evidencePath of evidencePaths) {
      const absolutePath = resolveScreenshotPath(root, evidencePath);
      if (!absolutePath) {
        issues.push({ field: "screenshotEvidence", message: `unsafe evidence path ${evidencePath}` });
        continue;
      }
      if (!existsSync(absolutePath)) {
        issues.push({ field: "screenshotEvidence", message: `evidence file does not exist: ${evidencePath}` });
        continue;
      }
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        issues.push({ field: "screenshotEvidence", message: `evidence must be a regular non-symlink file: ${evidencePath}` });
        continue;
      }
      if (stat.size <= 0 || stat.size > 20 * 1024 * 1024) {
        issues.push({ field: "screenshotEvidence", message: `evidence file size is outside 1..20971520 bytes: ${evidencePath}` });
        continue;
      }
      if (!/\.(?:png|jpe?g|webp)$/i.test(absolutePath)) {
        issues.push({ field: "screenshotEvidence", message: `evidence file must be PNG, JPEG, or WebP: ${evidencePath}` });
        continue;
      }
      entries.push({
        viewport,
        evidencePath,
        sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
      });
    }
  }

  for (const viewport of requiredViewports) {
    if (!seenViewports.has(viewport)) {
      issues.push({ field: "screenshotEvidence", message: `missing ${viewport} evidence files` });
    }
  }
  if (issues.some((issue) => issue.field === "screenshotEvidence")) return null;
  entries.sort((left, right) => `${left.viewport}:${left.evidencePath}`.localeCompare(`${right.viewport}:${right.evidencePath}`));
  return `sha256:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
}

function resolveScreenshotPath(root: string, evidencePath: string): string | null {
  const absolutePath = resolveRepoEvidencePath(root, evidencePath);
  return absolutePath && /\.(?:png|jpe?g|webp)$/i.test(absolutePath) ? absolutePath : null;
}

function resolveRepoEvidencePath(root: string, evidencePath: string, extension?: string): string | null {
  if (path.isAbsolute(evidencePath)) return null;
  const absolutePath = path.resolve(root, evidencePath);
  if (!isWithin(root, absolutePath) || (extension && path.extname(absolutePath) !== extension)) return null;
  let current = root;
  for (const part of path.relative(root, absolutePath).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) return null;
  }
  if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) return null;
  const real = realpathSync(absolutePath);
  if (!isWithin(realpathSync(root), real)) return null;
  return absolutePath;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  return readFileSync(filePath, "utf8");
}

export function evaluateProductExperienceEvidence(options: EvaluateOptions = {}): ProductExperienceEvidenceEvaluation {
  const root = path.resolve(options.root ?? findWorkspaceRoot());
  const now = options.now ?? new Date();
  const maxAgeSeconds = validMaxAge(options.maxAgeSeconds);
  const resolved = resolveProductExperienceReviewPath(root, options.configuredPath);
  const recordPath = resolved ? (path.isAbsolute(resolved) ? resolved : path.resolve(root, resolved)) : null;
  const recordPathLabel = recordPath ? path.basename(recordPath) : null;
  const repoRelativeRecordPath = recordPath && isWithin(root, recordPath)
    ? path.relative(root, recordPath).split(path.sep).join("/")
    : null;
  const command = repoRelativeRecordPath
    ? `pnpm experience:review:validate ${JSON.stringify(repoRelativeRecordPath)}`
    : "pnpm experience:review:validate <current-product-experience-review.md|txt>";
  const expectedVersion = options.expectedVersion?.trim() || expectedVersionFromRoot(root);
  const base = {
    recordPathLabel,
    maxAgeSeconds,
    expectedVersion,
    command,
  };

  if (recordPath && !isWithin(root, recordPath)) {
    return {
      ...base,
      status: "invalid",
      recordSha256: null,
      reviewedAt: null,
      ageSeconds: null,
      appVersion: null,
      detail: "product experience review record must remain inside the workspace",
      issueFields: ["recordPath"],
    };
  }

  if (!recordPath || !existsSync(recordPath)) {
    return {
      ...base,
      status: "missing",
      recordSha256: null,
      reviewedAt: null,
      ageSeconds: null,
      appVersion: null,
      detail: "product experience review record is missing",
      issueFields: ["record"],
    };
  }

  let record: string;
  try {
    const safeRecordPath = resolveRepoEvidencePath(root, path.relative(root, recordPath));
    if (!safeRecordPath) throw new Error("record must be a regular workspace file without symlink traversal");
    record = readFileSync(safeRecordPath, "utf8");
  } catch (error) {
    return {
      ...base,
      status: "invalid",
      recordSha256: null,
      reviewedAt: null,
      ageSeconds: null,
      appVersion: null,
      detail: error instanceof Error ? error.message : "product experience review record is unreadable",
      issueFields: ["record"],
    };
  }

  const fields = parseIndentedKeyValueRecord(record);
  const reviewedAt = fields.get("reviewedAt") ?? null;
  const appVersion = fields.get("appVersion") ?? null;
  const recordSha256 = `sha256:${createHash("sha256").update(record).digest("hex")}`;
  const reviewedAtMs = reviewedAt ? Date.parse(reviewedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(reviewedAtMs)
    ? Math.max(0, Math.floor((now.getTime() - reviewedAtMs) / 1000))
    : null;
  let issues: ValidationIssue[];
  try {
    issues = validateProductExperienceReviewRecord(record, fields, {
      shapeOnly: false,
      root,
      now,
      checkFreshness: false,
    });
    if (appVersion !== expectedVersion) {
      issues.push({ field: "appVersion", message: `must match expected gate version ${expectedVersion}` });
    }
  } catch (error) {
    return {
      ...base,
      status: "invalid",
      recordSha256,
      reviewedAt,
      ageSeconds,
      appVersion,
      detail: error instanceof Error ? error.message.replaceAll(root, "<workspace>") : "current UX binding is unavailable",
      issueFields: ["currentBinding"],
    };
  }

  if (issues.length > 0) {
    return {
      ...base,
      status: "invalid",
      recordSha256,
      reviewedAt,
      ageSeconds,
      appVersion,
      detail: summarizeIssues(issues, root),
      issueFields: [...new Set(issues.map((issue) => issue.field))].sort(),
    };
  }

  if (ageSeconds === null) {
    return {
      ...base,
      status: "invalid",
      recordSha256,
      reviewedAt,
      ageSeconds: null,
      appVersion,
      detail: "reviewedAt is not a valid ISO-8601 timestamp",
      issueFields: ["reviewedAt"],
    };
  }

  if (ageSeconds > maxAgeSeconds) {
    return {
      ...base,
      status: "stale",
      recordSha256,
      reviewedAt,
      ageSeconds,
      appVersion,
      detail: `review is ${ageSeconds} seconds old; max allowed is ${maxAgeSeconds} seconds`,
      issueFields: ["reviewedAt"],
    };
  }

  return {
    ...base,
    status: "fresh",
    recordSha256,
    reviewedAt,
    ageSeconds,
    appVersion,
    detail: `validator passed; appVersion=${expectedVersion}; ageSeconds=${ageSeconds}`,
    issueFields: [],
  };
}

function expectedVersionFromRoot(root: string): string {
  try {
    const packageJson = JSON.parse(readFileSync(path.resolve(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

function validMaxAge(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : defaultReviewMaxAgeSeconds;
}

function summarizeIssues(issues: ValidationIssue[], root: string): string {
  return issues.slice(0, 4).map((issue) => `${issue.field}: ${issue.message}`)
    .join("; ")
    .replaceAll(root, "<workspace>")
    .replace(/\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, "<redacted-token>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
