import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateUpdaterMaintenanceControl } from "./updater-maintenance-control-validate";
import { validateUpdaterPhaseJournal } from "./updater-phase-journal-validate";

export type Ops008PreflightStatus = "awaiting_high_risk_confirmation" | "invalid";

type PreflightOptions = {
  root?: string;
};

type Check = {
  status: "pass" | "invalid";
  detail: string;
};

type BoundSource = {
  kind: "task" | "design" | "confirmation_packet" | "runtime_preimage" | "phase_journal_fixture" | "maintenance_fixture";
  path: string;
  sha256: string | null;
};

const evidenceClass = "runtime_preimage_candidate";
const sourceContractId = "OPS-008-PREFLIGHT-CONTRACT-V1";
const implementationConfirmationPhrase = "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施";

const strictBashRuntimePaths = [
  "ops/github-release-updater/areaforge-updater.sh",
  "ops/update-agent/areaforge-update-agent.sh",
] as const;

const runtimePaths = [
  ...strictBashRuntimePaths,
  "ops/update-agent/lib/update-request-state.sh",
  "ops/update-agent/lib/update-request-v2.sh",
  "ops/github-release-updater/areaforge-updater.service",
  "ops/github-release-updater/areaforge-updater.timer",
  "ops/update-agent/areaforge-update-agent.service",
  "ops/update-agent/areaforge-update-agent.timer",
  "scripts/quality/updater-phase-journal-validate.ts",
  "scripts/quality/updater-maintenance-control-validate.ts",
  "scripts/quality/ops008-updater-preflight.ts",
] as const;

const phaseFixturePaths = [
  "scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json",
  "scripts/quality/fixtures/update-agent/phase-journal/ops008-migration-kill-point-reconciliation.json",
  "scripts/quality/fixtures/update-agent/phase-journal/ops008-switch-kill-point-reconciliation.json",
  "scripts/quality/fixtures/update-agent/phase-journal/ops008-terminal-kill-point-reconciliation.json",
] as const;

const maintenanceFixturePaths = [
  "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-drain-preconfirmation.json",
  "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-waiting-preconfirmation.json",
  "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-lock-waiting-preconfirmation.json",
] as const;

export function ops008PreflightExitCode(status: Ops008PreflightStatus, strict: boolean): 0 | 1 {
  return status === "invalid" || strict ? 1 : 0;
}

export function buildOps008UpdaterPreflight(options: PreflightOptions = {}) {
  const root = options.root ?? process.cwd();
  const taskPath = "tasks/backlog/0022-updater-phase-journal-hold.md";
  const designPath = "docs/development/ops-008-updater-phase-journal-design.md";
  const confirmationPacketPath = "docs/development/high-risk-confirmation-packets.md";

  const checks = {
    task: checkTask(resolve(root, taskPath)),
    designContract: checkDesignContract(resolve(root, designPath)),
    confirmationPacket: checkConfirmationPacket(resolve(root, confirmationPacketPath)),
    runtimePreimage: checkRuntimePreimage(root),
    phaseJournalFixtures: checkPhaseFixtures(root),
    maintenanceFixtures: checkMaintenanceFixtures(root),
  };
  const invalid = Object.values(checks).some((check) => check.status === "invalid");
  const status: Ops008PreflightStatus = invalid ? "invalid" : "awaiting_high_risk_confirmation";
  const sources: BoundSource[] = [
    bind(root, "task", taskPath),
    bind(root, "design", designPath),
    bind(root, "confirmation_packet", confirmationPacketPath),
    ...runtimePaths.map((value) => bind(root, "runtime_preimage", value)),
    ...phaseFixturePaths.map((value) => bind(root, "phase_journal_fixture", value)),
    ...maintenanceFixturePaths.map((value) => bind(root, "maintenance_fixture", value)),
  ];

  return {
    schemaVersion: 1,
    mode: "read_only_ops008_updater_preflight",
    evidenceClass,
    status,
    candidateEvidenceStatus: invalid ? "invalid" : "complete",
    strictGate: {
      status: "blocked",
      reason: "OPS-008 remains awaiting explicit high-risk implementation confirmation",
    },
    checks,
    expectedContract: {
      sourceContractId,
      runtimePolicy: "hash updater/update-agent scripts, helpers, service/timer units, validators, and preflight without executing them",
      fixturePolicy: "validate and hash four phase-journal plus three maintenance-control checked-in fixtures",
      journalPolicy: "no-clobber operation directory with hierarchical fsync; phases include prepare, migration skipped, rollback, and terminal reconciliation",
      lockPolicy: "queue-control -> production-state -> agent-local; append-only hold generation and clear CAS",
      evidencePolicy: "runtime preimage candidate only; never durability, lock ordering, timer, production, or confirmation evidence",
    },
    evidence: {
      sourceContractId,
      implementationConfirmationPhraseSha256: textSha256(implementationConfirmationPhrase),
      sources,
      sourceSetHash: hashBoundSources(sources),
    },
    requiredNextSteps: [
      "obtain explicit OPS-008 high-risk implementation confirmation",
      "implement journal durability and hold/drain locking only within the confirmed local scope",
      "run temporary-directory kill-point and queue-control lock contention selftests",
      "keep production timer, updater apply, backup, migration, and server operations separately confirmed",
    ],
    doesNotProve: [
      "OPS-008 high-risk implementation confirmation",
      "journal append-only, atomic publish, file fsync, or directory fsync durability",
      "hold/drain queue-control lock ordering or concurrent exclusion",
      "systemd timer suspension or production queue drain",
      "runtime updater or update-agent implementation",
      "backup, migration, switch, health, smoke, rollback, or reconciliation execution",
      "production behavior or residual ledger closure",
    ],
    forbiddenActions: [
      "execute_updater_or_update_agent",
      "execute_server_command",
      "change_systemd_timer",
      "write_hold_or_queue_state",
      "run_backup_restore_or_migration",
      "run_docker_nginx_or_compose",
      "read_or_print_secret_values",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      updaterExecutionAttempted: false,
      serverCommandAttempted: false,
      timerChanged: false,
      queueWriteAttempted: false,
      backupAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      residualLedgerUpdated: false,
    },
  };
}

