#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

CONFIG_FILE="${AREAFORGE_UPDATE_AGENT_CONFIG:-/etc/areaforge/updater.env}"
STATE_DIR="${AREAFORGE_OPS_STATE_DIR:-/opt/areaforge/ops-state}"
REQUEST_DIR="$STATE_DIR/requests"
HISTORY_DIR="$STATE_DIR/history"
STATUS_FILE="$STATE_DIR/status.json"
LOCK_FILE="$STATE_DIR/.update-agent.lock"
UPDATER="/opt/areaforge/ops/github-release-updater/areaforge-updater.sh"

log() {
  printf '[areaforge-update-agent] %s\n' "$*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
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
  local tmp
  tmp="$(mktemp "${output}.XXXXXX")"
  cat > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$output"
}

ensure_state_dirs() {
  local web_uid="${AREAFORGE_WEB_UID:-1001}"
  local web_gid="${AREAFORGE_WEB_GID:-1001}"
  mkdir -p "$STATE_DIR" "$REQUEST_DIR" "$HISTORY_DIR"
  chmod 755 "$STATE_DIR"
  chmod 750 "$HISTORY_DIR"
  chown "${web_uid}:${web_gid}" "$REQUEST_DIR" 2>/dev/null || true
  chmod 730 "$REQUEST_DIR"
}

github_headers() {
  printf '%s\n' "-H" "Accept: application/vnd.github+json"
  if [[ -n "${AREAFORGE_GITHUB_TOKEN:-}" ]]; then
    printf '%s\n' "-H" "Authorization: Bearer ${AREAFORGE_GITHUB_TOKEN}"
  fi
}

github_api() {
  local url="$1"
  local args=()
  while IFS= read -r header_arg; do
    args+=("$header_arg")
  done < <(github_headers)
  curl -fsSL "${args[@]}" "$url"
}

latest_release_json() {
  local repo="${AREAFORGE_GITHUB_REPO:-AreaSong/AreaForge}"
  github_api "https://api.github.com/repos/${repo}/releases/latest"
}

systemctl_bool() {
  local command="$1"
  local unit="$2"
  if systemctl "$command" "$unit" >/dev/null 2>&1; then
    printf 'true'
  else
    printf 'false'
  fi
}

detect_rollback() {
  local latest_record
  latest_record="$(find "${AREAFORGE_UPDATE_RECORD_DIR:-/opt/areaforge/backups/github-release-updates}" -name update-record.txt -type f 2>/dev/null | sort | tail -n 1 || true)"
  if [[ -z "$latest_record" ]]; then
    jq -n '{available:false,targetVersion:null,targetImage:null}'
    return
  fi
  local previous_version previous_image
  previous_version="$(awk -F': ' '$1=="previousAppVersion"{print $2; exit}' "$latest_record")"
  previous_image="$(awk -F': ' '$1=="previousImage"{print $2; exit}' "$latest_record")"
  if [[ -z "$previous_image" || "$previous_image" == "not-applicable" ]]; then
    jq -n '{available:false,targetVersion:null,targetImage:null}'
    return
  fi
  jq -n \
    --arg version "$previous_version" \
    --arg image "$previous_image" \
    '{available:true,targetVersion:$version,targetImage:$image}'
}

queue_length() {
  find "$REQUEST_DIR" -maxdepth 1 -name '*.json' -type f 2>/dev/null | wc -l | awk '{print $1}'
}

