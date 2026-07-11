import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type EvidenceStatus = "missing" | "valid" | "invalid";
type PreflightStatus = "needs_evidence" | "blocked_on_prerequisite" | "ready_to_generate_packet" | "ready_for_human_close" | "invalid";

type EvidenceInput = {
  key: string;
  label: string;
  envKey: string;
  validatorCommand: string[];
  requiredForPacket: boolean;
};

type EvidenceResult = EvidenceInput & {
  path: string | null;
  status: EvidenceStatus;
  detail: string;
};

const evidenceInputs: EvidenceInput[] = [
  {
    key: "productionReadonlySmokeRecord",
    label: "production read-only smoke record",
    envKey: "AREAFORGE_OPS001_SMOKE_RECORD",
    validatorCommand: ["pnpm", "exec", "tsx", "scripts/quality/prod-readonly-smoke-validate.ts"],
    requiredForPacket: true,
  },
  {
    key: "redactedUpdateAgentStatus",
    label: "redacted update-agent status record",
    envKey: "AREAFORGE_OPS001_UPDATE_STATUS_RECORD",
    validatorCommand: ["pnpm", "exec", "tsx", "scripts/quality/update-agent-status-validate.ts"],
    requiredForPacket: true,
  },
  {
    key: "operationalEvidenceBundle",
    label: "operational evidence bundle",
    envKey: "AREAFORGE_OPS001_EVIDENCE_BUNDLE",
    validatorCommand: ["pnpm", "exec", "tsx", "scripts/quality/operational-evidence-bundle-validate.ts"],
    requiredForPacket: true,
  },
  {
    key: "ops001ClosurePacket",
    label: "OPS-001 closure packet",
    envKey: "AREAFORGE_OPS001_CLOSURE_PACKET",
    validatorCommand: ["pnpm", "exec", "tsx", "scripts/quality/ops001-closure-packet-validate.ts"],
    requiredForPacket: false,
  },
  {
    key: "ops001BlockedRecord",
    label: "OPS-001 blocked prerequisite record",
    envKey: "AREAFORGE_OPS001_BLOCKED_RECORD",
    validatorCommand: ["pnpm", "exec", "tsx", "scripts/quality/ops001-blocked-record-validate.ts"],
    requiredForPacket: false,
  },
];

function main(): void {
  const evidence = evidenceInputs.map(validateEvidenceInput);
  const status = preflightStatus(evidence);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "read_only_ops001_evidence_preflight",
    residualRiskId: "AF-RISK-OPS-001",
    status,
    evidence,
    requiredPreflight: [
      "pnpm smoke:prod-readonly:config",
      "pnpm smoke:prod-readonly",
      "pnpm smoke:prod-readonly:record <prod-readonly-smoke-output.log> > <prod-readonly-smoke-record.txt>",
      "AREAFORGE_PROD_READONLY_SMOKE_COMMAND=ops/update-agent/areaforge-ops001-readonly-fallback.sh pnpm smoke:prod-readonly:record <fallback-prod-readonly-smoke-output.log> > <prod-readonly-smoke-record.txt>",
      "pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record.txt>",
      "pnpm update-agent:status:record <status.json> > <redacted-update-status.json>",
      "pnpm update-agent:status:validate <redacted-update-status.json>",
      "pnpm ops:evidence:bundle > <operational-evidence-bundle.json>",
      "pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>",
      "pnpm ops:ops-001:closure <prod-readonly-smoke-record.txt> <redacted-update-status.json> <operational-evidence-bundle.json> > <ops-001-closure-packet.txt>",
      "pnpm ops:ops-001:closure:validate <ops-001-closure-packet.txt>",
      "pnpm ops:ops-001:blocked:validate <ops-001-blocked-record.txt>",
    ],
    nextCommand: nextCommand(status),
    forbiddenActions: [
      "execute_server_command",
      "apply_update",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "trigger_production_write_smoke",
      "read_or_print_secret_values",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
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

  if (status === "invalid" || shouldFail(status, process.env.AREAFORGE_OPS001_PREFLIGHT_FAIL_ON)) {
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
  const required = evidence.filter((item) => item.requiredForPacket);
  const requiredEvidenceValid = required.every((item) => item.status === "valid");
  const closurePacket = evidence.find((item) => item.key === "ops001ClosurePacket");
  if (closurePacket?.status === "valid") {
    return requiredEvidenceValid ? "ready_for_human_close" : "invalid";
  }
  const blockedRecord = evidence.find((item) => item.key === "ops001BlockedRecord");
  if (blockedRecord?.status === "valid") return "blocked_on_prerequisite";
  if (requiredEvidenceValid) return "ready_to_generate_packet";
  return "needs_evidence";
}

function nextCommand(status: PreflightStatus): string {
  if (status === "ready_for_human_close") return "review AF-RISK-OPS-001 close condition and update residual ledger only after human approval";
  if (status === "blocked_on_prerequisite") {
    return "fix OPS-001 production prerequisites with explicit confirmation, then rerun read-only evidence export";
  }
  if (status === "ready_to_generate_packet") {
    return "pnpm ops:ops-001:closure <prod-readonly-smoke-record.txt> <redacted-update-status.json> <operational-evidence-bundle.json> > <ops-001-closure-packet.txt>";
  }
  if (status === "invalid") return "fix invalid or incomplete redacted evidence set and rerun pnpm ops:ops-001:preflight";
  return "collect missing redacted evidence files, then rerun pnpm ops:ops-001:preflight";
}

function shouldFail(status: PreflightStatus, failOn: string | undefined): boolean {
  if (!failOn) return false;
  const order: PreflightStatus[] = [
    "ready_for_human_close",
    "ready_to_generate_packet",
    "needs_evidence",
    "blocked_on_prerequisite",
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
    .replace(/\/[^\s:]+/g, "<redacted-path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

main();
