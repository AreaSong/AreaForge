import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolveReleaseEvidenceValidationArgs,
  validateReleaseEvidenceBundle,
} from "../quality/release-evidence-validate";
import { validateDataIntegrityDoctor } from "../quality/data-integrity-doctor-validate";
import { evaluateProductExperienceEvidence } from "../quality/product-experience-review-validate";
import {
  parseStrictIndentedKeyValueRecord,
  sha256,
  type ValidationIssue,
} from "../quality/record-validator-common";

type CheckStatus = "pass" | "missing" | "stale" | "invalid";
type GateStatus = "ready_for_long_term_operability_review" | "needs_live_evidence" | "invalid";

type JsonRecord = Record<string, unknown>;

type CheckResult = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  command: string;
  expectedStatus?: string;
  actualStatus?: string;
  residualRiskIds: string[];
};

export type DoctorBinding = {
  fileSha256: string;
  doctorHash: string;
};

export type ReleaseEvidenceBinding = {
  recordSha256: string;
  bundleHash: string;
  releaseTag: string;
  gitCommit: string;
  webImageDigest: string;
  migrationImageDigest: string;
};

const defaultOps004AlertPreview = "docs/development/ops-004-alert-preview-v0.1.7-20260712.json";
const defaultOps004AlertDrillRecord = "docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt";
const defaultReleaseSupplyChainRecord = "docs/development/release-supply-chain-v0.1.7.md";
const defaultReleaseRecord = "docs/development/release-v0.1.7-record.md";
const defaultMaxUxAgeDays = 14;
const defaultMaxDataIntegrityAgeHours = 24;

