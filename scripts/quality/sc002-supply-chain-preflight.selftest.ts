import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluateSc002Preflight,
  readCurrentCheckoutBinding,
  type CheckoutBinding,
  type ValidatorInvocation,
  type ValidatorResult,
} from "../ops/sc002-supply-chain-preflight";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-sc002-preflight-"));

try {
  const repo = createRepository();
  const releaseRecord = path.join(repo.root, "release-record.txt");
  const ciRecord = path.join(repo.root, "ci-record.txt");
  const assetsDir = path.join(repo.root, "release-assets");
  mkdirSync(assetsDir);
  writeFileSync(releaseRecord, createReleaseRecord(repo.releaseCommit));
  writeFileSync(ciRecord, createCiRecord(repo.releaseCommit));

  const calls: ValidatorInvocation[] = [];
  const runValidator = (invocation: ValidatorInvocation): ValidatorResult => {
    calls.push(invocation);
    const invalid = invocation.args.some((arg) => arg.includes("invalid"));
    return { status: invalid ? 1 : 0, stdout: "", stderr: invalid ? "invalid record" : "" };
  };

  assertStatus(run(repo.root, repo.binding, { AREAFORGE_SC002_CI_RECORD: ciRecord }, runValidator), "ready_for_sc002_review");
  const releaseResult = run(repo.root, repo.binding, {
    AREAFORGE_SC002_RELEASE_RECORD: releaseRecord,
    AREAFORGE_SC002_RELEASE_ASSETS_DIR: assetsDir,
  }, runValidator);
  assertStatus(releaseResult, "ready_for_sc001_sc002_review");
  const releaseCall = calls.find((call) => call.args.includes(releaseRecord));
  if (!releaseCall?.args.includes(path.resolve(assetsDir)) || !releaseCall.args.includes("--strict")) {
    throw new Error(`signed Release validator must receive assets dir and --strict: ${JSON.stringify(releaseCall)}`);
  }

  const missingAssets = run(repo.root, repo.binding, { AREAFORGE_SC002_RELEASE_RECORD: releaseRecord }, runValidator);
  assertStatus(missingAssets, "invalid");

  const stale = run(repo.root, { gitCommit: "a".repeat(40), worktreeClean: true }, {
    AREAFORGE_SC002_CI_RECORD: ciRecord,
  }, runValidator);
  assertStatus(stale, "needs_evidence");

  const dirty = run(repo.root, { gitCommit: repo.releaseCommit, worktreeClean: false }, {
    AREAFORGE_SC002_RELEASE_RECORD: releaseRecord,
    AREAFORGE_SC002_RELEASE_ASSETS_DIR: assetsDir,
  }, runValidator);
  assertStatus(dirty, "needs_evidence");

  const invalidRecord = path.join(repo.root, "invalid-record.txt");
  writeFileSync(invalidRecord, createCiRecord(repo.releaseCommit));
  const invalid = run(repo.root, repo.binding, { AREAFORGE_SC002_CI_RECORD: invalidRecord }, runValidator);
  assertStatus(invalid, "invalid");

  process.env.AREAFORGE_SC002_TEST_MODE = "1";
  process.env.AREAFORGE_SC002_EXPECTED_GIT_COMMIT = "b".repeat(40);
  process.env.AREAFORGE_SC002_EXPECTED_WORKTREE_CLEAN = "true";
  const actual = readCurrentCheckoutBinding(repo.root);
  delete process.env.AREAFORGE_SC002_TEST_MODE;
  delete process.env.AREAFORGE_SC002_EXPECTED_GIT_COMMIT;
  delete process.env.AREAFORGE_SC002_EXPECTED_WORKTREE_CLEAN;
  if (actual.gitCommit !== repo.releaseCommit || actual.worktreeClean) {
    throw new Error(`checkout binding must ignore spoofable test env: ${JSON.stringify(actual)}`);
  }

  console.log("SC-002 supply-chain preflight selftest passed.");
} finally {
  rmSync(root, { force: true, recursive: true });
}

