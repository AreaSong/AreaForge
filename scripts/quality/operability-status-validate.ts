import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  protectedPathFiles,
} from "../ops/operability-status";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";

type JsonRecord = Record<string, unknown>;

const requiredDailyCommands = [
  "pnpm ops:handoff",
  "pnpm ops:status",
  "pnpm ops:backup-restore:preview",
  "pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>",
  "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
  "pnpm ops:readiness:summary",
  "pnpm residuals:evidence:preflight",
];

const requiredWeeklyCommands = [
  "pnpm ops:readonly-side-effect:selftest",
  "pnpm ops:backup-restore:preview:selftest",
  "pnpm release:evidence:redacted-export:selftest",
  "pnpm residuals:evidence:preflight:selftest",
  "pnpm residuals:validate",
  "pnpm docs:readiness",
];

const requiredReleaseCommands = [
  "pnpm ops:long-term:gate",
  "pnpm ops:long-term:snapshot",
  "pnpm release:train:preflight",
  "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
];

const requiredIncidentCommands = [
  "pnpm incident:record:validate <record>",
  "pnpm incident:index",
  "pnpm incident:index:validate docs/development/incident-index.json",
  "pnpm rollback:proof:validate <record>",
];

const requiredDoesNotProve = [
  "current production health",
  "production readiness without live evidence",
  "updater apply completion",
  "backup, restore, migration, or rollback execution",
  "residual risk closure",
  "permission to read, print, copy, or commit secrets",
];

const requiredBoundaryStopKeys = [
  "post_update_ops001",
  "release_backup_hashes",
  "update_request_expected_before",
  "residual_closure",
];

const requiredProtectedPaths = [...protectedPathFiles];

const requiredProtectedPathDoesNotProve = [
  "production health",
  "absence of changes outside protected paths",
  "git worktree cleanliness",
];

const falseSafetyFacts = [
  "networkRequested",
  "serverCommandAttempted",
  "backupRestoreAttempted",
  "migrationAttempted",
  "productionWriteAttempted",
  "protectedPathWriteAttempted",
  "secretValuePrinted",
  "statusProjectionWritten",
] as const;

