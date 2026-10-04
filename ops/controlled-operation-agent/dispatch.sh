#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# 只由独立 root adapter 调用；Web 不持有此脚本或 config/state 的读写权限。
[[ "${OPS_AGENT_PRODUCTION_ENABLED:-false}" == "true" && "${EUID:-$(id -u)}" == "0" ]] || exit 77
BRIDGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export AREAFORGE_UPDATE_AGENT_LIB_ONLY=1
unset AREAFORGE_UPDATE_AGENT_TEST_MODE
# shellcheck source=../update-agent/areaforge-update-agent.sh
source "$BRIDGE_DIR/../update-agent/areaforge-update-agent.sh"

PHASE="${1:-}"
ENVELOPE="${2:-}"
load_config
[[ "${AREAFORGE_REQUIRE_SIGNATURE:-false}" == "true" ]] || exit 77

if [[ "$PHASE" == "observe" ]]; then
  target=null
  if [[ -f "$STATUS_FILE" && ! -L "$STATUS_FILE" ]]; then
    candidate="$(jq -c '.verifiedTarget // null' "$STATUS_FILE")"
    if valid_verified_target <<< "$candidate"; then target="$candidate"; fi
  fi
  jq -cn --argjson before "$(observed_before)" --argjson target "$target" '{expectedBefore:$before,target:$target}'
  exit 0
fi

[[ -f "$ENVELOPE" && ! -L "$ENVELOPE" && "$(stat -c '%u' "$ENVELOPE")" == 0 ]] || exit 77
jq -e '(.operation.schemaVersion == 2) and (.operation.execution.context.environment == "production") and
  (.requestHash | test("^sha256:[a-f0-9]{64}$")) and (.operation.parameters.operation as $op |
  ["CHECK_RELEASE","BACKUP_PREVIEW","DIAGNOSTIC_HEALTH","APPLY_RELEASE","ROLLBACK_RELEASE","MAINTENANCE_HOLD"] | index($op) != null)' "$ENVELOPE" >/dev/null
code="$(jq -r '.operation.parameters.operation' "$ENVELOPE")"
controlled_hash="$(jq -r '.requestHash' "$ENVELOPE")"
[[ "$controlled_hash" == "$(sha256_text "$(jq -cS '{domain:"areaforge.controlled-operation.request.v2",operation}' "$ENVELOPE")")" ]] || exit 77

bridge_guard() {
  local expected observed expires requested current
  expected="$(jq -cS '.operation.execution.context.expectedBefore' "$ENVELOPE")"
  observed="$(observed_before | jq -cS .)"
  [[ "$expected" == "$observed" ]] || return 1
  expires="$(timestamp_epoch "$(jq -r '.expiresAt' "$ENVELOPE")")"
  requested="$(timestamp_epoch "$(jq -r '.requestedAt' "$ENVELOPE")")"
  current="$(now_epoch)"
  (( current < expires && requested <= current + 30 && expires - requested <= 900 ))
}

emit_success() {
  jq -cn --arg requestHash "$controlled_hash" --arg evidenceHash "$1" --argjson attempted "${2:-false}" \
    '{outcome:"SUCCEEDED",requestHash:$requestHash,evidenceHash:$evidenceHash,executionAttempted:$attempted,reasonCode:"NONE"}'
}
emit_rejected() {
  local evidence
  evidence="$(jq -cnS --arg hash "$controlled_hash" --arg reason "$1" '{requestHash:$hash,reasonCode:$reason,executionAttempted:false}')"
  jq -cn --arg requestHash "$controlled_hash" --arg reason "$1" --arg hash "$(sha256_text "$evidence")" \
    '{outcome:"REJECTED",requestHash:$requestHash,evidenceHash:$hash,executionAttempted:false,reasonCode:$reason}'
}

