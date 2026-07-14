import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveReleaseEvidenceValidationArgs } from "../quality/release-evidence-validate";

type GateStatus = "pass" | "needs_attention" | "blocked";

type ResidualItem = {
  id: string;
  type: string;
  reviewAt: string;
  ownerSkills: string[];
};

type ValidatorResult = {
  status: "pass" | "fail" | "missing";
  command: string;
  issueFields: string[];
};

type AuditCheck = {
  status: GateStatus;
  detail: string;
};

export type ReleaseCloseoutAudit = {
  schemaVersion: 1;
  mode: "read_only_release_closeout_audit";
  generatedAt: string;
  version: string;
  releaseTag: string;
  status: "blocked" | "needs_attention" | "ready_for_human_review";
  source: {
    releaseRecord: string;
    supplyChainRecord: string;
    operationalEvidenceBundle: string | null;
    residualLedger: "docs/development/residual-risk-ledger.json";
    inputHashes: Array<{ key: string; path: string; sha256: string }>;
  };
  checks: {
    releaseRecord: AuditCheck & { validator: ValidatorResult };
    supplyChainRecord: AuditCheck & { validator: ValidatorResult };
    identityConsistency: AuditCheck;
    residualConsistency: AuditCheck;
    operationalEvidence: AuditCheck;
    rollbackTarget: AuditCheck;
  };
  identity: {
    releaseGitCommit: string | null;
    supplyChainGitCommit: string | null;
    webImageDigest: string | null;
    migrationImageDigest: string | null;
  };
  residuals: {
    releaseRecordIds: string[];
    supplyChainRecordIds: string[];
    missingLedgerIds: string[];
    releaseOnlyIds: string[];
    supplyChainOnlyIds: string[];
    currentBlockerIds: string[];
    needsAttentionIds: string[];
    records: Array<Pick<ResidualItem, "id" | "type" | "reviewAt" | "ownerSkills">>;
  };
  blockedBy: string[];
  doesNotProve: string[];
  forbiddenActions: string[];
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    serverCommandAttempted: false;
    productionWriteAttempted: false;
    updaterApplyAttempted: false;
    releaseCreated: false;
    residualLedgerUpdated: false;
    residualClosed: false;
    secretValuePrinted: false;
  };
  auditHash: string;
};

type BuildOptions = {
  root?: string;
  version?: string;
  generatedAt?: string;
  validatorRunner?: (script: string, recordPath: string, root: string) => ValidatorResult;
};

const ledgerPath = "docs/development/residual-risk-ledger.json" as const;
const versionPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^(?:sha256:)?[a-f0-9]{64}$/i;
const imageDigestPattern = /@sha256:[a-f0-9]{64}$/i;

