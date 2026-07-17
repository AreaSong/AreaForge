import { spawnSync } from "node:child_process";

const root = process.cwd();
const fakeHash = `sha256:${"a".repeat(64)}`;

expectBackupStatus("daily free-form hash stays warn", "daily", "warn");
expectBackupStatus("update free-form hash stays blocked", "update", "blocked");

console.log("operational readiness summary selftest passed.");

function expectBackupStatus(label: string, scope: string, expected: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/operational-readiness-summary.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_READINESS_SCOPE: scope,
      AREAFORGE_READINESS_BACKUP_EVIDENCE: `untrusted ${fakeHash}`,
      AREAFORGE_READINESS_BASE_URL: "",
      AREAFORGE_SMOKE_BASE_URL: "",
      APP_URL: "",
      AREAFORGE_HEALTH_URL: "",
    },
  });
  if (result.status !== 0) fail(label, `command failed: ${result.stderr}`);
  const body = JSON.parse(result.stdout) as { signals?: { backup?: { status?: string; evidence?: string } } };
  const backup = body.signals?.backup;
  if (backup?.status !== expected) fail(label, `expected ${expected}, got ${backup?.status ?? "missing"}`);
  if (!backup.evidence?.includes("metadata-only")) fail(label, "evidence must explain metadata-only boundary");
}

function fail(label: string, message: string): never {
  console.error(`FAIL ${label}: ${message}`);
  process.exit(1);
}
