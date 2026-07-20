import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundJsonEvidence } from "./bound-json-evidence";
import { validateDataIntegrityDoctor } from "./data-integrity-doctor-validate";
import {
  buildEvidenceHash,
  parseIndentedKeyValueRecord,
  parseStrictIndentedKeyValueRecord,
  parseList,
  readRequiredFile,
  requireField,
  requireIsoTimestamp,
  requireNo,
  requireOneOf,
  requireSha256,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";
import {
  buildReleaseEvidenceBundleHash,
  validateReleaseEvidenceBundle,
} from "./release-evidence-validate";
import {
  buildReleaseSupplyChainEvidenceHash,
  validateReleaseSupplyChainRecord,
  type ReleaseSupplyChainValidationOptions,
} from "./release-supply-chain-validate";

type JsonRecord = Record<string, unknown>;

const migrationPath = "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql";
const migrationVersion = "20260718010000_add_active_session_unique_index";
const evidenceFreshnessMaxAgeHours = 24;
const implementationPaths = [
  "apps/web/lib/study/check-in-service.ts",
  "apps/web/lib/study/concurrency.ts",
  "apps/web/lib/study/service.ts",
  "apps/web/lib/study/simulation-service.ts",
  "apps/web/lib/study/syllabus-service.ts",
  "apps/web/lib/study/task-debt-reorder-service.ts",
] as const;

const scalarFields = [
  "recordId", "recordedAt", "environment", "releaseTag", "packageVersion", "gitCommit",
  "webImageDigest", "migrationImageDigest", "migrationPath", "migrationSha256", "implementationSha256",
  "maintenanceWindowId", "rolloutConfirmationId", "rolloutConfirmationScopeSha256",
  "controlledProbeConfirmationId", "controlledProbeConfirmationScopeSha256", "rollbackTargetImage",
  "databaseBackupSha256", "releaseSupplyChainRecordSha256", "releaseEvidenceRecordSha256",
  "localVerificationStatus", "signedReleaseStatus", "rolloutConfirmationStatus", "controlledProbeConfirmationStatus",
  "productionMigrationStatus", "productionDeploymentStatus", "canonicalIndexVerificationStatus",
  "authenticatedSmokeStatus", "controlledConcurrencyProbeStatus", "rollbackTargetStatus",
  "migrationVersion", "migrationRunner", "indexRollbackPolicy",
  "beforeDoctorFile", "beforeDoctorFileSha256", "beforeDoctorHash",
  "afterDoctorFile", "afterDoctorFileSha256", "afterDoctorHash",
  "rolloutEvidenceFile", "rolloutEvidenceFileSha256", "rolloutEvidenceHash",
  "releaseSupplyChainEvidenceHash", "releaseEvidenceBundleHash", "evidenceFreshnessMaxAgeHours",
  "residualRiskIds", "doesNotProve", "recordHash",
] as const;

const safetyFields = [
  "safetyFacts.secretValuePrinted",
  "safetyFacts.realUserBusinessDataWritten",
  "safetyFacts.syntheticProbeWriteAttempted",
  "safetyFacts.historicalRepairAttempted",
  "safetyFacts.destructiveMigrationAttempted",
  "safetyFacts.destructiveRollbackAttempted",
  "safetyFacts.businessTextIncluded",
  "safetyFacts.objectIdentifiersIncluded",
  "safetyFacts.databaseUrlIncluded",
  "safetyFacts.residualLedgerUpdated",
  "safetyFacts.webRuntimeServerCommandAttempted",
] as const;

const passFields = [
  "localVerificationStatus", "signedReleaseStatus", "rolloutConfirmationStatus", "controlledProbeConfirmationStatus",
  "productionMigrationStatus", "productionDeploymentStatus", "canonicalIndexVerificationStatus",
  "authenticatedSmokeStatus", "controlledConcurrencyProbeStatus", "rollbackTargetStatus",
] as const;

const requiredNonProofs = [
  "AF-RISK-OPS-006 residual closure",
  "historical production data repair",
  "future concurrency safety after this evidence window",
  "database or uploads restore execution",
  "secrets absence beyond validator scan",
];

export type Ops006ExpectedIdentity = {
  releaseTag: string;
  packageVersion: string;
  gitCommit: string;
  webImageDigest: string;
  migrationImageDigest: string;
  migrationPath: string;
  migrationSha256: string;
  implementationSha256: string;
};

export type Ops006SourceAtCommitReader = (gitCommit: string, file: string, root: string) => string;

export type Ops006ValidationOptions = {
  now?: Date;
  maxAgeHours?: number;
  expectedIdentity?: Ops006ExpectedIdentity;
  evidenceBaseDir?: string;
};

export type Ops006BundleOptions = Ops006ValidationOptions & {
  releaseAssetsDir?: string;
  cosignPublicKey?: string;
  releaseSignatureVerifier?: ReleaseSupplyChainValidationOptions["verifySignature"];
  root?: string;
  sourceAtCommit?: Ops006SourceAtCommitReader;
  releaseEvidenceCsv?: string;
  releaseEvidenceSummary?: string;
};

export function buildOps006ExpectedIdentity(
  releaseRecord: string,
  root = process.cwd(),
  sourceAtCommit: Ops006SourceAtCommitReader = readGitObject,
): Ops006ExpectedIdentity {
  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(releaseRecord, parseIssues);
  if (parseIssues.length > 0) throw new Error("Release record is malformed or contains duplicate fields");
  const gitCommit = fields.get("gitCommit") ?? "";
  if (!/^[a-f0-9]{40}$/i.test(gitCommit)) throw new Error("Release gitCommit is invalid");
  const readSource = (file: string) => {
    const source = sourceAtCommit(gitCommit, file, root);
    if (!source) throw new Error(`Release source is missing: ${file}`);
    return source;
  };
  const sources = implementationPaths.map((file) => [file, sha256(readSource(file))]);
  return {
    releaseTag: fields.get("releaseTag") ?? "",
    packageVersion: fields.get("packageVersion") ?? "",
    gitCommit,
    webImageDigest: fields.get("webImageDigest") ?? "",
    migrationImageDigest: fields.get("migrationImageDigest") ?? "",
    migrationPath,
    migrationSha256: prefixedHash(readSource(migrationPath)),
    implementationSha256: `sha256:${sha256(JSON.stringify(sources))}`,
  };
}

export function validateOps006ProductionEvidence(
  record: string,
  options: Ops006ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(record, issues);
  const fields = parseStrictIndentedKeyValueRecord(record, issues);
  validateMainRecordShape(fields, issues);
  validateMainRecordValues(fields, options, issues);
  validateExpectedIdentity(fields, options.expectedIdentity, issues);
  validateBoundEvidence(fields, options, issues);
  return issues;
}

export function validateOps006ProductionEvidenceBundle(
  record: string,
  releaseRecord: string,
  releaseEvidenceRecord: string,
  options: Ops006BundleOptions = {},
): ValidationIssue[] {
  const releaseIssues = validateReleaseSupplyChainRecord(releaseRecord, {
    assetDir: options.releaseAssetsDir,
    strict: true,
    cosignPublicKey: options.cosignPublicKey,
    verifySignature: options.releaseSignatureVerifier,
  }).map((issue) => ({ field: `release.${issue.field}`, message: issue.message }));
  const releaseEvidenceIssues = validateReleaseEvidenceBundle(
    releaseEvidenceRecord,
    options.releaseEvidenceCsv,
    options.releaseEvidenceSummary,
  ).map((issue) => ({ field: `releaseEvidence.${issue.field}`, message: issue.message }));
  const root = options.root ?? process.cwd();
  const sourceIssues: ValidationIssue[] = [];
  let identity: Ops006ExpectedIdentity | undefined;
  try {
    identity = buildOps006ExpectedIdentity(releaseRecord, root, options.sourceAtCommit);
  } catch {
    sourceIssues.push({ field: "release.sourceAtCommit", message: "all OPS-006 Release sources must exist as non-empty Git blobs" });
  }
  const fields = parseStrictIndentedKeyValueRecord(record, []);
  return [
    ...releaseIssues,
    ...releaseEvidenceIssues,
    ...sourceIssues,
    ...validateOps006ProductionEvidence(record, { ...options, expectedIdentity: identity }),
    ...validateReleaseBindings(fields, releaseRecord, releaseEvidenceRecord),
  ];
}

export function calculateOps006ProductionEvidenceHash(fields: Map<string, string>): string {
  return buildEvidenceHash(fields, [...scalarFields.filter((field) => field !== "recordHash"), ...safetyFields]);
}

export function calculateOps006RolloutHash(value: JsonRecord): string {
  const copy = structuredClone(value);
  delete copy.rolloutHash;
  return `sha256:${sha256(canonicalJson(copy))}`;
}

export function canonicalIndexDefinitionHash(): string {
  return `sha256:${sha256(canonicalJson({
    expression: "(1)",
    name: "StudySession_one_active_idx",
    statuses: ["RUNNING", "PAUSED"],
    unique: true,
  }))}`;
}

export function calculateOps006ConfirmationScopeHash(
  kind: "rollout" | "controlled_probe",
  fields: Pick<Map<string, string>, "get">,
): string {
  const identity = {
    releaseTag: fields.get("releaseTag") ?? "",
    gitCommit: fields.get("gitCommit") ?? "",
    webImageDigest: fields.get("webImageDigest") ?? "",
    migrationImageDigest: fields.get("migrationImageDigest") ?? "",
    rollbackTargetImage: fields.get("rollbackTargetImage") ?? "",
  };
  const contract = kind === "rollout"
    ? {
        schemaVersion: 1,
        kind: "ops006_base_rollout",
        identity,
        allows: ["maintenance_window", "backup", "additive_migration", "agent_updater_deploy", "web_deploy", "health", "authenticated_read_only_smoke", "doctor"],
        forbids: ["controlled_write_probe", "historical_repair", "restore", "drop_index", "request_replay", "secret_access", "residual_closure"],
      }
    : {
        schemaVersion: 1,
        kind: "ops006_controlled_probe",
        identity,
        allows: ["synthetic_start_end", "synthetic_task_cas", "single_side_effect_check", "check_in_concurrency", "synthetic_cleanup"],
        forbids: ["real_user_write", "migration", "historical_repair", "restore", "drop_index", "request_replay", "secret_access", "residual_closure"],
      };
  return `sha256:${sha256(canonicalJson(contract))}`;
}

export function calculateOps006ConfirmationScopes(record: string): {
  rolloutConfirmationScopeSha256: string;
  controlledProbeConfirmationScopeSha256: string;
} {
  const issues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(record, issues);
  const requiredIdentity = ["releaseTag", "gitCommit", "webImageDigest", "migrationImageDigest", "rollbackTargetImage"];
  for (const field of requiredIdentity) requireField(fields, field, issues);
  if (!/^v\d+\.\d+\.\d+$/.test(fields.get("releaseTag") ?? "")) issues.push({ field: "releaseTag", message: "must be vX.Y.Z" });
  if (!/^[a-f0-9]{40}$/.test(fields.get("gitCommit") ?? "")) issues.push({ field: "gitCommit", message: "must be a canonical lowercase commit" });
  for (const field of ["webImageDigest", "migrationImageDigest"] as const) {
    if (!/^ghcr\.io\/areasong\/areaforge-(?:web|migration):v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(fields.get(field) ?? "")) {
      issues.push({ field, message: "must be a canonical lowercase immutable AreaForge image" });
    }
  }
  if (!/^ghcr\.io\/areasong\/areaforge-web:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(fields.get("rollbackTargetImage") ?? "")) {
    issues.push({ field: "rollbackTargetImage", message: "must be a canonical lowercase immutable AreaForge Web rollback target" });
  }
  if (fields.get("rollbackTargetImage") === fields.get("webImageDigest")) {
    issues.push({ field: "rollbackTargetImage", message: "must differ from the deployed Web image" });
  }
  if (issues.length > 0) throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
  return {
    rolloutConfirmationScopeSha256: calculateOps006ConfirmationScopeHash("rollout", fields),
    controlledProbeConfirmationScopeSha256: calculateOps006ConfirmationScopeHash("controlled_probe", fields),
  };
}

function validateMainRecordShape(fields: Map<string, string>, issues: ValidationIssue[]): void {
  for (const field of [...scalarFields, ...safetyFields]) requireField(fields, field, issues);
  const expected = [...scalarFields, "safetyFacts", ...safetyFields].sort();
  const actual = [...fields.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push({ field: "record", message: "fields are incomplete or unknown" });
  }
}

function validateMainRecordValues(
  fields: Map<string, string>,
  options: Ops006ValidationOptions,
  issues: ValidationIssue[],
): void {
  requireIsoTimestamp(fields, "recordedAt", issues);
  requireOneOf(fields, "environment", ["production"], issues);
  for (const field of passFields) requireOneOf(fields, field, ["pass"], issues);
  requireOneOf(fields, "migrationRunner", ["controlled_release_workdir", "one_off_migration_job"], issues);
  requireOneOf(fields, "indexRollbackPolicy", ["retain"], issues);
  for (const field of safetyFields) {
    if (field === "safetyFacts.syntheticProbeWriteAttempted") {
      requireOneOf(fields, field, ["yes"], issues);
    } else {
      requireNo(fields, field, issues);
    }
  }
  for (const field of scalarFields.filter((field) => /(?:Sha256|Hash)$/.test(field))) {
    requireSha256(fields, field, issues);
  }
  validateIdentityFormats(fields, issues);
  validateGovernanceFields(fields, issues);
  validateFreshness(fields, options, issues);
  const expectedHash = calculateOps006ProductionEvidenceHash(fields);
  if (fields.get("recordHash") !== expectedHash) {
    issues.push({ field: "recordHash", message: `must equal canonical hash ${expectedHash}` });
  }
}

function validateIdentityFormats(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const version = fields.get("packageVersion") ?? "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) issues.push({ field: "packageVersion", message: "must be X.Y.Z" });
  if (fields.get("releaseTag") !== `v${version}`) issues.push({ field: "releaseTag", message: "must equal v + packageVersion" });
  if (!/^[a-f0-9]{40}$/.test(fields.get("gitCommit") ?? "")) issues.push({ field: "gitCommit", message: "must be a canonical lowercase 40-character commit" });
  for (const field of ["webImageDigest", "migrationImageDigest"] as const) {
    if (!/^ghcr\.io\/areasong\/areaforge-(?:web|migration):v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(fields.get(field) ?? "")) {
      issues.push({ field, message: "must be a canonical lowercase immutable versioned AreaForge image digest" });
    }
  }
  if (fields.get("migrationPath") !== migrationPath) issues.push({ field: "migrationPath", message: "must be the canonical OPS-006 migration" });
  if (fields.get("migrationVersion") !== migrationVersion) issues.push({ field: "migrationVersion", message: "must match the OPS-006 migration version" });
  if (!/^ghcr\.io\/areasong\/areaforge-web:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(fields.get("rollbackTargetImage") ?? "")) {
    issues.push({ field: "rollbackTargetImage", message: "must be a canonical lowercase immutable AreaForge Web rollback target" });
  }
  if (fields.get("rollbackTargetImage") === fields.get("webImageDigest")) {
    issues.push({ field: "rollbackTargetImage", message: "must differ from the deployed Web image" });
  }
}

function validateGovernanceFields(fields: Map<string, string>, issues: ValidationIssue[]): void {
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(fields.get("maintenanceWindowId") ?? "")) {
    issues.push({ field: "maintenanceWindowId", message: "must be a redacted stable identifier" });
  }
  for (const field of ["rolloutConfirmationId", "controlledProbeConfirmationId"] as const) {
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(fields.get(field) ?? "")) {
      issues.push({ field, message: "must be a redacted stable identifier" });
    }
  }
  if (fields.get("rolloutConfirmationId") === fields.get("controlledProbeConfirmationId")) {
    issues.push({ field: "controlledProbeConfirmationId", message: "must identify a confirmation independent from the base rollout" });
  }
  const rolloutScope = calculateOps006ConfirmationScopeHash("rollout", fields);
  const probeScope = calculateOps006ConfirmationScopeHash("controlled_probe", fields);
  if (fields.get("rolloutConfirmationScopeSha256") !== rolloutScope) {
    issues.push({ field: "rolloutConfirmationScopeSha256", message: `must equal canonical base rollout scope ${rolloutScope}` });
  }
  if (fields.get("controlledProbeConfirmationScopeSha256") !== probeScope) {
    issues.push({ field: "controlledProbeConfirmationScopeSha256", message: `must equal canonical controlled probe scope ${probeScope}` });
  }
  if (rolloutScope === probeScope || fields.get("rolloutConfirmationScopeSha256") === fields.get("controlledProbeConfirmationScopeSha256")) {
    issues.push({ field: "controlledProbeConfirmationScopeSha256", message: "must differ from the base rollout scope" });
  }
  if (!parseList(fields.get("residualRiskIds") ?? "").includes("AF-RISK-OPS-006")) {
    issues.push({ field: "residualRiskIds", message: "must include AF-RISK-OPS-006" });
  }
  const nonProofs = parseList(fields.get("doesNotProve") ?? "");
  for (const value of requiredNonProofs) {
    if (!nonProofs.includes(value)) issues.push({ field: "doesNotProve", message: `missing ${value}` });
  }
}

