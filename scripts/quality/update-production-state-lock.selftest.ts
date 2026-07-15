import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const updater = path.join(root, "ops/github-release-updater/areaforge-updater.sh");
const webDigest = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;
const hasSystemFlock = spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;

interface Fixture {
  root: string;
  bin: string;
  config: string;
  envFile: string;
  deployDir: string;
  logFile: string;
  identityFile: string;
  manifestSha256: string;
}

function main(): void {
  const fixture = createFixture();
  try {
    testOrdinaryCheckIsLockFree(fixture);
    testVerifiedIdentity(fixture);
    testSharedLockBlocksMutation(fixture);
    testGuardedApply(fixture);
    testLegacyMutationRejected(fixture);
    testExpectedBeforeMismatchHasNoMutation(fixture);
    testTargetMismatchHasNoMutation(fixture);
    testSecondComparisonCatchesDrift(fixture);
    console.log("update production-state lock selftest passed.");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function createFixture(): Fixture {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "areaforge-updater-selftest-"));
  const bin = path.join(fixtureRoot, "bin");
  const assets = path.join(fixtureRoot, "assets");
  const deployDir = path.join(fixtureRoot, "deploy");
  const records = path.join(fixtureRoot, "records");
  const backups = path.join(fixtureRoot, "backups");
  const logFile = path.join(fixtureRoot, "commands.log");
  const envFile = path.join(deployDir, ".env.production");
  const composeFile = path.join(deployDir, "docker-compose.prod.yml");
  const config = path.join(fixtureRoot, "updater.env");
  const identityFile = path.join(fixtureRoot, "identity.json");

  run("mkdir", ["-p", bin, assets, deployDir, records, backups]);
  writeFileSync(logFile, "");
  writeFileSync(envFile, [
    "POSTGRES_DB=areaforge",
    "POSTGRES_USER=areaforge",
    "POSTGRES_PASSWORD=fixture-only",
    "WEB_PORT=3000",
    "APP_VERSION=0.1.7",
    `AREAFORGE_IMAGE=ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`,
    "",
  ].join("\n"));
  writeFileSync(composeFile, "services: {}\n");

  const manifest = {
    schemaVersion: 1,
    app: "AreaForge",
    version: "0.1.8",
    channel: "stable",
    gitCommit: "c".repeat(40),
    minimumAppVersion: "0.1.0",
    webImage: "ghcr.io/areasong/areaforge-web:v0.1.8",
    webImageDigest: webDigest,
    requiresMigration: false,
    migrationImage: null,
    migrationImageDigest: null,
    composeAsset: null,
    sbomAsset: "areaforge-sbom.spdx.json",
    provenanceAsset: "areaforge-provenance.json",
    autoApply: { patch: true, minor: false, major: false },
    releaseNotesUrl: "https://example.test/releases/v0.1.8",
  };
  const manifestPath = path.join(assets, "areaforge-release-manifest.json");
  const sbomPath = path.join(assets, "areaforge-sbom.spdx.json");
  const provenancePath = path.join(assets, "areaforge-provenance.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  writeFileSync(sbomPath, "fixture sbom\n");
  writeFileSync(provenancePath, "fixture provenance\n");
  const manifestSha256 = sha256(readFileSync(manifestPath));
  writeFileSync(path.join(assets, "SHA256SUMS"), [
    `${manifestSha256}  areaforge-release-manifest.json`,
    `${sha256(readFileSync(sbomPath))}  areaforge-sbom.spdx.json`,
    `${sha256(readFileSync(provenancePath))}  areaforge-provenance.json`,
    "",
  ].join("\n"));
  writeFileSync(path.join(assets, "release.json"), JSON.stringify({
    id: 180018,
    tag_name: "v0.1.8",
    draft: false,
    prerelease: false,
    assets: [
      asset("areaforge-release-manifest.json", 1),
      asset("SHA256SUMS", 2),
      asset("areaforge-sbom.spdx.json", 3),
      asset("areaforge-provenance.json", 4),
    ],
  }));

  writeFileSync(config, [
    "AREAFORGE_GITHUB_REPO=AreaSong/AreaForge",
    `AREAFORGE_DEPLOY_DIR=${deployDir}`,
    `AREAFORGE_ENV_FILE=${envFile}`,
    `AREAFORGE_COMPOSE_FILE=${composeFile}`,
    `AREAFORGE_BACKUP_DIR=${backups}`,
    `AREAFORGE_UPDATE_RECORD_DIR=${records}`,
    `AREAFORGE_PRODUCTION_STATE_LOCK_FILE=${path.join(deployDir, ".areaforge-production-state.lock")}`,
    "AREAFORGE_AUTO_APPLY=none",
    "AREAFORGE_REQUIRE_SIGNATURE=false",
    "",
  ].join("\n"));

  writeExecutable(path.join(bin, "curl"), `#!/usr/bin/env bash
set -eu
printf 'curl\\n' >> "$TEST_LOG"
output=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -H) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
if [[ "$url" == fixture://* ]]; then
  cp "$TEST_ASSETS/\${url#fixture://}" "$output"
else
  cat "$TEST_ASSETS/release.json"
fi
`);
  writeExecutable(path.join(bin, "docker"), `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$TEST_LOG"
exit 0
`);
  if (!hasSystemFlock) {
    writeExecutable(path.join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  }
  writeExecutable(path.join(bin, "mv"), `#!/usr/bin/env bash
/bin/mv "$@"
destination="\${!#}"
if [[ -n "\${TEST_MUTATE_AFTER_IDENTITY:-}" && "$destination" == "$TEST_MUTATE_AFTER_IDENTITY" ]]; then
  /usr/bin/sed -i.bak 's/^APP_VERSION=.*/APP_VERSION=0.1.6/' "$TEST_ENV_FILE"
  /bin/rm -f "$TEST_ENV_FILE.bak"
fi
`);

  return { root: fixtureRoot, bin, config, envFile, deployDir, logFile, identityFile, manifestSha256 };
}

function asset(name: string, id: number): Record<string, unknown> {
  return { id, name, url: `fixture://${name}` };
}

function testOrdinaryCheckIsLockFree(fixture: Fixture): void {
  reset(fixture);
  const result = updaterRun(fixture, ["check", "--config", fixture.config]);
  expect(result.status === 0, `ordinary check failed: ${result.stderr}`);
  expect(!exists(path.join(fixture.deployDir, ".areaforge-production-state.lock")), "ordinary check created production lock file");
}

function testSharedLockBlocksMutation(fixture: Fixture): void {
  if (!hasSystemFlock) return;
  reset(fixture);
  const lockFile = path.join(fixture.deployDir, ".areaforge-production-state.lock");
  const readyFile = path.join(fixture.root, "lock-ready");
  rmSync(readyFile, { force: true });
  const holder = spawn("flock", [lockFile, "bash", "-c", `printf ready > '${readyFile}'; sleep 5`], {
    stdio: "ignore",
  });
  try {
    waitForFile(readyFile);
    const guard = writeGuard(fixture);
    const result = updaterRun(fixture, ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
    expect(result.status !== 0 && result.stderr.includes("another production-state mutation is running"), "shared lock contention did not fail closed");
    expect(!readFileSync(fixture.logFile, "utf8").includes("curl"), "lock contention reached release download");
  } finally {
    holder.kill("SIGTERM");
  }
}

function testVerifiedIdentity(fixture: Fixture): void {
  reset(fixture);
  const result = updaterRun(fixture, ["check", "--config", fixture.config, "--identity-json", fixture.identityFile]);
  expect(result.status === 0, `identity check failed: ${result.stderr}`);
  const identity = JSON.parse(readFileSync(fixture.identityFile, "utf8")) as Record<string, unknown>;
  expect(JSON.stringify(Object.keys(identity).sort()) === JSON.stringify(["manifestSha256", "manifestVersion", "releaseId", "webImageDigest"]), "identity fields are not exact");
  expect(identity.releaseId === 180018, "identity releaseId mismatch");
  expect(identity.manifestSha256 === `sha256:${fixture.manifestSha256}`, "identity manifestSha256 mismatch");
  expect(identity.manifestVersion === "0.1.8", "identity manifestVersion mismatch");
  expect(identity.webImageDigest === webDigest, "identity webImageDigest mismatch");
}

function testGuardedApply(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture);
  const result = updaterRun(fixture, ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status === 0, `guarded dry-run apply failed: ${result.stderr}`);
  expect((result.stderr.match(/AREAFORGE_REQUEST_GUARD phase=(first|second) result=pass/g) ?? []).length === 2, "guard was not compared twice");
  expect(exists(path.join(fixture.deployDir, ".areaforge-production-state.lock")), "guarded apply did not use the shared production-state lock");
}

function testLegacyMutationRejected(fixture: Fixture): void {
  reset(fixture);
  const guard = path.join(fixture.root, "legacy.json");
  writeFileSync(guard, JSON.stringify({ schemaVersion: 1, action: "apply" }));
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0 && result.stderr.includes("LEGACY_MUTATION_UNBOUND"), "V1 mutation did not fail closed");
  expectNoMutation(fixture, before);
}

function testExpectedBeforeMismatchHasNoMutation(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture, { currentVersion: "0.1.6" });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0 && result.stderr.includes("EXPECTED_BEFORE_MISMATCH"), "expected-before mismatch was not rejected");
  expectNoMutation(fixture, before);
}

