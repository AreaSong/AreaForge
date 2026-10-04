#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

UPDATE_RECORD=""
STATUS_FILE="${AREAFORGE_OPS_STATE_DIR:-/opt/areaforge/ops-state}/status.json"
SMOKE_LOG=""
OUTPUT_DIR="${AREAFORGE_RELEASE_EVIDENCE_REDACTED_DIR:-}"
REDACTED_HANDOFF_OWNER="none"
REDACTED_HANDOFF_STATUS="skipped-no-sudo-user"

usage() {
  cat <<'USAGE'
Usage: areaforge-release-evidence-redacted-export.sh --update-record PATH [--status PATH] [--smoke-log PATH] [--output-dir PATH]

Exports redacted release/update evidence from root-only server files:
  - allowlisted update-record fields needed by release evidence
  - redacted update-agent status JSON
  - existing production read-only smoke output reduced to PASS/FAIL lines and final JSON
  - summary hashes for local validation and release record completion

This helper does not source updater.env, does not read smoke password files,
does not run updater check/apply, migrations, backups, restores, rollback,
Docker, Nginx, compose, database writes, upload writes, or residual ledger
changes. It only writes redacted evidence files under the selected output dir.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-record)
      UPDATE_RECORD="${2:?missing --update-record value}"
      shift 2
      ;;
    --status)
      STATUS_FILE="${2:?missing --status value}"
      shift 2
      ;;
    --smoke-log)
      SMOKE_LOG="${2:?missing --smoke-log value}"
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
  printf '[areaforge-release-evidence-redacted-export] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

redact_stream() {
  sed -E \
    -e 's#[Pp][Oo][Ss][Tt][Gg][Rr][Ee][Ss]([Qq][Ll])?://[^[:space:]]+#<redacted-database-url>#g' \
    -e 's#Bearer[[:space:]]+[A-Za-z0-9._-]+#Bearer <redacted>#g' \
    -e 's#([A-Za-z0-9_]*(TOKEN|PASSWORD|SECRET|PRIVATE_KEY|API_KEY)[A-Za-z0-9_]*)=([^[:space:]]+)#\1=<redacted>#g' \
    -e 's#(sk-|rk-|sess-)[A-Za-z0-9_-]{16,}#<redacted-token>#g'
}

is_forbidden_smoke_log_path() {
  local value="$1"
  local lowered
  lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    *password*|*passwd*|*secret*|*token*|*credential*|*private-key*|*auth-session*|*api-key*|*cosign*|*.env|*updater.env*|*production.env*|*.dump|*.sql|*.tar|*.tar.gz|*.tgz|*.zip|*.key|*.pem|*.p12|*.pfx|*/db/*|*/uploads/*|*/config/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_smoke_log_path() {
  [[ -z "$SMOKE_LOG" ]] && return
  if is_forbidden_smoke_log_path "$SMOKE_LOG"; then
    die "refusing forbidden smoke log path: <redacted-smoke-log-path>"
  fi
}

validate_output_dir() {
  local parent
  local base

  [[ "$OUTPUT_DIR" = /* ]] || die "output dir must be an absolute path under /tmp/areaforge-release-evidence-redacted-*"
  parent="${OUTPUT_DIR%/*}"
  base="${OUTPUT_DIR##*/}"
  [[ "$parent" == "/tmp" ]] || die "refusing output dir outside /tmp: <redacted-output-dir>"
  case "$base" in
    areaforge-release-evidence-redacted-*)
      ;;
    *)
      die "refusing output dir without areaforge-release-evidence-redacted-* prefix: <redacted-output-dir>"
      ;;
  esac
  case "$base" in
    *..*|*[!A-Za-z0-9._-]*)
      die "refusing unsafe output dir name: <redacted-output-dir>"
      ;;
  esac
}

read_update_record_field() {
  local key="$1"
  awk -F': ' -v key="$key" '$1 == key { print substr($0, length(key) + 3); exit }' "$UPDATE_RECORD"
}

resolve_smoke_log() {
  if [[ -n "$SMOKE_LOG" ]]; then
    return
  fi

  local from_record
  from_record="$(read_update_record_field "extraSmokeLogPath" || true)"
  if [[ -n "$from_record" && "$from_record" != "not-configured" ]]; then
    SMOKE_LOG="$from_record"
  fi
}