function validateExpectedIdentity(
  fields: Map<string, string>,
  expected: Ops006ExpectedIdentity | undefined,
  issues: ValidationIssue[],
): void {
  if (!expected) return;
  for (const field of Object.keys(expected) as Array<keyof Ops006ExpectedIdentity>) {
    if (!expected[field] || fields.get(field) !== expected[field]) {
      issues.push({ field, message: "must match the signed Release identity and source-at-commit hash" });
    }
  }
}

function validateBoundEvidence(
  fields: Map<string, string>,
  options: Ops006ValidationOptions,
  issues: ValidationIssue[],
): void {
  if (!options.evidenceBaseDir) {
    issues.push({ field: "evidenceBaseDir", message: "is required to bind OPS-006 evidence files" });
    return;
  }
  const before = readEvidence(options.evidenceBaseDir, fields, "beforeDoctorFile", "beforeDoctorFileSha256", issues);
  const after = readEvidence(options.evidenceBaseDir, fields, "afterDoctorFile", "afterDoctorFileSha256", issues);
  const rollout = readEvidence(options.evidenceBaseDir, fields, "rolloutEvidenceFile", "rolloutEvidenceFileSha256", issues);
  const evidenceOptions = {
    ...options,
    maxAgeHours: options.maxAgeHours ?? evidenceFreshnessMaxAgeHours,
  };
  const beforeDoctor = before && validateDoctor(before.value, before.raw, fields.get("beforeDoctorHash") ?? "", "beforeDoctorFile", evidenceOptions, issues);
  const afterDoctor = after && validateDoctor(after.value, after.raw, fields.get("afterDoctorHash") ?? "", "afterDoctorFile", evidenceOptions, issues);
  const rolloutRecord = rollout && validateRollout(rollout.value, fields, issues);
  if (beforeDoctor && afterDoctor && rolloutRecord) validateEvidenceSequence(beforeDoctor, afterDoctor, rolloutRecord, fields, issues);
  if (before?.contentHash === after?.contentHash || fields.get("beforeDoctorHash") === fields.get("afterDoctorHash")) {
    issues.push({ field: "afterDoctorHash", message: "before and after doctor evidence must be distinct" });
  }
}

