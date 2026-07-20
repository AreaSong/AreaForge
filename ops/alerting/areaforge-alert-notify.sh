#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

CONFIG_FILE="${AREAFORGE_ALERT_CONFIG:-/etc/areaforge/alerting.env}"
STATE_DIR_DEFAULT="/opt/areaforge/ops-state/alerting"
MODE=""
DRY_RUN="no"
OUTPUT_FILE=""

usage() {
  cat <<'USAGE'
Usage: areaforge-alert-notify.sh <check|notify> [--config PATH] [--output PATH] [--dry-run]

Read-only production signal collection with optional push notification for
AF-RISK-OPS-004. Signals follow docs/development/production-smoke-alerting-strategy.md:
  - public health endpoint reachability and version match
  - update-agent status freshness, blocker, signature policy
  - backup freshness under the backup directory
  - disk capacity for deploy and backup mounts
  - TLS certificate expiry

Modes:
  check    evaluate signals and print a redacted summary; never notifies,
           never touches notify dedup state.
  notify   evaluate signals, then push to configured ntfy/Telegram/webhook
           receivers when severity is warning or critical, with dedup and
           recovery notification. --dry-run prints the decision only.

This helper never runs updater check/apply, migrations, backups, restores,
rollback, Docker, Nginx, compose, database writes, or upload writes. It only
reads local status files and public endpoints, and posts redacted alert text
to explicitly configured receivers.
USAGE
}

log() { printf '[areaforge-alert-notify] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    check|notify) MODE="$1"; shift ;;
    --config) CONFIG_FILE="${2:?missing --config value}"; shift 2 ;;
    --output) OUTPUT_FILE="${2:?missing --output value}"; shift 2 ;;
    --dry-run) DRY_RUN="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ -n "$MODE" ]] || { usage >&2; exit 2; }

source_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
    set +a
  elif [[ "$MODE" == "notify" ]]; then
    die "config file not found: $CONFIG_FILE"
  fi
  STATE_DIR="${AREAFORGE_ALERT_STATE_DIR:-$STATE_DIR_DEFAULT}"
  UPDATE_AGENT_STATUS_FILE="${AREAFORGE_ALERT_UPDATE_AGENT_STATUS_FILE:-/opt/areaforge/ops-state/status.json}"
  BACKUP_DIR="${AREAFORGE_ALERT_BACKUP_DIR:-/opt/areaforge/backups}"
  DEPLOY_DIR="${AREAFORGE_ALERT_DEPLOY_DIR:-/opt/areaforge}"
  HEALTH_URL="${AREAFORGE_ALERT_HEALTH_URL:-${AREAFORGE_HEALTH_URL:-}}"
  EXPECTED_VERSION="${AREAFORGE_ALERT_EXPECTED_VERSION:-}"
  BACKUP_MAX_AGE_HOURS="${AREAFORGE_ALERT_BACKUP_MAX_AGE_HOURS:-24}"
  STATUS_MAX_AGE_HOURS="${AREAFORGE_ALERT_UPDATE_AGENT_MAX_AGE_HOURS:-26}"
  DISK_WARN_PERCENT="${AREAFORGE_ALERT_DISK_WARN_AVAIL_PERCENT:-20}"
  DISK_CRIT_PERCENT="${AREAFORGE_ALERT_DISK_CRIT_AVAIL_PERCENT:-10}"
  CERT_WARN_DAYS="${AREAFORGE_ALERT_CERT_WARN_DAYS:-14}"
  CERT_CRIT_DAYS="${AREAFORGE_ALERT_CERT_CRIT_DAYS:-7}"
  CERT_FILE="${AREAFORGE_ALERT_CERT_FILE:-}"
  CERT_HOST="${AREAFORGE_ALERT_CERT_HOST:-}"
  RENOTIFY_MINUTES="${AREAFORGE_ALERT_RENOTIFY_MINUTES:-360}"
  HEALTH_RETRY_DELAY_SECONDS="${AREAFORGE_ALERT_HEALTH_RETRY_DELAY_SECONDS:-5}"
}