case "$PHASE:$code" in
  preview:BACKUP_PREVIEW)
    # 始终只生成计划，绝不调用 backup_before_update 或 apply --dry-run。
    evidence="$(jq -cS '{metadataOnly:true,scope:.operation.parameters.scope,expectedBefore:.operation.execution.context.expectedBefore}' "$ENVELOPE")"
    emit_success "$(sha256_text "$evidence")"
    ;;
  health:DIAGNOSTIC_HEALTH|health:APPLY_RELEASE|health:ROLLBACK_RELEASE)
    expected="$(jq -r 'if .operation.parameters.operation == "APPLY_RELEASE" then .operation.execution.context.target.manifestVersion elif .operation.parameters.operation == "ROLLBACK_RELEASE" then .operation.execution.context.expectedBefore.rollbackTargetVersion else .operation.execution.context.expectedBefore.currentVersion end' "$ENVELOPE")"
    health="$(curl --fail --silent --show-error --max-time 15 "${AREAFORGE_HEALTH_URL:?health URL required}")"
    jq -e --arg version "$expected" '.ok == true and .service == "AreaForge" and .version == $version and .runtimeIdentity.status == "verified"' <<< "$health" >/dev/null
    expected_image="$(jq -r 'if .operation.parameters.operation == "APPLY_RELEASE" then .operation.execution.context.target.webImageDigest elif .operation.parameters.operation == "ROLLBACK_RELEASE" then .operation.execution.context.expectedBefore.rollbackTargetImage else .operation.execution.context.expectedBefore.currentImage end' "$ENVELOPE")"
    jq -e --arg image "$expected_image" '.currentImage == $image' <<< "$(observed_before)" >/dev/null
    emit_success "$(sha256_text "$(jq -cS '{ok,service,version}' <<< "$health")")"
    ;;
  maintenance:MAINTENANCE_HOLD)
    journal_init "$STATE_DIR"
    maintenance_init "$STATE_DIR"
    maintenance_acquire_queue_control || { emit_rejected QUEUE_CONTROL_LOCK_BUSY; exit 0; }
    acquire_agent_production_state_lock || { emit_rejected PRODUCTION_STATE_LOCK_BUSY; exit 0; }
    bridge_guard || { emit_rejected EXPECTED_BEFORE_OR_TTL_CHANGED; exit 0; }
    reason="$(jq -r '.operation.parameters.reasonCode' "$ENVELOPE")"
    [[ "$reason" =~ ^(RELEASE|INCIDENT|RESTORE|CAPACITY)$ ]] || exit 77
    # 仅停止新的 admission；不把 hold 成功写成进程已停止或队列已 drain。
    hold="$(maintenance_publish_hold "$reason" controlled-ops.request)"
    flock -u 8
    maintenance_release_queue_control
    emit_success "$(sha256_text "$hold")" true
    ;;
  check:CHECK_RELEASE|execution:APPLY_RELEASE|execution:ROLLBACK_RELEASE)
    journal_init "$STATE_DIR"
    maintenance_init "$STATE_DIR"
    exec 9>"$LOCK_FILE"
    flock -n 9 || { emit_rejected AGENT_LOCK_BUSY; exit 0; }
    maintenance_acquire_queue_control || { emit_rejected QUEUE_CONTROL_LOCK_BUSY; exit 0; }
    [[ "$(maintenance_active_hold)" == null && "$(journal_scan_all)" == clean ]] || { emit_rejected LEGACY_ADMISSION_BLOCKED; exit 0; }
    [[ -z "$(find "$PROCESSING_DIR" -mindepth 1 -maxdepth 1 -type d -print -quit)" ]] || { emit_rejected LEGACY_CLAIM_ACTIVE; exit 0; }
    bridge_guard || { emit_rejected EXPECTED_BEFORE_OR_TTL_CHANGED; exit 0; }
    wire="$(mktemp "$(dirname "$ENVELOPE")/.wire.XXXXXX")"
    jq '.operation.execution.updaterRequest' "$ENVELOPE" > "$wire"
    chmod 600 "$wire"
    if ! validate_request_schema "$wire" || ! validate_ttl "$wire"; then
      emit_rejected LEGACY_REQUEST_REJECTED
      exit 0
    fi
    [[ "$(request_hash "$wire")" == "$(jq -r '.requestHash' "$wire")" ]] || exit 77
    action="$(jq -r '.action' "$wire")"
    case "$code:$action" in CHECK_RELEASE:check|APPLY_RELEASE:apply|ROLLBACK_RELEASE:rollback) ;; *) exit 77 ;; esac
    fsync_path "$wire"
    queued="$(dirname "$ENVELOPE")/$(jq -r '.id' "$wire").json"
    ln "$wire" "$queued"
    rm -f "$wire"
    fsync_path "$(dirname "$ENVELOPE")"
    wire_hash="$(jq -r '.requestHash' "$queued")"
    claim="$(claim_request "$queued")"
    maintenance_release_queue_control
    # 复用原 guard、签名/checksum/digest、备份、双 expected-before、固定回滚及 decision 链。
    process_claim "$claim" >/dev/null 2>&1
    decision="$(history_match requestHash "$wire_hash")"
    [[ -n "$decision" ]] || exit 75
    jq -e --slurpfile envelope "$ENVELOPE" \
      '({schemaVersion,id,action,status:"queued",requestedAt,expiresAt,actorEmailHash,idempotencyKey,params,target,expectedBefore,expectedBeforeHash,semanticHash,requestHash} == $envelope[0].operation.execution.updaterRequest) and
       ((.decision == "SUCCEEDED" and .status == "succeeded") or (.decision == "REJECTED" and .status == "failed") or (.decision == "NEEDS_RECONCILIATION" and .status == "needs_reconciliation"))' "$decision" >/dev/null
    if [[ "$code" == CHECK_RELEASE && "$(jq -r '.decision' "$decision")" == SUCCEEDED && "$(jq -r '.operation.parameters.tag' "$ENVELOPE")" != null ]]; then
      jq -e --slurpfile request "$ENVELOPE" '.verifiedTarget == $request[0].operation.execution.context.target' "$STATUS_FILE" >/dev/null
    fi
    jq -c --arg controlledHash "$controlled_hash" --arg hash "sha256:$(sha256sum "$decision" | awk '{print $1}')" \
      '{outcome:.decision,requestHash:$controlledHash,evidenceHash:$hash,executionAttempted,reasonCode}' "$decision"
    ;;
  *) exit 77 ;;
esac