function readEvidence(
  baseDir: string,
  fields: Map<string, string>,
  fileField: string,
  hashField: string,
  issues: ValidationIssue[],
) {
  return readBoundJsonEvidence({
    baseDir,
    relativeFile: fields.get(fileField) ?? "",
    recordedHash: fields.get(hashField) ?? "",
    field: fileField,
    hashField,
    issues,
  });
}

function validateDoctor(
  value: unknown,
  raw: string,
  expectedHash: string,
  field: string,
  options: Ops006ValidationOptions,
  issues: ValidationIssue[],
): JsonRecord | null {
  for (const issue of validateDataIntegrityDoctor(raw)) issues.push({ field, message: issue });
  if (!isRecord(value)) return null;
  if (value.doctorHash !== expectedHash) issues.push({ field: `${field}.doctorHash`, message: "must match the production evidence record" });
  const source = asRecord(value.source);
  const safety = asRecord(value.safetyFacts);
  if (source.database !== "configured_read_only_query" || safety.databaseReadAttempted !== true) {
    issues.push({ field, message: "must come from a configured production read-only query" });
  }
  const status = asRecord(value.status);
  if (status.overall !== "pass" || status.native !== "integrity_clean") {
    issues.push({ field, message: "all doctor checks including attachment reconciliation must pass" });
  }
  const checks = Array.isArray(value.checks) ? value.checks.filter(isRecord) : [];
  if (checks.length !== 5 || checks.some((check) => check.status !== "pass")) {
    issues.push({ field: `${field}.checks`, message: "all five data-integrity checks must pass" });
  }
  const active = checks.find((check) => check.id === "study_sessions.active_cardinality");
  if (asRecord(active?.details).activeSessionCount !== 1 && asRecord(active?.details).activeSessionCount !== 0) {
    issues.push({ field: `${field}.checks`, message: "active StudySession count must be zero or one" });
  }
  validateTimestampFreshness(String(value.generatedAt ?? ""), field, options, issues);
  return value;
}

