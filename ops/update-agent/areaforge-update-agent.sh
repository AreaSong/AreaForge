#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${AREAFORGE_UPDATE_AGENT_CONFIG:-/etc/areaforge/updater.env}"
STATE_DIR="${AREAFORGE_OPS_STATE_DIR:-/opt/areaforge/ops-state}"
REQUEST_DIR="$STATE_DIR/requests"
PROCESSING_DIR="$STATE_DIR/processing"
HISTORY_DIR="$STATE_DIR/history"
STATUS_FILE="$STATE_DIR/status.json"
LOCK_FILE="$STATE_DIR/.update-agent.lock"
UPDATER="${AREAFORGE_UPDATER_PATH:-/opt/areaforge/ops/github-release-updater/areaforge-updater.sh}"
CLAIM_TTL_SECONDS="${AREAFORGE_UPDATE_AGENT_CLAIM_TTL_SECONDS:-600}"
CLOCK_SKEW_SECONDS=30
RECONCILED_STALE=0
ACTIVE_PROCESSING_CLAIM=0

# shellcheck source=lib/update-request-v2.sh
source "$SCRIPT_DIR/lib/update-request-v2.sh"
# shellcheck source=lib/update-request-state.sh
source "$SCRIPT_DIR/lib/update-request-state.sh"

log() {
  printf '[areaforge-update-agent] %s\n' "$*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

require_root() {
  if [[ "${EUID:-$(id -u)}" != "0" && "${AREAFORGE_UPDATE_AGENT_TEST_MODE:-0}" != "1" ]]; then
    log "update agent must run as root"
    exit 1
  fi
}

load_config() {
  [[ -f "$CONFIG_FILE" ]] || {
    log "config not found: $CONFIG_FILE"
    exit 1
  }
  set -a
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
  : "${AREAFORGE_ENV_FILE:?AREAFORGE_ENV_FILE is required}"
  : "${AREAFORGE_COMPOSE_FILE:?AREAFORGE_COMPOSE_FILE is required}"
  AREAFORGE_COMPOSE_PROJECT="${AREAFORGE_COMPOSE_PROJECT:-areaforge}"
  AREAFORGE_UPDATE_RECORD_DIR="${AREAFORGE_UPDATE_RECORD_DIR:-${AREAFORGE_BACKUP_DIR:-/opt/areaforge/backups}/github-release-updates}"
  AREAFORGE_PRODUCTION_STATE_LOCK_FILE="${AREAFORGE_PRODUCTION_STATE_LOCK_FILE:-${AREAFORGE_DEPLOY_DIR:-/opt/areaforge}/.areaforge-production-state.lock}"
}

now_epoch() {
  printf '%s' "${AREAFORGE_UPDATE_AGENT_NOW_EPOCH:-$(date +%s)}"
}

epoch_to_iso() {
  jq -nr --argjson value "$1" '$value | todateiso8601'
}

sha256_text() {
  printf '%s' "$1" | sha256sum | awk '{print "sha256:" $1}'
}

sha256_file() {
  sha256sum "$1" | awk '{print "sha256:" $1}'
}

env_get() {
  local key="$1"
  grep -E "^${key}=" "$AREAFORGE_ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//" || true
}

config_get() {
  local key="$1"
  grep -E "^${key}=" "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//" || true
}

config_set() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp "${CONFIG_FILE}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (found == 0) print key "=" value }
  ' "$CONFIG_FILE" > "$tmp"
  chmod --reference="$CONFIG_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv "$tmp" "$CONFIG_FILE"
}

write_json() {
  local output="$1"
  local mode="${2:-644}"
  local tmp
  tmp="$(mktemp "${output}.XXXXXX")"
  cat > "$tmp"
  chmod "$mode" "$tmp"
  mv "$tmp" "$output"
}

write_json_immutable() {
  local output="$1"
  local tmp
  tmp="$(mktemp "$HISTORY_DIR/.decision.XXXXXX")"
  cat > "$tmp"
  chmod 600 "$tmp"
  if ! ln "$tmp" "$output" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
}