function main(): void {
  const statusPath = process.argv[2];
  if (!statusPath) {
    console.error("Usage: pnpm ops:status:validate <operability-status.json>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(statusPath));
  const issues = validateOperabilityStatus(raw);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`operability status validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("operability status validation passed: offline projection shape, claim boundary, command matrix, and safety facts are present.");
  console.log(`operabilityStatusRecordHash: sha256:${sha256(extractJson(raw))}`);
  console.log("safetyFacts: readOnly=true networkRequested=false serverCommandAttempted=false productionWriteAttempted=false protectedPathWriteAttempted=false secretValuePrinted=false statusProjectionWritten=false");
}

export function validateOperabilityStatus(raw: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parseJson(raw, issues);
  if (!body) return issues;

  requireValue(body.schemaVersion, "schemaVersion", 1, issues);
  requireValue(body.mode, "mode", "offline_long_term_operability_status_projection", issues);
  requireIso(body.generatedAt, "generatedAt", issues);
  requireDateOnly(body.asOf, "asOf", issues);
  validateApp(body.app, issues);
  validateSourceBaseline(body.sourceBaseline, issues);
  validateSourceSnapshot(body.sourceSnapshot, issues);
  validateStatus(body.status, issues);
  validateSafetyFacts(body.safetyFacts, issues);
  validatePresenceGroup(body.requiredFiles, "requiredFiles", issues);
  validatePresenceGroup(body.packageScripts, "packageScripts", issues);
  validateResiduals(body.residuals, issues);
  validateReleaseEvidenceGaps(body.releaseEvidenceGaps, "releaseEvidenceGaps", issues);
  validateBoundaryStops(body.boundaryStops, issues);
  validateCommands(body.commands, issues);
  validateNextActions(body.nextActions, issues);
  validateClaimDiscipline(body.claimDiscipline, issues);
  validateStringArray(body.doesNotProve, "doesNotProve", requiredDoesNotProve, issues);
  validateConsistency(body, issues);

  return issues;
}

function validateApp(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "app", message: "must be an object" });
    return;
  }
  requireString(value.name, "app.name", issues);
  requireString(value.version, "app.version", issues);
  requireValue(value.onlineUrl, "app.onlineUrl", "https://forge.areasong.top/", issues);
  requireString(value.releaseTag, "app.releaseTag", issues);
  requireValue(value.autoApplyDefault, "app.autoApplyDefault", "none", issues);
}

function validateSourceBaseline(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "sourceBaseline", message: "must be an object" });
    return;
  }
  validateStringArray(value.borrowedMechanisms, "sourceBaseline.borrowedMechanisms", [
    "AreaFlow-style offline status projection",
    "AreaMatrix-style residual index with stable close conditions",
  ], issues);
  validateStringArray(value.notBorrowed, "sourceBaseline.notBorrowed", [
    "task-loop runner",
    "version execution queue",
  ], issues);
}

function validateSourceSnapshot(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "sourceSnapshot", message: "must be an object" });
    return;
  }
  requireSha256(value.controlPlaneSourceHash, "sourceSnapshot.controlPlaneSourceHash", issues);
  requireStringArray(value.files, "sourceSnapshot.files", issues);
  if (!Array.isArray(value.missingFiles)) {
    issues.push({ field: "sourceSnapshot.missingFiles", message: "must be an array" });
  }
  validateProtectedPathFingerprint(value.protectedPathFingerprint, issues);
}

function validateProtectedPathFingerprint(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "sourceSnapshot.protectedPathFingerprint", message: "must be an object" });
    return;
  }
  requireValue(value.algorithm, "sourceSnapshot.protectedPathFingerprint.algorithm", "sha256", issues);
  requireValue(
    value.scope,
    "sourceSnapshot.protectedPathFingerprint.scope",
    "read_only_side_effect_guard_inputs",
    issues,
  );
  validateExactStringArray(
    value.paths,
    "sourceSnapshot.protectedPathFingerprint.paths",
    requiredProtectedPaths,
    issues,
  );
  requireSha256(value.hash, "sourceSnapshot.protectedPathFingerprint.hash", issues);
  validateStringArray(
    value.doesNotProve,
    "sourceSnapshot.protectedPathFingerprint.doesNotProve",
    requiredProtectedPathDoesNotProve,
    issues,
  );
}

function validateStatus(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "status", message: "must be an object" });
    return;
  }
  requireOneOf(value.overall, "status.overall", ["ready", "operable_with_residuals", "needs_live_evidence", "blocked"], issues);
  requireOneOf(value.controlPlane, "status.controlPlane", ["pass", "fail"], issues);
  requireValue(value.productionHealthClaim, "status.productionHealthClaim", "not_proven_by_offline_projection", issues);
  requireOneOf(value.releaseTrain, "status.releaseTrain", ["ready_to_decide", "needs_release_evidence", "blocked"], issues);
}

function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  requireValue(value.readOnly, "safetyFacts.readOnly", true, issues);
  for (const field of falseSafetyFacts) {
    requireValue(value[field], `safetyFacts.${field}`, false, issues);
  }
}

function validatePresenceGroup(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  if (!Array.isArray(value.present)) issues.push({ field: `${field}.present`, message: "must be an array" });
  if (!Array.isArray(value.missing)) issues.push({ field: `${field}.missing`, message: "must be an array" });
}

function validateResiduals(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "residuals", message: "must be an object" });
    return;
  }
  requireString(value.source, "residuals.source", issues);
  if (typeof value.total !== "number" || value.total < 0) {
    issues.push({ field: "residuals.total", message: "must be a non-negative number" });
  }
  if (!isRecord(value.countsByType)) issues.push({ field: "residuals.countsByType", message: "must be an object" });
  if (!isRecord(value.countsByReviewStatus)) issues.push({ field: "residuals.countsByReviewStatus", message: "must be an object" });
  if (!Array.isArray(value.dueItems)) issues.push({ field: "residuals.dueItems", message: "must be an array" });
  if (!Array.isArray(value.executableNowItems)) issues.push({ field: "residuals.executableNowItems", message: "must be an array" });
  if (!Array.isArray(value.releaseRelevantIds)) issues.push({ field: "residuals.releaseRelevantIds", message: "must be an array" });
}

function validateReleaseEvidenceGaps(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  requireString(value.sourceRecordPath, `${field}.sourceRecordPath`, issues);
  if (!(typeof value.sourceRecordHash === "string" || value.sourceRecordHash === null)) {
    issues.push({ field: `${field}.sourceRecordHash`, message: "must be sha256 string or null" });
  } else if (typeof value.sourceRecordHash === "string" && !/^sha256:[a-f0-9]{64}$/i.test(value.sourceRecordHash)) {
    issues.push({ field: `${field}.sourceRecordHash`, message: "must be sha256:<64 hex>" });
  }
  requireOneOf(value.status, `${field}.status`, ["ready", "needs_evidence", "blocked", "missing_record"], issues);
  validateStringArray(value.doesNotProve, `${field}.doesNotProve`, [
    "release evidence validator passes",
    "long-term live gate passes",
    "residual risk closure",
  ], issues);
  if (!Array.isArray(value.blockingGaps)) {
    issues.push({ field: `${field}.blockingGaps`, message: "must be an array" });
    return;
  }

  const keys = new Set<string>();
  for (const [index, gap] of value.blockingGaps.entries()) {
    const prefix = `${field}.blockingGaps[${index}]`;
    if (!isRecord(gap)) {
      issues.push({ field: prefix, message: "must be an object" });
      continue;
    }
    requireOneOf(gap.key, `${prefix}.key`, ["releaseEvidenceBundleHash", "databaseBackupSha256", "uploadsBackupSha256", "envBackupSha256", "attachmentReconciliationCsvPath", "attachmentReconciliationCsvSha256", "attachmentReconciliationSummaryPath", "attachmentReconciliationSummaryHash", "attachmentReconciliationStatus"], issues);
    if (typeof gap.key === "string") keys.add(gap.key);
    requireOneOf(gap.gapType, `${prefix}.gapType`, ["release_evidence_bundle_hash", "release_evidence_backup_hash", "attachment_reconciliation_binding"], issues);
    requireOneOf(gap.status, `${prefix}.status`, ["root_only", "missing", "invalid"], issues);
    requireString(gap.sourceRecord, `${prefix}.sourceRecord`, issues);
    requireString(gap.sourceField, `${prefix}.sourceField`, issues);
    requireString(gap.safeEvidence, `${prefix}.safeEvidence`, issues);
    requireStringArray(gap.requiredEvidence, `${prefix}.requiredEvidence`, issues);
    requireStringArray(gap.residualRiskIds, `${prefix}.residualRiskIds`, issues);
    validateStringArray(gap.blocks, `${prefix}.blocks`, [
      "release_evidence_validator",
      "long_term_live_gate",
      "maintenance_handoff",
    ], issues);
    if (gap.key === "releaseEvidenceBundleHash" && gap.gapType !== "release_evidence_bundle_hash") {
      issues.push({ field: `${prefix}.gapType`, message: "releaseEvidenceBundleHash must use release_evidence_bundle_hash" });
    }
    if (typeof gap.key === "string" && gap.key.startsWith("attachmentReconciliation") && gap.gapType !== "attachment_reconciliation_binding") {
      issues.push({ field: `${prefix}.gapType`, message: "attachment reconciliation fields must use attachment_reconciliation_binding" });
    }
  }

  if (value.status !== "ready" && !keys.has("releaseEvidenceBundleHash")) {
    issues.push({ field: `${field}.blockingGaps`, message: "must include releaseEvidenceBundleHash when evidence is not ready" });
  }
}

function validateBoundaryStops(value: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "boundaryStops", message: "must be an array" });
    return;
  }
  const keys = value
    .filter((item): item is JsonRecord => isRecord(item) && typeof item.key === "string")
    .map((item) => item.key as string);
  for (const key of requiredBoundaryStopKeys) {
    if (!keys.includes(key)) {
      issues.push({ field: "boundaryStops", message: `missing ${key}` });
    }
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `boundaryStops[${index}]`, message: "must be an object" });
      continue;
    }
    requireString(item.key, `boundaryStops[${index}].key`, issues);
    requireString(item.evidence, `boundaryStops[${index}].evidence`, issues);
    requireStringArray(item.currentBoundary, `boundaryStops[${index}].currentBoundary`, issues);
    requireStringArray(item.allowedNow, `boundaryStops[${index}].allowedNow`, issues);
    requireStringArray(item.requiresFreshConfirmation, `boundaryStops[${index}].requiresFreshConfirmation`, issues);
    const boundaries = Array.isArray(item.currentBoundary)
      ? item.currentBoundary.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (
      item.key === "post_update_ops001" &&
      (!boundaries.includes("no server command") || !boundaries.includes("no secret read/print/copy/commit"))
    ) {
      issues.push({ field: `boundaryStops[${index}].currentBoundary`, message: "OPS-001 stop must include no-server and no-secret boundaries" });
    }
    if (
      item.key === "update_request_expected_before" &&
      (!boundaries.includes("no high-risk local implementation confirmation") ||
        !boundaries.includes("no production deployment confirmation"))
    ) {
      issues.push({ field: `boundaryStops[${index}].currentBoundary`, message: "expected-before stop must separate local implementation and production deployment confirmation" });
    }
  }
}

function validateCommands(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "commands", message: "must be an object" });
    return;
  }
  validateStringArray(value.daily, "commands.daily", requiredDailyCommands, issues);
  validateStringArray(value.weekly, "commands.weekly", requiredWeeklyCommands, issues);
  validateStringArray(value.release, "commands.release", requiredReleaseCommands, issues);
  validateStringArray(value.incident, "commands.incident", requiredIncidentCommands, issues);
}

function validateNextActions(value: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "nextActions", message: "must be an array" });
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `nextActions[${index}]`, message: "must be an object" });
      continue;
    }
    requireString(item.residualRiskId, `nextActions[${index}].residualRiskId`, issues);
    requireString(item.reason, `nextActions[${index}].reason`, issues);
    requireString(item.requiredEvidence, `nextActions[${index}].requiredEvidence`, issues);
    requireStringArray(item.ownerSkills, `nextActions[${index}].ownerSkills`, issues);
  }
}

function validateClaimDiscipline(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "claimDiscipline", message: "must be an object" });
    return;
  }
  requireValue(value.statusProjectionIsNotProductionHealth, "claimDiscipline.statusProjectionIsNotProductionHealth", true, issues);
  requireValue(value.requiresLiveEvidenceForProductionHealth, "claimDiscipline.requiresLiveEvidenceForProductionHealth", true, issues);
  requireValue(value.requiresExplicitConfirmationForProductionWrites, "claimDiscipline.requiresExplicitConfirmationForProductionWrites", true, issues);
}

function validateConsistency(body: JsonRecord, issues: ValidationIssue[]): void {
  if (!isRecord(body.requiredFiles) || !isRecord(body.packageScripts) || !isRecord(body.status)) return;
  const missingFiles = Array.isArray(body.requiredFiles.missing) ? body.requiredFiles.missing.length : 0;
  const missingScripts = Array.isArray(body.packageScripts.missing) ? body.packageScripts.missing.length : 0;
  if ((missingFiles > 0 || missingScripts > 0) && body.status.controlPlane !== "fail") {
    issues.push({ field: "status.controlPlane", message: "must be fail when required files or scripts are missing" });
  }
  if (body.status.controlPlane === "fail" && body.status.overall !== "blocked") {
    issues.push({ field: "status.overall", message: "must be blocked when controlPlane is fail" });
  }
}

function parseJson(raw: string, issues: ValidationIssue[]): JsonRecord | null {
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

function validateStringArray(value: unknown, field: string, required: string[], issues: ValidationIssue[]): void {
  requireStringArray(value, field, issues);
  if (!Array.isArray(value)) return;
  const actual = value.filter((item): item is string => typeof item === "string");
  const missing = required.filter((item) => !actual.includes(item));
  if (missing.length > 0) {
    issues.push({ field, message: `missing ${missing.join(", ")}` });
  }
}

function validateExactStringArray(value: unknown, field: string, expected: string[], issues: ValidationIssue[]): void {
  requireStringArray(value, field, issues);
  if (!Array.isArray(value)) return;
  const actual = value.filter((item): item is string => typeof item === "string");
  const duplicate = actual.find((item, index) => actual.indexOf(item) !== index);
  if (duplicate) {
    issues.push({ field, message: `contains duplicate ${duplicate}` });
    return;
  }
  const unexpected = actual.filter((item) => !expected.includes(item));
  const missing = expected.filter((item) => !actual.includes(item));
  if (unexpected.length > 0 || missing.length > 0 || actual.length !== expected.length) {
    issues.push({
      field,
      message: `must exactly match protected path set; missing=${missing.join(", ") || "none"} unexpected=${unexpected.join(", ") || "none"}`,
    });
  }
}

function requireStringArray(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({ field, message: "must be an array of strings" });
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

function requireOneOf(value: unknown, field: string, allowed: string[], issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
  }
}

function requireIso(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    issues.push({ field, message: "must be an ISO-8601 timestamp" });
  }
}

function requireDateOnly(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push({ field, message: "must be YYYY-MM-DD" });
  }
}

function requireSha256(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    issues.push({ field, message: "must be a 64-character sha256 hex digest" });
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMain(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isMain()) {
  main();
}