function validateRollout(value: unknown, fields: Map<string, string>, issues: ValidationIssue[]): JsonRecord | null {
  if (!isRecord(value)) {
    issues.push({ field: "rolloutEvidenceFile", message: "must contain a JSON object" });
    return null;
  }
  requireExactKeys(value, ["schemaVersion", "mode", "recordedAt", "environment", "identity", "deployment", "controlledProbe", "healthSmoke", "doctorBinding", "rollback", "safetyFacts", "rolloutHash"], "rolloutEvidenceFile", issues);
  if (value.schemaVersion !== 1 || value.mode !== "redacted_ops006_production_rollout" || value.environment !== "production") {
    issues.push({ field: "rolloutEvidenceFile", message: "schema, mode, and environment are invalid" });
  }
  if (value.rolloutHash !== fields.get("rolloutEvidenceHash") || value.rolloutHash !== calculateOps006RolloutHash(value)) {
    issues.push({ field: "rolloutEvidenceHash", message: "must match canonical rollout content" });
  }
  validateRolloutIdentity(asRecord(value.identity), fields, issues);
  validateDeployment(asRecord(value.deployment), fields, issues);
  validateControlledProbe(asRecord(value.controlledProbe), fields, issues);
  validateHealthSmoke(asRecord(value.healthSmoke), issues);
  validateDoctorBinding(asRecord(value.doctorBinding), fields, issues);
  validateRollback(asRecord(value.rollback), fields, issues);
  validateRolloutSafety(asRecord(value.safetyFacts), issues);
  return value;
}

