import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseStrictIndentedKeyValueRecord } from "./record-validator-common";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ReleaseSupplyChainValidationOptions {
  assetDir?: string;
  strict?: boolean;
  cosignPublicKey?: string;
  verifySignature?: (input: { publicKey: string; signature: string; checksums: string }) => void;
}

const requiredScalarFields = [
  "recordId",
  "recordedAt",
  "releaseTag",
  "releaseUrl",
  "workflowRunUrl",
  "workflowRunConclusion",
  "gitCommit",
  "channel",
  "packageVersion",
  "validateJobStatus",
  "auditProdStatus",
  "governancePreflightStatus",
  "actionsPinningStatus",
  "releaseWorkflowStatus",
  "webImageDigest",
  "migrationImageDigest",
  "manifestAsset",
  "sbomAsset",
  "provenanceAsset",
  "sha256SumsAsset",
  "signatureAsset",
  "sha256SumsCovers",
  "checksumVerification",
  "signatureVerification",
  "manifestSha256",
  "sbomSha256",
  "provenanceSha256",
  "composeSha256",
  "stableSigningRequired",
  "unsignedPlaceholderPresent",
  "residualRiskIds",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "safetyFacts.secretsPrinted",
  "safetyFacts.productionEnvIncluded",
  "safetyFacts.backupIncluded",
  "safetyFacts.promptOrRawAiResponseIncluded",
  "safetyFacts.attachmentContentIncluded",
  "safetyFacts.productionWriteAttempted",
] as const;

const passFailFields = [
  "validateJobStatus",
  "auditProdStatus",
  "governancePreflightStatus",
  "actionsPinningStatus",
  "releaseWorkflowStatus",
  "checksumVerification",
  "signatureVerification",
] as const;

const yesNoFields = [
  "stableSigningRequired",
  "unsignedPlaceholderPresent",
  ...requiredNestedFields,
] as const;

const requiredChecksumAssets = [
  "areaforge-release-manifest.json",
  "areaforge-sbom.spdx.json",
  "areaforge-provenance.json",
  "docker-compose.prod.yml",
];

