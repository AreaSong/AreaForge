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
HELD_PRODUCTION_STATE_LOCK_FILE=""
PRODUCTION_STATE_LOCK_ERROR=""
CONFIG_ENV_KEYS=(
  AREAFORGE_BACKUP_DIR
  AREAFORGE_ALLOW_COMPOSE_UPDATE
  AREAFORGE_ALLOW_PRERELEASE
  AREAFORGE_AUTO_APPLY
  AREAFORGE_AUTO_RESTORE_DB_ON_ROLLBACK
  AREAFORGE_COMPOSE_FILE
  AREAFORGE_COMPOSE_PROJECT
  AREAFORGE_COSIGN_PUBLIC_KEY
  AREAFORGE_DEPLOY_DIR
  AREAFORGE_ENV_FILE
  AREAFORGE_EXTRA_SMOKE_COMMAND
  AREAFORGE_GITHUB_REPO
  AREAFORGE_GITHUB_TOKEN
  AREAFORGE_GPG_VERIFY
  AREAFORGE_HEALTH_URL
  AREAFORGE_NGINX_CONFIG
  AREAFORGE_PRODUCTION_STATE_LOCK_FILE
  AREAFORGE_RELEASE_CHANNEL
  AREAFORGE_RELEASE_CHECKSUM_ASSET
  AREAFORGE_RELEASE_MANIFEST_ASSET
  AREAFORGE_RELEASE_SIGNATURE_ASSET
  AREAFORGE_REQUIRE_SIGNATURE
  AREAFORGE_SMOKE_ATTACHMENT_ID
  AREAFORGE_SMOKE_BASE_URL
  AREAFORGE_SMOKE_EMAIL
  AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY
  AREAFORGE_SMOKE_EXPECTED_VERSION
  AREAFORGE_SMOKE_PASSWORD
  AREAFORGE_SMOKE_PASSWORD_FILE
  AREAFORGE_UPLOADS_VOLUME
  AREAFORGE_UPDATE_RECORD_DIR
  AREAFORGE_WEB_GID
  AREAFORGE_WEB_UID
)
CONFIG_ENV_PRESENT=()
CONFIG_ENV_VALUES=()
CONFIG_ENV_CAPTURED=0

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