function main(): void {
  const ops006 = runOps006ProductionCheck();
  const checks: CheckResult[] = [
    runCommandCheck({
      key: "controlPlane",
      label: "enterprise operability control plane",
      command: ["pnpm", "exec", "tsx", "scripts/quality/enterprise-operability-preflight.ts"],
      residualRiskIds: [],
    }),
    runJsonStatusCheck({
      key: "ops001",
      label: "OPS-001 production read-only smoke and update-agent evidence",
      command: ["pnpm", "exec", "tsx", "scripts/ops/ops001-evidence-preflight.ts"],
      expectedStatus: "ready_for_human_close",
      residualRiskIds: ["AF-RISK-OPS-001"],
    }),
    runJsonStatusCheck({
      key: "ops004",
      label: "OPS-004 alert and recovery drill evidence",
      command: ["pnpm", "exec", "tsx", "scripts/ops/ops004-alert-evidence-preflight.ts"],
      env: defaultOps004EvidenceEnv(),
      expectedStatus: "ready_for_human_close",
      residualRiskIds: ["AF-RISK-OPS-004"],
    }),
    runJsonStatusCheck({
      key: "ops005",
      label: "OPS-005 expected-before V2 release and production evidence",
      command: ["pnpm", "exec", "tsx", "scripts/ops/ops005-evidence-preflight.ts"],
      expectedStatus: "ready_for_ops005_human_review",
      residualRiskIds: ["AF-RISK-OPS-005"],
    }),
    ops006.check,
    validateFreshDataIntegrityRecord(ops006.binding),
    runJsonStatusCheck({
      key: "supplyChain",
      label: "signed Release supply-chain evidence",
      command: ["pnpm", "exec", "tsx", "scripts/ops/sc002-supply-chain-preflight.ts"],
      env: defaultSupplyChainEvidenceEnv(),
      expectedStatus: "ready_for_sc001_sc002_review",
      residualRiskIds: ["AF-RISK-SC-001", "AF-RISK-SC-002"],
    }),
    validateReleaseEvidenceRecord(ops006.releaseBinding),
    validateFreshUxRecord(),
  ];

  const status = gateStatus(checks);
  const result = {
    schemaVersion: 3,
    generatedAt: now().toISOString(),
    mode: "read_only_long_term_operability_live_gate",
    status,
    checks,
    requiredEvidence: [
      "AF-RISK-OPS-001 ready_for_human_close: production read-only smoke record, redacted update-agent status, operational evidence bundle, and OPS-001 closure packet",
      "AF-RISK-OPS-001 blocked_on_prerequisite records are valid blocker evidence only; they do not satisfy long-term operability",
      "AF-RISK-OPS-004 ready_for_human_close: alert preview plus matching alert/recovery drill record",
      "AF-RISK-OPS-005 ready_for_ops005_human_review: V2 local implementation, matching signed Release, fresh redacted production deployment evidence, V2 check, expected-before rejection executionAttempted=no, shared lock, processing reconciliation, and autoApply=none",
      "AF-RISK-OPS-006 ready_for_ops006_human_review: local verification, strict signed Release, source-at-commit migration/implementation hashes, separately confirmed production rollout, canonical index readback, health/authenticated smoke, controlled synthetic 409 and single-side-effect probe, before/after doctor, Release evidence, and rollback target",
      "Fresh data integrity doctor: strict redacted record validation, configured read-only database aggregation, attachment reconciliation and overall pass; file SHA and doctorHash must equal the OPS-006 after-doctor binding",
      "AF-RISK-SC-001/AF-RISK-SC-002 ready_for_sc001_sc002_review: clean current checkout is the signed Release commit or a validated evidence-only closeout descendant, with SBOM/provenance/checksum/signature and Actions pinning evidence",
      "Production release evidence record: pnpm release:evidence:validate passes with database, uploads, env backup SHA256 evidence, rollback target, migration result, smoke result, and residual risk fields",
      `AF-RISK-UX-001 fresh product experience review: pnpm experience:review:validate passes, appVersion equals ${expectedVersion()}, and reviewedAt is within ${maxUxAgeDays()} days`,
    ],
    nextCommand: nextCommand(status, checks),
    forbiddenActions: [
      "execute_server_command",
      "create_github_release",
      "push_git_tag",
      "download_release_assets",
      "call_github_api",
      "apply_update",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "read_or_print_secret_values",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      githubApiCalled: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      updaterApplyAttempted: false,
      residualLedgerUpdated: false,
      secretValuePrinted: false,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (status !== "ready_for_long_term_operability_review") {
    process.exit(1);
  }
}

function runCommandCheck(input: {
  key: string;
  label: string;
  command: string[];
  residualRiskIds: string[];
}): CheckResult {
  const result = spawnSync(input.command[0] ?? "pnpm", input.command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) {
    return {
      ...input,
      status: "pass",
      detail: "command passed",
      command: input.command.join(" "),
    };
  }
  return {
    ...input,
    status: "invalid",
    detail: sanitizeOutput(result.stderr || result.stdout || "command failed"),
    command: input.command.join(" "),
  };
}

function runJsonStatusCheck(input: {
  key: string;
  label: string;
  command: string[];
  env?: Record<string, string>;
  expectedStatus: string;
  residualRiskIds: string[];
  validateParsed?: (value: JsonRecord) => string | null;
}): CheckResult {
  const { env: commandEnv, validateParsed, ...checkInput } = input;
  const result = spawnSync(input.command[0] ?? "pnpm", input.command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...commandEnv,
    },
  });
  if (result.status !== 0) {
    return {
      ...checkInput,
      status: "invalid",
      command: input.command.join(" "),
      detail: sanitizeOutput(result.stderr || result.stdout || "preflight command failed"),
    };
  }

  let parsed: JsonRecord;
  try {
    parsed = parseJsonFromLog(result.stdout) as JsonRecord;
  } catch (error) {
    return {
      ...checkInput,
      status: "invalid",
      command: input.command.join(" "),
      detail: error instanceof Error ? error.message : "preflight output is not JSON",
    };
  }

  const actualStatus = String(parsed.status ?? "missing");
  if (actualStatus === input.expectedStatus) {
    const parsedIssue = validateParsed?.(parsed);
    if (parsedIssue) {
      return {
        ...checkInput,
        status: "invalid",
        command: input.command.join(" "),
        actualStatus,
        detail: parsedIssue,
      };
    }
    return {
      ...checkInput,
      status: "pass",
      command: input.command.join(" "),
      actualStatus,
      detail: `${input.label} preflight reached ${actualStatus}`,
    };
  }

  return {
    ...checkInput,
    status: actualStatus === "invalid" ? "invalid" : "missing",
    command: input.command.join(" "),
    actualStatus,
    detail: `expected ${input.expectedStatus}, got ${actualStatus}`,
  };
}

