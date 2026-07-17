import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { prepareRealFlockCommand } from "./portable-flock-fixture";

const root = process.cwd();
const updater = path.join(root, "ops/github-release-updater/areaforge-updater.sh");
const webDigest = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;

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
    testUnsafeReleaseIdRejected(fixture);
    testSharedLockBlocksMutation(fixture);
    testInheritedLockBinding(fixture);
    testLockInodeReplacementFailsClosed(fixture);
    testGuardedApply(fixture);
    testGuardExpiryAtFirstComparison(fixture);
    testGuardExpiryAtSecondComparison(fixture);
    testLegacyMutationRejected(fixture);
    testExpectedBeforeMismatchHasNoMutation(fixture);
    testTargetMismatchHasNoMutation(fixture);
    testTargetVersionNotNewerHasNoMutation(fixture);
    testRequestTagMismatchEmitsStructuredRejection(fixture);
    testFloatingRollbackTargetRejected(fixture);
    testNonAsciiCurrentImageRejected(fixture);
    testCurrentImageVersionMismatchRejected(fixture);
    testSecondComparisonCatchesDrift(fixture);
    testInvalidManifestIdentityRejected(fixture);
    testAutoRunReloadsPolicyAfterLock(fixture);
    testAutoRunDeletedPolicyFallsBackAfterLock(fixture);
    testDeletedSignaturePolicyFailsClosedAfterLock(fixture);
    testLatestRollbackRecordUsesUpdatedAt();
    testMismatchedRollbackRecordIsUnavailable();
    testHealthSmokeFailureReturns();
    testRollbackRestoresComposeBackup();
    testApplyRecoveryUncertainExitContract();
    testFinalRecordFailureExitContract();
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
    "AREAFORGE_PRODUCTION_STATE_LOCK_INHERITED=0",
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
  prepareRealFlockCommand(path.join(bin, "flock"));
  writeExecutable(path.join(bin, "mv"), `#!/usr/bin/env bash
/bin/mv "$@"
destination="\${!#}"
if [[ -n "\${TEST_SLEEP_AFTER_IDENTITY:-}" && "$destination" == "$TEST_SLEEP_AFTER_IDENTITY" ]]; then
  /bin/sleep "\${TEST_SLEEP_SECONDS:-2}"
fi
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
  reset(fixture);
  const lockFile = path.join(fixture.deployDir, ".areaforge-production-state.lock");
  const readyFile = path.join(fixture.root, "lock-ready");
  const realFlock = prepareRealFlockCommand(path.join(fixture.bin, "flock"));
  rmSync(readyFile, { force: true });
  const holder = spawn(realFlock, [lockFile, "bash", "-c", `printf ready > '${readyFile}'; sleep 5`], {
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

function testInheritedLockBinding(fixture: Fixture): void {
  reset(fixture);
  const lockFile = path.join(fixture.deployDir, ".areaforge-production-state.lock");
  const guard = writeGuard(fixture);
  const accepted = updaterRunWithInheritedLock(
    fixture,
    lockFile,
    ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard],
  );
  expect(accepted.status === 0, `matching inherited lock was not reused: ${accepted.stderr}`);

  reset(fixture);
  const rejected = updaterRunWithInheritedLock(
    fixture,
    path.join(fixture.root, "different-production-state.lock"),
    ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard],
  );
  expect(rejected.status !== 0 && rejected.stderr.includes("inherited production-state lock path mismatch"), "mismatched inherited lock path did not fail closed");
  expect(!readFileSync(fixture.logFile, "utf8").includes("curl"), "inherited lock mismatch reached release download");
}

function testLockInodeReplacementFailsClosed(fixture: Fixture): void {
  reset(fixture);
  const lockFile = path.join(fixture.deployDir, ".areaforge-production-state.lock");
  const flockPath = path.join(fixture.bin, "flock");
  const realFlock = prepareRealFlockCommand(path.join(fixture.bin, "real-flock"));
  try {
    writeExecutable(flockPath, `#!/usr/bin/env bash
"$TEST_REAL_FLOCK" "$@"
status=$?
if [[ "$status" == "0" && "$1" == "-n" && "\${2:-}" == "8" ]]; then
  /bin/rm -f "$TEST_LOCK_FILE"
  : > "$TEST_LOCK_FILE"
  chmod 600 "$TEST_LOCK_FILE"
fi
exit "$status"
`);
    const guard = writeGuard(fixture);
    const result = updaterRun(
      fixture,
      ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard],
      { TEST_LOCK_FILE: lockFile, TEST_REAL_FLOCK: realFlock },
    );
    expect(result.status !== 0 && result.stderr.includes("production-state lock inode changed while held"), "same-path production lock inode replacement did not fail closed");
    expect(!readFileSync(fixture.logFile, "utf8").includes("curl"), "lock inode replacement reached release download");
  } finally {
    rmSync(flockPath, { force: true });
    prepareRealFlockCommand(flockPath);
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

function testUnsafeReleaseIdRejected(fixture: Fixture): void {
  reset(fixture);
  const releasePath = path.join(fixture.root, "assets", "release.json");
  const original = readFileSync(releasePath, "utf8");
  try {
    const release = JSON.parse(original) as Record<string, unknown>;
    writeFileSync(releasePath, JSON.stringify({ ...release, id: 9_007_199_254_740_992 }));
    const result = updaterRun(fixture, ["check", "--config", fixture.config, "--identity-json", fixture.identityFile]);
    expect(result.status !== 0 && result.stderr.includes("positive safe integer"), "unsafe GitHub release ids must fail the shared Node/JQ canonical integer boundary");
  } finally {
    writeFileSync(releasePath, original);
  }
}

function testGuardedApply(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture);
  const result = updaterRun(fixture, ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status === 0, `guarded dry-run apply failed: ${result.stderr}`);
  expect((result.stderr.match(/AREAFORGE_REQUEST_GUARD phase=(first|second) result=pass/g) ?? []).length === 2, "guard was not compared twice");
  const expectedBeforeHash = (JSON.parse(readFileSync(guard, "utf8")) as { expectedBeforeHash: string }).expectedBeforeHash;
  const observedHashes = [...result.stderr.matchAll(/observedBeforeHash=(sha256:[a-f0-9]{64})/g)].map((match) => match[1]);
  expect(observedHashes.length === 2 && observedHashes.every((value) => value === expectedBeforeHash), "guard markers must use the domain-separated expected-before hash");
  const lockFile = path.join(fixture.deployDir, ".areaforge-production-state.lock");
  expect(exists(lockFile), "guarded apply did not use the shared production-state lock");
  expect((statSync(lockFile).mode & 0o777) === 0o600, "shared production-state lock must be mode 0600");
}

function testGuardExpiryAtSecondComparison(fixture: Fixture): void {
  reset(fixture);
  const now = Date.now();
  const guard = writeGuard(fixture, {}, {}, {
    requestedAt: new Date(now - 26_000).toISOString(),
    expiresAt: new Date(now - 25_000).toISOString(),
  });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(
    fixture,
    ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard, "--identity-json", fixture.identityFile],
    { TEST_SLEEP_AFTER_IDENTITY: fixture.identityFile, TEST_SLEEP_SECONDS: "6" },
  );
  expect(result.status !== 0, "expired second guard unexpectedly succeeded");
  expect(result.stderr.includes("phase=second result=reject reasonCode=REQUEST_EXPIRED"), "second guard expiry did not emit a structured reject marker");
  expect(!result.stderr.includes("AREAFORGE_REQUEST_EXECUTION"), "second guard expiry crossed the execution boundary");
  expectNoMutation(fixture, before);
}

function testGuardExpiryAtFirstComparison(fixture: Fixture): void {
  reset(fixture);
  const now = Date.now();
  const guard = writeGuard(fixture, {}, {}, {
    requestedAt: new Date(now - 40_000).toISOString(),
    expiresAt: new Date(now - 35_000).toISOString(),
  });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0, "expired first guard unexpectedly succeeded");
  expect(result.stderr.includes("phase=first result=reject reasonCode=REQUEST_EXPIRED"), "first guard expiry did not emit a structured reject marker");
  expect(!result.stderr.includes("AREAFORGE_REQUEST_EXECUTION"), "first guard expiry crossed the execution boundary");
  expectNoMutation(fixture, before);
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
  const mismatches = [
    { currentVersion: "0.1.6" },
    { currentImage: `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"9".repeat(64)}` },
    { autoApply: "patch" },
    { signatureRequired: true },
    {
      rollbackTargetVersion: "0.1.6",
      rollbackTargetImage: `ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"8".repeat(64)}`,
      rollbackSourceRecordSha256: `sha256:${"7".repeat(64)}`,
    },
  ];
  for (const mismatch of mismatches) {
    reset(fixture);
    const guard = writeGuard(fixture, mismatch);
    const before = readFileSync(fixture.envFile, "utf8");
    const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
    expect(result.status !== 0 && result.stderr.includes("EXPECTED_BEFORE_MISMATCH"), `expected-before mismatch was not rejected: ${JSON.stringify(mismatch)}`);
    expectNoMutation(fixture, before);
  }
}

function testTargetMismatchHasNoMutation(fixture: Fixture): void {
  const mismatches = [
    { releaseId: 180019 },
    { manifestSha256: `sha256:${"e".repeat(64)}` },
    { manifestVersion: "0.1.9" },
    { webImageDigest: `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"f".repeat(64)}` },
  ];
  for (const mismatch of mismatches) {
    reset(fixture);
    const guard = writeGuard(fixture, {}, mismatch);
    const before = readFileSync(fixture.envFile, "utf8");
    const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
    expect(result.status !== 0 && result.stderr.includes("TARGET_IDENTITY_CHANGED"), `target mismatch was not rejected: ${JSON.stringify(mismatch)}`);
    expectNoMutation(fixture, before);
  }
}

function testTargetVersionNotNewerHasNoMutation(fixture: Fixture): void {
  reset(fixture);
  writeFileSync(fixture.envFile, readFileSync(fixture.envFile, "utf8")
    .replace(/^APP_VERSION=.*$/m, "APP_VERSION=0.1.8")
    .replace(/^AREAFORGE_IMAGE=.*$/m, `AREAFORGE_IMAGE=${webDigest}`));
  const guard = writeGuard(fixture, { currentVersion: "0.1.8", currentImage: webDigest });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0, "a target equal to the current version unexpectedly succeeded");
  expect(result.stderr.includes("phase=first result=reject reasonCode=TARGET_VERSION_NOT_NEWER"), "a non-newer target did not emit a structured zero-side-effect rejection");
  expect(!result.stderr.includes("AREAFORGE_REQUEST_EXECUTION"), "a non-newer target crossed the execution boundary");
  expectNoMutation(fixture, before);
}

function testRequestTagMismatchEmitsStructuredRejection(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture, {}, {}, {}, { tag: "v0.1.9" });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0, "request tag mismatch unexpectedly succeeded");
  expect(result.stderr.includes("phase=first result=reject reasonCode=TARGET_IDENTITY_CHANGED"), "request tag mismatch did not emit a structured zero-side-effect rejection");
  expect(result.stderr.includes("executionAttempted=false"), "request tag mismatch did not declare executionAttempted=false");
  expect(!result.stderr.includes("AREAFORGE_REQUEST_EXECUTION"), "request tag mismatch crossed the execution boundary");
  expectNoMutation(fixture, before);
}

function testFloatingRollbackTargetRejected(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture, {
    rollbackTargetVersion: "0.1.6",
    rollbackTargetImage: "ghcr.io/areasong/areaforge-web:latest",
    rollbackSourceRecordSha256: `sha256:${"9".repeat(64)}`,
  });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0 && result.stderr.includes("INVALID_REQUEST_SCHEMA"), "floating rollback target image must fail strict request-guard validation");
  expectNoMutation(fixture, before);
}

function testNonAsciiCurrentImageRejected(fixture: Fixture): void {
  reset(fixture);
  const guard = writeGuard(fixture, {
    currentImage: `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}-\u955c\u50cf`,
  });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0 && result.stderr.includes("INVALID_REQUEST_SCHEMA"), "non-ASCII current image must fail canonical request-guard validation");
  expectNoMutation(fixture, before);
}

function testCurrentImageVersionMismatchRejected(fixture: Fixture): void {
  reset(fixture);
  const mismatchedImage = `ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"a".repeat(64)}`;
  writeFileSync(fixture.envFile, readFileSync(fixture.envFile, "utf8").replace(/^AREAFORGE_IMAGE=.*$/m, `AREAFORGE_IMAGE=${mismatchedImage}`));
  const guard = writeGuard(fixture, { currentImage: mismatchedImage });
  const before = readFileSync(fixture.envFile, "utf8");
  const result = updaterRun(fixture, ["apply", "--yes", "--dry-run", "--tag", "v0.1.8", "--config", fixture.config, "--request-guard", guard]);
  expect(result.status !== 0 && result.stderr.includes("CURRENT_IMAGE_IDENTITY_INVALID"), "current image tag/version mismatch must fail closed with structured guard evidence");
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

function testInvalidManifestIdentityRejected(fixture: Fixture): void {
  const manifestPath = path.join(fixture.root, "assets", "areaforge-release-manifest.json");
  const sumsPath = path.join(fixture.root, "assets", "SHA256SUMS");
  const originalManifest = readFileSync(manifestPath, "utf8");
  const originalSums = readFileSync(sumsPath, "utf8");
  const original = JSON.parse(originalManifest) as Record<string, unknown>;
  const cases = [
    { override: { version: "release-0.1.8" }, error: "manifest version must be semver" }, // gitleaks:allow - synthetic invalid manifest fixture
    { override: { version: "0.1.9" }, error: "release tag must match manifest version" },
    {
      override: {
        webImage: "ghcr.io/areasong/areaforge-web:v0.1.9",
        webImageDigest: `ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}`,
      },
      error: "web image tag must match manifest version",
    },
    { override: { webImageDigest: `ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}` }, error: "webImageDigest reference must match webImage" },
    { override: { webImageDigest: `registry.example/areaforge:v0.1.8@sha256:${"b".repeat(64)}` }, error: "tagged GHCR" },
  ];
  try {
    for (const testCase of cases) {
      const content = `${JSON.stringify({ ...original, ...testCase.override })}\n`;
      writeFileSync(manifestPath, content);
      writeFileSync(sumsPath, originalSums.replace(/^[a-f0-9]{64}  areaforge-release-manifest\.json/m, `${sha256(Buffer.from(content))}  areaforge-release-manifest.json`));
      reset(fixture);
      const result = updaterRun(fixture, ["check", "--config", fixture.config]);
      expect(result.status !== 0 && result.stderr.includes(testCase.error), `invalid manifest identity was accepted: ${JSON.stringify(testCase.override)}`);
    }
  } finally {
    writeFileSync(manifestPath, originalManifest);
    writeFileSync(sumsPath, originalSums);
  }
}

function testAutoRunReloadsPolicyAfterLock(fixture: Fixture): void {
  reset(fixture);
  const originalConfig = readFileSync(fixture.config, "utf8");
  const flockPath = path.join(fixture.bin, "flock");
  const realFlock = prepareRealFlockCommand(path.join(fixture.bin, "real-flock"));
  try {
    writeFileSync(fixture.config, originalConfig.replace("AREAFORGE_AUTO_APPLY=none", "AREAFORGE_AUTO_APPLY=patch"));
    writeExecutable(flockPath, `#!/usr/bin/env bash
