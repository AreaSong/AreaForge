import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOps006ProductionEvidencePreflight } from "../ops/ops006-production-evidence-preflight";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops006-production-preflight-"));
const releaseRecord = path.join(root, "release.txt");
const releaseAssets = path.join(root, "assets");
const releaseEvidence = path.join(root, "release-evidence.txt");
const reconciliationCsv = path.join(root, "attachment.csv");
const reconciliationSummary = path.join(root, "attachment-summary.json");
const productionEvidence = path.join(root, "production-evidence.txt");
const commit = "a".repeat(40);

try {
  mkdirSync(releaseAssets);
  writeFileSync(releaseRecord, `gitCommit: ${commit}\n`);
  writeFileSync(releaseEvidence, "releaseEvidenceBundleHash: fixture\n");
  writeFileSync(reconciliationCsv, "fixture csv\n");
  writeFileSync(reconciliationSummary, "{}\n");
  writeFileSync(productionEvidence, [
    "rolloutConfirmationId: confirm-ops006-rollout-20260718",
    `rolloutConfirmationScopeSha256: sha256:${"d".repeat(64)}`,
    "controlledProbeConfirmationId: confirm-ops006-probe-20260718",
    `controlledProbeConfirmationScopeSha256: sha256:${"e".repeat(64)}`,
    "afterDoctorFile: after-doctor.json",
    `afterDoctorFileSha256: sha256:${"b".repeat(64)}`,
    `afterDoctorHash: sha256:${"c".repeat(64)}`,
    "",
  ].join("\n"));

  assertStatus(run({}, "local_validation"), "needs_local_verification");
  assertStatus(run({}, "local_verified"), "needs_signed_release");
  assertStatus(run(releaseEnv(), "local_verified"), "needs_rollout_confirmation");
  assertStatus(run(rolloutEnv(), "local_verified"), "needs_probe_confirmation");
  assertStatus(run(probeEnv(), "local_verified"), "needs_production_evidence");
  assertStatus(run({ ...releaseEnv(), AREAFORGE_OPS006_PRODUCTION_EVIDENCE_RECORD: productionEvidence }, "local_verified"), "invalid");
  const complete = run({
    ...probeEnv(),
    AREAFORGE_OPS006_PRODUCTION_EVIDENCE_RECORD: productionEvidence,
    AREAFORGE_OPS006_RELEASE_EVIDENCE_RECORD: releaseEvidence,
    AREAFORGE_OPS006_RELEASE_RECONCILIATION_CSV: reconciliationCsv,
    AREAFORGE_OPS006_RELEASE_RECONCILIATION_SUMMARY: reconciliationSummary,
  }, "local_verified");
  assertStatus(complete, "ready_for_ops006_human_review");
  if (complete.evidence.afterDoctorFile !== "after-doctor.json") throw new Error("preflight must expose the bound after-doctor identity");

  const badRelease = run(releaseEnv(), "local_verified", { releaseInvalid: true });
  assertStatus(badRelease, "invalid");
  const badBinding = run(releaseEnv(), "local_verified", { bindingInvalid: true });
  assertStatus(badBinding, "invalid");
  const badBundle = run({
    ...probeEnv(),
    AREAFORGE_OPS006_PRODUCTION_EVIDENCE_RECORD: productionEvidence,
    AREAFORGE_OPS006_RELEASE_EVIDENCE_RECORD: releaseEvidence,
    AREAFORGE_OPS006_RELEASE_RECONCILIATION_CSV: reconciliationCsv,
    AREAFORGE_OPS006_RELEASE_RECONCILIATION_SUMMARY: reconciliationSummary,
  }, "local_verified", { bundleInvalid: true });
  assertStatus(badBundle, "invalid");
  const reusedConfirmation = run({
    ...probeEnv(),
    AREAFORGE_OPS006_PROBE_CONFIRMATION_ID: "confirm-ops006-rollout-20260718",
  }, "local_verified");
  assertStatus(reusedConfirmation, "invalid");

  console.log("OPS-006 production evidence preflight selftest passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function run(
  env: Record<string, string>,
  localStatus: string,
  failures: { releaseInvalid?: boolean; bindingInvalid?: boolean; bundleInvalid?: boolean } = {},
) {
  return buildOps006ProductionEvidencePreflight({
    root,
    env,
    now: new Date("2026-07-18T12:00:00.000Z"),
    localStatus,
    releaseValidator: () => failures.releaseInvalid ? [{ field: "signature", message: "invalid" }] : [],
    checkoutEvaluator: () => failures.bindingInvalid
      ? { status: "invalid", releaseGitCommit: commit, currentGitCommit: commit, worktreeClean: true, changedPaths: [], issues: ["invalid binding"] }
      : { status: "exact", releaseGitCommit: commit, currentGitCommit: commit, worktreeClean: true, changedPaths: [], issues: [] },
    bundleValidator: () => failures.bundleInvalid ? [{ field: "rollout", message: "invalid" }] : [],
  });
}

function releaseEnv(): Record<string, string> {
  return {
    AREAFORGE_OPS006_RELEASE_RECORD: releaseRecord,
    AREAFORGE_OPS006_RELEASE_ASSETS_DIR: releaseAssets,
  };
}

function rolloutEnv(): Record<string, string> {
  return {
    ...releaseEnv(),
    AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_ID: "confirm-ops006-rollout-20260718",
    AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_SCOPE_SHA256: `sha256:${"d".repeat(64)}`,
  };
}

function probeEnv(): Record<string, string> {
  return {
    ...rolloutEnv(),
    AREAFORGE_OPS006_PROBE_CONFIRMATION_ID: "confirm-ops006-probe-20260718",
    AREAFORGE_OPS006_PROBE_CONFIRMATION_SCOPE_SHA256: `sha256:${"e".repeat(64)}`,
  };
}

function assertStatus(result: { status: string }, expected: string): void {
  if (result.status !== expected) throw new Error(`expected ${expected}, got ${JSON.stringify(result)}`);
}