function runOps006ProductionCheck(): {
  check: CheckResult;
  binding: DoctorBinding | null;
  releaseBinding: ReleaseEvidenceBinding | null;
} {
  let binding: DoctorBinding | null = null;
  let releaseBinding: ReleaseEvidenceBinding | null = null;
  const check = runJsonStatusCheck({
    key: "ops006",
    label: "OPS-006 production concurrency and data-integrity evidence",
    command: ["pnpm", "exec", "tsx", "scripts/ops/ops006-production-evidence-preflight.ts"],
    expectedStatus: "ready_for_ops006_human_review",
    residualRiskIds: ["AF-RISK-OPS-006"],
    validateParsed: (value) => {
      const parsed = extractOps006EvidenceBindings(value);
      binding = parsed.doctorBinding;
      releaseBinding = parsed.releaseBinding;
      return parsed.issue;
    },
  });
  return { check, binding, releaseBinding };
}

export function extractOps006EvidenceBindings(value: JsonRecord): {
  issue: string | null;
  doctorBinding: DoctorBinding | null;
  releaseBinding: ReleaseEvidenceBinding | null;
} {
  const evidence = value.evidence;
  if (!isRecord(evidence)) {
    return { issue: "OPS-006 preflight output is missing evidence binding", doctorBinding: null, releaseBinding: null };
  }
  const doctorBinding = {
    fileSha256: String(evidence.afterDoctorFileSha256 ?? ""),
    doctorHash: String(evidence.afterDoctorHash ?? ""),
  };
  if (!/^sha256:[a-f0-9]{64}$/.test(doctorBinding.fileSha256)
    || !/^sha256:[a-f0-9]{64}$/.test(doctorBinding.doctorHash)) {
    return { issue: "OPS-006 preflight after-doctor SHA/hash binding is invalid", doctorBinding: null, releaseBinding: null };
  }
  const releaseBinding: ReleaseEvidenceBinding = {
    recordSha256: String(evidence.releaseEvidenceRecordSha256 ?? ""),
    bundleHash: String(evidence.releaseEvidenceBundleHash ?? ""),
    releaseTag: String(evidence.releaseTag ?? ""),
    gitCommit: String(evidence.gitCommit ?? ""),
    webImageDigest: String(evidence.webImageDigest ?? ""),
    migrationImageDigest: String(evidence.migrationImageDigest ?? ""),
  };
  if (!/^sha256:[a-f0-9]{64}$/.test(releaseBinding.recordSha256)
    || !/^sha256:[a-f0-9]{64}$/.test(releaseBinding.bundleHash)
    || !/^v\d+\.\d+\.\d+$/.test(releaseBinding.releaseTag)
    || !/^[a-f0-9]{40}$/.test(releaseBinding.gitCommit)
    || !/@sha256:[a-f0-9]{64}$/.test(releaseBinding.webImageDigest)
    || !/@sha256:[a-f0-9]{64}$/.test(releaseBinding.migrationImageDigest)) {
    return { issue: "OPS-006 preflight Release evidence binding is invalid", doctorBinding: null, releaseBinding: null };
  }
  return { issue: null, doctorBinding, releaseBinding };
}

function defaultOps004EvidenceEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.AREAFORGE_OPS004_ALERT_PREVIEW === undefined && existsSync(path.resolve(defaultOps004AlertPreview))) {
    env.AREAFORGE_OPS004_ALERT_PREVIEW = defaultOps004AlertPreview;
  }
  if (process.env.AREAFORGE_OPS004_ALERT_DRILL_RECORD === undefined && existsSync(path.resolve(defaultOps004AlertDrillRecord))) {
    env.AREAFORGE_OPS004_ALERT_DRILL_RECORD = defaultOps004AlertDrillRecord;
  }
  return env;
}

function defaultSupplyChainEvidenceEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.AREAFORGE_SC002_RELEASE_RECORD === undefined && existsSync(path.resolve(defaultReleaseSupplyChainRecord))) {
    env.AREAFORGE_SC002_RELEASE_RECORD = defaultReleaseSupplyChainRecord;
  }
  return env;
}