/usr/bin/sed -i.bak 's/^AREAFORGE_AUTO_APPLY=.*/AREAFORGE_AUTO_APPLY=none/' "$TEST_CONFIG_FILE"
/bin/rm -f "$TEST_CONFIG_FILE.bak"
exec "$TEST_REAL_FLOCK" "$@"
`);
    const result = updaterRun(fixture, ["run", "--dry-run", "--config", fixture.config], {
      TEST_CONFIG_FILE: fixture.config,
      TEST_REAL_FLOCK: realFlock,
    });
    expect(result.status === 0, `auto-run policy reload fixture failed: ${result.stderr}`);
    expect(result.stderr.includes("auto-apply policy did not allow applying this release"), "run must use the policy reloaded after acquiring the shared lock");
    expect(!result.stderr.includes("AREAFORGE_REQUEST_EXECUTION"), "stale pre-lock patch policy must not reach update execution");
  } finally {
    writeFileSync(fixture.config, originalConfig);
    rmSync(flockPath, { force: true });
    prepareRealFlockCommand(flockPath);
  }
}

function testAutoRunDeletedPolicyFallsBackAfterLock(fixture: Fixture): void {
  reset(fixture);
  const originalConfig = readFileSync(fixture.config, "utf8");
  const flockPath = path.join(fixture.bin, "flock");
  const realFlock = prepareRealFlockCommand(path.join(fixture.bin, "real-flock"));
  try {
    writeFileSync(fixture.config, originalConfig.replace("AREAFORGE_AUTO_APPLY=none", "AREAFORGE_AUTO_APPLY=patch"));
    writeExecutable(flockPath, `#!/usr/bin/env bash
