import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateUpdaterMaintenanceControl } from "./updater-maintenance-control-validate";
import { validateUpdaterPhaseJournal } from "./updater-phase-journal-validate";
import { validateOps008RuntimeRecord } from "./ops008-updater-runtime-validate";

export type Ops008PreflightStatus =
  | "awaiting_high_risk_confirmation"
  | "local_validation"
  | "local_verified"
  | "invalid";

type PreflightOptions = {
  root?: string;
  taskPath?: string;
  designPath?: string;
  confirmationPacketPath?: string;
  runtimePath?: string;
  now?: Date;
  maxEvidenceAgeHours?: number;
};

type Check = {
  status: "pass" | "missing" | "invalid";
  detail: string;
};

type BoundSource = {
  kind: "task" | "design" | "confirmation_packet" | "runtime_preimage" | "phase_journal_fixture" | "maintenance_fixture" | "runtime_record";
  path: string;
  sha256: string | null;
};

const candidateEvidenceClass = "runtime_preimage_candidate";
const localEvidenceClass = "local_updater_phase_journal_verified";
const sourceContractId = "OPS-008-PREFLIGHT-CONTRACT-V2";
const implementationConfirmationPhrase =
  "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施";

const strictBashRuntimePaths = [
  "ops/github-release-updater/areaforge-updater.sh",
  "ops/update-agent/areaforge-update-agent.sh",
  "ops/update-agent/areaforge-updater-maintenance.sh",
] as const;

const runtimePaths = [
  ...strictBashRuntimePaths,
  "ops/update-agent/lib/updater-phase-journal.sh",
  "ops/update-agent/lib/updater-maintenance-control.sh",
  "ops/update-agent/lib/update-request-state.sh",
  "ops/update-agent/lib/update-request-v2.sh",
  "ops/github-release-updater/areaforge-updater.service",
  "ops/github-release-updater/areaforge-updater.timer",
  "ops/update-agent/areaforge-update-agent.service",
  "ops/update-agent/areaforge-update-agent.timer",
  "scripts/quality/updater-phase-journal-validate.ts",
  "scripts/quality/updater-maintenance-control-validate.ts",
  "scripts/quality/ops008-updater-preflight.ts",
  "scripts/quality/ops008-updater-runtime-validate.ts",
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
  return status === "invalid" || (strict && status !== "local_verified") ? 1 : 0;
}