status_message_from_output() {
  local raw="$1"
  printf '%s' "$raw" |
    tail -n 8 |
    tr '\n' ' ' |
    sed -E \
      -e 's#postgres(ql)?://[^[:space:]]+#postgres://<redacted>#g' \
      -e 's#(DATABASE_URL|AUTH_SESSION_SECRET|AUTH_ADMIN_PASSWORD_HASH|AI_API_KEY|OPENAI_API_KEY|AREAFORGE_GITHUB_TOKEN|COSIGN_PASSWORD|AREAFORGE_SMOKE_PASSWORD|PASSWORD|TOKEN|SECRET)=([^[:space:]]+)#\1=<redacted>#g' \
      -e 's#"(password|token|secret|apiKey|databaseUrl)"[[:space:]]*:[[:space:]]*"[^"]*"#"\1":"<redacted>"#g' \
      -e 's#(Bearer )[A-Za-z0-9._~+/-]+=*#\1<redacted>#g' \
      -e 's#(sk-|rk-|sess-)[A-Za-z0-9_-]{12,}#<redacted-token>#g' |
    cut -c 1-500
}

ensure_state_dirs() {
  local web_uid="${AREAFORGE_WEB_UID:-1001}"
  local web_gid="${AREAFORGE_WEB_GID:-1001}"
  mkdir -p "$STATE_DIR" "$REQUEST_DIR" "$PROCESSING_DIR" "$HISTORY_DIR"
  chmod 755 "$STATE_DIR"
  chmod 700 "$PROCESSING_DIR" "$HISTORY_DIR"
  chown "${web_uid}:${web_gid}" "$REQUEST_DIR" 2>/dev/null || true
  chmod 730 "$REQUEST_DIR"
}

systemctl_bool() {
  local command="$1"
  local unit="$2"
  if command -v systemctl >/dev/null 2>&1 && systemctl "$command" "$unit" >/dev/null 2>&1; then
    printf 'true'
  else
    printf 'false'
  fi
}

queue_length() {
  find "$REQUEST_DIR" -maxdepth 1 -name '*.json' -type f 2>/dev/null | wc -l | awk '{print $1}'
}

