# shellcheck shell=bash

expected_before_hash() {
  local request="$1"
  local canonical
  canonical="$(jq -cS '{domain:"areaforge.update-request.expected-before.v2",expectedBefore}' "$request")"
  sha256_text "$canonical"
}

semantic_hash() {
  local request="$1"
  local canonical
  canonical="$(jq -cS '{domain:"areaforge.update-request.semantic.v2",action,params,target,expectedBefore}' "$request")"
  sha256_text "$canonical"
}

request_hash() {
  local request="$1"
  local canonical
  canonical="$(jq -cS '{domain:"areaforge.update-request.v2",schemaVersion,id,action,requestedAt,expiresAt,actorEmailHash,idempotencyKey,params,target,expectedBefore,expectedBeforeHash,semanticHash}' "$request")"
  sha256_text "$canonical"
}

validate_request_schema() {
  local request="$1"
  jq -e '
    type == "object" and
    (keys | sort == ["action","actorEmailHash","expectedBefore","expectedBeforeHash","expiresAt","id","idempotencyKey","params","requestHash","requestedAt","schemaVersion","semanticHash","status","target"]) and
    (.schemaVersion == 2) and
    (.id | type == "string" and test("^update_[0-9]+_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")) and
    (.action as $value | ["check","apply","rollback","set_auto_apply"] | index($value) != null) and
    (.status == "queued") and
    (.requestedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$")) and
    (.expiresAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$")) and
    (.actorEmailHash | type == "string" and test("^[a-f0-9]{64}$")) and
    (.idempotencyKey | type == "string" and test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")) and
    (.params | type == "object" and (keys | sort == ["autoApply","tag"])) and
    (.params.tag == null or (.params.tag | type == "string" and test("^v?[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$"))) and
    (.params.autoApply == null or (.params.autoApply as $value | ["none","patch","minor","all"] | index($value) != null)) and
    (.target | type == "object" and (keys | sort == ["manifestSha256","manifestVersion","releaseId","webImageDigest"])) and
    (.target.releaseId == null or (.target.releaseId | type == "number" and floor == . and . >= 1)) and
    (.target.manifestSha256 == null or (.target.manifestSha256 | type == "string" and test("^sha256:[a-f0-9]{64}$"))) and
    (.target.manifestVersion == null or (.target.manifestVersion | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$"))) and
    (.target.webImageDigest == null or (.target.webImageDigest | type == "string" and test("^ghcr\\.io/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$"))) and
    (.expectedBefore | type == "object" and (keys | sort == ["autoApply","currentImage","currentVersion","rollbackSourceRecordSha256","rollbackTargetImage","rollbackTargetVersion","signatureRequired"])) and
    (.expectedBefore.currentVersion | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$")) and
    (.expectedBefore.currentImage == null or (.expectedBefore.currentImage | type == "string" and length > 0 and length <= 500)) and
    (.expectedBefore.autoApply as $value | ["none","patch","minor","all"] | index($value) != null) and
    (.expectedBefore.signatureRequired | type == "boolean") and
    (.expectedBefore.rollbackTargetVersion == null or (.expectedBefore.rollbackTargetVersion | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$"))) and
    (.expectedBefore.rollbackTargetImage == null or (.expectedBefore.rollbackTargetImage | type == "string" and length > 0 and length <= 500)) and
    (.expectedBefore.rollbackSourceRecordSha256 == null or (.expectedBefore.rollbackSourceRecordSha256 | type == "string" and test("^sha256:[a-f0-9]{64}$"))) and
    (.expectedBeforeHash | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (.semanticHash | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (.requestHash | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (if .action == "apply" then
      (.params.tag != null and .params.autoApply == null and
       .target.releaseId != null and .target.manifestSha256 != null and .target.manifestVersion != null and .target.webImageDigest != null)
     elif .action == "set_auto_apply" then
      (.params.tag == null and .params.autoApply != null and ([.target[]] | all(. == null)))
     else
      (.params.tag == null and .params.autoApply == null and ([.target[]] | all(. == null)))
     end)
  ' "$request" >/dev/null 2>&1
}

validate_v1_check() {
  local request="$1"
  jq -e '
    type == "object" and
    ((keys - ["id","action","status","requestedAt","finishedAt","message","actorEmailHash","tag","autoApply"]) | length == 0) and
    (.id | type == "string" and test("^update_[0-9]+_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")) and
    (.action == "check") and (.status == "queued") and
    (.requestedAt | type == "string") and
    (.actorEmailHash | type == "string" and test("^[a-fA-F0-9]{64}$"))
  ' "$request" >/dev/null 2>&1
}

timestamp_epoch() {
  jq -nr --arg value "$1" '$value | sub("\\.[0-9]{1,3}Z$";"Z") | fromdateiso8601' 2>/dev/null
}

validate_ttl() {
  local request="$1"
  local action requested expires now max_ttl
  action="$(jq -r '.action' "$request")"
  requested="$(timestamp_epoch "$(jq -r '.requestedAt' "$request")")" || return 1
  expires="$(timestamp_epoch "$(jq -r '.expiresAt' "$request")")" || return 1
  now="$(now_epoch)"
  if [[ "$action" == "check" ]]; then max_ttl=900; else max_ttl=600; fi
  (( requested <= now + CLOCK_SKEW_SECONDS )) || return 1
  (( expires >= requested )) || return 1
  (( expires - requested <= max_ttl )) || return 1
  (( now <= expires + CLOCK_SKEW_SECONDS )) || return 1
}

validate_v1_ttl() {
  local request="$1"
  local requested now
  requested="$(timestamp_epoch "$(jq -r '.requestedAt' "$request")")" || return 1
  now="$(now_epoch)"
  (( requested <= now + CLOCK_SKEW_SECONDS )) || return 1
  (( now - requested <= 900 + CLOCK_SKEW_SECONDS )) || return 1
}

observed_before_hash() {
  local observed="$1"
  local canonical
  canonical="$(jq -cS --argjson expectedBefore "$observed" '{domain:"areaforge.update-request.expected-before.v2",expectedBefore:$expectedBefore}' <<< '{}')"
  sha256_text "$canonical"
}

comparison_projection() {
  local action="$1"
  local auto_apply_target="$2"
  jq -cS --arg action "$action" --arg target "$auto_apply_target" '
    if $action == "rollback" then
      {currentVersion,currentImage,rollbackTargetVersion,rollbackTargetImage,rollbackSourceRecordSha256}
    elif $action == "set_auto_apply" and $target != "none" then
      {currentImage,autoApply,signatureRequired}
    elif $action == "set_auto_apply" then
      {autoApply}
    else . end
  '
}

expected_matches() {
  local request="$1"
  local observed="$2"
  local action target expected_projection observed_projection
  action="$(jq -r '.action' "$request")"
  target="$(jq -r '.params.autoApply // empty' "$request")"
  expected_projection="$(jq -c '.expectedBefore' "$request" | comparison_projection "$action" "$target")"
  observed_projection="$(printf '%s\n' "$observed" | comparison_projection "$action" "$target")"
  [[ "$expected_projection" == "$observed_projection" ]]
}

request_guard_marker() {
  local raw="$1"
  local phase="$2"
  local line
  while IFS= read -r line; do
    if [[ "$line" =~ ^AREAFORGE_REQUEST_GUARD\ phase=(first|second)\ result=(pass|reject)\ reasonCode=([A-Z][A-Z0-9_]*)\ observedBeforeHash=(sha256:[a-f0-9]{64})\ executionAttempted=(true|false)$ ]] &&
       [[ "${BASH_REMATCH[1]}" == "$phase" ]]; then
      jq -cn \
        --arg phase "${BASH_REMATCH[1]}" \
        --arg result "${BASH_REMATCH[2]}" \
        --arg reasonCode "${BASH_REMATCH[3]}" \
        --arg observedBeforeHash "${BASH_REMATCH[4]}" \
        --argjson executionAttempted "${BASH_REMATCH[5]}" \
        '{phase:$phase,result:$result,reasonCode:$reasonCode,observedBeforeHash:$observedBeforeHash,executionAttempted:$executionAttempted}'
    fi
  done <<< "$raw" | tail -n 1
}

request_execution_attempted() {
  local raw="$1"
  if grep -Fxq 'AREAFORGE_REQUEST_EXECUTION action=apply executionAttempted=true' <<< "$raw"; then
    printf 'true'
  else
    printf 'false'
  fi
}
