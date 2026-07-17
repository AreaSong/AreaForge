import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { prepareRealFlockCommand } from "./portable-flock-fixture";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const agent = path.join(root, "ops/update-agent/areaforge-update-agent.sh");
const nowEpoch = 1_800_000_000;
const currentVersion = "0.1.7";
const currentImage = `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`;
const targetImage = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;
const systemCp = spawnSync("sh", ["-c", "command -v cp"], { encoding: "utf8" }).stdout.trim();

type Action = "check" | "apply" | "rollback" | "set_auto_apply";

function main(): void {
  testSnapshotAndCheck();
  testVerifiedTargetRejectsUnsafeReleaseId();
  testLatestRollbackRecordUsesUpdatedAt();
  testFloatingRollbackImageIsUnavailable();
  testMismatchedRollbackImageVersionIsUnavailable();
  testV1CheckCompatibility();
  testTtlAcceptanceBoundaries();
  testTtlRejectionMatrix();
  testHashRejectionHasNoExecution();
  testStrictSchemaAndFileNameRejections();
  testLegacyMutationFailsClosed();
  testApplyUsesClaimedRequestGuard();
  testApplyMissingGuardEvidenceNeedsReconciliation();
  testApplyContradictoryGuardEvidenceNeedsReconciliation();
  testApplyDuplicateGuardEvidenceNeedsReconciliation();
  testApplyInvalidFirstPassNeedsReconciliation();
  testApplyReconciliationMarkerOverridesTerminal();
  testApplyPostExecutionFailureNeedsReconciliation();
  testApplyKnownRolledBackTerminalIsRejected();
  testApplyRollbackRecoveryUncertainNeedsReconciliation();
  testApplyMigrationStateUncertainNeedsReconciliation();
  testApplyRecordPersistenceUncertainNeedsReconciliation();
  testRollbackRecordPersistenceUncertainNeedsReconciliation();
  testApplyGuardRejectionHasNoExecution();
  testApplyFirstGuardExpiryHasNoExecution();
  testApplyGuardExpiryHasNoExecution();
  testApplyZeroExitGuardRejectionHasNoExecution();
  testStatusMessageRedactsRootPaths();
  testStatusMessageRedactsPathsWithSpaces();
  testIdempotentReplayDoesNotExecuteAgain();
  testExpiredIdempotentReplayReturnsExistingTerminal();
  testIdempotentReplayPreservesRejectedTerminalState();
  testIdempotencyConflictAndDuplicateRequest();
  testDuplicateRequestDoesNotReplaceIdempotencySource();
  testRollbackUsesExactSourceRecordUnderLock();
  testRollbackMissingFinalGuardEvidenceNeedsReconciliation();
  testRollbackEnvMoveUncertainNeedsReconciliation();
  testRollbackSourceRecordSwapRejectedBeforeMutation();
  testRollbackSourceSnapshotFailureHasNoMutation();
  testRollbackPreparationFailureHasNoMutation();
  testRollbackFailureRestoresOriginalState();
  testRollbackRecoveryFailureNeedsReconciliation();
  testPolicySuccessUnderLock();
  testPolicyUsesDefaultNoneWhenConfigMissing();
  testPolicyDisableSuccessUnderLock();
  testPolicyLockPathDriftFailsClosed();
  testPolicyLockInodeReplacementFailsClosed();
  testRollbackLockInodeReplacementFailsClosed();
  testMutationExpiryAtFinalBoundaryHasNoSideEffects();
  testPolicyPrerequisitesFailClosed();
  testRootPolicyRejectsMinorAndAll();
  testFirstComparisonMismatchHasNoSideEffects();
  testSecondComparisonDriftHasNoSideEffects();
  testRollbackSecondComparisonDriftHasNoSideEffects();
  testInvalidRequestIdCannotEscapeHistory();
  testInvalidClaimIdCannotEscapeHistory();
  testActiveProcessingClaimAllowsReadonlyCheckAndBlocksMutation();
  testCrashAfterExecutionBoundaryNeedsReconciliation();
  testCrashAfterDecisionPublishRecoversClaim();
  testMissingClaimAfterTerminalDecisionRecovers();
  testHistorySyncFailureDoesNotReplay();
  testRealProductionLockContention();
  testStaleProcessingNeedsReconciliation();
  testMissingClaimMetadataNeedsReconciliation();
  testMissingProcessingRequestNeedsReconciliation();
  testClaimMaterializationDoesNotFollowSymlink();
  testClaimMaterializationBreaksHardlinks();
  testClaimMaterializationRenameFailurePreservesRequest();
  testEmptyPreclaimDirectoryDoesNotBlockQueue();
  testTemporaryQueueFilesAreNotConsumed();
  console.log("update-agent request V2 selftest passed.");
}

function fixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "areaforge-agent-v2-"));
  const state = path.join(dir, "state");
  const records = path.join(dir, "records");
  const bin = path.join(dir, "bin");
  mkdirSync(path.join(state, "requests"), { recursive: true });
  mkdirSync(records, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const envFile = path.join(dir, "production.env");
  const composeFile = path.join(dir, "compose.yml");
  const configFile = path.join(dir, "updater.env");
  const updaterLog = path.join(dir, "updater.log");
  const updaterMode = path.join(dir, "updater.mode");
  const dockerLog = path.join(dir, "docker.log");
  const dockerMode = path.join(dir, "docker.mode");
  const flockLog = path.join(dir, "flock.log");
  const syncLog = path.join(dir, "sync.log");
  const syncMode = path.join(dir, "sync.mode");
  const syncFailedMarker = path.join(dir, "sync.failed");
  const productionLockMarker = path.join(dir, "production-lock-held");
  writeFileSync(envFile, `APP_VERSION=${currentVersion}\nAREAFORGE_IMAGE=${currentImage}\nAPP_URL=https://example.invalid\n`);
  writeFileSync(composeFile, "services: {}\n");
  writeFileSync(configFile, [
    `AREAFORGE_ENV_FILE=${envFile}`,
    `AREAFORGE_COMPOSE_FILE=${composeFile}`,
    `AREAFORGE_DEPLOY_DIR=${dir}`,
    `AREAFORGE_UPDATE_RECORD_DIR=${records}`,
    "AREAFORGE_AUTO_APPLY=none",
    "AREAFORGE_REQUIRE_SIGNATURE=true",
  ].join("\n") + "\n");
  const updater = path.join(bin, "mock-updater");
  writeFileSync(updater, `#!/usr/bin/env bash\ninherited_lock=false\nif [[ "\${AREAFORGE_PRODUCTION_STATE_LOCK_INHERITED:-0}" == "1" && -n "\${AREAFORGE_INHERITED_PRODUCTION_STATE_LOCK_FILE:-}" ]]; then\n  if [[ -e "/proc/$$/fd/8" && "\${AREAFORGE_INHERITED_PRODUCTION_STATE_LOCK_FILE}" -ef "/proc/$$/fd/8" ]]; then\n    inherited_lock=true\n  elif [[ -e "/dev/fd/8" && "$(stat -f '%i' "\${AREAFORGE_INHERITED_PRODUCTION_STATE_LOCK_FILE}" 2>/dev/null || true)" == "$(stat -f '%i' /dev/fd/8 2>/dev/null || true)" ]]; then\n    inherited_lock=true\n  fi\nfi\nprintf '%s inheritedLock=%s\\n' "$*" "$inherited_lock" >> "${updaterLog}"\nprevious=""\nidentity_path=""\nmode=""\nif [[ -f "${updaterMode}" ]]; then mode="$(<"${updaterMode}")"; fi\nfor arg in "$@"; do\n  if [[ "$previous" == "--request-guard" && ! -f "$arg" ]]; then exit 9; fi\n  if [[ "$previous" == "--identity-json" ]]; then identity_path="$arg"; fi\n  previous="$arg"\ndone\nif [[ "$mode" == "guard-reject" ]]; then\n  printf '%s\\n' 'arbitrary reasonCode=WRONG_TEXT executionAttempted=true'\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=EXPECTED_BEFORE_MATCH observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'\n  exit 17\nfi\nif [[ "$mode" == "guard-expired" ]]; then\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=REQUEST_EXPIRED observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'\n  exit 20\nfi\nif [[ "$mode" == "path-error" ]]; then\n  printf '%s\\n' 'failed to read /etc/areaforge/updater.env and /opt/areaforge/private/state.json'\n  exit 18\nfi\nif [[ "$mode" == "contradictory-markers" ]]; then\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=pass reasonCode=NONE observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'\n  printf '%s\\n' 'AREAFORGE_REQUEST_EXECUTION action=apply executionAttempted=true'\n  exit 19\nfi\nif [[ "$1" == "apply" && "$mode" != "missing-markers" ]]; then\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=pass reasonCode=NONE observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'\n  printf '%s\\n' 'AREAFORGE_REQUEST_EXECUTION action=apply executionAttempted=true'\nfi\nif [[ -n "$identity_path" ]]; then printf '%s\\n' '{"releaseId":42,"manifestSha256":"sha256:${"c".repeat(64)}","manifestVersion":"0.1.8","webImageDigest":"${targetImage}"}' > "$identity_path"; fi\n`);
  writeFileSync(updater, `if [[ "$mode" == "apply-recovery-uncertain" ]]; then\n  printf '%s\\n' 'rollback recovery could not confirm /srv/areaforge/production.env'\n  printf '%s\\n' 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=ROLLBACK_RECOVERY_UNCERTAIN executionAttempted=true'\n  exit 2\nfi\nif [[ "$mode" == "applied-record-uncertain" ]]; then\n  printf '%s\\n' 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=APPLIED_RECORD_PERSISTENCE_UNCERTAIN executionAttempted=true'\n  exit 2\nfi\nif [[ "$mode" == "rollback-record-uncertain" ]]; then\n  printf '%s\\n' 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=ROLLBACK_RECORD_PERSISTENCE_UNCERTAIN executionAttempted=true'\n  exit 2\nfi\nif [[ "$mode" == "custom-path-error" ]]; then\n  printf '%s\\n' 'failed to read /srv/areaforge/updater.env and /mnt/areaforge/private/state.json'\n  exit 18\nfi\n`, { flag: "a" });
  writeFileSync(updater, `if [[ "$mode" == "migration-state-uncertain" ]]; then\n  printf '%s\\n' 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=MIGRATION_STATE_UNCERTAIN executionAttempted=true'\n  exit 2\nfi\nif [[ "$mode" == "post-execution-failure" ]]; then exit 137; fi\nif [[ "$mode" == "known-rolled-back" ]]; then\n  printf '%s\\n' 'AREAFORGE_UPDATER_TERMINAL status=rolled_back executionAttempted=true'\n  exit 1\nfi\nif [[ "$1" == "apply" && "$mode" != "missing-markers" ]]; then\n  printf '%s\\n' 'AREAFORGE_UPDATER_TERMINAL status=applied executionAttempted=true'\nfi\n`, { flag: "a" });
  chmodSync(updater, 0o755);
  const docker = path.join(bin, "docker");
  writeFileSync(docker, `#!/usr/bin/env bash\n[[ -f "${productionLockMarker}" ]] || { printf '%s\\n' 'LOCK_NOT_HELD' >> "${dockerLog}"; exit 88; }\nprintf '%s\\n' "$*" >> "${dockerLog}"\nmode=""\n[[ -f "${dockerMode}" ]] && mode="$(<"${dockerMode}")"\nif [[ "$mode" == "fail-all" ]]; then exit 42; fi\nif [[ "$mode" == "fail-target" ]] && grep -q '^APP_VERSION=0.1.6$' "${envFile}"; then exit 42; fi\n`);
  chmodSync(docker, 0o755);
  const flock = path.join(bin, "flock");
  writeFileSync(flock, `#!/usr/bin/env bash\nif [[ "\${TEST_USE_SYSTEM_FLOCK:-0}" == "1" ]]; then exec "\${AREAFORGE_TEST_REAL_FLOCK:?}" "$@"; fi\nprintf '%s\\n' "$*" >> "${flockLog}"\nif [[ "$1" == "-n" && "\${2:-}" == "8" ]]; then touch "${productionLockMarker}"; fi\nif [[ "$1" == "-u" && "\${2:-}" == "8" ]]; then rm -f "${productionLockMarker}"; fi\nexit 0\n`);
  chmodSync(flock, 0o755);
  const sync = path.join(bin, "sync");
  writeFileSync(sync, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${syncLog}"\nif [[ -f "${syncMode}" && "$(<"${syncMode}")" == "fail-history-once" && "$*" == */history && ! -f "${syncFailedMarker}" ]]; then\n  touch "${syncFailedMarker}"\n  exit 42\nfi\nexit 0\n`);
  chmodSync(sync, 0o755);
  return { dir, state, records, bin, envFile, configFile, updater, updaterLog, updaterMode, dockerLog, dockerMode, flockLog, syncLog, syncMode, productionLockMarker };
}

function run(f: Fixture): void {
  runAgent(f, [agent]);
}

function runWithSecondComparisonDrift(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"\nbefore_second_comparison() { config_set AREAFORGE_AUTO_APPLY minor; }\nmain`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithRollbackRecordDrift(f: Fixture, record: string): void {
  runAgent(f, ["-c", `. "$1"
before_second_comparison() { printf 'drift\\n' >> "$AREAFORGE_TEST_ROLLBACK_RECORD"; }
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
    AREAFORGE_TEST_ROLLBACK_RECORD: record,
  });
}

function runWithRollbackSourceSwap(f: Fixture, record: string): void {
  const marker = path.join(f.dir, "rollback-source-lookup.marker");
  runAgent(f, ["-c", `. "$1"
find_rollback_record_by_hash() {
  if [[ -f "$AREAFORGE_TEST_ROLLBACK_LOOKUP_MARKER" ]]; then
    printf '%s\\n' "$AREAFORGE_TEST_ROLLBACK_RECORD"
    printf 'swapped\\n' >> "$AREAFORGE_TEST_ROLLBACK_RECORD"
  else
    touch "$AREAFORGE_TEST_ROLLBACK_LOOKUP_MARKER"
    printf '%s\\n' "$AREAFORGE_TEST_ROLLBACK_RECORD"
  fi
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
    AREAFORGE_TEST_ROLLBACK_LOOKUP_MARKER: marker,
    AREAFORGE_TEST_ROLLBACK_RECORD: record,
  });
}

function runWithZeroExitGuardRejection(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'
  return 0
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithFirstGuardExpiry(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=reject reasonCode=REQUEST_EXPIRED observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'
  return 1
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithRollbackMissingGuardEvidence(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
run_exact_rollback() { return 0; }
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithRollbackEnvMoveUncertain(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
mv() {
  local destination="\${!#}"
  if [[ "$destination" == "$AREAFORGE_ENV_FILE" && "$1" == "$AREAFORGE_ENV_FILE".* && "$1" != "$AREAFORGE_ENV_FILE".rollback-original.* ]]; then
    command mv "$@"
    return 1
  fi
  command mv "$@"
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithDuplicateGuardEvidence(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=pass reasonCode=NONE observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'
  printf '%s\\n' 'AREAFORGE_REQUEST_EXECUTION action=apply executionAttempted=true'
  printf '%s\\n' 'AREAFORGE_UPDATER_TERMINAL status=applied executionAttempted=true'
  return 0
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithInvalidFirstPassThenReject(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=true'
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'
  return 17
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithValidGuardRejection(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'
  return 17
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithReconciliationAndTerminal(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=NONE observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=pass reasonCode=NONE observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'
  printf '%s\\n' 'AREAFORGE_REQUEST_EXECUTION action=apply executionAttempted=true'
  printf '%s\\n' 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=MIGRATION_STATE_UNCERTAIN executionAttempted=true'
  printf '%s\\n' 'AREAFORGE_UPDATER_TERMINAL status=applied executionAttempted=true'
  return 0
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithFinalBoundaryExpiry(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
before_second_comparison() {
  AREAFORGE_UPDATE_AGENT_NOW_EPOCH=$((AREAFORGE_UPDATE_AGENT_NOW_EPOCH + 326))
  export AREAFORGE_UPDATE_AGENT_NOW_EPOCH
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithLockInodeReplacement(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"
before_second_comparison() {
  rm -f "$HELD_PRODUCTION_STATE_LOCK_FILE"
  : > "$HELD_PRODUCTION_STATE_LOCK_FILE"
  chmod 600 "$HELD_PRODUCTION_STATE_LOCK_FILE"
}
main`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function runWithMaterializeRenameFailure(f: Fixture): void {
  const result = spawnSync("bash", ["-c", `. "$1"
mv() {
  local arg
  for arg in "$@"; do
    [[ "$arg" == */.claimed-request.* ]] && return 1
  done
  command mv "$@"
}
main`, "selftest", agent], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
      AREAFORGE_UPDATE_AGENT_TEST_MODE: "1",
      AREAFORGE_UPDATE_AGENT_CONFIG: f.configFile,
      AREAFORGE_OPS_STATE_DIR: f.state,
      AREAFORGE_UPDATER_PATH: f.updater,
      AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch),
      AREAFORGE_UPDATE_AGENT_CLAIM_TTL_SECONDS: "60",
    },
    encoding: "utf8",
  });
  assert(result.status !== 0, "materialization rename failure must stop the agent before processing");
}

function crashAfterExecutionBoundary(f: Fixture): void {
  const result = spawnSync("bash", ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' simulated-side-effect >> "$AREAFORGE_TEST_UPDATER_LOG"
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=pass reasonCode=EXPECTED_BEFORE_MATCH observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=true'
  kill -KILL "$$"
}
main`, "selftest", agent], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
      AREAFORGE_UPDATE_AGENT_TEST_MODE: "1",
      AREAFORGE_UPDATE_AGENT_CONFIG: f.configFile,
      AREAFORGE_OPS_STATE_DIR: f.state,
      AREAFORGE_UPDATER_PATH: f.updater,
      AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch),
      AREAFORGE_UPDATE_AGENT_CLAIM_TTL_SECONDS: "60",
      AREAFORGE_TEST_UPDATER_LOG: f.updaterLog,
    },
    encoding: "utf8",
  });
  assert(result.signal === "SIGKILL", `crash fixture must kill the agent after the execution boundary, got ${result.signal ?? result.status}`);
}

function crashAfterDecisionPublish(f: Fixture): void {
  const result = spawnSync("bash", ["-c", `. "$1"
cleanup_claim() { kill -KILL "$$"; }
main`, "selftest", agent], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
      AREAFORGE_UPDATE_AGENT_TEST_MODE: "1",
      AREAFORGE_UPDATE_AGENT_CONFIG: f.configFile,
      AREAFORGE_OPS_STATE_DIR: f.state,
      AREAFORGE_UPDATER_PATH: f.updater,
      AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch),
      AREAFORGE_UPDATE_AGENT_CLAIM_TTL_SECONDS: "60",
    },
    encoding: "utf8",
  });
  assert(result.signal === "SIGKILL", `decision crash fixture must kill the agent, got ${result.signal ?? result.status}`);
}

function runAgent(f: Fixture, args: string[], extraEnv: Record<string, string> = {}): void {
  execFileSync("bash", args, {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_TEST_MODE: "1",
      AREAFORGE_UPDATE_AGENT_CONFIG: f.configFile,
      AREAFORGE_OPS_STATE_DIR: f.state,
      AREAFORGE_UPDATER_PATH: f.updater,
      AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch),
      AREAFORGE_UPDATE_AGENT_CLAIM_TTL_SECONDS: "60",
      ...extraEnv,
    },
    stdio: "pipe",
  });
}

function testSnapshotAndCheck(): void {
  const f = fixture();
  enqueue(f, request("check"));
  run(f);
  const status = json(path.join(f.state, "status.json"));
  assert(status.snapshotSchemaVersion === 2, "status snapshot schema must be V2");
  assert(status.verifiedTarget?.releaseId === 42, "status must consume updater verified identity");
  const projection = {
    currentVersion: status.currentVersion,
    currentImage: status.currentImage,
    autoApply: status.autoApply,
    signatureRequired: status.signatureRequired,
    verifiedTarget: status.verifiedTarget,
    rollback: {
      available: status.rollback.available,
      targetVersion: status.rollback.targetVersion,
      targetImage: status.rollback.targetImage,
      sourceRecordSha256: status.rollback.sourceRecordSha256,
    },
  };
  assert(status.snapshotHash === hash(stable(projection)), "snapshotHash must match canonical projection");
  assert(status.lastOperation.executionAttempted === false, "read-only check must not record mutation execution");
  const syncCalls = readFileSync(f.syncLog, "utf8");
  assert(syncCalls.includes("/requests") && syncCalls.includes("/processing") && syncCalls.includes("/history") && syncCalls.includes("status.json"), "claim, history, and status durability barriers must run");
}

function testVerifiedTargetRejectsUnsafeReleaseId(): void {
  const f = fixture();
  const identity = JSON.stringify({
    releaseId: 9_007_199_254_740_992,
    manifestSha256: `sha256:${"c".repeat(64)}`,
    manifestVersion: "0.1.8",
    webImageDigest: targetImage,
  });
  const result = spawnSync("bash", ["-c", '. "$1"; valid_verified_target <<< "$2"', "selftest", agent, identity], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
    },
    encoding: "utf8",
  });
  assert(result.status !== 0, "verified target identity must reject release IDs outside the JavaScript safe-integer range");
}

function testLatestRollbackRecordUsesUpdatedAt(): void {
  const f = fixture();
  const older = path.join(f.records, "github-0.1.9-older", "update-record.txt");
  const newer = path.join(f.records, "github-0.1.10-newer", "update-record.txt");
  mkdirSync(path.dirname(older), { recursive: true });
  mkdirSync(path.dirname(newer), { recursive: true });
  writeFileSync(older, `updatedAt: 2027-01-15T08:00:00Z\npreviousAppVersion: 0.1.8\npreviousImage: ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"8".repeat(64)}\n`);
  writeFileSync(newer, `updatedAt: 2027-01-16T08:00:00Z\npreviousAppVersion: 0.1.9\npreviousImage: ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"9".repeat(64)}\n`);
  enqueue(f, request("check"));
  run(f);
  const status = json(path.join(f.state, "status.json"));
  assert(status.rollback.targetVersion === "0.1.9", "rollback discovery must select the newest updatedAt record, not lexical version order");
  assert(status.rollback.sourceRecordSha256 === fileHash(newer), "rollback discovery must bind the selected newest record hash");
}

function testFloatingRollbackImageIsUnavailable(): void {
  const f = fixture();
  const record = path.join(f.records, "github-0.1.8-floating", "update-record.txt");
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, "updatedAt: 2027-01-16T08:00:00Z\npreviousAppVersion: 0.1.7\npreviousImage: ghcr.io/areasong/areaforge-web:latest\n");
  enqueue(f, request("check"));
  run(f);
  const status = json(path.join(f.state, "status.json"));
  assert(status.rollback.available === false && status.rollback.targetImage === null, "floating rollback images must remain unavailable");
}

