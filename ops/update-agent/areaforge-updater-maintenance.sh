#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# OPS-008 root-only maintenance hold/drain 助手。
# 只操作本机 ops-state 的 maintenance 事件与只读观察；不执行 updater apply、systemd timer 启停、
# 备份、migration、Docker/Nginx/compose 切换或任何 Web 侧动作。Web runtime 无权调用本工具。

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${AREAFORGE_UPDATE_AGENT_CONFIG:-/etc/areaforge/updater.env}"
STATE_DIR="${AREAFORGE_OPS_STATE_DIR:-/opt/areaforge/ops-state}"
PROCESSING_DIR="$STATE_DIR/processing"

# shellcheck source=lib/updater-phase-journal.sh
source "$SCRIPT_DIR/lib/updater-phase-journal.sh"
# shellcheck source=lib/updater-maintenance-control.sh
source "$SCRIPT_DIR/lib/updater-maintenance-control.sh"

log() {
  printf '[areaforge-updater-maintenance] %s\n' "$*" >&2
}

usage() {
  cat <<'USAGE'
Usage: areaforge-updater-maintenance.sh <hold|clear|drain|status> [options]

Commands:
  hold    Publish a root-only maintenance hold (stops new updater admission/claims).
          Options: --reason CODE (required, [A-Z0-9_]), --operation-id UUID (optional)
  clear   Clear the active hold with an explicit CAS.
          Options: --hold-id UUID --generation N --last-event-hash sha256:<hex> (all required)
  drain   Observe drain state after a hold: drained | waiting_active_claim |
          waiting_production_state_lock | no_hold. Never kills or removes claims.
  status  Print the redacted maintenance projection.

Options:
  --config PATH   Private updater env file. Default: /etc/areaforge/updater.env
  -h, --help      Show this help.

This helper never starts or stops systemd timers, never applies updates, and never
deletes journal or hold history.
USAGE
}

require_root() {
  if [[ "${EUID:-$(id -u)}" != "0" && "${AREAFORGE_UPDATE_AGENT_TEST_MODE:-0}" != "1" ]]; then
    log "maintenance control must run as root"
    exit 1
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

production_state_lock_path() {
  local configured=""
  if [[ -f "$CONFIG_FILE" ]]; then
    configured="$(grep -E '^AREAFORGE_PRODUCTION_STATE_LOCK_FILE=' "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//" || true)"
  fi
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
  else
    printf '%s' "${AREAFORGE_DEPLOY_DIR:-/opt/areaforge}/.areaforge-production-state.lock"
  fi
}

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || { usage >&2; exit 2; }
shift

REASON_CODE=""
OPERATION_ID=""
HOLD_ID=""
GENERATION=""
LAST_EVENT_HASH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_FILE="${2:?missing --config value}"; shift 2 ;;
    --reason) REASON_CODE="${2:?missing --reason value}"; shift 2 ;;
    --operation-id) OPERATION_ID="${2:?missing --operation-id value}"; shift 2 ;;
    --hold-id) HOLD_ID="${2:?missing --hold-id value}"; shift 2 ;;
    --generation) GENERATION="${2:?missing --generation value}"; shift 2 ;;
    --last-event-hash) LAST_EVENT_HASH="${2:?missing --last-event-hash value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) log "unknown argument: $1"; usage >&2; exit 2 ;;
  esac
done

main() {
  require_root
  require_cmd jq
  require_cmd sha256sum
  require_cmd flock
  require_cmd sync
  require_cmd find
  journal_init "$STATE_DIR"
  maintenance_init "$STATE_DIR"

  case "$COMMAND" in
    hold)
      [[ -n "$REASON_CODE" ]] || { log "hold requires --reason"; exit 2; }
      maintenance_acquire_queue_control || exit 1
      local publish_status=0
      maintenance_publish_hold "$REASON_CODE" "maintenance.operator" "$OPERATION_ID" || publish_status=$?
      # hold 发布后在释放 queue-control 前再次扫描 processing/journal，输出观察结果。
      if [[ "$publish_status" == "0" ]]; then
        log "post-hold observation: drain=$(maintenance_drain_status "$PROCESSING_DIR" "$(production_state_lock_path)") journal=$(journal_scan_all)"
      fi
      maintenance_release_queue_control
      exit "$publish_status"
      ;;
    clear)
      [[ -n "$HOLD_ID" && -n "$GENERATION" && -n "$LAST_EVENT_HASH" ]] || {
        log "clear requires --hold-id, --generation, and --last-event-hash"
        exit 2
      }
      maintenance_acquire_queue_control || exit 1
      local clear_status=0
      maintenance_clear_hold "$HOLD_ID" "$GENERATION" "$LAST_EVENT_HASH" "maintenance.operator" || clear_status=$?
      maintenance_release_queue_control
      exit "$clear_status"
      ;;
    drain)
      maintenance_acquire_queue_control || exit 1
      local drain_result
      drain_result="$(maintenance_drain_status "$PROCESSING_DIR" "$(production_state_lock_path)")"
      maintenance_release_queue_control
      printf '%s\n' "$drain_result"
      [[ "$drain_result" == "drained" ]] || exit 3
      ;;
    status)
      if [[ -f "$MAINTENANCE_ROOT/active.json" ]]; then
        jq -c . "$MAINTENANCE_ROOT/active.json"
      else
        printf '{"schemaVersion":1,"active":false,"kind":null}\n'
      fi
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main
