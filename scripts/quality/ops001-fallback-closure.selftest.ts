import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-ops001-fallback-finalizer-"));
const currentVersion = "0.1.7";

try {
  const fallbackDir = path.join(tempDir, "fallback");
  const outputDir = path.join(tempDir, "out");
  const manifest = path.join(tempDir, "areaforge-release-manifest.json");
  writeFixture(fallbackDir, []);
  writeFileSync(manifest, JSON.stringify(createReleaseManifest(), null, 2));

  const finalize = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-ops001-fallback-closure.ts", fallbackDir, outputDir], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_READINESS_RELEASE_MANIFEST_FILE: manifest,
      AREAFORGE_READINESS_BASE_URL: "",
      AREAFORGE_SMOKE_PASSWORD: "",
    },
  });
  expectStatus("finalize valid fallback directory", finalize, 0);
  const result = JSON.parse(finalize.stdout) as JsonRecord;
  if (result.status !== "ready_for_human_close") {
    fail(`expected ready_for_human_close, got ${String(result.status)}`);
  }
  const files = result.files as JsonRecord | undefined;
  for (const key of [
    "prodReadonlySmokeRecord",
    "redactedUpdateAgentStatus",
    "operationalEvidenceBundle",
    "ops001ClosurePacket",
    "ops001PreflightAfterClosure",
  ]) {
    if (typeof files?.[key] !== "string") {
      fail(`missing output file pointer: ${key}`);
    }
  }
  const safety = result.safetyFacts as JsonRecord | undefined;
  if (!safety || safety.serverCommandAttempted !== false || safety.productionWriteAttempted !== false || safety.secretValuePrinted !== false) {
    fail("finalizer safety facts must remain read-only and redacted");
  }

  const blockedDir = path.join(tempDir, "blocked");
  writeFixture(blockedDir, ["smoke password file missing"]);
  const blocked = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-ops001-fallback-closure.ts", blockedDir, path.join(tempDir, "blocked-out")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_READINESS_RELEASE_MANIFEST_FILE: manifest,
      AREAFORGE_READINESS_BASE_URL: "",
      AREAFORGE_SMOKE_PASSWORD: "",
    },
  });
  expectStatus("blocked fallback directory fails closed", blocked, 10);

  console.log("OPS-001 fallback local finalizer selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function writeFixture(fallbackDir: string, blockers: string[]): void {
  mkdirSync(fallbackDir, { recursive: true });
  writeFileSync(path.join(fallbackDir, "remote-prerequisites.json"), JSON.stringify({
    generatedAt: "2026-07-11T10:00:00Z",
    mode: "ops001-readonly-fallback-prerequisites",
    baseUrl: "https://forge.areasong.top",
    expectedVersion: currentVersion,
    expectedAutoApply: "none",
    extraSmokeCommandConfigured: "yes",
    smokeEmailConfigured: "yes",
    smokePasswordFileConfigured: "yes",
    smokePasswordFileReadable: "yes",
    smokePasswordFileMode: "600",
    hostPnpmAvailable: "no",
    blockers,
    safetyFacts: {
      configValuesRedacted: true,
      passwordValuePrinted: false,
      cookieValuePrinted: false,
      updaterApplyAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
    },
  }, null, 2));
  writeFileSync(path.join(fallbackDir, "remote-summary.txt"), [
    "generatedAt: 2026-07-11T10:00:00Z",
    "mode: ops001-readonly-fallback-export",
    `outputDir: ${fallbackDir}`,
    "redactedUpdateStatusRecord: redacted-update-status.json sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "remotePrerequisites: remote-prerequisites.json sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "prodReadonlySmokeOutput: prod-readonly-smoke-output.log sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "smokeStatus: pass",
    "doesNotProve: OPS-001 closure, operational evidence bundle readiness, production write smoke safety, residual closure, long-term operability",
    "forbiddenActions: updater apply, migration, backup, restore, rollback, Docker, Nginx, compose, database writes, upload writes, secret export, residual ledger closure",
    "redactedHandoffOwner: as",
    "redactedHandoffStatus: granted",
    "redactedHandoffScope: /tmp/areaforge-ops001-fallback-* only",
    "",
  ].join("\n"));
  writeFileSync(path.join(fallbackDir, "redacted-update-status.json"), JSON.stringify(createUpdateStatusRecord(), null, 2));
  writeFileSync(path.join(fallbackDir, "prod-readonly-smoke-output.log"), createSmokeOutput());
}

function createReleaseManifest(): JsonRecord {
  return {
    schemaVersion: 1,
    app: "AreaForge",
    version: currentVersion,
    webImageDigest: `ghcr.io/areasong/areaforge-web:v${currentVersion}@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    migrationImageDigest: `ghcr.io/areasong/areaforge-migration:v${currentVersion}@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
  };
}

function createUpdateStatusRecord(): JsonRecord {
  return {
    currentVersion,
    currentImage: `ghcr.io/areasong/areaforge-web:v${currentVersion}@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    releaseUrl: `https://github.com/AreaSong/AreaForge/releases/tag/v${currentVersion}`,
    latestVersion: currentVersion,
    updateAvailable: false,
    autoApply: "none",
    signatureRequired: true,
    timerEnabled: true,
    timerActive: true,
    lastCheckedAt: "2026-07-11T10:00:00Z",
    blocker: null,
    rollback: {
      available: true,
      targetVersion: "0.1.4",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.4@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    },
    statusUpdatedAt: "2026-07-11T10:00:00Z",
    safetyFacts: {
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      updaterApplyAttempted: false,
    },
  };
}

function createSmokeOutput(): string {
  return [
    "PASS health: ok (12ms)",
    "PASS login: ok (34ms)",
    JSON.stringify({
      ok: true,
      baseUrl: "https://forge.areasong.top",
      checkedAt: "2026-07-11T10:00:00Z",
      checks: [
        { name: "health", ok: true, durationMs: 12 },
        { name: "login", ok: true, durationMs: 34 },
        { name: "auth/me", ok: true, durationMs: 8 },
        { name: "dashboard", ok: true, durationMs: 9 },
        { name: "notes", ok: true, durationMs: 10 },
        { name: "syllabus", ok: true, durationMs: 10 },
        { name: "analytics", ok: true, durationMs: 11 },
        { name: "reports", ok: true, durationMs: 12 },
        { name: "long-term-risks", ok: true, durationMs: 13 },
        { name: "update-status", ok: true, durationMs: 14 },
      ],
    }),
    "",
  ].join("\n");
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected exit ${expected}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}