function testMismatchedRollbackImageVersionIsUnavailable(): void {
  const f = fixture();
  const record = path.join(f.records, "github-0.1.8-mismatched", "update-record.txt");
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, `updatedAt: 2027-01-16T08:00:00Z\npreviousAppVersion: 0.1.6\npreviousImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:${"7".repeat(64)}\n`);
  enqueue(f, request("check"));
  run(f);
  const status = json(path.join(f.state, "status.json"));
  assert(status.rollback.available === false && status.rollback.targetImage === null, "rollback records whose image tag disagrees with targetVersion must remain unavailable");
}

function testV1CheckCompatibility(): void {
  for (const includeSchemaVersion of [true, false]) {
    const f = fixture();
    const id = `update_${nowEpoch}_${randomUUID()}`;
    enqueueRaw(f, id, {
      ...(includeSchemaVersion ? { schemaVersion: 1 } : {}),
      id,
      action: "check",
      status: "queued",
      requestedAt: iso(nowEpoch - 5),
      finishedAt: null,
      message: null,
      actorEmailHash: "d".repeat(64),
    });
    run(f);
    assert(lines(f.updaterLog) === 1, "versioned and unversioned V1 checks must remain read-only compatible");
    assert(decisions(f).some((item) => item.reasonCode === "CHECK_COMPLETED" && item.executionAttempted === false), "V1 check compatibility decision missing");
  }
}

function testTtlRejectionMatrix(): void {
  const cases: Array<{ name: string; action: Action; requestedAt: number; expiresAt: number }> = [
    { name: "future", action: "apply", requestedAt: nowEpoch + 31, expiresAt: nowEpoch + 331 },
    { name: "expired", action: "apply", requestedAt: nowEpoch - 400, expiresAt: nowEpoch - 31 },
    { name: "inverted", action: "apply", requestedAt: nowEpoch - 5, expiresAt: nowEpoch - 6 },
    { name: "mutation-too-long", action: "apply", requestedAt: nowEpoch - 5, expiresAt: nowEpoch + 596 },
    { name: "check-too-long", action: "check", requestedAt: nowEpoch - 5, expiresAt: nowEpoch + 896 },
  ];
  for (const testCase of cases) {
    const f = fixture();
    const value = request(testCase.action);
    value.requestedAt = iso(testCase.requestedAt);
    value.expiresAt = iso(testCase.expiresAt);
    refreshHashes(value);
    enqueue(f, value);
    run(f);
    assert(decisions(f).some((item) => item.reasonCode === "REQUEST_EXPIRED"), `${testCase.name} TTL must fail closed`);
    assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), `${testCase.name} TTL rejection must have zero external side effects`);
  }
}

function testTtlAcceptanceBoundaries(): void {
  const cases: Array<{ name: string; action: Action; requestedAt: number; expiresAt: number }> = [
    { name: "future-skew-inclusive", action: "apply", requestedAt: nowEpoch + 30, expiresAt: nowEpoch + 330 },
    { name: "expiry-skew-inclusive", action: "apply", requestedAt: nowEpoch - 330, expiresAt: nowEpoch - 30 },
    { name: "mutation-hard-max-inclusive", action: "apply", requestedAt: nowEpoch - 5, expiresAt: nowEpoch + 595 },
    { name: "check-hard-max-inclusive", action: "check", requestedAt: nowEpoch - 5, expiresAt: nowEpoch + 895 },
  ];
  for (const testCase of cases) {
    const f = fixture();
    const value = request(testCase.action);
    value.requestedAt = iso(testCase.requestedAt);
    value.expiresAt = iso(testCase.expiresAt);
    refreshHashes(value);
    enqueue(f, value);
    run(f);
    assert(!decisions(f).some((item) => item.reasonCode === "REQUEST_EXPIRED"), `${testCase.name} TTL boundary must be accepted`);
    assert(lines(f.updaterLog) === 1, `${testCase.name} accepted request must reach the read-only check or guarded apply path`);
  }
}

function testStrictSchemaAndFileNameRejections(): void {
  const cases: Array<{ name: string; mutate: (value: Record<string, any>) => string }> = [
    { name: "unknown-top-level", mutate: (value) => { value.unknown = true; return value.id; } },
    { name: "unknown-nested", mutate: (value) => { value.params.unknown = true; return value.id; } },
    { name: "non-queued-status", mutate: (value) => { value.status = "running"; refreshHashes(value); return value.id; } },
    { name: "rollback-availability-mismatch", mutate: (value) => { value.expectedBefore.rollbackAvailable = true; refreshHashes(value); return value.id; } },
    { name: "non-ascii-current-image", mutate: (value) => { value.expectedBefore.currentImage = `${currentImage}-\u955c\u50cf`; refreshHashes(value); return value.id; } },
    { name: "prerelease-tag", mutate: (value) => { value.params.tag = "v0.1.8-rc.1"; refreshHashes(value); return value.id; } },
    { name: "prerelease-manifest", mutate: (value) => { value.target.manifestVersion = "0.1.8-rc.1"; refreshHashes(value); return value.id; } },
    { name: "unsafe-release-id", mutate: (value) => { value.target.releaseId = 9_007_199_254_740_992; refreshHashes(value); return value.id; } },
    { name: "unsupported-uuid-version", mutate: (value) => { value.idempotencyKey = ["018f4f8e", "7f31", "7cc2", "8e42", "5a7c556b7e13"].join("-"); refreshHashes(value); return value.id; } },
    { name: "file-name-mismatch", mutate: () => `update_${nowEpoch}_${randomUUID()}` },
  ];
  for (const testCase of cases) {
    const f = fixture();
    const value = request("apply");
    const queueId = testCase.mutate(value);
    enqueueRaw(f, queueId, value);
    run(f);
    assert(decisions(f).some((item) => item.reasonCode === "INVALID_REQUEST_SCHEMA"), `${testCase.name} must fail strict schema processing`);
    assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), `${testCase.name} must have zero external side effects`);
  }
}

function testHashRejectionHasNoExecution(): void {
  const cases: Array<{ name: string; mutate: (value: Record<string, any>) => void }> = [
    { name: "requestHash", mutate: (value) => { value.requestHash = `sha256:${"0".repeat(64)}`; } },
    { name: "expectedBeforeHash", mutate: (value) => { value.expectedBeforeHash = `sha256:${"1".repeat(64)}`; refreshRequestHash(value); } },
    { name: "semanticHash", mutate: (value) => { value.semanticHash = `sha256:${"2".repeat(64)}`; refreshRequestHash(value); } },
  ];
  for (const testCase of cases) {
    const f = fixture();
    const value = request("apply");
    testCase.mutate(value);
    enqueue(f, value);
    run(f);
    assert(!existsSync(f.updaterLog), `${testCase.name} rejection must not call updater`);
    assert(!existsSync(f.dockerLog), `${testCase.name} rejection must not call docker`);
    assert(decisions(f).some((item) => item.reasonCode === "REQUEST_HASH_MISMATCH" && item.executionAttempted === false), `${testCase.name} rejection decision missing`);
  }
}

function testLegacyMutationFailsClosed(): void {
  const f = fixture();
  const id = `update_${nowEpoch}_${randomUUID()}`;
  enqueueRaw(f, id, { id, action: "rollback", status: "queued", requestedAt: iso(nowEpoch), finishedAt: null, message: null, actorEmailHash: "d".repeat(64) });
  run(f);
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "legacy mutation rejection must have zero execution calls");
  assert(decisions(f).some((item) => item.reasonCode === "LEGACY_MUTATION_UNBOUND"), "legacy mutation reason missing");
}