const secretPatterns = [
  { label: "DATABASE_URL", pattern: /postgres(?:ql)?:\/\/[^ \n]+/i },
  { label: "API key", pattern: /\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/ },
  { label: "AUTH_SESSION_SECRET", pattern: /AUTH_SESSION_SECRET\s*=\s*\S+/i },
  { label: "AI_API_KEY", pattern: /AI_API_KEY\s*=\s*\S+/i },
  { label: "COSIGN private key", pattern: /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/i },
  { label: "COSIGN_PASSWORD", pattern: /COSIGN_PASSWORD\s*=\s*\S+/i },
  { label: "raw prompt", pattern: /\b(prompt|rawResponse|fullReviewText|attachmentContent)\b/i },
];

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm release:supply-chain:validate <release-supply-chain-record.md|txt> [release-assets-dir]");
    process.exit(2);
  }

  const args = process.argv.slice(3);
  const strict = args.includes("--strict");
  const assetDirArg = args.find((value) => value !== "--strict");
  const absoluteRecordPath = path.resolve(recordPath);
  const record = readRequiredFile(absoluteRecordPath);
  const issues = validateReleaseSupplyChainRecord(record, {
    assetDir: assetDirArg ? path.resolve(assetDirArg) : undefined,
    strict,
    cosignPublicKey: process.env.AREAFORGE_COSIGN_PUBLIC_KEY?.trim() ||
      path.join(process.cwd(), "docs/deployment/keys/areaforge-cosign.pub"),
  });

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`release supply-chain record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log(`release supply-chain record validation passed: mode=${strict ? "strict-assets" : "record"}, stable release assets, checksums, signature policy, CI/audit gates, SC residual IDs, and safety facts are present.`);
  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(record, parseIssues);
  console.log(`releaseSupplyChainEvidenceHash: ${buildReleaseSupplyChainEvidenceHash(fields)}`);
  console.log("safetyFacts: secretsPrinted=false productionEnvIncluded=false backupIncluded=false promptOrRawAiResponseIncluded=false attachmentContentIncluded=false productionWriteAttempted=false");
}

export function validateReleaseSupplyChainRecord(
  record: string,
  options: ReleaseSupplyChainValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(record, issues);
  validateRecordShape(fields, issues);
  issues.push(...validateRecord(record, fields));
  if (options.strict && !options.assetDir) {
    issues.push({ field: "assetDir", message: "is required in strict mode" });
    return issues;
  }
  if (options.assetDir) {
    issues.push(...validateAssetDirectory(fields, path.resolve(options.assetDir), options));
  }
  return issues;
}

function validateRecordShape(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const expected = new Set<string>([
    ...requiredScalarFields,
    "safetyFacts",
    ...requiredNestedFields,
  ]);
  for (const field of fields.keys()) {
    if (!expected.has(field)) issues.push({ field, message: "is not allowed in a release supply-chain record" });
  }
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireOneOf(fields, "workflowRunConclusion", ["success", "failure", "cancelled"], issues);
  requireOneOf(fields, "channel", ["stable", "preview"], issues);
  for (const field of passFailFields) {
    requireOneOf(fields, field, ["pass", "fail"], issues);
  }
  for (const field of yesNoFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
  }

  if (fields.get("channel")?.toLowerCase() !== "stable") {
    issues.push({ field: "channel", message: "must be stable for SC-001/SC-002 closure evidence" });
  }
  if (fields.get("workflowRunConclusion")?.toLowerCase() !== "success") {
    issues.push({ field: "workflowRunConclusion", message: "must be success" });
  }
  for (const field of passFailFields) {
    if (fields.get(field)?.toLowerCase() !== "pass") {
      issues.push({ field, message: "must be pass" });
    }
  }
  if (fields.get("stableSigningRequired")?.toLowerCase() !== "yes") {
    issues.push({ field: "stableSigningRequired", message: "must be yes" });
  }
  if (fields.get("unsignedPlaceholderPresent")?.toLowerCase() !== "no") {
    issues.push({ field: "unsignedPlaceholderPresent", message: "must be no for stable release evidence" });
  }

  const releaseTag = fields.get("releaseTag");
  if (releaseTag && !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
    issues.push({ field: "releaseTag", message: "must look like vX.Y.Z" });
  }
  const packageVersion = fields.get("packageVersion");
  if (packageVersion && !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    issues.push({ field: "packageVersion", message: "must look like X.Y.Z" });
  }
  if (releaseTag && packageVersion && releaseTag !== `v${packageVersion}`) {
    issues.push({ field: "packageVersion", message: "must match releaseTag without v prefix" });
  }

  for (const field of ["releaseUrl", "workflowRunUrl"] as const) {
    const value = fields.get(field);
    if (value && !/^https:\/\/github\.com\/AreaSong\/AreaForge\/.+/i.test(value)) {
      issues.push({ field, message: "must be a GitHub AreaSong/AreaForge HTTPS URL" });
    }
  }

  const gitCommit = fields.get("gitCommit");
  if (gitCommit && !/^[a-f0-9]{40}$/i.test(gitCommit)) {
    issues.push({ field: "gitCommit", message: "must be a 40-character commit SHA" });
  }

  for (const field of ["webImageDigest", "migrationImageDigest"] as const) {
    const value = fields.get(field);
    if (value && !/@sha256:[a-f0-9]{64}$/i.test(value)) {
      issues.push({ field, message: "must end with @sha256:<64-hex>" });
    }
  }

  const exactAssets: Record<string, string> = {
    manifestAsset: "areaforge-release-manifest.json",
    sbomAsset: "areaforge-sbom.spdx.json",
    provenanceAsset: "areaforge-provenance.json",
    sha256SumsAsset: "SHA256SUMS",
    signatureAsset: "SHA256SUMS.sig",
  };
  for (const [field, expected] of Object.entries(exactAssets)) {
    if (fields.get(field) && fields.get(field) !== expected) {
      issues.push({ field, message: `must be ${expected}` });
    }
  }

  const coveredAssets = parseList(fields.get("sha256SumsCovers") ?? "");
  const missingAssets = requiredChecksumAssets.filter((asset) => !coveredAssets.includes(asset.toLowerCase()));
  if (missingAssets.length > 0) {
    issues.push({ field: "sha256SumsCovers", message: `missing ${missingAssets.join(", ")}` });
  }

  for (const field of ["manifestSha256", "sbomSha256", "provenanceSha256", "composeSha256"] as const) {
    const value = fields.get(field);
    if (value && !/^[a-f0-9]{64}$/i.test(value)) {
      issues.push({ field, message: "must be a 64-character sha256 hex digest" });
    }
  }

  const residualRiskIds = fields.get("residualRiskIds") ?? "";
  for (const id of ["AF-RISK-SC-001", "AF-RISK-SC-002"]) {
    if (!residualRiskIds.includes(id)) {
      issues.push({ field: "residualRiskIds", message: `must include ${id}` });
    }
  }

  for (const field of requiredNestedFields) {
    if (fields.get(field)?.toLowerCase() !== "no") {
      issues.push({ field, message: "must be no" });
    }
  }

  for (const item of secretPatterns) {
    if (item.pattern.test(record)) {
      issues.push({ field: "record", message: `must not contain ${item.label}` });
    }
  }

  return issues;
}

function validateAssetDirectory(
  fields: Map<string, string>,
  assetDir: string,
  options: ReleaseSupplyChainValidationOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!existsSync(assetDir)) {
    issues.push({ field: "assetDir", message: "does not exist" });
    return issues;
  }
  const assetDirStat = lstatSync(assetDir);
  if (assetDirStat.isSymbolicLink() || !assetDirStat.isDirectory()) {
    issues.push({ field: "assetDir", message: "must be a real non-symlink directory" });
    return issues;
  }
  const assetHashFields: Record<string, string> = {
    manifestAsset: "manifestSha256",
    sbomAsset: "sbomSha256",
    provenanceAsset: "provenanceSha256",
  };
  const composeAsset = "docker-compose.prod.yml";
  const sha256SumsAsset = fields.get("sha256SumsAsset") ?? "SHA256SUMS";
  const signatureAsset = fields.get("signatureAsset") ?? "SHA256SUMS.sig";

  const sumsPath = safeRegularFile(assetDir, sha256SumsAsset, "assetDir.SHA256SUMS", issues);
  if (!sumsPath) {
    issues.push({ field: "assetDir.SHA256SUMS", message: `${sha256SumsAsset} is missing` });
    return issues;
  }

  const sums = parseSha256Sums(readRequiredFile(sumsPath));
  for (const [assetField, hashField] of Object.entries(assetHashFields)) {
    const assetName = fields.get(assetField);
    if (!assetName) continue;
    compareAssetHash(assetDir, assetName, hashField, fields.get(hashField), sums, issues);
  }
  compareAssetHash(assetDir, composeAsset, "composeSha256", fields.get("composeSha256"), sums, issues);

  const signaturePath = safeRegularFile(assetDir, signatureAsset, "assetDir.signatureAsset", issues);
  if (!signaturePath) {
    issues.push({ field: "assetDir.signatureAsset", message: `${signatureAsset} is missing` });
  }
  validateManifestIdentity(fields, assetDir, issues);
  if (options.strict && signaturePath) {
    const publicKey = options.cosignPublicKey ? path.resolve(options.cosignPublicKey) : "";
    if (!publicKey || !existsSync(publicKey) || lstatSync(publicKey).isSymbolicLink() || !lstatSync(publicKey).isFile()) {
      issues.push({ field: "cosignPublicKey", message: "must be a regular non-symlink public key file in strict mode" });
    } else if (readFileSync(signaturePath, "utf8").includes("unsigned preview")) {
      issues.push({ field: "assetDir.signatureAsset", message: "unsigned placeholder is forbidden in strict mode" });
    } else {
      try {
        (options.verifySignature ?? verifyCosignSignature)({
          publicKey,
          signature: signaturePath,
          checksums: sumsPath,
        });
      } catch {
        issues.push({ field: "assetDir.signatureAsset", message: "cosign signature verification failed" });
      }
    }
  }
  return issues;
}

function validateManifestIdentity(fields: Map<string, string>, assetDir: string, issues: ValidationIssue[]): void {
  const manifestName = fields.get("manifestAsset") ?? "areaforge-release-manifest.json";
  const manifestPath = safeRegularFile(assetDir, manifestName, "assetDir.manifestAsset", issues);
  if (!manifestPath) return;
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid manifest");
    manifest = parsed as Record<string, unknown>;
  } catch {
    issues.push({ field: "assetDir.manifestAsset", message: "must be valid JSON" });
    return;
  }
  const expected: Array<[string, string, unknown]> = [
    ["packageVersion", "version", manifest.version],
    ["channel", "channel", manifest.channel],
    ["gitCommit", "gitCommit", manifest.gitCommit],
    ["webImageDigest", "webImageDigest", manifest.webImageDigest],
    ["migrationImageDigest", "migrationImageDigest", manifest.migrationImageDigest],
    ["releaseUrl", "releaseNotesUrl", manifest.releaseNotesUrl],
  ];
  if (manifest.schemaVersion !== 1) issues.push({ field: "assetDir.manifestAsset", message: "schemaVersion must be 1" });
  if (manifest.app !== "AreaForge") issues.push({ field: "assetDir.manifestAsset", message: "app must be AreaForge" });
  for (const [recordField, manifestField, manifestValue] of expected) {
    if (fields.get(recordField) !== manifestValue) {
      issues.push({ field: recordField, message: `must match manifest ${manifestField}` });
    }
  }
}

function safeRegularFile(assetDir: string, name: string, field: string, issues: ValidationIssue[]): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    issues.push({ field, message: "must be a simple asset name" });
    return null;
  }
  const filePath = path.join(assetDir, name);
  if (!existsSync(filePath)) return null;
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    issues.push({ field, message: "must be a regular non-symlink file" });
    return null;
  }
  return filePath;
}

function verifyCosignSignature(input: { publicKey: string; signature: string; checksums: string }): void {
  execFileSync("cosign", [
    "verify-blob",
    "--key",
    input.publicKey,
    "--bundle",
    input.signature,
    input.checksums,
  ], { stdio: "ignore" });
}

function compareAssetHash(
  assetDir: string,
  assetName: string,
  hashField: string,
  recordHash: string | undefined,
  sums: Map<string, string>,
  issues: ValidationIssue[],
): void {
  const assetPath = path.join(assetDir, assetName);
  if (!existsSync(assetPath)) {
    issues.push({ field: `assetDir.${assetName}`, message: "asset file is missing" });
    return;
  }
  const stat = lstatSync(assetPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    issues.push({ field: `assetDir.${assetName}`, message: "must be a regular non-symlink file" });
    return;
  }
  const actual = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
  const sumHash = sums.get(assetName.toLowerCase());
  if (!sumHash) {
    issues.push({ field: "sha256SumsAsset", message: `missing ${assetName}` });
  } else if (sumHash.toLowerCase() !== actual.toLowerCase()) {
    issues.push({ field: "sha256SumsAsset", message: `${assetName} hash does not match file content` });
  }
  if (recordHash && recordHash.toLowerCase() !== actual.toLowerCase()) {
    issues.push({ field: hashField, message: `does not match ${assetName} file content` });
  }
}

function parseSha256Sums(raw: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hash, name] = trimmed.split(/\s+/, 2);
    if (hash && name) {
      sums.set(name.replace(/^\*/, "").toLowerCase(), hash);
    }
  }
  return sums;
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function requireField(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field);
  if (!value || value.trim().length === 0) {
    issues.push({ field, message: "is required" });
  }
}

function requireOneOf(
  fields: Map<string, string>,
  field: string,
  allowed: string[],
  issues: ValidationIssue[],
): void {
  const value = fields.get(field);
  if (value && !allowed.includes(value.toLowerCase())) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
  }
}

export function buildReleaseSupplyChainEvidenceHash(fields: Map<string, string>): string {
  const keys = [
    ...requiredScalarFields,
    ...requiredNestedFields,
  ].filter((key, index, array) => array.indexOf(key) === index).sort();
  const bundle = keys.map((key) => [key, fields.get(key) ?? ""]);
  const hash = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return `sha256:${hash}`;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  return readFileSync(filePath, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
