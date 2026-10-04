#!/usr/bin/env bash
# OPS-008 root-only maintenance hold/drain 库。
# hold 采用 append-only event（holdId + 严格递增 generation + hash chain）+ 可重建 active projection；
# 固定锁顺序 queue-control -> production-state -> agent-local，禁止反向获取。
# queue-control 只覆盖 admission/claim/hold generation CAS，不跨下载、备份、migration、Docker 或 smoke 长时间持有。

MAINTENANCE_ROOT=""
MAINTENANCE_QUEUE_CONTROL_LOCK_FILE=""
MAINTENANCE_QUEUE_CONTROL_HELD=0

maintenance_log() {
  printf '[updater-maintenance-control] %s\n' "$*" >&2
}

maintenance_fsync() {
  sync -f "$1"
}

maintenance_init() {
  local state_dir="$1"
  [[ -n "$state_dir" ]] || return 1
  MAINTENANCE_ROOT="$state_dir/maintenance"
  MAINTENANCE_QUEUE_CONTROL_LOCK_FILE="$state_dir/.queue-control.lock"
}

maintenance_sha256_text() {
  printf '%s' "$1" | sha256sum | awk '{print "sha256:" $1}'
}

maintenance_event_hash() {
  local body
  body="$(jq -cS '.eventHash = ""' <<< "$1")" || return 1
  maintenance_sha256_text "$body"
}

maintenance_now_iso_ms() {
  jq -nr '(now * 1000 | floor) as $ms
    | (($ms / 1000 | floor) | strftime("%Y-%m-%dT%H:%M:%S"))
      + "." + (($ms % 1000 | tostring) | ("000" + .)[-3:]) + "Z"'
}

maintenance_generate_hold_id() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr '[:upper:]' '[:lower:]' < /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    return 1
  fi
}

# queue-control 锁（fd 7）：hold 写入与 claim 领取共用，消除“观察为空后又领取”竞态。
# 有界等待用 flock -n 重试实现，保持跨平台（生产 util-linux 与本地测试 fixture 语义一致）。
maintenance_acquire_queue_control() {
  local deadline
  [[ -n "$MAINTENANCE_QUEUE_CONTROL_LOCK_FILE" ]] || return 1
  mkdir -p "$(dirname "$MAINTENANCE_QUEUE_CONTROL_LOCK_FILE")" || return 1
  exec 7>"$MAINTENANCE_QUEUE_CONTROL_LOCK_FILE" || return 1
  chmod 600 "$MAINTENANCE_QUEUE_CONTROL_LOCK_FILE" 2>/dev/null || true
  deadline="$((SECONDS + ${AREAFORGE_QUEUE_CONTROL_WAIT_SECONDS:-15}))"
  until flock -n 7; do
    if (( SECONDS >= deadline )); then
      maintenance_log "queue-control lock is busy"
      return 1
    fi
    sleep 0.2
  done
  MAINTENANCE_QUEUE_CONTROL_HELD=1
}

maintenance_release_queue_control() {
  [[ "$MAINTENANCE_QUEUE_CONTROL_HELD" == "1" ]] || return 0
  flock -u 7 || true
  MAINTENANCE_QUEUE_CONTROL_HELD=0
}

maintenance_events_dir() {
  printf '%s/events' "$MAINTENANCE_ROOT"
}

maintenance_last_event_file() {
  find "$(maintenance_events_dir)" -maxdepth 1 -name '[0-9][0-9][0-9][0-9].json' -type f 2>/dev/null | sort | tail -n 1 || true
}

maintenance_last_event() {
  local file
  file="$(maintenance_last_event_file)"
  if [[ -n "$file" ]]; then
    jq -c . "$file" 2>/dev/null || printf 'corrupt'
  else
    printf 'null'
  fi
}

# 以事件流为源事实判断 active hold；projection 只是 redacted 视图。
maintenance_active_hold() {
  local last
  last="$(maintenance_last_event)"
  case "$last" in
    null) printf 'null'; return 0 ;;
    corrupt) printf 'corrupt'; return 0 ;;
  esac
  if [[ "$(jq -r '.kind' <<< "$last")" == "hold" ]]; then
    printf '%s' "$last"
  else
    printf 'null'
  fi
}

maintenance_last_clear_epoch_ms() {
  local last
  last="$(maintenance_last_event)"
  case "$last" in
    null|corrupt) return 1 ;;
  esac
  [[ "$(jq -r '.kind' <<< "$last")" == "clear" ]] || return 1
  jq -r '
    (.createdAt | capture("^(?<base>.*)\\.(?<ms>[0-9]{3})Z$")) as $parts
    | ((($parts.base + "Z") | fromdateiso8601) * 1000) + ($parts.ms | tonumber)' <<< "$last"
}

