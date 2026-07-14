import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-ops001-blocked-"));

try {
  const validRecord = path.join(tempDir, "ops001-blocked-record.txt");
  writeFileSync(validRecord, createBlockedRecord());
  expectExit("valid OPS-001 blocked record passes", [validRecord], 0, "OPS-001 blocked record validation passed");

  const readonlyServerRecord = path.join(tempDir, "ops001-blocked-readonly-server-record.txt");
  writeFileSync(readonlyServerRecord, createBlockedRecord({ serverCommandAttempted: "yes" }));
  expectExit("valid OPS-001 blocked record with read-only server evidence passes", [readonlyServerRecord], 0, "serverCommandAttempted=recorded");

  const secretRecord = path.join(tempDir, "ops001-blocked-secret.txt");
  writeFileSync(secretRecord, `${createBlockedRecord()}\nleak: AREAFORGE_SMOKE_PASSWORD=super-secret\n`);
  expectExit("secret-bearing OPS-001 blocked record fails", [secretRecord], 1, "must not contain smoke password env value");

  console.log("OPS-001 blocked record validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function createBlockedRecord(options: { serverCommandAttempted?: "yes" | "no" } = {}): string {
  const serverCommandAttempted = options.serverCommandAttempted ?? "no";
  return [
    "recordId: ops-001-blocked-20260711083436",
    "generatedAt: 2026-07-11T08:34:36Z",
    "mode: ops001-readonly-evidence-blocked",
    "residualRiskId: AF-RISK-OPS-001",
    "environment: production",
    "baseUrl: https://forge.areasong.top",
    "releaseTag: v0.1.5",
    "redactedUpdateStatusRecordHash: sha256:82e94e332b015089061c7944984fff9857b92e1833d4bfef8d8ddf791f5b6a09",
    "extraSmokeCommandConfigured: yes",
    "smokeEmailConfigured: no",
    "smokePasswordFileConfigured: no",
    "hostPnpmAvailable: no",
    "preflightStatus: blocked_on_prerequisite",
    "blockers: host pnpm missing, smoke email missing, smoke password file missing",
    "doesNotProve: authenticated smoke passed; operational evidence bundle ready; OPS-001 closure packet ready; AF-RISK-OPS-001 closure; long-term operability",
    "residualLedgerAction: remains-open",
    "forbiddenActions: updater apply, migration, backup, restore, rollback, production writes, secret export, residual ledger closure",
    "safetyFacts:",
    `  serverCommandAttempted: ${serverCommandAttempted}`,
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  productionWriteAttempted: no",
    "  updaterApplyAttempted: no",
    "  rollbackAttempted: no",
    "  secretValuePrinted: no",
    "  residualLedgerUpdated: no",
    "",
  ].join("\n");
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedOutput: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ops001-blocked-record-validate.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${label}: expected exit ${expectedStatus}, got ${String(result.status)}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedOutput)) {
    throw new Error(`${label}: missing output ${expectedOutput}`);
  }
}