function testApplyUsesClaimedRequestGuard(): void {
  const f = fixture();
  const value = request("apply");
  enqueue(f, value);
  run(f);
  const invocation = readFileSync(f.updaterLog, "utf8");
  assert(invocation.includes("apply --yes --tag v0.1.8"), "apply invocation missing");
  assert(invocation.includes("--request-guard") && invocation.includes("/processing/"), "apply must point guard at root-only claimed request");
  assert(invocation.includes("inheritedLock=true"), "apply must pass the exact inherited production-state lock inode to updater");
  const decision = decisions(f).find((item) => item.action === "apply");
  assert(decision?.decision === "SUCCEEDED" && decision.executionAttempted === true, "apply success requires complete dual-guard and execution evidence");
  assert(decision?.requestHash === value.requestHash, "decision history must retain requestHash");
  assert(decision?.semanticHash === value.semanticHash, "decision history must retain semanticHash");
  assert(decision?.expectedBeforeHash === value.expectedBeforeHash, "decision history must retain expectedBeforeHash");
}

function testApplyMissingGuardEvidenceNeedsReconciliation(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "missing-markers\n");
  enqueue(f, request("apply"));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "UPDATER_GUARD_EVIDENCE_INVALID");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === null, "missing guard markers must fail closed with unknown execution state");
  const status = json(path.join(f.state, "status.json"));
  assert(typeof status.blocker === "string" && status.blocker.length > 0, "new reconciliation decisions must immediately project a top-level blocker");
}

function testApplyContradictoryGuardEvidenceNeedsReconciliation(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "contradictory-markers\n");
  enqueue(f, request("apply"));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "UPDATER_GUARD_EVIDENCE_INVALID");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === null, "contradictory guard markers must fail closed with unknown execution state");
}

function testApplyDuplicateGuardEvidenceNeedsReconciliation(): void {
  const f = fixture();
  enqueue(f, request("apply"));
  runWithDuplicateGuardEvidence(f);
  const decision = decisions(f).find((item) => item.reasonCode === "UPDATER_GUARD_EVIDENCE_INVALID");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === null, "duplicate guard markers must not be accepted as conclusive execution evidence");
}

function testApplyInvalidFirstPassNeedsReconciliation(): void {
  const f = fixture();
  const value = request("apply");
  enqueue(f, value);
  runWithInvalidFirstPassThenReject(f);
  const decision = decisions(f).find((item) => item.id === value.id);
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.reasonCode === "UPDATER_GUARD_EVIDENCE_INVALID", "a pass marker that claims execution already started must not authorize a clean rejection");
  assert(decision?.executionAttempted === null, "contradictory guard evidence must keep execution state unknown");
  assert(typeof decision?.claimId === "string" && existsSync(path.join(f.state, "processing", decision.claimId)), "contradictory guard evidence must retain the processing claim");
}

function testApplyReconciliationMarkerOverridesTerminal(): void {
  const f = fixture();
  const value = request("apply");
  enqueue(f, value);
  runWithReconciliationAndTerminal(f);
  const decision = decisions(f).find((item) => item.id === value.id);
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.reasonCode === "MIGRATION_STATE_UNCERTAIN", "an updater reconciliation marker must override a contradictory applied terminal");
  assert(decision?.executionAttempted === true, "an updater reconciliation marker must retain positive execution evidence");
  assert(typeof decision?.claimId === "string" && existsSync(path.join(f.state, "processing", decision.claimId)), "reconciliation evidence must retain the processing claim");
}

function testApplyPostExecutionFailureNeedsReconciliation(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "post-execution-failure\n");
  const value = request("apply");
  enqueue(f, value);
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "UPDATER_FINAL_STATE_UNCERTAIN");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === true, "post-execution updater failure without a terminal marker must require reconciliation");
  assert(typeof decision?.claimId === "string" && existsSync(path.join(f.state, "processing", decision.claimId)), "uncertain updater final state must retain the processing claim");
}

function testApplyKnownRolledBackTerminalIsRejected(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "known-rolled-back\n");
  const value = request("apply");
  enqueue(f, value);
  run(f);
  const decision = decisions(f).find((item) => item.id === value.id);
  assert(decision?.decision === "REJECTED" && decision.reasonCode === "UPDATER_APPLY_FAILED", "a persisted non-migration rollback terminal may close as rejected");
  assert(typeof decision?.claimId === "string" && !existsSync(path.join(f.state, "processing", decision.claimId)), "known rolled-back terminal must clean the claim");
}

function testApplyRollbackRecoveryUncertainNeedsReconciliation(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "apply-recovery-uncertain\n");
  enqueue(f, request("apply"));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "ROLLBACK_RECOVERY_UNCERTAIN");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === true, "apply rollback recovery uncertainty must require reconciliation with execution evidence");
  assert(!decision.message.includes("/srv/areaforge"), "apply recovery decision must redact custom absolute paths");
}

function testApplyMigrationStateUncertainNeedsReconciliation(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "migration-state-uncertain\n");
  enqueue(f, request("apply"));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "MIGRATION_STATE_UNCERTAIN");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === true, "migration-started rollback must remain a reconciliation state");
}

function testApplyRecordPersistenceUncertainNeedsReconciliation(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "applied-record-uncertain\n");
  const uncertain = request("apply");
  const queued = request("set_auto_apply");
  enqueue(f, uncertain);
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "APPLIED_RECORD_PERSISTENCE_UNCERTAIN");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === true, "applied record persistence uncertainty must not be stored as an ordinary updater failure");
  enqueue(f, queued);
  run(f);
  assert(existsSync(path.join(f.state, "requests", `${queued.id}.json`)), "final record uncertainty must keep later mutations queued across agent rounds");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", "final record uncertainty must block later policy mutation");
}

function testRollbackRecordPersistenceUncertainNeedsReconciliation(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "rollback-record-uncertain\n");
  const uncertain = request("apply");
  const queued = request("rollback");
  enqueue(f, uncertain);
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "ROLLBACK_RECORD_PERSISTENCE_UNCERTAIN");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === true, "rolled-back record persistence uncertainty must require reconciliation");
  enqueue(f, queued);
  run(f);
  assert(existsSync(path.join(f.state, "requests", `${queued.id}.json`)), "rolled-back record uncertainty must block later mutations across agent rounds");
}

function testApplyGuardRejectionHasNoExecution(): void {
  const f = fixture();
  enqueue(f, request("apply"));
  runWithValidGuardRejection(f);
  const decision = decisions(f).find((item) => item.reasonCode === "EXPECTED_BEFORE_MISMATCH");
  assert(decision?.executionAttempted === false, "explicit updater guard rejection must record executionAttempted=false");
  assert(decision?.observedBeforeHashFirst === `sha256:${"1".repeat(64)}`, "first guard hash must come from the explicit marker");
  assert(decision?.observedBeforeHashSecond === `sha256:${"2".repeat(64)}`, "second guard hash must come from the explicit marker");
  assert(!existsSync(f.dockerLog), "apply guard rejection must have zero docker side effects");
}

function testApplyGuardExpiryHasNoExecution(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "guard-expired\n");
  enqueue(f, request("apply"));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "REQUEST_EXPIRED");
  assert(decision?.decision === "REJECTED" && decision.executionAttempted === false, "structured apply TTL rejection must close without reconciliation");
  assert(decision?.observedBeforeHashFirst && decision.observedBeforeHashSecond, "apply TTL rejection must retain both guard hashes");
  assert(!existsSync(f.dockerLog), "apply TTL rejection must not reach Docker");
}

function testApplyFirstGuardExpiryHasNoExecution(): void {
  const f = fixture();
  enqueue(f, request("apply"));
  runWithFirstGuardExpiry(f);
  const decision = decisions(f).find((item) => item.reasonCode === "REQUEST_EXPIRED");
  assert(decision?.decision === "REJECTED" && decision.executionAttempted === false, "first apply TTL rejection must close without reconciliation");
  assert(decision?.observedBeforeHashFirst && decision.observedBeforeHashSecond === null, "first apply TTL rejection must stop before the second guard");
  assert(!existsSync(f.dockerLog), "first apply TTL rejection must not reach Docker");
}

function testApplyZeroExitGuardRejectionHasNoExecution(): void {
  const f = fixture();
  enqueue(f, request("apply"));
  runWithZeroExitGuardRejection(f);
  const decision = decisions(f).find((item) => item.reasonCode === "UPDATER_GUARD_EVIDENCE_INVALID");
  assert(decision?.decision === "NEEDS_RECONCILIATION", "a zero exit code contradicting a reject marker must require reconciliation");
  assert(decision?.executionAttempted === null, "contradictory zero-exit evidence must keep executionAttempted unknown");
  assert(typeof decision?.claimId === "string" && existsSync(path.join(f.state, "processing", decision.claimId)), "contradictory evidence must retain the processing claim");
  assert(!existsSync(f.dockerLog), "zero-exit guard rejection must have zero docker side effects");
}

function testStatusMessageRedactsRootPaths(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "custom-path-error\n");
  enqueue(f, request("check"));
  run(f);
  const status = json(path.join(f.state, "status.json"));
  assert(!status.lastOperation.message.includes("/srv/areaforge") && !status.lastOperation.message.includes("/mnt/areaforge"), "public status must redact arbitrary root-only paths");
  assert(status.lastOperation.message.includes("<redacted-path>"), "redacted status should retain a stable path placeholder");
}

