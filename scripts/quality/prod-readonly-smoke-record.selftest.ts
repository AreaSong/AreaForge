import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-prod-readonly-smoke-record-"));

try {
  const smokeOutput = path.join(tempDir, "smoke-output.log");
  const manifest = path.join(tempDir, "areaforge-release-manifest.json");
  const generatedRecord = path.join(tempDir, "prod-readonly-smoke-record.txt");

  writeFileSync(smokeOutput, createSmokeOutput());
  writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1,
    app: "AreaForge",
    version: "0.1.5",
    webImageDigest: "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    migrationImageDigest: "ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }));

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-prod-readonly-smoke-record.ts", smokeOutput], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_READINESS_ENVIRONMENT: "production",
      AREAFORGE_READINESS_EXPECTED_VERSION: "0.1.5",
      AREAFORGE_READINESS_RELEASE_TAG: "v0.1.5",
      AREAFORGE_READINESS_RELEASE_MANIFEST_FILE: manifest,
      AREAFORGE_SMOKE_PASSWORD_FILE: "/etc/areaforge/smoke-password",
      AREAFORGE_EXTRA_SMOKE_COMMAND: "cd /opt/areaforge && pnpm smoke:prod-readonly",
      AREAFORGE_UPDATE_RECORD_SUMMARY: "update-record hash sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
  });
  if (generated.status !== 0) {
    console.error("FAIL generated record command");
    console.error(generated.stdout.trim());
    console.error(generated.stderr.trim());
    process.exit(1);
  }

  writeFileSync(generatedRecord, generated.stdout);

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/prod-readonly-smoke-validate.ts", generatedRecord], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_SMOKE_PROOF_NOW: "2026-07-10T14:30:00.000Z",
    },
  });
  if (validation.status !== 0) {
    console.error("FAIL generated record validation");
    console.error(validation.stdout.trim());
    console.error(validation.stderr.trim());
    process.exit(1);
  }
  if (!validation.stdout.includes("prodReadonlySmokeEvidenceHash: sha256:")) {
    console.error("FAIL generated record validation hash missing");
    console.error(validation.stdout.trim());
    process.exit(1);
  }

  const fallbackGenerated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-prod-readonly-smoke-record.ts", smokeOutput], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_READINESS_ENVIRONMENT: "production",
      AREAFORGE_READINESS_EXPECTED_VERSION: "0.1.5",
      AREAFORGE_READINESS_RELEASE_TAG: "v0.1.5",
      AREAFORGE_READINESS_RELEASE_MANIFEST_FILE: manifest,
      AREAFORGE_SMOKE_PASSWORD_FILE: "/etc/areaforge/smoke-password",
      AREAFORGE_EXTRA_SMOKE_COMMAND: "cd /opt/areaforge && pnpm smoke:prod-readonly",
      AREAFORGE_PROD_READONLY_SMOKE_COMMAND: "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
      AREAFORGE_UPDATE_RECORD_SUMMARY: "update-record hash sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
  });
  if (fallbackGenerated.status !== 0 || !fallbackGenerated.stdout.includes("smokeCommand: ops/update-agent/areaforge-ops001-readonly-fallback.sh")) {
    console.error("FAIL fallback-generated record command");
    console.error(fallbackGenerated.stdout.trim());
    console.error(fallbackGenerated.stderr.trim());
    process.exit(1);
  }

  writeFileSync(generatedRecord, fallbackGenerated.stdout);
  const fallbackValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/prod-readonly-smoke-validate.ts", generatedRecord], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_SMOKE_PROOF_NOW: "2026-07-10T14:30:00.000Z",
    },
  });
  if (fallbackValidation.status !== 0) {
    console.error("FAIL fallback-generated record validation");
    console.error(fallbackValidation.stdout.trim());
    console.error(fallbackValidation.stderr.trim());
    process.exit(1);
  }

  console.log("production readonly smoke record generator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function createSmokeOutput(): string {
  return [
    "PASS health: ok (12ms)",
    "PASS login: ok (34ms)",
    JSON.stringify({
      ok: true,
      baseUrl: "https://forge.areasong.top",
      checkedAt: "2026-07-10T22:20:00+08:00",
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
