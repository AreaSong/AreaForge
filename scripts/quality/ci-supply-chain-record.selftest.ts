import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-ci-supply-chain-record-"));

try {
  const runJson = path.join(tempDir, "github-run.json");
  const generatedRecord = path.join(tempDir, "ci-supply-chain-record.txt");
  writeFileSync(runJson, JSON.stringify({
    name: "CI",
    html_url: "https://github.com/AreaSong/AreaForge/actions/runs/123456789",
    conclusion: "success",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    head_branch: "main",
    repository: { full_name: "AreaSong/AreaForge" },
  }, null, 2));

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-ci-supply-chain-record.ts", runJson], {
    cwd: root,
    encoding: "utf8",
    env: validEnv(),
  });
  expectStatus("generate CI supply-chain record", generated, 0);
  writeFileSync(generatedRecord, generated.stdout);

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ci-supply-chain-record-validate.ts", generatedRecord], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate generated CI supply-chain record", validation, 0);
  if (!validation.stdout.includes("ciSupplyChainEvidenceHash: sha256:")) {
    fail("CI supply-chain validation hash missing");
  }

  const invalidRecord = path.join(tempDir, "ci-supply-chain-invalid.txt");
  writeFileSync(invalidRecord, generated.stdout.replace("highCriticalVulnerabilities: none", "highCriticalVulnerabilities: high"));
  const invalidValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ci-supply-chain-record-validate.ts", invalidRecord], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("invalid CI supply-chain record fails", invalidValidation, 1);

  const staleRecord = path.join(tempDir, "ci-supply-chain-stale.txt");
  writeFileSync(staleRecord, generated.stdout.replace(
    "expectedGitCommit: 0123456789abcdef0123456789abcdef01234567",
    "expectedGitCommit: 89abcdef0123456789abcdef0123456789abcdef",
  ));
  const staleValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ci-supply-chain-record-validate.ts", staleRecord], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("stale CI supply-chain record fails", staleValidation, 1);

  const missingRequired = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-ci-supply-chain-record.ts", runJson], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...validEnv(),
      AREAFORGE_AUDIT_PROD_STATUS: "",
      AREAFORGE_PINNED_ACTIONS_COUNT: "",
    },
  });
  expectStatus("missing CI supply-chain required fields fail", missingRequired, 1);

  console.log("CI supply-chain record selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function validEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AREAFORGE_CI_WORKFLOW_STATUS: "pass",
    AREAFORGE_CI_REPOSITORY: "AreaSong/AreaForge",
    AREAFORGE_CI_EXPECTED_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    AREAFORGE_AUDIT_PROD_STATUS: "pass",
    AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS: "pass",
    AREAFORGE_ACTIONS_PINNING_STATUS: "pass",
    AREAFORGE_SKILLS_VALIDATE_STATUS: "pass",
    AREAFORGE_RELEASE_SUPPLY_CHAIN_SELFTEST_STATUS: "pass",
    AREAFORGE_PINNED_ACTIONS_COUNT: "15",
    AREAFORGE_UNPINNED_EXTERNAL_ACTIONS: "none",
    AREAFORGE_HIGH_CRITICAL_VULNERABILITIES: "none",
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
