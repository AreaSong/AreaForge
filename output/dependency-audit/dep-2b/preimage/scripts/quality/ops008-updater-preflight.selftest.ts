import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOps008UpdaterPreflight, ops008PreflightExitCode } from "./ops008-updater-preflight";
import {
  calculateOps008ImplementationHash,
  calculateOps008RecordHash,
} from "./ops008-updater-runtime-validate";

const repositoryRoot = process.cwd();
const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops008-preflight-"));
const now = new Date();
const taskRelative = "tasks/active/0022-updater-phase-journal-hold.md";

try {
  writeFixtureTree();
  const runtime = path.join(root, "runtime.json");

  const missingRuntime = expectStatus("local_validation");
  if (ops008PreflightExitCode(missingRuntime.status, false) !== 0 || ops008PreflightExitCode(missingRuntime.status, true) !== 1) {
    throw new Error("OPS-008 strict mode must fail closed while local runtime evidence is incomplete");
  }
  if (missingRuntime.evidenceClass !== "local_updater_phase_journal_verified" || missingRuntime.localEvidenceStatus !== "incomplete") {
    throw new Error("OPS-008 task phase must not imply verified evidence before runtime inputs pass");
  }
  if (missingRuntime.evidence.sourceContractId !== "OPS-008-PREFLIGHT-CONTRACT-V2") {
    throw new Error("OPS-008 source contract id is not bound");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(missingRuntime.evidence.sourceSetHash)) {
    throw new Error("OPS-008 sourceSetHash must bind the complete source set");
  }

  const runtimeRecord = createRuntimeRecord();
  writeFileSync(runtime, `${JSON.stringify(runtimeRecord, null, 2)}\n`);
  const ready = expectStatus("local_verified", runtime);
  if (ready.localEvidenceStatus !== "complete" || ops008PreflightExitCode(ready.status, true) !== 0) {
    throw new Error("OPS-008 strict mode must pass only for local_verified evidence");
  }
  if (ready.evidence.runtimeRecordHash !== runtimeRecord.recordHash) {
    throw new Error("OPS-008 runtime record hash is not bound");
  }

  const awaiting = withAwaitingTask(() => expectStatus("awaiting_high_risk_confirmation", runtime));
  if (ops008PreflightExitCode(awaiting.status, false) !== 0 || ops008PreflightExitCode(awaiting.status, true) !== 1) {
    throw new Error("OPS-008 awaiting confirmation must pass projection mode and fail strict mode");
  }
  if (awaiting.evidenceClass !== "runtime_preimage_candidate") {
    throw new Error("OPS-008 awaiting phase must keep the preimage candidate evidence class");
  }

  const task = target(taskRelative);
  const originalTask = read(task);
  writeFileSync(task, originalTask.replace("OPS-008-PREFLIGHT-CONTRACT-V2", "OPS-008-PREFLIGHT-CONTRACT-DRIFT"));
  expectStatus("invalid", runtime);
  writeFileSync(task, originalTask);

  const packet = target("docs/development/high-risk-confirmation-packets.md");
  const originalPacket = read(packet);
  writeFileSync(packet, originalPacket.replace("状态：已确认", "状态：漂移"));
  expectStatus("invalid", runtime);
  writeFileSync(packet, originalPacket);

  const updater = target("ops/github-release-updater/areaforge-updater.sh");
  const originalUpdater = read(updater);
  writeFileSync(updater, originalUpdater.replace("#!/usr/bin/env bash", "#!/bin/sh"));
  expectStatus("invalid", runtime);
  writeFileSync(updater, originalUpdater);

  const phaseFixture = target("scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json");
  const originalPhaseFixture = read(phaseFixture);
  writeFileSync(
    phaseFixture,
    originalPhaseFixture.replace(/"journalHash": "sha256:[a-f0-9]{64}"/, `"journalHash": "sha256:${"0".repeat(64)}"`),
  );
  const phaseInvalid = expectStatus("invalid", runtime);
  if (phaseInvalid.checks.phaseJournalFixtures.status !== "invalid") {
    throw new Error("OPS-008 corrupted phase-journal fixture must fail validation");
  }
  writeFileSync(phaseFixture, originalPhaseFixture);

  const staleRuntime = { ...runtimeRecord, generatedAt: new Date(now.getTime() - 48 * 3_600_000).toISOString() };
  staleRuntime.recordHash = calculateOps008RecordHash(staleRuntime);
  writeFileSync(runtime, `${JSON.stringify(staleRuntime, null, 2)}\n`);
  expectStatus("invalid", runtime);

  console.log("PASS OPS-008 updater preflight selftest");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeFixtureTree(): void {
  write(taskRelative, [
    "status: in-progress",
    "phase: local-verified",
    "evidenceClass: local_updater_phase_journal_verified",
    "preflightContract: OPS-008-PREFLIGHT-CONTRACT-V2",
    "production_confirmation_required",
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
  ].join("\n"));
  write("docs/development/ops-008-updater-phase-journal-design.md", [
    "OPS-008-PREFLIGHT-CONTRACT-V2",
    "evidenceClass: local_updater_phase_journal_verified",
    "不证明 journal durability",
    "不证明 timer 已停止",
    "strict 必须非零退出",
    "production_confirmation_required",
    "migration-or-skipped",
    "queue-control -> production-state -> agent-local",
    "sourceSetHash",
    "local_verified",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
  ].join("\n"));
  write("docs/development/high-risk-confirmation-packets.md", [
    "## OPS-008 Updater Phase Journal 与 Maintenance Hold/Drain 本地实施确认包",
    "状态：已确认",
    "OPS-008-PREFLIGHT-CONTRACT-V2",
    "evidenceClass: local_updater_phase_journal_verified",
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
    "不执行生产 updater apply",
    "不执行 systemd timer 启停",
    "不执行服务器命令或 secrets 操作",
    "production_confirmation_required",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
    "## NEXT",
  ].join("\n"));

  for (const relative of [
    "ops/github-release-updater/areaforge-updater.sh",
    "ops/update-agent/areaforge-update-agent.sh",
    "ops/update-agent/areaforge-updater-maintenance.sh",
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
    "scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json",
    "scripts/quality/fixtures/update-agent/phase-journal/ops008-migration-kill-point-reconciliation.json",
    "scripts/quality/fixtures/update-agent/phase-journal/ops008-switch-kill-point-reconciliation.json",
    "scripts/quality/fixtures/update-agent/phase-journal/ops008-terminal-kill-point-reconciliation.json",
    "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-drain-preconfirmation.json",
    "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-waiting-preconfirmation.json",
    "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-lock-waiting-preconfirmation.json",
  ]) {
    const destination = target(relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(repositoryRoot, relative), destination);
  }
}

function createRuntimeRecord() {
  const record = {
    schemaVersion: 1,
    mode: "temporary_directory_ops008_updater_selftest",
    generatedAt: now.toISOString(),
    status: "pass",
    source: {
      fixtureRoot: "temporary_isolated_ops_state_directory",
      implementationSha256: calculateOps008ImplementationHash(root),
    },
    checks: [
      { id: "journal.hash_chain_and_no_clobber", status: "pass", details: { eventCount: 16, duplicatePublishRejected: true, scanStatus: "clean" } },
      { id: "journal.kill_point_blocks_admission", status: "pass", details: { scanStatus: "blocked", holdPublished: true, uncertainPhase: "migration" } },
      { id: "journal.fsync_failure_blocks_side_effects", status: "pass", details: { appendFailed: true, dockerMarkerCreated: false } },
      { id: "journal.corrupt_event_blocks_admission", status: "pass", details: { scanStatus: "blocked" } },
      { id: "maintenance.hold_drain_waiting_and_drained", status: "pass", details: { waitingActiveClaim: true, waitingProductionLock: true, drained: true, claimPreserved: true } },
      { id: "maintenance.clear_cas_and_journal_gate", status: "pass", details: { clearBlockedByNonTerminalJournal: true, casMismatchRejected: true, clearSucceededAfterTerminal: true } },
      { id: "maintenance.queue_control_lock_contention", status: "pass", details: { secondAcquireFailed: true, claimBlockedWhileHoldActive: true } },
      { id: "maintenance.stale_request_after_clear", status: "pass", details: { staleRejected: true, freshAccepted: true } },
      { id: "updater.record_persistence_maps_reconciliation", status: "pass", details: { exitStatus: 2, reasonCode: "APPLIED_RECORD_PERSISTENCE_UNCERTAIN" } },
    ],
    doesNotProve: [
      "production updater phase durability",
      "systemd timer suspension",
      "production queue drain",
      "backup or migration success",
      "signed Release readiness",
      "AF-RISK-OPS-008 residual closure",
    ],
    safetyFacts: {
      temporaryOpsStateDirectoryUsed: true,
      portableFlockUsed: true,
      productionWriteAttempted: false,
      timerChanged: false,
      serverCommandAttempted: false,
      secretValuePrinted: false,
      updaterApplyExecutedAgainstProduction: false,
    },
  };
  return { ...record, recordHash: calculateOps008RecordHash(record) };
}

function expectStatus(status: "awaiting_high_risk_confirmation" | "local_validation" | "local_verified" | "invalid", runtimePath?: string) {
  const result = buildOps008UpdaterPreflight({
    root,
    runtimePath,
    now,
  });
  if (result.status !== status) {
    throw new Error(`expected ${status}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  }
  if (!result.safetyFacts.readOnly || result.safetyFacts.updaterExecutionAttempted || result.safetyFacts.serverCommandAttempted || result.safetyFacts.productionWriteAttempted) {
    throw new Error("OPS-008 preflight safety facts are invalid");
  }
  return result;
}

function withAwaitingTask<T>(fn: () => T): T {
  const task = target(taskRelative);
  const original = read(task);
  writeFileSync(task, [
    "status: blocked",
    "phase: awaiting-high-risk-confirmation",
    "evidenceClass: runtime_preimage_candidate",
    "preflightContract: OPS-008-PREFLIGHT-CONTRACT-V2",
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
  ].join("\n"));
  try {
    return fn();
  } finally {
    writeFileSync(task, original);
  }
}

function write(relative: string, content: string): void {
  const destination = target(relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${content}\n`);
}

function target(relative: string): string {
  return path.join(root, relative);
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}
