import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const temp = mkdtempSync(path.join(tmpdir(), "areaforge-release-identity-probe-"));
const bin = path.join(temp, "bin");
const dockerCount = path.join(temp, "docker.count");
mkdirSync(bin);

try {
  testAbsent();
  testExisting();
  testWebImageExisting();
  testMigrationImageExisting();
  testGitHubProbeFailure();
  testGhcrProbeFailure();
  testMigrationProbeFailure();
  testInvalidInput();
  console.log("release identity probe selftest passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function installMocks(ghMode: string, dockerMode: string): void {
  rmSync(dockerCount, { force: true });
  writeExecutable("gh", `#!/usr/bin/env bash
case "${ghMode}" in
  absent) printf '%s\n' 'release not found' >&2; exit 1 ;;
  exists) printf '%s\n' '{"tagName":"v1.2.3"}'; exit 0 ;;
  *) printf '%s\n' 'HTTP 403: rate limit exceeded' >&2; exit 1 ;;
esac
`);
  writeExecutable("docker", `#!/usr/bin/env bash
count=0
[[ -f "${dockerCount}" ]] && count="$(<"${dockerCount}")"
count=$((count + 1))
printf '%s' "$count" > "${dockerCount}"
case "${dockerMode}:$count" in
  absent:*) printf '%s\n' 'manifest unknown' >&2; exit 1 ;;
  web-exists:1|migration-exists:2) printf '%s\n' 'Name: ghcr.io/areasong/example'; exit 0 ;;
  migration-failure:2|failure:*) printf '%s\n' 'unauthorized: authentication required' >&2; exit 1 ;;
  *) printf '%s\n' 'manifest unknown' >&2; exit 1 ;;
esac
`);
}

function run(overrides: Record<string, string> = {}) {
  return spawnSync("pnpm", ["exec", "tsx", "scripts/quality/release-identity-probe.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_RELEASE_REPOSITORY: "AreaSong/AreaForge",
      AREAFORGE_RELEASE_TAG: "v1.2.3",
      AREAFORGE_RELEASE_WEB_IMAGE: "ghcr.io/areasong/areaforge-web:v1.2.3",
      AREAFORGE_RELEASE_MIGRATION_IMAGE: "ghcr.io/areasong/areaforge-migration:v1.2.3",
      ...overrides,
    },
  });
}

function testAbsent(): void {
  installMocks("absent", "absent");
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "absent");
}

function testExisting(): void {
  installMocks("exists", "absent");
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RELEASE_IDENTITY_EXISTS/);
}

function testWebImageExisting(): void {
  installMocks("absent", "web-exists");
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RELEASE_IDENTITY_EXISTS/);
  assert.match(result.stderr, /areaforge-web/);
}

function testMigrationImageExisting(): void {
  installMocks("absent", "migration-exists");
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RELEASE_IDENTITY_EXISTS/);
  assert.match(result.stderr, /areaforge-migration/);
}

function testGitHubProbeFailure(): void {
  installMocks("failure", "absent");
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "GITHUB_RELEASE_PROBE_FAILED");
}

function testGhcrProbeFailure(): void {
  installMocks("absent", "failure");
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "GHCR_IMAGE_PROBE_FAILED");
}

function testMigrationProbeFailure(): void {
  installMocks("absent", "migration-failure");
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "GHCR_IMAGE_PROBE_FAILED");
}

function testInvalidInput(): void {
  installMocks("absent", "absent");
  const result = run({ AREAFORGE_RELEASE_TAG: "v1.2.3; echo unsafe" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "INVALID_RELEASE_IDENTITY_INPUT");
}

function writeExecutable(name: string, body: string): void {
  const file = path.join(bin, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}
