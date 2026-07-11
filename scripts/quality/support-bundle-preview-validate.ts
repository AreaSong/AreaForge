import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";

type JsonRecord = Record<string, unknown>;

const requiredExcludedContent = [
  "secret_values",
  "private_env",
  "database_dumps",
  "backup_archives",
  "upload_file_contents",
  "attachment_binary_or_text",
  "private_review_body",
  "motivation_or_emotion_records",
  "ai_context_text",
  "raw_logs",
  "session_tokens",
];

const requiredForbiddenActions = [
  "execute_server_command",
  "apply_update",
  "run_migration",
  "perform_backup",
  "perform_restore",
  "rollback_release",
  "write_database",
  "write_upload_directory",
  "read_or_print_secret_values",
  "export_support_bundle",
  "upload_remote_telemetry",
  "include_user_content",
  "create_github_release",
  "push_git_tag",
];
const requiredDoesNotProve = [
  "current production health",
  "updater apply completion",
  "backup, restore, migration, or rollback execution",
  "GitHub Release creation",
  "residual risk closure",
  "support bundle export",
  "operator approval for high-risk actions",
];

const falseSafetyFacts = [
  "supportBundleExported",
  "exportOpen",
  "networkRequested",
  "serverCommandAttempted",
  "backupRestoreAttempted",
  "migrationAttempted",
  "productionWriteAttempted",
  "secretValuePrinted",
  "secretValueIncluded",
  "privateEnvIncluded",
  "databaseDumpIncluded",
  "backupArchiveIncluded",
  "uploadFileContentIncluded",
  "attachmentContentIncluded",
  "aiContextIncluded",
  "rawLogIncluded",
  "gitPushAttempted",
  "tagPushed",
  "releaseCreated",
] as const;