now_epoch() { date -u +%s; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

iso_to_epoch() {
  local value="$1"
  date -u -d "$value" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$value" +%s 2>/dev/null || printf ''
}

SIGNALS_JSONL=""
append_signal() {
  local name="$1" severity="$2" detail="$3"
  jq -nc --arg name "$name" --arg severity "$severity" --arg detail "$detail" \
    '{name:$name, severity:$severity, detail:$detail}' >> "$SIGNALS_JSONL"
}

fetch_health() {
  local body_file="$1" status
  status="$(curl -sS -m 10 -w '%{http_code}' -o "$body_file" -H 'Accept: application/json' "$HEALTH_URL" 2>/dev/null || true)"
  [[ "$status" =~ ^2[0-9][0-9]$ ]]
}

check_health_signal() {
  if [[ -z "$HEALTH_URL" ]]; then
    append_signal "health" "warning" "health URL not configured"
    return
  fi
  local body_file first_ok="no"
  body_file="$(mktemp)"
  if fetch_health "$body_file"; then first_ok="yes"; fi
  if [[ "$first_ok" == "no" ]]; then
    sleep "$HEALTH_RETRY_DELAY_SECONDS"
    if ! fetch_health "$body_file"; then
      rm -f "$body_file"
      append_signal "health" "critical" "health endpoint failed twice"
      return
    fi
  fi
  local ok version
  ok="$(jq -r '.ok // false' "$body_file" 2>/dev/null || printf 'false')"
  version="$(jq -r '.version // "unknown"' "$body_file" 2>/dev/null || printf 'unknown')"
  rm -f "$body_file"
  if [[ "$ok" != "true" ]]; then
    append_signal "health" "critical" "health endpoint returned ok=false"
  elif [[ -n "$EXPECTED_VERSION" && "$version" != "$EXPECTED_VERSION" ]]; then
    append_signal "health" "critical" "version mismatch: observed $version expected $EXPECTED_VERSION"
  elif [[ "$first_ok" == "no" ]]; then
    append_signal "health" "warning" "health passed only after retry"
  else
    append_signal "health" "info" "health ok, version $version"
  fi
}

check_update_agent_signal() {
  if [[ ! -f "$UPDATE_AGENT_STATUS_FILE" ]]; then
    append_signal "update-agent" "warning" "status file missing"
    return
  fi
  local blocker signature updated_at updated_epoch age_hours
  blocker="$(jq -r '(.status? // .) | .blocker // empty' "$UPDATE_AGENT_STATUS_FILE" 2>/dev/null || true)"
  signature="$(jq -r '(.status? // .) | .signatureRequired // false' "$UPDATE_AGENT_STATUS_FILE" 2>/dev/null || printf 'false')"
  updated_at="$(jq -r '(.status? // .) | .statusUpdatedAt // empty' "$UPDATE_AGENT_STATUS_FILE" 2>/dev/null || true)"
  if [[ -n "$blocker" && "$blocker" != "null" ]]; then
    append_signal "update-agent" "critical" "blocker present"
    return
  fi
  if [[ "$signature" != "true" ]]; then
    append_signal "update-agent" "critical" "signature verification not required"
    return
  fi
  updated_epoch="$(iso_to_epoch "${updated_at:-}")"
  if [[ -z "$updated_epoch" ]]; then
    append_signal "update-agent" "warning" "statusUpdatedAt missing or unparsable"
    return
  fi
  age_hours=$(( ($(now_epoch) - updated_epoch) / 3600 ))
  if (( age_hours > STATUS_MAX_AGE_HOURS )); then
    append_signal "update-agent" "warning" "status stale: ${age_hours}h old"
  else
    append_signal "update-agent" "info" "status fresh (${age_hours}h), no blocker, signature required"
  fi
}

check_backup_signal() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    append_signal "backup-freshness" "critical" "backup directory missing"
    return
  fi
  local newest_epoch age_hours
  newest_epoch="$(find "$BACKUP_DIR" -type f -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1 || true)"
  if [[ -z "$newest_epoch" ]]; then
    newest_epoch="$(find "$BACKUP_DIR" -type f -exec stat -f '%m' {} + 2>/dev/null | sort -rn | head -1 || true)"
  fi
  if [[ -z "$newest_epoch" ]]; then
    append_signal "backup-freshness" "critical" "no backup files found"
    return
  fi
  age_hours=$(( ($(now_epoch) - newest_epoch) / 3600 ))
  if (( age_hours > BACKUP_MAX_AGE_HOURS )); then
    append_signal "backup-freshness" "warning" "newest backup is ${age_hours}h old"
  else
    append_signal "backup-freshness" "info" "newest backup is ${age_hours}h old"
  fi
}

