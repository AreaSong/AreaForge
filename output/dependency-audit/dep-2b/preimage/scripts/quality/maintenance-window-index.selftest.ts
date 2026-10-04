import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-maintenance-index-"));

try {
  writeRecord("maintenance-window-20260712-weekly-production", createRecord("maintenance-window-20260712010000", "2026-07-12T01:00:00Z", "warn"));
  writeRecord("maintenance-window-20260713-weekly-production", createRecord("maintenance-window-20260713010000", "2026-07-13T01:00:00Z", "pass"));
  const generated = run(["exec", "tsx", "scripts/ops/maintenance-window-index.ts", tempDir]);
  expectStatus("generate index", generated, 0);
  const index = JSON.parse(generated.stdout) as Record<string, unknown>;
  assert(index.mode === "read_only_maintenance_window_index", "index mode mismatch");
  assert(index.latestWindowId === "maintenance-window-20260713010000", "latest window mismatch");
  assert(Array.isArray(index.windows) && index.windows.length === 2, "index should contain two records");
  const generatedAgain = run(["exec", "tsx", "scripts/ops/maintenance-window-index.ts", tempDir]);
  expectStatus("deterministic rebuild", generatedAgain, 0);
  assert(generated.stdout === generatedAgain.stdout, "rebuilding the same source set must be byte-identical");
  const indexPath = path.join(tempDir, "index.json");
  writeFileSync(indexPath, generated.stdout);
  expectStatus("validate current index", run(["exec", "tsx", "scripts/quality/maintenance-window-index-validate.ts", indexPath, tempDir]), 0);

  writeRecord("maintenance-window-20260713-weekly-production", createRecord("maintenance-window-20260713010000", "2026-07-13T01:00:00Z", "warn"));
  expectStatus("record drift invalidates saved index", run(["exec", "tsx", "scripts/quality/maintenance-window-index-validate.ts", indexPath, tempDir]), 1);

  writeRecord("maintenance-window-20260714-weekly-production", createRecord("maintenance-window-20260713010000", "2026-07-14T01:00:00Z", "warn"));
  const duplicate = run(["exec", "tsx", "scripts/ops/maintenance-window-index.ts", tempDir]);
  expectStatus("duplicate window id fails index generation", duplicate, 1);
  assert(duplicate.stdout.trim() === "", "failed generation must not emit a partial index");
  assert(duplicate.stderr.includes("duplicate maintenance window id"), "duplicate failure must be explicit");

  const invalidUtf8Root = path.join(tempDir, "invalid-utf8-root");
  const invalidUtf8Dir = path.join(invalidUtf8Root, "maintenance-window-20260715-weekly-production");
  mkdirSync(invalidUtf8Dir, { recursive: true });
  writeFileSync(path.join(invalidUtf8Dir, "maintenance-window.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
  const invalidUtf8 = run(["exec", "tsx", "scripts/ops/maintenance-window-index.ts", invalidUtf8Root]);
  expectStatus("invalid UTF-8 record fails index generation", invalidUtf8, 1);
  assert(invalidUtf8.stdout.trim() === "", "invalid UTF-8 generation must not emit a partial index");
  assert(invalidUtf8.stderr.includes("must be valid UTF-8"), "invalid UTF-8 failure must be explicit");

  const emptyDir = path.join(tempDir, "empty");
  mkdirSync(emptyDir);
  const empty = run(["exec", "tsx", "scripts/ops/maintenance-window-index.ts", emptyDir]);
  expectStatus("empty index", empty, 0);
  const emptyIndex = JSON.parse(empty.stdout) as { latestWindowId?: unknown; windows?: unknown[] };
  assert(emptyIndex.latestWindowId === null && emptyIndex.windows?.length === 0, "empty index must be explicit and valid");
  console.log("maintenance window index selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function writeRecord(directory: string, record: string): void {
  const recordDir = path.join(tempDir, directory);
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(path.join(recordDir, "maintenance-window.txt"), record);
}

function createRecord(windowId: string, startedAt: string, result: "pass" | "warn"): string {
  return [
    `windowId: ${windowId}`, `startedAt: ${startedAt}`, `finishedAt: ${startedAt}`, "operator: selftest", "cadence: weekly",
    "environment: production", "commandsRun: pnpm maintenance:cadence:preflight, pnpm residuals:review-due",
    `readinessOverall: ${result}`, `evidenceBundleStatus: ${result === "pass" ? "ready" : "needs_attention"}`,
    `alertPreviewStatus: ${result === "pass" ? "ok" : "warning"}`, "healthStatus: pass", `updateAgentStatus: ${result}`,
    `authenticatedSmokeStatus: ${result}`, `backupStatus: ${result}`, "infrastructureStatus: pass",
    `readinessSummaryHash: sha256:${"a".repeat(64)}`, `evidenceBundleHash: sha256:${"b".repeat(64)}`,
    `alertPreviewHash: sha256:${"c".repeat(64)}`, `residualReviewHash: sha256:${"d".repeat(64)}`,
    "evidenceFreshnessStatus: fresh", "evidenceFreshnessMaxAgeSeconds: 1209600", `latestEvidenceCheckedAt: ${startedAt}`,
    `residualReviewStatus: ${result}`, `dueResidualRiskIds: ${result === "pass" ? "none" : "AF-RISK-OPS-001"}`,
    "claimBoundary:", "  doesNotProve: production health without live evidence, updater apply completion, backup/restore execution, migration execution, rollback execution, residual risk closure",
    "decisions: no production write", "followUpTasks: tasks/indexes/residuals.md", `result: ${result}`,
    `residualRiskIds: ${result === "pass" ? "none" : "AF-RISK-OPS-001"}`, "safetyFacts:",
    "  productionWriteAttempted: no", "  serverCommandAttempted: no", "  backupRestoreAttempted: no", "  migrationAttempted: no",
    "  updaterApplyAttempted: no", "  rollbackAttempted: no", "  secretValuePrinted: no", "",
  ].join("\n");
}

function run(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("pnpm", args, { cwd: root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${String(result.status)}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
