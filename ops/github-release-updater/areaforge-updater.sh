#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

COMMAND="run"
CONFIG_FILE="${AREAFORGE_UPDATER_CONFIG:-/etc/areaforge/updater.env}"
TAG_OVERRIDE=""
DRY_RUN=0
FORCE=0
YES=0

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

load_config() {
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
  AREAFORGE_LOCK_FILE="${AREAFORGE_LOCK_FILE:-$AREAFORGE_DEPLOY_DIR/.areaforge-updater.lock}"
  AREAFORGE_AUTO_APPLY="${AREAFORGE_AUTO_APPLY:-none}"
  AREAFORGE_ALLOW_PRERELEASE="${AREAFORGE_ALLOW_PRERELEASE:-false}"
  AREAFORGE_ALLOW_COMPOSE_UPDATE="${AREAFORGE_ALLOW_COMPOSE_UPDATE:-false}"
  AREAFORGE_REQUIRE_SIGNATURE="${AREAFORGE_REQUIRE_SIGNATURE:-true}"
  AREAFORGE_GPG_VERIFY="${AREAFORGE_GPG_VERIFY:-false}"
  AREAFORGE_AUTO_RESTORE_DB_ON_ROLLBACK="${AREAFORGE_AUTO_RESTORE_DB_ON_ROLLBACK:-false}"
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
    mv "$tmp" "$AREAFORGE_ENV_FILE"
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
    run_cmd cosign verify-blob --key "$AREAFORGE_COSIGN_PUBLIC_KEY" --signature "$sig" "$sums"
    return 0
  fi

  if [[ "$AREAFORGE_GPG_VERIFY" == "true" ]]; then
    require_cmd gpg
    run_cmd gpg --verify "$sig" "$sums"
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

normalize_version() {
  printf '%s' "$1" | sed -E 's/^v//; s/-.*$//'
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
  MANIFEST_PATCH_ALLOWED="$(jq -r '.autoApply.patch' "$manifest")"
  MANIFEST_MINOR_ALLOWED="$(jq -r '.autoApply.minor' "$manifest")"
  MANIFEST_MAJOR_ALLOWED="$(jq -r '.autoApply.major' "$manifest")"
  RELEASE_NOTES_URL="$(jq -r '.releaseNotesUrl' "$manifest")"
}

validate_manifest() {
  [[ "$SCHEMA_VERSION" == "1" ]] || die "unsupported manifest schemaVersion=$SCHEMA_VERSION"
  [[ "$APP_NAME" == "AreaForge" ]] || die "manifest app must be AreaForge"
  [[ "$TARGET_CHANNEL" == "$AREAFORGE_RELEASE_CHANNEL" ]] || die "manifest channel $TARGET_CHANNEL does not match configured $AREAFORGE_RELEASE_CHANNEL"
  if version_gt "$MINIMUM_APP_VERSION" "$CURRENT_VERSION"; then
    die "current version $CURRENT_VERSION is below manifest minimumAppVersion $MINIMUM_APP_VERSION"
  fi
  [[ "$WEB_IMAGE" != *":latest" ]] || die "webImage must not use latest"
  [[ "$WEB_IMAGE_DIGEST" =~ @sha256:[a-f0-9]{64}$ ]] || die "webImageDigest must be image@sha256:<64 hex>"
  [[ "$TARGET_GIT_COMMIT" =~ ^[a-f0-9]{40}$ ]] || die "gitCommit must be a 40-character SHA"
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
  env_set AREAFORGE_IMAGE "$WEB_IMAGE_DIGEST"
  env_set APP_VERSION "$TARGET_VERSION"
  run_cmd compose up -d web
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
    [[ "$ok" == "1" ]] || die "health smoke failed"
  else
    log "dry-run: would curl $HEALTH_URL"
  fi

  if [[ -n "${AREAFORGE_EXTRA_SMOKE_COMMAND:-}" ]]; then
    log "running extra smoke command"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "dry-run: would run AREAFORGE_EXTRA_SMOKE_COMMAND"
    else
      bash -lc "$AREAFORGE_EXTRA_SMOKE_COMMAND" > "$RECORD_DIR/logs/extra-smoke.log" 2>&1
    fi
  fi
}

rollback_application() {
  log "rolling back web image to previous version"
  env_set AREAFORGE_IMAGE "$CURRENT_IMAGE"
  env_set APP_VERSION "$CURRENT_VERSION"
  run_cmd compose up -d web
}

write_record() {
  local status="$1"
  local failure_reason="${2:-none}"
  [[ "$DRY_RUN" == "1" ]] && return 0
  local record="$RECORD_DIR/update-record.txt"
  cat > "$record" <<EOF_RECORD
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
rollbackAttempted: $([[ "$status" == "rolled_back" ]] && printf yes || printf no)
databaseRestoreAttempted: no
uploadsRestoreAttempted: no
failureReason: $failure_reason
releaseNotesUrl: $RELEASE_NOTES_URL
EOF_RECORD
  chmod 600 "$record"
  log "wrote update record: $record"
}

apply_update() {
  [[ "$COMMAND" != "apply" || "$YES" == "1" || "$DRY_RUN" == "1" ]] || die "apply requires --yes"
  [[ -n "$CURRENT_IMAGE" ]] || die "current AREAFORGE_IMAGE is missing"
  [[ -n "$CURRENT_VERSION" ]] || die "current APP_VERSION is missing"

  if [[ "$FORCE" != "1" ]] && ! version_gt "$TARGET_VERSION" "$CURRENT_VERSION"; then
    die "target version $TARGET_VERSION is not newer than current $CURRENT_VERSION; use --force to override"
  fi

  backup_before_update
  local failure="none"
  if ! pull_images; then failure="docker image pull failed"; fi
  if [[ "$failure" == "none" ]] && ! maybe_update_compose_file; then failure="compose update failed"; fi
  if [[ "$failure" == "none" ]] && ! run_migration_if_needed; then failure="migration deploy failed"; fi
  if [[ "$failure" == "none" ]] && ! switch_web; then failure="web switch failed"; fi
  if [[ "$failure" == "none" ]] && ! run_smoke; then failure="smoke failed"; fi

  if [[ "$failure" != "none" ]]; then
    log "update failed: $failure"
    rollback_application || true
    write_record "rolled_back" "$failure"
    return 1
  fi

  write_record "applied" "none"
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
  require_cmd curl
  require_cmd jq
  require_cmd docker
  require_cmd sha256sum
  require_cmd sort
  require_cmd awk
  require_cmd flock
  load_config
  load_runtime_env

  mkdir -p "$(dirname "$AREAFORGE_LOCK_FILE")"
  exec 9>"$AREAFORGE_LOCK_FILE"
  flock -n 9 || die "another updater process is running"

  download_and_verify_release

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

main "$@"
