#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

CONFIG_FILE="${AREAFORGE_UPDATE_AGENT_CONFIG:-/etc/areaforge/updater.env}"
STATE_DIR="${AREAFORGE_OPS_STATE_DIR:-/opt/areaforge/ops-state}"
OUTPUT_DIR="${AREAFORGE_OPS001_FALLBACK_DIR:-}"

usage() {
  cat <<'USAGE'
Usage: areaforge-ops001-readonly-fallback.sh [--config PATH] [--state-dir PATH] [--output-dir PATH]

Exports redacted AF-RISK-OPS-001 fallback evidence on hosts without Node.js/pnpm:
  - redacted update-agent status JSON
  - redacted smoke prerequisite summary
  - production read-only curl smoke output when prerequisites are complete
  - fallback summary with hashes

This helper does not run updater check/apply, migrations, backups, restores,
rollback, Docker, Nginx, compose, database writes, upload writes, or residual
ledger changes. It only writes redacted evidence files under the selected output
directory.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_FILE="${2:?missing --config value}"
      shift 2
      ;;
    --state-dir)
      STATE_DIR="${2:?missing --state-dir value}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?missing --output-dir value}"
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

log() {
  printf '[areaforge-ops001-fallback] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

json_value() {
  local file="$1"
  local query="$2"
  jq -er "$query // empty" "$file" 2>/dev/null || true
}

normalize_base_url() {
  local value="$1"
  value="${value%/}"
  printf '%s\n' "$value"
}

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
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

handoff_redacted_outputs() {
  REDACTED_HANDOFF_OWNER="none"
  REDACTED_HANDOFF_STATUS="skipped-no-sudo-user"

  local owner="${SUDO_USER:-}"
  if [[ -z "$owner" || "$owner" == "root" ]]; then
    return
  fi

  if [[ "$OUTPUT_DIR" != /tmp/areaforge-ops001-fallback-* ]]; then
    REDACTED_HANDOFF_OWNER="$owner"
    REDACTED_HANDOFF_STATUS="skipped-unsafe-output-dir"
    return
  fi

  local group
  group="$(id -gn "$owner" 2>/dev/null || true)"
  if [[ -z "$group" ]]; then
    REDACTED_HANDOFF_OWNER="$owner"
    REDACTED_HANDOFF_STATUS="skipped-unknown-user"
    return
  fi

  if chown -R "$owner:$group" "$OUTPUT_DIR" 2>/dev/null; then
    REDACTED_HANDOFF_OWNER="$owner"
    REDACTED_HANDOFF_STATUS="granted"
  else
    REDACTED_HANDOFF_OWNER="$owner"
    REDACTED_HANDOFF_STATUS="failed"
  fi
}

append_handoff_summary() {
  {
    printf 'redactedHandoffOwner: %s\n' "$REDACTED_HANDOFF_OWNER"
    printf 'redactedHandoffStatus: %s\n' "$REDACTED_HANDOFF_STATUS"
    printf 'redactedHandoffScope: /tmp/areaforge-ops001-fallback-* only\n'
  } >> "$SUMMARY"
  chmod 600 "$SUMMARY"
}

source_config() {
  [[ -f "$CONFIG_FILE" ]] || die "config file not found: $CONFIG_FILE"
  set -a
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
}

write_redacted_update_status() {
  local status_file="$1"
  local output_file="$2"
  jq '(.status? // .) as $s | {
    currentVersion: ($s.currentVersion // "unknown"),
    currentImage: ($s.currentImage // null),
    releaseUrl: ($s.releaseUrl // null),
    latestVersion: ($s.latestVersion // null),
    updateAvailable: ($s.updateAvailable // false),
    autoApply: ($s.autoApply // "none"),
    signatureRequired: ($s.signatureRequired // false),
    timerEnabled: ($s.timerEnabled // null),
    timerActive: ($s.timerActive // null),
    lastCheckedAt: ($s.lastCheckedAt // null),
    blocker: ($s.blocker // null),
    rollback: {
      available: ($s.rollback.available // false),
      targetVersion: ($s.rollback.targetVersion // null),
      targetImage: ($s.rollback.targetImage // null)
    },
    statusUpdatedAt: ($s.statusUpdatedAt // (now | todateiso8601)),
    safetyFacts: {
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      updaterApplyAttempted: false
    }
  }' "$status_file" > "$output_file"
  chmod 600 "$output_file"
}

collect_context() {
  local status_file="$1"
  local app_url current_version
  app_url="$(json_value "$status_file" '(.status? // .).appUrl')"
  current_version="$(json_value "$status_file" '(.status? // .).currentVersion')"

  BASE_URL="${AREAFORGE_SMOKE_BASE_URL:-}"
  if [[ -z "$BASE_URL" && -n "$app_url" ]]; then
    BASE_URL="$app_url"
  fi
  if [[ -z "$BASE_URL" && -n "${AREAFORGE_HEALTH_URL:-}" ]]; then
    BASE_URL="${AREAFORGE_HEALTH_URL%/api/health}"
  fi
  BASE_URL="$(normalize_base_url "$BASE_URL")"

  EXPECTED_VERSION="${AREAFORGE_SMOKE_EXPECTED_VERSION:-$current_version}"
  EXPECTED_AUTO_APPLY="${AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY:-${AREAFORGE_AUTO_APPLY:-none}}"
}

append_blocker() {
  local issue="$1"
  BLOCKERS+=("$issue")
}

collect_prerequisites() {
  BLOCKERS=()

  EXTRA_SMOKE_COMMAND_CONFIGURED="no"
  if [[ -n "${AREAFORGE_EXTRA_SMOKE_COMMAND:-}" ]]; then
    EXTRA_SMOKE_COMMAND_CONFIGURED="yes"
    if [[ "${AREAFORGE_EXTRA_SMOKE_COMMAND}" != *"pnpm smoke:prod-readonly"* ]]; then
      append_blocker "extra smoke command does not reference pnpm smoke:prod-readonly"
    fi
  else
    append_blocker "extra smoke command missing"
  fi

  SMOKE_EMAIL_CONFIGURED="no"
  if [[ -n "${AREAFORGE_SMOKE_EMAIL:-}" ]]; then
    SMOKE_EMAIL_CONFIGURED="yes"
  else
    append_blocker "smoke email missing"
  fi

  SMOKE_PASSWORD_FILE_CONFIGURED="no"
  SMOKE_PASSWORD_FILE_READABLE="no"
  SMOKE_PASSWORD_FILE_MODE="unknown"
  if [[ -n "${AREAFORGE_SMOKE_PASSWORD_FILE:-}" ]]; then
    SMOKE_PASSWORD_FILE_CONFIGURED="yes"
    if [[ -f "${AREAFORGE_SMOKE_PASSWORD_FILE}" ]]; then
      SMOKE_PASSWORD_FILE_READABLE="yes"
      SMOKE_PASSWORD_FILE_MODE="$(stat -c '%a' "${AREAFORGE_SMOKE_PASSWORD_FILE}" 2>/dev/null || printf 'unknown')"
      if [[ "$SMOKE_PASSWORD_FILE_MODE" =~ ^[0-7]+$ ]] && (( 8#$SMOKE_PASSWORD_FILE_MODE & 8#077 )); then
        append_blocker "smoke password file is group/world readable"
      fi
    else
      append_blocker "smoke password file missing"
    fi
  else
    append_blocker "smoke password file env missing"
  fi

  if [[ -n "${AREAFORGE_SMOKE_PASSWORD:-}" ]]; then
    append_blocker "smoke password env fallback is set"
  fi

  if [[ -z "$BASE_URL" ]]; then
    append_blocker "smoke base URL missing"
  elif [[ "$BASE_URL" != https://* ]]; then
    append_blocker "smoke base URL is not https"
  fi

  if [[ -z "$EXPECTED_VERSION" ]]; then
    append_blocker "expected version missing"
  fi

  HOST_PNPM_AVAILABLE="no"
  if command -v pnpm >/dev/null 2>&1; then
    HOST_PNPM_AVAILABLE="yes"
  fi
}

blockers_json() {
  if [[ ${#BLOCKERS[@]} -eq 0 ]]; then
    printf '[]\n'
    return
  fi
  printf '%s\n' "${BLOCKERS[@]}" | jq -R 'select(length > 0)' | jq -s '.'
}

write_prerequisites() {
  local output_file="$1"
  jq -n \
    --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg baseUrl "$BASE_URL" \
    --arg expectedVersion "$EXPECTED_VERSION" \
    --arg expectedAutoApply "$EXPECTED_AUTO_APPLY" \
    --arg extraSmokeCommandConfigured "$EXTRA_SMOKE_COMMAND_CONFIGURED" \
    --arg smokeEmailConfigured "$SMOKE_EMAIL_CONFIGURED" \
    --arg smokePasswordFileConfigured "$SMOKE_PASSWORD_FILE_CONFIGURED" \
    --arg smokePasswordFileReadable "$SMOKE_PASSWORD_FILE_READABLE" \
    --arg smokePasswordFileMode "$SMOKE_PASSWORD_FILE_MODE" \
    --arg hostPnpmAvailable "$HOST_PNPM_AVAILABLE" \
    --argjson blockers "$(blockers_json)" \
    '{
      generatedAt: $generatedAt,
      mode: "ops001-readonly-fallback-prerequisites",
      baseUrl: $baseUrl,
      expectedVersion: $expectedVersion,
      expectedAutoApply: $expectedAutoApply,
      extraSmokeCommandConfigured: $extraSmokeCommandConfigured,
      smokeEmailConfigured: $smokeEmailConfigured,
      smokePasswordFileConfigured: $smokePasswordFileConfigured,
      smokePasswordFileReadable: $smokePasswordFileReadable,
      smokePasswordFileMode: $smokePasswordFileMode,
      hostPnpmAvailable: $hostPnpmAvailable,
      blockers: $blockers,
      safetyFacts: {
        configValuesRedacted: true,
        passwordValuePrinted: false,
        cookieValuePrinted: false,
        updaterApplyAttempted: false,
        backupRestoreAttempted: false,
        migrationAttempted: false,
        productionWriteAttempted: false
      }
    }' > "$output_file"
  chmod 600 "$output_file"
}

# shellcheck disable=SC2329 # Invoked indirectly through run_check helpers.
request_json() {
  local method="$1"
  local path="$2"
  local data_file="${3:-}"
  local body_file status
  body_file="$(mktemp)"
  if [[ -n "$data_file" ]]; then
    status="$(curl -sS -m 10 -w '%{http_code}' -o "$body_file" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -H 'Accept: application/json' -H 'Content-Type: application/json' \
      -X "$method" --data-binary "@$data_file" "$BASE_URL$path" || true)"
  else
    status="$(curl -sS -m 10 -w '%{http_code}' -o "$body_file" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
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
    printf 'PASS %s: ok (%sms)\n' "$name" "$duration_ms" >> "$SMOKE_OUTPUT"
  else
    printf 'FAIL %s: %s (%sms)\n' "$name" "$detail" "$duration_ms" >> "$SMOKE_OUTPUT"
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

# shellcheck disable=SC2329 # Invoked indirectly through run_check.
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

# shellcheck disable=SC2329 # Invoked by check_login, which is called indirectly.
write_login_payload() {
  {
    printf '%s\n' "${AREAFORGE_SMOKE_EMAIL:-}"
    printf '%s\n' "$SMOKE_PASSWORD"
  } | jq -Rn 'input as $email | input as $password | {email:$email,password:$password}' > "$LOGIN_PAYLOAD"
}

# shellcheck disable=SC2329 # Invoked indirectly through run_check.
check_login() {
  local body
  write_login_payload
  body="$(request_json POST /api/auth/login "$LOGIN_PAYLOAD")" || return 1
  jq -e '.user.email | type == "string"' >/dev/null <<<"$body" || {
    printf 'login validation failed'
    return 1
  }
}

# shellcheck disable=SC2329 # Invoked indirectly through run_check.
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

# shellcheck disable=SC2329 # Invoked indirectly through run_check.
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

run_curl_smoke() {
  SMOKE_PASSWORD="$(tr -d '\r\n' < "${AREAFORGE_SMOKE_PASSWORD_FILE:?missing smoke password file}")"
  COOKIE_JAR="$(mktemp)"
  LOGIN_PAYLOAD="$(mktemp)"
  CHECKS_JSONL="$(mktemp)"
  chmod 600 "$COOKIE_JAR" "$LOGIN_PAYLOAD" "$CHECKS_JSONL"
  : > "$SMOKE_OUTPUT"
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
    '{ok:$ok, baseUrl:$baseUrl, checkedAt:$checkedAt, checks:$checks}' >> "$SMOKE_OUTPUT"
  chmod 600 "$SMOKE_OUTPUT"

  [[ "$overall" == true ]]
}

write_summary() {
  local mode="$1"
  local smoke_status="$2"
  {
    printf 'generatedAt: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'mode: %s\n' "$mode"
    printf 'outputDir: %s\n' "$OUTPUT_DIR"
    printf 'redactedUpdateStatusRecord: %s sha256:%s\n' "$REDACTED_STATUS" "$(sha256_of "$REDACTED_STATUS")"
    printf 'remotePrerequisites: %s sha256:%s\n' "$PREREQUISITES" "$(sha256_of "$PREREQUISITES")"
    if [[ -f "$SMOKE_OUTPUT" ]]; then
      printf 'prodReadonlySmokeOutput: %s sha256:%s\n' "$SMOKE_OUTPUT" "$(sha256_of "$SMOKE_OUTPUT")"
    else
      printf 'prodReadonlySmokeOutput: missing\n'
    fi
    printf 'smokeStatus: %s\n' "$smoke_status"
    if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
      printf 'blockers: %s\n' "$(jq -r '.blockers | join(", ")' "$PREREQUISITES")"
    fi
    printf 'doesNotProve: OPS-001 closure, operational evidence bundle readiness, production write smoke safety, residual closure, long-term operability\n'
    printf 'forbiddenActions: updater apply, migration, backup, restore, rollback, Docker, Nginx, compose, database writes, upload writes, secret export, residual ledger closure\n'
    printf 'safetyFacts:\n'
    printf '  updaterApplyAttempted: no\n'
    printf '  backupRestoreAttempted: no\n'
    printf '  migrationAttempted: no\n'
    printf '  rollbackAttempted: no\n'
    printf '  dockerComposeChanged: no\n'
    printf '  databaseWriteAttempted: no\n'
    printf '  uploadDirectoryTouched: no\n'
    printf '  secretValuePrinted: no\n'
  } > "$SUMMARY"
  chmod 600 "$SUMMARY"
}

main() {
  require_cmd jq
  require_cmd curl
  require_cmd sha256sum

  source_config

  local status_file="$STATE_DIR/status.json"
  [[ -f "$status_file" ]] || die "status file not found: $status_file"

  if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="/tmp/areaforge-ops001-fallback-$(date -u +%Y%m%d%H%M%S)"
  fi
  mkdir -p "$OUTPUT_DIR"
  chmod 700 "$OUTPUT_DIR"

  REDACTED_STATUS="$OUTPUT_DIR/redacted-update-status.json"
  PREREQUISITES="$OUTPUT_DIR/remote-prerequisites.json"
  SMOKE_OUTPUT="$OUTPUT_DIR/prod-readonly-smoke-output.log"
  SUMMARY="$OUTPUT_DIR/remote-summary.txt"

  collect_context "$status_file"
  collect_prerequisites
  write_redacted_update_status "$status_file" "$REDACTED_STATUS"
  write_prerequisites "$PREREQUISITES"

  if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
    write_summary "ops001-readonly-fallback-blocked" "not-run"
    handoff_redacted_outputs
    append_handoff_summary
    log "blocked; redacted status and prerequisites written to $OUTPUT_DIR"
    cat "$SUMMARY"
    exit 10
  fi

  if run_curl_smoke; then
    write_summary "ops001-readonly-fallback-export" "pass"
    handoff_redacted_outputs
    append_handoff_summary
    log "complete; fallback files written to $OUTPUT_DIR"
    cat "$SUMMARY"
    exit 0
  fi

  write_summary "ops001-readonly-fallback-export" "fail"
  handoff_redacted_outputs
  append_handoff_summary
  log "curl smoke failed; fallback files written to $OUTPUT_DIR"
  cat "$SUMMARY"
  exit 20
}

main "$@"
