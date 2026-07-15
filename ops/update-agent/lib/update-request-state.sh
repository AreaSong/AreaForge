# shellcheck shell=bash

latest_rollback_record() {
  find "$AREAFORGE_UPDATE_RECORD_DIR" -name update-record.txt -type f 2>/dev/null | sort | tail -n 1 || true
}

rollback_from_record() {
  local record="$1"
  if [[ -z "$record" || ! -f "$record" ]]; then
    jq -n '{available:false,targetVersion:null,targetImage:null,sourceRecordSha256:null}'
    return
  fi
  local previous_version previous_image source_hash
  previous_version="$(awk -F': ' '$1=="previousAppVersion"{print $2; exit}' "$record")"
  previous_image="$(awk -F': ' '$1=="previousImage"{print $2; exit}' "$record")"
  source_hash="$(sha256_file "$record")"
  if [[ -z "$previous_version" || -z "$previous_image" || "$previous_image" == "not-applicable" ]]; then
    jq -n --arg source "$source_hash" '{available:false,targetVersion:null,targetImage:null,sourceRecordSha256:$source}'
    return
  fi
  jq -n \
    --arg version "$previous_version" \
    --arg image "$previous_image" \
    --arg source "$source_hash" \
    '{available:true,targetVersion:$version,targetImage:$image,sourceRecordSha256:$source}'
}

detect_rollback() {
  rollback_from_record "$(latest_rollback_record)"
}

find_rollback_record_by_hash() {
  local expected_hash="$1"
  local record
  while IFS= read -r record; do
    [[ -n "$record" ]] || continue
    if [[ "$(sha256_file "$record")" == "$expected_hash" ]]; then
      printf '%s\n' "$record"
      return 0
    fi
  done < <(find "$AREAFORGE_UPDATE_RECORD_DIR" -name update-record.txt -type f 2>/dev/null | sort)
  return 1
}

observed_before() {
  local rollback current_image signature
  rollback="$(detect_rollback)"
  current_image="$(env_get AREAFORGE_IMAGE)"
  signature="$(config_get AREAFORGE_REQUIRE_SIGNATURE)"
  jq -n \
    --arg currentVersion "$(env_get APP_VERSION)" \
    --arg currentImage "$current_image" \
    --arg autoApply "$(config_get AREAFORGE_AUTO_APPLY)" \
    --argjson signatureRequired "$([[ "$signature" == "true" ]] && printf true || printf false)" \
    --argjson rollback "$rollback" \
    '{
      currentVersion:$currentVersion,
      currentImage:($currentImage | select(length > 0) // null),
      autoApply:$autoApply,
      signatureRequired:$signatureRequired,
      rollbackTargetVersion:$rollback.targetVersion,
      rollbackTargetImage:$rollback.targetImage,
      rollbackSourceRecordSha256:$rollback.sourceRecordSha256
    }'
}

claim_id() {
  printf '%s' "$(now_epoch):$$:${RANDOM}:${RANDOM}" | sha256sum | awk '{print substr($1,1,32)}'
}

claim_request() {
  local source="$1"
  local original_name claim_id_value claim_dir claimed_at claim_expires
  original_name="$(basename "$source")"
  claim_id_value="$(claim_id)"
  claim_dir="$PROCESSING_DIR/$claim_id_value"
  mkdir "$claim_dir"
  chmod 700 "$claim_dir"
  if ! mv "$source" "$claim_dir/$original_name"; then
    rmdir "$claim_dir" 2>/dev/null || true
    return 1
  fi
  chmod 400 "$claim_dir/$original_name"
  claimed_at="$(now_epoch)"
  claim_expires="$((claimed_at + CLAIM_TTL_SECONDS))"
  jq -n \
    --arg claimId "$claim_id_value" \
    --arg claimedAt "$(epoch_to_iso "$claimed_at")" \
    --arg claimExpiresAt "$(epoch_to_iso "$claim_expires")" \
    --arg originalFileName "$original_name" \
    '{claimId:$claimId,claimedAt:$claimedAt,claimExpiresAt:$claimExpiresAt,originalFileName:$originalFileName}' |
    write_json "$claim_dir/claim.json" 600
  printf '%s\n' "$claim_dir"
}

history_match() {
  local field="$1"
  local value="$2"
  local file
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    if jq -e --arg field "$field" --arg value "$value" '.[$field] == $value' "$file" >/dev/null 2>&1; then
      printf '%s\n' "$file"
      return 0
    fi
  done < <(find "$HISTORY_DIR" -maxdepth 1 -name '*.decision.json' -type f 2>/dev/null | sort)
  return 1
}

decision_status() {
  case "$1" in
    SUCCEEDED|IDEMPOTENT_REPLAY) printf 'succeeded' ;;
    NEEDS_RECONCILIATION) printf 'needs_reconciliation' ;;
    *) printf 'failed' ;;
  esac
}

