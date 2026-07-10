import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-sc002-preflight-"));

try {
  const noEvidence = runPreflight({}, 0);
  assertJsonStatus(noEvidence.stdout, "needs_evidence");

  const ciRecord = path.join(tempDir, "ci-supply-chain-record.txt");
  const releaseRecord = path.join(tempDir, "release-supply-chain-record.txt");
  writeFileSync(ciRecord, createCiRecord());
  writeFileSync(releaseRecord, createReleaseRecord());

  const readyForSc002 = runPreflight({
    AREAFORGE_SC002_CI_RECORD: ciRecord,
  }, 0);
  assertJsonStatus(readyForSc002.stdout, "ready_for_sc002_review");

  const readyForSc001Sc002 = runPreflight({
    AREAFORGE_SC002_RELEASE_RECORD: releaseRecord,
  }, 0);
  assertJsonStatus(readyForSc001Sc002.stdout, "ready_for_sc001_sc002_review");

  const invalidCi = path.join(tempDir, "ci-supply-chain-invalid.txt");
  writeFileSync(invalidCi, createCiRecord().replace("highCriticalVulnerabilities: none", "highCriticalVulnerabilities: high"));
  const invalid = runPreflight({
    AREAFORGE_SC002_CI_RECORD: invalidCi,
  }, 1);
  assertJsonStatus(invalid.stdout, "invalid");

  console.log("SC-002 supply-chain preflight selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function runPreflight(env: Record<string, string>, expectedStatus: number): ReturnType<typeof spawnSync> {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/sc002-supply-chain-preflight.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_SC002_CI_RECORD: "",
      AREAFORGE_SC002_RELEASE_RECORD: "",
      ...env,
    },
  });
  expectStatus("SC-002 supply-chain preflight", result, expectedStatus);
  return result;
}

function assertJsonStatus(raw: string, expected: string): void {
  const parsed = JSON.parse(raw) as JsonRecord;
  if (parsed.mode !== "read_only_sc002_supply_chain_preflight") {
    fail("preflight mode missing");
  }
  if (parsed.status !== expected) {
    fail(`expected preflight status ${expected}, got ${String(parsed.status)}`);
  }
  const safety = parsed.safetyFacts as JsonRecord | undefined;
  if (!safety || safety.githubApiCalled !== false || safety.releaseCreated !== false || safety.tagPushed !== false || safety.secretValuePrinted !== false) {
    fail("preflight safety facts should prove no GitHub API, Release creation, tag push, or secret printing");
  }
  const requiredPreflight = parsed.requiredPreflight as string[] | undefined;
  for (const command of [
    "pnpm governance:preflight",
    "pnpm audit:prod",
    "pnpm release:supply-chain:record:selftest",
    "pnpm ci:supply-chain:selftest",
    "pnpm sc:sc-002:preflight:selftest",
    "pnpm github-release-updater:preflight",
  ]) {
    if (!requiredPreflight?.includes(command)) {
      fail(`preflight should require ${command}`);
    }
  }
  const forbiddenActions = parsed.forbiddenActions as string[] | undefined;
  for (const action of ["create_github_release", "push_git_tag", "call_github_api", "update_residual_ledger"]) {
    if (!forbiddenActions?.includes(action)) {
      fail(`preflight should forbid ${action}`);
    }
  }
}

function createCiRecord(): string {
  return [
    "recordId: ci-supply-chain-20260710231000",
    "recordedAt: 2026-07-10T23:10:00+08:00",
    "workflowKind: ci",
    "repository: AreaSong/AreaForge",
    "workflowName: CI",
    "workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/123456789",
    "workflowRunConclusion: success",
    "gitCommit: 0123456789abcdef0123456789abcdef01234567",
    "expectedGitCommit: 0123456789abcdef0123456789abcdef01234567",
    "commitMatchStatus: pass",
    "headBranch: main",
    "packageVersion: 0.1.6",
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

function createReleaseRecord(): string {
  return [
    "recordId: release-supply-chain-v0.1.6",
    "recordedAt: 2026-07-10T23:10:00+08:00",
    "releaseTag: v0.1.6",
    "releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.6",
    "workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/123456789",
    "workflowRunConclusion: success",
    "gitCommit: 0123456789abcdef0123456789abcdef01234567",
    "channel: stable",
    "packageVersion: 0.1.6",
    "validateJobStatus: pass",
    "auditProdStatus: pass",
    "governancePreflightStatus: pass",
    "actionsPinningStatus: pass",
    "releaseWorkflowStatus: pass",
    "webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.6@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "migrationImageDigest: ghcr.io/areasong/areaforge-migration:v0.1.6@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
