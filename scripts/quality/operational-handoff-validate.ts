import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildOperabilityStatusProjection, protectedPathFiles } from "../ops/operability-status";
import {
  readRequiredFile,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";

type JsonRecord = Record<string, unknown>;
type BindingMode = "current" | "shape-only";
type ValidationOptions = { root?: string; bindingMode?: BindingMode };

const requiredHandoffCommands = [
  "pnpm ops:handoff",
  "pnpm ops:status",
  "pnpm ops:support:bundle-preview",
  "pnpm ops:backup-restore:preview",
  "pnpm incident:index",
  "pnpm incident:index:validate docs/development/incident-index.json",
  "pnpm residuals:review-due",
  "pnpm residuals:evidence:preflight",
];

const requiredLiveEvidenceCommands = [
  "pnpm ops:ops-001:preflight",
  "pnpm ops:backup-restore:preview",
  "pnpm ops:readiness:summary",
  "pnpm ops:evidence:bundle",
  "pnpm ops:long-term:snapshot",
  "pnpm release:evidence:redacted-export:validate <redacted-export-dir>",
  "pnpm residuals:evidence:preflight",
];

const requiredDoesNotProve = [
  "current production health",
  "updater apply completion",
  "backup, restore, migration, or rollback execution",
  "residual risk closure",
  "production update request completion",
  "operator approval for high-risk actions",
  "permission to read, print, copy, or commit secrets",
];

const requiredBoundaryStopKeys = [
  "post_update_ops001",
  "release_backup_hashes",
  "update_request_expected_before",
  "residual_closure",
];

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
  "handoffWritten",
] as const;