valid_verified_target() {
  jq -e '
    type == "object" and
    (keys | sort == ["manifestSha256","manifestVersion","releaseId","webImageDigest"]) and
    (.releaseId | type == "number" and floor == . and . >= 1) and
    (.manifestSha256 | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (.manifestVersion | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$")) and
    (.webImageDigest | type == "string" and test("^ghcr\\.io/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$"))
  ' >/dev/null 2>&1
}

extract_verified_target() {
  local raw="$1"
  local candidate
  candidate="$(printf '%s\n' "$raw" | sed -n 's/^AREAFORGE_UPDATER_IDENTITY_JSON=//p' | tail -n 1)"
  if [[ -z "$candidate" ]]; then
    candidate="$(printf '%s\n' "$raw" | while IFS= read -r line; do
      jq -ce 'if has("verifiedTarget") then .verifiedTarget elif has("identity") then .identity else . end' <<< "$line" 2>/dev/null || true
    done | tail -n 1)"
  fi
  if [[ -n "$candidate" ]] && valid_verified_target <<< "$candidate"; then
    jq -cS . <<< "$candidate"
  else
    printf 'null'
  fi
}

run_updater_check() {
  local identity_path="$1"
  "$UPDATER" check --config "$CONFIG_FILE" --identity-json "$identity_path" 2>&1
}

refresh_verified_target() {
  local output identity_path identity
  identity_path="$(mktemp "$STATE_DIR/.verified-target.XXXXXX")"
  rm -f "$identity_path"
  output="$(run_updater_check "$identity_path" || true)"
  if [[ -f "$identity_path" ]] && valid_verified_target < "$identity_path"; then
    identity="$(jq -cS . "$identity_path")"
  else
    identity="$(extract_verified_target "$output")"
  fi
  rm -f "$identity_path"
  printf '%s' "$identity"
}

status_from_state() {
  local verified_target="${1:-null}"
  local current_version current_image auto_apply signature_required app_url timer_enabled timer_active rollback blocker latest_version update_available github_repo
  current_version="$(env_get APP_VERSION)"
  current_image="$(env_get AREAFORGE_IMAGE)"
  app_url="$(env_get APP_URL)"
  auto_apply="$(config_get AREAFORGE_AUTO_APPLY)"
  signature_required="$(config_get AREAFORGE_REQUIRE_SIGNATURE)"
  timer_enabled="$(systemctl_bool is-enabled areaforge-update-agent.timer)"
  timer_active="$(systemctl_bool is-active areaforge-update-agent.timer)"
  rollback="$(detect_rollback)"
  latest_version="$(jq -r '.manifestVersion // empty' <<< "$verified_target")"
  github_repo="${AREAFORGE_GITHUB_REPO:-AreaSong/AreaForge}"
  blocker=""
  if [[ "$current_image" != ghcr.io/* ]]; then
    blocker="当前运行镜像不是 GHCR Release digest；Release 自动更新需要先修复 GHCR read:packages 权限或公开 package。"
  elif [[ "$signature_required" != "true" ]]; then
    blocker="Release 签名校验未开启；补齐 COSIGN/GPG 后再开启强自动更新。"
  fi
  if [[ -n "$latest_version" && "$latest_version" != "v$current_version" && "$latest_version" != "$current_version" ]]; then
    update_available=true
  else
    update_available=false
  fi
  jq -n \
    --arg currentVersion "${current_version:-0.1.0}" \
    --arg currentImage "$current_image" \
    --arg appUrl "$app_url" \
    --arg latestVersion "$latest_version" \
    --arg githubRepo "$github_repo" \
    --arg autoApply "${auto_apply:-none}" \
    --arg blocker "$blocker" \
    --argjson updateAvailable "$update_available" \
    --argjson signatureRequired "$([[ "$signature_required" == "true" ]] && printf true || printf false)" \
    --argjson timerEnabled "$timer_enabled" \
    --argjson timerActive "$timer_active" \
    --argjson rollback "$rollback" \
    --argjson verifiedTarget "$verified_target" \
    --argjson requestQueueLength "$(queue_length)" \
    '{
      snapshotSchemaVersion:2,
      currentVersion:$currentVersion,
      currentImage:($currentImage | select(length > 0) // null),
      appUrl:($appUrl | select(length > 0) // null),
      releaseUrl:($latestVersion | select(length > 0) | "https://github.com/" + $githubRepo + "/releases/tag/v" + ltrimstr("v") // null),
      latestVersion:($latestVersion | select(length > 0) // null),
      latestPublishedAt:null,
      updateAvailable:$updateAvailable,
      autoApply:$autoApply,
      signatureRequired:$signatureRequired,
      verifiedTarget:$verifiedTarget,
      timerEnabled:$timerEnabled,
      timerActive:$timerActive,
      lastCheckedAt:(now | todateiso8601),
      rollback:$rollback,
      blocker:($blocker | select(length > 0) // null),
      requestQueueLength:$requestQueueLength,
      statusUpdatedAt:(now | todateiso8601)
    }'
}

snapshot_hash() {
  local status_json="$1"
  local projection
  projection="$(jq -cS '{currentVersion,currentImage,autoApply,signatureRequired,verifiedTarget,rollback:{available:.rollback.available,targetVersion:.rollback.targetVersion,targetImage:.rollback.targetImage,sourceRecordSha256:.rollback.sourceRecordSha256}}' <<< "$status_json")"
  sha256_text "$projection"
}

merge_status() {
  local operation_json="${1:-null}"
  local refresh_identity="${2:-true}"
  local supplied_identity="${3:-}"
  local verified_target base hash
  if [[ -n "$supplied_identity" && "$supplied_identity" != "null" ]]; then
    verified_target="$supplied_identity"
  elif [[ "$refresh_identity" == "true" ]]; then
    verified_target="$(refresh_verified_target)"
  elif [[ -f "$STATUS_FILE" ]]; then
    verified_target="$(jq -c '.verifiedTarget // null' "$STATUS_FILE" 2>/dev/null || printf 'null')"
  else
    verified_target="null"
  fi
  base="$(status_from_state "$verified_target")"
  hash="$(snapshot_hash "$base")"
  if [[ "$operation_json" == "null" && -s "$STATUS_FILE" ]]; then
    operation_json="$(jq -c '.lastOperation // null' "$STATUS_FILE" 2>/dev/null || printf 'null')"
  fi
  jq -s --arg snapshotHash "$hash" '.[0] + {snapshotHash:$snapshotHash,lastOperation:.[1]}' \
    <(printf '%s\n' "$base") <(printf '%s\n' "$operation_json") | write_json "$STATUS_FILE" 644
}

run_updater_apply() {
  local request="$1"
  local identity_path="$2"
  local tag
  tag="$(jq -r '.params.tag' "$request")"
  "$UPDATER" apply --yes --tag "$tag" --config "$CONFIG_FILE" --request-guard "$request" --identity-json "$identity_path" 2>&1
}

run_exact_rollback() {
  local request="$1"
  local expected_source record rollback target_image target_version tmp
  expected_source="$(jq -r '.expectedBefore.rollbackSourceRecordSha256' "$request")"
  record="$(find_rollback_record_by_hash "$expected_source")" || {
    printf 'rollback source record not found\n'
    return 1
  }
  rollback="$(rollback_from_record "$record")"
  target_image="$(jq -r '.targetImage // empty' <<< "$rollback")"
  target_version="$(jq -r '.targetVersion // empty' <<< "$rollback")"
  [[ -n "$target_image" && -n "$target_version" ]] || {
    printf 'rollback source record has no usable target\n'
    return 1
  }
  require_cmd docker
  tmp="$(mktemp "${AREAFORGE_ENV_FILE}.XXXXXX")"
  awk -v image="$target_image" -v version="$target_version" '
    /^AREAFORGE_IMAGE=/ { print "AREAFORGE_IMAGE=" image; next }
    /^APP_VERSION=/ { print "APP_VERSION=" version; next }
    { print }
  ' "$AREAFORGE_ENV_FILE" > "$tmp"
  chmod --reference="$AREAFORGE_ENV_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  mv "$tmp" "$AREAFORGE_ENV_FILE"
  docker compose -p "$AREAFORGE_COMPOSE_PROJECT" --env-file "$AREAFORGE_ENV_FILE" -f "$AREAFORGE_COMPOSE_FILE" up -d web
}

process_check() {
  local claim_dir="$1"
  local request="$2"
  local output decision reason message decision_file operation identity identity_path
  decision=SUCCEEDED
  reason=CHECK_COMPLETED
  identity_path="$(mktemp "$STATE_DIR/.verified-target.XXXXXX")"
  rm -f "$identity_path"
  if output="$(run_updater_check "$identity_path")"; then
    message="$(status_message_from_output "$output")"
  else
    decision=REJECTED
    reason=UPDATER_CHECK_FAILED
    message="$(status_message_from_output "$output")"
  fi
  if [[ -f "$identity_path" ]] && valid_verified_target < "$identity_path"; then
    identity="$(jq -cS . "$identity_path")"
  else
    identity="$(extract_verified_target "$output")"
  fi
  rm -f "$identity_path"
  decision_file="$(write_decision "$request" "$claim_dir/claim.json" "$decision" "$reason" true "$message")"
  operation="$(operation_from_decision "$decision_file")"
  cleanup_claim "$claim_dir"
  merge_status "$operation" false "$identity"
}

process_apply() {
  local claim_dir="$1"
  local request="$2"
  local output decision reason execution_attempted message decision_file operation identity observed_after identity_path
  local first_marker second_marker rejection_marker first_hash second_hash
  identity_path="$(mktemp "$STATE_DIR/.verified-target.XXXXXX")"
  rm -f "$identity_path"
  execution_attempted=false
  if output="$(run_updater_apply "$request" "$identity_path")"; then
    decision=SUCCEEDED
    reason=APPLY_COMPLETED
  else
    decision=REJECTED
    reason=UPDATER_APPLY_FAILED
  fi
  execution_attempted="$(request_execution_attempted "$output")"
  first_marker="$(request_guard_marker "$output" first)"
  second_marker="$(request_guard_marker "$output" second)"
  first_hash="$(jq -r '.observedBeforeHash // "null"' <<< "${first_marker:-null}")"
  second_hash="$(jq -r '.observedBeforeHash // "null"' <<< "${second_marker:-null}")"
  rejection_marker="$second_marker"
  if [[ -z "$rejection_marker" || "$(jq -r '.result' <<< "$rejection_marker")" != "reject" ]]; then
    rejection_marker="$first_marker"
  fi
  if [[ -n "$rejection_marker" ]] &&
     [[ "$(jq -r '.result' <<< "$rejection_marker")" == "reject" ]] &&
     [[ "$(jq -r '.executionAttempted' <<< "$rejection_marker")" == "false" ]]; then
    reason="$(jq -r '.reasonCode' <<< "$rejection_marker")"
    execution_attempted=false
  fi
  message="$(status_message_from_output "$output")"
  if [[ -f "$identity_path" ]] && valid_verified_target < "$identity_path"; then
    identity="$(jq -cS . "$identity_path")"
  else
    identity="$(extract_verified_target "$output")"
  fi
  rm -f "$identity_path"
  observed_after="$(observed_before_hash "$(observed_before)")"
  decision_file="$(write_decision "$request" "$claim_dir/claim.json" "$decision" "$reason" "$execution_attempted" "$message" "$first_hash" "$second_hash" "$observed_after")"
  operation="$(operation_from_decision "$decision_file")"
  cleanup_claim "$claim_dir"
  merge_status "$operation" false "$identity"
}

before_second_comparison() {
  :
}

process_locked_mutation() {
  local claim_dir="$1"
  local request="$2"
  local action auto_apply observed_first observed_second observed_after first_hash second_hash output decision reason message decision_file operation
  action="$(jq -r '.action' "$request")"
  auto_apply="$(jq -r '.params.autoApply // empty' "$request")"
  mkdir -p "$(dirname "$AREAFORGE_PRODUCTION_STATE_LOCK_FILE")"
  exec 8>"$AREAFORGE_PRODUCTION_STATE_LOCK_FILE"
  if ! flock -n 8; then
    reject_claim "$claim_dir" PRODUCTION_STATE_LOCK_BUSY "production state lock is busy"
    return
  fi
  observed_first="$(observed_before)"
  first_hash="$(observed_before_hash "$observed_first")"
  if ! expected_matches "$request" "$observed_first"; then
    decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED EXPECTED_BEFORE_MISMATCH false "live production state changed before execution" "$first_hash")"
    operation="$(operation_from_decision "$decision_file")"
    flock -u 8
    cleanup_claim "$claim_dir"
    merge_status "$operation" false
    return
  fi
  if [[ "$action" == "rollback" ]]; then
    local expected_source
    expected_source="$(jq -r '.expectedBefore.rollbackSourceRecordSha256' "$request")"
    if ! find_rollback_record_by_hash "$expected_source" >/dev/null; then
      decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED ROLLBACK_TARGET_CHANGED false "bound rollback source record is unavailable" "$first_hash")"
      operation="$(operation_from_decision "$decision_file")"
      flock -u 8
      cleanup_claim "$claim_dir"
      merge_status "$operation" false
      return
    fi
  fi
  before_second_comparison
  observed_second="$(observed_before)"
  second_hash="$(observed_before_hash "$observed_second")"
  if ! expected_matches "$request" "$observed_second"; then
    decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED EXPECTED_BEFORE_MISMATCH false "live production state changed at final execution boundary" "$first_hash" "$second_hash")"
    operation="$(operation_from_decision "$decision_file")"
    flock -u 8
    cleanup_claim "$claim_dir"
    merge_status "$operation" false
    return
  fi
  decision=SUCCEEDED
  reason=MUTATION_COMPLETED
  if [[ "$action" == "rollback" ]]; then
    if output="$(run_exact_rollback "$request" 2>&1)"; then :; else decision=REJECTED; reason=ROLLBACK_FAILED; fi
  else
    config_set AREAFORGE_AUTO_APPLY "$auto_apply"
    output="auto apply policy set to $auto_apply"
  fi
  message="$(status_message_from_output "$output")"
  observed_after="$(observed_before_hash "$(observed_before)")"
  decision_file="$(write_decision "$request" "$claim_dir/claim.json" "$decision" "$reason" true "$message" "$first_hash" "$second_hash" "$observed_after")"
  operation="$(operation_from_decision "$decision_file")"
  flock -u 8
  cleanup_claim "$claim_dir"
  merge_status "$operation" false
}

main() {
  require_root
  require_cmd jq
  require_cmd sha256sum
  require_cmd flock
  require_cmd find
  require_cmd awk
  load_config
  ensure_state_dirs
  exec 9>"$LOCK_FILE"
  flock -n 9 || {
    log "another update agent process is running"
    exit 0
  }
  reconcile_stale_claims
  if [[ "$ACTIVE_PROCESSING_CLAIM" == "1" ]]; then
    merge_status null false
    return
  fi
  local request claim_dir
  request="$(find "$REQUEST_DIR" -maxdepth 1 -name '*.json' -type f ! -name '.*' | sort | head -n 1 || true)"
  if [[ -n "$request" ]]; then
    claim_dir="$(claim_request "$request")"
    process_claim "$claim_dir"
  elif [[ "$RECONCILED_STALE" == "1" ]]; then
    :
  else
    merge_status null true
  fi
}

if [[ "${AREAFORGE_UPDATE_AGENT_LIB_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