function validateRolloutIdentity(value: JsonRecord, fields: Map<string, string>, issues: ValidationIssue[]): void {
  const keys = ["releaseTag", "packageVersion", "gitCommit", "webImageDigest", "migrationImageDigest", "migrationPath", "migrationVersion", "migrationSha256", "implementationSha256", "maintenanceWindowId"];
  requireExactKeys(value, keys, "rolloutEvidenceFile.identity", issues);
  for (const key of keys) {
    if (value[key] !== fields.get(key)) issues.push({ field: `rolloutEvidenceFile.identity.${key}`, message: "must match the production evidence record" });
  }
}

function validateDeployment(value: JsonRecord, fields: Map<string, string>, issues: ValidationIssue[]): void {
  requireExactKeys(value, ["startedAt", "finishedAt", "confirmationId", "confirmationScopeSha256", "backupStatus", "databaseBackupSha256", "agentUpdaterMatchStatus", "migrationRunner", "migrationApplied", "applicationDeploymentStatus", "canonicalIndex"], "rolloutEvidenceFile.deployment", issues);
  const expected: JsonRecord = {
    confirmationId: fields.get("rolloutConfirmationId"), confirmationScopeSha256: fields.get("rolloutConfirmationScopeSha256"),
    backupStatus: "pass", databaseBackupSha256: fields.get("databaseBackupSha256"), agentUpdaterMatchStatus: "pass",
    migrationRunner: fields.get("migrationRunner"), migrationApplied: true, applicationDeploymentStatus: "pass",
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) issues.push({ field: `rolloutEvidenceFile.deployment.${key}`, message: `must equal ${String(expectedValue)}` });
  }
  const index = asRecord(value.canonicalIndex);
  requireExactKeys(index, ["name", "unique", "expression", "statuses", "verificationStatus", "definitionHash"], "rolloutEvidenceFile.deployment.canonicalIndex", issues);
  const valid = index.name === "StudySession_one_active_idx" && index.unique === true && index.expression === "(1)"
    && JSON.stringify(index.statuses) === JSON.stringify(["RUNNING", "PAUSED"])
    && index.verificationStatus === "pass" && index.definitionHash === canonicalIndexDefinitionHash();
  if (!valid) issues.push({ field: "rolloutEvidenceFile.deployment.canonicalIndex", message: "must match the canonical partial unique index readback" });
}