/usr/bin/sed -i.bak '/^AREAFORGE_AUTO_APPLY=/d' "$TEST_CONFIG_FILE"
/bin/rm -f "$TEST_CONFIG_FILE.bak"
exec "$TEST_REAL_FLOCK" "$@"
`);
    const result = updaterRun(fixture, ["run", "--dry-run", "--config", fixture.config], {
      AREAFORGE_AUTO_APPLY: "",
      TEST_CONFIG_FILE: fixture.config,
      TEST_REAL_FLOCK: realFlock,
    });
    expect(result.status === 0, `deleted auto-run policy fixture failed: ${result.stderr}`);
    expect(result.stderr.includes("auto-apply policy did not allow applying this release"), "deleted auto-apply policy must fall back to none after the lock");
    expect(!result.stderr.includes("AREAFORGE_REQUEST_EXECUTION"), "deleted pre-lock patch policy must not reach update execution");
  } finally {
    writeFileSync(fixture.config, originalConfig);
    rmSync(flockPath, { force: true });
    prepareRealFlockCommand(flockPath);
  }
}

function testDeletedSignaturePolicyFailsClosedAfterLock(fixture: Fixture): void {
  reset(fixture);
  const originalConfig = readFileSync(fixture.config, "utf8");
  const flockPath = path.join(fixture.bin, "flock");
  const realFlock = prepareRealFlockCommand(path.join(fixture.bin, "real-flock"));
  try {
    writeExecutable(flockPath, `#!/usr/bin/env bash
