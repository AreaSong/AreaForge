#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

CONFIG_FILE="${AREAFORGE_UPDATE_AGENT_CONFIG:-/etc/areaforge/updater.env}"

usage() {
  cat <<'USAGE'
Usage: areaforge-release-readonly-smoke.sh [--config PATH]

Runs the release updater's authenticated read-only HTTP smoke without Node.js or
pnpm. It does not run updater apply, migrations, backups, restores, rollback,
Docker, Nginx, compose, database writes, upload writes, or residual changes.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_FILE="${2:?missing --config value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

fail_config() {
  printf 'FAIL config: %s\n' "$*" >&2
  exit 2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail_config "required command not found: $1"
}

normalize_base_url() {
  local value="$1"
  value="${value%/}"
  printf '%s\n' "$value"
}

source_config() {
  local env_expected_version="${AREAFORGE_SMOKE_EXPECTED_VERSION:-}"
  [[ -f "$CONFIG_FILE" ]] || fail_config "config file not found: $CONFIG_FILE"
  set -a
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
  if [[ -n "$env_expected_version" ]]; then
    AREAFORGE_SMOKE_EXPECTED_VERSION="$env_expected_version"
  fi
}

resolve_base_url() {
  if [[ -n "${AREAFORGE_SMOKE_BASE_URL:-}" ]]; then
    normalize_base_url "$AREAFORGE_SMOKE_BASE_URL"
  elif [[ -n "${APP_URL:-}" ]]; then
    normalize_base_url "$APP_URL"
  elif [[ -n "${AREAFORGE_HEALTH_URL:-}" ]]; then
    normalize_base_url "${AREAFORGE_HEALTH_URL%/api/health}"
  else
    printf ''
  fi
}

epoch_ms() {
  local value
  value="$(date +%s%3N 2>/dev/null || true)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    printf '%s000\n' "$(date +%s)"
  fi
}

request_json() {
  local method="$1"
  local path="$2"
  local data_file="${3:-}"
  local body_file status
  body_file="$(mktemp)"
  if [[ -n "$data_file" ]]; then
    status="$(curl -sS -m "$TIMEOUT_SECONDS" -w '%{http_code}' -o "$body_file" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -H 'Accept: application/json' -H 'Content-Type: application/json' \
      -X "$method" --data-binary "@$data_file" "$BASE_URL$path" || true)"
  else
    status="$(curl -sS -m "$TIMEOUT_SECONDS" -w '%{http_code}' -o "$body_file" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -H 'Accept: application/json' -X "$method" "$BASE_URL$path" || true)"
  fi
  if [[ ! "$status" =~ ^2[0-9][0-9]$ ]]; then
    rm -f "$body_file"
    printf 'HTTP %s for %s' "$status" "$path"
    return 1
  fi
  cat "$body_file"
  rm -f "$body_file"
}

append_result() {
  local name="$1"
  local ok="$2"
  local detail="$3"
  local duration_ms="$4"

  if [[ "$ok" == "true" ]]; then
    printf 'PASS %s: ok (%sms)\n' "$name" "$duration_ms"
  else
    printf 'FAIL %s: %s (%sms)\n' "$name" "$detail" "$duration_ms"
  fi
  jq -nc --arg name "$name" --argjson ok "$ok" --argjson durationMs "$duration_ms" \
    '{name:$name, ok:$ok, durationMs:$durationMs}' >> "$CHECKS_JSONL"
}

run_check() {
  local name="$1"
  shift
  local started ended duration_ms detail rc
  started="$(epoch_ms)"
  set +e
  detail="$("$@" 2>&1 >/dev/null)"
  rc=$?
  set -e
  ended="$(epoch_ms)"
  duration_ms=$((ended - started))

  if [[ "$rc" -eq 0 ]]; then
    append_result "$name" true ok "$duration_ms"
  else
    append_result "$name" false "${detail:-validation failed}" "$duration_ms"
  fi
}

check_health() {
  local body
  body="$(request_json GET /api/health)" || return 1
  jq -e --arg expected "$EXPECTED_VERSION" \
    '(.ok == true) and (.service == "AreaForge") and (($expected | length) == 0 or .version == $expected)' \
    >/dev/null <<<"$body" || {
      printf 'health validation failed'
      return 1
    }
}

write_login_payload() {
  {
    printf '%s\n' "$AREAFORGE_SMOKE_EMAIL"
    printf '%s\n' "$SMOKE_PASSWORD"
  } | jq -Rn 'input as $email | input as $password | {email:$email,password:$password}' > "$LOGIN_PAYLOAD"
}

check_login() {
  local body
  write_login_payload
  body="$(request_json POST /api/auth/login "$LOGIN_PAYLOAD")" || return 1
  jq -e '.user.email | type == "string"' >/dev/null <<<"$body" || {
    printf 'login validation failed'
    return 1
  }
}

check_path() {
  local label="$1"
  local path="$2"
  local jq_expr="$3"
  local body
  body="$(request_json GET "$path")" || return 1
  jq -e "$jq_expr" >/dev/null <<<"$body" || {
    printf '%s validation failed' "$label"
    return 1
  }
}

check_update_status() {
  local body
  body="$(request_json GET /api/system/update-status)" || return 1
  jq -e --arg expected "$EXPECTED_AUTO_APPLY" \
    '(.status.currentVersion | type == "string") and (($expected | length) == 0 or .status.autoApply == $expected)' \
    >/dev/null <<<"$body" || {
      printf 'update-status validation failed'
      return 1
    }
}

main() {
  require_cmd curl
  require_cmd jq
  source_config

  BASE_URL="$(resolve_base_url)"
  [[ -n "$BASE_URL" ]] || fail_config "AREAFORGE_SMOKE_BASE_URL, APP_URL, or AREAFORGE_HEALTH_URL is required"
  [[ "$BASE_URL" =~ ^https?:// ]] || fail_config "base URL must start with http:// or https://"
  [[ -n "${AREAFORGE_SMOKE_EMAIL:-}" ]] || fail_config "AREAFORGE_SMOKE_EMAIL is required"
  [[ -n "${AREAFORGE_SMOKE_PASSWORD_FILE:-}" ]] || fail_config "AREAFORGE_SMOKE_PASSWORD_FILE is required"
  [[ -f "$AREAFORGE_SMOKE_PASSWORD_FILE" ]] || fail_config "smoke password file missing"

  TIMEOUT_SECONDS="$(( (${AREAFORGE_SMOKE_TIMEOUT_MS:-10000} + 999) / 1000 ))"
  [[ "$TIMEOUT_SECONDS" -gt 0 ]] || TIMEOUT_SECONDS=10
  EXPECTED_VERSION="${AREAFORGE_SMOKE_EXPECTED_VERSION:-${APP_VERSION:-}}"
  EXPECTED_AUTO_APPLY="${AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY:-}"
  SMOKE_PASSWORD="$(tr -d '\r\n' < "$AREAFORGE_SMOKE_PASSWORD_FILE")"
  COOKIE_JAR="$(mktemp)"
  LOGIN_PAYLOAD="$(mktemp)"
  CHECKS_JSONL="$(mktemp)"
  chmod 600 "$COOKIE_JAR" "$LOGIN_PAYLOAD" "$CHECKS_JSONL"
  trap 'rm -f "$COOKIE_JAR" "$LOGIN_PAYLOAD" "$CHECKS_JSONL"' EXIT

  run_check health check_health
  run_check login check_login
  run_check auth/me check_path auth/me /api/auth/me '.user.email | type == "string"'
  run_check dashboard check_path dashboard /api/dashboard/today '.dashboard != null'
  run_check notes check_path notes /api/notes '.notes | type == "array"'
  run_check syllabus check_path syllabus /api/syllabus 'type == "object"'
  run_check analytics check_path analytics /api/analytics/summary '.analytics != null'
  run_check reports check_path reports /api/reports/periodic '.reports != null'
  run_check long-term-risks check_path long-term-risks /api/analytics/long-term-risks '.longTermRisks != null'
  run_check update-status check_update_status

  local failed_count checks_json checked_at overall
  failed_count="$(jq -s '[.[] | select(.ok == false)] | length' "$CHECKS_JSONL")"
  checks_json="$(jq -s '.' "$CHECKS_JSONL")"
  checked_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$failed_count" == "0" ]]; then
    overall=true
  else
    overall=false
  fi
  jq -cn --argjson ok "$overall" --arg baseUrl "$BASE_URL" --arg checkedAt "$checked_at" --argjson checks "$checks_json" \
    '{ok:$ok, baseUrl:$baseUrl, checkedAt:$checkedAt, command:"areaforge-release-readonly-smoke", checks:$checks}'

  [[ "$overall" == true ]]
}

main "$@"