function testStatusMessageRedactsPathsWithSpaces(): void {
  const cases = [
    { input: "failed /srv/Area Forge/private/state.json with secret suffix", expected: "failed /<redacted-path>" },
    { input: "failed:/mnt/Area Forge/private/state.json", expected: "failed:/<redacted-path>" },
  ];
  for (const testCase of cases) {
    const result = spawnSync("bash", ["-c", `. "$1"
status_message_from_output "$AREAFORGE_TEST_STATUS_MESSAGE"`, "selftest", agent], {
      cwd: root,
      env: { ...process.env, AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1", AREAFORGE_TEST_STATUS_MESSAGE: testCase.input },
      encoding: "utf8",
    });
    assert(result.status === 0, `path redaction fixture failed: ${result.stderr}`);
    assert(result.stdout.trim() === testCase.expected, `path redaction failed for ${testCase.input}`);
  }
}

function testIdempotentReplayDoesNotExecuteAgain(): void {
  const f = fixture();
  const key = randomUUID();
  enqueue(f, request("check", key));
  run(f);
  const firstCount = lines(f.updaterLog);
  enqueue(f, request("check", key));
  run(f);
  assert(lines(f.updaterLog) === firstCount, "idempotent replay must not call updater again");
  assert(decisions(f).some((item) => item.reasonCode === "IDEMPOTENT_REPLAY" && item.executionAttempted === false), "idempotent replay decision missing");
}

function testExpiredIdempotentReplayReturnsExistingTerminal(): void {
  const f = fixture();
  const key = randomUUID();
  enqueue(f, request("check", key));
  run(f);
  const updaterCount = lines(f.updaterLog);

  const expiredReplay = request("check", key);
  expiredReplay.requestedAt = iso(nowEpoch - 1_000);
  expiredReplay.expiresAt = iso(nowEpoch - 100);
  refreshHashes(expiredReplay);
  enqueue(f, expiredReplay);
  run(f);

  const replay = decisions(f).find((item) => item.id === expiredReplay.id && item.reasonCode === "IDEMPOTENT_REPLAY");
  assert(replay?.decision === "SUCCEEDED" && replay.executionAttempted === false, "expired transport replay must return the existing terminal decision without execution");
  assert(!decisions(f).some((item) => item.id === expiredReplay.id && item.reasonCode === "REQUEST_EXPIRED"), "existing idempotent terminal result must take precedence over retry-envelope TTL");
  assert(lines(f.updaterLog) === updaterCount, "expired idempotent replay must not execute the updater again");
}

function testIdempotentReplayPreservesRejectedTerminalState(): void {
  const f = fixture();
  const key = randomUUID();
  const rejected = request("apply", key);
  rejected.requestHash = `sha256:${"0".repeat(64)}`;
  enqueue(f, rejected);
  run(f);

  const valid = request("apply", key);
  enqueue(f, valid);
  run(f);

  const replay = decisions(f).find((item) => item.id === valid.id && item.reasonCode === "IDEMPOTENT_REPLAY");
  assert(replay?.status === "failed" && replay.executionAttempted === false, "idempotent replay must preserve the existing rejected terminal state");
  assert(!existsSync(f.updaterLog), "replay of a rejected terminal decision must not call updater");
}

function testIdempotencyConflictAndDuplicateRequest(): void {
  const conflictFixture = fixture();
  const key = randomUUID();
  enqueue(conflictFixture, request("check", key));
  run(conflictFixture);
  const firstUpdaterCount = lines(conflictFixture.updaterLog);
  enqueue(conflictFixture, request("apply", key));
  run(conflictFixture);
  assert(decisions(conflictFixture).some((item) => item.reasonCode === "IDEMPOTENCY_CONFLICT"), "same idempotency key with different semantics must conflict");
  assert(lines(conflictFixture.updaterLog) === firstUpdaterCount, "idempotency conflict must not call updater again");

  const duplicateFixture = fixture();
  const duplicate = request("check");
  enqueue(duplicateFixture, duplicate);
  run(duplicateFixture);
  const duplicateUpdaterCount = lines(duplicateFixture.updaterLog);
  enqueue(duplicateFixture, duplicate);
  run(duplicateFixture);
  assert(decisions(duplicateFixture).some((item) => item.reasonCode === "DUPLICATE_REQUEST"), "duplicate request id must fail closed");
  assert(lines(duplicateFixture.updaterLog) === duplicateUpdaterCount, "duplicate request id must not execute again");
}

function testDuplicateRequestDoesNotReplaceIdempotencySource(): void {
  const f = fixture();
  const key = randomUUID();
  const original = request("check", key);
  enqueue(f, original);
  run(f);
  const updaterCount = lines(f.updaterLog);

  enqueue(f, original);
  run(f);

  const replay = request("check", key);
  enqueue(f, replay);
  run(f);
  const replayDecision = decisions(f).find((item) => item.id === replay.id && item.reasonCode === "IDEMPOTENT_REPLAY");
  assert(replayDecision?.decision === "SUCCEEDED", "duplicate request history must not replace the original idempotency terminal state");
  assert(lines(f.updaterLog) === updaterCount, "canonical idempotency replay must not execute the updater again");
}

function testRollbackUsesExactSourceRecordUnderLock(): void {
  const f = fixture();
  const { rollbackVersion, rollbackImage, sourceRecordSha256 } = createRollbackRecord(f);
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  run(f);
  const decision = decisions(f).find((item) => item.action === "rollback");
  assert(decision?.decision === "SUCCEEDED" && decision.executionAttempted === true, "rollback must succeed with execution evidence");
  assert(decision?.expectedBefore.rollbackSourceRecordSha256 === sourceRecordSha256, "rollback decision must retain the exact source record hash");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${rollbackImage}`), "rollback must apply the bound image");
  assert(!readFileSync(f.dockerLog, "utf8").includes("LOCK_NOT_HELD"), "rollback side effect must run while the shared lock is held");
}

function testRollbackMissingFinalGuardEvidenceNeedsReconciliation(): void {
  const f = fixture();
  const rollback = createRollbackRecord(f);
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollback.rollbackVersion,
    rollbackTargetImage: rollback.rollbackImage,
    rollbackSourceRecordSha256: rollback.sourceRecordSha256,
  }));
  runWithRollbackMissingGuardEvidence(f);
  const decision = decisions(f).find((item) => item.reasonCode === "ROLLBACK_GUARD_EVIDENCE_INVALID");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === true, "rollback success without a final guard marker must not be trusted");
  assert(typeof decision?.claimId === "string" && existsSync(path.join(f.state, "processing", decision.claimId)), "rollback guard uncertainty must retain the processing claim");
}

function testRollbackEnvMoveUncertainNeedsReconciliation(): void {
  const f = fixture();
  const rollback = createRollbackRecord(f);
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollback.rollbackVersion,
    rollbackTargetImage: rollback.rollbackImage,
    rollbackSourceRecordSha256: rollback.sourceRecordSha256,
  }));
  runWithRollbackEnvMoveUncertain(f);
  const decision = decisions(f).find((item) => item.reasonCode === "ROLLBACK_ENV_SWITCH_UNCERTAIN");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.executionAttempted === null, "nonzero final env move must preserve uncertain execution state");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${rollback.rollbackImage}`), "fixture must prove rename may complete before mv reports failure");
  assert(typeof decision?.claimId === "string" && existsSync(path.join(f.state, "processing", decision.claimId)), "uncertain env switch must retain the processing claim");
  assert(!existsSync(f.dockerLog), "uncertain env switch must stop before Docker");
}

function testRollbackSourceRecordSwapRejectedBeforeMutation(): void {
  const f = fixture();
  const { rollbackVersion, rollbackImage, sourceRecordSha256 } = createRollbackRecord(f);
  const record = path.join(f.records, "20270115T080000Z", "update-record.txt");
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  runWithRollbackSourceSwap(f, record);
  const decision = decisions(f).find((item) => item.action === "rollback");
  assert(decision?.decision === "REJECTED" && decision.reasonCode === "ROLLBACK_TARGET_CHANGED", "swapped rollback source must fail closed at the final mutation boundary");
  assert(decision?.executionAttempted === false, "swapped rollback source must record executionAttempted=false");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${currentImage}`), "swapped rollback source must not change the production image");
  assert(!existsSync(f.dockerLog), "swapped rollback source must not reach Docker");
}

function testRollbackPreparationFailureHasNoMutation(): void {
  if (!systemCp) return;
  const f = fixture();
  const { rollbackVersion, rollbackImage, sourceRecordSha256 } = createRollbackRecord(f);
  installCpFailure(f, 2);
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  run(f);
  const decision = decisions(f).find((item) => item.action === "rollback");
  assert(decision?.decision === "REJECTED" && decision.reasonCode === "ROLLBACK_PREPARATION_FAILED", "pre-mutation rollback failure must have a distinct terminal reason");
  assert(decision?.executionAttempted === false, "pre-mutation rollback failure must record executionAttempted=false");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${currentImage}`), "rollback preparation failure must not change the production image");
  assert(!existsSync(f.dockerLog), "rollback preparation failure must not reach Docker");
}

function testRollbackSourceSnapshotFailureHasNoMutation(): void {
  if (!systemCp) return;
  const f = fixture();
  const { rollbackVersion, rollbackImage, sourceRecordSha256 } = createRollbackRecord(f);
  installCpFailure(f, 1);
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  run(f);
  const decision = decisions(f).find((item) => item.action === "rollback");
  assert(decision?.decision === "REJECTED" && decision.reasonCode === "ROLLBACK_PREPARATION_FAILED", "source snapshot I/O failure must be a preparation failure");
  assert(decision?.executionAttempted === false, "source snapshot I/O failure must record executionAttempted=false");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${currentImage}`), "source snapshot I/O failure must not change the production image");
  assert(!existsSync(f.dockerLog), "source snapshot I/O failure must not reach Docker");
}

function installCpFailure(f: Fixture, failAt: number): void {
  const cpCount = path.join(f.dir, "cp.count");
  const cp = path.join(f.bin, "cp");
  writeFileSync(cp, `#!/usr/bin/env bash
count=0
[[ -f "${cpCount}" ]] && count="$(<"${cpCount}")"
count=$((count + 1))
printf '%s' "$count" > "${cpCount}"
[[ "$count" == "${failAt}" ]] && exit 42
exec ${JSON.stringify(systemCp)} "$@"
`);
  chmodSync(cp, 0o755);
}

function testRollbackFailureRestoresOriginalState(): void {
  const f = fixture();
  const { rollbackVersion, rollbackImage, sourceRecordSha256 } = createRollbackRecord(f);
  writeFileSync(f.dockerMode, "fail-target\n");
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  run(f);
  const decision = decisions(f).find((item) => item.action === "rollback");
  assert(decision?.decision === "REJECTED" && decision.reasonCode === "ROLLBACK_FAILED", "restored rollback failure must remain a terminal rejection");
  assert(readFileSync(f.envFile, "utf8").includes(`APP_VERSION=${currentVersion}`), "failed rollback must restore original APP_VERSION");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${currentImage}`), "failed rollback must restore original image");
  assert(lines(f.dockerLog) === 2, "failed rollback must attempt the target once and restore the original service once");
}