function testTargetMismatchHasNoMutation(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture, {}, { releaseId: 180019 });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0 && result.stderr.includes("TARGET_IDENTITY_CHANGED"), "target mismatch was not rejected");
  expectNoMutation(fixture, before);
}

function testSecondComparisonCatchesDrift(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture);
  const result = updaterRun(
    fixture,
    ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard, "--identity-json", fixture.identityFile],
    { TEST_MUTATE_AFTER_IDENTITY: fixture.identityFile },
  );
  expect(result.status !== 0 && result.stderr.includes("EXPECTED_BEFORE_MISMATCH: second comparison"), "second comparison did not catch live drift");
  expect(!readFileSync(fixture.logFile, "utf8").includes("docker"), "second comparison failure reached Docker");
}

function writeGuard(
  fixture: Fixture,
  expectedOverride: Record<string, unknown> = {},
  targetOverride: Record<string, unknown> = {},
): string {
  const requestedAt = new Date(Date.now() - 5_000).toISOString();
  const expiresAt = new Date(Date.now() + 295_000).toISOString();
  const expectedBefore = {
    currentVersion: "0.1.7",
    currentImage: `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`,
    autoApply: "none",
    signatureRequired: false,
    rollbackTargetVersion: null,
    rollbackTargetImage: null,
    rollbackSourceRecordSha256: null,
    ...expectedOverride,
  };
  const target = {
    releaseId: 180018,
    manifestSha256: `sha256:${fixture.manifestSha256}`,
    manifestVersion: "0.1.8",
    webImageDigest: webDigest,
    ...targetOverride,
  };
  const params = { tag: "v0.1.8", autoApply: null };
  const expectedBeforeHash = hashCanonical({ domain: "areaforge.update-request.expected-before.v2", expectedBefore });
  const semanticHash = hashCanonical({ domain: "areaforge.update-request.semantic.v2", action: "apply", params, target, expectedBefore });
  const immutable = {
    domain: "areaforge.update-request.v2",
    schemaVersion: 2,
    id: "update_1800000000_123e4567-e89b-42d3-a456-426614174000",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174001",
    action: "apply",
    requestedAt,
    expiresAt,
    actorEmailHash: "d".repeat(64),
    params,
    target,
    expectedBefore,
    expectedBeforeHash,
    semanticHash,
  };
  const request = { schemaVersion: 2, id: immutable.id, action: "apply", status: "queued", requestedAt, expiresAt, actorEmailHash: immutable.actorEmailHash, idempotencyKey: immutable.idempotencyKey, params, target, expectedBefore, expectedBeforeHash, semanticHash, requestHash: hashCanonical(immutable) };
  const guard = path.join(fixture.root, `guard-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(guard, `${JSON.stringify(request)}\n`);
  return guard;
}

function updaterRun(fixture: Fixture, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [updater, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
      TEST_ASSETS: path.join(fixture.root, "assets"),
      TEST_LOG: fixture.logFile,
      TEST_ENV_FILE: fixture.envFile,
      ...extraEnv,
    },
  });
}

function reset(fixture: Fixture): void {
  writeFileSync(fixture.logFile, "");
  rmSync(fixture.identityFile, { force: true });
  rmSync(path.join(fixture.deployDir, ".areaforge-production-state.lock"), { force: true });
  writeFileSync(fixture.envFile, readFileSync(fixture.envFile, "utf8").replace(/^APP_VERSION=.*$/m, "APP_VERSION=0.1.7"));
}

function expectNoMutation(fixture: Fixture, before: string): void {
  expect(readFileSync(fixture.envFile, "utf8") === before, "production env changed on rejection");
  expect(!readFileSync(fixture.logFile, "utf8").includes("docker"), "Docker was called on rejection");
  expect(!exists(path.join(fixture.root, "backups", "github-release-updates")), "backup directory was created on rejection");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashCanonical(value: unknown): string {
  return `sha256:${sha256(Buffer.from(stableStringify(value)))}`;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeExecutable(file: string, content: string): void {
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
}

function exists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

function waitForFile(file: string): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (exists(file)) return;
    Atomics.wait(sleeper, 0, 0, 50);
  }
  throw new Error("timed out waiting for shared lock holder");
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main();