write_redacted_update_fields() {
  local output_file="$1"
  awk '
    BEGIN {
      allowed["releaseId"] = 1
      allowed["updatedAt"] = 1
      allowed["status"] = 1
      allowed["githubRepo"] = 1
      allowed["releaseTag"] = 1
      allowed["targetVersion"] = 1
      allowed["targetChannel"] = 1
      allowed["gitCommit"] = 1
      allowed["previousAppVersion"] = 1
      allowed["previousImage"] = 1
      allowed["targetWebImage"] = 1
      allowed["targetWebImageDigest"] = 1
      allowed["migrationApplied"] = 1
      allowed["migrationImageDigest"] = 1
      allowed["sbomAsset"] = 1
      allowed["sbomSha256"] = 1
      allowed["provenanceAsset"] = 1
      allowed["provenanceSha256"] = 1
      allowed["composeUpdated"] = 1
      allowed["databaseBackupPath"] = 1
      allowed["databaseBackupSha256"] = 1
      allowed["uploadsBackupPath"] = 1
      allowed["uploadsBackupSha256"] = 1
      allowed["envBackupPath"] = 1
      allowed["envBackupSha256"] = 1
      allowed["composeConfigBackupPath"] = 1
      allowed["composeHash"] = 1
      allowed["nginxConfigBackupPath"] = 1
      allowed["healthUrl"] = 1
      allowed["smokeHealth"] = 1
      allowed["extraSmoke"] = 1
      allowed["extraSmokeLogPath"] = 1
      allowed["rollbackAttempted"] = 1
      allowed["databaseRestoreAttempted"] = 1
      allowed["uploadsRestoreAttempted"] = 1
      allowed["failureReason"] = 1
      allowed["releaseNotesUrl"] = 1

      pathField["databaseBackupPath"] = 1
      pathField["uploadsBackupPath"] = 1
      pathField["envBackupPath"] = 1
      pathField["composeConfigBackupPath"] = 1
      pathField["nginxConfigBackupPath"] = 1
      pathField["extraSmokeLogPath"] = 1
    }
    /^[A-Za-z0-9_.-]+:/ {
      key=$0
      sub(/:.*/, "", key)
      if (!allowed[key]) next
      if (pathField[key]) {
        print key ": <redacted-root-only-path>"
        next
      }
      print
    }
  ' "$UPDATE_RECORD" | redact_stream > "$output_file"
  chmod 600 "$output_file"
}

write_redacted_update_status() {
  local output_file="$1"
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
  }' "$STATUS_FILE" | redact_stream > "$output_file"
  chmod 600 "$output_file"
}