/usr/bin/sed -i.bak '/^AREAFORGE_REQUIRE_SIGNATURE=/d' "$TEST_CONFIG_FILE"
/bin/rm -f "$TEST_CONFIG_FILE.bak"
exec "$TEST_REAL_FLOCK" "$@"
`);
    const result = updaterRun(fixture, ["run", "--dry-run", "--config", fixture.config], {
      AREAFORGE_REQUIRE_SIGNATURE: "",
      TEST_CONFIG_FILE: fixture.config,
      TEST_REAL_FLOCK: realFlock,
    });
    expect(result.status !== 0 && result.stderr.includes("signature asset is required but missing"), "deleted signature policy must restore the secure default and fail closed");
    expect(!result.stderr.includes("AREAFORGE_REQUEST_EXECUTION"), "deleted signature policy must stop before update execution");
  } finally {
    writeFileSync(fixture.config, originalConfig);
    rmSync(flockPath, { force: true });
    prepareRealFlockCommand(flockPath);
  }
}

function testLatestRollbackRecordUsesUpdatedAt(): void {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "areaforge-updater-record-order-"));
  const records = path.join(fixtureRoot, "records");
  const older = path.join(records, "github-0.1.9-older", "update-record.txt");
  const newer = path.join(records, "github-0.1.10-newer", "update-record.txt");
  run("mkdir", ["-p", path.dirname(older), path.dirname(newer)]);
  writeFileSync(older, `updatedAt: 2027-01-15T08:00:00Z\npreviousAppVersion: 0.1.8\npreviousImage: ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"8".repeat(64)}\n`);
  writeFileSync(newer, `updatedAt: 2027-01-16T08:00:00Z\npreviousAppVersion: 0.1.9\npreviousImage: ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"9".repeat(64)}\n`);
  try {
    const script = [
      "export AREAFORGE_UPDATER_NO_MAIN=1",
      'updater_path="$1"',
      'records="$2"',
      "set --",
      '. "$updater_path"',
      'AREAFORGE_UPDATE_RECORD_DIR="$records"',
      "rollback_snapshot_json",
    ].join("\n");
    const result = spawnSync("bash", ["-c", script, "selftest", updater, records], { cwd: root, encoding: "utf8" });
    expect(result.status === 0, `rollback record ordering fixture failed: ${result.stderr}`);
    const rollback = JSON.parse(result.stdout) as { targetVersion?: string };
    expect(rollback.targetVersion === "0.1.9", "updater rollback snapshot must select the newest updatedAt record, not lexical version order");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function testMismatchedRollbackRecordIsUnavailable(): void {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "areaforge-updater-record-mismatch-"));
  const records = path.join(fixtureRoot, "records");
  const record = path.join(records, "github-0.1.8-mismatch", "update-record.txt");
  run("mkdir", ["-p", path.dirname(record)]);
  writeFileSync(record, `updatedAt: 2027-01-16T08:00:00Z\npreviousAppVersion: 0.1.6\npreviousImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:${"9".repeat(64)}\n`);
  try {
    const script = [
      "export AREAFORGE_UPDATER_NO_MAIN=1",
      'updater_path="$1"',
      'records="$2"',
      "set --",
      '. "$updater_path"',
      'AREAFORGE_UPDATE_RECORD_DIR="$records"',
      "rollback_snapshot_json",
    ].join("\n");
    const result = spawnSync("bash", ["-c", script, "selftest", updater, records], { cwd: root, encoding: "utf8" });
    expect(result.status === 0, `rollback record mismatch fixture failed: ${result.stderr}`);
    const rollback = JSON.parse(result.stdout) as { targetVersion?: string | null; targetImage?: string | null };
    expect(rollback.targetVersion === null && rollback.targetImage === null, "rollback image tag/version mismatch must remain unavailable");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function testHealthSmokeFailureReturns(): void {
  const script = [
    "export AREAFORGE_UPDATER_NO_MAIN=1",
    'updater_path="$1"',
    "set --",
    '. "$updater_path"',
    "DRY_RUN=0",
    'HEALTH_URL="https://fixture.invalid/api/health"',
    'RECORD_DIR="$(mktemp -d)"',
    'mkdir -p "$RECORD_DIR/logs"',
    "AREAFORGE_EXTRA_SMOKE_COMMAND=",
    "seq() { printf '1\\n'; }",
    "sleep() { :; }",
    "curl() { return 1; }",
    "set +e",
    "run_smoke",
    'printf "after-smoke status=%s\\n" "$?"',
  ].join("\n");
  const result = spawnSync("bash", ["-c", script, "selftest", updater], { cwd: root, encoding: "utf8" });
  expect(result.status === 0, `health smoke return fixture exited early: ${result.stderr}`);
  expect(result.stdout.includes("after-smoke status=1"), "health smoke failure must return to apply_update so automatic rollback can run");
}

function testRollbackRestoresComposeBackup(): void {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "areaforge-updater-compose-rollback-"));
  const recordDir = path.join(fixtureRoot, "record");
  const backup = path.join(recordDir, "config", "docker-compose.prod.yml");
  const compose = path.join(fixtureRoot, "docker-compose.prod.yml");
  run("mkdir", ["-p", path.dirname(backup)]);
  writeFileSync(backup, "services:\n  web:\n    image: previous\n");
  writeFileSync(compose, "services:\n  web:\n    image: failed-target\n");
  try {
    const script = [
      "export AREAFORGE_UPDATER_NO_MAIN=1",
      'updater_path="$1"',
      'record_dir="$2"',
      'compose_file="$3"',
      "set --",
      '. "$updater_path"',
      "DRY_RUN=0",
      "AREAFORGE_ALLOW_COMPOSE_UPDATE=true",
      "COMPOSE_ASSET_PATH=verified-compose-asset",
      'RECORD_DIR="$record_dir"',
      'AREAFORGE_COMPOSE_FILE="$compose_file"',
      "CURRENT_IMAGE=fixture-image",
      "CURRENT_VERSION=0.1.7",
      "env_set() { :; }",
      "compose() { :; }",
      "fsync_path() { :; }",
      "rollback_application",
    ].join("\n");
    const result = spawnSync("bash", ["-c", script, "selftest", updater, recordDir, compose], { cwd: root, encoding: "utf8" });
    expect(result.status === 0, `compose rollback fixture failed: ${result.stderr}`);
    expect(readFileSync(compose, "utf8") === readFileSync(backup, "utf8"), "application rollback must restore the backed-up compose file when compose updates are enabled");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function testApplyRecoveryUncertainExitContract(): void {
  const script = [
    "export AREAFORGE_UPDATER_NO_MAIN=1",
    'updater_path="$1"',
    "set --",
    '. "$updater_path"',
    "COMMAND=apply",
    "YES=1",
    "DRY_RUN=0",
    "FORCE=0",
    "CURRENT_VERSION=0.1.7",
    `CURRENT_IMAGE=ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`,
    "TARGET_VERSION=0.1.8",
    "require_production_state_lock() { :; }",
    "version_gt() { return 0; }",
    "validate_request_guard() { :; }",
    "backup_before_update() { :; }",
    "pull_images() { return 1; }",
    "rollback_application() { return 1; }",
    `write_record() { printf 'record-status=%s failure=%s\\n' "$1" "$2"; [[ "\${TEST_RECORD_FAIL:-0}" != "1" ]]; }`,
    "set +e",
    "apply_update",
    "status=$?",
    `printf 'exit-status=%s\\n' "$status"`,
    "exit 0",
  ].join("\n");
  const result = spawnSync("bash", ["-c", script, "selftest", updater], { cwd: root, encoding: "utf8" });
  expect(result.status === 0, `recovery-uncertain contract fixture failed: ${result.stderr}`);
  expect(result.stdout.includes("record-status=recovery_uncertain"), "updater must record recovery_uncertain when automatic rollback cannot be confirmed");
  expect(result.stdout.includes("exit-status=2"), "updater must return the dedicated recovery-uncertain status");
  const failedRecord = spawnSync("bash", ["-c", script, "selftest", updater], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TEST_RECORD_FAIL: "1" },
  });
  expect(failedRecord.status === 0, `recovery-uncertain record failure fixture failed: ${failedRecord.stderr}`);
  expect(failedRecord.stdout.includes("exit-status=2"), "record persistence failure must not downgrade the recovery-uncertain exit status");
}

function testFinalRecordFailureExitContract(): void {
  const appliedScript = [
    "export AREAFORGE_UPDATER_NO_MAIN=1",
    'updater_path="$1"',
    "set --",
    '. "$updater_path"',
    "COMMAND=apply",
    "YES=1",
    "DRY_RUN=0",
    "FORCE=0",
    "CURRENT_VERSION=0.1.7",
    `CURRENT_IMAGE=ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`,
    "TARGET_VERSION=0.1.8",
    "require_production_state_lock() { :; }",
    "version_gt() { return 0; }",
    "validate_request_guard() { :; }",
    "backup_before_update() { :; }",
    "pull_images() { return 0; }",
    "maybe_update_compose_file() { return 0; }",
    "run_migration_if_needed() { return 0; }",
    "switch_web() { return 0; }",
    "run_smoke() { return 0; }",
    "write_record() { return 1; }",
    "set +e",
    "apply_update",
    "status=$?",
    `printf 'exit-status=%s\n' "$status"`,
    "exit 0",
  ].join("\n");
  const result = spawnSync("bash", ["-c", appliedScript, "selftest", updater], { cwd: root, encoding: "utf8" });
  expect(result.status === 0, `final record failure fixture failed: ${result.stderr}`);
  expect(result.stdout.includes("exit-status=2"), "applied record persistence failure must return the reconciliation status");
  expect(result.stderr.includes("reasonCode=APPLIED_RECORD_PERSISTENCE_UNCERTAIN"), "applied record persistence failure must emit an explicit reconciliation marker");

  const rolledBackScript = appliedScript
    .replace("pull_images() { return 0; }", "pull_images() { return 1; }")
    .replace("switch_web() { return 0; }", "switch_web() { return 0; }\nrollback_application() { return 0; }");
  const rolledBack = spawnSync("bash", ["-c", rolledBackScript, "selftest", updater], { cwd: root, encoding: "utf8" });
  expect(rolledBack.status === 0, `rolled-back record failure fixture failed: ${rolledBack.stderr}`);
  expect(rolledBack.stdout.includes("exit-status=2"), "rolled-back record persistence failure must return the reconciliation status");
  expect(rolledBack.stderr.includes("reasonCode=ROLLBACK_RECORD_PERSISTENCE_UNCERTAIN"), "rolled-back record persistence failure must emit an explicit reconciliation marker");
}

function writeGuard(
  fixture: Fixture,
  expectedOverride: Record<string, unknown> = {},
  targetOverride: Record<string, unknown> = {},
  timingOverride: { requestedAt?: string; expiresAt?: string } = {},
  paramsOverride: { tag?: string } = {},
): string {
  const requestedAt = timingOverride.requestedAt ?? new Date(Date.now() - 5_000).toISOString();
  const expiresAt = timingOverride.expiresAt ?? new Date(Date.now() + 295_000).toISOString();
  const expectedBefore = {
    currentVersion: "0.1.7",
    currentImage: `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`,
    autoApply: "none",
    signatureRequired: false,
    rollbackAvailable: false,
    rollbackTargetVersion: null,
    rollbackTargetImage: null,
    rollbackSourceRecordSha256: null,
    ...expectedOverride,
  };
  if (!("rollbackAvailable" in expectedOverride)) {
    expectedBefore.rollbackAvailable = expectedBefore.rollbackTargetVersion !== null
      && expectedBefore.rollbackTargetImage !== null
      && expectedBefore.rollbackSourceRecordSha256 !== null;
  }
  const target = {
    releaseId: 180018,
    manifestSha256: `sha256:${fixture.manifestSha256}`,
    manifestVersion: "0.1.8",
    webImageDigest: webDigest,
    ...targetOverride,
  };
  const params = { tag: paramsOverride.tag ?? "v0.1.8", autoApply: null };
  const expectedBeforeHash = hashCanonical({ domain: "areaforge.update-request.expected-before.v2", expectedBefore });
  const semanticHash = hashCanonical({ domain: "areaforge.update-request.semantic.v2", action: "apply", params, target, expectedBefore });
  const immutable = {
    domain: "areaforge.update-request.v2",
    schemaVersion: 2,
    id: "update_1800000000_123e4567-e89b-42d3-a456-426614174000",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174001",
    action: "apply",
    status: "queued",
    requestedAt,
    expiresAt,
    actorEmailHash: "d".repeat(64),
    params,
    target,
    expectedBefore,
    expectedBeforeHash,
    semanticHash,
  };
  const request = { schemaVersion: 2, id: immutable.id, action: "apply", status: immutable.status, requestedAt, expiresAt, actorEmailHash: immutable.actorEmailHash, idempotencyKey: immutable.idempotencyKey, params, target, expectedBefore, expectedBeforeHash, semanticHash, requestHash: hashCanonical(immutable) };
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

function updaterRunWithInheritedLock(fixture: Fixture, inheritedPath: string, args: string[]) {
  const lockFile = path.join(fixture.deployDir, ".areaforge-production-state.lock");
  const script = [
    'lock_file="$1"',
    'inherited_path="$2"',
    'updater_path="$3"',
    "shift 3",
    'exec 8>"$lock_file"',
    "flock -n 8",
    'AREAFORGE_PRODUCTION_STATE_LOCK_INHERITED=1 AREAFORGE_INHERITED_PRODUCTION_STATE_LOCK_FILE="$inherited_path" bash "$updater_path" "$@"',
  ].join("\n");
  return spawnSync("bash", ["-c", script, "selftest", lockFile, inheritedPath, updater, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
      TEST_ASSETS: path.join(fixture.root, "assets"),
      TEST_LOG: fixture.logFile,
      TEST_ENV_FILE: fixture.envFile,
    },
  });
}

function reset(fixture: Fixture): void {
  writeFileSync(fixture.logFile, "");
  rmSync(fixture.identityFile, { force: true });
  rmSync(path.join(fixture.deployDir, ".areaforge-production-state.lock"), { force: true });
  writeFileSync(fixture.envFile, readFileSync(fixture.envFile, "utf8")
    .replace(/^APP_VERSION=.*$/m, "APP_VERSION=0.1.7")
    .replace(/^AREAFORGE_IMAGE=.*$/m, `AREAFORGE_IMAGE=ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`));
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
