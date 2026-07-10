import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const runPath = process.argv[2] ?? process.env.AREAFORGE_CI_RUN_JSON_FILE;

function main(): void {
  if (!runPath) {
    console.error("Usage: pnpm ci:supply-chain:record <github-workflow-run.json>");
    process.exit(2);
  }

  const run = parseJson(readRequiredFile(path.resolve(runPath)), "GitHub workflow run");
  const required = requiredEnv();
  if (required.missing.length > 0) {
    console.error(`FAIL CI supply-chain record generation: missing ${required.missing.join(", ")}`);
    process.exit(1);
  }

  const packageVersion = stringOrNull(process.env.AREAFORGE_CI_PACKAGE_VERSION) ?? packageJsonVersion();
  const recordedAt = stringOrNull(process.env.AREAFORGE_CI_SUPPLY_CHAIN_RECORDED_AT) ?? new Date().toISOString();
  const repository = stringOrNull(process.env.AREAFORGE_CI_REPOSITORY) ?? nestedString(run, ["repository", "full_name"]) ?? "AreaSong/AreaForge";
  const workflowName = stringOrNull(run.name) ?? stringOrNull(run.workflow_name) ?? "CI";
  const workflowRunUrl = stringOrNull(run.html_url) ?? stringOrNull(process.env.AREAFORGE_CI_WORKFLOW_RUN_URL);
  const workflowRunConclusion = stringOrNull(run.conclusion) ?? stringOrNull(process.env.AREAFORGE_CI_WORKFLOW_RUN_CONCLUSION);
  const gitCommit = stringOrNull(run.head_sha) ?? stringOrNull(process.env.AREAFORGE_CI_GIT_COMMIT);
  const headBranch = stringOrNull(run.head_branch) ?? stringOrNull(process.env.AREAFORGE_CI_HEAD_BRANCH) ?? "unknown";

  const missingRun = [
    workflowRunUrl ? null : "workflow run URL",
    workflowRunConclusion ? null : "workflow run conclusion",
    gitCommit ? null : "git commit",
  ].filter(Boolean);
  if (missingRun.length > 0) {
    console.error(`FAIL CI supply-chain record generation: missing ${missingRun.join(", ")}`);
    process.exit(1);
  }

  const record = [
    `recordId: ${stringOrNull(process.env.AREAFORGE_CI_SUPPLY_CHAIN_RECORD_ID) ?? `ci-supply-chain-${compactTimestamp(recordedAt)}`}`,
    `recordedAt: ${recordedAt}`,
    "workflowKind: ci",
    `repository: ${repository}`,
    `workflowName: ${workflowName}`,
    `workflowRunUrl: ${workflowRunUrl}`,
    `workflowRunConclusion: ${workflowRunConclusion}`,
    `gitCommit: ${gitCommit}`,
    `headBranch: ${headBranch}`,
    `packageVersion: ${packageVersion}`,
    `ciWorkflowStatus: ${required.values.ciWorkflowStatus}`,
    `auditProdStatus: ${required.values.auditProdStatus}`,
    `governancePreflightStatus: ${required.values.governancePreflightStatus}`,
    `actionsPinningStatus: ${required.values.actionsPinningStatus}`,
    `skillsValidateStatus: ${required.values.skillsValidateStatus}`,
    `releaseSupplyChainSelftestStatus: ${required.values.releaseSupplyChainSelftestStatus}`,
    `pinnedActionsCount: ${required.values.pinnedActionsCount}`,
    `unpinnedExternalActions: ${required.values.unpinnedExternalActions}`,
    `highCriticalVulnerabilities: ${required.values.highCriticalVulnerabilities}`,
    "residualRiskIds: AF-RISK-SC-002",
    `followUpTasks: ${stringOrNull(process.env.AREAFORGE_CI_SUPPLY_CHAIN_FOLLOW_UPS) ?? "tasks/indexes/residuals.md"}`,
    "safetyFacts:",
    "  secretsPrinted: no",
    "  productionEnvIncluded: no",
    "  backupIncluded: no",
    "  productionWriteAttempted: no",
    "  releaseCreated: no",
    "  tagPushed: no",
    "",
  ].join("\n");

  process.stdout.write(record);
}

