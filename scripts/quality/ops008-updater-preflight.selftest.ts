import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOps008UpdaterPreflight, ops008PreflightExitCode } from "./ops008-updater-preflight";

const repositoryRoot = process.cwd();
const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops008-preflight-"));

try {
  writeFixtureTree();

  const ready = expectStatus("awaiting_high_risk_confirmation");
  if (ready.evidenceClass !== "runtime_preimage_candidate" || ready.candidateEvidenceStatus !== "complete") {
    throw new Error("OPS-008 valid preimage must be classified as a complete runtime_preimage_candidate");
  }
  if (ops008PreflightExitCode(ready.status, false) !== 0 || ops008PreflightExitCode(ready.status, true) !== 1) {
    throw new Error("OPS-008 strict mode must fail closed while high-risk confirmation is pending");
  }
  if (ready.evidence.sourceContractId !== "OPS-008-PREFLIGHT-CONTRACT-V1") {
    throw new Error("OPS-008 source contract id is not bound");
  }
  if (ready.evidence.sources.length !== 21 || ready.evidence.sources.some((source) => !source.sha256?.startsWith("sha256:"))) {
    throw new Error("OPS-008 task/design/packet/runtime/fixture source hashes are incomplete");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(ready.evidence.sourceSetHash)) {
    throw new Error("OPS-008 sourceSetHash must bind the complete source set");
  }
  for (const boundary of ["journal append-only", "hold/drain queue-control lock", "systemd timer", "production behavior"]) {
    if (!ready.doesNotProve.some((item) => item.includes(boundary))) {
      throw new Error(`OPS-008 doesNotProve is missing boundary: ${boundary}`);
    }
  }

  const task = target("tasks/backlog/0022-updater-phase-journal-hold.md");
  const originalTask = read(task);
  writeFileSync(task, originalTask.replace("OPS-008-PREFLIGHT-CONTRACT-V1", "OPS-008-PREFLIGHT-CONTRACT-DRIFT"));
  const taskDrift = expectStatus("invalid");
  assertHashChanged(ready, taskDrift, "tasks/backlog/0022-updater-phase-journal-hold.md");
  writeFileSync(task, originalTask);

  const packet = target("docs/development/high-risk-confirmation-packets.md");
  const originalPacket = read(packet);
  writeFileSync(packet, originalPacket.replace("状态：等待确认", "状态：已确认"));
  expectStatus("invalid");
  writeFileSync(packet, originalPacket);

  const updater = target("ops/github-release-updater/areaforge-updater.sh");
  const originalUpdater = read(updater);
  writeFileSync(updater, originalUpdater.replace("#!/usr/bin/env bash", "#!/bin/sh"));
  expectStatus("invalid");
  writeFileSync(updater, `${originalUpdater}\n# source hash drift selftest\n`);
  const runtimeDrift = expectStatus("awaiting_high_risk_confirmation");
  assertHashChanged(ready, runtimeDrift, "ops/github-release-updater/areaforge-updater.sh");
  writeFileSync(updater, originalUpdater);

  const phaseFixture = target("scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json");
  const originalPhaseFixture = read(phaseFixture);
  writeFileSync(phaseFixture, originalPhaseFixture.replace(/"journalHash": "sha256:[a-f0-9]{64}"/, `"journalHash": "sha256:${"0".repeat(64)}"`));
  const phaseInvalid = expectStatus("invalid");
  if (phaseInvalid.checks.phaseJournalFixtures.status !== "invalid") {
    throw new Error("OPS-008 corrupted phase-journal fixture must fail validation");
  }
  writeFileSync(phaseFixture, originalPhaseFixture);

  const maintenanceFixture = target("scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-drain-preconfirmation.json");
  const originalMaintenanceFixture = read(maintenanceFixture);
  writeFileSync(maintenanceFixture, originalMaintenanceFixture.replace('"newClaimsAllowed": false', '"newClaimsAllowed": true'));
  const maintenanceInvalid = expectStatus("invalid");
  if (maintenanceInvalid.checks.maintenanceFixtures.status !== "invalid") {
    throw new Error("OPS-008 unsafe maintenance fixture must fail validation");
  }

  console.log("PASS OPS-008 updater preflight selftest");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeFixtureTree(): void {
  write("tasks/backlog/0022-updater-phase-journal-hold.md", [
    "status: blocked",
    "phase: awaiting-high-risk-confirmation",
    "evidenceClass: runtime_preimage_candidate",
    "preflightContract: OPS-008-PREFLIGHT-CONTRACT-V1",
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
  ].join("\n"));
  write("docs/development/ops-008-updater-phase-journal-design.md", [
    "OPS-008-PREFLIGHT-CONTRACT-V1",
    "evidenceClass: runtime_preimage_candidate",
    "不证明 journal durability",
    "不证明 timer 已停止",
    "strict 必须非零退出",
    "production_confirmation_required",
    "migration-or-skipped",
    "queue-control -> production-state -> agent-local",
    "sourceSetHash",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
  ].join("\n"));
  write("docs/development/high-risk-confirmation-packets.md", [
    "## OPS-008 Updater Phase Journal 与 Maintenance Hold/Drain 本地实施确认包",
    "状态：等待确认",
    "OPS-008-PREFLIGHT-CONTRACT-V1",
    "evidenceClass: runtime_preimage_candidate",
    "strict 必须非零退出",
    "sourceSetHash",
    "queue-control -> production-state -> agent-local",
    "hold generation/clear CAS",
    "不执行生产 updater apply",
    "不执行 systemd timer 启停",
    "不执行服务器命令或 secrets 操作",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
    "## NEXT",
  ].join("\n"));

  for (const relative of [
    "ops/github-release-updater/areaforge-updater.sh",
    "ops/update-agent/areaforge-update-agent.sh",
    "ops/update-agent/lib/update-request-state.sh",
    "ops/update-agent/lib/update-request-v2.sh",
    "ops/github-release-updater/areaforge-updater.service",
    "ops/github-release-updater/areaforge-updater.timer",
    "ops/update-agent/areaforge-update-agent.service",
    "ops/update-agent/areaforge-update-agent.timer",
    "scripts/quality/updater-phase-journal-validate.ts",
    "scripts/quality/updater-maintenance-control-validate.ts",
    "scripts/quality/ops008-updater-preflight.ts",
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

function expectStatus(status: "awaiting_high_risk_confirmation" | "invalid") {
  const result = buildOps008UpdaterPreflight({ root });
  if (result.status !== status) {
    throw new Error(`expected ${status}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  }
  if (!result.safetyFacts.readOnly || result.safetyFacts.updaterExecutionAttempted || result.safetyFacts.serverCommandAttempted || result.safetyFacts.productionWriteAttempted) {
    throw new Error("OPS-008 preflight safety facts are invalid");
  }
  return result;
}

function assertHashChanged(
  before: ReturnType<typeof buildOps008UpdaterPreflight>,
  after: ReturnType<typeof buildOps008UpdaterPreflight>,
  relative: string,
): void {
  const beforeHash = before.evidence.sources.find((source) => source.path === relative)?.sha256;
  const afterHash = after.evidence.sources.find((source) => source.path === relative)?.sha256;
  if (!beforeHash || !afterHash || beforeHash === afterHash) {
    throw new Error(`OPS-008 source hash did not change for ${relative}`);
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
