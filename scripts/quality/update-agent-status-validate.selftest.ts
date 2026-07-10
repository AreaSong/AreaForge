import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-update-agent-status-"));

try {
  const validStatus = path.join(tempDir, "update-status.json");
  const invalidSignatureStatus = path.join(tempDir, "update-status-signature.json");
  const invalidAutoApplyStatus = path.join(tempDir, "update-status-autoapply.json");
  const invalidSecretStatus = path.join(tempDir, "update-status-secret.json");

  writeFileSync(validStatus, JSON.stringify(createStatus(), null, 2));
  writeFileSync(invalidSignatureStatus, JSON.stringify({ ...createStatus(), signatureRequired: false }, null, 2));
  writeFileSync(invalidAutoApplyStatus, JSON.stringify({ ...createStatus(), autoApply: "patch" }, null, 2));
  writeFileSync(invalidSecretStatus, JSON.stringify({ ...createStatus(), leaked: "AI_API_KEY=sk-testtesttesttesttest" }, null, 2));

  expectExit("valid update-agent status passes", [validStatus], 0, "updateAgentStatusEvidenceHash: sha256:");
  expectExit("signature disabled fails", [invalidSignatureStatus], 1);
  expectExit("autoApply patch fails without closure evidence", [invalidAutoApplyStatus], 1);
  expectExit("secret-like value fails", [invalidSecretStatus], 1);

  console.log("update-agent status validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/update-agent-status-validate.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected exit ${expectedStatus}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
  if (expectedStdout && !result.stdout.includes(expectedStdout)) {
    console.error(`FAIL ${label}: expected stdout to include ${expectedStdout}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
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
