#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

COMMAND="run"
CONFIG_FILE="${AREAFORGE_UPDATER_CONFIG:-/etc/areaforge/updater.env}"
TAG_OVERRIDE=""
DRY_RUN=0
FORCE=0
YES=0
IDENTITY_JSON_PATH=""
REQUEST_GUARD_PATH=""
REQUEST_GUARD_FILE_SHA256=""
PRODUCTION_STATE_LOCK_HELD=0
INHERITED_PRODUCTION_STATE_LOCK="${AREAFORGE_PRODUCTION_STATE_LOCK_INHERITED:-0}"
INHERITED_PRODUCTION_STATE_LOCK_FILE="${AREAFORGE_INHERITED_PRODUCTION_STATE_LOCK_FILE:-}"
WORK_DIR=""
CONFIG_ENV_CAPTURED=0
CONFIG_ENV_KEYS=(
  AREAFORGE_GITHUB_REPO
  AREAFORGE_RELEASE_CHANNEL
  AREAFORGE_RELEASE_MANIFEST_ASSET
  AREAFORGE_RELEASE_CHECKSUM_ASSET
  AREAFORGE_RELEASE_SIGNATURE_ASSET
  AREAFORGE_GITHUB_TOKEN
  AREAFORGE_DEPLOY_DIR
  AREAFORGE_ENV_FILE
  AREAFORGE_COMPOSE_FILE
  AREAFORGE_COMPOSE_PROJECT
  AREAFORGE_NGINX_CONFIG
  AREAFORGE_BACKUP_DIR
  AREAFORGE_UPDATE_RECORD_DIR
  AREAFORGE_UPLOADS_VOLUME
  AREAFORGE_PRODUCTION_STATE_LOCK_FILE
  AREAFORGE_AUTO_APPLY
  AREAFORGE_ALLOW_PRERELEASE
  AREAFORGE_ALLOW_COMPOSE_UPDATE
  AREAFORGE_REQUIRE_SIGNATURE
  AREAFORGE_COSIGN_PUBLIC_KEY
  AREAFORGE_GPG_VERIFY
  AREAFORGE_HEALTH_URL
  AREAFORGE_EXTRA_SMOKE_COMMAND
  AREAFORGE_SMOKE_BASE_URL
  AREAFORGE_SMOKE_EMAIL
  AREAFORGE_SMOKE_PASSWORD
  AREAFORGE_SMOKE_PASSWORD_FILE
  AREAFORGE_SMOKE_EXPECTED_VERSION
  AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY
  AREAFORGE_SMOKE_ATTACHMENT_ID
  AREAFORGE_AUTO_RESTORE_DB_ON_ROLLBACK
)
CONFIG_ENV_PRESENT=()
CONFIG_ENV_VALUES=()

usage() {
  cat <<'USAGE'
Usage: areaforge-updater.sh [check|run|apply] [options]

Commands:
  check       Fetch the GitHub Release manifest, verify it, and report status.
  run         Check and auto-apply only if AREAFORGE_AUTO_APPLY allows it.
  apply       Apply the selected release; requires --yes unless --dry-run.

Options:
  --config PATH   Private updater env file. Default: /etc/areaforge/updater.env
  --tag TAG       Use an explicit GitHub Release tag instead of latest.
  --dry-run       Print planned write operations without changing services.
  --force         Allow applying the current or older version.
  --yes           Required for apply mode.
  --identity-json PATH
                  Atomically write the verified, redacted target identity.
  --request-guard PATH
                  Bind a V2 apply to exact expected-before and target identity.
  -h, --help      Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    check|run|apply)
      COMMAND="$1"
      shift
      ;;
    --config)
      CONFIG_FILE="${2:?missing --config value}"
      shift 2
      ;;
    --tag)
      TAG_OVERRIDE="${2:?missing --tag value}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --yes)
      YES=1
      shift
      ;;
    --identity-json)
      IDENTITY_JSON_PATH="${2:?missing --identity-json value}"
      shift 2
      ;;
    --request-guard)
      REQUEST_GUARD_PATH="${2:?missing --request-guard value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