function checkTask(file: string): Check {
  if (!existsSync(file)) return invalid("OPS-008 task file is missing");
  const raw = readFileSync(file, "utf8");
  const required = [
    "status: blocked",
    "phase: awaiting-high-risk-confirmation",
    `evidenceClass: ${evidenceClass}`,
    `preflightContract: ${sourceContractId}`,
    implementationConfirmationPhrase,
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
  ];
  return contractCheck(raw, required, "task remains blocked and declares the OPS-008 source contract");
}

function checkDesignContract(file: string): Check {
  if (!existsSync(file)) return invalid("OPS-008 design file is missing");
  const raw = readFileSync(file, "utf8");
  const required = [
    sourceContractId,
    `evidenceClass: ${evidenceClass}`,
    "不证明 journal durability",
    "不证明 timer 已停止",
    "strict 必须非零退出",
    "production_confirmation_required",
    "migration-or-skipped",
    "queue-control -> production-state -> agent-local",
    "sourceSetHash",
    implementationConfirmationPhrase,
  ];
  return contractCheck(raw, required, "design declares runtime-preimage-only evidence semantics");
}

function checkConfirmationPacket(file: string): Check {
  if (!existsSync(file)) return invalid("high-risk confirmation packet file is missing");
  const raw = readFileSync(file, "utf8");
  const start = raw.indexOf("## OPS-008 Updater Phase Journal 与 Maintenance Hold/Drain 本地实施确认包");
  const end = raw.indexOf("\n## ", start + 4);
  const section = start >= 0 ? raw.slice(start, end >= 0 ? end : undefined) : "";
  const required = [
    "状态：等待确认",
    sourceContractId,
    `evidenceClass: ${evidenceClass}`,
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
    implementationConfirmationPhrase,
    "不执行生产 updater apply",
    "systemd timer 启停",
    "服务器命令",
    "secrets",
  ];
  return contractCheck(section, required, "confirmation packet remains awaiting confirmation with production boundaries intact");
}

function checkRuntimePreimage(root: string): Check {
  for (const relative of runtimePaths) {
    const file = resolve(root, relative);
    if (!existsSync(file)) return invalid(`runtime preimage is missing: ${relative}`);
    if (!strictBashRuntimePaths.includes(relative as (typeof strictBashRuntimePaths)[number])) continue;
    const raw = readFileSync(file, "utf8");
    if (!raw.startsWith("#!/usr/bin/env bash\nset -Eeuo pipefail")) {
      return invalid(`runtime preimage is not the expected strict Bash script: ${relative}`);
    }
  }
  return pass("updater/update-agent runtime, helpers, service/timer units, and validators are source-hash bound without execution");
}

function checkPhaseFixtures(root: string): Check {
  for (const relative of phaseFixturePaths) {
    const file = resolve(root, relative);
    if (!existsSync(file)) return invalid(`phase-journal fixture is missing: ${relative}`);
    const issues = validateUpdaterPhaseJournal(readFileSync(file, "utf8"));
    if (issues.length > 0) return invalid(`phase-journal fixture failed validation: ${relative}: ${formatIssues(issues)}`);
  }
  return pass("four checked-in phase-journal fixtures validate and are source-hash bound");
}

function checkMaintenanceFixtures(root: string): Check {
  for (const relative of maintenanceFixturePaths) {
    const file = resolve(root, relative);
    if (!existsSync(file)) return invalid(`maintenance fixture is missing: ${relative}`);
    const issues = validateUpdaterMaintenanceControl(readFileSync(file, "utf8"));
    if (issues.length > 0) return invalid(`maintenance fixture failed validation: ${relative}: ${formatIssues(issues)}`);
  }
  return pass("three checked-in maintenance fixtures validate and are source-hash bound");
}

function contractCheck(raw: string, required: string[], detail: string): Check {
  const missing = required.filter((value) => !raw.includes(value));
  return missing.length === 0 ? pass(detail) : invalid(`source contract is incomplete: ${missing.join(", ")}`);
}

function bind(root: string, kind: BoundSource["kind"], relative: string): BoundSource {
  return { kind, path: relative, sha256: fileSha256(resolve(root, relative)) };
}

function resolve(root: string, relative: string): string {
  return path.join(root, relative);
}

function fileSha256(file: string): string | null {
  if (!existsSync(file)) return null;
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

function textSha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function hashBoundSources(sources: BoundSource[]): string {
  const canonical = sources
    .map((source) => ({ kind: source.kind, path: source.path, sha256: source.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return textSha256(JSON.stringify(canonical));
}

function formatIssues(issues: Array<{ field: string; message: string }>): string {
  return issues.slice(0, 3).map((issue) => `${issue.field} ${issue.message}`).join("; ");
}

function pass(detail: string): Check {
  return { status: "pass", detail };
}

function invalid(detail: string): Check {
  return { status: "invalid", detail };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = buildOps008UpdaterPreflight();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = ops008PreflightExitCode(result.status, process.argv.includes("--strict"));
}
