import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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

const defaultUxRecord = "docs/development/product-experience-review-v0.1.7-20260712-local.md";
const defaultOps004AlertPreview = "docs/development/ops-004-alert-preview-v0.1.7-20260712.json";
const defaultOps004AlertDrillRecord = "docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt";
const defaultReleaseSupplyChainRecord = "docs/development/release-supply-chain-v0.1.7.md";
const defaultReleaseRecord = "docs/development/release-v0.1.7-record.md";
const defaultMaxUxAgeDays = 14;

function main(): void {
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
      key: "supplyChain",
      label: "signed Release supply-chain evidence",
      command: ["pnpm", "exec", "tsx", "scripts/ops/sc002-supply-chain-preflight.ts"],
      env: defaultSupplyChainEvidenceEnv(),
      expectedStatus: "ready_for_sc001_sc002_review",
      residualRiskIds: ["AF-RISK-SC-001", "AF-RISK-SC-002"],
    }),
    validateReleaseEvidenceRecord(),
    validateFreshUxRecord(),
  ];

  const status = gateStatus(checks);
  const result = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    mode: "read_only_long_term_operability_live_gate",
    status,
    checks,
    requiredEvidence: [
      "AF-RISK-OPS-001 ready_for_human_close: production read-only smoke record, redacted update-agent status, operational evidence bundle, and OPS-001 closure packet",
      "AF-RISK-OPS-001 blocked_on_prerequisite records are valid blocker evidence only; they do not satisfy long-term operability",
      "AF-RISK-OPS-004 ready_for_human_close: alert preview plus matching alert/recovery drill record",
      "AF-RISK-SC-001/AF-RISK-SC-002 ready_for_sc001_sc002_review: signed Release supply-chain record with SBOM/provenance/checksum/signature and Actions pinning evidence",
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
}): CheckResult {
  const { env: commandEnv, ...checkInput } = input;
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

function validateReleaseEvidenceRecord(): CheckResult {
  const recordPath = path.resolve(process.env.AREAFORGE_LONG_TERM_RELEASE_RECORD?.trim() || defaultReleaseRecord);
  const command = `pnpm exec tsx scripts/quality/release-evidence-validate.ts ${redactedPathLabel(recordPath)}`;
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

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/release-evidence-validate.ts", recordPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (validation.status === 0) {
    return {
      key: "releaseEvidence",
      label: "production release evidence record",
      status: "pass",
      detail: "release evidence validator passed",
      command,
      residualRiskIds: ["AF-RISK-REL-001", "AF-RISK-OPS-001"],
    };
  }

  const detail = sanitizeOutput(validation.stderr || validation.stdout || "release evidence validator failed");
  return {
    key: "releaseEvidence",
    label: "production release evidence record",
    status: releaseEvidenceFailureIsPotentialSecret(detail) ? "invalid" : "missing",
    detail,
    command,
    residualRiskIds: ["AF-RISK-REL-001", "AF-RISK-OPS-001"],
  };
}

function releaseEvidenceFailureIsPotentialSecret(detail: string): boolean {
  return /\b(secret|token|password|database url|bearer|api key|leak)\b/i.test(detail);
}

function validateFreshUxRecord(): CheckResult {
  const recordPath = path.resolve(process.env.AREAFORGE_LONG_TERM_UX_RECORD?.trim() || defaultUxRecord);
  const command = `pnpm exec tsx scripts/quality/product-experience-review-validate.ts ${redactedPathLabel(recordPath)}`;
  if (!existsSync(recordPath)) {
    return {
      key: "uxReview",
      label: "fresh desktop/mobile product experience review",
      status: "missing",
      detail: "product experience review record is missing",
      command,
      residualRiskIds: ["AF-RISK-UX-001"],
    };
  }

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/product-experience-review-validate.ts", recordPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    return {
      key: "uxReview",
      label: "fresh desktop/mobile product experience review",
      status: "invalid",
      detail: sanitizeOutput(validation.stderr || validation.stdout || "product experience review validator failed"),
      command,
      residualRiskIds: ["AF-RISK-UX-001"],
    };
  }

  const fields = parseIndentedKeyValueRecord(readFileSync(recordPath, "utf8"));
  const appVersion = fields.get("appVersion");
  const requiredVersion = expectedVersion();
  if (appVersion !== requiredVersion) {
    return {
      key: "uxReview",
      label: "fresh desktop/mobile product experience review",
      status: "invalid",
      detail: `appVersion must be ${requiredVersion}, got ${appVersion || "missing"}`,
      command,
      residualRiskIds: ["AF-RISK-UX-001"],
    };
  }

  const reviewedAt = fields.get("reviewedAt");
  if (!reviewedAt) {
    return {
      key: "uxReview",
      label: "fresh desktop/mobile product experience review",
      status: "invalid",
      detail: "reviewedAt is missing",
      command,
      residualRiskIds: ["AF-RISK-UX-001"],
    };
  }

  const ageDays = ageInDays(reviewedAt);
  if (!Number.isFinite(ageDays)) {
    return {
      key: "uxReview",
      label: "fresh desktop/mobile product experience review",
      status: "invalid",
      detail: "reviewedAt is not a valid date",
      command,
      residualRiskIds: ["AF-RISK-UX-001"],
    };
  }
  if (ageDays > maxUxAgeDays()) {
    return {
      key: "uxReview",
      label: "fresh desktop/mobile product experience review",
      status: "stale",
      detail: `review is ${ageDays.toFixed(1)} days old; max allowed is ${maxUxAgeDays()} days`,
      command,
      residualRiskIds: ["AF-RISK-UX-001"],
    };
  }

  return {
    key: "uxReview",
    label: "fresh desktop/mobile product experience review",
    status: "pass",
    detail: `validator passed; appVersion=${requiredVersion}; review is ${ageDays.toFixed(1)} days old`,
    command,
    residualRiskIds: ["AF-RISK-UX-001"],
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
  if (check.key === "supplyChain") return "signed Release supply-chain evidence";
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

function ageInDays(value: string): number {
  const reviewedAt = new Date(value);
  if (Number.isNaN(reviewedAt.getTime())) return Number.NaN;
  const ageMs = now().getTime() - reviewedAt.getTime();
  return Math.max(0, ageMs / 86_400_000);
}

function maxUxAgeDays(): number {
  const raw = process.env.AREAFORGE_LONG_TERM_UX_MAX_AGE_DAYS;
  if (!raw) return defaultMaxUxAgeDays;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMaxUxAgeDays;
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

main();
