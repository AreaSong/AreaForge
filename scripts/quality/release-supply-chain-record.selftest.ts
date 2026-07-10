import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-release-supply-chain-record-"));

try {
  const generatedRecord = path.join(tempDir, "release-supply-chain-record.txt");
  writeReleaseAssets(tempDir);

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-release-supply-chain-record.ts", tempDir], {
    cwd: root,
    encoding: "utf8",
    env: validEnv(),
  });
  if (generated.status !== 0) {
    console.error("FAIL generated release supply-chain record command");
    console.error(generated.stdout.trim());
    console.error(generated.stderr.trim());
    process.exit(1);
  }
  writeFileSync(generatedRecord, generated.stdout);

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/release-supply-chain-validate.ts", generatedRecord], {
    cwd: root,
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    console.error("FAIL generated release supply-chain record validation");
    console.error(validation.stdout.trim());
    console.error(validation.stderr.trim());
    process.exit(1);
  }
  if (!validation.stdout.includes("releaseSupplyChainEvidenceHash: sha256:")) {
    console.error("FAIL generated release supply-chain validation hash missing");
    console.error(validation.stdout.trim());
    process.exit(1);
  }

  const missingRequired = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-release-supply-chain-record.ts", tempDir], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...validEnv(),
      AREAFORGE_AUDIT_PROD_STATUS: "",
      AREAFORGE_RELEASE_WORKFLOW_RUN_URL: "",
    },
  });
  if (missingRequired.status !== 1 || !missingRequired.stderr.includes("missing")) {
    console.error("FAIL missing required release supply-chain fields should fail");
    console.error(missingRequired.stdout.trim());
    console.error(missingRequired.stderr.trim());
    process.exit(1);
  }

  console.log("release supply-chain record generator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function validEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AREAFORGE_RELEASE_WORKFLOW_RUN_URL: "https://github.com/AreaSong/AreaForge/actions/runs/123456789",
    AREAFORGE_RELEASE_WORKFLOW_RUN_CONCLUSION: "success",
    AREAFORGE_VALIDATE_JOB_STATUS: "pass",
    AREAFORGE_AUDIT_PROD_STATUS: "pass",
    AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS: "pass",
    AREAFORGE_ACTIONS_PINNING_STATUS: "pass",
    AREAFORGE_RELEASE_WORKFLOW_STATUS: "pass",
    AREAFORGE_CHECKSUM_VERIFICATION: "pass",
    AREAFORGE_SIGNATURE_VERIFICATION: "pass",
    AREAFORGE_UNSIGNED_PLACEHOLDER_PRESENT: "no",
  };
}

function writeReleaseAssets(dir: string): void {
  const assets = {
    "areaforge-release-manifest.json": JSON.stringify({
      schemaVersion: 1,
      app: "AreaForge",
      version: "0.1.6",
      channel: "stable",
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      webImageDigest: "ghcr.io/areasong/areaforge-web:v0.1.6@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      migrationImageDigest: "ghcr.io/areasong/areaforge-migration:v0.1.6@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      releaseNotesUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.6",
    }),
    "areaforge-sbom.spdx.json": "{}",
    "areaforge-provenance.json": "{}",
    "docker-compose.prod.yml": "services: {}\n",
    "SHA256SUMS.sig": "cosign bundle placeholder\n",
  };
  for (const [name, content] of Object.entries(assets)) {
    writeFileSync(path.join(dir, name), content);
  }
  writeFileSync(path.join(dir, "SHA256SUMS"), [
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  areaforge-release-manifest.json",
    "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd  areaforge-sbom.spdx.json",
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  areaforge-provenance.json",
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  docker-compose.prod.yml",
    "",
  ].join("\n"));
}