function requiredEnv(): {
  missing: string[];
  values: {
    ciWorkflowStatus: "pass";
    auditProdStatus: "pass";
    governancePreflightStatus: "pass";
    actionsPinningStatus: "pass";
    skillsValidateStatus: "pass";
    releaseSupplyChainSelftestStatus: "pass";
    pinnedActionsCount: string;
    unpinnedExternalActions: "none";
    highCriticalVulnerabilities: "none";
  };
} {
  const entries = {
    ciWorkflowStatus: process.env.AREAFORGE_CI_WORKFLOW_STATUS === "pass" ? "pass" as const : null,
    auditProdStatus: process.env.AREAFORGE_AUDIT_PROD_STATUS === "pass" ? "pass" as const : null,
    governancePreflightStatus: process.env.AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS === "pass" ? "pass" as const : null,
    actionsPinningStatus: process.env.AREAFORGE_ACTIONS_PINNING_STATUS === "pass" ? "pass" as const : null,
    skillsValidateStatus: process.env.AREAFORGE_SKILLS_VALIDATE_STATUS === "pass" ? "pass" as const : null,
    releaseSupplyChainSelftestStatus: process.env.AREAFORGE_RELEASE_SUPPLY_CHAIN_SELFTEST_STATUS === "pass" ? "pass" as const : null,
    pinnedActionsCount: positiveIntegerString(process.env.AREAFORGE_PINNED_ACTIONS_COUNT),
    unpinnedExternalActions: process.env.AREAFORGE_UNPINNED_EXTERNAL_ACTIONS === "none" ? "none" as const : null,
    highCriticalVulnerabilities: process.env.AREAFORGE_HIGH_CRITICAL_VULNERABILITIES === "none" ? "none" as const : null,
  };
  return {
    missing: Object.entries(entries).filter(([, value]) => !value).map(([key]) => envNameFor(key)),
    values: entries as {
      ciWorkflowStatus: "pass";
      auditProdStatus: "pass";
      governancePreflightStatus: "pass";
      actionsPinningStatus: "pass";
      skillsValidateStatus: "pass";
      releaseSupplyChainSelftestStatus: "pass";
      pinnedActionsCount: string;
      unpinnedExternalActions: "none";
      highCriticalVulnerabilities: "none";
    },
  };
}

function positiveIntegerString(value: string | undefined): string | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  return value;
}

function envNameFor(key: string): string {
  const names: Record<string, string> = {
    ciWorkflowStatus: "AREAFORGE_CI_WORKFLOW_STATUS=pass",
    auditProdStatus: "AREAFORGE_AUDIT_PROD_STATUS=pass",
    governancePreflightStatus: "AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS=pass",
    actionsPinningStatus: "AREAFORGE_ACTIONS_PINNING_STATUS=pass",
    skillsValidateStatus: "AREAFORGE_SKILLS_VALIDATE_STATUS=pass",
    releaseSupplyChainSelftestStatus: "AREAFORGE_RELEASE_SUPPLY_CHAIN_SELFTEST_STATUS=pass",
    pinnedActionsCount: "AREAFORGE_PINNED_ACTIONS_COUNT=<positive integer>",
    unpinnedExternalActions: "AREAFORGE_UNPINNED_EXTERNAL_ACTIONS=none",
    highCriticalVulnerabilities: "AREAFORGE_HIGH_CRITICAL_VULNERABILITIES=none",
  };
  return names[key] ?? key;
}

function packageJsonVersion(): string {
  const packageJson = parseJson(readRequiredFile(path.resolve("package.json")), "package.json");
  return stringOrNull(packageJson.version) ?? "unknown";
}

function parseJson(raw: string, label: string): JsonRecord {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function nestedString(record: JsonRecord, keys: string[]): string | null {
  let value: unknown = record;
  for (const key of keys) {
    value = isRecord(value) ? value[key] : undefined;
  }
  return stringOrNull(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

try {
  main();
} catch (error) {
  console.error(`FAIL CI supply-chain record generation: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
