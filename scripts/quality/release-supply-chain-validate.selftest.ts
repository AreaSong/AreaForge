import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateReleaseSupplyChainRecord } from "./release-supply-chain-validate";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-release-supply-chain-"));

try {
  const validRecord = path.join(tempDir, "release-supply-chain.txt");
  const invalidSecretRecord = path.join(tempDir, "release-supply-chain-secret.txt");
  const invalidAssetRecord = path.join(tempDir, "release-supply-chain-asset.txt");
  const invalidUnsignedRecord = path.join(tempDir, "release-supply-chain-unsigned.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: COSIGN_PASSWORD=super-secret-value\n`);
  writeFileSync(invalidAssetRecord, createRecord().replace(",areaforge-provenance.json", ""));
  writeFileSync(invalidUnsignedRecord, createRecord().replace("unsignedPlaceholderPresent: no", "unsignedPlaceholderPresent: yes"));

  expectExit("valid release supply-chain record passes", [validRecord], 0, "releaseSupplyChainEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("missing provenance coverage fails", [invalidAssetRecord], 1);
  expectExit("unsigned stable placeholder fails", [invalidUnsignedRecord], 1);

  const assetDir = path.join(tempDir, "assets");
  mkdirSync(assetDir);
  writeAssets(assetDir);
  const record = createRecordFromAssets(assetDir);
  const strictIssues = validateReleaseSupplyChainRecord(record, {
    assetDir,
    strict: true,
    cosignPublicKey: path.join(root, "docs/deployment/keys/areaforge-cosign.pub"),
    verifySignature: () => undefined,
  });
  assert(strictIssues.length === 0, `strict fixture should pass: ${JSON.stringify(strictIssues)}`);
  assert(validateReleaseSupplyChainRecord(record, { strict: true }).some((issue) => issue.field === "assetDir"), "strict mode must require assets");
  const mismatched = record.replace("gitCommit: 0123456789abcdef0123456789abcdef01234567", "gitCommit: ffffffffffffffffffffffffffffffffffffffff");
  assert(validateReleaseSupplyChainRecord(mismatched, {
    assetDir,
    strict: true,
    cosignPublicKey: path.join(root, "docs/deployment/keys/areaforge-cosign.pub"),
    verifySignature: () => undefined,
  }).some((issue) => issue.field === "gitCommit"), "strict mode must bind record identity to manifest");
  assert(validateReleaseSupplyChainRecord(record, {
    assetDir,
    strict: true,
    cosignPublicKey: path.join(root, "docs/deployment/keys/areaforge-cosign.pub"),
    verifySignature: () => { throw new Error("bad signature"); },
  }).some((issue) => issue.field === "assetDir.signatureAsset"), "strict mode must fail closed on signature verification");

  console.log("release supply-chain validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function writeAssets(dir: string): void {
  const assets = {
    "areaforge-release-manifest.json": JSON.stringify({
      schemaVersion: 1,
      app: "AreaForge",
      version: "0.1.6",
      channel: "stable",
      gitCommit: "0123456789abcdef0123456789abcdef01234567",
      webImageDigest: `ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"a".repeat(64)}`,
      migrationImageDigest: `ghcr.io/areasong/areaforge-migration:v0.1.6@sha256:${"b".repeat(64)}`,
      releaseNotesUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.6",
    }),
    "areaforge-sbom.spdx.json": "{}",
    "areaforge-provenance.json": "{}",
    "docker-compose.prod.yml": "services: {}\n",
  };
  for (const [name, content] of Object.entries(assets)) writeFileSync(path.join(dir, name), content);
  writeFileSync(path.join(dir, "SHA256SUMS"), Object.entries(assets)
    .map(([name, content]) => `${createHash("sha256").update(content).digest("hex")}  ${name}`)
    .join("\n") + "\n");
  writeFileSync(path.join(dir, "SHA256SUMS.sig"), "synthetic cosign bundle\n");
}

function createRecordFromAssets(dir: string): string {
  const hash = (name: string) => createHash("sha256").update(requireFile(path.join(dir, name))).digest("hex");
  return createRecord()
    .replace(`manifestSha256: ${"c".repeat(64)}`, `manifestSha256: ${hash("areaforge-release-manifest.json")}`)
    .replace(`sbomSha256: ${"d".repeat(64)}`, `sbomSha256: ${hash("areaforge-sbom.spdx.json")}`)
    .replace(`provenanceSha256: ${"e".repeat(64)}`, `provenanceSha256: ${hash("areaforge-provenance.json")}`)
    .replace(`composeSha256: ${"f".repeat(64)}`, `composeSha256: ${hash("docker-compose.prod.yml")}`);
}

function requireFile(file: string): Buffer {
  return readFileSync(file);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/release-supply-chain-validate.ts", ...args], {
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

function createRecord(): string {
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
