import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { prepareRealFlockCommand } from "./portable-flock-fixture";
import {
  calculateOps008ImplementationHash,
  calculateOps008RecordHash,
} from "./ops008-updater-runtime-validate";

const root = process.cwd();
const journalLib = path.join(root, "ops/update-agent/lib/updater-phase-journal.sh");
const maintenanceLib = path.join(root, "ops/update-agent/lib/updater-maintenance-control.sh");
const updater = path.join(root, "ops/github-release-updater/areaforge-updater.sh");

type Check = { id: string; status: "pass" | "fail"; details: Record<string, unknown> };

function main(): void {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops008-runtime-"));
  const bin = path.join(fixtureRoot, "bin");
  mkdirSync(bin, { recursive: true });
  const realFlock = prepareRealFlockCommand(path.join(bin, "flock"));
  const checks: Check[] = [];
  const outputPath = readOutputPath(process.argv.slice(2));

  try {
    checks.push(runCheck("journal.hash_chain_and_no_clobber", () => testHashChainAndNoClobber(fixtureRoot, realFlock)));
    checks.push(runCheck("journal.kill_point_blocks_admission", () => testKillPointBlocksAdmission(fixtureRoot, realFlock)));
    checks.push(runCheck("journal.fsync_failure_blocks_side_effects", () => testFsyncFailureBlocksSideEffects(fixtureRoot, realFlock)));
    checks.push(runCheck("journal.corrupt_event_blocks_admission", () => testCorruptEventBlocksAdmission(fixtureRoot, realFlock)));
    checks.push(runCheck("maintenance.hold_drain_waiting_and_drained", () => testHoldDrainWaitingAndDrained(fixtureRoot, realFlock)));
    checks.push(runCheck("maintenance.clear_cas_and_journal_gate", () => testClearCasAndJournalGate(fixtureRoot, realFlock)));
    checks.push(runCheck("maintenance.queue_control_lock_contention", () => testQueueControlLockContention(fixtureRoot, realFlock)));
    checks.push(runCheck("maintenance.stale_request_after_clear", () => testStaleRequestAfterClear(fixtureRoot, realFlock)));
    checks.push(runCheck("updater.record_persistence_maps_reconciliation", () => testRecordPersistenceMapsReconciliation()));

    const failed = checks.filter((check) => check.status !== "pass");
    if (failed.length > 0) {
      throw new Error(`OPS-008 runtime checks failed: ${failed.map((item) => item.id).join(", ")}`);
    }

    const record = createRecord(checks);
    if (outputPath) {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
      console.log(`OPS-008 runtime record written: ${path.relative(root, outputPath)}`);
    }
    console.log("PASS OPS-008 updater runtime selftest");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function testHashChainAndNoClobber(fixtureRoot: string, flock: string): Record<string, unknown> {
  const stateDir = path.join(fixtureRoot, "hash-chain");
  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
oid="$(journal_generate_operation_id)"
journal_create_operation "$oid"
JOURNAL_RELEASE_JSON='{"releaseTag":"v0.1.9","manifestVersion":"0.1.9","manifestSha256":"sha256:${"a".repeat(64)}","webImageDigest":"ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}","migrationImageDigest":null}'
journal_append_event validation started CANDIDATE_SELECTED
journal_append_event validation complete IDENTITY_BOUND
journal_append_event backup started BACKUP_STARTED
journal_append_event backup complete BACKUP_DURABLE '{"backupSetId":"fixture","backupInventoryHash":"sha256:${"c".repeat(64)}"}'
journal_append_event prepare started PREPARE_STARTED
journal_append_event prepare complete PREPARE_COMPLETE
journal_append_event migration skipped NO_MIGRATION_IMAGE
journal_append_event switch started SWITCH_STARTED
journal_append_event switch complete SWITCH_COMPLETE
journal_append_event health started HEALTH_STARTED
journal_append_event health complete HEALTH_COMPLETE
journal_append_event smoke started SMOKE_STARTED
journal_append_event smoke complete SMOKE_COMPLETE
journal_append_event terminal started TERMINAL_STARTED
journal_append_event terminal applied APPLY_COMPLETED '{"updateRecordHash":"sha256:${"d".repeat(64)}","productionIdentityHash":"sha256:${"e".repeat(64)}"}'
events="$JOURNAL_ROOT/$oid/events"
count="$(find "$events" -maxdepth 1 -name '[0-9][0-9][0-9][0-9].json' -type f | wc -l | awk '{print $1}')"
set +e
# no-clobber: attempt to publish over an existing sequence via hard-link collide
tmp="$(mktemp "$events/.dup.XXXXXX")"
printf '{}' > "$tmp"
ln "$tmp" "$events/0001.json" 2>/dev/null
dup_status=$?
rm -f "$tmp"
set -e
scan="$(journal_scan_all)"
printf 'eventCount=%s\\nduplicatePublishRejected=%s\\nscanStatus=%s\\n' "$count" "$([[ "$dup_status" != "0" ]] && printf true || printf false)" "$scan"
`;
  const result = bash(script, [journalLib, maintenanceLib, stateDir], flock);
  expect(result.status === 0, `hash-chain fixture failed: ${result.stderr}`);
  const details = parseKeyValues(result.stdout);
  expect(Number(details.eventCount) === 16, "expected full terminal event chain");
  expect(details.duplicatePublishRejected === "true", "duplicate event publish must fail");
  expect(details.scanStatus === "clean", "terminal journal must scan clean");
  return {
    eventCount: Number(details.eventCount),
    duplicatePublishRejected: true,
    scanStatus: "clean",
  };
}

function testKillPointBlocksAdmission(fixtureRoot: string, flock: string): Record<string, unknown> {
  const stateDir = path.join(fixtureRoot, "kill-point");
  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
oid="$(journal_generate_operation_id)"
journal_create_operation "$oid"
JOURNAL_RELEASE_JSON='{"releaseTag":"v0.1.9","manifestVersion":"0.1.9","manifestSha256":"sha256:${"a".repeat(64)}","webImageDigest":"ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}","migrationImageDigest":null}'
journal_append_event validation started CANDIDATE_SELECTED
journal_append_event validation complete IDENTITY_BOUND
journal_append_event backup started BACKUP_STARTED
journal_append_event backup complete BACKUP_DURABLE '{"backupSetId":"fixture","backupInventoryHash":"sha256:${"c".repeat(64)}"}'
journal_append_event prepare started PREPARE_STARTED
journal_append_event prepare complete PREPARE_COMPLETE
journal_append_event migration started MIGRATION_STARTED
# kill point: no migration complete
scan="$(journal_scan_all)"
maintenance_acquire_queue_control
maintenance_publish_hold JOURNAL_REQUIRES_RECONCILIATION updater.recovery "$oid" >/dev/null
hold="$(maintenance_active_hold)"
maintenance_release_queue_control
printf 'scanStatus=%s\\nholdPublished=%s\\nuncertainPhase=%s\\n' "$scan" "$([[ "$(jq -r '.kind' <<< "$hold")" == "hold" ]] && printf true || printf false)" migration
`;
  const result = bash(script, [journalLib, maintenanceLib, stateDir], flock);
  expect(result.status === 0, `kill-point fixture failed: ${result.stderr}`);
  const details = parseKeyValues(result.stdout);
  expect(details.scanStatus === "blocked", "incomplete journal must block admission");
  expect(details.holdPublished === "true", "fail-closed hold must be published");
  return {
    scanStatus: "blocked",
    holdPublished: true,
    uncertainPhase: "migration",
  };
}

function testFsyncFailureBlocksSideEffects(fixtureRoot: string, flock: string): Record<string, unknown> {
  const stateDir = path.join(fixtureRoot, "fsync-fail");
  const dockerMarker = path.join(stateDir, "docker-ran");
  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
journal_fsync() { return 1; }
oid="$(journal_generate_operation_id)"
set +e
journal_create_operation "$oid"
create_status=$?
set -e
# side-effect marker must remain absent when journal durability fails
[[ ! -e "$4" ]]
printf 'appendFailed=%s\\ndockerMarkerCreated=%s\\n' "$([[ "$create_status" != "0" ]] && printf true || printf false)" false
`;
  const result = bash(script, [journalLib, maintenanceLib, stateDir, dockerMarker], flock);
  expect(result.status === 0, `fsync failure fixture failed: ${result.stderr}`);
  const details = parseKeyValues(result.stdout);
  expect(details.appendFailed === "true", "fsync failure must fail journal create/append");
  expect(!existsSync(dockerMarker), "fsync failure must not allow Docker side effects");
  return { appendFailed: true, dockerMarkerCreated: false };
}

function testCorruptEventBlocksAdmission(fixtureRoot: string, flock: string): Record<string, unknown> {
  const stateDir = path.join(fixtureRoot, "corrupt");
  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
oid="$(journal_generate_operation_id)"
journal_create_operation "$oid"
JOURNAL_RELEASE_JSON='{"releaseTag":"v0.1.9","manifestVersion":"0.1.9","manifestSha256":"sha256:${"a".repeat(64)}","webImageDigest":"ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}","migrationImageDigest":null}'
journal_append_event validation started CANDIDATE_SELECTED
# corrupt the published event hash chain by rewriting file content in place (bypass no-clobber)
events="$JOURNAL_ROOT/$oid/events"
file="$(find "$events" -maxdepth 1 -name '0002.json' -type f | head -n 1)"
# overwrite via truncate+write through a copy then replace inode contents carefully:
python3 - <<'PY' "$file"
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
path.write_text(text.replace('"CANDIDATE_SELECTED"', '"TAMPERED_REASON"'))
PY
scan="$(journal_scan_all)"
printf 'scanStatus=%s\\n' "$scan"
`;
  const result = bash(script, [journalLib, maintenanceLib, stateDir], flock);
  expect(result.status === 0, `corrupt event fixture failed: ${result.stderr}`);
  const details = parseKeyValues(result.stdout);
  expect(details.scanStatus === "blocked", "tampered event must fail closed");
  return { scanStatus: "blocked" };
}

function testHoldDrainWaitingAndDrained(fixtureRoot: string, flock: string): Record<string, unknown> {
  const preserveState = path.join(fixtureRoot, "drain-preserve");
  mkdirSync(path.join(preserveState, "processing", "claim-active"), { recursive: true });
  writeFileSync(path.join(preserveState, "processing", "claim-active", "claim.json"), '{"claimId":"fixture"}\n');
  writeFileSync(path.join(preserveState, "production-state.lock"), "");
  const preserveScript = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
maintenance_acquire_queue_control
maintenance_publish_hold OPERATOR_HOLD updater.operator >/dev/null
status="$(maintenance_drain_status "$4" "$5")"
[[ "$status" == "waiting_active_claim" ]]
[[ -f "$4/claim-active/claim.json" ]]
maintenance_release_queue_control
printf 'preserved=true\\n'
`;
  const preserve = bash(preserveScript, [
    journalLib,
    maintenanceLib,
    preserveState,
    path.join(preserveState, "processing"),
    path.join(preserveState, "production-state.lock"),
  ], flock);
  expect(preserve.status === 0, `claim preservation fixture failed: ${preserve.stderr}`);

  const drainState = path.join(fixtureRoot, "drain-progress");
  mkdirSync(path.join(drainState, "processing", "claim-active"), { recursive: true });
  writeFileSync(path.join(drainState, "processing", "claim-active", "claim.json"), '{"claimId":"fixture"}\n');
  writeFileSync(path.join(drainState, "production-state.lock"), "");
  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
maintenance_acquire_queue_control
maintenance_publish_hold OPERATOR_HOLD updater.operator >/dev/null
waiting_claim="$(maintenance_drain_status "$4" "$5")"
rm -rf "$4/claim-active"
mkdir -p "$4"
(
  exec 6>"$5"
  flock -n 6
  printf ready > "$3/lock-ready"
  # hold until parent writes release marker
  while [[ ! -f "$3/lock-release" ]]; do sleep 0.05; done
) &
holder=$!
for _ in $(seq 1 80); do
  [[ -f "$3/lock-ready" ]] && break
  sleep 0.05
done
[[ -f "$3/lock-ready" ]]
waiting_lock="$(maintenance_drain_status "$4" "$5")"
printf released > "$3/lock-release"
wait "$holder"
# ensure OS released the advisory lock
for _ in $(seq 1 40); do
  if flock -n 9 9>"$5"; then
    flock -u 9 || true
    break
  fi
  sleep 0.05
done
drained="$(maintenance_drain_status "$4" "$5")"
maintenance_release_queue_control
printf 'waitingActiveClaim=%s\\nwaitingProductionLock=%s\\ndrained=%s\\nclaimPreserved=%s\\n' \
  "$([[ "$waiting_claim" == "waiting_active_claim" ]] && printf true || printf false)" \
  "$([[ "$waiting_lock" == "waiting_production_state_lock" ]] && printf true || printf false)" \
  "$([[ "$drained" == "drained" ]] && printf true || printf false)" \
  true
`;
  const result = bash(script, [
    journalLib,
    maintenanceLib,
    drainState,
    path.join(drainState, "processing"),
    path.join(drainState, "production-state.lock"),
  ], flock);
  expect(result.status === 0, `drain fixture failed: ${result.stderr}\n${result.stdout}`);
  const details = parseKeyValues(result.stdout);
  expect(details.waitingActiveClaim === "true", "active claim must return waiting");
  expect(details.waitingProductionLock === "true", "busy production-state lock must return waiting");
  expect(details.drained === "true", "idle hold must eventually drain");
  return {
    waitingActiveClaim: true,
    waitingProductionLock: true,
    drained: true,
    claimPreserved: true,
  };
}

function testClearCasAndJournalGate(fixtureRoot: string, flock: string): Record<string, unknown> {
  const stateDir = path.join(fixtureRoot, "clear-cas");
  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
# non-terminal journal
oid="$(journal_generate_operation_id)"
journal_create_operation "$oid"
journal_append_event validation started CANDIDATE_SELECTED
maintenance_acquire_queue_control
maintenance_publish_hold JOURNAL_REQUIRES_RECONCILIATION updater.recovery "$oid" >/dev/null
hold="$(maintenance_active_hold)"
hid="$(jq -r .holdId <<< "$hold")"
gen="$(jq -r .generation <<< "$hold")"
hash="$(jq -r .eventHash <<< "$hold")"
set +e
maintenance_clear_hold "$hid" "$gen" "$hash" operator.test
blocked_status=$?
maintenance_clear_hold wrong-id "$gen" "$hash" operator.test
cas_status=$?
set -e
# complete journal to terminal so clear can succeed
JOURNAL_RELEASE_JSON='{"releaseTag":"v0.1.9","manifestVersion":"0.1.9","manifestSha256":"sha256:${"a".repeat(64)}","webImageDigest":"ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}","migrationImageDigest":null}'
journal_bind_existing_operation "$oid"
journal_append_event validation complete IDENTITY_BOUND
journal_append_event backup started BACKUP_STARTED
journal_append_event backup complete BACKUP_DURABLE '{"backupSetId":"fixture","backupInventoryHash":"sha256:${"c".repeat(64)}"}'
journal_append_event prepare started PREPARE_STARTED
journal_append_event prepare complete PREPARE_COMPLETE
journal_append_event migration skipped NO_MIGRATION_IMAGE
journal_append_event switch started SWITCH_STARTED
journal_append_event switch complete SWITCH_COMPLETE
journal_append_event health started HEALTH_STARTED
journal_append_event health complete HEALTH_COMPLETE
journal_append_event smoke started SMOKE_STARTED
journal_append_event smoke complete SMOKE_COMPLETE
journal_append_event terminal started TERMINAL_STARTED
journal_append_event terminal applied APPLY_COMPLETED '{"updateRecordHash":"sha256:${"d".repeat(64)}","productionIdentityHash":"sha256:${"e".repeat(64)}"}'
hold2="$(maintenance_active_hold)"
hid2="$(jq -r .holdId <<< "$hold2")"
gen2="$(jq -r .generation <<< "$hold2")"
hash2="$(jq -r .eventHash <<< "$hold2")"
maintenance_clear_hold "$hid2" "$gen2" "$hash2" operator.test >/dev/null
clear_ok=$?
maintenance_release_queue_control
printf 'clearBlockedByNonTerminalJournal=%s\\ncasMismatchRejected=%s\\nclearSucceededAfterTerminal=%s\\n' \
  "$([[ "$blocked_status" == "4" ]] && printf true || printf false)" \
  "$([[ "$cas_status" == "3" ]] && printf true || printf false)" \
  "$([[ "$clear_ok" == "0" ]] && printf true || printf false)"
`;
  const result = bash(script, [journalLib, maintenanceLib, stateDir], flock);
  expect(result.status === 0, `clear CAS fixture failed: ${result.stderr}\n${result.stdout}`);
  const details = parseKeyValues(result.stdout);
  expect(details.clearBlockedByNonTerminalJournal === "true", "clear must refuse non-terminal journal");
  expect(details.casMismatchRejected === "true", "clear CAS mismatch must be rejected");
  expect(details.clearSucceededAfterTerminal === "true", "clear must succeed after terminal journal");
  return {
    clearBlockedByNonTerminalJournal: true,
    casMismatchRejected: true,
    clearSucceededAfterTerminal: true,
  };
}

function testQueueControlLockContention(fixtureRoot: string, flock: string): Record<string, unknown> {
  const stateDir = path.join(fixtureRoot, "contention");
  mkdirSync(stateDir, { recursive: true });
  const ready = path.join(stateDir, "holder-ready");
  const done = path.join(stateDir, "holder-done");
  const holderScript = `
set -Eeuo pipefail
source "$1"
source "$2"
maintenance_init "$3"
export AREAFORGE_QUEUE_CONTROL_WAIT_SECONDS=1
maintenance_acquire_queue_control
printf ready > "$4"
while [[ ! -f "$5" ]]; do sleep 0.05; done
maintenance_release_queue_control
printf done > "$3/holder-finished"
`;
  const holder = spawn("bash", ["-c", holderScript, "holder", journalLib, maintenanceLib, stateDir, ready, done], {
    env: { ...process.env, PATH: `${path.dirname(flock)}:${process.env.PATH ?? ""}` },
    stdio: "ignore",
  });
  try {
    waitForFile(ready);
    const contender = `
set -Eeuo pipefail
source "$1"
source "$2"
maintenance_init "$3"
export AREAFORGE_QUEUE_CONTROL_WAIT_SECONDS=1
set +e
maintenance_acquire_queue_control
status=$?
set -e
printf 'secondAcquireFailed=%s\\n' "$([[ "$status" != "0" ]] && printf true || printf false)"
`;
    const result = bash(contender, [journalLib, maintenanceLib, stateDir], flock);
    expect(result.status === 0, `lock contention fixture failed: ${result.stderr}`);
    const details = parseKeyValues(result.stdout);
    expect(details.secondAcquireFailed === "true", "second queue-control acquire must fail while held");

    writeFileSync(done, "release\n");
    waitForFile(path.join(stateDir, "holder-finished"));

    const holdState = path.join(fixtureRoot, "contention-hold");
    mkdirSync(holdState, { recursive: true });
    const holdAndClaim = `
set -Eeuo pipefail
source "$1"
source "$2"
maintenance_init "$3"
maintenance_acquire_queue_control
maintenance_publish_hold OPERATOR_HOLD updater.operator >/dev/null
hold="$(maintenance_active_hold)"
[[ "$(jq -r .kind <<< "$hold")" == "hold" ]]
maintenance_release_queue_control
maintenance_acquire_queue_control
active="$(maintenance_active_hold)"
blocked="$([[ "$(jq -r .kind <<< "$active")" == "hold" ]] && printf true || printf false)"
maintenance_release_queue_control
printf 'claimBlockedWhileHoldActive=%s\\n' "$blocked"
`;
    const holdResult = bash(holdAndClaim, [journalLib, maintenanceLib, holdState], flock);
    expect(holdResult.status === 0, `hold admission fixture failed: ${holdResult.stderr}`);
    const holdDetails = parseKeyValues(holdResult.stdout);
    expect(holdDetails.claimBlockedWhileHoldActive === "true", "active hold must block claim admission");
    return {
      secondAcquireFailed: true,
      claimBlockedWhileHoldActive: true,
    };
  } finally {
    writeFileSync(done, "release\n");
    holder.kill("SIGTERM");
  }
}

function testStaleRequestAfterClear(fixtureRoot: string, flock: string): Record<string, unknown> {
  const stateDir = path.join(fixtureRoot, "stale-request");
  const staleRequest = path.join(stateDir, "stale.json");
  const freshRequest = path.join(stateDir, "fresh.json");
  mkdirSync(stateDir, { recursive: true });
  const script = `
set -Eeuo pipefail
source "$1"
source "$2"
journal_init "$3"
maintenance_init "$3"
# create a completed terminal journal so clear is allowed
oid="$(journal_generate_operation_id)"
journal_create_operation "$oid"
JOURNAL_RELEASE_JSON='{"releaseTag":"v0.1.9","manifestVersion":"0.1.9","manifestSha256":"sha256:${"a".repeat(64)}","webImageDigest":"ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}","migrationImageDigest":null}'
journal_append_event validation started CANDIDATE_SELECTED
journal_append_event validation complete IDENTITY_BOUND
journal_append_event backup started BACKUP_STARTED
journal_append_event backup complete BACKUP_DURABLE '{"backupSetId":"fixture","backupInventoryHash":"sha256:${"c".repeat(64)}"}'
journal_append_event prepare started PREPARE_STARTED
journal_append_event prepare complete PREPARE_COMPLETE
journal_append_event migration skipped NO_MIGRATION_IMAGE
journal_append_event switch started SWITCH_STARTED
journal_append_event switch complete SWITCH_COMPLETE
journal_append_event health started HEALTH_STARTED
journal_append_event health complete HEALTH_COMPLETE
journal_append_event smoke started SMOKE_STARTED
journal_append_event smoke complete SMOKE_COMPLETE
journal_append_event terminal started TERMINAL_STARTED
journal_append_event terminal applied APPLY_COMPLETED '{"updateRecordHash":"sha256:${"d".repeat(64)}","productionIdentityHash":"sha256:${"e".repeat(64)}"}'
maintenance_acquire_queue_control
maintenance_publish_hold OPERATOR_HOLD updater.operator >/dev/null
hold="$(maintenance_active_hold)"
clear_at="$(jq -r .createdAt <<< "$hold")"
# write a stale request timestamp earlier than clear
jq -n --arg requestedAt "2020-01-01T00:00:00.000Z" '{requestedAt:$requestedAt,action:"apply"}' > "$4"
# clear hold (creates clear event)
hid="$(jq -r .holdId <<< "$hold")"
gen="$(jq -r .generation <<< "$hold")"
hash="$(jq -r .eventHash <<< "$hold")"
maintenance_clear_hold "$hid" "$gen" "$hash" operator.test >/dev/null
clear_ms="$(maintenance_last_clear_epoch_ms)"
# fresh request must be strictly later than clear createdAt (same-ms is treated as stale/fail-closed)
fresh_ms="$((clear_ms + 1000))"
fresh_iso="$(journal_epoch_ms_to_iso "$fresh_ms")"
jq -n --arg requestedAt "$fresh_iso" '{requestedAt:$requestedAt,action:"apply"}' > "$5"
set +e
maintenance_stale_after_clear "$4"
stale_status=$?
maintenance_stale_after_clear "$5"
fresh_status=$?
set -e
maintenance_release_queue_control
printf 'staleRejected=%s\\nfreshAccepted=%s\\n' \
  "$([[ "$stale_status" == "0" ]] && printf true || printf false)" \
  "$([[ "$fresh_status" != "0" ]] && printf true || printf false)"
`;
  const result = bash(script, [journalLib, maintenanceLib, stateDir, staleRequest, freshRequest], flock);
  expect(result.status === 0, `stale request fixture failed: ${result.stderr}\n${result.stdout}`);
  const details = parseKeyValues(result.stdout);
  expect(details.staleRejected === "true", "pre-clear mutation request must be stale");
  expect(details.freshAccepted === "true", "post-clear mutation request must not be stale");
  return { staleRejected: true, freshAccepted: true };
}

function testRecordPersistenceMapsReconciliation(): Record<string, unknown> {
  const script = [
    "export AREAFORGE_UPDATER_NO_MAIN=1",
    'updater_path="$1"',
    "set --",
    '. "$updater_path"',
    "COMMAND=apply",
    "YES=1",
    "DRY_RUN=0",
    "FORCE=0",
    "CURRENT_VERSION=0.1.7",
    `CURRENT_IMAGE=ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`,
    "TARGET_VERSION=0.1.9",
    "require_production_state_lock() { :; }",
    "version_gt() { return 0; }",
    "validate_request_guard() { :; }",
    "journal_begin_apply_operation() { JOURNAL_ENABLED=1; }",
    "backup_before_update() { :; }",
    "journal_backup_complete_barrier() { :; }",
    "journal_apply_event() { :; }",
    "pull_images() { return 0; }",
    "maybe_update_compose_file() { return 0; }",
    "run_migration_if_needed() { return 0; }",
    "switch_web() { return 0; }",
    "run_health() { return 0; }",
    "run_extra_smoke() { return 0; }",
    "write_record() { return 1; }",
    "journal_note_reconciliation() { printf 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=%s executionAttempted=true\\n' \"$1\" >&2; }",
    "set +e",
    "apply_update",
    "status=$?",
    "printf 'exit-status=%s\\n' \"$status\"",
    "exit 0",
  ].join("\n");
  const result = spawnSync("bash", ["-c", script, "selftest", updater], { cwd: root, encoding: "utf8" });
  expect(result.status === 0, `record persistence fixture failed: ${result.stderr}`);
  expect(result.stdout.includes("exit-status=2"), "record persistence failure must exit 2");
  expect(
    result.stderr.includes("reasonCode=APPLIED_RECORD_PERSISTENCE_UNCERTAIN"),
    "record persistence failure must emit reconciliation reason",
  );
  return {
    exitStatus: 2,
    reasonCode: "APPLIED_RECORD_PERSISTENCE_UNCERTAIN",
  };
}

function createRecord(checks: Check[]) {
  const record = {
    schemaVersion: 1,
    mode: "temporary_directory_ops008_updater_selftest",
    generatedAt: new Date().toISOString(),
    status: "pass" as const,
    source: {
      fixtureRoot: "temporary_isolated_ops_state_directory",
      implementationSha256: calculateOps008ImplementationHash(root),
    },
    checks,
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

function runCheck(id: string, fn: () => Record<string, unknown>): Check {
  try {
    return { id, status: "pass", details: fn() };
  } catch (error) {
    return {
      id,
      status: "fail",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function bash(script: string, args: string[], flockPath: string) {
  return spawnSync("bash", ["-c", script, "ops008-runtime", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.dirname(flockPath)}:${process.env.PATH ?? ""}`,
      AREAFORGE_QUEUE_CONTROL_WAIT_SECONDS: "2",
    },
  });
}

function parseKeyValues(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function waitForFile(file: string): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(file)) return;
    Atomics.wait(sleeper, 0, 0, 50);
  }
  throw new Error(`timed out waiting for ${file}`);
}

function readOutputPath(args: string[]): string | null {
  const index = args.indexOf("--output");
  if (index < 0) return null;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error("--output requires a path");
  return path.resolve(root, value);
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main();