# 旧 generation 请求隔离：clear 之后，requestedAt 不晚于该 clear 的 mutation request 必须拒绝，
# 不能静默复用 hold 之前的确认。返回 0 表示请求过旧（须拒绝）。
maintenance_stale_after_clear() {
  local request="$1"
  local clear_ms requested requested_ms
  clear_ms="$(maintenance_last_clear_epoch_ms)" || return 1
  requested="$(jq -r '.requestedAt // empty' "$request" 2>/dev/null)" || return 1
  [[ -n "$requested" ]] || return 1
  requested_ms="$(jq -nr --arg value "$requested" \
    '(($value | sub("\\.[0-9]+Z$"; "Z")) | fromdateiso8601) * 1000' 2>/dev/null)" || return 1
  [[ "$requested_ms" =~ ^[0-9]+$ ]] || return 1
  (( requested_ms <= clear_ms ))
}

# 发布 hold/clear 事件：必须已持有 queue-control 锁。
maintenance_append_event() {
  local event_json="$1"
  local events_dir last_file sequence previous_hash event_hash tmp target
  [[ "$MAINTENANCE_QUEUE_CONTROL_HELD" == "1" ]] || { maintenance_log "queue-control lock is required"; return 1; }
  events_dir="$(maintenance_events_dir)"
  mkdir -p "$events_dir" || return 1
  chmod 700 "$MAINTENANCE_ROOT" "$events_dir" || return 1
  last_file="$(maintenance_last_event_file)"
  if [[ -n "$last_file" ]]; then
    sequence="$((10#$(basename "$last_file" .json) + 1))"
    previous_hash="$(jq -r '.eventHash' "$last_file")" || return 1
  else
    sequence=1
    previous_hash=""
  fi
  event_json="$(jq -c \
    --argjson sequence "$sequence" \
    --arg previousHoldEventHash "$previous_hash" \
    '.sequence = $sequence
     | .previousHoldEventHash = (if $previousHoldEventHash == "" then null else $previousHoldEventHash end)
     | .eventHash = ""' <<< "$event_json")" || return 1
  event_hash="$(maintenance_event_hash "$event_json")" || return 1
  event_json="$(jq -c --arg eventHash "$event_hash" '.eventHash = $eventHash' <<< "$event_json")" || return 1
  target="$(printf '%s/%04d.json' "$events_dir" "$sequence")"
  [[ ! -e "$target" ]] || { maintenance_log "hold event sequence conflict"; return 1; }
  tmp="$(mktemp "$events_dir/.event.XXXXXX")" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  printf '%s\n' "$event_json" > "$tmp" || { rm -f "$tmp"; return 1; }
  maintenance_fsync "$tmp" || { rm -f "$tmp"; return 1; }
  if ! ln "$tmp" "$target" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp" || maintenance_log "temporary maintenance event cleanup failed"
  maintenance_fsync "$events_dir" || return 1
  maintenance_update_projection || return 1
}

maintenance_update_projection() {
  local last tmp projection
  last="$(maintenance_last_event)"
  [[ "$last" != "null" && "$last" != "corrupt" ]] || return 1
  projection="$(jq -c '{
    schemaVersion: 1,
    active: (.kind == "hold"),
    holdId: .holdId,
    generation: .generation,
    reasonCode: .reasonCode,
    kind: .kind,
    updatedAt: .createdAt,
    lastEventHash: .eventHash
  }' <<< "$last")" || return 1
  tmp="$(mktemp "$MAINTENANCE_ROOT/.active.XXXXXX")" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  printf '%s\n' "$projection" > "$tmp" || { rm -f "$tmp"; return 1; }
  maintenance_fsync "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$MAINTENANCE_ROOT/active.json" || { rm -f "$tmp"; return 1; }
  maintenance_fsync "$MAINTENANCE_ROOT" || return 1
}

