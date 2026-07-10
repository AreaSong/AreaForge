import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type ReleaseManifest = {
  schemaVersion?: unknown;
  app?: unknown;
  version?: unknown;
  channel?: unknown;
  gitCommit?: unknown;
  webImageDigest?: unknown;
  migrationImageDigest?: unknown;
  releaseNotesUrl?: unknown;
};

const assetDir = path.resolve(process.argv[2] ?? process.env.AREAFORGE_RELEASE_ASSET_DIR ?? ".");
const usage = "Usage: pnpm release:supply-chain:record <release-assets-dir>";

function main(): void {
  const manifest = readManifest();
  const required = requiredEnv();
  if (required.missing.length > 0) {
    console.error(`FAIL release supply-chain record generation: missing ${required.missing.join(", ")}`);
    console.error(usage);
    process.exit(1);
  }

  const version = stringOrNull(manifest.version) ?? stringOrNull(process.env.AREAFORGE_RELEASE_VERSION);
  const releaseTag = stringOrNull(process.env.AREAFORGE_RELEASE_TAG) ?? (version ? versionTag(version) : null);
  const releaseUrl = stringOrNull(process.env.AREAFORGE_RELEASE_URL) ??
    stringOrNull(manifest.releaseNotesUrl) ??
    (releaseTag ? `https://github.com/AreaSong/AreaForge/releases/tag/${releaseTag}` : null);
  const gitCommit = stringOrNull(process.env.AREAFORGE_GIT_COMMIT) ?? stringOrNull(manifest.gitCommit);
  const channel = normalizeChannel(stringOrNull(manifest.channel) ?? process.env.AREAFORGE_RELEASE_CHANNEL);

  const missingRelease = [
    version ? null : "release version",
    releaseTag ? null : "release tag",
    releaseUrl ? null : "release URL",
    gitCommit ? null : "git commit",
  ].filter(Boolean);
  if (missingRelease.length > 0) {
    console.error(`FAIL release supply-chain record generation: missing ${missingRelease.join(", ")}`);
    console.error(usage);
    process.exit(1);
  }

  const coveredAssets = sha256SumsCovers();
  const record = [
    `recordId: ${stringOrNull(process.env.AREAFORGE_RELEASE_SUPPLY_CHAIN_RECORD_ID) ?? `release-supply-chain-${releaseTag}`}`,
    `recordedAt: ${stringOrNull(process.env.AREAFORGE_RELEASE_SUPPLY_CHAIN_RECORDED_AT) ?? new Date().toISOString()}`,
    `releaseTag: ${releaseTag}`,
    `releaseUrl: ${releaseUrl}`,
    `workflowRunUrl: ${required.values.workflowRunUrl}`,
    `workflowRunConclusion: ${required.values.workflowRunConclusion}`,
    `gitCommit: ${gitCommit}`,
    `channel: ${channel}`,
    `packageVersion: ${version}`,
    `validateJobStatus: ${required.values.validateJobStatus}`,
    `auditProdStatus: ${required.values.auditProdStatus}`,
    `governancePreflightStatus: ${required.values.governancePreflightStatus}`,
    `actionsPinningStatus: ${required.values.actionsPinningStatus}`,
    `releaseWorkflowStatus: ${required.values.releaseWorkflowStatus}`,
    `webImageDigest: ${stringOrNull(manifest.webImageDigest) ?? process.env.AREAFORGE_WEB_IMAGE_DIGEST ?? ""}`,
    `migrationImageDigest: ${stringOrNull(manifest.migrationImageDigest) ?? process.env.AREAFORGE_MIGRATION_IMAGE_DIGEST ?? ""}`,
    "manifestAsset: areaforge-release-manifest.json",
    "sbomAsset: areaforge-sbom.spdx.json",
    "provenanceAsset: areaforge-provenance.json",
    "sha256SumsAsset: SHA256SUMS",
    "signatureAsset: SHA256SUMS.sig",
    `sha256SumsCovers: ${coveredAssets.join(",")}`,
    `checksumVerification: ${required.values.checksumVerification}`,
    `signatureVerification: ${required.values.signatureVerification}`,
    `manifestSha256: ${assetSha256("areaforge-release-manifest.json")}`,
    `sbomSha256: ${assetSha256("areaforge-sbom.spdx.json")}`,
    `provenanceSha256: ${assetSha256("areaforge-provenance.json")}`,
    `composeSha256: ${assetSha256("docker-compose.prod.yml")}`,
    `stableSigningRequired: ${channel === "stable" ? "yes" : "no"}`,
    `unsignedPlaceholderPresent: ${required.values.unsignedPlaceholderPresent}`,
    "residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002",
    `followUpTasks: ${stringOrNull(process.env.AREAFORGE_RELEASE_SUPPLY_CHAIN_FOLLOW_UPS) ?? "tasks/indexes/residuals.md"}`,
    "safetyFacts:",
    "  secretsPrinted: no",
    "  productionEnvIncluded: no",
    "  backupIncluded: no",
    "  promptOrRawAiResponseIncluded: no",
    "  attachmentContentIncluded: no",
    "  productionWriteAttempted: no",
    "",
  ].join("\n");

  process.stdout.write(record);
}

