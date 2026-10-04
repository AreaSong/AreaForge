import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-update-agent-status-record-"));

try {
  const source = path.join(tempDir, "source-status.json");
  const generated = path.join(tempDir, "generated-status.json");
  writeFileSync(source, JSON.stringify({
    status: createStatus(),
    ignoredSecret: "AI_API_KEY=sk-testtesttesttesttest",
  }, null, 2));

  const generate = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-update-agent-status-record.ts", source], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("generate valid status", generate, 0);
  if (generate.stdout.includes("AI_API_KEY") || generate.stdout.includes("sk-test")) {
    fail("generated record leaked ignored source secret");
  }
  writeFileSync(generated, generate.stdout);

  const validate = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/update-agent-status-validate.ts", generated], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate generated status", validate, 0);

  const missingSource = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-update-agent-status-record.ts", path.join(tempDir, "missing.json")], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("missing source fails", missingSource, 1);

  console.log("update-agent status record generator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function createStatus(): Record<string, unknown> {
  return {
    currentVersion: "0.1.5",
    currentImage: "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    releaseUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.5",
    latestVersion: "0.1.5",
    updateAvailable: false,
    autoApply: "none",
    signatureRequired: true,
    timerEnabled: true,
    timerActive: true,
    lastCheckedAt: "2026-07-10T21:30:00+08:00",
    blocker: null,
    rollback: {
      available: true,
      targetVersion: "0.1.4",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.4@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    statusUpdatedAt: "2026-07-10T21:30:00+08:00",
  };
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