function main(): void {
  const previewPath = process.argv[2];
  if (!previewPath) {
    console.error("Usage: pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(previewPath));
  const issues = validateSupportBundlePreview(raw);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`support bundle preview validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("support bundle preview validation passed: metadata-only scope, hash, doesNotProve, redaction, forbidden actions, and safety facts are present.");
  console.log(`supportBundlePreviewRecordHash: sha256:${sha256(extractJson(raw))}`);
  console.log("safetyFacts: readOnly=true metadataOnly=true supportBundleExported=false productionWriteAttempted=false secretValuePrinted=false");
}

export function validateSupportBundlePreview(raw: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parsePreview(raw, issues);
  if (!body) return issues;

  requireValue(body.schemaVersion, "schemaVersion", 1, issues);
  requireIso(body.generatedAt, "generatedAt", issues);
  requireValue(body.mode, "mode", "metadata_only_support_bundle_preview", issues);
  requireSha256Value(body.supportBundlePreviewHash, "supportBundlePreviewHash", issues);
  validateHash(body, issues);
  requireValue(body.purpose, "purpose", "public_support_or_operator_handoff", issues);
  requireValue(body.metadataOnly, "metadataOnly", true, issues);
  requireValue(body.exportOpen, "exportOpen", false, issues);
  validateApp(body.app, issues);
  validateArray(body.includedMetadata, "includedMetadata", [
    "app version and release tag",
    "residual risk IDs and close conditions",
  ], issues);
  validateArray(body.excludedSensitiveContent, "excludedSensitiveContent", requiredExcludedContent, issues);
  validateEvidencePointers(body.evidencePointers, issues);
  validateResiduals(body.residuals, issues);
  validateRecommendedCommands(body.recommendedNextCommands, issues);
  validateClaimBoundary(body.claimBoundary, issues);
  validateArray(body.doesNotProve, "doesNotProve", requiredDoesNotProve, issues);
  validateArray(body.forbiddenActions, "forbiddenActions", requiredForbiddenActions, issues);
  validateSafetyFacts(body.safetyFacts, issues);

  return issues;
}

function validateApp(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "app", message: "must be an object" });
    return;
  }
  requireString(value.name, "app.name", issues);
  requireString(value.version, "app.version", issues);
  requireString(value.onlineUrl, "app.onlineUrl", issues);
  requireString(value.releaseTag, "app.releaseTag", issues);
  requireValue(value.autoApplyDefault, "app.autoApplyDefault", "none", issues);
}

function validateEvidencePointers(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "evidencePointers", message: "must be an object" });
    return;
  }
  validateArray(value.docs, "evidencePointers.docs", [
    "SUPPORT.md",
    "docs/development/support-intake.md",
    "docs/development/residual-risk-ledger.md",
  ], issues);
  validateArray(value.commands, "evidencePointers.commands", [
    "pnpm ops:support:bundle-preview",
    "pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>",
    "pnpm ops:handoff",
    "pnpm ops:evidence:bundle",
  ], issues);
  const residualIds = Array.isArray(value.residualRiskIds) ? value.residualRiskIds : [];
  if (!residualIds.includes("AF-RISK-OPS-001")) {
    issues.push({ field: "evidencePointers.residualRiskIds", message: "must include AF-RISK-OPS-001" });
  }
}

function validateResiduals(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "residuals", message: "must be an object" });
    return;
  }
  requireValue(value.source, "residuals.source", "docs/development/residual-risk-ledger.json", issues);
  if (typeof value.total !== "number" || value.total < 1) {
    issues.push({ field: "residuals.total", message: "must be a positive number" });
  }
  if (!isRecord(value.countsByType)) {
    issues.push({ field: "residuals.countsByType", message: "must be an object" });
  }
  if (!Array.isArray(value.dueSoonOrExecutable)) {
    issues.push({ field: "residuals.dueSoonOrExecutable", message: "must be an array" });
  }
}

function validateRecommendedCommands(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "recommendedNextCommands", message: "must be an object" });
    return;
  }
  validateArray(value.support, "recommendedNextCommands.support", [
    "pnpm ops:support:bundle-preview",
    "pnpm support:intake:preflight",
  ], issues);
  validateArray(value.liveEvidence, "recommendedNextCommands.liveEvidence", [
    "pnpm ops:readiness:summary",
    "pnpm smoke:prod-readonly:config",
  ], issues);
  validateArray(value.release, "recommendedNextCommands.release", [
    "pnpm release:train:preflight",
    "pnpm ci:supply-chain:selftest",
  ], issues);
}

function validateClaimBoundary(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "claimBoundary", message: "must be an object" });
    return;
  }
  validateArray(value.canClaim, "claimBoundary.canClaim", ["support bundle preview is metadata-only"], issues);
  validateArray(value.cannotClaim, "claimBoundary.cannotClaim", [
    "current production health",
    "support bundle export",
    "residual risk closure",
  ], issues);
}

function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  requireValue(value.readOnly, "safetyFacts.readOnly", true, issues);
  requireValue(value.metadataOnly, "safetyFacts.metadataOnly", true, issues);
  for (const field of falseSafetyFacts) {
    requireValue(value[field], `safetyFacts.${field}`, false, issues);
  }
}

function parsePreview(raw: string, issues: ValidationIssue[]): JsonRecord | null {
  try {
    const parsed = JSON.parse(extractJson(raw)) as unknown;
    if (!isRecord(parsed)) {
      issues.push({ field: "json", message: "must be a JSON object" });
      return null;
    }
    return parsed;
  } catch (error) {
    issues.push({ field: "json", message: error instanceof Error ? error.message : "invalid JSON" });
    return null;
  }
}

function extractJson(raw: string): string {
  const firstBrace = raw.indexOf("{");
  if (firstBrace < 0) return raw;
  return raw.slice(firstBrace).trim();
}

function validateHash(body: JsonRecord, issues: ValidationIssue[]): void {
  if (typeof body.supportBundlePreviewHash !== "string") return;
  const expected = hashPreview(body);
  if (body.supportBundlePreviewHash !== expected) {
    issues.push({ field: "supportBundlePreviewHash", message: "does not match canonical preview content" });
  }
}

function validateArray(value: unknown, field: string, required: string[], issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array" });
    return;
  }
  const actual = value.filter((item): item is string => typeof item === "string");
  const missing = required.filter((item) => !actual.includes(item));
  if (missing.length > 0) {
    issues.push({ field, message: `missing ${missing.join(", ")}` });
  }
}

function requireString(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ field, message: "must be a non-empty string" });
  }
}

function requireValue(value: unknown, field: string, expected: string | number | boolean, issues: ValidationIssue[]): void {
  if (value !== expected) {
    issues.push({ field, message: `must be ${String(expected)}` });
  }
}

function requireIso(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push({ field, message: "must be an ISO-8601 timestamp" });
  }
}

function requireSha256Value(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be a 64-character sha256 hex digest" });
  }
}

function hashPreview(preview: JsonRecord): string {
  return sha256(stableStringify({ ...preview, supportBundlePreviewHash: "" }));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMain(): boolean {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isMain()) {
  main();
}