log() {
  printf '[areaforge-updater] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

run_cmd() {
  log "+ $*"
  if [[ "$DRY_RUN" != "1" ]]; then
    "$@"
  fi
}

run_sensitive_cmd() {
  log "+ $1"
  shift
  if [[ "$DRY_RUN" != "1" ]]; then
    "$@"
  fi
}

capture_config_environment() {
  local index key
  for ((index = 0; index < ${#CONFIG_ENV_KEYS[@]}; index += 1)); do
    key="${CONFIG_ENV_KEYS[$index]}"
    if declare -p "$key" >/dev/null 2>&1; then
      CONFIG_ENV_PRESENT[index]=1
      CONFIG_ENV_VALUES[index]="${!key}"
    else
      CONFIG_ENV_PRESENT[index]=0
      CONFIG_ENV_VALUES[index]=""
    fi
  done
  CONFIG_ENV_CAPTURED=1
}

restore_config_environment() {
  local index key
  for ((index = 0; index < ${#CONFIG_ENV_KEYS[@]}; index += 1)); do
    key="${CONFIG_ENV_KEYS[$index]}"
    unset "$key"
    if [[ "${CONFIG_ENV_PRESENT[$index]}" == "1" ]]; then
      printf -v "$key" '%s' "${CONFIG_ENV_VALUES[$index]}"
      export "${key?}"
    fi
  done
}

load_config() {
  [[ "$CONFIG_ENV_CAPTURED" == "1" ]] || capture_config_environment
  restore_config_environment
  [[ -f "$CONFIG_FILE" ]] || die "config file not found: $CONFIG_FILE"
  set -a
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a

  : "${AREAFORGE_GITHUB_REPO:?AREAFORGE_GITHUB_REPO is required}"
  : "${AREAFORGE_DEPLOY_DIR:?AREAFORGE_DEPLOY_DIR is required}"
  : "${AREAFORGE_ENV_FILE:?AREAFORGE_ENV_FILE is required}"
  : "${AREAFORGE_COMPOSE_FILE:?AREAFORGE_COMPOSE_FILE is required}"

  AREAFORGE_RELEASE_CHANNEL="${AREAFORGE_RELEASE_CHANNEL:-stable}"
  AREAFORGE_RELEASE_MANIFEST_ASSET="${AREAFORGE_RELEASE_MANIFEST_ASSET:-areaforge-release-manifest.json}"
  AREAFORGE_RELEASE_CHECKSUM_ASSET="${AREAFORGE_RELEASE_CHECKSUM_ASSET:-SHA256SUMS}"
  AREAFORGE_RELEASE_SIGNATURE_ASSET="${AREAFORGE_RELEASE_SIGNATURE_ASSET:-SHA256SUMS.sig}"
  AREAFORGE_COMPOSE_PROJECT="${AREAFORGE_COMPOSE_PROJECT:-areaforge}"
  AREAFORGE_BACKUP_DIR="${AREAFORGE_BACKUP_DIR:-/opt/areaforge/backups}"
  AREAFORGE_UPDATE_RECORD_DIR="${AREAFORGE_UPDATE_RECORD_DIR:-$AREAFORGE_BACKUP_DIR/github-release-updates}"
  AREAFORGE_UPLOADS_VOLUME="${AREAFORGE_UPLOADS_VOLUME:-${AREAFORGE_COMPOSE_PROJECT}_areaforge-uploads}"
  AREAFORGE_PRODUCTION_STATE_LOCK_FILE="${AREAFORGE_PRODUCTION_STATE_LOCK_FILE:-$AREAFORGE_DEPLOY_DIR/.areaforge-production-state.lock}"
  AREAFORGE_AUTO_APPLY="${AREAFORGE_AUTO_APPLY:-none}"
  AREAFORGE_ALLOW_PRERELEASE="${AREAFORGE_ALLOW_PRERELEASE:-false}"
  AREAFORGE_ALLOW_COMPOSE_UPDATE="${AREAFORGE_ALLOW_COMPOSE_UPDATE:-false}"
  AREAFORGE_REQUIRE_SIGNATURE="${AREAFORGE_REQUIRE_SIGNATURE:-true}"
  AREAFORGE_GPG_VERIFY="${AREAFORGE_GPG_VERIFY:-false}"
  AREAFORGE_AUTO_RESTORE_DB_ON_ROLLBACK="${AREAFORGE_AUTO_RESTORE_DB_ON_ROLLBACK:-false}"
}

config_get() {
  local key="$1"
  grep -E "^${key}=" "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//" || true
}

configured_production_state_lock_path() (
  restore_config_environment
  set -a
  # shellcheck source=/dev/null
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
  printf '%s' "${AREAFORGE_PRODUCTION_STATE_LOCK_FILE:-${AREAFORGE_DEPLOY_DIR:?AREAFORGE_DEPLOY_DIR is required}/.areaforge-production-state.lock}"
)

production_state_lock_path_matches_fd8() {
  local candidate="$1"
  local candidate_inode fd_inode
  [[ -e "$candidate" ]] || return 1
  if [[ -e "/proc/$$/fd/8" ]]; then
    [[ "$candidate" -ef "/proc/$$/fd/8" ]]
    return
  fi
  [[ -e "/dev/fd/8" ]] || return 1
  candidate_inode="$(stat -f '%i' "$candidate" 2>/dev/null)" || return 1
  fd_inode="$(stat -f '%i' /dev/fd/8 2>/dev/null)" || return 1
  [[ "$candidate_inode" == "$fd_inode" ]]
}

acquire_production_state_lock() {
  mkdir -p "$(dirname "$AREAFORGE_PRODUCTION_STATE_LOCK_FILE")"
  if [[ "$INHERITED_PRODUCTION_STATE_LOCK" == "1" ]]; then
    [[ -n "$INHERITED_PRODUCTION_STATE_LOCK_FILE" ]] || die "inherited production-state lock path is missing"
    production_state_lock_path_matches_fd8 "$INHERITED_PRODUCTION_STATE_LOCK_FILE" ||
      die "inherited production-state lock path mismatch"
    production_state_lock_path_matches_fd8 "$AREAFORGE_PRODUCTION_STATE_LOCK_FILE" ||
      die "configured production-state lock path changed after claim"
    flock -n 8 || die "inherited production-state lock is not held"
    PRODUCTION_STATE_LOCK_HELD=1
    return
  fi
  exec 8>"$AREAFORGE_PRODUCTION_STATE_LOCK_FILE"
  chmod 600 "$AREAFORGE_PRODUCTION_STATE_LOCK_FILE"
  flock -n 8 || die "another production-state mutation is running"
  PRODUCTION_STATE_LOCK_HELD=1
}

require_production_state_lock() {
  local configured_path
  [[ "$PRODUCTION_STATE_LOCK_HELD" == "1" ]] || die "production-state lock is required for mutation"
  configured_path="$(configured_production_state_lock_path)" || die "configured production-state lock path cannot be resolved"
  [[ "$configured_path" == "$AREAFORGE_PRODUCTION_STATE_LOCK_FILE" ]] || die "configured production-state lock path changed while held"
  production_state_lock_path_matches_fd8 "$configured_path" || die "production-state lock inode changed while held"
}

compose() {
  docker compose \
    -p "$AREAFORGE_COMPOSE_PROJECT" \
    --env-file "$AREAFORGE_ENV_FILE" \
    -f "$AREAFORGE_COMPOSE_FILE" \
    "$@"
}

env_get() {
  local key="$1"
  grep -E "^${key}=" "$AREAFORGE_ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//" || true
}

fsync_path() {
  sync -f "$1"
}

env_set() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp "${AREAFORGE_ENV_FILE}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (found == 0) print key "=" value }
  ' "$AREAFORGE_ENV_FILE" > "$tmp"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: would update $key in $AREAFORGE_ENV_FILE"
    rm -f "$tmp"
  else
    chmod --reference="$AREAFORGE_ENV_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
    fsync_path "$tmp" || { rm -f "$tmp"; return 1; }
    mv "$tmp" "$AREAFORGE_ENV_FILE" || { rm -f "$tmp"; return 1; }
    fsync_path "$(dirname "$AREAFORGE_ENV_FILE")" || return 1
  fi
}

github_headers() {
  printf '%s\n' "-H" "Accept: application/vnd.github+json"
  if [[ -n "${AREAFORGE_GITHUB_TOKEN:-}" ]]; then
    printf '%s\n' "-H" "Authorization: Bearer ${AREAFORGE_GITHUB_TOKEN}"
  fi
}

github_api() {
  local url="$1"
  local args=()
  while IFS= read -r header_arg; do
    args+=("$header_arg")
  done < <(github_headers)
  curl -fsSL "${args[@]}" "$url"
}

download_asset() {
  local release_json="$1"
  local asset_name="$2"
  local output="$3"
  local asset_api_url args
  asset_api_url="$(asset_api_url "$release_json" "$asset_name")"
  args=(-fsSL -H "Accept: application/octet-stream")
  if [[ -n "${AREAFORGE_GITHUB_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${AREAFORGE_GITHUB_TOKEN}")
  fi
  curl "${args[@]}" -o "$output" "$asset_api_url"
}

fetch_release_json() {
  local output="$1"
  local api_base="https://api.github.com/repos/${AREAFORGE_GITHUB_REPO}/releases"
  if [[ -n "$TAG_OVERRIDE" ]]; then
    github_api "${api_base}/tags/${TAG_OVERRIDE}" > "$output"
  else
    github_api "${api_base}/latest" > "$output"
  fi
}

asset_api_url() {
  local release_json="$1"
  local asset_name="$2"
  jq -er --arg name "$asset_name" '.assets[] | select(.name == $name) | .url' "$release_json"
}

asset_exists() {
  local release_json="$1"
  local asset_name="$2"
  jq -er --arg name "$asset_name" '.assets[] | select(.name == $name) | .id' "$release_json" >/dev/null
}

verify_release_state() {
  local release_json="$1"
  local draft prerelease
  draft="$(jq -r '.draft' "$release_json")"
  prerelease="$(jq -r '.prerelease' "$release_json")"
  [[ "$draft" == "false" ]] || die "GitHub release is draft"
  if [[ "$prerelease" == "true" && "$AREAFORGE_ALLOW_PRERELEASE" != "true" ]]; then
    die "GitHub release is prerelease and AREAFORGE_ALLOW_PRERELEASE is not true"
  fi
}

verify_signature() {
  local sums="$1"
  local sig="$2"
  if [[ "$AREAFORGE_REQUIRE_SIGNATURE" != "true" ]]; then
    log "signature verification disabled by AREAFORGE_REQUIRE_SIGNATURE=false"
    return 0
  fi

  [[ -f "$sig" ]] || die "signature asset is required but missing"
  if [[ -n "${AREAFORGE_COSIGN_PUBLIC_KEY:-}" ]]; then
    require_cmd cosign
    log "+ cosign verify-blob --key $AREAFORGE_COSIGN_PUBLIC_KEY --bundle $sig $sums"
    cosign verify-blob --key "$AREAFORGE_COSIGN_PUBLIC_KEY" --bundle "$sig" "$sums"
    return 0
  fi

  if [[ "$AREAFORGE_GPG_VERIFY" == "true" ]]; then
    require_cmd gpg
    log "+ gpg --verify $sig $sums"
    gpg --verify "$sig" "$sums"
    return 0
  fi

  die "signature verification required; set AREAFORGE_COSIGN_PUBLIC_KEY or AREAFORGE_GPG_VERIFY=true"
}

verify_sha256_asset() {
  local sums="$1"
  local asset="$2"
  local asset_name
  asset_name="$(basename "$asset")"
  grep -E "(^|[[:space:]])${asset_name}$" "$sums" | sha256sum -c -
}

validate_asset_name() {
  local asset="$1"
  local field="$2"
  [[ -n "$asset" ]] || die "manifest $field is required"
  [[ "$asset" =~ ^[A-Za-z0-9._-]+$ ]] || die "manifest $field must be a simple release asset name"
}

normalize_version() {
  printf '%s' "$1" | sed -E 's/^v//; s/-.*$//'
}

image_tag_matches_version() {
  local image="$1"
  local version="$2"
  local reference tag
  [[ "$image" =~ ^ghcr\.io/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$ ]] || return 1
  reference="${image%@sha256:*}"
  tag="${reference##*:}"
  [[ "$tag" == "$version" || "$tag" == "v$version" ]]
}

version_gt() {
  local left right max
  left="$(normalize_version "$1")"
  right="$(normalize_version "$2")"
  [[ "$left" != "$right" ]] || return 1
  max="$(printf '%s\n%s\n' "$left" "$right" | sort -V | tail -n 1)"
  [[ "$max" == "$left" ]]
}

version_class() {
  local current target
  current="$(normalize_version "$1")"
  target="$(normalize_version "$2")"
  IFS=. read -r c_major c_minor _ <<< "$current"
  IFS=. read -r t_major t_minor _ <<< "$target"
  if [[ "${c_major:-0}" != "${t_major:-0}" ]]; then
    printf 'major'
  elif [[ "${c_minor:-0}" != "${t_minor:-0}" ]]; then
    printf 'minor'
  else
    printf 'patch'
  fi
}

auto_apply_allowed() {
  local class="$1"
  local manifest_allowed="$2"
  [[ "$manifest_allowed" == "true" ]] || return 1
  case "$AREAFORGE_AUTO_APPLY" in
    all) return 0 ;;
    minor) [[ "$class" == "minor" || "$class" == "patch" ]] ;;
    patch) [[ "$class" == "patch" ]] ;;
    none|"") return 1 ;;
    *) die "invalid AREAFORGE_AUTO_APPLY=$AREAFORGE_AUTO_APPLY" ;;
  esac
}

download_and_verify_release() {
  WORK_DIR="$(mktemp -d)"
  RELEASE_JSON="$WORK_DIR/release.json"
  MANIFEST_PATH="$WORK_DIR/$AREAFORGE_RELEASE_MANIFEST_ASSET"
  SUMS_PATH="$WORK_DIR/$AREAFORGE_RELEASE_CHECKSUM_ASSET"
  SIGNATURE_PATH="$WORK_DIR/$AREAFORGE_RELEASE_SIGNATURE_ASSET"

  fetch_release_json "$RELEASE_JSON"
  verify_release_state "$RELEASE_JSON"

  download_asset "$RELEASE_JSON" "$AREAFORGE_RELEASE_MANIFEST_ASSET" "$MANIFEST_PATH"
  download_asset "$RELEASE_JSON" "$AREAFORGE_RELEASE_CHECKSUM_ASSET" "$SUMS_PATH"
  if asset_exists "$RELEASE_JSON" "$AREAFORGE_RELEASE_SIGNATURE_ASSET"; then
    download_asset "$RELEASE_JSON" "$AREAFORGE_RELEASE_SIGNATURE_ASSET" "$SIGNATURE_PATH"
  fi

  verify_signature "$SUMS_PATH" "$SIGNATURE_PATH"
  (cd "$WORK_DIR" && verify_sha256_asset "$SUMS_PATH" "$AREAFORGE_RELEASE_MANIFEST_ASSET")

  parse_manifest "$MANIFEST_PATH"
  validate_manifest

  SBOM_ASSET_PATH="$WORK_DIR/$SBOM_ASSET"
  PROVENANCE_ASSET_PATH="$WORK_DIR/$PROVENANCE_ASSET"
  download_asset "$RELEASE_JSON" "$SBOM_ASSET" "$SBOM_ASSET_PATH"
  download_asset "$RELEASE_JSON" "$PROVENANCE_ASSET" "$PROVENANCE_ASSET_PATH"
  (cd "$WORK_DIR" && verify_sha256_asset "$SUMS_PATH" "$SBOM_ASSET")
  (cd "$WORK_DIR" && verify_sha256_asset "$SUMS_PATH" "$PROVENANCE_ASSET")

  if [[ -n "${COMPOSE_ASSET:-}" ]]; then
    COMPOSE_ASSET_PATH="$WORK_DIR/$COMPOSE_ASSET"
    download_asset "$RELEASE_JSON" "$COMPOSE_ASSET" "$COMPOSE_ASSET_PATH"
    (cd "$WORK_DIR" && verify_sha256_asset "$SUMS_PATH" "$COMPOSE_ASSET")
  fi
}

parse_manifest() {
  local manifest="$1"
  SCHEMA_VERSION="$(jq -r '.schemaVersion' "$manifest")"
  APP_NAME="$(jq -r '.app' "$manifest")"
  TARGET_VERSION="$(jq -r '.version' "$manifest")"
  TARGET_CHANNEL="$(jq -r '.channel' "$manifest")"
  TARGET_GIT_COMMIT="$(jq -r '.gitCommit' "$manifest")"
  MINIMUM_APP_VERSION="$(jq -r '.minimumAppVersion' "$manifest")"
  WEB_IMAGE="$(jq -r '.webImage' "$manifest")"
  WEB_IMAGE_DIGEST="$(jq -r '.webImageDigest' "$manifest")"
  REQUIRES_MIGRATION="$(jq -r '.requiresMigration' "$manifest")"
  MIGRATION_IMAGE="$(jq -r '.migrationImage // empty' "$manifest")"
  MIGRATION_IMAGE_DIGEST="$(jq -r '.migrationImageDigest // empty' "$manifest")"
  COMPOSE_ASSET="$(jq -r '.composeAsset // empty' "$manifest")"
  SBOM_ASSET="$(jq -r '.sbomAsset // empty' "$manifest")"
  PROVENANCE_ASSET="$(jq -r '.provenanceAsset // empty' "$manifest")"
  MANIFEST_PATCH_ALLOWED="$(jq -r '.autoApply.patch' "$manifest")"
  MANIFEST_MINOR_ALLOWED="$(jq -r '.autoApply.minor' "$manifest")"
  MANIFEST_MAJOR_ALLOWED="$(jq -r '.autoApply.major' "$manifest")"
  RELEASE_NOTES_URL="$(jq -r '.releaseNotesUrl' "$manifest")"
}

validate_manifest() {
  local release_tag image_reference image_tag
  [[ "$SCHEMA_VERSION" == "1" ]] || die "unsupported manifest schemaVersion=$SCHEMA_VERSION"
  [[ "$APP_NAME" == "AreaForge" ]] || die "manifest app must be AreaForge"
  [[ "$TARGET_CHANNEL" == "$AREAFORGE_RELEASE_CHANNEL" ]] || die "manifest channel $TARGET_CHANNEL does not match configured $AREAFORGE_RELEASE_CHANNEL"
  [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || die "manifest version must be semver"
  [[ "$MINIMUM_APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || die "manifest minimumAppVersion must be semver"
  release_tag="$(jq -r '.tag_name // empty' "$RELEASE_JSON")"
  [[ "$release_tag" == "$TARGET_VERSION" || "$release_tag" == "v$TARGET_VERSION" ]] || die "release tag must match manifest version"
  if version_gt "$MINIMUM_APP_VERSION" "$CURRENT_VERSION"; then
    die "current version $CURRENT_VERSION is below manifest minimumAppVersion $MINIMUM_APP_VERSION"
  fi
  [[ "$WEB_IMAGE" != *":latest" ]] || die "webImage must not use latest"
  [[ "$WEB_IMAGE_DIGEST" =~ ^ghcr\.io/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$ ]] || die "webImageDigest must be a tagged GHCR image@sha256:<64 hex>"
  image_reference="${WEB_IMAGE_DIGEST%@sha256:*}"
  [[ "$image_reference" == "$WEB_IMAGE" ]] || die "webImageDigest reference must match webImage"
  image_tag="${WEB_IMAGE##*:}"
  [[ "$image_tag" == "$TARGET_VERSION" || "$image_tag" == "v$TARGET_VERSION" ]] || die "web image tag must match manifest version"
  [[ "$TARGET_GIT_COMMIT" =~ ^[a-f0-9]{40}$ ]] || die "gitCommit must be a 40-character SHA"
  validate_asset_name "$SBOM_ASSET" "sbomAsset"
  validate_asset_name "$PROVENANCE_ASSET" "provenanceAsset"
  if [[ -n "$COMPOSE_ASSET" ]]; then
    validate_asset_name "$COMPOSE_ASSET" "composeAsset"
  fi
  if [[ "$REQUIRES_MIGRATION" == "true" ]]; then
    [[ -n "$MIGRATION_IMAGE_DIGEST" ]] || die "requiresMigration=true needs migrationImageDigest"
    [[ "$MIGRATION_IMAGE" != *":latest" ]] || die "migrationImage must not use latest"
    [[ "$MIGRATION_IMAGE_DIGEST" =~ @sha256:[a-f0-9]{64}$ ]] || die "migrationImageDigest must be image@sha256:<64 hex>"
  fi
}

load_runtime_env() {
  [[ -f "$AREAFORGE_ENV_FILE" ]] || die "env file not found: $AREAFORGE_ENV_FILE"
  POSTGRES_DB="$(env_get POSTGRES_DB)"
  POSTGRES_USER="$(env_get POSTGRES_USER)"
  POSTGRES_PASSWORD="$(env_get POSTGRES_PASSWORD)"
  WEB_PORT="$(env_get WEB_PORT)"
  WEB_PORT="${WEB_PORT:-3000}"
  [[ -n "$POSTGRES_DB" ]] || die "POSTGRES_DB is required in production env"
  [[ -n "$POSTGRES_USER" ]] || die "POSTGRES_USER is required in production env"
  [[ -n "$POSTGRES_PASSWORD" ]] || die "POSTGRES_PASSWORD is required in production env"
  CURRENT_VERSION="$(env_get APP_VERSION)"
  CURRENT_IMAGE="$(env_get AREAFORGE_IMAGE)"
  HEALTH_URL="${AREAFORGE_HEALTH_URL:-http://127.0.0.1:${WEB_PORT}/api/health}"
}

prepare_record_dir() {
  RELEASE_ID="github-${TARGET_VERSION}-$(date -u +%Y%m%d%H%M%S)"
  RECORD_DIR="$AREAFORGE_UPDATE_RECORD_DIR/$RELEASE_ID"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "dry-run: would create record directory $RECORD_DIR"
  else
    mkdir -p "$RECORD_DIR"/{db,uploads,config,logs,release}
  fi
}

wait_for_postgres() {
  log "waiting for postgres health"
  if [[ "$DRY_RUN" != "1" ]]; then
    local ok=0
    for _ in $(seq 1 30); do
      if compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
        ok=1
        break
      fi
      sleep 2
    done
    [[ "$ok" == "1" ]] || die "postgres did not become ready"
  else
    log "dry-run: would wait for postgres health"
  fi
}

sha256_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    sha256sum "$file" | awk '{ print $1 }'
  else
    printf 'not-applicable'
  fi
}

sha256_text() {
  printf '%s' "$1" | sha256sum | awk '{ print "sha256:" $1 }'
}

atomic_write_json() {
  local output="$1"
  local output_dir tmp
  output_dir="$(dirname "$output")"
  [[ -d "$output_dir" ]] || die "identity output directory not found: $output_dir"
  tmp="$(mktemp "$output_dir/.areaforge-identity.XXXXXX")"
  jq -cS . > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$output"
}

verified_target_identity_json() {
  local release_id manifest_sha256
  release_id="$(jq -er '.id | select(type == "number" and . > 0 and . == floor and . <= 9007199254740991)' "$RELEASE_JSON")" || die "GitHub release id must be a positive safe integer"
  manifest_sha256="sha256:$(sha256_file "$MANIFEST_PATH")"
  [[ "$manifest_sha256" =~ ^sha256:[a-f0-9]{64}$ ]] || die "verified manifest sha256 is invalid"
  [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || die "verified manifest version is invalid"
  [[ "$WEB_IMAGE_DIGEST" =~ ^ghcr\.io/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$ ]] || die "verified web image digest is invalid"
  jq -cnS \
    --argjson releaseId "$release_id" \
    --arg manifestSha256 "$manifest_sha256" \
    --arg manifestVersion "$TARGET_VERSION" \
    --arg webImageDigest "$WEB_IMAGE_DIGEST" \
    '{releaseId:$releaseId,manifestSha256:$manifestSha256,manifestVersion:$manifestVersion,webImageDigest:$webImageDigest}'
}

emit_verified_target_identity() {
  [[ -n "$IDENTITY_JSON_PATH" ]] || return 0
  verified_target_identity_json | atomic_write_json "$IDENTITY_JSON_PATH"
  log "wrote verified target identity: $IDENTITY_JSON_PATH"
}

latest_update_record() {
  local record updated best_record="" best_updated=""
  while IFS= read -r record; do
    [[ -n "$record" ]] || continue
    updated="$(awk -F': ' '$1=="updatedAt"{print $2; exit}' "$record")"
    [[ "$updated" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || continue
    if [[ -z "$best_record" || "$updated" > "$best_updated" || ( "$updated" == "$best_updated" && "$record" > "$best_record" ) ]]; then
      best_record="$record"
      best_updated="$updated"
    fi
  done < <(find "$AREAFORGE_UPDATE_RECORD_DIR" -name update-record.txt -type f 2>/dev/null | sort)
  printf '%s\n' "$best_record"
}

rollback_snapshot_json() {
  local latest_record previous_version previous_image source_sha256
  latest_record="$(latest_update_record)"
  if [[ -z "$latest_record" ]]; then
    jq -cnS '{targetVersion:null,targetImage:null,sourceRecordSha256:null}'
    return
  fi

  previous_version="$(awk -F': ' '$1=="previousAppVersion"{print $2; exit}' "$latest_record")"
  previous_image="$(awk -F': ' '$1=="previousImage"{print $2; exit}' "$latest_record")"
  if [[ ! "$previous_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
     ! image_tag_matches_version "$previous_image" "$previous_version"; then
    jq -cnS '{targetVersion:null,targetImage:null,sourceRecordSha256:null}'
    return
  fi

  source_sha256="sha256:$(sha256_file "$latest_record")"
  jq -cnS \
    --arg targetVersion "$previous_version" \
    --arg targetImage "$previous_image" \
    --arg sourceRecordSha256 "$source_sha256" \
    '{targetVersion:$targetVersion,targetImage:$targetImage,sourceRecordSha256:$sourceRecordSha256}'
}

observed_before_json() {
  local auto_apply signature_required rollback
  load_runtime_env
  auto_apply="$(config_get AREAFORGE_AUTO_APPLY)"
  auto_apply="${auto_apply:-none}"
  signature_required="$(config_get AREAFORGE_REQUIRE_SIGNATURE)"
  signature_required="${signature_required:-true}"
  [[ "$auto_apply" =~ ^(none|patch|minor|all)$ ]] || die "invalid live AREAFORGE_AUTO_APPLY=$auto_apply"
  [[ "$signature_required" == "true" || "$signature_required" == "false" ]] || die "invalid live AREAFORGE_REQUIRE_SIGNATURE=$signature_required"
  rollback="$(rollback_snapshot_json)"
  jq -cnS \
    --arg currentVersion "$CURRENT_VERSION" \
    --arg currentImage "$CURRENT_IMAGE" \
    --arg autoApply "$auto_apply" \
    --argjson signatureRequired "$signature_required" \
    --argjson rollback "$rollback" \
    '{
      currentVersion:$currentVersion,
      currentImage:($currentImage | select(length > 0) // null),
      autoApply:$autoApply,
      signatureRequired:$signatureRequired,
      rollbackAvailable:($rollback.targetVersion != null and $rollback.targetImage != null and $rollback.sourceRecordSha256 != null),
      rollbackTargetVersion:$rollback.targetVersion,
      rollbackTargetImage:$rollback.targetImage,
      rollbackSourceRecordSha256:$rollback.sourceRecordSha256
    }'
}

validate_request_guard_schema() {
  jq -e '
    type == "object" and
    (keys == ["action","actorEmailHash","expectedBefore","expectedBeforeHash","expiresAt","id","idempotencyKey","params","requestHash","requestedAt","schemaVersion","semanticHash","status","target"]) and
    .schemaVersion == 2 and
    (.id | type == "string" and test("^update_[0-9]+_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")) and
    .action == "apply" and .status == "queued" and
    (.requestedAt | type == "string") and (.expiresAt | type == "string") and
    (.actorEmailHash | type == "string" and test("^[a-f0-9]{64}$")) and
    (.idempotencyKey | type == "string" and test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")) and
    (.params | type == "object" and keys == ["autoApply","tag"]) and
    (.params.tag | type == "string" and test("^v?[0-9]+\\.[0-9]+\\.[0-9]+$")) and
    .params.autoApply == null and
    (.target | type == "object" and keys == ["manifestSha256","manifestVersion","releaseId","webImageDigest"]) and
    (.target.releaseId | type == "number" and . > 0 and . == floor and . <= 9007199254740991) and
    (.target.manifestSha256 | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (.target.manifestVersion | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and
    (.target.webImageDigest | type == "string" and test("^ghcr\\.io/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$")) and
    (.expectedBefore | type == "object" and keys == ["autoApply","currentImage","currentVersion","rollbackAvailable","rollbackSourceRecordSha256","rollbackTargetImage","rollbackTargetVersion","signatureRequired"]) and
    (.expectedBefore.currentVersion | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and
    (.expectedBefore.currentImage == null or (.expectedBefore.currentImage | type == "string" and length > 0 and length <= 500 and test("^[ -~]+$"))) and
    (.expectedBefore.autoApply as $policy | ["none","patch","minor","all"] | index($policy) != null) and
    (.expectedBefore.signatureRequired | type == "boolean") and
    (.expectedBefore.rollbackAvailable | type == "boolean") and
    (.expectedBefore.rollbackTargetVersion == null or (.expectedBefore.rollbackTargetVersion | type == "string" and length > 0)) and
    (.expectedBefore.rollbackTargetImage == null or (.expectedBefore.rollbackTargetImage | type == "string" and test("^ghcr\\.io/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$"))) and
    (.expectedBefore.rollbackSourceRecordSha256 == null or (.expectedBefore.rollbackSourceRecordSha256 | type == "string" and test("^sha256:[a-f0-9]{64}$"))) and
    (if .expectedBefore.rollbackAvailable then
      ([.expectedBefore.rollbackTargetVersion,.expectedBefore.rollbackTargetImage,.expectedBefore.rollbackSourceRecordSha256] | all(. != null))
     else
      ([.expectedBefore.rollbackTargetVersion,.expectedBefore.rollbackTargetImage,.expectedBefore.rollbackSourceRecordSha256] | all(. == null))
     end) and
    (.expectedBeforeHash | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (.semanticHash | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
    (.requestHash | type == "string" and test("^sha256:[a-f0-9]{64}$"))
  ' "$REQUEST_GUARD_PATH" >/dev/null || die "INVALID_REQUEST_SCHEMA: request guard is not strict V2 apply"
}

validate_request_guard_ttl() {
  jq -e '
    def epoch: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
    (.requestedAt | epoch) as $requested |
    (.expiresAt | epoch) as $expires |
    (now) as $now |
    $expires >= $requested and
    ($expires - $requested) <= 600 and
    $requested <= ($now + 30) and
    ($expires + 30) >= $now
  ' "$REQUEST_GUARD_PATH" >/dev/null 2>&1
}

validate_request_guard_hashes() {
  local expected_before_projection semantic_projection request_projection actual
  expected_before_projection="$(jq -cS '{domain:"areaforge.update-request.expected-before.v2",expectedBefore:.expectedBefore}' "$REQUEST_GUARD_PATH")"
  actual="$(sha256_text "$expected_before_projection")"
  [[ "$actual" == "$(jq -r '.expectedBeforeHash' "$REQUEST_GUARD_PATH")" ]] || die "REQUEST_HASH_MISMATCH: expectedBeforeHash"

  semantic_projection="$(jq -cS '{domain:"areaforge.update-request.semantic.v2",action,params,target,expectedBefore}' "$REQUEST_GUARD_PATH")"
  actual="$(sha256_text "$semantic_projection")"
  [[ "$actual" == "$(jq -r '.semanticHash' "$REQUEST_GUARD_PATH")" ]] || die "REQUEST_HASH_MISMATCH: semanticHash"

  request_projection="$(jq -cS '{domain:"areaforge.update-request.v2",schemaVersion,id,idempotencyKey,action,status,requestedAt,expiresAt,actorEmailHash,params,target,expectedBefore,expectedBeforeHash,semanticHash}' "$REQUEST_GUARD_PATH")"
  actual="$(sha256_text "$request_projection")"
  [[ "$actual" == "$(jq -r '.requestHash' "$REQUEST_GUARD_PATH")" ]] || die "REQUEST_HASH_MISMATCH: requestHash"
}

validate_request_guard() {
  local phase="$1" guard_sha256 expected observed observed_projection observed_hash target verified release_tag
  [[ -n "$REQUEST_GUARD_PATH" ]] || return 0
  require_production_state_lock
  [[ -f "$REQUEST_GUARD_PATH" && ! -L "$REQUEST_GUARD_PATH" ]] || die "INVALID_REQUEST_SCHEMA: request guard must be a regular file"

  if [[ "$(jq -r '.schemaVersion // 1' "$REQUEST_GUARD_PATH" 2>/dev/null || printf 1)" != "2" ]]; then
    die "LEGACY_MUTATION_UNBOUND: V1 apply cannot bind production state"
  fi
  validate_request_guard_schema
  validate_request_guard_hashes

  guard_sha256="$(sha256_file "$REQUEST_GUARD_PATH")"
  if [[ -z "$REQUEST_GUARD_FILE_SHA256" ]]; then
    REQUEST_GUARD_FILE_SHA256="$guard_sha256"
  elif [[ "$guard_sha256" != "$REQUEST_GUARD_FILE_SHA256" ]]; then
    die "REQUEST_HASH_MISMATCH: request guard changed between comparisons"
  fi

  expected="$(jq -cS '.expectedBefore' "$REQUEST_GUARD_PATH")"
  observed="$(observed_before_json | jq -cS .)"
  observed_projection="$(jq -cnS --argjson expectedBefore "$observed" '{domain:"areaforge.update-request.expected-before.v2",expectedBefore:$expectedBefore}')"
  observed_hash="$(sha256_text "$observed_projection")"
  if ! image_tag_matches_version "$CURRENT_IMAGE" "$CURRENT_VERSION"; then
    printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=CURRENT_IMAGE_IDENTITY_INVALID observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
    die "CURRENT_IMAGE_IDENTITY_INVALID: current image tag does not match APP_VERSION"
  fi
  if ! validate_request_guard_ttl; then
    printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=REQUEST_EXPIRED observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
    die "REQUEST_EXPIRED: invalid or expired V2 mutation TTL"
  fi

  if ! release_tag="$(jq -er '.tag_name | select(type == "string" and length > 0)' "$RELEASE_JSON")"; then
    printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=TARGET_IDENTITY_CHANGED observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
    die "TARGET_IDENTITY_CHANGED: release tag is invalid"
  fi
  if [[ "$(jq -r '.params.tag' "$REQUEST_GUARD_PATH")" != "$release_tag" ]]; then
    printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=TARGET_IDENTITY_CHANGED observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
    die "TARGET_IDENTITY_CHANGED: release tag mismatch"
  fi
  if [[ -n "$TAG_OVERRIDE" ]]; then
    if [[ "$TAG_OVERRIDE" != "$release_tag" ]]; then
      printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=TARGET_IDENTITY_CHANGED observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
      die "TARGET_IDENTITY_CHANGED: selected tag mismatch"
    fi
  fi

  if [[ "$expected" != "$observed" ]]; then
    printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
    die "EXPECTED_BEFORE_MISMATCH: $phase comparison"
  fi

  target="$(jq -cS '.target' "$REQUEST_GUARD_PATH")"
  verified="$(verified_target_identity_json | jq -cS .)"
  if [[ "$target" != "$verified" ]]; then
    printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=TARGET_IDENTITY_CHANGED observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
    die "TARGET_IDENTITY_CHANGED: $phase comparison"
  fi
  if [[ "$FORCE" != "1" ]] && ! version_gt "$TARGET_VERSION" "$CURRENT_VERSION"; then
    printf 'AREAFORGE_REQUEST_GUARD phase=%s result=reject reasonCode=TARGET_VERSION_NOT_NEWER observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
    die "TARGET_VERSION_NOT_NEWER: target $TARGET_VERSION is not newer than current $CURRENT_VERSION"
  fi
  printf 'AREAFORGE_REQUEST_GUARD phase=%s result=pass reasonCode=NONE observedBeforeHash=%s executionAttempted=false\n' "$phase" "$observed_hash" >&2
}

backup_before_update() {
  prepare_record_dir
  run_cmd compose up -d postgres
  wait_for_postgres

  if [[ "$DRY_RUN" != "1" ]]; then
    compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl > "$RECORD_DIR/db/areaforge-before-update.dump"
    docker run --rm \
      -v "${AREAFORGE_UPLOADS_VOLUME}:/data:ro" \
      -v "$RECORD_DIR/uploads:/backup" \
      alpine:3.20 sh -c 'cd /data && tar -czf /backup/uploads-before-update.tar.gz .'
    cp "$AREAFORGE_ENV_FILE" "$RECORD_DIR/config/production.env"
    cp "$AREAFORGE_COMPOSE_FILE" "$RECORD_DIR/config/docker-compose.prod.yml"
    if [[ -n "${AREAFORGE_NGINX_CONFIG:-}" && -f "$AREAFORGE_NGINX_CONFIG" ]]; then
      cp "$AREAFORGE_NGINX_CONFIG" "$RECORD_DIR/config/nginx.conf"
    fi
    cp "$MANIFEST_PATH" "$RECORD_DIR/release/$AREAFORGE_RELEASE_MANIFEST_ASSET"
    cp "$SUMS_PATH" "$RECORD_DIR/release/$AREAFORGE_RELEASE_CHECKSUM_ASSET"
    [[ -f "$SIGNATURE_PATH" ]] && cp "$SIGNATURE_PATH" "$RECORD_DIR/release/$AREAFORGE_RELEASE_SIGNATURE_ASSET"
    cp "$SBOM_ASSET_PATH" "$RECORD_DIR/release/$SBOM_ASSET"
    cp "$PROVENANCE_ASSET_PATH" "$RECORD_DIR/release/$PROVENANCE_ASSET"
  else
    log "dry-run: would backup database, uploads volume, env, compose, nginx, and release assets"
  fi
}

maybe_update_compose_file() {
  [[ -n "${COMPOSE_ASSET_PATH:-}" ]] || return 0
  if [[ "$AREAFORGE_ALLOW_COMPOSE_UPDATE" != "true" ]]; then
    log "compose asset verified but not applied because AREAFORGE_ALLOW_COMPOSE_UPDATE is not true"
    return 0
  fi
  run_cmd cp "$COMPOSE_ASSET_PATH" "$AREAFORGE_COMPOSE_FILE"
}

pull_images() {
  run_cmd docker pull "$WEB_IMAGE_DIGEST"
  if [[ "$REQUIRES_MIGRATION" == "true" ]]; then
    run_cmd docker pull "$MIGRATION_IMAGE_DIGEST"
  fi
}

run_migration_if_needed() {
  [[ "$REQUIRES_MIGRATION" == "true" ]] || return 0
  local database_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  run_sensitive_cmd "docker run --rm --network ${AREAFORGE_COMPOSE_PROJECT}_default --env-file <production-env> -e DATABASE_URL=<redacted> $MIGRATION_IMAGE_DIGEST" \
    docker run --rm \
    --network "${AREAFORGE_COMPOSE_PROJECT}_default" \
    --env-file "$AREAFORGE_ENV_FILE" \
    -e "DATABASE_URL=$database_url" \
    "$MIGRATION_IMAGE_DIGEST"
}

switch_web() {
  env_set AREAFORGE_IMAGE "$WEB_IMAGE_DIGEST" || return 1
  env_set APP_VERSION "$TARGET_VERSION" || return 1
  run_cmd compose up -d web || return 1
}

run_smoke() {
  log "waiting for health: $HEALTH_URL"
  if [[ "$DRY_RUN" != "1" ]]; then
    local ok=0
    for _ in $(seq 1 30); do
      if curl -fsS "$HEALTH_URL" > "$RECORD_DIR/logs/health.json"; then
        ok=1
        break
      fi
      sleep 2
    done
    [[ "$ok" == "1" ]] || return 1
  else
    log "dry-run: would curl $HEALTH_URL"
  fi

  if [[ -n "${AREAFORGE_EXTRA_SMOKE_COMMAND:-}" ]]; then
    log "running extra smoke command"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "dry-run: would run AREAFORGE_EXTRA_SMOKE_COMMAND"
    else
      if AREAFORGE_SMOKE_EXPECTED_VERSION="$TARGET_VERSION" \
        bash -lc "$AREAFORGE_EXTRA_SMOKE_COMMAND" > "$RECORD_DIR/logs/extra-smoke.log" 2>&1; then
        printf 'PASS\n' > "$RECORD_DIR/logs/extra-smoke.status"
      else
        printf 'FAIL\n' > "$RECORD_DIR/logs/extra-smoke.status"
        return 1
      fi
    fi
  fi
}

rollback_application() {
  log "rolling back web image to previous version"
  if [[ "$AREAFORGE_ALLOW_COMPOSE_UPDATE" == "true" && -n "${COMPOSE_ASSET_PATH:-}" ]]; then
    local compose_backup="$RECORD_DIR/config/docker-compose.prod.yml"
    [[ -f "$compose_backup" ]] || return 1
    cp "$compose_backup" "$AREAFORGE_COMPOSE_FILE" || return 1
    fsync_path "$AREAFORGE_COMPOSE_FILE" || return 1
    fsync_path "$(dirname "$AREAFORGE_COMPOSE_FILE")" || return 1
  fi
  env_set AREAFORGE_IMAGE "$CURRENT_IMAGE" || return 1
  env_set APP_VERSION "$CURRENT_VERSION" || return 1
  run_cmd compose up -d web || return 1
}

extra_smoke_status() {
  if [[ -z "${AREAFORGE_EXTRA_SMOKE_COMMAND:-}" ]]; then
    printf 'not-configured'
  elif [[ -f "$RECORD_DIR/logs/extra-smoke.status" ]]; then
    tr -d '\n' < "$RECORD_DIR/logs/extra-smoke.status"
  else
    printf 'FAIL'
  fi
}

write_record() {
  local status="$1"
  local failure_reason="${2:-none}"
  [[ "$DRY_RUN" == "1" ]] && return 0
  local record="$RECORD_DIR/update-record.txt"
  local tmp
  tmp="$(mktemp "$RECORD_DIR/.update-record.XXXXXX")"
  cat > "$tmp" <<EOF_RECORD
releaseId: $RELEASE_ID
updatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
status: $status
githubRepo: $AREAFORGE_GITHUB_REPO
releaseTag: $(jq -r '.tag_name' "$RELEASE_JSON")
targetVersion: $TARGET_VERSION
targetChannel: $TARGET_CHANNEL
gitCommit: $TARGET_GIT_COMMIT
previousAppVersion: $CURRENT_VERSION
previousImage: $CURRENT_IMAGE
targetWebImage: $WEB_IMAGE
targetWebImageDigest: $WEB_IMAGE_DIGEST
migrationApplied: $REQUIRES_MIGRATION
migrationImageDigest: ${MIGRATION_IMAGE_DIGEST:-not-applicable}
sbomAsset: $SBOM_ASSET
sbomSha256: $(sha256_file "$SBOM_ASSET_PATH")
provenanceAsset: $PROVENANCE_ASSET
provenanceSha256: $(sha256_file "$PROVENANCE_ASSET_PATH")
composeUpdated: $AREAFORGE_ALLOW_COMPOSE_UPDATE
databaseBackupPath: $RECORD_DIR/db/areaforge-before-update.dump
databaseBackupSha256: $(sha256_file "$RECORD_DIR/db/areaforge-before-update.dump")
uploadsBackupPath: $RECORD_DIR/uploads/uploads-before-update.tar.gz
uploadsBackupSha256: $(sha256_file "$RECORD_DIR/uploads/uploads-before-update.tar.gz")
envBackupPath: $RECORD_DIR/config/production.env
envBackupSha256: $(sha256_file "$RECORD_DIR/config/production.env")
composeConfigBackupPath: $RECORD_DIR/config/docker-compose.prod.yml
composeHash: $(sha256_file "$RECORD_DIR/config/docker-compose.prod.yml")
nginxConfigBackupPath: ${AREAFORGE_NGINX_CONFIG:-not-configured}
healthUrl: $HEALTH_URL
smokeHealth: $([[ -f "$RECORD_DIR/logs/health.json" ]] && printf PASS || printf FAIL)
extraSmoke: $(extra_smoke_status)
extraSmokeLogPath: $([[ -n "${AREAFORGE_EXTRA_SMOKE_COMMAND:-}" ]] && printf '%s' "$RECORD_DIR/logs/extra-smoke.log" || printf 'not-configured')
rollbackAttempted: $([[ "$status" == "rolled_back" || "$status" == "recovery_uncertain" ]] && printf yes || printf no)
databaseRestoreAttempted: no
uploadsRestoreAttempted: no
failureReason: $failure_reason
releaseNotesUrl: $RELEASE_NOTES_URL
EOF_RECORD
  chmod 600 "$tmp"
  fsync_path "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$record" || { rm -f "$tmp"; return 1; }
  fsync_path "$RECORD_DIR" || return 1
  log "wrote update record: $record"
}

apply_update() {
  require_production_state_lock
  [[ "$COMMAND" != "apply" || "$YES" == "1" || "$DRY_RUN" == "1" ]] || die "apply requires --yes"
  [[ -n "$CURRENT_VERSION" ]] || die "current APP_VERSION is missing"
  image_tag_matches_version "$CURRENT_IMAGE" "$CURRENT_VERSION" || die "current AREAFORGE_IMAGE must be an immutable GHCR digest whose tag matches APP_VERSION"

  if [[ "$FORCE" != "1" ]] && ! version_gt "$TARGET_VERSION" "$CURRENT_VERSION"; then
    die "target version $TARGET_VERSION is not newer than current $CURRENT_VERSION; use --force to override"
  fi

  validate_request_guard "second"
  printf 'AREAFORGE_REQUEST_EXECUTION action=apply executionAttempted=true\n' >&2
  backup_before_update
  local failure="none"
  local migration_attempted="false"
  local requires_migration="${REQUIRES_MIGRATION:-false}"
  if ! pull_images; then failure="docker image pull failed"; fi
  if [[ "$failure" == "none" ]] && ! maybe_update_compose_file; then failure="compose update failed"; fi
  if [[ "$failure" == "none" && "$requires_migration" == "true" ]]; then
    migration_attempted="true"
    if ! run_migration_if_needed; then failure="migration deploy failed"; fi
  fi
  if [[ "$failure" == "none" ]] && ! switch_web; then failure="web switch failed"; fi
  if [[ "$failure" == "none" ]] && ! run_smoke; then failure="smoke failed"; fi

  if [[ "$failure" != "none" ]]; then
    log "update failed: $failure"
    if ! rollback_application; then
      if ! write_record "recovery_uncertain" "$failure; rollback recovery uncertain"; then
        log "failed to persist recovery-uncertain update record"
      fi
      printf 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=ROLLBACK_RECOVERY_UNCERTAIN executionAttempted=true\n' >&2
      return 2
    fi
    if ! write_record "rolled_back" "$failure"; then
      log "failed to persist rolled-back update record"
      printf 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=ROLLBACK_RECORD_PERSISTENCE_UNCERTAIN executionAttempted=true\n' >&2
      return 2
    fi
    if [[ "$migration_attempted" == "true" ]]; then
      printf 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=MIGRATION_STATE_UNCERTAIN executionAttempted=true\n' >&2
      return 2
    fi
    printf 'AREAFORGE_UPDATER_TERMINAL status=rolled_back executionAttempted=true\n' >&2
    return 1
  fi

  if ! write_record "applied" "none"; then
    log "update side effects completed but applied record persistence failed"
    printf 'AREAFORGE_UPDATER_RECONCILIATION reasonCode=APPLIED_RECORD_PERSISTENCE_UNCERTAIN executionAttempted=true\n' >&2
    return 2
  fi
  printf 'AREAFORGE_UPDATER_TERMINAL status=applied executionAttempted=true\n' >&2
  log "update applied: $CURRENT_VERSION -> $TARGET_VERSION"
}

report_status() {
  local class manifest_allowed="false"
  class="$(version_class "$CURRENT_VERSION" "$TARGET_VERSION")"
  case "$class" in
    patch) manifest_allowed="$MANIFEST_PATCH_ALLOWED" ;;
    minor) manifest_allowed="$MANIFEST_MINOR_ALLOWED" ;;
    major) manifest_allowed="$MANIFEST_MAJOR_ALLOWED" ;;
  esac

  if [[ "$FORCE" != "1" ]] && ! version_gt "$TARGET_VERSION" "$CURRENT_VERSION"; then
    log "current version is up to date or newer: current=$CURRENT_VERSION target=$TARGET_VERSION"
    return 1
  fi

  log "update available: current=$CURRENT_VERSION target=$TARGET_VERSION class=$class autoPolicy=$AREAFORGE_AUTO_APPLY manifestAllowed=$manifest_allowed"
  if auto_apply_allowed "$class" "$manifest_allowed"; then
    return 0
  fi
  return 1
}

main() {
  local locked_state_path=""
  require_cmd curl
  require_cmd jq
  require_cmd sha256sum
  require_cmd sort
  require_cmd awk
  require_cmd stat
  load_config

  [[ -z "$REQUEST_GUARD_PATH" || "$COMMAND" == "apply" ]] || die "--request-guard is only valid with apply"
  if [[ "$COMMAND" == "run" || "$COMMAND" == "apply" ]]; then
    require_cmd docker
    require_cmd flock
    require_cmd sync
    locked_state_path="$AREAFORGE_PRODUCTION_STATE_LOCK_FILE"
    acquire_production_state_lock
    load_config
    [[ "$AREAFORGE_PRODUCTION_STATE_LOCK_FILE" == "$locked_state_path" ]] || die "production-state lock path changed while acquiring lock"
    require_production_state_lock
  fi

  load_runtime_env

  download_and_verify_release
  validate_request_guard "first"
  emit_verified_target_identity

  case "$COMMAND" in
    check)
      report_status || true
      ;;
    run)
      if report_status; then
        apply_update
      else
        log "auto-apply policy did not allow applying this release"
      fi
      ;;
    apply)
      apply_update
      ;;
  esac
}

cleanup() {
  [[ -z "$WORK_DIR" || ! -d "$WORK_DIR" ]] || rm -rf "$WORK_DIR"
}

if [[ "${AREAFORGE_UPDATER_NO_MAIN:-0}" != "1" ]]; then
  trap cleanup EXIT
  main "$@"
fi
