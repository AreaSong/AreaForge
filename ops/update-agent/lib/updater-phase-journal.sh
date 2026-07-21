#!/usr/bin/env bash
# OPS-008 root-only updater phase journal 库。
# 事件为不可覆盖的独立文件（no-clobber hard-link 发布 + 逐级 fsync），
# 连续 sequence + previousEventHash/eventHash 链；聚合 projection 只是可重建视图。
# 本库不执行 updater、Docker、systemd、备份或迁移；只在调用方已确认的副作用边界写 journal。

JOURNAL_ROOT=""
JOURNAL_OPERATION_ID=""
JOURNAL_OPERATION_DIR=""
JOURNAL_RELEASE_JSON="null"
JOURNAL_SOURCE_KIND="operator"
JOURNAL_SOURCE="updater.local"
JOURNAL_REQUEST_ID="null"
JOURNAL_REQUEST_HASH="null"
JOURNAL_EXECUTION_ATTEMPTED="false"

journal_log() {
  printf '[updater-phase-journal] %s\n' "$*" >&2
}

journal_fsync() {
  sync -f "$1"
}

journal_init() {
  local state_dir="$1"
  [[ -n "$state_dir" ]] || return 1
  JOURNAL_ROOT="$state_dir/updater-journal"
}

journal_sha256_text() {
  printf '%s' "$1" | sha256sum | awk '{print "sha256:" $1}'
}

journal_canonical_hash() {
  local canonical
  canonical="$(jq -cS . <<< "$1")" || return 1
  journal_sha256_text "$canonical"
}

journal_event_hash() {
  local body
  body="$(jq -cS '.eventHash = ""' <<< "$1")" || return 1
  journal_sha256_text "$body"
}

journal_generate_operation_id() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr '[:upper:]' '[:lower:]' < /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    return 1
  fi
}

journal_valid_operation_id() {
  [[ "$1" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]]
}

journal_now_iso_ms() {
  jq -nr '(now * 1000 | floor) as $ms
    | (($ms / 1000 | floor) | strftime("%Y-%m-%dT%H:%M:%S"))
      + "." + (($ms % 1000 | tostring) | ("000" + .)[-3:]) + "Z"'
}

journal_iso_ms_to_epoch_ms() {
  jq -nr --arg value "$1" '
    ($value | capture("^(?<base>.*)\\.(?<ms>[0-9]{3})Z$")) as $parts
    | ((($parts.base + "Z") | fromdateiso8601) * 1000) + ($parts.ms | tonumber)'
}

journal_epoch_ms_to_iso() {
  jq -nr --argjson ms "$1" '
    (($ms / 1000 | floor) | strftime("%Y-%m-%dT%H:%M:%S"))
      + "." + (($ms % 1000 | tostring) | ("000" + .)[-3:]) + "Z"'
}

# createdAt 在同一 operation 内必须严格递增；时钟回拨时基于前一事件 +1ms。
journal_next_created_at() {
  local previous="$1"
  local now_iso now_ms previous_ms
  now_iso="$(journal_now_iso_ms)" || return 1
  [[ -n "$previous" ]] || { printf '%s' "$now_iso"; return 0; }
  now_ms="$(journal_iso_ms_to_epoch_ms "$now_iso")" || return 1
  previous_ms="$(journal_iso_ms_to_epoch_ms "$previous")" || return 1
  if (( now_ms > previous_ms )); then
    printf '%s' "$now_iso"
  else
    journal_epoch_ms_to_iso "$((previous_ms + 1))"
  fi
}

journal_phase_state_allowed() {
  local phase="$1"
  local state="$2"
  case "$phase:$state" in
    admission:complete) return 0 ;;
    validation:started|validation:complete) return 0 ;;
    backup:started|backup:complete) return 0 ;;
    prepare:started|prepare:complete) return 0 ;;
    migration:started|migration:complete|migration:skipped) return 0 ;;
    switch:started|switch:complete) return 0 ;;
    health:started|health:complete) return 0 ;;
    smoke:started|smoke:complete) return 0 ;;
    rollback:started|rollback:complete|rollback:needs_reconciliation) return 0 ;;
    terminal:started|terminal:applied|terminal:rolled_back|terminal:rejected|terminal:needs_reconciliation) return 0 ;;
    reconciliation:reconciliation_required) return 0 ;;
    *) return 1 ;;
  esac
}