export function buildReleaseCloseoutAudit(options: BuildOptions = {}): ReleaseCloseoutAudit {
  const root = options.root ?? process.cwd();
  const version = options.version ?? readPackageVersion(root);
  if (!versionPattern.test(version)) throw new Error(`Invalid version ${version}; expected X.Y.Z`);

  const releaseTag = `v${version}`;
  const releaseRecordPath = `docs/development/release-v${version}-record.md`;
  const supplyChainRecordPath = `docs/development/release-supply-chain-v${version}.md`;
  const releaseRaw = readOptional(root, releaseRecordPath);
  const supplyRaw = readOptional(root, supplyChainRecordPath);
  const releaseFields = parseIndentedKeyValueRecord(releaseRaw ?? "");
  const supplyFields = parseIndentedKeyValueRecord(supplyRaw ?? "");
  const operationalEvidencePath = safeRepositoryPath(releaseFields.get("operationalEvidenceBundlePath"));
  const operationalRaw = operationalEvidencePath ? readOptional(root, operationalEvidencePath) : null;
  const operationalBundle = parseJsonRecord(operationalRaw);
  const ledger = readLedger(root);
  const validatorRunner = options.validatorRunner ?? runValidator;

  const releaseValidator = releaseRaw
    ? validatorRunner("scripts/quality/release-evidence-validate.ts", releaseRecordPath, root)
    : missingValidator("pnpm release:evidence:validate");
  const supplyValidator = supplyRaw
    ? validatorRunner("scripts/quality/release-supply-chain-validate.ts", supplyChainRecordPath, root)
    : missingValidator("pnpm release:supply-chain:validate");

  const releaseIds = parseList(releaseFields.get("residualRiskIds"));
  const supplyIds = parseList(supplyFields.get("residualRiskIds"));
  const referencedIds = [...new Set([...releaseIds, ...supplyIds])].sort();
  const ledgerById = new Map(ledger.map((item) => [item.id, item]));
  const missingLedgerIds = referencedIds.filter((id) => !ledgerById.has(id));
  const residualRecords = referencedIds.flatMap((id) => {
    const item = ledgerById.get(id);
    return item ? [{ id: item.id, type: item.type, reviewAt: item.reviewAt, ownerSkills: item.ownerSkills }] : [];
  });
  const currentBlockerIds = residualRecords.filter((item) => item.type === "current-blocker").map((item) => item.id);
  const needsAttentionIds = residualRecords
    .filter((item) => ["deferred-work", "monitoring-gap", "release-follow-up"].includes(item.type))
    .map((item) => item.id);

  const checks = {
    releaseRecord: validatorCheck(releaseValidator, releaseRecordPath),
    supplyChainRecord: validatorCheck(supplyValidator, supplyChainRecordPath),
    identityConsistency: identityCheck(version, releaseFields, supplyFields),
    residualConsistency: residualCheck(missingLedgerIds, currentBlockerIds, needsAttentionIds),
    operationalEvidence: operationalEvidenceCheck(releaseFields, operationalEvidencePath, operationalBundle),
    rollbackTarget: rollbackTargetCheck(releaseFields),
  };
  const blockedBy = Object.entries(checks)
    .filter(([, check]) => check.status !== "pass")
    .map(([key, check]) => `${key}: ${check.detail}`);
  const statuses = Object.values(checks).map((check) => check.status);
  const status = statuses.includes("blocked")
    ? "blocked"
    : statuses.includes("needs_attention") ? "needs_attention" : "ready_for_human_review";

  const inputPaths = [releaseRecordPath, supplyChainRecordPath, ledgerPath, ...(operationalEvidencePath ? [operationalEvidencePath] : [])];
  const resultWithoutHash = {
    schemaVersion: 1 as const,
    mode: "read_only_release_closeout_audit" as const,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    version,
    releaseTag,
    status,
    source: {
      releaseRecord: releaseRecordPath,
      supplyChainRecord: supplyChainRecordPath,
      operationalEvidenceBundle: operationalEvidencePath,
      residualLedger: ledgerPath,
      inputHashes: inputPaths.flatMap((file) => {
        const raw = readOptional(root, file);
        return raw === null ? [] : [{ key: sourceKey(file), path: file, sha256: `sha256:${sha256(raw)}` }];
      }),
    },
    checks,
    identity: {
      releaseGitCommit: stringOrNull(releaseFields.get("gitCommit")),
      supplyChainGitCommit: stringOrNull(supplyFields.get("gitCommit")),
      webImageDigest: stringOrNull(releaseFields.get("webImageDigest") ?? releaseFields.get("imageDigest")),
      migrationImageDigest: stringOrNull(releaseFields.get("migrationImageDigest")),
    },
    residuals: {
      releaseRecordIds: releaseIds,
      supplyChainRecordIds: supplyIds,
      missingLedgerIds,
      releaseOnlyIds: releaseIds.filter((id) => !supplyIds.includes(id)),
      supplyChainOnlyIds: supplyIds.filter((id) => !releaseIds.includes(id)),
      currentBlockerIds,
      needsAttentionIds,
      records: residualRecords,
    },
    blockedBy,
    doesNotProve: [
      "current production health",
      "backup existence or restore success",
      "rollback execution",
      "production write smoke safety",
      "residual risk closure",
      "future release readiness",
    ],
    forbiddenActions: [
      "execute_server_command",
      "apply_update",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "create_github_release",
      "push_git_tag",
      "update_residual_ledger",
      "close_residual_risk",
      "read_or_print_secret_values",
    ],
    safetyFacts: {
      readOnly: true as const,
      networkRequested: false as const,
      serverCommandAttempted: false as const,
      productionWriteAttempted: false as const,
      updaterApplyAttempted: false as const,
      releaseCreated: false as const,
      residualLedgerUpdated: false as const,
      residualClosed: false as const,
      secretValuePrinted: false as const,
    },
  };

  return { ...resultWithoutHash, auditHash: hashAudit(resultWithoutHash) };
}