write_reduced_smoke_output() {
  local output_file="$1"
  if [[ -z "$SMOKE_LOG" || ! -f "$SMOKE_LOG" ]]; then
    printf 'prodReadonlySmokeOutput: missing\n' > "$output_file"
    chmod 600 "$output_file"
    return
  fi

  : > "$output_file"
  local line
  while IFS= read -r line; do
    if [[ "$line" =~ ^(PASS|FAIL)[[:space:]][A-Za-z0-9_/-]+: ]]; then
      printf '%s\n' "$line" | redact_stream >> "$output_file"
      continue
    fi
    if [[ "$line" == \{*\} ]]; then
      if ! printf '%s\n' "$line" | jq -c '{
        ok: (.ok // false),
        baseUrl: (.baseUrl // null),
        checkedAt: (.checkedAt // null),
        command: (.command // null),
        checks: [(.checks // [])[] | {
          name: (.name // null),
          ok: (.ok // false),
          durationMs: (.durationMs // null)
        }]
      }' | redact_stream >> "$output_file"; then
        printf 'prodReadonlySmokeOutput: invalid-json\n' > "$output_file"
        break
      fi
    fi
  done < "$SMOKE_LOG"
  chmod 600 "$output_file"
}

handoff_redacted_outputs() {
  local owner="${SUDO_USER:-}"
  if [[ -z "$owner" || "$owner" == "root" ]]; then
    return
  fi

  if [[ "$OUTPUT_DIR" != /tmp/areaforge-release-evidence-redacted-* ]]; then
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

append_handoff_result() {
  local summary_file="$1"
  {
    printf 'redactedHandoffOwner: %s\n' "$REDACTED_HANDOFF_OWNER"
    printf 'redactedHandoffStatus: %s\n' "$REDACTED_HANDOFF_STATUS"
    printf 'redactedHandoffScope: /tmp/areaforge-release-evidence-redacted-* only\n'
  } >> "$summary_file"
  chmod 600 "$summary_file"
}

write_summary() {
  local summary_file="$1"
  {
    printf 'generatedAt: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'mode: release-evidence-redacted-export-no-secret-read\n'
    printf 'outputDir: <redacted-tmp-output-dir>\n'
    printf 'sourceUpdateRecord: <redacted-root-only-update-record-path>\n'
    printf 'sourceStatus: <redacted-root-only-status-path>\n'
    printf 'sourceSmokeLog: %s\n' "$([[ -n "$SMOKE_LOG" ]] && printf '<redacted-smoke-log-path>' || printf 'not-provided-or-not-configured')"
    printf 'releaseUpdateSafeFields: release-update-safe-fields.txt sha256:%s\n' "$(sha256_of "$SAFE_FIELDS_FILE")"
    printf 'redactedUpdateStatusRecord: redacted-update-status.json sha256:%s\n' "$(sha256_of "$REDACTED_STATUS_FILE")"
    printf 'prodReadonlySmokeOutput: prod-readonly-smoke-output.log sha256:%s\n' "$(sha256_of "$SMOKE_OUTPUT_FILE")"
    printf 'updateRecordSha256: sha256:%s\n' "$(sha256_of "$UPDATE_RECORD")"
    printf 'doesNotProve: OPS-001 closure, authenticated smoke freshness, operational evidence bundle readiness, backup file existence beyond update-record hash metadata, restore readiness, residual closure, long-term operability\n'
    printf 'forbiddenActions: updater apply, backup, restore, migration, rollback, Docker, Nginx, compose, database writes, upload writes, smoke password file reads, secret export, residual ledger closure\n'
    printf 'safetyFacts:\n'
    printf '  updaterApplyAttempted: no\n'
    printf '  backupRestoreAttempted: no\n'
    printf '  migrationAttempted: no\n'
    printf '  rollbackAttempted: no\n'
    printf '  productionWriteAttempted: no\n'
    printf '  secretFileReadAttempted: no\n'
    printf '  secretValuePrinted: no\n'
    printf '  smokePasswordFileReadAttempted: no\n'
    printf '  residualLedgerUpdated: no\n'
  } > "$summary_file"
  chmod 600 "$summary_file"
}

main() {
  require_cmd awk
  require_cmd jq
  require_cmd sed
  require_cmd sha256sum

  [[ -n "$UPDATE_RECORD" ]] || die "--update-record is required"
  [[ -f "$UPDATE_RECORD" ]] || die "update record not found: <redacted-update-record-path>"
  [[ -f "$STATUS_FILE" ]] || die "status file not found: <redacted-status-path>"

  resolve_smoke_log
  validate_smoke_log_path

  if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="/tmp/areaforge-release-evidence-redacted-$(date -u +%Y%m%d%H%M%S)"
  fi
  validate_output_dir
  mkdir -p "$OUTPUT_DIR"
  chmod 700 "$OUTPUT_DIR"

  SAFE_FIELDS_FILE="$OUTPUT_DIR/release-update-safe-fields.txt"
  REDACTED_STATUS_FILE="$OUTPUT_DIR/redacted-update-status.json"
  SMOKE_OUTPUT_FILE="$OUTPUT_DIR/prod-readonly-smoke-output.log"
  SUMMARY_FILE="$OUTPUT_DIR/remote-summary.txt"

  write_redacted_update_fields "$SAFE_FIELDS_FILE"
  write_redacted_update_status "$REDACTED_STATUS_FILE"
  write_reduced_smoke_output "$SMOKE_OUTPUT_FILE"
  write_summary "$SUMMARY_FILE"
  handoff_redacted_outputs
  append_handoff_result "$SUMMARY_FILE"

  log "redacted release evidence written to <redacted-tmp-output-dir>"
  cat "$SUMMARY_FILE"
}

main "$@"