# maintenance_publish_hold <reasonCode> <source> [operationId] [lastJournalEventHash]
maintenance_publish_hold() {
  local reason_code="$1"
  local source="$2"
  local operation_id="${3:-}"
  local last_journal_event_hash="${4:-}"
  local last generation hold_id created_at event_json
  [[ "$reason_code" =~ ^[A-Z0-9_]{2,80}$ ]] || return 1
  last="$(maintenance_last_event)"
  [[ "$last" != "corrupt" ]] || { maintenance_log "maintenance event stream is corrupt"; return 1; }
  if [[ "$last" != "null" && "$(jq -r '.kind' <<< "$last")" == "hold" ]]; then
    maintenance_log "hold is already active"
    return 2
  fi
  if [[ "$last" == "null" ]]; then
    generation=1
  else
    generation="$(($(jq -r '.generation' <<< "$last") + 1))"
  fi
  hold_id="$(maintenance_generate_hold_id)" || return 1
  created_at="$(maintenance_now_iso_ms)" || return 1
  event_json="$(jq -cn \
    --arg holdId "$hold_id" \
    --argjson generation "$generation" \
    --arg reasonCode "$reason_code" \
    --arg source "$source" \
    --arg operationId "$operation_id" \
    --arg lastJournalEventHash "$last_journal_event_hash" \
    --arg createdAt "$created_at" \
    '{
      schemaVersion: 1,
      kind: "hold",
      holdId: $holdId,
      generation: $generation,
      reasonCode: $reasonCode,
      source: $source,
      operationId: (if $operationId == "" then null else $operationId end),
      lastJournalEventHash: (if $lastJournalEventHash == "" then null else $lastJournalEventHash end),
      createdAt: $createdAt
    }')" || return 1
  maintenance_append_event "$event_json" || return 1
  printf '%s\n' "holdId=$hold_id generation=$generation"
}

# maintenance_clear_hold <expectedHoldId> <expectedGeneration> <expectedLastEventHash> <source>
# CAS：holdId/generation/lastEventHash 全部匹配且无 reconciliation-required journal 才允许 clear；
# 不删除历史 hold 事件。
maintenance_clear_hold() {
  local expected_hold_id="$1"
  local expected_generation="$2"
  local expected_last_event_hash="$3"
  local source="$4"
  local last generation created_at event_json scan
  last="$(maintenance_last_event)"
  [[ "$last" != "null" && "$last" != "corrupt" ]] || { maintenance_log "no active hold event stream"; return 1; }
  if [[ "$(jq -r '.kind' <<< "$last")" != "hold" ]]; then
    maintenance_log "no active hold to clear"
    return 1
  fi
  if [[ "$(jq -r '.holdId' <<< "$last")" != "$expected_hold_id" ]] ||
     [[ "$(jq -r '.generation' <<< "$last")" != "$expected_generation" ]] ||
     [[ "$(jq -r '.eventHash' <<< "$last")" != "$expected_last_event_hash" ]]; then
    maintenance_log "hold clear CAS mismatch"
    return 3
  fi
  scan="$(journal_scan_all)"
  if [[ "$scan" != "clean" ]]; then
    maintenance_log "reconciliation-required journal blocks hold clear"
    return 4
  fi
  generation="$(($(jq -r '.generation' <<< "$last") + 1))"
  created_at="$(maintenance_now_iso_ms)" || return 1
  event_json="$(jq -cn \
    --arg holdId "$expected_hold_id" \
    --argjson generation "$generation" \
    --arg source "$source" \
    --arg createdAt "$created_at" \
    '{
      schemaVersion: 1,
      kind: "clear",
      holdId: $holdId,
      generation: $generation,
      reasonCode: "HOLD_CLEARED",
      source: $source,
      operationId: null,
      lastJournalEventHash: null,
      createdAt: $createdAt
    }')" || return 1
  maintenance_append_event "$event_json" || return 1
  printf '%s\n' "cleared holdId=$expected_hold_id generation=$generation"
}

# drain 只观察：有 active claim 返回 waiting_active_claim；production-state lock 忙返回
# waiting_production_state_lock；两者空闲才 drained。不 kill、不删除 claim；timer 状态是单独 systemd 事实。
maintenance_drain_status() {
  local processing_dir="$1"
  local production_state_lock_file="$2"
  local hold
  hold="$(maintenance_active_hold)"
  if [[ "$hold" == "null" || "$hold" == "corrupt" ]]; then
    printf 'no_hold'
    return 0
  fi
  if [[ -d "$processing_dir" ]] && find "$processing_dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | read -r _; then
    printf 'waiting_active_claim'
    return 0
  fi
  if [[ -n "$production_state_lock_file" && -e "$production_state_lock_file" ]]; then
    if ! flock -n 6 6<"$production_state_lock_file" 2>/dev/null; then
      printf 'waiting_production_state_lock'
      return 0
    fi
  fi
  printf 'drained'
}