export function validateReleaseEvidenceRecord(
  expected: ReleaseEvidenceBinding | null,
  options: { configuredPath?: string; root?: string } = {},
): CheckResult {
  const root = path.resolve(options.root ?? process.cwd());
  const configuredPath = options.configuredPath?.trim()
    || process.env.AREAFORGE_LONG_TERM_RELEASE_RECORD?.trim()
    || defaultReleaseRecord;
  const recordPath = path.resolve(root, configuredPath);
  const command = `pnpm exec tsx scripts/quality/release-evidence-validate.ts ${redactedPathLabel(recordPath)} <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>`;
  if (!existsSync(recordPath)) {
    return {
      key: "releaseEvidence",
      label: "production release evidence record",
      status: "missing",
      detail: "release evidence record is missing",
      command,
      residualRiskIds: ["AF-RISK-REL-001", "AF-RISK-OPS-001"],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(recordPath, "utf8");
  } catch {
    return releaseEvidenceResult("invalid", "release evidence record could not be read safely", command);
  }
  const parseIssues: ValidationIssue[] = [];
  parseStrictIndentedKeyValueRecord(raw, parseIssues);
  if (parseIssues.length > 0) {
    return releaseEvidenceResult("invalid", releaseEvidenceIssueDetail(parseIssues), command);
  }
  const recordOnlyIssues = validateReleaseEvidenceBundle(raw).filter((issue) => !new Set([
    "attachmentReconciliation",
    "attachmentReconciliationSummary",
  ]).has(issue.field));
  if (recordOnlyIssues.length > 0) {
    return releaseEvidenceResult("invalid", releaseEvidenceIssueDetail(recordOnlyIssues), command);
  }
  const validationArgs = resolveReleaseEvidenceValidationArgs(recordPath, root, raw);
  const csvPath = validationArgs[1];
  const summaryPath = validationArgs[2];
  if (!csvPath || !summaryPath || !existsSync(csvPath) || !existsSync(summaryPath)) {
    return releaseEvidenceResult("missing", "release evidence reconciliation CSV and summary are missing", command);
  }
  let csv: string;
  let summary: string;
  try {
    csv = readFileSync(csvPath, "utf8");
    summary = readFileSync(summaryPath, "utf8");
  } catch {
    return releaseEvidenceResult("invalid", "release evidence reconciliation files could not be read safely", command);
  }
  const issues = validateReleaseEvidenceBundle(raw, csv, summary);
  if (issues.length > 0) {
    return releaseEvidenceResult("invalid", releaseEvidenceIssueDetail(issues), command);
  }
  if (expected && releaseEvidenceBindingIssue(raw, expected)) {
    return releaseEvidenceResult(
      "invalid",
      "release evidence must be the same record and Release identity bound by OPS-006",
      command,
      ["AF-RISK-REL-001", "AF-RISK-OPS-001", "AF-RISK-OPS-006"],
    );
  }
  return releaseEvidenceResult("pass", "release evidence validator passed", command);
}

export function releaseEvidenceBindingIssue(
  record: string,
  expected: ReleaseEvidenceBinding,
): string | null {
  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(record, parseIssues);
  if (parseIssues.length > 0) return "release evidence record is malformed or contains duplicate fields";
  const mismatches = [
    expected.recordSha256 !== `sha256:${sha256(record)}`,
    expected.bundleHash !== fields.get("releaseEvidenceBundleHash"),
    expected.releaseTag !== fields.get("releaseTag"),
    expected.gitCommit !== fields.get("gitCommit"),
    expected.webImageDigest !== fields.get("webImageDigest"),
    expected.migrationImageDigest !== fields.get("migrationImageDigest"),
  ];
  return mismatches.some(Boolean)
    ? "release evidence must be the same record and Release identity bound by OPS-006"
    : null;
}

function releaseEvidenceResult(
  status: CheckStatus,
  detail: string,
  command: string,
  residualRiskIds = ["AF-RISK-REL-001", "AF-RISK-OPS-001"],
): CheckResult {
  return {
    key: "releaseEvidence",
    label: "production release evidence record",
    status,
    detail,
    command,
    residualRiskIds,
  };
}

function releaseEvidenceIssueDetail(issues: Array<{ field: string; message: string }>): string {
  return sanitizeOutput(issues.slice(0, 8).map((issue) => `${issue.field}: ${issue.message}`).join("; "));
}

function validateFreshUxRecord(): CheckResult {
  const evaluation = evaluateProductExperienceEvidence({
    configuredPath: process.env.AREAFORGE_LONG_TERM_UX_RECORD,
    now: now(),
    maxAgeSeconds: maxUxAgeDays() * 24 * 60 * 60,
    expectedVersion: expectedVersion(),
  });

  return {
    key: "uxReview",
    label: "fresh desktop/mobile product experience review",
    status: evaluation.status === "fresh" ? "pass" : evaluation.status,
    detail: evaluation.detail,
    command: evaluation.command,
    residualRiskIds: ["AF-RISK-UX-001"],
  };
}

export function validateFreshDataIntegrityRecord(
  expectedBinding: DoctorBinding | null,
  options: { configuredPath?: string; currentTime?: Date; maxAgeHours?: number } = {},
): CheckResult {
  const configured = options.configuredPath ?? process.env.AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD?.trim();
  const currentTime = options.currentTime ?? now();
  const maxAgeHours = options.maxAgeHours ?? maxDataIntegrityAgeHours();
  const command = "pnpm ops:data-integrity:validate <data-integrity-doctor.json>";
  if (!configured) {
    return {
      key: "dataIntegrity",
      label: "fresh business data integrity doctor",
      status: "missing",
      detail: "AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD is not configured",
      command,
      residualRiskIds: ["AF-RISK-OPS-006"],
    };
  }
  const recordPath = path.resolve(configured);
  if (!existsSync(recordPath)) {
    return {
      key: "dataIntegrity",
      label: "fresh business data integrity doctor",
      status: "missing",
      detail: "data integrity doctor record is missing",
      command,
      residualRiskIds: ["AF-RISK-OPS-006"],
    };
  }
  const raw = readFileSync(recordPath, "utf8");
  const issues = validateDataIntegrityDoctor(raw);
  if (issues.length > 0) {
    return {
      key: "dataIntegrity",
      label: "fresh business data integrity doctor",
      status: "invalid",
      detail: sanitizeOutput(issues.join("; ")),
      command,
      residualRiskIds: ["AF-RISK-OPS-006"],
    };
  }
  const body = JSON.parse(raw) as JsonRecord;
  const status = body.status as JsonRecord;
  const safety = body.safetyFacts as JsonRecord;
  const source = body.source as JsonRecord;
  const checks = body.checks as JsonRecord[];
  const attachment = checks.find((item) => item.id === "attachments.reconciliation");
  if (
    status.overall !== "pass" ||
    source.database !== "configured_read_only_query" ||
    safety.databaseReadAttempted !== true ||
    attachment?.status !== "pass"
  ) {
    return {
      key: "dataIntegrity",
      label: "fresh business data integrity doctor",
      status: "missing",
      detail: "doctor record must declare configured_read_only_query, databaseReadAttempted=true, overall=pass, and attachment reconciliation pass",
      command,
      residualRiskIds: ["AF-RISK-OPS-006"],
    };
  }
  const generatedAt = new Date(String(body.generatedAt ?? ""));
  const ageHours = (currentTime.getTime() - generatedAt.getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < -5 / 60) {
    return {
      key: "dataIntegrity",
      label: "fresh business data integrity doctor",
      status: "invalid",
      detail: "doctor generatedAt is invalid or in the future",
      command,
      residualRiskIds: ["AF-RISK-OPS-006"],
    };
  }
  if (ageHours > maxAgeHours) {
    return {
      key: "dataIntegrity",
      label: "fresh business data integrity doctor",
      status: "stale",
      detail: `doctor is ${ageHours.toFixed(1)} hours old; max allowed is ${maxAgeHours} hours`,
      command,
      residualRiskIds: ["AF-RISK-OPS-006"],
    };
  }
  if (expectedBinding) {
    const fileSha256 = `sha256:${sha256(raw)}`;
    const doctorHash = String(body.doctorHash ?? "");
    if (fileSha256 !== expectedBinding.fileSha256 || doctorHash !== expectedBinding.doctorHash) {
      return {
        key: "dataIntegrity",
        label: "fresh business data integrity doctor",
        status: "invalid",
        detail: "configured doctor must match the OPS-006 after-doctor file SHA and canonical doctorHash",
        command,
        residualRiskIds: ["AF-RISK-OPS-006"],
      };
    }
  }
  return {
    key: "dataIntegrity",
    label: "fresh business data integrity doctor",
    status: "pass",
    detail: `strict validator passed; record declares a read-only database query and is ${Math.max(0, ageHours).toFixed(1)} hours old`,
    command,
    residualRiskIds: ["AF-RISK-OPS-006"],
  };
}

function gateStatus(checks: CheckResult[]): GateStatus {
  if (checks.some((check) => check.status === "invalid")) return "invalid";
  if (checks.some((check) => check.status !== "pass")) return "needs_live_evidence";
  return "ready_for_long_term_operability_review";
}

function nextCommand(status: GateStatus, checks: CheckResult[]): string {
  if (status === "ready_for_long_term_operability_review") {
    return "review residual close conditions and update residual ledger only after human approval";
  }
  if (status === "invalid") {
    return "fix invalid evidence or validators, then rerun pnpm ops:long-term:gate";
  }
  const missing = checks
    .filter((check) => check.status !== "pass")
    .map((check) => missingEvidenceLabel(check));
  return `collect missing live evidence for ${missing.join(", ") || "the remaining checks"}, then rerun pnpm ops:long-term:gate`;
}

function missingEvidenceLabel(check: CheckResult): string {
  if (check.key === "ops001") return "OPS-001 production read-only smoke/update-agent evidence";
  if (check.key === "ops004") return "OPS-004 alert/recovery drill evidence";
  if (check.key === "ops005") return `OPS-005 expected-before V2 staged evidence (${check.actualStatus ?? "missing"})`;
  if (check.key === "ops006") return `OPS-006 signed Release, confirmed production rollout, controlled probe, and doctor evidence (${check.actualStatus ?? "missing"})`;
  if (check.key === "dataIntegrity") return "fresh validated business data integrity doctor with attachment reconciliation";
  if (check.key === "supplyChain") return "clean current-checkout CI or signed Release supply-chain evidence";
  if (check.key === "releaseEvidence") {
    return "production release evidence backup/hash record; under no-secret scope, validate a server-side release evidence redacted export with pnpm release:evidence:redacted-export:validate <redacted-export-dir>";
  }
  if (check.key === "uxReview") return "fresh product experience review";
  return check.label;
}

function parseJsonFromLog(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const jsonLine = [...raw.split(/\r?\n/)]
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error("output does not contain JSON");
  }
  return JSON.parse(jsonLine);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maxUxAgeDays(): number {
  const raw = process.env.AREAFORGE_LONG_TERM_UX_MAX_AGE_DAYS;
  if (!raw) return defaultMaxUxAgeDays;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMaxUxAgeDays;
}

function maxDataIntegrityAgeHours(): number {
  const raw = process.env.AREAFORGE_LONG_TERM_DATA_INTEGRITY_MAX_AGE_HOURS;
  if (!raw) return defaultMaxDataIntegrityAgeHours;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMaxDataIntegrityAgeHours;
}

function expectedVersion(): string {
  const raw = process.env.AREAFORGE_LONG_TERM_EXPECTED_VERSION?.trim();
  if (raw) return raw;
  try {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // Fall through to the current release baseline used by the bundled default records.
  }
  return "0.1.7";
}

function now(): Date {
  const raw = process.env.AREAFORGE_LONG_TERM_GATE_NOW;
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function redactedPathLabel(filePath: string): string {
  return path.basename(filePath) || "<record>";
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, "<redacted-token>")
    .replace(/COSIGN_PASSWORD\s*=\s*\S+/gi, "COSIGN_PASSWORD=<redacted>")
    .replace(/\/[^\s:]+/g, "<redacted-path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
