import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

type EvidenceStatus = "missing" | "valid" | "invalid";
type PreflightStatus = "needs_evidence" | "ready_for_sc002_review" | "ready_for_sc001_sc002_review" | "invalid";

type EvidenceInput = {
  key: string;
  label: string;
  envKey: string;
  validatorCommand: string[];
  coversResidualRiskIds: string[];
};

type EvidenceResult = EvidenceInput & {
  path: string | null;
  status: EvidenceStatus;
  detail: string;
};

const evidenceInputs: EvidenceInput[] = [
  {
    key: "ciSupplyChainRecord",
    label: "CI-only supply-chain record",
    envKey: "AREAFORGE_SC002_CI_RECORD",
    validatorCommand: ["pnpm", "exec", "tsx", "scripts/quality/ci-supply-chain-record-validate.ts"],
    coversResidualRiskIds: ["AF-RISK-SC-002"],
  },
  {
    key: "releaseSupplyChainRecord",
    label: "signed Release supply-chain record",
    envKey: "AREAFORGE_SC002_RELEASE_RECORD",
    validatorCommand: ["pnpm", "exec", "tsx", "scripts/quality/release-supply-chain-validate.ts"],
    coversResidualRiskIds: ["AF-RISK-SC-001", "AF-RISK-SC-002"],
  },
];

function main(): void {
  const evidence = evidenceInputs.map(validateEvidenceInput);
  const status = preflightStatus(evidence);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "read_only_sc002_supply_chain_preflight",
    residualRiskId: "AF-RISK-SC-002",
    relatedResidualRiskIds: ["AF-RISK-SC-001"],
    status,
    evidence,
    requiredPreflight: [
      "pnpm governance:preflight",
      "pnpm audit:prod",
      "pnpm skills:validate",
      "pnpm release:supply-chain:selftest",
      "pnpm release:supply-chain:record:selftest",
      "pnpm ci:supply-chain:selftest",
      "pnpm sc:sc-002:preflight:selftest",
      "pnpm github-release-updater:preflight",
      "pnpm ci:supply-chain:record <github-workflow-run.json> > <ci-supply-chain-record.txt>",
      "AREAFORGE_SC002_CI_RECORD=<ci-supply-chain-record.txt> pnpm sc:sc-002:preflight",
      "pnpm ci:supply-chain:validate <ci-supply-chain-record.txt>",
      "pnpm release:supply-chain:record <release-assets-dir> > <release-supply-chain-record.txt>",
      "AREAFORGE_SC002_RELEASE_RECORD=<release-supply-chain-record.txt> pnpm sc:sc-002:preflight",
      "pnpm release:supply-chain:validate <release-supply-chain-record.txt>",
    ],
    nextCommand: nextCommand(status),
    forbiddenActions: [
      "create_github_release",
      "push_git_tag",
      "download_release_assets",
      "call_github_api",
      "execute_server_command",
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
      releaseCreated: false,
      tagPushed: false,
      releaseAssetsDownloaded: false,
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

  if (status === "invalid" || shouldFail(status, process.env.AREAFORGE_SC002_PREFLIGHT_FAIL_ON)) {
    process.exit(1);
  }
}

function validateEvidenceInput(input: EvidenceInput): EvidenceResult {
  const rawPath = process.env[input.envKey]?.trim();
  if (!rawPath) {
    return {
      ...input,
      path: null,
      status: "missing",
      detail: `${input.envKey} is not set`,
    };
  }

  const absolutePath = path.resolve(rawPath);
  if (!existsSync(absolutePath)) {
    return {
      ...input,
      path: "<redacted path>",
      status: "invalid",
      detail: "configured evidence path does not exist",
    };
  }

  const [command, ...args] = input.validatorCommand;
  const validation = spawnSync(command ?? "pnpm", [...args, absolutePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (validation.status === 0) {
    return {
      ...input,
      path: "<redacted path>",
      status: "valid",
      detail: `${input.label} validator passed`,
    };
  }

  return {
    ...input,
    path: "<redacted path>",
    status: "invalid",
    detail: sanitizeValidationOutput(validation.stderr || validation.stdout || `${input.label} validator failed`),
  };
}

function preflightStatus(evidence: EvidenceResult[]): PreflightStatus {
  if (evidence.some((item) => item.status === "invalid")) return "invalid";
  if (evidence.find((item) => item.key === "releaseSupplyChainRecord")?.status === "valid") {
    return "ready_for_sc001_sc002_review";
  }
  if (evidence.find((item) => item.key === "ciSupplyChainRecord")?.status === "valid") {
    return "ready_for_sc002_review";
  }
  return "needs_evidence";
}

function nextCommand(status: PreflightStatus): string {
  if (status === "ready_for_sc001_sc002_review") {
    return "review AF-RISK-SC-001 and AF-RISK-SC-002 close conditions; update residual ledger only after human approval";
  }
  if (status === "ready_for_sc002_review") {
    return "review AF-RISK-SC-002 close condition; keep AF-RISK-SC-001 open unless signed Release evidence also passes";
  }
  if (status === "invalid") return "fix invalid supply-chain evidence file and rerun pnpm sc:sc-002:preflight";
  return "collect CI-only or signed Release supply-chain evidence, then rerun pnpm sc:sc-002:preflight";
}

function shouldFail(status: PreflightStatus, failOn: string | undefined): boolean {
  if (!failOn) return false;
  const order: PreflightStatus[] = [
    "ready_for_sc001_sc002_review",
    "ready_for_sc002_review",
    "needs_evidence",
    "invalid",
  ];
  const threshold = order.includes(failOn as PreflightStatus) ? failOn as PreflightStatus : "invalid";
  return order.indexOf(status) >= order.indexOf(threshold);
}

function sanitizeValidationOutput(value: string): string {
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