function validateControlledProbe(value: JsonRecord, fields: Map<string, string>, issues: ValidationIssue[]): void {
  requireExactKeys(value, ["recordedAt", "confirmationId", "confirmationScopeSha256", "syntheticScope", "start", "end", "taskCas", "sideEffects", "checkIn", "cleanupStatus"], "rolloutEvidenceFile.controlledProbe", issues);
  if (value.confirmationId !== fields.get("controlledProbeConfirmationId")
    || value.confirmationScopeSha256 !== fields.get("controlledProbeConfirmationScopeSha256")) {
    issues.push({ field: "rolloutEvidenceFile.controlledProbe.confirmationId", message: "must bind the independent controlled probe confirmation" });
  }
  if (value.syntheticScope !== true || value.cleanupStatus !== "pass") {
    issues.push({ field: "rolloutEvidenceFile.controlledProbe", message: "must use a cleaned-up dedicated synthetic scope" });
  }
  validateConflictProbe(asRecord(value.start), "ACTIVE_SESSION_EXISTS", true, "start", issues);
  validateConflictProbe(asRecord(value.end), "SESSION_STATE_CONFLICT", false, "end", issues);
  const taskCas = asRecord(value.taskCas);
  validateConflictProbe(taskCas, "TASK_STATE_CONFLICT", false, "taskCas", issues, ["eventOrChildDuplicateCount"]);
  if (taskCas.eventOrChildDuplicateCount !== 0) issues.push({ field: "rolloutEvidenceFile.controlledProbe.taskCas.eventOrChildDuplicateCount", message: "must be zero" });
  const effects = asRecord(value.sideEffects);
  requireExactKeys(effects, ["effectiveMinutes", "taskMinutesDelta", "syllabusMinutesDelta", "auditEventDelta", "taskDebtEventDelta", "checkInSessionDelta"], "rolloutEvidenceFile.controlledProbe.sideEffects", issues);
  const minutes = effects.effectiveMinutes;
  if (!Number.isInteger(minutes) || Number(minutes) <= 0 || effects.taskMinutesDelta !== minutes || effects.syllabusMinutesDelta !== minutes) {
    issues.push({ field: "rolloutEvidenceFile.controlledProbe.sideEffects", message: "task and syllabus minutes must equal one effectiveMinutes application" });
  }
  for (const field of ["auditEventDelta", "taskDebtEventDelta", "checkInSessionDelta"]) {
    if (effects[field] !== 1) issues.push({ field: `rolloutEvidenceFile.controlledProbe.sideEffects.${field}`, message: "must equal one" });
  }
  const checkIn = asRecord(value.checkIn);
  requireExactKeys(checkIn, ["concurrentWrites", "committedWrites", "aggregateMatchesCommittedTaskState"], "rolloutEvidenceFile.controlledProbe.checkIn", issues);
  if (checkIn.concurrentWrites !== 2 || checkIn.committedWrites !== 2 || checkIn.aggregateMatchesCommittedTaskState !== true) {
    issues.push({ field: "rolloutEvidenceFile.controlledProbe.checkIn", message: "must prove serialized same-day aggregate correctness" });
  }
}

function validateConflictProbe(
  value: JsonRecord,
  reason: string,
  activeCount: boolean,
  field: string,
  issues: ValidationIssue[],
  extraKeys: string[] = [],
): void {
  const keys = ["successCount", "conflictCount", "httpStatus", "reasonCode", ...(activeCount ? ["activeSessionCountAfter"] : []), ...extraKeys];
  requireExactKeys(value, keys, `rolloutEvidenceFile.controlledProbe.${field}`, issues);
  if (value.successCount !== 1 || value.conflictCount !== 1 || value.httpStatus !== 409 || value.reasonCode !== reason || (activeCount && value.activeSessionCountAfter !== 1)) {
    issues.push({ field: `rolloutEvidenceFile.controlledProbe.${field}`, message: `must prove exactly one winner and 409 ${reason}` });
  }
}

function validateHealthSmoke(value: JsonRecord, issues: ValidationIssue[]): void {
  requireExactKeys(value, ["recordedAt", "health", "authenticatedReadOnlySmoke"], "rolloutEvidenceFile.healthSmoke", issues);
  if (value.health !== "pass" || value.authenticatedReadOnlySmoke !== "pass") {
    issues.push({ field: "rolloutEvidenceFile.healthSmoke", message: "health and authenticated read-only smoke must pass" });
  }
}

function validateDoctorBinding(value: JsonRecord, fields: Map<string, string>, issues: ValidationIssue[]): void {
  requireExactKeys(value, ["beforeDoctorHash", "afterDoctorHash"], "rolloutEvidenceFile.doctorBinding", issues);
  if (value.beforeDoctorHash !== fields.get("beforeDoctorHash") || value.afterDoctorHash !== fields.get("afterDoctorHash")) {
    issues.push({ field: "rolloutEvidenceFile.doctorBinding", message: "must bind both doctor hashes" });
  }
}

function validateRollback(value: JsonRecord, fields: Map<string, string>, issues: ValidationIssue[]): void {
  requireExactKeys(value, ["targetImage", "applicationRollbackReady", "indexPolicy", "databaseRestoreAttempted", "uploadsRestoreAttempted"], "rolloutEvidenceFile.rollback", issues);
  if (value.targetImage !== fields.get("rollbackTargetImage") || value.applicationRollbackReady !== true || value.indexPolicy !== "retain"
    || value.databaseRestoreAttempted !== false || value.uploadsRestoreAttempted !== false) {
    issues.push({ field: "rolloutEvidenceFile.rollback", message: "must retain the additive index and bind an application-only rollback target" });
  }
}

function validateRolloutSafety(value: JsonRecord, issues: ValidationIssue[]): void {
  const keys = ["secretValuePrinted", "realUserBusinessDataWritten", "syntheticProbeWriteAttempted", "historicalRepairAttempted", "destructiveMigrationAttempted", "destructiveRollbackAttempted", "businessTextIncluded", "objectIdentifiersIncluded", "databaseUrlIncluded", "residualLedgerUpdated", "webRuntimeServerCommandAttempted"];
  requireExactKeys(value, keys, "rolloutEvidenceFile.safetyFacts", issues);
  for (const key of keys) {
    const expected = key === "syntheticProbeWriteAttempted";
    if (value[key] !== expected) issues.push({ field: `rolloutEvidenceFile.safetyFacts.${key}`, message: `must equal ${expected}` });
  }
}

