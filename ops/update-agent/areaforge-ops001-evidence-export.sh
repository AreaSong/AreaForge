#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

CONFIG_FILE="${AREAFORGE_UPDATE_AGENT_CONFIG:-/etc/areaforge/updater.env}"
STATE_DIR="${AREAFORGE_OPS_STATE_DIR:-/opt/areaforge/ops-state}"
OUTPUT_DIR="${AREAFORGE_OPS001_EVIDENCE_DIR:-}"

usage() {
  cat <<'USAGE'
Usage: areaforge-ops001-evidence-export.sh [--config PATH] [--state-dir PATH] [--output-dir PATH]

Exports redacted AF-RISK-OPS-001 evidence for human review:
  - redacted update-agent status record
  - production read-only smoke output and record
  - operational evidence bundle
  - OPS-001 closure packet

This helper is intentionally read-only with respect to production state. It does
not run updater check/apply, process update requests, run migrations, perform
backups/restores, rollback, or update the residual ledger.
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
  printf '[areaforge-ops001-evidence] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

source_config() {
  [[ -f "$CONFIG_FILE" ]] || die "config file not found: $CONFIG_FILE"
  set -a
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
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

derive_smoke_env() {
  local status_file="$1"
  local app_url current_version
  app_url="$(json_value "$status_file" '.appUrl')"
  current_version="$(json_value "$status_file" '.currentVersion')"

  if [[ -z "${AREAFORGE_SMOKE_BASE_URL:-}" && -n "$app_url" ]]; then
    export AREAFORGE_SMOKE_BASE_URL
    AREAFORGE_SMOKE_BASE_URL="$(normalize_base_url "$app_url")"
  fi
  if [[ -z "${AREAFORGE_SMOKE_BASE_URL:-}" && -n "${AREAFORGE_HEALTH_URL:-}" ]]; then
    export AREAFORGE_SMOKE_BASE_URL
    AREAFORGE_SMOKE_BASE_URL="$(normalize_base_url "${AREAFORGE_HEALTH_URL%/api/health}")"
  fi
  if [[ -z "${AREAFORGE_SMOKE_EXPECTED_VERSION:-}" && -n "$current_version" ]]; then
    export AREAFORGE_SMOKE_EXPECTED_VERSION="$current_version"
  fi
  if [[ -z "${AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY:-}" && -n "${AREAFORGE_AUTO_APPLY:-}" ]]; then
    export AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY="$AREAFORGE_AUTO_APPLY"
  fi
}

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

version_tag() {
  local version="$1"
  if [[ "$version" == v* ]]; then
    printf '%s\n' "$version"
  elif [[ -n "$version" ]]; then
    printf 'v%s\n' "$version"
  fi
}

run_step() {
  local label="$1"
  shift
  log "$label"
  "$@"
}

main() {
  require_cmd jq
  require_cmd pnpm
  require_cmd sha256sum

  source_config

  : "${AREAFORGE_DEPLOY_DIR:?AREAFORGE_DEPLOY_DIR is required}"

  local status_file="$STATE_DIR/status.json"
  [[ -f "$status_file" ]] || die "status file not found: $status_file; run the update agent separately only after explicit authorization"

  if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="/tmp/areaforge-ops001-$(date -u +%Y%m%d%H%M%S)"
  fi
  mkdir -p "$OUTPUT_DIR"
  chmod 700 "$OUTPUT_DIR"

  derive_smoke_env "$status_file"

  AREAFORGE_READINESS_EXPECTED_VERSION="${AREAFORGE_READINESS_EXPECTED_VERSION:-${AREAFORGE_SMOKE_EXPECTED_VERSION:-}}"
  export AREAFORGE_READINESS_EXPECTED_VERSION
  AREAFORGE_READINESS_RELEASE_TAG="${AREAFORGE_READINESS_RELEASE_TAG:-$(version_tag "$AREAFORGE_READINESS_EXPECTED_VERSION")}"
  export AREAFORGE_READINESS_RELEASE_TAG
  export AREAFORGE_READINESS_GITHUB_REPO="${AREAFORGE_READINESS_GITHUB_REPO:-${AREAFORGE_GITHUB_REPO:-AreaSong/AreaForge}}"
  export AREAFORGE_READINESS_BASE_URL="${AREAFORGE_READINESS_BASE_URL:-${AREAFORGE_SMOKE_BASE_URL:-}}"
  export AREAFORGE_READINESS_EXPECTED_AUTO_APPLY="${AREAFORGE_READINESS_EXPECTED_AUTO_APPLY:-${AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY:-none}}"

  cd "$AREAFORGE_DEPLOY_DIR"

  local update_status_record="$OUTPUT_DIR/redacted-update-status.json"
  local smoke_config_record="$OUTPUT_DIR/prod-readonly-smoke-config.txt"
  local smoke_output="$OUTPUT_DIR/prod-readonly-smoke-output.log"
  local smoke_record="$OUTPUT_DIR/prod-readonly-smoke-record.txt"
  local evidence_bundle="$OUTPUT_DIR/operational-evidence-bundle.json"
  local ops001_preflight_before="$OUTPUT_DIR/ops001-preflight-before-closure.json"
  local closure_packet="$OUTPUT_DIR/ops001-closure-packet.txt"
  local ops001_preflight_after="$OUTPUT_DIR/ops001-preflight-after-closure.json"
  local summary="$OUTPUT_DIR/summary.txt"

  run_step "generate redacted update-agent status" \
    pnpm update-agent:status:record "$status_file" > "$update_status_record"
  run_step "validate redacted update-agent status" \
    pnpm update-agent:status:validate "$update_status_record"

  run_step "check production read-only smoke config" \
    pnpm smoke:prod-readonly:config | tee "$smoke_config_record"

  run_step "run production read-only smoke" \
    pnpm smoke:prod-readonly | tee "$smoke_output"

  AREAFORGE_UPDATE_RECORD_SUMMARY="redacted update-agent status hash sha256:$(sha256_of "$update_status_record")"
  export AREAFORGE_UPDATE_RECORD_SUMMARY
  export AREAFORGE_UPDATER_ENV_SUMMARY="AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted"

  run_step "generate production read-only smoke record" \
    pnpm smoke:prod-readonly:record "$smoke_output" > "$smoke_record"
  run_step "validate production read-only smoke record" \
    pnpm smoke:prod-readonly:validate "$smoke_record"

  run_step "generate operational evidence bundle" \
    env AREAFORGE_READINESS_UPDATE_STATUS_FILE="$update_status_record" \
      AREAFORGE_READINESS_SMOKE_RESULT_FILE="$smoke_output" \
      pnpm ops:evidence:bundle > "$evidence_bundle"
  run_step "validate operational evidence bundle" \
    pnpm ops:evidence:bundle:validate "$evidence_bundle"

  run_step "preflight OPS-001 evidence before closure packet" \
    env AREAFORGE_OPS001_SMOKE_RECORD="$smoke_record" \
      AREAFORGE_OPS001_UPDATE_STATUS_RECORD="$update_status_record" \
      AREAFORGE_OPS001_EVIDENCE_BUNDLE="$evidence_bundle" \
      pnpm ops:ops-001:preflight | tee "$ops001_preflight_before"

  run_step "generate OPS-001 closure packet" \
    pnpm ops:ops-001:closure "$smoke_record" "$update_status_record" "$evidence_bundle" > "$closure_packet"
  run_step "validate OPS-001 closure packet" \
    pnpm ops:ops-001:closure:validate "$closure_packet"

  run_step "preflight OPS-001 evidence after closure packet" \
    env AREAFORGE_OPS001_SMOKE_RECORD="$smoke_record" \
      AREAFORGE_OPS001_UPDATE_STATUS_RECORD="$update_status_record" \
      AREAFORGE_OPS001_EVIDENCE_BUNDLE="$evidence_bundle" \
      AREAFORGE_OPS001_CLOSURE_PACKET="$closure_packet" \
      pnpm ops:ops-001:preflight | tee "$ops001_preflight_after"

  {
    printf 'generatedAt: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'outputDir: %s\n' "$OUTPUT_DIR"
    printf 'redactedUpdateStatusRecord: %s sha256:%s\n' "$update_status_record" "$(sha256_of "$update_status_record")"
    printf 'prodReadonlySmokeRecord: %s sha256:%s\n' "$smoke_record" "$(sha256_of "$smoke_record")"
    printf 'operationalEvidenceBundle: %s sha256:%s\n' "$evidence_bundle" "$(sha256_of "$evidence_bundle")"
    printf 'ops001ClosurePacket: %s sha256:%s\n' "$closure_packet" "$(sha256_of "$closure_packet")"
    printf 'residualLedgerUpdated: no\n'
    printf 'forbiddenActions: updater apply, migration, backup, restore, rollback, production writes\n'
  } > "$summary"

  log "complete; redacted evidence written to $OUTPUT_DIR"
  cat "$summary"
}

main "$@"