function run(
  repoRoot: string,
  binding: CheckoutBinding,
  evidenceEnv: Record<string, string>,
  runValidator: (invocation: ValidatorInvocation) => ValidatorResult,
) {
  return evaluateSc002Preflight({
    root: repoRoot,
    env: {
      AREAFORGE_SC002_CI_RECORD: "",
      AREAFORGE_SC002_RELEASE_RECORD: "",
      AREAFORGE_SC002_RELEASE_ASSETS_DIR: "",
      ...evidenceEnv,
    },
    checkoutBinding: binding,
    runValidator,
  });
}

function createRepository(): { root: string; releaseCommit: string; binding: CheckoutBinding } {
  const repoRoot = path.join(root, "repo");
  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["config", "user.email", "test@areaforge.invalid"]);
  git(repoRoot, ["config", "user.name", "AreaForge selftest"]);
  writeFileSync(path.join(repoRoot, "README.md"), "source\n");
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-qm", "release"]);
  const releaseCommit = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  return { root: repoRoot, releaseCommit, binding: { gitCommit: releaseCommit, worktreeClean: true } };
}

function createCiRecord(commit: string): string {
  return [
    "recordId: ci-supply-chain-selftest",
    "recordedAt: 2026-07-18T00:00:00+08:00",
    "workflowKind: ci",
    "repository: AreaSong/AreaForge",
    "workflowName: CI",
    "workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/123456789",
    "workflowRunConclusion: success",
    `gitCommit: ${commit}`,
    `expectedGitCommit: ${commit}`,
    "commitMatchStatus: pass",
    "headBranch: main",
    "packageVersion: 0.1.8",
    "ciWorkflowStatus: pass",
    "auditProdStatus: pass",
    "governancePreflightStatus: pass",
    "actionsPinningStatus: pass",
    "skillsValidateStatus: pass",
    "releaseSupplyChainSelftestStatus: pass",
    "pinnedActionsCount: 15",
    "unpinnedExternalActions: none",
    "highCriticalVulnerabilities: none",
    "residualRiskIds: AF-RISK-SC-002",
    "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:",
    "  secretsPrinted: no",
    "  productionEnvIncluded: no",
    "  backupIncluded: no",
    "  productionWriteAttempted: no",
    "  releaseCreated: no",
    "  tagPushed: no",
    "",
  ].join("\n");
}

function createReleaseRecord(commit: string): string {
  return [
    "recordId: release-supply-chain-selftest",
    "recordedAt: 2026-07-18T00:00:00+08:00",
    "releaseTag: v0.1.8",
    "releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.8",
    "workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/123456789",
    "workflowRunConclusion: success",
    `gitCommit: ${commit}`,
    "channel: stable",
    "packageVersion: 0.1.8",
    "validateJobStatus: pass",
    "auditProdStatus: pass",
    "governancePreflightStatus: pass",
    "actionsPinningStatus: pass",
    "releaseWorkflowStatus: pass",
    "webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.8@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "migrationImageDigest: ghcr.io/areasong/areaforge-migration:v0.1.8@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "manifestAsset: areaforge-release-manifest.json",
    "sbomAsset: areaforge-sbom.spdx.json",
    "provenanceAsset: areaforge-provenance.json",
    "sha256SumsAsset: SHA256SUMS",
    "signatureAsset: SHA256SUMS.sig",
    "sha256SumsCovers: areaforge-release-manifest.json,areaforge-sbom.spdx.json,areaforge-provenance.json,docker-compose.prod.yml",
    "checksumVerification: pass",
    "signatureVerification: pass",
    "manifestSha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "sbomSha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "provenanceSha256: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "composeSha256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "stableSigningRequired: yes",
    "unsignedPlaceholderPresent: no",
    "residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002",
    "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:",
    "  secretsPrinted: no",
    "  productionEnvIncluded: no",
    "  backupIncluded: no",
    "  promptOrRawAiResponseIncluded: no",
    "  attachmentContentIncluded: no",
    "  productionWriteAttempted: no",
    "",
  ].join("\n");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function assertStatus(result: { status: string }, expected: string): void {
  if (result.status !== expected) throw new Error(`expected ${expected}, got ${JSON.stringify(result)}`);
}