function validateEvidenceSequence(before: JsonRecord, after: JsonRecord, rollout: JsonRecord, fields: Map<string, string>, issues: ValidationIssue[]): void {
  const deployment = asRecord(rollout.deployment);
  const health = asRecord(rollout.healthSmoke);
  const probe = asRecord(rollout.controlledProbe);
  const values = [before.generatedAt, deployment.startedAt, deployment.finishedAt, health.recordedAt, probe.recordedAt, after.generatedAt, rollout.recordedAt, fields.get("recordedAt")];
  const timestamps = values.map((value) => new Date(String(value ?? "")).getTime());
  const canonical = values.every((value) => {
    const parsed = new Date(String(value ?? ""));
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  });
  if (!canonical || timestamps.some((value, index) => index > 0 && value <= timestamps[index - 1]!)) {
    issues.push({ field: "recordedAt", message: "canonical evidence timestamps must strictly follow before-doctor, deploy, smoke, probe, after-doctor, rollout, record order" });
  }
}

function validateReleaseBindings(
  fields: Map<string, string>,
  releaseRecord: string,
  releaseEvidenceRecord: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const supplyParseIssues: ValidationIssue[] = [];
  const releaseParseIssues: ValidationIssue[] = [];
  const supplyFields = parseStrictIndentedKeyValueRecord(releaseRecord, supplyParseIssues);
  const releaseFields = parseStrictIndentedKeyValueRecord(releaseEvidenceRecord, releaseParseIssues);
  for (const issue of supplyParseIssues) issues.push({ field: `release.${issue.field}`, message: issue.message });
  for (const issue of releaseParseIssues) issues.push({ field: `releaseEvidence.${issue.field}`, message: issue.message });
  const expectedSupplyHash = buildReleaseSupplyChainEvidenceHash(supplyFields);
  const expectedReleaseHash = buildReleaseEvidenceBundleHash(releaseFields);
  const expected: Array<[string, string | undefined]> = [
    ["releaseSupplyChainRecordSha256", `sha256:${sha256(releaseRecord)}`],
    ["releaseEvidenceRecordSha256", `sha256:${sha256(releaseEvidenceRecord)}`],
    ["releaseSupplyChainEvidenceHash", expectedSupplyHash],
    ["releaseEvidenceBundleHash", expectedReleaseHash],
  ];
  for (const [field, value] of expected) {
    if (fields.get(field) !== value) issues.push({ field, message: "must bind the supplied Release evidence" });
  }
  if (releaseFields.get("releaseEvidenceBundleHash") !== expectedReleaseHash) issues.push({ field: "releaseEvidence.releaseEvidenceBundleHash", message: "must be canonical" });
  if (releaseFields.get("releaseSupplyChainEvidenceHash") !== expectedSupplyHash) {
    issues.push({ field: "releaseEvidence.releaseSupplyChainEvidenceHash", message: "must match the supplied strict Release supply-chain record" });
  }
  const identityFields = ["releaseTag", "gitCommit", "webImageDigest", "migrationImageDigest", "migrationVersion", "migrationRunner", "databaseBackupSha256", "rollbackTargetImage"];
  for (const field of identityFields) {
    const expectedValue = field === "migrationVersion" ? migrationVersion : fields.get(field);
    if (releaseFields.get(field) !== expectedValue) issues.push({ field: `releaseEvidence.${field}`, message: "must match OPS-006 production evidence" });
  }
  if (releaseFields.get("migrationApplied") !== "yes") issues.push({ field: "releaseEvidence.migrationApplied", message: "must be yes" });
  if (releaseFields.get("attachmentReconciliationStatus") !== "pass") issues.push({ field: "releaseEvidence.attachmentReconciliationStatus", message: "must be pass" });
  const rollbackTarget = fields.get("rollbackTargetImage") ?? "";
  const previousImage = rollbackTarget.split("@")[0] ?? "";
  const previousVersion = rollbackTarget.match(/:v(\d+\.\d+\.\d+)@sha256:/i)?.[1] ?? "";
  if (releaseFields.get("previousImage") !== previousImage) {
    issues.push({ field: "releaseEvidence.previousImage", message: "must match the immutable rollback target repository and tag" });
  }
  if (releaseFields.get("previousAppVersion") !== previousVersion) {
    issues.push({ field: "releaseEvidence.previousAppVersion", message: "must match the immutable rollback target version" });
  }
  for (const field of ["postReleaseSmoke.health", "postReleaseSmoke.login", "postReleaseSmoke.dashboard", "postReleaseSmoke.taskTimerReview", "postReleaseSmoke.syllabusNotesAnalyticsReports", "postReleaseSmoke.attachmentSmoke", "postReleaseSmoke.aiFallbackOrProvider"]) {
    if (releaseFields.get(field)?.toLowerCase() !== "pass") issues.push({ field: `releaseEvidence.${field}`, message: "must be pass" });
  }
  return issues;
}