function testRollbackRecoveryFailureNeedsReconciliation(): void {
  const f = fixture();
  const { rollbackVersion, rollbackImage, sourceRecordSha256 } = createRollbackRecord(f);
  writeFileSync(f.dockerMode, "fail-all\n");
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  run(f);
  const decision = decisions(f).find((item) => item.action === "rollback");
  assert(decision?.decision === "NEEDS_RECONCILIATION" && decision.reasonCode === "ROLLBACK_RECOVERY_UNCERTAIN", "unconfirmed rollback recovery must require reconciliation");
  assert(readFileSync(f.envFile, "utf8").includes(`APP_VERSION=${currentVersion}`), "uncertain rollback recovery must still restore original env metadata");
}

function testPolicySuccessUnderLock(): void {
  const f = fixture();
  enqueue(f, request("set_auto_apply"));
  run(f);
  const decision = decisions(f).find((item) => item.action === "set_auto_apply");
  assert(decision?.decision === "SUCCEEDED" && decision.executionAttempted === true, "policy mutation must record successful execution");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "patch", "policy mutation must persist the requested value");
  assert(readFileSync(f.flockLog, "utf8").includes("-n 8\n-u 8"), "policy dual compare and mutation must be enclosed by the shared lock");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "policy mutation must not call updater or docker");
}

function testPolicyUsesDefaultNoneWhenConfigMissing(): void {
  const f = fixture();
  writeFileSync(
    f.configFile,
    readFileSync(f.configFile, "utf8").replace(/^AREAFORGE_AUTO_APPLY=.*\n/m, ""),
  );
  enqueue(f, request("set_auto_apply"));
  run(f);
  const decision = decisions(f).find((item) => item.action === "set_auto_apply");
  assert(decision?.decision === "SUCCEEDED", "missing auto-apply config must compare as the documented safe default none");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "patch", "policy mutation must restore a missing auto-apply config entry");
}

function testPolicyDisableSuccessUnderLock(): void {
  const f = fixture();
  writeFileSync(f.configFile, readFileSync(f.configFile, "utf8").replace("AREAFORGE_AUTO_APPLY=none", "AREAFORGE_AUTO_APPLY=patch"));
  const value = request("set_auto_apply", randomUUID(), { autoApply: "patch" });
  value.params.autoApply = "none";
  refreshHashes(value);
  enqueue(f, value);
  run(f);
  const decision = decisions(f).find((item) => item.id === value.id);
  assert(decision?.decision === "SUCCEEDED" && decision.executionAttempted === true, "disabling auto apply must record successful execution");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", "policy mutation must support returning from patch to none");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "disabling auto apply must not call updater or docker");
}

function testPolicyLockPathDriftFailsClosed(): void {
  const f = fixture();
  const replacementLock = path.join(f.dir, "replacement-production-state.lock");
  const flock = path.join(f.bin, "flock");
  writeFileSync(flock, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${f.flockLog}"
if [[ "$1" == "-n" && "\${2:-}" == "8" ]]; then
  printf '%s\\n' 'AREAFORGE_PRODUCTION_STATE_LOCK_FILE=${replacementLock}' >> "${f.configFile}"
fi
exit 0
`);
  chmodSync(flock, 0o755);
  enqueue(f, request("set_auto_apply"));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "PRODUCTION_STATE_LOCK_CHANGED");
  assert(decision?.decision === "REJECTED" && decision.executionAttempted === false, "policy mutation must reject config lock-path drift after acquisition");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", "lock-path drift must not change auto-apply policy");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "lock-path drift must stop before external side effects");
}

function testPolicyLockInodeReplacementFailsClosed(): void {
  const f = fixture();
  enqueue(f, request("set_auto_apply"));
  runWithLockInodeReplacement(f);
  const decision = decisions(f).find((item) => item.reasonCode === "PRODUCTION_STATE_LOCK_CHANGED");
  assert(decision?.decision === "REJECTED" && decision.executionAttempted === false, "policy mutation must reject same-path lock inode replacement at the final boundary");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", "lock inode replacement must not change auto-apply policy");
}

function testRollbackLockInodeReplacementFailsClosed(): void {
  const f = fixture();
  const { rollbackVersion, rollbackImage, sourceRecordSha256 } = createRollbackRecord(f);
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  runWithLockInodeReplacement(f);
  const decision = decisions(f).find((item) => item.reasonCode === "PRODUCTION_STATE_LOCK_CHANGED");
  assert(decision?.decision === "REJECTED" && decision.executionAttempted === false, "rollback must reject same-path lock inode replacement at the final boundary");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${currentImage}`), "lock inode replacement must not change the production image");
  assert(!existsSync(f.dockerLog), "rollback lock inode replacement must stop before Docker");
}

function testMutationExpiryAtFinalBoundaryHasNoSideEffects(): void {
  for (const action of ["set_auto_apply", "rollback"] as const) {
    const f = fixture();
    const expected = action === "rollback" ? createRollbackRecord(f) : null;
    enqueue(f, request(action, randomUUID(), expected ? {
      rollbackAvailable: true,
      rollbackTargetVersion: expected.rollbackVersion,
      rollbackTargetImage: expected.rollbackImage,
      rollbackSourceRecordSha256: expected.sourceRecordSha256,
    } : {}));
    runWithFinalBoundaryExpiry(f);
    const decision = decisions(f).find((item) => item.reasonCode === "REQUEST_EXPIRED");
    assert(decision?.decision === "REJECTED" && decision.executionAttempted === false, `${action} must recheck TTL at the final mutation boundary`);
    assert(decision?.observedBeforeHashFirst && decision.observedBeforeHashSecond, `${action} expiry must retain both compares and stop at the final side-effect boundary`);
    assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", `${action} expiry must not change policy`);
    assert(!existsSync(f.dockerLog), `${action} expiry must not call Docker`);
  }
}

function testPolicyPrerequisitesFailClosed(): void {
  const cases = [
    {
      name: "signature-disabled",
      configure: (f: Fixture) => writeFileSync(f.configFile, readFileSync(f.configFile, "utf8").replace("AREAFORGE_REQUIRE_SIGNATURE=true", "AREAFORGE_REQUIRE_SIGNATURE=false")),
      expected: { signatureRequired: false },
    },
    {
      name: "tag-only-image",
      configure: (f: Fixture) => writeFileSync(f.envFile, readFileSync(f.envFile, "utf8").replace(currentImage, "ghcr.io/areasong/areaforge-web:v0.1.7")),
      expected: { currentImage: "ghcr.io/areasong/areaforge-web:v0.1.7" },
    },
  ];

  for (const testCase of cases) {
    const f = fixture();
    testCase.configure(f);
    enqueue(f, request("set_auto_apply", randomUUID(), testCase.expected));
    run(f);
    const decision = decisions(f).find((item) => item.reasonCode === "AUTO_APPLY_PREREQUISITES_UNMET");
    assert(decision?.decision === "REJECTED" && decision.executionAttempted === false, `${testCase.name} must be rejected by the root policy guard`);
    assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", `${testCase.name} must not change the auto-apply policy`);
  }
}

function testRootPolicyRejectsMinorAndAll(): void {
  for (const policy of ["minor", "all"] as const) {
    const f = fixture();
    const value = request("set_auto_apply");
    value.params.autoApply = policy;
    refreshHashes(value);
    enqueue(f, value);
    run(f);
    assert(decisions(f).some((item) => item.reasonCode === "INVALID_REQUEST_SCHEMA"), `root schema must reject ${policy} policy`);
    assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", `${policy} policy rejection must not change config`);
  }
}

function testFirstComparisonMismatchHasNoSideEffects(): void {
  const f = fixture();
  enqueue(f, request("set_auto_apply", randomUUID(), { autoApply: "minor" }));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "EXPECTED_BEFORE_MISMATCH");
  assert(decision?.executionAttempted === false, "first comparison mismatch must record executionAttempted=false");
  assert(decision?.observedBeforeHashFirst && decision.observedBeforeHashSecond === null, "first mismatch must stop before the second comparison");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", "first mismatch must not change policy");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "first mismatch must have zero external side effects");
}

function testSecondComparisonDriftHasNoSideEffects(): void {
  const f = fixture();
  enqueue(f, request("set_auto_apply"));
  runWithSecondComparisonDrift(f);
  const decision = decisions(f).find((item) => item.reasonCode === "EXPECTED_BEFORE_MISMATCH");
  assert(decision?.executionAttempted === false, "second comparison drift must record executionAttempted=false");
  assert(decision?.observedBeforeHashFirst && decision.observedBeforeHashSecond, "second comparison drift must retain both observed hashes");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "minor", "drift fixture must not be overwritten by the requested patch policy");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "second comparison drift must have zero external side effects");
}

function testRollbackSecondComparisonDriftHasNoSideEffects(): void {
  const f = fixture();
  const rollback = createRollbackRecord(f);
  const record = path.join(f.records, "20270115T080000Z", "update-record.txt");
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollback.rollbackVersion,
    rollbackTargetImage: rollback.rollbackImage,
    rollbackSourceRecordSha256: rollback.sourceRecordSha256,
  }));
  runWithRollbackRecordDrift(f, record);
  const decision = decisions(f).find((item) => item.reasonCode === "EXPECTED_BEFORE_MISMATCH");
  assert(decision?.executionAttempted === false && decision.observedBeforeHashSecond, "rollback drift at second comparison must fail before execution");
  assert(!existsSync(f.dockerLog), "rollback second-comparison drift must not reach Docker");
}