export function buildOps008UpdaterPreflight(options: PreflightOptions = {}) {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const maxEvidenceAgeHours = options.maxEvidenceAgeHours ?? 24;
  const taskPath = options.taskPath ?? "tasks/active/0022-updater-phase-journal-hold.md";
  const designPath = options.designPath ?? "docs/development/ops-008-updater-phase-journal-design.md";
  const confirmationPacketPath = options.confirmationPacketPath ?? "docs/development/high-risk-confirmation-packets.md";
  const runtimePath = options.runtimePath ?? process.env.AREAFORGE_OPS008_RUNTIME_RECORD?.trim() ?? "";
  const taskPhase = readTaskPhase(resolve(root, taskPath));

  const checks = {
    task: checkTask(resolve(root, taskPath)),
    designContract: checkDesignContract(resolve(root, designPath)),
    confirmationPacket: checkConfirmationPacket(resolve(root, confirmationPacketPath)),
    runtimePreimage: checkRuntimePreimage(root),
    phaseJournalFixtures: checkPhaseFixtures(root),
    maintenanceFixtures: checkMaintenanceFixtures(root),
    runtime: checkRuntime(root, runtimePath, now, maxEvidenceAgeHours),
  };
  const invalid = Object.values(checks).some((check) => check.status === "invalid");
  const localEvidenceComplete = checks.runtime.status === "pass";
  const status = determineStatus(taskPhase, invalid, localEvidenceComplete);
  const sources: BoundSource[] = [
    bind(root, "task", taskPath),
    bind(root, "design", designPath),
    bind(root, "confirmation_packet", confirmationPacketPath),
    ...runtimePaths.map((value) => bind(root, "runtime_preimage", value)),
    ...phaseFixturePaths.map((value) => bind(root, "phase_journal_fixture", value)),
    ...maintenanceFixturePaths.map((value) => bind(root, "maintenance_fixture", value)),
  ];
  if (runtimePath) {
    sources.push(bind(root, "runtime_record", relativePath(root, path.resolve(root, runtimePath))));
  }

  return {
    schemaVersion: 2,
    mode: "read_only_ops008_updater_preflight",
    evidenceClass: taskPhase === "local-verified" ? localEvidenceClass : candidateEvidenceClass,
    status,
    taskPhase,
    localEvidenceStatus: invalid ? "invalid" : localEvidenceComplete ? "complete" : "incomplete",
    candidateEvidenceStatus: invalid ? "invalid" : "complete",
    strictGate: status === "local_verified"
      ? {
          status: "ready",
          reason: "current checkout, hash-chained journal/hold libraries, fixtures, and fresh temporary-directory runtime evidence are hash-bound",
        }
      : {
          status: "blocked",
          reason: "OPS-008 local_verified evidence is incomplete or source-bound phase is not local-verified",
        },
    checks,
    expectedContract: {
      sourceContractId,
      runtimePolicy: "hash updater/update-agent scripts, helpers, service/timer units, validators, and preflight without executing production commands",
      fixturePolicy: "validate and hash four phase-journal plus three maintenance-control checked-in fixtures",
      journalPolicy: "no-clobber operation directory with hierarchical fsync; phases include prepare, migration skipped, rollback, and terminal reconciliation",
      lockPolicy: "queue-control -> production-state -> agent-local; append-only hold generation and clear CAS",
      evidencePolicy:
        "local_verified proves only the current local checkout with temporary-directory kill-point and lock-contention fixtures; production timer/hold/apply remain separately blocked",
    },
    evidence: {
      sourceContractId,
      implementationConfirmationPhraseSha256: textSha256(implementationConfirmationPhrase),
      sources,
      sourceSetHash: hashBoundSources(sources),
      runtime: runtimePath ? relativePath(root, path.resolve(root, runtimePath)) : null,
      runtimeFileSha256: runtimePath ? fileSha256(path.resolve(root, runtimePath)) : null,
      runtimeRecordHash: runtimePath ? readRuntimeHash(path.resolve(root, runtimePath)) : null,
    },
    requiredNextSteps: status === "local_verified"
      ? [
          "review the local implementation and exact commit",
          "create a separately admitted signed Release before any deployment",
          "obtain independent production timer/hold/apply confirmation",
        ]
      : [
          "retain explicit OPS-008 high-risk implementation confirmation",
          "complete journal durability and hold/drain locking within the confirmed local scope",
          "run temporary-directory kill-point and queue-control lock contention selftests",
          "keep production timer, updater apply, backup, migration, and server operations separately confirmed",
        ],
    doesNotProve: [
      "production updater phase durability",
      "journal append-only, atomic publish, file fsync, or directory fsync durability outside the temporary fixture",
      "hold/drain queue-control lock ordering on production hosts",
      "systemd timer suspension or production queue drain",
      "backup, migration, switch, health, smoke, rollback, or reconciliation execution in production",
      "production behavior or residual ledger closure",
      "signed Release readiness",
    ],
    forbiddenActions: [
      "execute_updater_or_update_agent_against_production",
      "execute_server_command",
      "change_systemd_timer",
      "write_production_hold_or_queue_state",
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

function determineStatus(taskPhase: string | null, invalid: boolean, localEvidenceComplete: boolean): Ops008PreflightStatus {
  if (invalid) return "invalid";
  if (taskPhase === "awaiting-high-risk-confirmation") return "awaiting_high_risk_confirmation";
  if (taskPhase === "local-verified" && localEvidenceComplete) return "local_verified";
  return "local_validation";
}

function checkTask(file: string): Check {
  if (!existsSync(file)) return invalid("OPS-008 task file is missing");
  const raw = readFileSync(file, "utf8");
  const phase = readTaskPhase(file);
  const awaiting = /^status:\s+blocked\s*$/m.test(raw)
    && phase === "awaiting-high-risk-confirmation"
    && raw.includes(`evidenceClass: ${candidateEvidenceClass}`);
  const locallyVerified = /^status:\s+in-progress\s*$/m.test(raw)
    && phase === "local-verified"
    && raw.includes(`evidenceClass: ${localEvidenceClass}`)
    && raw.includes("production_confirmation_required");
  if (!awaiting && !locallyVerified) {
    return invalid("OPS-008 task status, phase, and evidence class are inconsistent");
  }
  if (!raw.includes(implementationConfirmationPhrase) || !raw.includes(sourceContractId)) {
    return invalid("OPS-008 task source contract or exact confirmation phrase is missing");
  }
  return locallyVerified
    ? pass("task records local_verified with production still blocked")
    : pass("task remains blocked behind confirmation");
}

function checkDesignContract(file: string): Check {
  if (!existsSync(file)) return invalid("OPS-008 design file is missing");
  const raw = readFileSync(file, "utf8");
  const required = [
    sourceContractId,
    localEvidenceClass,
    "不证明 journal durability",
    "不证明 timer 已停止",
    "strict 必须非零退出",
    "production_confirmation_required",
    "migration-or-skipped",
    "queue-control -> production-state -> agent-local",
    "sourceSetHash",
    "local_verified",
    implementationConfirmationPhrase,
  ];
  return contractCheck(raw, required, "design declares local verification without production authority");
}

function checkConfirmationPacket(file: string): Check {
  if (!existsSync(file)) return invalid("high-risk confirmation packet file is missing");
  const raw = readFileSync(file, "utf8");
  const start = raw.indexOf("## OPS-008 Updater Phase Journal 与 Maintenance Hold/Drain 本地实施确认包");
  const end = raw.indexOf("\n## ", start + 4);
  const section = start >= 0 ? raw.slice(start, end >= 0 ? end : undefined) : "";
  const required = [
    "状态：已确认",
    sourceContractId,
    localEvidenceClass,
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
    implementationConfirmationPhrase,
    "不执行生产 updater apply",
    "systemd timer 启停",
    "服务器命令",
    "secrets",
    "production_confirmation_required",
  ];
  return contractCheck(section, required, "confirmation packet records local authorization without production authority");
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
  const markers = [
    "journal_begin_apply_operation",
    "updater_admission_barrier",
    "maintenance_publish_hold",
    "queue-control",
    "MAINTENANCE_GENERATION_STALE",
  ];
  const updater = readFileSync(resolve(root, "ops/github-release-updater/areaforge-updater.sh"), "utf8");
  const agent = readFileSync(resolve(root, "ops/update-agent/areaforge-update-agent.sh"), "utf8");
  const requestState = readFileSync(resolve(root, "ops/update-agent/lib/update-request-state.sh"), "utf8");
  if (!markers.every((marker) => updater.includes(marker) || agent.includes(marker) || requestState.includes(marker))) {
    return invalid("updater/update-agent runtime is missing OPS-008 implementation markers");
  }
  return pass("updater/update-agent runtime, helpers, service/timer units, and validators are source-hash bound");
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

function checkRuntime(root: string, runtimePath: string, now: Date, maxAgeHours: number): Check {
  if (!runtimePath) return missing("no temporary-directory runtime record supplied");
  const resolved = path.resolve(root, runtimePath);
  if (!existsSync(resolved)) return invalid("runtime record path does not exist");
  const issues = validateOps008RuntimeRecord(readFileSync(resolved, "utf8"), { root, now, maxAgeHours });
  return issues.length === 0
    ? pass("fresh temporary-directory kill-point, fsync, hold/drain, lock contention, and reconciliation evidence passed")
    : invalid(`runtime record failed validation: ${issues.join(", ")}`);
}

function contractCheck(raw: string, required: string[], detail: string): Check {
  const missingValues = required.filter((value) => !raw.includes(value));
  return missingValues.length === 0 ? pass(detail) : invalid(`source contract is incomplete: ${missingValues.join(", ")}`);
}

function bind(root: string, kind: BoundSource["kind"], relative: string): BoundSource {
  return { kind, path: relative, sha256: fileSha256(resolve(root, relative)) };
}

function resolve(root: string, relative: string): string {
  return path.join(root, relative);
}

function relativePath(root: string, value: string): string {
  const relative = path.relative(root, value);
  return relative && !relative.startsWith("..") ? relative : "<redacted path>";
}

function readTaskPhase(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").match(/^phase:\s+([^\s]+)\s*$/m)?.[1] ?? null;
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

function readRuntimeHash(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const body = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const hash = body.recordHash;
    return typeof hash === "string" && /^sha256:[a-f0-9]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

function formatIssues(issues: Array<{ field: string; message: string }>): string {
  return issues.slice(0, 3).map((issue) => `${issue.field} ${issue.message}`).join("; ");
}

function pass(detail: string): Check {
  return { status: "pass", detail };
}

function missing(detail: string): Check {
  return { status: "missing", detail };
}

function invalid(detail: string): Check {
  return { status: "invalid", detail };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = buildOps008UpdaterPreflight();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = ops008PreflightExitCode(result.status, process.argv.includes("--strict"));
}