capture_config_environment() {
  local index key
  for ((index = 0; index < ${#CONFIG_ENV_KEYS[@]}; index += 1)); do
    key="${CONFIG_ENV_KEYS[$index]}"
    if declare -p "$key" >/dev/null 2>&1; then
      CONFIG_ENV_PRESENT[index]=1
      CONFIG_ENV_VALUES[index]="${!key}"
    else
      CONFIG_ENV_PRESENT[index]=0
      CONFIG_ENV_VALUES[index]=""
    fi
  done
  CONFIG_ENV_CAPTURED=1
}

restore_config_environment() {
  local index key
  for ((index = 0; index < ${#CONFIG_ENV_KEYS[@]}; index += 1)); do
    key="${CONFIG_ENV_KEYS[$index]}"
    unset "$key"
    if [[ "${CONFIG_ENV_PRESENT[$index]}" == "1" ]]; then
      printf -v "$key" '%s' "${CONFIG_ENV_VALUES[$index]}"
      export "${key?}"
    fi
  done
}

load_config() {
  [[ "$CONFIG_ENV_CAPTURED" == "1" ]] || capture_config_environment
  restore_config_environment
  [[ -f "$CONFIG_FILE" ]] || {
    log "config not found: $CONFIG_FILE"
    exit 1
  }
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  : "${AREAFORGE_ENV_FILE:?AREAFORGE_ENV_FILE is required}"
  : "${AREAFORGE_COMPOSE_FILE:?AREAFORGE_COMPOSE_FILE is required}"
  AREAFORGE_COMPOSE_PROJECT="${AREAFORGE_COMPOSE_PROJECT:-areaforge}"
  AREAFORGE_UPDATE_RECORD_DIR="${AREAFORGE_UPDATE_RECORD_DIR:-${AREAFORGE_BACKUP_DIR:-/opt/areaforge/backups}/github-release-updates}"
  AREAFORGE_PRODUCTION_STATE_LOCK_FILE="${AREAFORGE_PRODUCTION_STATE_LOCK_FILE:-${AREAFORGE_DEPLOY_DIR:-/opt/areaforge}/.areaforge-production-state.lock}"
}

configured_production_state_lock_path() (
  restore_config_environment
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  printf '%s' "${AREAFORGE_PRODUCTION_STATE_LOCK_FILE:-${AREAFORGE_DEPLOY_DIR:-/opt/areaforge}/.areaforge-production-state.lock}"
)

production_state_lock_path_matches_fd8() {
  local candidate="$1"
  local candidate_inode fd_inode
  [[ -e "$candidate" ]] || return 1
  if [[ -e "/proc/$$/fd/8" ]]; then
    [[ "$candidate" -ef "/proc/$$/fd/8" ]]
    return
  fi
  [[ -e "/dev/fd/8" ]] || return 1
  candidate_inode="$(stat -f '%i' "$candidate" 2>/dev/null)" || return 1
  fd_inode="$(stat -f '%i' /dev/fd/8 2>/dev/null)" || return 1
  [[ "$candidate_inode" == "$fd_inode" ]]
}

production_state_lock_binding_is_current() {
  local configured_path
  configured_path="$(configured_production_state_lock_path)" || return 1
  [[ -n "$HELD_PRODUCTION_STATE_LOCK_FILE" && "$configured_path" == "$HELD_PRODUCTION_STATE_LOCK_FILE" ]] || return 1
  production_state_lock_path_matches_fd8 "$configured_path"
}

acquire_agent_production_state_lock() {
  local configured_path
  PRODUCTION_STATE_LOCK_ERROR=""
  load_config
  HELD_PRODUCTION_STATE_LOCK_FILE="$AREAFORGE_PRODUCTION_STATE_LOCK_FILE"
  mkdir -p "$(dirname "$HELD_PRODUCTION_STATE_LOCK_FILE")" || {
    PRODUCTION_STATE_LOCK_ERROR=changed
    return 1
  }
  if ! { exec 8>"$HELD_PRODUCTION_STATE_LOCK_FILE"; }; then
    PRODUCTION_STATE_LOCK_ERROR=changed
    return 1
  fi
  chmod 600 "$HELD_PRODUCTION_STATE_LOCK_FILE" || {
    PRODUCTION_STATE_LOCK_ERROR=changed
    return 1
  }
  if ! flock -n 8; then
    PRODUCTION_STATE_LOCK_ERROR=busy
    return 1
  fi
  configured_path="$(configured_production_state_lock_path)" || {
    PRODUCTION_STATE_LOCK_ERROR=changed
    flock -u 8 || true
    return 1
  }
  if [[ "$configured_path" != "$HELD_PRODUCTION_STATE_LOCK_FILE" ]] ||
     ! production_state_lock_path_matches_fd8 "$configured_path"; then
    PRODUCTION_STATE_LOCK_ERROR=changed
    flock -u 8 || true
    return 1
  fi
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

fsync_path() {
  sync -f "$1"
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
  fsync_path "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$CONFIG_FILE" || { rm -f "$tmp"; return 1; }
  fsync_path "$(dirname "$CONFIG_FILE")" || return 1
}

write_json() {
  local output="$1"
  local mode="${2:-644}"
  local tmp
  tmp="$(mktemp "${output}.XXXXXX")"
  cat > "$tmp"
  chmod "$mode" "$tmp"
  fsync_path "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$output" || { rm -f "$tmp"; return 1; }
  fsync_path "$(dirname "$output")" || return 1
}

write_json_immutable() {
  local output="$1"
  local tmp
  tmp="$(mktemp "$HISTORY_DIR/.decision.XXXXXX")"
  cat > "$tmp"
  chmod 600 "$tmp"
  fsync_path "$tmp" || { rm -f "$tmp"; return 1; }
  if ! ln "$tmp" "$output" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
  fsync_path "$HISTORY_DIR" || return 1
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
      -e 's#(sk-|rk-|sess-)[A-Za-z0-9_-]{12,}#<redacted-token>#g' \
      -e 's#(^|[^A-Za-z0-9_/:])/(.*)#\1/<redacted-path>#' \
      -e 's#:/[^/].*#:/<redacted-path>#' |
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
    (.releaseId | type == "number" and floor == . and . >= 1 and . <= 9007199254740991) and
    (.manifestSha256 | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (.manifestVersion | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and
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
  if [[ "$ACTIVE_PROCESSING_CLAIM" == "1" ]]; then
    blocker="更新队列存在需要人工协调的 processing 请求；完成只读核对和人工处置前不会执行后续变更。"
  elif ! image_tag_matches_version "$current_image" "$current_version"; then
    blocker="当前运行镜像不是与 APP_VERSION 一致的 GHCR Release digest；请先修复镜像身份或 GHCR 访问。"
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
      currentImage:(if ($currentImage | length) > 0 then $currentImage else null end),
      appUrl:(if ($appUrl | length) > 0 then $appUrl else null end),
      releaseUrl:(if ($latestVersion | length) > 0 then "https://github.com/" + $githubRepo + "/releases/tag/v" + ($latestVersion | ltrimstr("v")) else null end),
      latestVersion:(if ($latestVersion | length) > 0 then $latestVersion else null end),
      latestPublishedAt:null,
      updateAvailable:$updateAvailable,
      autoApply:$autoApply,
      signatureRequired:$signatureRequired,
      verifiedTarget:$verifiedTarget,
      timerEnabled:$timerEnabled,
      timerActive:$timerActive,
      lastCheckedAt:(now | todateiso8601),
      rollback:$rollback,
      blocker:(if ($blocker | length) > 0 then $blocker else null end),
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
  AREAFORGE_PRODUCTION_STATE_LOCK_INHERITED=1 \
  AREAFORGE_INHERITED_PRODUCTION_STATE_LOCK_FILE="$HELD_PRODUCTION_STATE_LOCK_FILE" \
    "$UPDATER" apply --yes --tag "$tag" --config "$CONFIG_FILE" --request-guard "$request" --identity-json "$identity_path" 2>&1
}

run_exact_rollback() {
  local request="$1"
  local expected_source record record_snapshot record_snapshot_hash rollback target_image target_version original_env tmp env_dir
  local observed_second second_hash
  expected_source="$(jq -r '.expectedBefore.rollbackSourceRecordSha256' "$request")"
  record="$(find_rollback_record_by_hash "$expected_source")" || {
    printf 'rollback source record not found\n'
    return 3
  }
  record_snapshot="$(mktemp "$(dirname "$request")/.rollback-source.XXXXXX")" || return 4
  if ! cp -- "$record" "$record_snapshot"; then
    rm -f "$record_snapshot" || true
    return 4
  fi
  if ! record_snapshot_hash="$(sha256_file "$record_snapshot")"; then
    rm -f "$record_snapshot" || true
    return 4
  fi
  if [[ "$record_snapshot_hash" != "$expected_source" ]]; then
    rm -f "$record_snapshot" || return 4
    printf 'rollback source record changed before execution\n'
    return 3
  fi
  if ! rollback="$(rollback_from_record "$record_snapshot")"; then
    rm -f "$record_snapshot" || true
    return 4
  fi
  rm -f "$record_snapshot" || return 4
  target_image="$(jq -r '.targetImage // empty' <<< "$rollback")"
  target_version="$(jq -r '.targetVersion // empty' <<< "$rollback")"
  [[ -n "$target_image" && -n "$target_version" ]] || {
    printf 'rollback source record has no usable target\n'
    return 3
  }
  command -v docker >/dev/null 2>&1 || {
    printf 'docker command is unavailable\n'
    return 4
  }
  env_dir="$(dirname "$AREAFORGE_ENV_FILE")"
  original_env="$(mktemp "${AREAFORGE_ENV_FILE}.rollback-original.XXXXXX")" || return 4
  cp "$AREAFORGE_ENV_FILE" "$original_env" || { rm -f "$original_env"; return 4; }
  if ! chmod --reference="$AREAFORGE_ENV_FILE" "$original_env" 2>/dev/null && ! chmod 600 "$original_env"; then
    rm -f "$original_env"
    return 4
  fi
  fsync_path "$original_env" || { rm -f "$original_env"; return 4; }
  tmp="$(mktemp "${AREAFORGE_ENV_FILE}.XXXXXX")" || { rm -f "$original_env"; return 4; }
  if ! awk -v image="$target_image" -v version="$target_version" '
    /^AREAFORGE_IMAGE=/ { print "AREAFORGE_IMAGE=" image; next }
    /^APP_VERSION=/ { print "APP_VERSION=" version; next }
    { print }
  ' "$AREAFORGE_ENV_FILE" > "$tmp"; then
    rm -f "$tmp" "$original_env"
    return 4
  fi
  if ! chmod --reference="$AREAFORGE_ENV_FILE" "$tmp" 2>/dev/null && ! chmod 600 "$tmp"; then
    rm -f "$tmp" "$original_env"
    return 4
  fi
  fsync_path "$tmp" || { rm -f "$tmp" "$original_env"; return 4; }
  before_second_comparison
  observed_second="$(observed_before)"
  second_hash="$(observed_before_hash "$observed_second")"
  if ! production_state_lock_binding_is_current; then
    rm -f "$tmp" "$original_env" || return 4
    printf 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=PRODUCTION_STATE_LOCK_CHANGED observedBeforeHash=%s executionAttempted=false\n' "$second_hash" >&2
    return 8
  fi
  if ! expected_matches "$request" "$observed_second"; then
    rm -f "$tmp" "$original_env" || return 4
    printf 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=%s executionAttempted=false\n' "$second_hash" >&2
    return 5
  fi
  if ! validate_ttl "$request"; then
    rm -f "$tmp" "$original_env" || return 4
    printf 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=REQUEST_EXPIRED observedBeforeHash=%s executionAttempted=false\n' "$second_hash" >&2
    return 6
  fi
  printf 'AREAFORGE_REQUEST_GUARD phase=second result=pass reasonCode=NONE observedBeforeHash=%s executionAttempted=false\n' "$second_hash" >&2
  if ! mv "$tmp" "$AREAFORGE_ENV_FILE"; then
    rm -f "$tmp" || true
    printf 'rollback production env switch outcome is uncertain\n'
    return 7
  fi
  if fsync_path "$env_dir" && docker compose -p "$AREAFORGE_COMPOSE_PROJECT" --env-file "$AREAFORGE_ENV_FILE" -f "$AREAFORGE_COMPOSE_FILE" up -d web; then
    rm -f "$original_env"
    fsync_path "$env_dir" || return 2
    return 0
  fi

  printf 'rollback target switch failed; restoring original production env and web service\n'
  if ! mv "$original_env" "$AREAFORGE_ENV_FILE"; then
    printf 'rollback recovery could not restore original production env\n'
    return 2
  fi
  fsync_path "$env_dir" || return 2
  if ! docker compose -p "$AREAFORGE_COMPOSE_PROJECT" --env-file "$AREAFORGE_ENV_FILE" -f "$AREAFORGE_COMPOSE_FILE" up -d web; then
    printf 'rollback recovery could not confirm the original web service\n'
    return 2
  fi
  printf 'rollback target switch failed; original production state was restored\n'
  return 1
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
  decision_file="$(write_decision "$request" "$claim_dir/claim.json" "$decision" "$reason" false "$message")"
  operation="$(operation_from_decision "$decision_file")"
  cleanup_claim "$claim_dir"
  merge_status "$operation" false "$identity"
}

process_apply() {
  local claim_dir="$1"
  local request="$2"
  local output decision reason execution_attempted message decision_file operation identity observed_after identity_path updater_status
  local first_marker second_marker rejection_marker reconciliation_reason terminal_marker first_hash second_hash
  local first_marker_count second_marker_count execution_marker_count terminal_marker_count
  if ! acquire_agent_production_state_lock; then
    if [[ "$PRODUCTION_STATE_LOCK_ERROR" == "busy" ]]; then
      reject_claim "$claim_dir" PRODUCTION_STATE_LOCK_BUSY "production state lock is busy"
    else
      reject_claim "$claim_dir" PRODUCTION_STATE_LOCK_CHANGED "production state lock binding changed before execution"
    fi
    return
  fi
  identity_path="$(mktemp "$STATE_DIR/.verified-target.XXXXXX")"
  rm -f "$identity_path"
  execution_attempted=null
  updater_status=0
  if output="$(run_updater_apply "$request" "$identity_path")"; then
    decision=SUCCEEDED
    reason=APPLY_COMPLETED
  else
    updater_status="$?"
    decision=REJECTED
    reason=UPDATER_APPLY_FAILED
  fi
  execution_attempted="$(request_execution_attempted "$output")"
  terminal_marker="$(request_terminal_marker "$output")"
  first_marker="$(request_guard_marker "$output" first)"
  second_marker="$(request_guard_marker "$output" second)"
  first_marker_count="$(request_guard_marker_count "$output" first)"
  second_marker_count="$(request_guard_marker_count "$output" second)"
  execution_marker_count="$(request_execution_marker_count "$output")"
  terminal_marker_count="$(request_terminal_marker_count "$output")"
  reconciliation_reason="$(request_reconciliation_reason "$output")"
  first_hash="$(jq -r '.observedBeforeHash // "null"' <<< "${first_marker:-null}")"
  second_hash="$(jq -r '.observedBeforeHash // "null"' <<< "${second_marker:-null}")"
  rejection_marker=""
  if [[ "$first_marker_count" == "1" && -n "$first_marker" && "$(jq -r '.result' <<< "$first_marker")" == "reject" &&
        "$second_marker_count" == "0" && -z "$second_marker" && "$execution_marker_count" == "0" && "$execution_attempted" == "null" ]]; then
    rejection_marker="$first_marker"
  elif [[ "$first_marker_count" == "1" && -n "$first_marker" && "$(jq -r '.result' <<< "$first_marker")" == "pass" &&
          "$(jq -r '.reasonCode' <<< "$first_marker")" == "NONE" &&
          "$(jq -r '.executionAttempted' <<< "$first_marker")" == "false" &&
          "$second_marker_count" == "1" && -n "$second_marker" && "$(jq -r '.result' <<< "$second_marker")" == "reject" &&
          "$execution_marker_count" == "0" && "$execution_attempted" == "null" ]]; then
    rejection_marker="$second_marker"
  fi
  if [[ -n "$reconciliation_reason" ]]; then
    decision=NEEDS_RECONCILIATION
    reason="$reconciliation_reason"
    execution_attempted=true
  elif [[ -n "$rejection_marker" && "$updater_status" != "0" && "$terminal_marker_count" == "0" ]] &&
     [[ "$(jq -r '.executionAttempted' <<< "$rejection_marker")" == "false" ]] &&
     [[ "$(jq -r '.reasonCode' <<< "$rejection_marker")" =~ ^(CURRENT_IMAGE_IDENTITY_INVALID|EXPECTED_BEFORE_MISMATCH|TARGET_IDENTITY_CHANGED|REQUEST_EXPIRED)$ ]]; then
    decision=REJECTED
    reason="$(jq -r '.reasonCode' <<< "$rejection_marker")"
    execution_attempted=false
  elif [[ "$first_marker_count" == "1" && -n "$first_marker" && "$(jq -r '.result' <<< "$first_marker")" == "pass" &&
          "$(jq -r '.reasonCode' <<< "$first_marker")" == "NONE" &&
          "$(jq -r '.executionAttempted' <<< "$first_marker")" == "false" &&
          "$second_marker_count" == "1" && -n "$second_marker" && "$(jq -r '.result' <<< "$second_marker")" == "pass" &&
          "$(jq -r '.reasonCode' <<< "$second_marker")" == "NONE" &&
          "$(jq -r '.executionAttempted' <<< "$second_marker")" == "false" &&
          "$execution_marker_count" == "1" && "$execution_attempted" == "true" ]]; then
    if [[ "$updater_status" == "0" && "$terminal_marker_count" == "1" && "$terminal_marker" == "applied" ]]; then
      decision=SUCCEEDED
      reason=APPLY_COMPLETED
    elif [[ "$updater_status" == "1" && "$terminal_marker_count" == "1" && "$terminal_marker" == "rolled_back" ]]; then
      decision=REJECTED
      reason=UPDATER_APPLY_FAILED
    else
      decision=NEEDS_RECONCILIATION
      reason="${reconciliation_reason:-UPDATER_FINAL_STATE_UNCERTAIN}"
    fi
  else
    decision=NEEDS_RECONCILIATION
    reason=UPDATER_GUARD_EVIDENCE_INVALID
    execution_attempted=null
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
  if [[ "$decision" == "NEEDS_RECONCILIATION" ]]; then
    ACTIVE_PROCESSING_CLAIM=1
  else
    cleanup_claim "$claim_dir"
  fi
  merge_status "$operation" false "$identity"
  flock -u 8
}

before_second_comparison() {
  :
}

process_locked_mutation() {
  local claim_dir="$1"
  local request="$2"
  local action auto_apply observed_first observed_second observed_after first_hash second_hash output decision reason execution_attempted message decision_file operation rollback_status
  local second_marker second_marker_count second_guard_pass second_guard_reject_reason
  action="$(jq -r '.action' "$request")"
  auto_apply="$(jq -r '.params.autoApply // empty' "$request")"
  if ! acquire_agent_production_state_lock; then
    if [[ "$PRODUCTION_STATE_LOCK_ERROR" == "busy" ]]; then
      reject_claim "$claim_dir" PRODUCTION_STATE_LOCK_BUSY "production state lock is busy"
    else
      reject_claim "$claim_dir" PRODUCTION_STATE_LOCK_CHANGED "production state lock binding changed before execution"
    fi
    return
  fi
  if ! production_state_lock_binding_is_current; then
    reject_claim "$claim_dir" PRODUCTION_STATE_LOCK_CHANGED "production state lock binding changed before comparison"
    flock -u 8
    return
  fi
  observed_first="$(observed_before)"
  first_hash="$(observed_before_hash "$observed_first")"
  if ! expected_matches "$request" "$observed_first"; then
    decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED EXPECTED_BEFORE_MISMATCH false "live production state changed before execution" "$first_hash")"
    operation="$(operation_from_decision "$decision_file")"
    cleanup_claim "$claim_dir"
    merge_status "$operation" false
    flock -u 8
    return
  fi
  if ! auto_apply_prerequisites_met "$observed_first" "$auto_apply"; then
    decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED AUTO_APPLY_PREREQUISITES_UNMET false "patch auto apply requires signature verification and a tagged GHCR digest" "$first_hash")"
    operation="$(operation_from_decision "$decision_file")"
    cleanup_claim "$claim_dir"
    merge_status "$operation" false
    flock -u 8
    return
  fi
  if [[ "$action" == "rollback" ]]; then
    local expected_source
    expected_source="$(jq -r '.expectedBefore.rollbackSourceRecordSha256' "$request")"
    if ! find_rollback_record_by_hash "$expected_source" >/dev/null; then
      decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED ROLLBACK_TARGET_CHANGED false "bound rollback source record is unavailable" "$first_hash")"
      operation="$(operation_from_decision "$decision_file")"
      cleanup_claim "$claim_dir"
      merge_status "$operation" false
      flock -u 8
      return
    fi
  fi
  second_hash="null"
  if [[ "$action" != "rollback" ]]; then
    before_second_comparison
    observed_second="$(observed_before)"
    second_hash="$(observed_before_hash "$observed_second")"
    if ! production_state_lock_binding_is_current; then
      decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED PRODUCTION_STATE_LOCK_CHANGED false "production state lock binding changed at final execution boundary" "$first_hash" "$second_hash")"
      operation="$(operation_from_decision "$decision_file")"
      cleanup_claim "$claim_dir"
      merge_status "$operation" false
      flock -u 8
      return
    fi
    if ! expected_matches "$request" "$observed_second"; then
      decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED EXPECTED_BEFORE_MISMATCH false "live production state changed at final execution boundary" "$first_hash" "$second_hash")"
      operation="$(operation_from_decision "$decision_file")"
      cleanup_claim "$claim_dir"
      merge_status "$operation" false
      flock -u 8
      return
    fi
    if ! auto_apply_prerequisites_met "$observed_second" "$auto_apply"; then
      decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED AUTO_APPLY_PREREQUISITES_UNMET false "patch auto apply requires signature verification and a tagged GHCR digest" "$first_hash" "$second_hash")"
      operation="$(operation_from_decision "$decision_file")"
      cleanup_claim "$claim_dir"
      merge_status "$operation" false
      flock -u 8
      return
    fi
    if ! validate_ttl "$request"; then
      decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED REQUEST_EXPIRED false "request expired before the final execution boundary" "$first_hash" "$second_hash")"
      operation="$(operation_from_decision "$decision_file")"
      cleanup_claim "$claim_dir"
      merge_status "$operation" false
      flock -u 8
      return
    fi
  fi
  decision=SUCCEEDED
  reason=MUTATION_COMPLETED
  execution_attempted=false
  if [[ "$action" == "rollback" ]]; then
    rollback_status=0
    if output="$(run_exact_rollback "$request" 2>&1)"; then
      :
    else
      rollback_status="$?"
    fi
    second_marker="$(request_guard_marker "$output" second)"
    second_marker_count="$(request_guard_marker_count "$output" second)"
    second_hash="$(jq -r '.observedBeforeHash // "null"' <<< "${second_marker:-null}")"
    second_guard_pass=false
    second_guard_reject_reason=""
    if [[ "$second_marker_count" == "1" && -n "$second_marker" &&
          "$(jq -r '.result' <<< "$second_marker")" == "pass" &&
          "$(jq -r '.reasonCode' <<< "$second_marker")" == "NONE" &&
          "$(jq -r '.executionAttempted' <<< "$second_marker")" == "false" ]]; then
      second_guard_pass=true
    elif [[ "$second_marker_count" == "1" && -n "$second_marker" &&
            "$(jq -r '.result' <<< "$second_marker")" == "reject" &&
            "$(jq -r '.executionAttempted' <<< "$second_marker")" == "false" ]]; then
      second_guard_reject_reason="$(jq -r '.reasonCode' <<< "$second_marker")"
    fi
    case "$rollback_status" in
      0)
        execution_attempted=true
        if [[ "$second_guard_pass" != "true" ]]; then
          decision=NEEDS_RECONCILIATION
          reason=ROLLBACK_GUARD_EVIDENCE_INVALID
        fi
        ;;
      1)
        execution_attempted=true
        if [[ "$second_guard_pass" == "true" ]]; then
          decision=REJECTED
          reason=ROLLBACK_FAILED
        else
          decision=NEEDS_RECONCILIATION
          reason=ROLLBACK_GUARD_EVIDENCE_INVALID
        fi
        ;;
      2)
        decision=NEEDS_RECONCILIATION
        reason=$([[ "$second_guard_pass" == "true" ]] && printf ROLLBACK_RECOVERY_UNCERTAIN || printf ROLLBACK_GUARD_EVIDENCE_INVALID)
        execution_attempted=true
        ;;
      3)
        decision=REJECTED
        reason=ROLLBACK_TARGET_CHANGED
        ;;
      4)
        decision=REJECTED
        reason=ROLLBACK_PREPARATION_FAILED
        ;;
      5)
        if [[ "$second_guard_reject_reason" == "EXPECTED_BEFORE_MISMATCH" ]]; then
          decision=REJECTED
          reason=EXPECTED_BEFORE_MISMATCH
          execution_attempted=false
        else
          decision=NEEDS_RECONCILIATION
          reason=ROLLBACK_GUARD_EVIDENCE_INVALID
          execution_attempted=null
        fi
        ;;
      6)
        if [[ "$second_guard_reject_reason" == "REQUEST_EXPIRED" ]]; then
          decision=REJECTED
          reason=REQUEST_EXPIRED
          execution_attempted=false
        else
          decision=NEEDS_RECONCILIATION
          reason=ROLLBACK_GUARD_EVIDENCE_INVALID
          execution_attempted=null
        fi
        ;;
      7)
        decision=NEEDS_RECONCILIATION
        reason=ROLLBACK_ENV_SWITCH_UNCERTAIN
        execution_attempted=null
        ;;
      8)
        if [[ "$second_guard_reject_reason" == "PRODUCTION_STATE_LOCK_CHANGED" ]]; then
          decision=REJECTED
          reason=PRODUCTION_STATE_LOCK_CHANGED
          execution_attempted=false
        else
          decision=NEEDS_RECONCILIATION
          reason=ROLLBACK_GUARD_EVIDENCE_INVALID
          execution_attempted=null
        fi
        ;;
      *)
        decision=NEEDS_RECONCILIATION
        reason=ROLLBACK_GUARD_EVIDENCE_INVALID
        execution_attempted=null
        ;;
    esac
  else
    execution_attempted=true
    config_set AREAFORGE_AUTO_APPLY "$auto_apply"
    output="auto apply policy set to $auto_apply"
  fi
  message="$(status_message_from_output "$output")"
  observed_after="$(observed_before_hash "$(observed_before)")"
  decision_file="$(write_decision "$request" "$claim_dir/claim.json" "$decision" "$reason" "$execution_attempted" "$message" "$first_hash" "$second_hash" "$observed_after")"
  operation="$(operation_from_decision "$decision_file")"
  if [[ "$decision" == "NEEDS_RECONCILIATION" ]]; then
    ACTIVE_PROCESSING_CLAIM=1
  else
    cleanup_claim "$claim_dir"
  fi
  merge_status "$operation" false
  flock -u 8
}