function main(): void {
  const args = process.argv.slice(2);
  const shapeOnly = args.includes("--shape-only");
  const handoffPath = args.find((arg) => arg !== "--shape-only" && arg !== "--");
  if (!handoffPath) {
    console.error("Usage: pnpm ops:handoff:validate <operational-handoff.json> [--shape-only]");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(handoffPath));
  const options = { bindingMode: shapeOnly ? "shape-only" as const : "current" as const };
  const bindingStatus = operationalHandoffBindingStatus(raw, options);
  const issues = validateOperationalHandoff(raw, options);
  console.log(`bindingStatus: ${bindingStatus}`);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`operational handoff validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("operational handoff validation passed: handoff shape, claim boundary, next commands, high-risk boundaries, and safety facts are present.");
  console.log(`operationalHandoffRecordHash: sha256:${sha256(extractJson(raw))}`);
  console.log("safetyFacts: readOnly=true networkRequested=false serverCommandAttempted=false productionWriteAttempted=false protectedPathWriteAttempted=false secretValuePrinted=false handoffWritten=false");
}

export function validateOperationalHandoff(raw: string, options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parseJson(raw, issues);
  if (!body) return issues;

  requireValue(body.schemaVersion, "schemaVersion", 1, issues);
  requireValue(body.mode, "mode", "read_only_operational_handoff", issues);
  requireIso(body.generatedAt, "generatedAt", issues);
  validateApp(body.app, issues);
  validateStatus(body.status, issues);
  validateSource(body.source, issues);
  validateCurrentBinding(body.source, options, issues);
  validateClaimBoundary(body.claimBoundary, issues);
  validateEvidenceFocus(body.evidenceFocus, issues);
  validateNextCommands(body.nextCommands, issues);
  validateStringArray(body.doesNotProve, "doesNotProve", requiredDoesNotProve, issues);
  validateStringArray(body.highRiskBoundaries, "highRiskBoundaries", [
    "No production deploy, migration, backup, restore, updater apply, rollback, or server command is executed by this handoff.",
    "Residual risks close only with their close-condition evidence.",
    "Secrets must not be read, printed, copied, or committed unless a future confirmation explicitly authorizes that exact evidence path.",
  ], issues);
  validateSafetyFacts(body.safetyFacts, issues);

  return issues;
}

export function operationalHandoffBindingStatus(raw: string, options: ValidationOptions = {}): "current" | "stale" | "unavailable" {
  if ((options.bindingMode ?? "current") === "shape-only") return "unavailable";
  const issues: ValidationIssue[] = [];
  const body = parseJson(raw, issues);
  if (!body || !isRecord(body.source)) return "unavailable";
  try {
    const projection = buildOperabilityStatusProjection({ root: options.root ?? process.cwd() });
    return body.source.controlPlaneSourceHash === projection.sourceSnapshot.controlPlaneSourceHash &&
      isRecord(body.source.protectedPathFingerprint) &&
      body.source.protectedPathFingerprint.hash === projection.sourceSnapshot.protectedPathFingerprint.hash
      ? "current"
      : "stale";
  } catch {
    return "unavailable";
  }
}

function validateCurrentBinding(value: unknown, options: ValidationOptions, issues: ValidationIssue[]): void {
  if ((options.bindingMode ?? "current") === "shape-only") return;
  if (!isRecord(value)) return;
  try {
    const projection = buildOperabilityStatusProjection({ root: options.root ?? process.cwd() });
    if (value.controlPlaneSourceHash !== projection.sourceSnapshot.controlPlaneSourceHash) {
      issues.push({ field: "source.controlPlaneSourceHash.currentBinding", message: "does not match the current checkout" });
    }
    const fingerprint = isRecord(value.protectedPathFingerprint) ? value.protectedPathFingerprint : null;
    if (!fingerprint || fingerprint.hash !== projection.sourceSnapshot.protectedPathFingerprint.hash) {
      issues.push({ field: "source.protectedPathFingerprint.hash.currentBinding", message: "does not match the current checkout" });
    }
  } catch {
    issues.push({ field: "source.currentBinding", message: "current checkout binding is unavailable; use --shape-only only for historical archives" });
  }
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

function validateStatus(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "status", message: "must be an object" });
    return;
  }
  requireOneOf(value.offlineOverall, "status.offlineOverall", ["ready", "operable_with_residuals", "needs_live_evidence", "blocked"], issues);
  requireOneOf(value.controlPlane, "status.controlPlane", ["pass", "fail"], issues);
  requireOneOf(value.releaseTrain, "status.releaseTrain", ["ready_to_decide", "needs_release_evidence", "blocked"], issues);
  requireValue(value.productionHealthClaim, "status.productionHealthClaim", "not_proven_by_offline_projection", issues);
}

function validateSource(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "source", message: "must be an object" });
    return;
  }
  requireValue(value.statusProjection, "source.statusProjection", "pnpm ops:status", issues);
  requireSha256(value.controlPlaneSourceHash, "source.controlPlaneSourceHash", issues);
  validateProtectedPathFingerprint(value.protectedPathFingerprint, "source.protectedPathFingerprint", issues);
  requireString(value.residualLedger, "source.residualLedger", issues);
  validateStringArray(value.authoritativeDocs, "source.authoritativeDocs", [
    "docs/development/long-term-operability-control-plane.md",
    "docs/development/operational-readiness.md",
    "docs/development/residual-risk-ledger.md",
  ], issues);
}

function validateProtectedPathFingerprint(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  requireValue(value.algorithm, `${field}.algorithm`, "sha256", issues);
  requireValue(value.scope, `${field}.scope`, "read_only_side_effect_guard_inputs", issues);
  validateExactStringArray(value.paths, `${field}.paths`, [...protectedPathFiles], issues);
  requireSha256(value.hash, `${field}.hash`, issues);
  validateStringArray(value.doesNotProve, `${field}.doesNotProve`, requiredProtectedPathDoesNotProve, issues);
}

function validateClaimBoundary(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "claimBoundary", message: "must be an object" });
    return;
  }
  validateStringArray(value.canClaim, "claimBoundary.canClaim", [
    "offline control plane",
    "offline operability status",
  ], issues, "includes");
  validateStringArray(value.cannotClaim, "claimBoundary.cannotClaim", [
    "current production health",
    "residual risk closure",
  ], issues, "includes");
}

function validateEvidenceFocus(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "evidenceFocus", message: "must be an object" });
    return;
  }
  validateFocusArray(value.immediate, "evidenceFocus.immediate", issues);
  validateFocusArray(value.dueOrSoon, "evidenceFocus.dueOrSoon", issues);
  validateFocusArray(value.currentBlockers, "evidenceFocus.currentBlockers", issues);
  validateBoundaryStops(value.boundaryStops, issues);
  validateReleaseEvidenceGaps(value.releaseEvidenceGaps, "evidenceFocus.releaseEvidenceGaps", issues);
  requireStringArray(value.releaseRelevantIds, "evidenceFocus.releaseRelevantIds", issues);
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
    issues.push({ field: "evidenceFocus.boundaryStops", message: "must be an array" });
    return;
  }
  const keys = value
    .filter((item): item is JsonRecord => isRecord(item) && typeof item.key === "string")
    .map((item) => item.key as string);
  for (const key of requiredBoundaryStopKeys) {
    if (!keys.includes(key)) {
      issues.push({ field: "evidenceFocus.boundaryStops", message: `missing ${key}` });
    }
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `evidenceFocus.boundaryStops[${index}]`, message: "must be an object" });
      continue;
    }
    requireString(item.key, `evidenceFocus.boundaryStops[${index}].key`, issues);
    requireString(item.evidence, `evidenceFocus.boundaryStops[${index}].evidence`, issues);
    requireStringArray(item.currentBoundary, `evidenceFocus.boundaryStops[${index}].currentBoundary`, issues);
    requireStringArray(item.allowedNow, `evidenceFocus.boundaryStops[${index}].allowedNow`, issues);
    requireStringArray(item.requiresFreshConfirmation, `evidenceFocus.boundaryStops[${index}].requiresFreshConfirmation`, issues);
    const boundaries = Array.isArray(item.currentBoundary)
      ? item.currentBoundary.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (
      item.key === "update_request_expected_before" &&
      (!boundaries.includes("no matching signed Release for the verified V2 checkout") ||
        !boundaries.includes("no production deployment confirmation"))
    ) {
      issues.push({ field: `evidenceFocus.boundaryStops[${index}].currentBoundary`, message: "expected-before stop must separate verified local implementation from signed Release and production deployment confirmation" });
    }
  }
}

function validateFocusArray(value: unknown, field: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array" });
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `${field}[${index}]`, message: "must be an object" });
      continue;
    }
    requireString(item.residualRiskId, `${field}[${index}].residualRiskId`, issues);
    requireOneOf(item.kind, `${field}[${index}].kind`, ["current_blocker", "execute_now", "review_due", "release_evidence", "track"], issues);
    requireStringArray(item.ownerSkills, `${field}[${index}].ownerSkills`, issues);
    requireString(item.reason, `${field}[${index}].reason`, issues);
    requireString(item.requiredEvidence, `${field}[${index}].requiredEvidence`, issues);
  }
}

function validateNextCommands(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "nextCommands", message: "must be an object" });
    return;
  }
  validateStringArray(value.handoff, "nextCommands.handoff", requiredHandoffCommands, issues);
  validateStringArray(value.liveEvidence, "nextCommands.liveEvidence", requiredLiveEvidenceCommands, issues);
  requireStringArray(value.release, "nextCommands.release", issues);
  requireStringArray(value.maintenance, "nextCommands.maintenance", issues);
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

function validateStringArray(
  value: unknown,
  field: string,
  required: string[],
  issues: ValidationIssue[],
  mode: "exact" | "includes" = "exact",
): void {
  requireStringArray(value, field, issues);
  if (!Array.isArray(value)) return;
  const actual = value.filter((item): item is string => typeof item === "string");
  const missing = required.filter((requiredItem) =>
    mode === "exact"
      ? !actual.includes(requiredItem)
      : !actual.some((actualItem) => actualItem.includes(requiredItem))
  );
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