status_from_state() {
  local latest_json latest_version latest_published release_url blocker update_available
  latest_json="$(latest_release_json 2>/dev/null || true)"
  latest_version="$(jq -r '.tag_name // empty' <<< "$latest_json" 2>/dev/null || true)"
  latest_published="$(jq -r '.published_at // empty' <<< "$latest_json" 2>/dev/null || true)"
  release_url="$(jq -r '.html_url // empty' <<< "$latest_json" 2>/dev/null || true)"
  local current_version current_image auto_apply signature_required app_url timer_enabled timer_active rollback
  current_version="$(env_get APP_VERSION)"
  current_image="$(env_get AREAFORGE_IMAGE)"
  app_url="$(env_get APP_URL)"
  auto_apply="$(config_get AREAFORGE_AUTO_APPLY)"
  signature_required="$(config_get AREAFORGE_REQUIRE_SIGNATURE)"
  timer_enabled="$(systemctl_bool is-enabled areaforge-update-agent.timer)"
  timer_active="$(systemctl_bool is-active areaforge-update-agent.timer)"
  rollback="$(detect_rollback)"
  blocker=""
  if [[ "$current_image" != ghcr.io/* ]]; then
    blocker="当前运行镜像不是 GHCR Release digest；Release 自动更新需要先修复 GHCR read:packages 权限或公开 package。"
  elif [[ "$signature_required" != "true" ]]; then
    blocker="Release 签名校验未开启；补齐 COSIGN/GPG 后再开启强自动更新。"
  fi
  if [[ -n "$latest_version" && "$latest_version" != "v$current_version" && "$latest_version" != "$current_version" ]]; then
    update_available="true"
  else
    update_available="false"
  fi
  jq -n \
    --arg currentVersion "${current_version:-0.1.0}" \
    --arg currentImage "$current_image" \
    --arg appUrl "$app_url" \
    --arg latestVersion "$latest_version" \
    --arg latestPublishedAt "$latest_published" \
    --arg releaseUrl "$release_url" \
    --arg autoApply "${auto_apply:-none}" \
    --arg blocker "$blocker" \
    --argjson updateAvailable "$update_available" \
    --argjson signatureRequired "$([[ "$signature_required" == "true" ]] && printf true || printf false)" \
    --argjson timerEnabled "$timer_enabled" \
    --argjson timerActive "$timer_active" \
    --argjson rollback "$rollback" \
    --argjson requestQueueLength "$(queue_length)" \
    '{
      currentVersion:$currentVersion,
      currentImage:($currentImage | select(length > 0) // null),
      appUrl:($appUrl | select(length > 0) // null),
      releaseUrl:($releaseUrl | select(length > 0) // null),
      latestVersion:($latestVersion | select(length > 0) // null),
      latestPublishedAt:($latestPublishedAt | select(length > 0) // null),
      updateAvailable:$updateAvailable,
      autoApply:$autoApply,
      signatureRequired:$signatureRequired,
      timerEnabled:$timerEnabled,
      timerActive:$timerActive,
      lastCheckedAt:(now | todate),
      rollback:$rollback,
      blocker:($blocker | select(length > 0) // null),
      requestQueueLength:$requestQueueLength,
      statusUpdatedAt:(now | todate)
    }'
}

merge_status() {
  local operation_json="${1:-null}"
  local base
  base="$(status_from_state)"
  jq -s '.[0] + {lastOperation: .[1]}' <(printf '%s\n' "$base") <(printf '%s\n' "$operation_json") | write_json "$STATUS_FILE"
}

operation_json() {
  local request="$1"
  local status="$2"
  local message="$3"
  jq \
    --arg status "$status" \
    --arg finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg message "$message" \
    '.status=$status | .finishedAt=$finishedAt | .message=$message' "$request"
}

validate_request_schema() {
  local request="$1"
  jq -e '
    type == "object" and
    (.id | type == "string" and test("^update_[0-9]+_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")) and
    (.status == "queued") and
    (.action as $action | ["check", "apply", "rollback", "set_auto_apply"] | index($action) != null) and
    (.tag == null or (.tag | type == "string" and test("^v?[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$"))) and
    (.autoApply == null or (.autoApply as $policy | ["none", "patch", "minor", "all"] | index($policy) != null)) and
    (if .action == "apply" then (.tag | type == "string") else true end) and
    (if .action == "set_auto_apply" then (.autoApply | type == "string") else true end) and
    (.actorEmailHash == null or (.actorEmailHash | type == "string" and test("^[a-fA-F0-9]{64}$")))
  ' "$request" >/dev/null
}

archive_invalid_request() {
  local request="$1"
  local archive_id archive_path failed_json
  archive_id="invalid_$(date -u +%Y%m%dT%H%M%SZ)_$$"
  archive_path="$HISTORY_DIR/${archive_id}.json"
  mv "$request" "$archive_path"
  failed_json="$(jq -n \
    --arg id "$archive_id" \
    --arg finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      id:$id,
      action:"invalid",
      status:"failed",
      requestedAt:null,
      finishedAt:$finishedAt,
      message:"invalid update request schema"
    }')"
  printf '%s\n' "$failed_json" | write_json "$HISTORY_DIR/${archive_id}.failed.json"
  rm -f "$archive_path"
  merge_status "$failed_json"
}

run_updater_check() {
  "$UPDATER" check --config "$CONFIG_FILE" 2>&1
}

run_updater_apply() {
  local tag="$1"
  "$UPDATER" apply --yes --tag "$tag" --config "$CONFIG_FILE" 2>&1
}

run_rollback() {
  local rollback_json target_image target_version
  rollback_json="$(detect_rollback)"
  target_image="$(jq -r '.targetImage // empty' <<< "$rollback_json")"
  target_version="$(jq -r '.targetVersion // empty' <<< "$rollback_json")"
  [[ -n "$target_image" ]] || {
    printf 'no rollback target available\n'
    return 1
  }
  local tmp
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

process_request() {
  local request="$1"
  local id action tag auto_apply operation running_json output status message destination
  if ! validate_request_schema "$request"; then
    archive_invalid_request "$request"
    return
  fi
  id="$(jq -r '.id' "$request")"
  action="$(jq -r '.action' "$request")"
  tag="$(jq -r '.tag // empty' "$request")"
  auto_apply="$(jq -r '.autoApply // empty' "$request")"
  operation="$HISTORY_DIR/${id}.json"
  mv "$request" "$operation"
  running_json="$(operation_json "$operation" running "agent is executing request")"
  merge_status "$running_json"

  status="succeeded"
  case "$action" in
    check)
      if output="$(run_updater_check)"; then
        message="$(printf '%s' "$output" | tail -n 8 | tr '\n' ' ' | cut -c 1-500)"
      else
        status="failed"
        message="$(printf '%s' "$output" | tail -n 8 | tr '\n' ' ' | cut -c 1-500)"
      fi
      ;;
    apply)
      if [[ -z "$tag" ]]; then
        status="failed"
        message="missing release tag"
      elif output="$(run_updater_apply "$tag")"; then
        message="$(printf '%s' "$output" | tail -n 8 | tr '\n' ' ' | cut -c 1-500)"
      else
        status="failed"
        message="$(printf '%s' "$output" | tail -n 8 | tr '\n' ' ' | cut -c 1-500)"
      fi
      ;;
    rollback)
      if output="$(run_rollback)"; then
        message="$(printf '%s' "$output" | tail -n 8 | tr '\n' ' ' | cut -c 1-500)"
      else
        status="failed"
        message="$(printf '%s' "$output" | tail -n 8 | tr '\n' ' ' | cut -c 1-500)"
      fi
      ;;
    set_auto_apply)
      case "$auto_apply" in
        none|patch|minor|all)
          config_set AREAFORGE_AUTO_APPLY "$auto_apply"
          message="auto apply policy set to $auto_apply"
          ;;
        *)
          status="failed"
          message="invalid auto apply policy"
          ;;
      esac
      ;;
    *)
      status="failed"
      message="unknown action"
      ;;
  esac

  destination="$HISTORY_DIR/${id}.${status}.json"
  operation_json "$operation" "$status" "$message" | write_json "$destination"
  rm -f "$operation"
  merge_status "$(cat "$destination")"
}

main() {
  require_cmd curl
  require_cmd jq
  require_cmd docker
  require_cmd systemctl
  load_config
  ensure_state_dirs
  touch "$STATUS_FILE"
  exec 9>"$LOCK_FILE"
  flock -n 9 || {
    log "another update agent process is running"
    exit 0
  }

  local request
  request="$(find "$REQUEST_DIR" -maxdepth 1 -name '*.json' -type f | sort | head -n 1 || true)"
  if [[ -n "$request" ]]; then
    process_request "$request"
  else
    merge_status null
  fi
}

main "$@"