next_queued_request() {
  find "$REQUEST_DIR" -maxdepth 1 -name '*.json' -type f ! -name '.*' | sort | head -n 1 || true
}

next_queued_check() {
  local request
  while IFS= read -r request; do
    [[ -n "$request" ]] || continue
    if jq -e '.action == "check"' "$request" >/dev/null 2>&1; then
      printf '%s\n' "$request"
      return 0
    fi
  done < <(find "$REQUEST_DIR" -maxdepth 1 -name '*.json' -type f ! -name '.*' | sort)
  return 1
}

main() {
  require_root
  require_cmd jq
  require_cmd sha256sum
  require_cmd flock
  require_cmd find
  require_cmd awk
  require_cmd stat
  require_cmd sync
  load_config
  ensure_state_dirs
  exec 9>"$LOCK_FILE"
  flock -n 9 || {
    log "another update agent process is running"
    exit 0
  }
  reconcile_stale_claims
  local request claim_dir
  if [[ "$ACTIVE_PROCESSING_CLAIM" == "1" ]]; then
    request="$(next_queued_check || true)"
    if [[ -n "$request" ]]; then
      claim_dir="$(claim_request "$request")"
      process_claim "$claim_dir"
    else
      merge_status null false
    fi
    return
  fi
  request="$(next_queued_request)"
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