journal_terminal_state() {
  case "$1:$2" in
    terminal:applied|terminal:rolled_back|terminal:rejected) return 0 ;;
    *) return 1 ;;
  esac
}

journal_last_event_file() {
  find "$1" -maxdepth 1 -name '[0-9][0-9][0-9][0-9].json' -type f 2>/dev/null | sort | tail -n 1 || true
}

journal_event_count() {
  find "$1" -maxdepth 1 -name '[0-9][0-9][0-9][0-9].json' -type f 2>/dev/null | wc -l | awk '{print $1}'
}

# 创建 operation 目录（no-clobber）并逐级 fsync；任一级不确定都不允许开始副作用。
journal_create_operation() {
  local operation_id="$1"
  local parent
  [[ -n "$JOURNAL_ROOT" ]] || { journal_log "journal root is not initialized"; return 1; }
  journal_valid_operation_id "$operation_id" || { journal_log "invalid operation id"; return 1; }
  parent="$(dirname "$JOURNAL_ROOT")"
  mkdir -p "$JOURNAL_ROOT" || return 1
  chmod 700 "$JOURNAL_ROOT" || return 1
  local operation_dir="$JOURNAL_ROOT/$operation_id"
  mkdir "$operation_dir" || { journal_log "operation directory conflict: no-clobber create failed"; return 1; }
  chmod 700 "$operation_dir" || return 1
  mkdir "$operation_dir/events" || return 1
  chmod 700 "$operation_dir/events" || return 1
  journal_fsync "$operation_dir/events" || return 1
  journal_fsync "$operation_dir" || return 1
  journal_fsync "$JOURNAL_ROOT" || return 1
  journal_fsync "$parent" || return 1
  JOURNAL_OPERATION_ID="$operation_id"
  JOURNAL_OPERATION_DIR="$operation_dir"
  journal_append_event admission complete OPERATION_CREATED || return 1
}

journal_bind_existing_operation() {
  local operation_id="$1"
  journal_valid_operation_id "$operation_id" || return 1
  [[ -d "$JOURNAL_ROOT/$operation_id/events" ]] || return 1
  JOURNAL_OPERATION_ID="$operation_id"
  JOURNAL_OPERATION_DIR="$JOURNAL_ROOT/$operation_id"
}