function validateFreshness(fields: Map<string, string>, options: Ops006ValidationOptions, issues: ValidationIssue[]): void {
  const recordMaxAge = Number(fields.get("evidenceFreshnessMaxAgeHours"));
  if (recordMaxAge !== evidenceFreshnessMaxAgeHours) {
    issues.push({ field: "evidenceFreshnessMaxAgeHours", message: `must equal ${evidenceFreshnessMaxAgeHours}` });
    return;
  }
  const override = options.maxAgeHours;
  if (override !== undefined && (!Number.isFinite(override) || override < 1 || override > evidenceFreshnessMaxAgeHours)) {
    issues.push({ field: "maxAgeHours", message: `override must be finite, positive, and no greater than ${evidenceFreshnessMaxAgeHours}` });
    return;
  }
  if (options.now && !Number.isFinite(options.now.getTime())) {
    issues.push({ field: "now", message: "must be a valid timestamp" });
    return;
  }
  validateTimestampFreshness(fields.get("recordedAt") ?? "", "recordedAt", { ...options, maxAgeHours: override ?? recordMaxAge }, issues);
}

function validateTimestampFreshness(value: string, field: string, options: Ops006ValidationOptions, issues: ValidationIssue[]): void {
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  if (!Number.isFinite(timestamp) || parsed.toISOString() !== value) {
    issues.push({ field, message: "must be a canonical ISO-8601 UTC timestamp" });
    return;
  }
  const currentTime = (options.now ?? new Date()).getTime();
  const maxAge = options.maxAgeHours ?? 24;
  if (!Number.isFinite(currentTime) || !Number.isFinite(maxAge) || maxAge < 1 || maxAge > 168) {
    issues.push({ field, message: "freshness clock and window must be valid" });
    return;
  }
  const ageHours = (currentTime - timestamp) / 3_600_000;
  if (ageHours < -0.5) issues.push({ field, message: "must not be more than 30 minutes in the future" });
  if (ageHours > maxAge) issues.push({ field, message: `evidence is stale; age ${ageHours.toFixed(1)}h exceeds ${maxAge}h` });
}

function requireExactKeys(value: JsonRecord, keys: string[], field: string, issues: ValidationIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    issues.push({ field, message: "fields are incomplete or unknown" });
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function prefixedHash(value: string): string {
  return value ? `sha256:${sha256(value)}` : "";
}

function readGitObject(gitCommit: string, file: string, root: string): string {
  if (!/^[a-f0-9]{40}$/i.test(gitCommit)) throw new Error("invalid git commit");
  const object = `${gitCommit}:${file}`;
  const type = execFileSync("git", ["cat-file", "-t", object], { cwd: root, encoding: "utf8" }).trim();
  if (type !== "blob") throw new Error("source is not a Git blob");
  const source = execFileSync("git", ["show", object], { cwd: root, encoding: "utf8" });
  if (!source) throw new Error("source Git blob is empty");
  return source;
}

function main(): void {
  if (process.argv[2] === "--print-confirmation-scopes") {
    const draftPath = process.argv[3];
    if (!draftPath) {
      console.error("Usage: pnpm ops:ops-006:confirmation-scopes <production-record-draft>");
      process.exit(2);
    }
    try {
      console.log(JSON.stringify({
        schemaVersion: 1,
        mode: "read_only_ops006_confirmation_scopes",
        ...calculateOps006ConfirmationScopes(readRequiredFile(path.resolve(draftPath))),
        safetyFacts: {
          readOnly: true,
          networkRequested: false,
          productionWriteAttempted: false,
          serverCommandAttempted: false,
          secretValuePrinted: false,
        },
      }, null, 2));
      return;
    } catch (error) {
      console.error(`OPS-006 confirmation scope calculation failed: ${error instanceof Error ? error.message : "invalid draft"}`);
      process.exit(1);
    }
  }
  const [recordPath, releaseRecordPath, releaseAssetsDir, releaseEvidencePath, reconciliationCsvPath, reconciliationSummaryPath] = process.argv.slice(2);
  if (!recordPath || !releaseRecordPath || !releaseAssetsDir || !releaseEvidencePath || !reconciliationCsvPath || !reconciliationSummaryPath) {
    console.error("Usage: pnpm ops:ops-006:evidence:validate <record> <release-record> <release-assets-dir> <release-evidence-record> <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>");
    process.exit(2);
  }
  const raw = readRequiredFile(path.resolve(recordPath));
  const releaseRecord = readRequiredFile(path.resolve(releaseRecordPath));
  const releaseEvidence = readRequiredFile(path.resolve(releaseEvidencePath));
  const issues = validateOps006ProductionEvidenceBundle(raw, releaseRecord, releaseEvidence, {
    now: process.env.AREAFORGE_OPS006_NOW ? new Date(process.env.AREAFORGE_OPS006_NOW) : undefined,
    maxAgeHours: process.env.AREAFORGE_OPS006_MAX_AGE_HOURS ? Number(process.env.AREAFORGE_OPS006_MAX_AGE_HOURS) : undefined,
    evidenceBaseDir: path.dirname(path.resolve(recordPath)),
    releaseAssetsDir: path.resolve(releaseAssetsDir),
    releaseEvidenceCsv: readRequiredFile(path.resolve(reconciliationCsvPath)),
    releaseEvidenceSummary: readRequiredFile(path.resolve(reconciliationSummaryPath)),
    cosignPublicKey: process.env.AREAFORGE_COSIGN_PUBLIC_KEY?.trim() || path.join(process.cwd(), "docs/deployment/keys/areaforge-cosign.pub"),
  });
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`OPS-006 production evidence validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("OPS-006 production evidence validation passed: signed Release, source-at-commit, production doctor, rollout, concurrency probe, release evidence, and rollback bindings are valid.");
  console.log(`ops006ProductionEvidenceRecordHash: sha256:${sha256(raw)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