check_disk_signal_for() {
  local label="$1" target="$2" avail_percent
  avail_percent="$(df -P "$target" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print 100-$5}' || true)"
  if [[ -z "$avail_percent" ]]; then
    append_signal "disk-$label" "warning" "unable to read disk usage"
    return
  fi
  if (( avail_percent < DISK_CRIT_PERCENT )); then
    append_signal "disk-$label" "critical" "only ${avail_percent}% available"
  elif (( avail_percent < DISK_WARN_PERCENT )); then
    append_signal "disk-$label" "warning" "only ${avail_percent}% available"
  else
    append_signal "disk-$label" "info" "${avail_percent}% available"
  fi
}

check_disk_signals() {
  check_disk_signal_for "deploy" "$DEPLOY_DIR"
  local deploy_dev backup_dev
  deploy_dev="$(df -P "$DEPLOY_DIR" 2>/dev/null | awk 'NR==2 {print $1}' || true)"
  backup_dev="$(df -P "$BACKUP_DIR" 2>/dev/null | awk 'NR==2 {print $1}' || true)"
  if [[ -d "$BACKUP_DIR" && -n "$backup_dev" && "$backup_dev" != "$deploy_dev" ]]; then
    check_disk_signal_for "backup" "$BACKUP_DIR"
  fi
}