function testInvalidRequestIdCannotEscapeHistory(): void {
  const f = fixture();
  enqueueRaw(f, "invalid-request", {
    schemaVersion: 2,
    id: "../requests/escaped",
    action: "apply",
  });
  run(f);
  assert(readdirSync(path.join(f.state, "requests")).length === 0, "invalid request id must not create a queue file outside history");
  const historyFiles = readdirSync(path.join(f.state, "history"));
  assert(historyFiles.length === 1 && historyFiles[0]?.startsWith("invalid_"), "invalid request history must use a derived safe path component");
  assert(decisions(f).some((item) => item.reasonCode === "INVALID_REQUEST_SCHEMA"), "invalid request must still produce immutable rejection history");
}

function testInvalidClaimIdCannotEscapeHistory(): void {
  const f = fixture();
  const value = request("apply");
  const claimDir = path.join(f.state, "processing", "c".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${value.id}.json`), JSON.stringify(value));
  writeFileSync(path.join(claimDir, "claim.json"), JSON.stringify({
    claimId: "../../requests/claim-escaped",
    claimedAt: iso(nowEpoch - 120),
    claimExpiresAt: iso(nowEpoch - 60),
    originalFileName: `${value.id}.json`,
  }));
  run(f);
  assert(readdirSync(path.join(f.state, "requests")).length === 0, "invalid claim id must not create a file outside history");
  const historyFiles = readdirSync(path.join(f.state, "history"));
  assert(historyFiles.length === 1 && historyFiles[0]?.includes(".claim_"), "invalid claim id must use a derived safe history component");
  assert(decisions(f).some((item) => item.reasonCode === "STALE_PROCESSING_CLAIM"), "invalid stale claim must still require reconciliation");
}

function testActiveProcessingClaimAllowsReadonlyCheckAndBlocksMutation(): void {
  const f = fixture();
  const inFlight = request("apply");
  const queuedMutation = request("apply", inFlight.idempotencyKey);
  const queuedCheck = request("check");
  const claimDir = path.join(f.state, "processing", "b".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${inFlight.id}.json`), JSON.stringify(inFlight));
  writeFileSync(path.join(claimDir, "claim.json"), JSON.stringify({
    claimId: "b".repeat(32),
    claimedAt: iso(nowEpoch - 30),
    claimExpiresAt: iso(nowEpoch + 30),
    originalFileName: `${inFlight.id}.json`,
  }));
  enqueue(f, queuedMutation);
  enqueue(f, queuedCheck);
  run(f);
  assert(existsSync(path.join(f.state, "requests", `${queuedMutation.id}.json`)), "active processing claim must leave later queued mutations untouched");
  assert(!existsSync(path.join(f.state, "requests", `${queuedCheck.id}.json`)), "active reconciliation must still consume a queued read-only check");
  assert(existsSync(claimDir), "active processing claim must remain available for later reconciliation");
  const checkDecision = decisions(f).find((item) => item.id === queuedCheck.id);
  assert(checkDecision?.decision === "SUCCEEDED" && checkDecision.reasonCode === "CHECK_COMPLETED", "active reconciliation must allow only the read-only check path");
  assert(!decisions(f).some((item) => item.id === inFlight.id || item.id === queuedMutation.id), "active processing must not synthesize or execute mutation decisions before reconciliation");
  assert(readFileSync(f.updaterLog, "utf8").includes("check --config"), "active reconciliation must invoke only updater check");
  assert(!readFileSync(f.updaterLog, "utf8").includes("apply --yes"), "active reconciliation must not invoke updater apply");
  assert(!existsSync(f.dockerLog), "active processing claim must block duplicate mutation side effects");
  const status = json(path.join(f.state, "status.json"));
  assert(typeof status.blocker === "string" && status.blocker.length > 0, "read-only check refresh must preserve the active reconciliation blocker");
}

function testCrashAfterExecutionBoundaryNeedsReconciliation(): void {
  const f = fixture();
  const inFlight = request("apply");
  enqueue(f, inFlight);
  crashAfterExecutionBoundary(f);
  assert(lines(f.updaterLog) === 1, "crash fixture must cross the simulated execution boundary exactly once");
  assert(decisions(f).length === 0, "a killed agent must leave the claimed request without a fabricated terminal decision");

  const duplicate = request("apply", inFlight.idempotencyKey);
  enqueue(f, duplicate);
  run(f);
  assert(lines(f.updaterLog) === 1, "restart before claim expiry must not replay the mutation");
  assert(existsSync(path.join(f.state, "requests", `${duplicate.id}.json`)), "restart before claim expiry must leave the duplicate queued");

  runAgent(f, [agent], { AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch + 61) });
  assert(lines(f.updaterLog) === 1, "stale reconciliation and idempotent replay must not execute the updater again");
  assert(decisions(f).some((item) => item.reasonCode === "STALE_PROCESSING_CLAIM" && item.executionAttempted === null), "post-crash stale claim must record unknown execution state");
  assert(existsSync(path.join(f.state, "requests", `${duplicate.id}.json`)), "stale reconciliation must keep later mutations queued");
  runAgent(f, [agent], { AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch + 120) });
  assert(lines(f.updaterLog) === 1, "a later agent round must remain blocked by unresolved reconciliation");
  assert(existsSync(path.join(f.state, "requests", `${duplicate.id}.json`)), "unresolved reconciliation must block later mutation claims across agent rounds");
}

function testCrashAfterDecisionPublishRecoversClaim(): void {
  const f = fixture();
  enqueue(f, request("apply"));
  crashAfterDecisionPublish(f);
  const firstUpdaterCount = lines(f.updaterLog);
  assert(firstUpdaterCount === 1 && decisions(f).length === 1, "decision crash fixture must leave one durable decision and one claimed request");
  run(f);
  assert(lines(f.updaterLog) === firstUpdaterCount, "existing decision recovery must not replay updater execution");
  assert(decisions(f).length === 1, "existing decision recovery must not publish a second decision");
  assert(readdirSync(path.join(f.state, "processing")).length === 0, "existing decision recovery must clean the completed claim");
}

function testHistorySyncFailureDoesNotReplay(): void {
  const f = fixture();
  writeFileSync(f.syncMode, "fail-history-once\n");
  enqueue(f, request("apply"));
  let failed = false;
  try {
    run(f);
  } catch {
    failed = true;
  }
  assert(failed, "injected history fsync failure must stop the agent before claim cleanup");
  const updaterCount = lines(f.updaterLog);
  assert(updaterCount === 1 && decisions(f).length === 1, "history fsync failure must leave one immutable decision for reconciliation");
  run(f);
  assert(lines(f.updaterLog) === updaterCount, "history fsync recovery must not replay updater execution");
  assert(readdirSync(path.join(f.state, "processing")).length === 0, "history fsync recovery must clean the completed claim");
}

function createRollbackRecord(f: Fixture): { rollbackVersion: string; rollbackImage: string; sourceRecordSha256: string } {
  const rollbackVersion = "0.1.6";
  const rollbackImage = `ghcr.io/areasong/areaforge-web:v${rollbackVersion}@sha256:${"9".repeat(64)}`;
  const record = path.join(f.records, "20270115T080000Z", "update-record.txt");
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, `updatedAt: 2027-01-15T08:00:00Z\npreviousAppVersion: ${rollbackVersion}\npreviousImage: ${rollbackImage}\n`);
  return { rollbackVersion, rollbackImage, sourceRecordSha256: fileHash(record) };
}

function testRealProductionLockContention(): void {
  for (const action of ["apply", "rollback", "set_auto_apply"] as const) {
    const f = fixture();
    const realFlock = prepareRealFlockCommand(path.join(f.bin, "real-flock"));
    const lockFile = path.join(f.dir, ".areaforge-production-state.lock");
    const readyFile = path.join(f.dir, `lock-ready-${action}`);
    const holder = spawn(realFlock, [lockFile, "bash", "-c", `printf ready > '${readyFile}'; sleep 5`], { stdio: "ignore" });
    try {
      waitForFile(readyFile);
      enqueue(f, request(action));
      runAgent(f, [agent], { TEST_USE_SYSTEM_FLOCK: "1", AREAFORGE_TEST_REAL_FLOCK: realFlock });
      const decision = decisions(f).find((item) => item.reasonCode === "PRODUCTION_STATE_LOCK_BUSY");
      assert(decision?.executionAttempted === false, `${action} must fail closed under real production-state lock contention`);
      assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", `${action} lock contention must not change updater policy`);
      assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), `${action} lock contention must not reach external side effects`);
    } finally {
      holder.kill("SIGTERM");
    }
  }
}

function testStaleProcessingNeedsReconciliation(): void {
  const f = fixture();
  const value = request("apply");
  const claimDir = path.join(f.state, "processing", "stale-claim");
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${value.id}.json`), JSON.stringify(value));
  writeFileSync(path.join(claimDir, "claim.json"), JSON.stringify({
    claimId: "stale-claim",
    claimedAt: iso(nowEpoch - 120),
    claimExpiresAt: iso(nowEpoch - 60),
    originalFileName: `${value.id}.json`,
  }));
  run(f);
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "stale processing reconciliation must not replay execution");
  assert(decisions(f).some((item) => item.decision === "NEEDS_RECONCILIATION" && item.reasonCode === "STALE_PROCESSING_CLAIM" && item.executionAttempted === null), "stale claim must record unknown execution state");
  assert(existsSync(claimDir), "stale processing claim must remain as a persistent queue blocker until manual reconciliation");
}

function testMissingClaimMetadataNeedsReconciliation(): void {
  const f = fixture();
  const value = request("apply");
  const claimDir = path.join(f.state, "processing", "a".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${value.id}.json`), JSON.stringify(value));
  run(f);
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "missing claim metadata reconciliation must not replay execution");
  assert(decisions(f).some((item) => item.decision === "NEEDS_RECONCILIATION" && item.reasonCode === "MISSING_CLAIM_METADATA" && item.executionAttempted === null && item.claimMetadataSynthetic === true), "missing claim metadata decision must use a synthetic claim record");
  assert(existsSync(claimDir), "missing claim metadata must leave a persistent reconciliation blocker");
}