# journal_append_event <phase> <state> <reasonCode> [extraJson]
# extraJson 允许键：uncertainPhase、beforeStateHash、backupSetId、backupInventoryHash、
# updateRecordHash、productionIdentityHash；默认全为 null。
journal_append_event() {
  local phase="$1"
  local state="$2"
  local reason_code="$3"
  local extra_json="${4:-}"
  [[ -n "$extra_json" ]] || extra_json='{}'
  local events_dir last_file sequence previous_hash previous_created created_at event_json event_hash tmp target
  [[ -n "$JOURNAL_OPERATION_DIR" ]] || { journal_log "no bound operation"; return 1; }
  journal_phase_state_allowed "$phase" "$state" || { journal_log "phase/state not allowed: $phase/$state"; return 1; }
  [[ "$reason_code" =~ ^[A-Z0-9_]{2,80}$ ]] || { journal_log "invalid reason code"; return 1; }
  events_dir="$JOURNAL_OPERATION_DIR/events"
  [[ -d "$events_dir" && ! -L "$events_dir" ]] || { journal_log "events directory is missing or unsafe"; return 1; }
  last_file="$(journal_last_event_file "$events_dir")"
  if [[ -n "$last_file" ]]; then
    sequence="$((10#$(basename "$last_file" .json) + 1))"
    previous_hash="$(jq -r '.eventHash' "$last_file")" || return 1
    previous_created="$(jq -r '.createdAt' "$last_file")" || return 1
    [[ "$previous_hash" =~ ^sha256:[a-f0-9]{64}$ ]] || { journal_log "previous event hash is corrupt"; return 1; }
  else
    sequence=1
    previous_hash=""
    previous_created=""
  fi
  created_at="$(journal_next_created_at "$previous_created")" || return 1
  event_json="$(jq -cn \
    --arg operationId "$JOURNAL_OPERATION_ID" \
    --argjson sequence "$sequence" \
    --arg phase "$phase" \
    --arg state "$state" \
    --arg reasonCode "$reason_code" \
    --arg sourceKind "$JOURNAL_SOURCE_KIND" \
    --arg source "$JOURNAL_SOURCE" \
    --argjson requestId "$JOURNAL_REQUEST_ID" \
    --argjson requestHash "$JOURNAL_REQUEST_HASH" \
    --argjson release "$JOURNAL_RELEASE_JSON" \
    --argjson executionAttempted "$JOURNAL_EXECUTION_ATTEMPTED" \
    --arg createdAt "$created_at" \
    --arg previousEventHash "$previous_hash" \
    --argjson extra "$extra_json" \
    '{
      schemaVersion: 1,
      operationId: $operationId,
      sequence: $sequence,
      phase: $phase,
      state: $state,
      reasonCode: $reasonCode,
      uncertainPhase: ($extra.uncertainPhase // null),
      sourceKind: $sourceKind,
      source: $source,
      requestId: $requestId,
      requestHash: $requestHash,
      release: $release,
      executionAttempted: $executionAttempted,
      beforeStateHash: ($extra.beforeStateHash // null),
      backupSetId: ($extra.backupSetId // null),
      backupInventoryHash: ($extra.backupInventoryHash // null),
      updateRecordHash: ($extra.updateRecordHash // null),
      productionIdentityHash: ($extra.productionIdentityHash // null),
      createdAt: $createdAt,
      previousEventHash: (if $previousEventHash == "" then null else $previousEventHash end),
      eventHash: ""
    }')" || return 1
  event_hash="$(journal_event_hash "$event_json")" || return 1
  event_json="$(jq -c --arg eventHash "$event_hash" '.eventHash = $eventHash' <<< "$event_json")" || return 1
  target="$(printf '%s/%04d.json' "$events_dir" "$sequence")"
  [[ ! -e "$target" ]] || { journal_log "event sequence conflict: $sequence already published"; return 1; }
  tmp="$(mktemp "$events_dir/.event.XXXXXX")" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  printf '%s\n' "$event_json" > "$tmp" || { rm -f "$tmp"; return 1; }
  journal_fsync "$tmp" || { rm -f "$tmp"; return 1; }
  if ! ln "$tmp" "$target" 2>/dev/null; then
    rm -f "$tmp"
    journal_log "event no-clobber publish failed for sequence $sequence"
    return 1
  fi
  rm -f "$tmp" || journal_log "temporary event cleanup failed (published event is unaffected)"
  journal_fsync "$events_dir" || return 1
  journal_update_projection || return 1
}

# redacted projection：temp + fsync + rename + directory fsync；不是源事实。
journal_update_projection() {
  local events_dir last_file tmp projection
  events_dir="$JOURNAL_OPERATION_DIR/events"
  last_file="$(journal_last_event_file "$events_dir")"
  [[ -n "$last_file" ]] || return 0
  projection="$(jq -c '{
    schemaVersion: 1,
    operationId: .operationId,
    lastSequence: .sequence,
    lastPhase: .phase,
    lastState: .state,
    lastReasonCode: .reasonCode,
    updatedAt: .createdAt
  }' "$last_file")" || return 1
  tmp="$(mktemp "$JOURNAL_OPERATION_DIR/.projection.XXXXXX")" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  printf '%s\n' "$projection" > "$tmp" || { rm -f "$tmp"; return 1; }
  journal_fsync "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$JOURNAL_OPERATION_DIR/projection.json" || { rm -f "$tmp"; return 1; }
  journal_fsync "$JOURNAL_OPERATION_DIR" || return 1
}

# 扫描单个 operation：输出 terminal|non_terminal|corrupt。
journal_scan_operation() {
  local operation_dir="$1"
  local events_dir sequence expected file event_json event_hash recorded_hash previous_hash previous_created
  local phase state created_at operation_id verified_release=""
  operation_id="$(basename "$operation_dir")"
  if ! journal_valid_operation_id "$operation_id"; then
    printf 'corrupt'
    return 0
  fi
  events_dir="$operation_dir/events"
  if [[ -L "$operation_dir" || -L "$events_dir" || ! -d "$events_dir" ]]; then
    printf 'corrupt'
    return 0
  fi
  expected=1
  previous_hash=""
  previous_created=""
  phase=""
  state=""
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    if [[ -L "$file" ]]; then
      printf 'corrupt'
      return 0
    fi
    sequence="$((10#$(basename "$file" .json)))"
    if [[ "$sequence" != "$expected" ]]; then
      printf 'corrupt'
      return 0
    fi
    if ! event_json="$(jq -c . "$file" 2>/dev/null)"; then
      printf 'corrupt'
      return 0
    fi
    recorded_hash="$(jq -r '.eventHash // ""' <<< "$event_json")"
    event_hash="$(journal_event_hash "$event_json")" || { printf 'corrupt'; return 0; }
    if [[ -z "$recorded_hash" || "$recorded_hash" != "$event_hash" ]]; then
      printf 'corrupt'
      return 0
    fi
    if [[ "$(jq -r '.operationId' <<< "$event_json")" != "$operation_id" ]]; then
      printf 'corrupt'
      return 0
    fi
    if [[ "$(jq -r '.previousEventHash // ""' <<< "$event_json")" != "$previous_hash" ]]; then
      printf 'corrupt'
      return 0
    fi
    phase="$(jq -r '.phase' <<< "$event_json")"
    state="$(jq -r '.state' <<< "$event_json")"
    if ! journal_phase_state_allowed "$phase" "$state"; then
      printf 'corrupt'
      return 0
    fi
    created_at="$(jq -r '.createdAt' <<< "$event_json")"
    if [[ -n "$previous_created" ]]; then
      local current_ms previous_ms
      current_ms="$(journal_iso_ms_to_epoch_ms "$created_at" 2>/dev/null)" || { printf 'corrupt'; return 0; }
      previous_ms="$(journal_iso_ms_to_epoch_ms "$previous_created" 2>/dev/null)" || { printf 'corrupt'; return 0; }
      if (( current_ms <= previous_ms )); then
        printf 'corrupt'
        return 0
      fi
    fi
    # identity-bound complete 后 release 身份必须逐字段一致。
    if [[ "$phase" == "validation" && "$state" == "complete" ]]; then
      verified_release="$(jq -cS '.release' <<< "$event_json")"
    elif [[ -n "$verified_release" ]]; then
      if [[ "$(jq -cS '.release' <<< "$event_json")" != "$verified_release" ]]; then
        printf 'corrupt'
        return 0
      fi
    fi
    previous_hash="$recorded_hash"
    previous_created="$created_at"
    expected="$((expected + 1))"
  done < <(find "$events_dir" -maxdepth 1 -name '[0-9][0-9][0-9][0-9].json' -type f 2>/dev/null | sort)
  if [[ "$expected" == "1" ]]; then
    printf 'corrupt'
    return 0
  fi
  if journal_terminal_state "$phase" "$state"; then
    printf 'terminal'
  else
    printf 'non_terminal'
  fi
}

# 扫描全部 operation：clean 或 blocked（fail closed：任何扫描错误都是 blocked）。
journal_scan_all() {
  local operation_dir result
  [[ -n "$JOURNAL_ROOT" ]] || { printf 'blocked'; return 0; }
  [[ -d "$JOURNAL_ROOT" ]] || { printf 'clean'; return 0; }
  if [[ -L "$JOURNAL_ROOT" ]]; then
    printf 'blocked'
    return 0
  fi
  while IFS= read -r operation_dir; do
    [[ -n "$operation_dir" ]] || continue
    result="$(journal_scan_operation "$operation_dir")" || { printf 'blocked'; return 0; }
    if [[ "$result" != "terminal" ]]; then
      printf 'blocked'
      return 0
    fi
  done < <(find "$JOURNAL_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  printf 'clean'
}