cert_end_date() {
  if [[ -n "$CERT_FILE" && -f "$CERT_FILE" ]]; then
    openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2
    return
  fi
  local host="$CERT_HOST"
  if [[ -z "$host" && "$HEALTH_URL" == https://* ]]; then
    host="${HEALTH_URL#https://}"; host="${host%%/*}"; host="${host%%:*}"
  fi
  [[ -n "$host" ]] || return 0
  local probe="openssl s_client -connect ${host}:443 -servername ${host}"
  if command -v timeout >/dev/null 2>&1; then probe="timeout 10 $probe"; fi
  $probe </dev/null 2>/dev/null | openssl x509 -enddate -noout 2>/dev/null | cut -d= -f2
}

check_certificate_signal() {
  local end_date end_epoch days_left
  end_date="$(cert_end_date || true)"
  if [[ -z "$end_date" ]]; then
    append_signal "certificate-expiry" "info" "no certificate source configured or reachable; check skipped"
    return
  fi
  end_epoch="$(date -u -d "$end_date" +%s 2>/dev/null || date -u -j -f '%b %e %T %Y %Z' "$end_date" +%s 2>/dev/null || printf '')"
  if [[ -z "$end_epoch" ]]; then
    append_signal "certificate-expiry" "warning" "unable to parse certificate end date"
    return
  fi
  days_left=$(( (end_epoch - $(now_epoch)) / 86400 ))
  if (( days_left < CERT_CRIT_DAYS )); then
    append_signal "certificate-expiry" "critical" "certificate expires in ${days_left}d"
  elif (( days_left < CERT_WARN_DAYS )); then
    append_signal "certificate-expiry" "warning" "certificate expires in ${days_left}d"
  else
    append_signal "certificate-expiry" "info" "certificate valid for ${days_left}d"
  fi
}

collect_signals() {
  SIGNALS_JSONL="$(mktemp)"
  chmod 600 "$SIGNALS_JSONL"
  check_health_signal
  check_update_agent_signal
  check_backup_signal
  check_disk_signals
  check_certificate_signal
}

build_summary() {
  local signals_json severity would_notify
  signals_json="$(jq -s '.' "$SIGNALS_JSONL")"
  severity="$(jq -r 'map(.severity) | if any(. == "critical") then "critical" elif any(. == "warning") then "warning" else "info" end' <<<"$signals_json")"
  would_notify="false"
  [[ "$severity" == "info" ]] || would_notify="true"
  jq -n \
    --arg generatedAt "$(now_iso)" \
    --arg mode "read_only_alert_notify" \
    --arg severity "$severity" \
    --argjson wouldNotify "$would_notify" \
    --argjson signals "$signals_json" \
    '{
      generatedAt: $generatedAt,
      mode: $mode,
      severity: $severity,
      wouldNotify: $wouldNotify,
      signals: $signals,
      residualRiskIds: ["AF-RISK-OPS-004"],
      safetyFacts: {
        productionWriteAttempted: false,
        serverCommandAttempted: false,
        updaterApplyAttempted: false,
        backupRestoreAttempted: false,
        migrationAttempted: false,
        secretValuePrinted: false
      }
    }'
}

alert_text() {
  local summary_json="$1" prefix="$2"
  jq -r --arg prefix "$prefix" \
    '$prefix + " severity=" + .severity + " at " + .generatedAt + "\n" + ([.signals[] | select(.severity != "info") | "- " + .name + " [" + .severity + "]: " + .detail] | join("\n")) + (if ([.signals[] | select(.severity != "info")] | length) == 0 then "all signals pass" else "" end)' \
    <<<"$summary_json"
}

curl_with_config() {
  local config_body="$1"
  local config_file
  config_file="$(mktemp)"
  chmod 600 "$config_file"
  printf '%s\n' "$config_body" > "$config_file"
  local rc=0
  curl -sS -m 15 -o /dev/null -K "$config_file" || rc=$?
  rm -f "$config_file"
  return "$rc"
}

read_secret_file() {
  local file="$1" mode
  [[ -f "$file" ]] || { log "secret file missing: $file"; return 1; }
  mode="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file" 2>/dev/null || printf 'unknown')"
  if [[ "$mode" =~ ^[0-7]+$ ]] && (( 8#$mode & 8#077 )); then
    log "secret file $file is group/world readable; refusing to use it"
    return 1
  fi
  tr -d '\r\n' < "$file"
}

send_channels() {
  local text="$1" payload_json="$2" sent=0 attempted=0
  local flat_text
  flat_text="$(printf '%s' "$text" | tr '"' "'" | tr '\n' ' ')"
  if [[ -n "${AREAFORGE_ALERT_NTFY_URL:-}" ]]; then
    attempted=$((attempted + 1))
    local ntfy_config
    ntfy_config="$(printf 'url = "%s"\ndata = "%s"\n' "$AREAFORGE_ALERT_NTFY_URL" "$flat_text")"
    if [[ -n "${AREAFORGE_ALERT_NTFY_TOKEN_FILE:-}" ]]; then
      local ntfy_token
      if ntfy_token="$(read_secret_file "$AREAFORGE_ALERT_NTFY_TOKEN_FILE")"; then
        ntfy_config="$(printf '%s\nheader = "Authorization: Bearer %s"\n' "$ntfy_config" "$ntfy_token")"
      fi
    fi
    if curl_with_config "$ntfy_config"; then sent=$((sent + 1)); else log "ntfy delivery failed"; fi
  fi
  if [[ -n "${AREAFORGE_ALERT_TELEGRAM_BOT_TOKEN_FILE:-}" && -n "${AREAFORGE_ALERT_TELEGRAM_CHAT_ID:-}" ]]; then
    attempted=$((attempted + 1))
    local tg_token
    if tg_token="$(read_secret_file "$AREAFORGE_ALERT_TELEGRAM_BOT_TOKEN_FILE")"; then
      local tg_config
      tg_config="$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\ndata-urlencode = "chat_id=%s"\ndata-urlencode = "text=%s"\n' \
        "$tg_token" "$AREAFORGE_ALERT_TELEGRAM_CHAT_ID" "$flat_text")"
      if curl_with_config "$tg_config"; then sent=$((sent + 1)); else log "telegram delivery failed"; fi
    fi
  fi
  if [[ -n "${AREAFORGE_ALERT_WEBHOOK_URL:-}" ]]; then
    attempted=$((attempted + 1))
    local payload_file webhook_config
    payload_file="$(mktemp)"
    chmod 600 "$payload_file"
    printf '%s\n' "$payload_json" > "$payload_file"
    webhook_config="$(printf 'url = "%s"\nheader = "Content-Type: application/json"\ndata = "@%s"\n' "$AREAFORGE_ALERT_WEBHOOK_URL" "$payload_file")"
    if curl_with_config "$webhook_config"; then sent=$((sent + 1)); else log "webhook delivery failed"; fi
    rm -f "$payload_file"
  fi
  if (( attempted == 0 )); then
    log "no notification channel configured; set AREAFORGE_ALERT_NTFY_URL, AREAFORGE_ALERT_TELEGRAM_* or AREAFORGE_ALERT_WEBHOOK_URL"
    return 1
  fi
  (( sent > 0 ))
}

notify_decision() {
  local summary_json="$1" state_file="$2"
  local severity payload_hash last_hash last_severity last_notified_epoch decision
  severity="$(jq -r '.severity' <<<"$summary_json")"
  payload_hash="$(jq -c '{severity, signals: [.signals[] | {name, severity}]}' <<<"$summary_json" | sha256sum | awk '{print $1}')"
  last_hash=""; last_severity="info"; last_notified_epoch=0
  if [[ -f "$state_file" ]]; then
    last_hash="$(jq -r '.payloadHash // ""' "$state_file" 2>/dev/null || true)"
    last_severity="$(jq -r '.severity // "info"' "$state_file" 2>/dev/null || printf 'info')"
    last_notified_epoch="$(jq -r '.lastNotifiedEpoch // 0' "$state_file" 2>/dev/null || printf '0')"
  fi
  decision="skip"
  if [[ "$severity" != "info" ]]; then
    if [[ "$payload_hash" != "$last_hash" ]]; then
      decision="alert"
    elif (( $(now_epoch) - last_notified_epoch > RENOTIFY_MINUTES * 60 )); then
      decision="alert"
    fi
  elif [[ "$last_severity" != "info" ]]; then
    decision="recovery"
  fi
  printf '%s\t%s\n' "$decision" "$payload_hash"
}

write_state() {
  local state_file="$1" payload_hash="$2" severity="$3" notified="$4"
  mkdir -p "$(dirname "$state_file")"
  chmod 700 "$(dirname "$state_file")" 2>/dev/null || true
  local last_epoch
  if [[ "$notified" == "yes" ]]; then last_epoch="$(now_epoch)"; else
    last_epoch="$(jq -r '.lastNotifiedEpoch // 0' "$state_file" 2>/dev/null || printf '0')"
  fi
  jq -n --arg payloadHash "$payload_hash" --arg severity "$severity" --argjson lastNotifiedEpoch "${last_epoch:-0}" \
    '{payloadHash: $payloadHash, severity: $severity, lastNotifiedEpoch: $lastNotifiedEpoch}' > "$state_file.tmp"
  chmod 600 "$state_file.tmp"
  mv "$state_file.tmp" "$state_file"
}

severity_exit_code() {
  case "$1" in
    critical) printf '20\n' ;;
    warning) printf '10\n' ;;
    *) printf '0\n' ;;
  esac
}