function testMissingProcessingRequestNeedsReconciliation(): void {
  const f = fixture();
  const claimDir = path.join(f.state, "processing", "d".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, "claim.json"), JSON.stringify({
    claimId: "d".repeat(32),
    claimedAt: iso(nowEpoch - 120),
    claimExpiresAt: iso(nowEpoch - 60),
    originalFileName: "missing.json",
  }));
  const queued = request("apply");
  enqueue(f, queued);
  run(f);
  assert(decisions(f).some((item) => item.decision === "NEEDS_RECONCILIATION" && item.reasonCode === "MISSING_PROCESSING_REQUEST" && item.executionAttempted === null), "claim-only processing state must create a persistent reconciliation decision");
  assert(existsSync(claimDir), "claim-only processing state must remain as a persistent blocker");
  assert(existsSync(path.join(f.state, "requests", `${queued.id}.json`)), "claim-only processing state must block later queued mutations");
  assert(typeof json(path.join(f.state, "status.json")).blocker === "string", "claim-only reconciliation must expose a top-level blocker for Web/API admission");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "claim-only reconciliation must not execute external side effects");
}

function testClaimMaterializationDoesNotFollowSymlink(): void {
  const f = fixture();
  const target = path.join(f.dir, "protected-target.env");
  writeFileSync(target, "AREAFORGE_AUTO_APPLY=none\n");
  chmodSync(target, 0o640);
  const requestPath = path.join(f.state, "requests", "symlink-race.json");
  symlinkSync(target, requestPath);
  runAgent(f, ["-c", `. "$1"
load_config
ensure_state_dirs
claim_dir="$(claim_request "$AREAFORGE_TEST_REQUEST")"
claimed="$claim_dir/$(basename "$AREAFORGE_TEST_REQUEST")"
[[ -f "$claimed" && ! -L "$claimed" ]]
`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
    AREAFORGE_TEST_REQUEST: requestPath,
  });
  assert((statSync(target).mode & 0o777) === 0o640, "claim materialization must not chmod a symlink target");
}

function testClaimMaterializationBreaksHardlinks(): void {
  const f = fixture();
  const value = request("check");
  const external = path.join(f.dir, "web-owned-request.json");
  const requestPath = path.join(f.state, "requests", `${value.id}.json`);
  writeFileSync(external, `${JSON.stringify(value)}\n`);
  chmodSync(external, 0o640);
  linkSync(external, requestPath);
  const originalInode = statSync(external).ino;
  const output = execFileSync("bash", ["-c", `. "$1"
load_config
ensure_state_dirs
claim_request "$AREAFORGE_TEST_REQUEST"
`, "selftest", agent], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
      AREAFORGE_UPDATE_AGENT_TEST_MODE: "1",
      AREAFORGE_UPDATE_AGENT_CONFIG: f.configFile,
      AREAFORGE_OPS_STATE_DIR: f.state,
      AREAFORGE_TEST_REQUEST: requestPath,
    },
  }).trim();
  const claimed = path.join(output, `${value.id}.json`);
  assert(statSync(claimed).ino !== originalInode, "claimed request must use a new root-owned inode");
  assert((statSync(claimed).mode & 0o777) === 0o400, "claimed request must be read-only");
  assert((statSync(external).mode & 0o777) === 0o640, "claim materialization must not chmod an external hardlink");
  assert(readFileSync(external, "utf8") === `${JSON.stringify(value)}\n`, "claim materialization must not mutate the external hardlink content");
}

function testClaimMaterializationRenameFailurePreservesRequest(): void {
  const f = fixture();
  const value = request("apply");
  enqueue(f, value);
  runWithMaterializeRenameFailure(f);
  const claimDirs = readdirSync(path.join(f.state, "processing"));
  assert(claimDirs.length === 1, "failed materialization must retain the claimed directory");
  const claimDir = path.join(f.state, "processing", claimDirs[0]);
  assert(existsSync(path.join(claimDir, `${value.id}.json`)), "failed materialization must retain the original claimed request name");
  assert(!existsSync(path.join(claimDir, "claim.json")), "failed materialization must not fabricate completed claim metadata");

  run(f);

  assert(decisions(f).some((item) => item.reasonCode === "MISSING_CLAIM_METADATA" && item.executionAttempted === null), "retained request must enter durable reconciliation on restart");
  assert(!existsSync(f.updaterLog), "materialization failure recovery must not execute the updater");
}

function testEmptyPreclaimDirectoryDoesNotBlockQueue(): void {
  const f = fixture();
  mkdirSync(path.join(f.state, "processing", "e".repeat(32)), { recursive: true });
  enqueue(f, request("check"));
  run(f);
  assert(lines(f.updaterLog) === 1, "an empty pre-claim directory must not block a queued request");
  assert(!decisions(f).some((item) => item.reasonCode === "MISSING_PROCESSING_REQUEST"), "empty pre-claim directory must not create a false reconciliation blocker");
}

function testMissingClaimAfterTerminalDecisionRecovers(): void {
  const f = fixture();
  const value = request("apply");
  enqueue(f, value);
  run(f);
  const decisionCount = decisions(f).length;
  const updaterCount = lines(f.updaterLog);
  const claimDir = path.join(f.state, "processing", "b".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${value.id}.json`), JSON.stringify(value));

  run(f);

  assert(decisions(f).length === decisionCount, "terminal request recovery must not write a second decision");
  assert(lines(f.updaterLog) === updaterCount, "terminal request recovery must not replay updater execution");
  assert(!existsSync(claimDir), "terminal request with missing claim metadata must be cleaned by request identity");
}

function testTemporaryQueueFilesAreNotConsumed(): void {
  const f = fixture();
  const temporary = path.join(f.state, "requests", ".partial-request.tmp");
  writeFileSync(temporary, "{\"schemaVersion\":2");
  run(f);
  assert(existsSync(temporary), "temporary queue file must remain untouched by the agent consumer");
  assert(decisions(f).length === 0, "temporary queue file must not create decision history");
}

function request(action: Action, idempotencyKey = randomUUID(), expectedOverrides: Record<string, unknown> = {}): Record<string, any> {
  const id = `update_${nowEpoch}_${randomUUID()}`;
  const expectedBefore = {
    currentVersion,
    currentImage,
    autoApply: "none",
    signatureRequired: true,
    rollbackAvailable: false,
    rollbackTargetVersion: null,
    rollbackTargetImage: null,
    rollbackSourceRecordSha256: null,
    ...expectedOverrides,
  };
  if (!("rollbackAvailable" in expectedOverrides)) {
    expectedBefore.rollbackAvailable = expectedBefore.rollbackTargetVersion !== null
      && expectedBefore.rollbackTargetImage !== null
      && expectedBefore.rollbackSourceRecordSha256 !== null;
  }
  const params = { tag: action === "apply" ? "v0.1.8" : null, autoApply: action === "set_auto_apply" ? "patch" : null };
  const target = action === "apply"
    ? { releaseId: 42, manifestSha256: `sha256:${"c".repeat(64)}`, manifestVersion: "0.1.8", webImageDigest: targetImage }
    : { releaseId: null, manifestSha256: null, manifestVersion: null, webImageDigest: null };
  const value: Record<string, any> = {
    schemaVersion: 2,
    id,
    action,
    status: "queued",
    requestedAt: iso(nowEpoch - 5),
    expiresAt: iso(nowEpoch + (action === "check" ? 895 : 295)),
    actorEmailHash: "d".repeat(64),
    idempotencyKey,
    params,
    target,
    expectedBefore,
    expectedBeforeHash: "",
    semanticHash: "",
    requestHash: "",
  };
  value.expectedBeforeHash = hash(stable({ domain: "areaforge.update-request.expected-before.v2", expectedBefore }));
  value.semanticHash = hash(stable({ domain: "areaforge.update-request.semantic.v2", action, params, target, expectedBefore }));
  value.requestHash = hash(stable({
    domain: "areaforge.update-request.v2",
    schemaVersion: value.schemaVersion,
    id,
    action,
    status: value.status,
    requestedAt: value.requestedAt,
    expiresAt: value.expiresAt,
    actorEmailHash: value.actorEmailHash,
    idempotencyKey,
    params,
    target,
    expectedBefore,
    expectedBeforeHash: value.expectedBeforeHash,
    semanticHash: value.semanticHash,
  }));
  return value;
}

function refreshHashes(value: Record<string, any>): void {
  value.expectedBeforeHash = hash(stable({ domain: "areaforge.update-request.expected-before.v2", expectedBefore: value.expectedBefore }));
  value.semanticHash = hash(stable({ domain: "areaforge.update-request.semantic.v2", action: value.action, params: value.params, target: value.target, expectedBefore: value.expectedBefore }));
  refreshRequestHash(value);
}

function refreshRequestHash(value: Record<string, any>): void {
  value.requestHash = hash(stable({
    domain: "areaforge.update-request.v2",
    schemaVersion: value.schemaVersion,
    id: value.id,
    action: value.action,
    status: value.status,
    requestedAt: value.requestedAt,
    expiresAt: value.expiresAt,
    actorEmailHash: value.actorEmailHash,
    idempotencyKey: value.idempotencyKey,
    params: value.params,
    target: value.target,
    expectedBefore: value.expectedBefore,
    expectedBeforeHash: value.expectedBeforeHash,
    semanticHash: value.semanticHash,
  }));
}

function enqueue(f: Fixture, value: Record<string, any>): void {
  enqueueRaw(f, value.id, value);
}

function enqueueRaw(f: Fixture, id: string, value: unknown): void {
  writeFileSync(path.join(f.state, "requests", `${id}.json`), `${JSON.stringify(value)}\n`);
}

function decisions(f: Fixture): Array<Record<string, any>> {
  const dir = path.join(f.state, "history");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".decision.json")).map((name) => json(path.join(dir, name)));
}

function json(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, "utf8"));
}

function lines(file: string): number {
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

function configValue(f: Fixture, key: string): string | undefined {
  return readFileSync(f.configFile, "utf8").split("\n").find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
}

function iso(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fileHash(file: string): string {
  return hash(readFileSync(file, "utf8"));
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

function waitForFile(file: string): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(file)) return;
    Atomics.wait(sleeper, 0, 0, 25);
  }
  throw new Error(`FAIL: timed out waiting for ${file}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

type Fixture = {
  dir: string;
  state: string;
  records: string;
  bin: string;
  envFile: string;
  configFile: string;
  updater: string;
  updaterLog: string;
  updaterMode: string;
  dockerLog: string;
  dockerMode: string;
  flockLog: string;
  syncLog: string;
  syncMode: string;
  productionLockMarker: string;
};

main();