function validatorCheck(result: ValidatorResult, recordPath: string): AuditCheck & { validator: ValidatorResult } {
  return {
    status: result.status === "pass" ? "pass" : "blocked",
    detail: result.status === "pass"
      ? `${recordPath} validator passed`
      : `${recordPath} validator ${result.status}${result.issueFields.length ? ` (${result.issueFields.join(", ")})` : ""}`,
    validator: result,
  };
}

function identityCheck(version: string, release: Map<string, string>, supply: Map<string, string>): AuditCheck {
  const mismatches: string[] = [];
  compareIdentity("releaseTag", release.get("releaseTag"), supply.get("releaseTag"), `v${version}`, mismatches);
  compareIdentity("gitCommit", release.get("gitCommit"), supply.get("gitCommit"), null, mismatches);
  compareIdentity("webImageDigest", release.get("webImageDigest") ?? release.get("imageDigest"), supply.get("webImageDigest"), null, mismatches);
  compareIdentity("migrationImageDigest", release.get("migrationImageDigest"), supply.get("migrationImageDigest"), null, mismatches);
  if (supply.get("packageVersion") !== version) mismatches.push("packageVersion");
  return mismatches.length === 0
    ? { status: "pass", detail: "release tag, package version, commit, and image digests match" }
    : { status: "blocked", detail: `identity mismatch: ${[...new Set(mismatches)].join(", ")}` };
}

function residualCheck(missing: string[], current: string[], attention: string[]): AuditCheck {
  if (missing.length > 0) return { status: "blocked", detail: `residual IDs missing from ledger: ${missing.join(", ")}` };
  if (current.length > 0) return { status: "blocked", detail: `current blocker residuals: ${current.join(", ")}` };
  if (attention.length > 0) return { status: "needs_attention", detail: `open release residuals: ${attention.join(", ")}` };
  return { status: "pass", detail: "all referenced residual IDs exist and none is a current blocker" };
}

function operationalEvidenceCheck(
  release: Map<string, string>,
  evidencePath: string | null,
  bundle: Record<string, unknown> | null,
): AuditCheck {
  if (!evidencePath || !bundle) return { status: "blocked", detail: "operational evidence bundle is missing or invalid" };
  const recordedHash = normalizeSha256(release.get("operationalEvidenceBundleHash"));
  const bundleHash = normalizeSha256(typeof bundle.bundleHash === "string" ? bundle.bundleHash : null);
  if (!recordedHash || !bundleHash || recordedHash !== bundleHash) {
    return { status: "blocked", detail: "operationalEvidenceBundleHash does not match the referenced bundleHash" };
  }
  const bundleStatus = typeof bundle.status === "string" ? bundle.status : "unknown";
  const summary = isRecord(bundle.summary) && typeof bundle.summary.overall === "string" ? bundle.summary.overall : "unknown";
  if (bundleStatus !== "ready" || summary !== "pass") {
    return { status: "needs_attention", detail: `bundle status=${bundleStatus}; summary=${summary}` };
  }
  return { status: "pass", detail: "referenced operational evidence bundle hash and ready status match" };
}

