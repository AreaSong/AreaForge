import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-protected-path-review-"));

try {
  const validDirtyRecord = path.join(tempDir, "valid-dirty.txt");
  const validCleanRecord = path.join(tempDir, "valid-clean.txt");
  const invalidDirtyWithoutFollowUp = path.join(tempDir, "invalid-dirty-follow-up.txt");
  const invalidFingerprint = path.join(tempDir, "invalid-fingerprint.txt");
  const invalidDecision = path.join(tempDir, "invalid-decision.txt");
  const invalidSafety = path.join(tempDir, "invalid-safety.txt");
  const invalidSecret = path.join(tempDir, "invalid-secret.txt");

  writeFileSync(validDirtyRecord, createRecord());
  writeFileSync(validCleanRecord, createRecord()
    .replace("worktreeState: dirty-reviewed", "worktreeState: clean")
    .replace("findings: pre-existing docs and ops changes were inspected; keep production evidence gaps open", "findings: none")
    .replace("followUpRefs: docs/development/residual-risk-ledger.md", "followUpRefs: none"));
  writeFileSync(invalidDirtyWithoutFollowUp, createRecord().replace("followUpRefs: docs/development/residual-risk-ledger.md", "followUpRefs: none"));
  writeFileSync(invalidFingerprint, createRecord().replace("protectedPathFingerprint: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "protectedPathFingerprint: unknown"));
  writeFileSync(invalidDecision, createRecord().replace("reviewDecision: pass", "reviewDecision: block"));
  writeFileSync(invalidSafety, createRecord().replace("secretValuePrinted: no", "secretValuePrinted: yes"));
  writeFileSync(invalidSecret, `${createRecord()}\nleaked: AUTH_SESSION_SECRET=very-sensitive-value\n`);

  expectExit("valid dirty review passes", validDirtyRecord, 0, "protectedPathReviewEvidenceHash: sha256:");
  expectExit("valid clean review passes", validCleanRecord, 0);
  expectExit("dirty review without follow-up fails", invalidDirtyWithoutFollowUp, 1);
  expectExit("invalid fingerprint fails", invalidFingerprint, 1);
  expectExit("inconsistent decision fails", invalidDecision, 1);
  expectExit("unsafe safety fact fails", invalidSafety, 1);
  expectExit("secret-like content fails", invalidSecret, 1);
  console.log("protected path review record validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, record: string, expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/protected-path-review-record-validate.ts", record], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected exit ${expectedStatus}, got ${String(result.status)}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
  if (expectedStdout && !result.stdout.includes(expectedStdout)) {
    console.error(`FAIL ${label}: expected stdout to include ${expectedStdout}`);
    process.exit(1);
  }
}

function createRecord(): string {
  return [
    "recordId: protected-path-review-20260713",
    "reviewedAt: 2026-07-13T09:00:00+08:00",
    "reviewer: AreaForge maintainer",
    "reviewScope: governance and long-term operability control-plane paths",
    "sourceCommit: abcdef1234567890",
    "worktreeState: dirty-reviewed",
    "worktreeStatusHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "protectedPathScope: read_only_side_effect_guard_inputs",
    "protectedPathFingerprint: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "protectedPaths: README.md, package.json, docs/development/long-term-operability-control-plane.md",
    "reviewCommand: git status --short; pnpm ops:status; pnpm governance:preflight",
    "reviewDecision: pass",
    "findings: pre-existing docs and ops changes were inspected; keep production evidence gaps open",
    "followUpRefs: docs/development/residual-risk-ledger.md",
    "doesNotProve: production health; all repository paths were reviewed; git worktree cleanliness after review; updater apply; backup/restore; migration; rollback; residual ledger closure",
    "result: reviewed",
    "safetyFacts:",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  updaterApplyAttempted: no",
    "  rollbackAttempted: no",
    "  secretValuePrinted: no",
    "  residualLedgerUpdated: no",
    "",
  ].join("\n");
}