function requiredEnv(): {
  missing: string[];
  values: {
    workflowRunUrl: string;
    workflowRunConclusion: "success";
    validateJobStatus: "pass";
    auditProdStatus: "pass";
    governancePreflightStatus: "pass";
    actionsPinningStatus: "pass";
    releaseWorkflowStatus: "pass";
    checksumVerification: "pass";
    signatureVerification: "pass";
    unsignedPlaceholderPresent: "no";
  };
} {
  const entries = {
    workflowRunUrl: stringOrNull(process.env.AREAFORGE_RELEASE_WORKFLOW_RUN_URL),
    workflowRunConclusion: process.env.AREAFORGE_RELEASE_WORKFLOW_RUN_CONCLUSION === "success" ? "success" as const : null,
    validateJobStatus: process.env.AREAFORGE_VALIDATE_JOB_STATUS === "pass" ? "pass" as const : null,
    auditProdStatus: process.env.AREAFORGE_AUDIT_PROD_STATUS === "pass" ? "pass" as const : null,
    governancePreflightStatus: process.env.AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS === "pass" ? "pass" as const : null,
    actionsPinningStatus: process.env.AREAFORGE_ACTIONS_PINNING_STATUS === "pass" ? "pass" as const : null,
    releaseWorkflowStatus: process.env.AREAFORGE_RELEASE_WORKFLOW_STATUS === "pass" ? "pass" as const : null,
    checksumVerification: process.env.AREAFORGE_CHECKSUM_VERIFICATION === "pass" ? "pass" as const : null,
    signatureVerification: process.env.AREAFORGE_SIGNATURE_VERIFICATION === "pass" ? "pass" as const : null,
    unsignedPlaceholderPresent: process.env.AREAFORGE_UNSIGNED_PLACEHOLDER_PRESENT === "no" ? "no" as const : null,
  };
  return {
    missing: Object.entries(entries).filter(([, value]) => !value).map(([key]) => envNameFor(key)),
    values: entries as {
      workflowRunUrl: string;
      workflowRunConclusion: "success";
      validateJobStatus: "pass";
      auditProdStatus: "pass";
      governancePreflightStatus: "pass";
      actionsPinningStatus: "pass";
      releaseWorkflowStatus: "pass";
      checksumVerification: "pass";
      signatureVerification: "pass";
      unsignedPlaceholderPresent: "no";
    },
  };
}

function readManifest(): ReleaseManifest {
  const manifest = JSON.parse(readAsset("areaforge-release-manifest.json")) as ReleaseManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error(`release manifest schemaVersion is ${String(manifest.schemaVersion)}`);
  }
  if (manifest.app !== "AreaForge") {
    throw new Error(`release manifest app is ${String(manifest.app)}`);
  }
  return manifest;
}

function sha256SumsCovers(): string[] {
  return readAsset("SHA256SUMS")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).pop() ?? "")
    .map((name) => name.replace(/^\*/, ""))
    .filter(Boolean);
}

function assetSha256(name: string): string {
  const sum = readAsset("SHA256SUMS")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(` ${name}`) || line.endsWith(` *${name}`));
  if (!sum) {
    throw new Error(`SHA256SUMS does not cover ${name}`);
  }
  return sum.split(/\s+/)[0] ?? "";
}

function readAsset(name: string): string {
  const filePath = path.join(assetDir, name);
  if (!existsSync(filePath)) {
    throw new Error(`release asset missing: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function envNameFor(key: string): string {
  const names: Record<string, string> = {
    workflowRunUrl: "AREAFORGE_RELEASE_WORKFLOW_RUN_URL",
    workflowRunConclusion: "AREAFORGE_RELEASE_WORKFLOW_RUN_CONCLUSION=success",
    validateJobStatus: "AREAFORGE_VALIDATE_JOB_STATUS=pass",
    auditProdStatus: "AREAFORGE_AUDIT_PROD_STATUS=pass",
    governancePreflightStatus: "AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS=pass",
    actionsPinningStatus: "AREAFORGE_ACTIONS_PINNING_STATUS=pass",
    releaseWorkflowStatus: "AREAFORGE_RELEASE_WORKFLOW_STATUS=pass",
    checksumVerification: "AREAFORGE_CHECKSUM_VERIFICATION=pass",
    signatureVerification: "AREAFORGE_SIGNATURE_VERIFICATION=pass",
    unsignedPlaceholderPresent: "AREAFORGE_UNSIGNED_PLACEHOLDER_PRESENT=no",
  };
  return names[key] ?? key;
}

function normalizeChannel(value: string | null | undefined): "stable" | "preview" {
  return value === "preview" ? "preview" : "stable";
}

function versionTag(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

main();