function rollbackTargetCheck(release: Map<string, string>): AuditCheck {
  const targetVersion = release.get("rollbackTargetVersion");
  const previousVersion = release.get("previousAppVersion");
  const targetImage = release.get("rollbackTargetImage");
  const previousImage = release.get("previousImage");
  const valid = Boolean(
    targetVersion && versionPattern.test(targetVersion) && targetVersion === previousVersion &&
    targetImage && imageDigestPattern.test(targetImage) && targetImage === previousImage,
  );
  return valid
    ? { status: "pass", detail: "rollback target version/image match the recorded previous release" }
    : { status: "blocked", detail: "rollback target must match previousAppVersion and previousImage immutable digest" };
}

function runValidator(script: string, recordPath: string, root: string): ValidatorResult {
  const validatorArgs = script.endsWith("release-evidence-validate.ts")
    ? resolveReleaseEvidenceValidationArgs(recordPath, root)
    : [recordPath];
  const result = spawnSync("pnpm", ["exec", "tsx", script, ...validatorArgs], { cwd: root, encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const issueFields = [...new Set([...output.matchAll(/^FAIL\s+([^:]+):/gm)].map((match) => match[1] ?? "unknown"))].sort();
  return {
    status: result.status === 0 ? "pass" : "fail",
    command: `pnpm exec tsx ${script} ${validatorArgs.map((value) => path.relative(root, value) || path.basename(value)).join(" ")}`,
    issueFields,
  };
}

function missingValidator(command: string): ValidatorResult {
  return { status: "missing", command, issueFields: [] };
}

function compareIdentity(field: string, left: string | undefined, right: string | undefined, expected: string | null, mismatches: string[]): void {
  if (!left || !right || left !== right || (expected !== null && left !== expected)) mismatches.push(field);
}

function parseIndentedKeyValueRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentSection = "";
  for (const rawLine of record.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const match = rawLine.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    const value = match[3]?.trim() ?? "";
    if (indent === 0) {
      currentSection = value ? "" : key;
      fields.set(key, value);
    } else if (currentSection) {
      fields.set(`${currentSection}.${key}`, value);
    }
  }
  return fields;
}

function readLedger(root: string): ResidualItem[] {
  const raw = readOptional(root, ledgerPath);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { items?: ResidualItem[] };
  return parsed.items ?? [];
}

function readPackageVersion(root: string): string {
  const parsed = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  if (!parsed.version) throw new Error("package.json version is required");
  return parsed.version;
}

function readOptional(root: string, file: string): string | null {
  const fullPath = path.join(root, file);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : null;
}

function safeRepositoryPath(value: string | undefined): string | null {
  if (!value || path.isAbsolute(value) || value.split("/").includes("..")) return null;
  return value.startsWith("docs/development/") ? value : null;
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseList(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))].sort();
}

function normalizeSha256(value: string | null | undefined): string | null {
  if (!value || !sha256Pattern.test(value)) return null;
  return value.toLowerCase().startsWith("sha256:") ? value.toLowerCase() : `sha256:${value.toLowerCase()}`;
}

function stringOrNull(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function sourceKey(file: string): string {
  if (file === ledgerPath) return "residualLedger";
  if (file.includes("release-supply-chain")) return "supplyChainRecord";
  if (file.includes("operational-evidence-bundle")) return "operationalEvidenceBundle";
  return "releaseRecord";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashAudit(value: Omit<ReleaseCloseoutAudit, "auditHash"> | Record<string, unknown>): string {
  return `sha256:${sha256(JSON.stringify(value))}`;
}

function parseCli(args: string[]): { version?: string } {
  let version: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg?.startsWith("--version=")) {
      version = arg.slice("--version=".length);
      continue;
    }
    if (arg === "--version" && args[index + 1]) {
      version = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { version };
}

function main(): void {
  try {
    const options = parseCli(process.argv.slice(2));
    console.log(JSON.stringify(buildReleaseCloseoutAudit(options), null, 2));
  } catch (error) {
    console.error(`release closeout audit failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