main() {
  require_cmd jq
  require_cmd curl
  source_config
  collect_signals

  local summary_json severity
  summary_json="$(build_summary)"
  rm -f "$SIGNALS_JSONL"
  severity="$(jq -r '.severity' <<<"$summary_json")"

  if [[ -n "$OUTPUT_FILE" ]]; then
    printf '%s\n' "$summary_json" > "$OUTPUT_FILE"
    chmod 600 "$OUTPUT_FILE"
  fi

  if [[ "$MODE" == "check" ]]; then
    printf '%s\n' "$summary_json"
    exit "$(severity_exit_code "$severity")"
  fi

  local state_file decision payload_hash text notified="no"
  state_file="$STATE_DIR/last-notify.json"
  read -r decision payload_hash <<<"$(notify_decision "$summary_json" "$state_file")"

  if [[ "$DRY_RUN" == "yes" ]]; then
    log "dry-run: decision=$decision severity=$severity"
    printf '%s\n' "$summary_json"
    exit "$(severity_exit_code "$severity")"
  fi

  case "$decision" in
    alert)
      text="$(alert_text "$summary_json" 'AreaForge alert:')"
      if send_channels "$text" "$summary_json"; then notified="yes"; log "alert notification sent"; else log "alert notification not delivered"; fi
      ;;
    recovery)
      text="$(alert_text "$summary_json" 'AreaForge recovered:')"
      if send_channels "$text" "$summary_json"; then notified="yes"; log "recovery notification sent"; else log "recovery notification not delivered"; fi
      ;;
    skip)
      log "no notification needed (severity=$severity, unchanged or within renotify window)"
      ;;
  esac

  write_state "$state_file" "$payload_hash" "$severity" "$notified"
  printf '%s\n' "$summary_json"
  exit "$(severity_exit_code "$severity")"
}

main "$@"