write_decision() {
  local request="$1"
  local claim_file="$2"
  local decision="$3"
  local reason="$4"
  local execution_attempted="$5"
  local message="$6"
  local observed_first="${7:-null}"
  local observed_second="${8:-null}"
  local observed_after="${9:-null}"
  local source_decision="${10:-null}"
  local evaluated epoch requested age status id safe_id claim output
  evaluated="$(now_epoch)"
  requested="$(jq -r '.requestedAt // empty' "$request" 2>/dev/null || true)"
  if [[ -n "$requested" ]] && epoch="$(timestamp_epoch "$requested")"; then age="$((evaluated - epoch))"; else age=0; fi
  status="$(decision_status "$decision")"
  id="$(jq -r '.id // empty' "$request" 2>/dev/null || true)"
  safe_id="${id:-invalid_$(basename "$(dirname "$request")")}"
  claim="$(cat "$claim_file")"
  output="$HISTORY_DIR/${safe_id}.$(jq -r '.claimId' <<< "$claim").decision.json"
  jq -n \
    --argjson request "$(jq -c . "$request" 2>/dev/null || printf 'null')" \
    --argjson claim "$claim" \
    --arg status "$status" \
    --arg decision "$decision" \
    --arg reasonCode "$reason" \
    --arg message "$message" \
    --arg evaluatedAt "$(epoch_to_iso "$evaluated")" \
    --argjson ageSeconds "$age" \
    --argjson executionAttempted "$execution_attempted" \
    --arg observedBeforeHashFirst "$observed_first" \
    --arg observedBeforeHashSecond "$observed_second" \
    --arg observedAfterHash "$observed_after" \
    --arg sourceDecision "$source_decision" \
    '($request // {}) + {
      status:$status,
      decision:$decision,
      reasonCode:$reasonCode,
      message:$message,
      evaluatedAt:$evaluatedAt,
      ageSeconds:$ageSeconds,
      executionAttempted:$executionAttempted,
      claimId:$claim.claimId,
      claimedAt:$claim.claimedAt,
      claimExpiresAt:$claim.claimExpiresAt,
      claimMetadataSynthetic:($claim.synthetic // false),
      observedBeforeHashFirst:($observedBeforeHashFirst | select(. != "null") // null),
      observedBeforeHashSecond:($observedBeforeHashSecond | select(. != "null") // null),
      observedAfterHash:($observedAfterHash | select(. != "null") // null),
      sourceDecision:($sourceDecision | select(. != "null") // null)
    }' | write_json_immutable "$output"
  printf '%s\n' "$output"
}

cleanup_claim() {
  local claim_dir="$1"
  chmod 600 "$claim_dir"/*.json 2>/dev/null || true
  rm -f "$claim_dir"/*.json
  rmdir "$claim_dir" 2>/dev/null || true
}

operation_from_decision() {
  local decision_file="$1"
  jq -c '{id:(.id // "invalid"),action:(.action // "invalid"),status,requestedAt:(.requestedAt // null),finishedAt:.evaluatedAt,message,reasonCode,decision,executionAttempted,claimId}' "$decision_file"
}

reject_claim() {
  local claim_dir="$1"
  local reason="$2"
  local message="$3"
  local request decision_file operation
  request="$(find "$claim_dir" -maxdepth 1 -name '*.json' ! -name claim.json -type f | head -n 1)"
  decision_file="$(write_decision "$request" "$claim_dir/claim.json" REJECTED "$reason" false "$message")"
  operation="$(operation_from_decision "$decision_file")"
  cleanup_claim "$claim_dir"
  merge_status "$operation" false
}

archive_invalid_request() {
  local claim_dir="$1"
  local message="$2"
  reject_claim "$claim_dir" INVALID_REQUEST_SCHEMA "$message"
}

check_duplicate_or_idempotency() {
  local claim_dir="$1"
  local request="$2"
  local id key semantic existing source request_hash_value decision_file operation
  id="$(jq -r '.id' "$request")"
  key="$(jq -r '.idempotencyKey' "$request")"
  semantic="$(jq -r '.semanticHash' "$request")"
  request_hash_value="$(jq -r '.requestHash' "$request")"
  if existing="$(history_match id "$id")"; then
    reject_claim "$claim_dir" DUPLICATE_REQUEST "request id already has immutable history"
    return 0
  fi
  if existing="$(history_match idempotencyKey "$key")"; then
    if [[ "$(jq -r '.semanticHash // empty' "$existing")" == "$semantic" ]]; then
      source="$(basename "$existing")"
      local source_decision
      source_decision="$(jq -r '.decision // "REJECTED"' "$existing")"
      decision_file="$(write_decision "$request" "$claim_dir/claim.json" "$source_decision" IDEMPOTENT_REPLAY false "existing terminal decision returned without replay" null null null "$source")"
      operation="$(operation_from_decision "$decision_file")"
      cleanup_claim "$claim_dir"
      merge_status "$operation" false
    else
      reject_claim "$claim_dir" IDEMPOTENCY_CONFLICT "idempotency key is already bound to a different semantic hash"
    fi
    return 0
  fi
  if existing="$(history_match requestHash "$request_hash_value")"; then
    reject_claim "$claim_dir" DUPLICATE_REQUEST "request hash already has immutable history"
    return 0
  fi
  return 1
}

process_claim() {
  local claim_dir="$1"
  local claim_file request original_name schema action
  claim_file="$claim_dir/claim.json"
  original_name="$(jq -r '.originalFileName' "$claim_file")"
  request="$claim_dir/$original_name"
  if [[ ! -f "$request" || -L "$request" ]]; then
    archive_invalid_request "$claim_dir" "claimed request is not a regular file"
    return
  fi
  schema="$(jq -r '.schemaVersion // 1' "$request" 2>/dev/null || printf invalid)"
  action="$(jq -r '.action // empty' "$request" 2>/dev/null || true)"
  if [[ "$schema" != "2" ]]; then
    if [[ "$action" != "check" ]]; then
      reject_claim "$claim_dir" LEGACY_MUTATION_UNBOUND "legacy mutation request is not bound to expected-before state"
    elif ! validate_v1_check "$request" || ! validate_v1_ttl "$request"; then
      reject_claim "$claim_dir" INVALID_REQUEST_SCHEMA "invalid or expired legacy check request"
    else
      process_check "$claim_dir" "$request"
    fi
    return
  fi
  if ! validate_request_schema "$request"; then
    archive_invalid_request "$claim_dir" "invalid V2 update request schema"
    return
  fi
  if [[ "$original_name" != "$(jq -r '.id' "$request").json" ]]; then
    archive_invalid_request "$claim_dir" "request file name does not match request id"
    return
  fi
  if [[ "$(expected_before_hash "$request")" != "$(jq -r '.expectedBeforeHash' "$request")" ||
        "$(semantic_hash "$request")" != "$(jq -r '.semanticHash' "$request")" ||
        "$(request_hash "$request")" != "$(jq -r '.requestHash' "$request")" ]]; then
    reject_claim "$claim_dir" REQUEST_HASH_MISMATCH "request canonical hash validation failed"
    return
  fi
  if ! validate_ttl "$request"; then
    reject_claim "$claim_dir" REQUEST_EXPIRED "request TTL is invalid or expired"
    return
  fi
  if check_duplicate_or_idempotency "$claim_dir" "$request"; then
    return
  fi
  case "$(jq -r '.action' "$request")" in
    check) process_check "$claim_dir" "$request" ;;
    apply) process_apply "$claim_dir" "$request" ;;
    rollback|set_auto_apply) process_locked_mutation "$claim_dir" "$request" ;;
  esac
}

synthetic_claim_id() {
  local claim_dir="$1"
  local base
  base="$(basename "$claim_dir")"
  if [[ "$base" =~ ^[a-f0-9]{32}$ ]]; then
    printf '%s' "$base"
  else
    printf 'synthetic-%s' "$(printf '%s' "$base" | sha256sum | awk '{print substr($1,1,24)}')"
  fi
}

reconcile_missing_claim() {
  local claim_dir="$1"
  local request="$2"
  local claim_file decision_file operation
  claim_file="$claim_dir/claim.json"
  jq -n \
    --arg claimId "$(synthetic_claim_id "$claim_dir")" \
    --arg originalFileName "$(basename "$request")" \
    '{claimId:$claimId,claimedAt:null,claimExpiresAt:null,originalFileName:$originalFileName,synthetic:true}' |
    write_json "$claim_file" 600
  decision_file="$(write_decision "$request" "$claim_file" NEEDS_RECONCILIATION MISSING_CLAIM_METADATA null "processing request has no claim metadata and was not replayed")"
  operation="$(operation_from_decision "$decision_file")"
  cleanup_claim "$claim_dir"
  merge_status "$operation" false
  RECONCILED_STALE=1
}

reconcile_stale_claims() {
  local claim_dir claim_file expires expires_epoch now request decision_file operation
  now="$(now_epoch)"
  while IFS= read -r claim_dir; do
    request="$(find "$claim_dir" -maxdepth 1 -name '*.json' ! -name claim.json -type f | head -n 1)"
    [[ -n "$request" ]] || continue
    claim_file="$claim_dir/claim.json"
    if [[ ! -f "$claim_file" ]]; then
      reconcile_missing_claim "$claim_dir" "$request"
      continue
    fi
    expires="$(jq -r '.claimExpiresAt // empty' "$claim_file" 2>/dev/null || true)"
    expires_epoch="$(timestamp_epoch "$expires" 2>/dev/null || printf 0)"
    (( now > expires_epoch )) || continue
    decision_file="$(write_decision "$request" "$claim_file" NEEDS_RECONCILIATION STALE_PROCESSING_CLAIM null "stale processing claim requires manual reconciliation and was not replayed")"
    operation="$(operation_from_decision "$decision_file")"
    cleanup_claim "$claim_dir"
    merge_status "$operation" false
    RECONCILED_STALE=1
  done < <(find "$PROCESSING_DIR" -mindepth 1 -maxdepth 1 -type d | sort)
}
