import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseIndentedKeyValueRecord, sha256 } from "../quality/record-validator-common";
import {
  buildOps005ExpectedIdentity,
  type Ops005SourceAtCommitReader,
  validateOps005ProductionEvidence,
} from "../quality/ops005-production-evidence-validate";
import {
  validateReleaseSupplyChainRecord,
  type ReleaseSupplyChainValidationOptions,
} from "../quality/release-supply-chain-validate";

export type Ops005PreflightStatus =
  | "needs_local_implementation"
  | "needs_signed_release"
  | "needs_production_evidence"
  | "ready_for_ops005_human_review"
  | "invalid";

type BuildOptions = {
  root?: string;
  now?: Date;
  gitHead?: string;
  gitCommit?: string;
  releaseRecordPath?: string;
  releaseAssetsDir?: string;
  productionEvidencePath?: string;
  sourceAtCommit?: Ops005SourceAtCommitReader;
  gitWorktreeClean?: boolean;
  releaseSignatureVerifier?: ReleaseSupplyChainValidationOptions["verifySignature"];
};

type StageCheck = {
  status: "pass" | "missing" | "invalid";
  detail: string;
};

export function buildOps005EvidencePreflight(options: BuildOptions = {}) {
  const root = options.root ?? process.cwd();
  const packageJson = readJson(root, "package.json");
  const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "unknown";
  const releaseTag = `v${packageVersion}`;
  const gitHead = options.gitHead ?? localGitCommit(root);
  const requestedGitCommit = options.gitCommit ?? process.env.AREAFORGE_OPS005_GIT_COMMIT?.trim() ?? gitHead;
  const gitCommitMatchesHead = /^[a-f0-9]{40}$/i.test(gitHead) && requestedGitCommit === gitHead;
  const gitWorktreeClean = options.gitWorktreeClean ?? localGitWorktreeClean(root);
  const gitIdentityReady = gitWorktreeClean && gitCommitMatchesHead;
  const gitCommit = gitIdentityReady ? requestedGitCommit : "";
  const releaseRecordPath = options.releaseRecordPath ?? process.env.AREAFORGE_OPS005_RELEASE_RECORD?.trim() ??
    `docs/development/release-supply-chain-${releaseTag}.md`;
  const productionEvidencePath = options.productionEvidencePath ??
    process.env.AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD?.trim() ?? "";
  const releaseAssetsDir = options.releaseAssetsDir ?? process.env.AREAFORGE_OPS005_RELEASE_ASSETS_DIR?.trim() ?? "";

  const localImplementation = checkLocalImplementation(root);
  const signedRelease = gitIdentityReady
    ? checkSignedRelease(
      root,
      releaseRecordPath,
      releaseAssetsDir,
      packageVersion,
      releaseTag,
      gitCommit,
      options.releaseSignatureVerifier,
    )
    : { status: "missing", detail: gitWorktreeClean
      ? "requested OPS-005 git commit does not equal the current checkout HEAD"
      : "worktree has uncommitted changes; HEAD cannot identify the verified V2 implementation" } as StageCheck;
  const productionEvidence = gitIdentityReady
    ? checkProductionEvidence(
      root,
      productionEvidencePath,
      packageVersion,
      releaseTag,
      gitCommit,
      releaseRecordPath,
      options.sourceAtCommit,
      options.now ?? envNow(),
    )
    : { status: "missing", detail: gitWorktreeClean
      ? "production evidence cannot bind to a git commit override that differs from HEAD"
      : "production evidence cannot bind to an uncommitted implementation checkout" } as StageCheck;
  const status = stageStatus(localImplementation, signedRelease, productionEvidence);

  return {
    schemaVersion: 1,
    mode: "read_only_ops005_expected_before_preflight",
    generatedAt: (options.now ?? envNow()).toISOString(),
    status,
    packageVersion,
    releaseTag,
    gitHead: /^[a-f0-9]{40}$/i.test(gitHead) ? gitHead : null,
    gitCommit: gitIdentityReady ? gitCommit : null,
    gitCommitMatchesHead,
    gitWorktreeClean,
    checks: {
      localImplementation,
      signedRelease,
      productionEvidence,
    },
    evidence: {
      design: sourceEvidence(root, "docs/development/update-request-expected-before-design.md"),
      activeTask: sourceEvidence(root, "tasks/active/0019-update-request-expected-before-binding.md"),
      releaseRecord: labelledEvidence(root, releaseRecordPath),
      releaseAssets: labelledDirectoryEvidence(root, releaseAssetsDir),
      productionRecord: labelledEvidence(root, productionEvidencePath),
      productionRejection: referencedProductionEvidence(root, productionEvidencePath, "expectedBeforeRejectionEvidenceFile"),
      productionDecisionHistory: referencedProductionEvidence(root, productionEvidencePath, "redactedDecisionHistoryFile"),
      productionOperational: referencedProductionEvidence(root, productionEvidencePath, "operationalEvidenceFile"),
    },
    requiredEvidence: [
      "schema V2, expected-before hash, semantic/request canonical hashes, target identity, idempotency, TTL, atomic publish, processing reconciliation, shared production-state lock, and dual compare local implementation",
      "pnpm ops:ops-005:local:selftest passes on the same clean checkout that becomes the signed Release commit",
      "matching signed Release supply-chain record for the current packageVersion, releaseTag, and gitCommit",
      "fresh redacted OPS-005 production evidence record with bound operational, V2 check, expected-before rejection, and decision-history artifacts",
      "AREAFORGE_AUTO_APPLY=none",
    ],
    nextCommand: nextCommand(status, gitIdentityReady),
    doesNotProve: [
      "source-token presence does not prove pnpm ops:ops-005:local:selftest executed successfully",
      "a dirty worktree does not identify a releasable implementation commit",
      "a git commit override that differs from HEAD cannot identify the current implementation checkout",
      "local validation does not prove Release or production deployment",
    ],
    forbiddenActions: [
      "execute_server_command",
      "apply_update",
      "process_mutation_request",
      "change_auto_apply_policy",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "read_or_print_secret_values",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      updaterApplyAttempted: false,
      mutationRequestExecuted: false,
      autoApplyPolicyChanged: false,
      residualLedgerUpdated: false,
      secretValuePrinted: false,
    },
  };
}

function checkLocalImplementation(root: string): StageCheck {
  const packageJson = readJson(root, "package.json");
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const requiredScript = scripts["update-center:request-v2:selftest"];
  const localSelftest = scripts["ops:ops-005:local:selftest"];
  const requiredAggregateMembers = [
    "update-center:health:selftest",
    "update-center:request-v2:selftest",
    "update-center:request-guard:selftest",
    "update-agent-request-v2.selftest.ts",
    "update-production-state-lock.selftest.ts",
  ];
  const missingAggregateMembers = typeof localSelftest === "string"
    ? requiredAggregateMembers.filter((member) => !localSelftest.includes(member))
    : requiredAggregateMembers;
  const web = [
    readOptional(root, "apps/web/lib/system/update-center.ts"),
    readOptional(root, "apps/web/lib/system/update-request-v2.ts"),
    readOptional(root, "apps/web/app/api/system/update-requests/route.ts"),
  ].join("\n");
  const agent = [
    readOptional(root, "ops/update-agent/areaforge-update-agent.sh"),
    readOptional(root, "ops/update-agent/lib/update-request-v2.sh"),
    readOptional(root, "ops/update-agent/lib/update-request-state.sh"),
  ].join("\n");
  const updater = readOptional(root, "ops/github-release-updater/areaforge-updater.sh");
  const missing = [
    typeof requiredScript === "string" && requiredScript.trim() ? null : "update-center:request-v2:selftest",
    missingAggregateMembers.length === 0 ? null : `ops:ops-005:local:selftest:${missingAggregateMembers.join("|")}`,
    ...["schemaVersion", "expectedBefore", "semanticHash", "idempotencyKey", "expiresAt"]
      .filter((token) => !web.includes(token))
      .map((token) => `web:${token}`),
    ...["EXPECTED_BEFORE_MISMATCH", "LEGACY_MUTATION_UNBOUND", "needs_reconciliation", "executionAttempted", "production-state.lock"]
      .filter((token) => !agent.includes(token))
      .map((token) => `agent:${token}`),
    updater.includes("production-state.lock") ? null : "updater:production-state.lock",
  ].filter((value): value is string => Boolean(value));
  return missing.length === 0
    ? { status: "pass", detail: "V2 source prerequisites and aggregate local selftest entry are present; command execution is separate evidence" }
    : { status: "missing", detail: `missing ${missing.join(", ")}` };
}

function checkSignedRelease(
  root: string,
  recordPath: string,
  releaseAssetsDir: string,
  packageVersion: string,
  releaseTag: string,
  gitCommit: string,
  verifySignature: ReleaseSupplyChainValidationOptions["verifySignature"],
): StageCheck {
  const raw = readOptional(root, recordPath);
  if (!raw) return { status: "missing", detail: "matching signed Release supply-chain record is missing" };
  if (!releaseAssetsDir) return { status: "missing", detail: "strict signed Release validation requires AREAFORGE_OPS005_RELEASE_ASSETS_DIR" };
  const absoluteAssetsDir = resolve(root, releaseAssetsDir);
  const issues = validateReleaseSupplyChainRecord(raw, {
    assetDir: absoluteAssetsDir,
    strict: true,
    cosignPublicKey: path.join(root, "docs/deployment/keys/areaforge-cosign.pub"),
    verifySignature,
  });
  if (issues.length > 0) {
    return { status: "missing", detail: `strict signed Release validation failed: ${issues.map((issue) => issue.field).join(", ")}` };
  }
  const fields = parseIndentedKeyValueRecord(raw);
  const matches = fields.get("packageVersion") === packageVersion &&
    fields.get("releaseTag") === releaseTag &&
    fields.get("gitCommit") === gitCommit &&
    /^ghcr\.io\/areasong\/areaforge-web:v?[^@]+@sha256:[a-f0-9]{64}$/i.test(fields.get("webImageDigest") ?? "") &&
    /^(sha256:)?[a-f0-9]{64}$/i.test(fields.get("manifestSha256") ?? "") &&
    fields.get("workflowRunConclusion") === "success" &&
    fields.get("checksumVerification") === "pass" &&
    fields.get("signatureVerification") === "pass" &&
    fields.get("unsignedPlaceholderPresent") === "no";
  return matches
    ? { status: "pass", detail: "signed Release identity, manifest hash, and web image digest match the current checkout" }
    : { status: "missing", detail: "signed Release record is stale, incomplete, or does not match the current checkout" };
}

function checkProductionEvidence(
  root: string,
  recordPath: string,
  packageVersion: string,
  releaseTag: string,
  gitCommit: string,
  releaseRecordPath: string,
  sourceAtCommit: Ops005SourceAtCommitReader | undefined,
  now: Date,
): StageCheck {
  if (!recordPath) return { status: "missing", detail: "AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD is not configured" };
  const raw = readOptional(root, recordPath);
  if (!raw) return { status: "missing", detail: "OPS-005 production evidence record is missing" };
  const releaseRecord = readOptional(root, releaseRecordPath);
  if (!releaseRecord) return { status: "invalid", detail: "signed Release record is unavailable for production identity binding" };
  const issues = validateOps005ProductionEvidence(raw, {
    now,
    expectedIdentity: buildOps005ExpectedIdentity(releaseRecord, root, sourceAtCommit),
    evidenceBaseDir: path.dirname(resolve(root, recordPath)),
  });
  if (issues.length > 0) {
    return { status: "invalid", detail: `production evidence validator failed: ${issues.map((issue) => issue.field).join(", ")}` };
  }
  const fields = parseIndentedKeyValueRecord(raw);
  if (fields.get("packageVersion") !== packageVersion || fields.get("releaseTag") !== releaseTag || fields.get("gitCommit") !== gitCommit) {
    return { status: "invalid", detail: "production evidence identity does not match current packageVersion, releaseTag, or gitCommit" };
  }
  return { status: "pass", detail: "fresh redacted production evidence matches the current signed Release identity" };
}

function stageStatus(local: StageCheck, release: StageCheck, production: StageCheck): Ops005PreflightStatus {
  if ([local, release, production].some((check) => check.status === "invalid")) return "invalid";
  if (local.status !== "pass") return "needs_local_implementation";
  if (release.status !== "pass") return "needs_signed_release";
  if (production.status !== "pass") return "needs_production_evidence";
  return "ready_for_ops005_human_review";
}

function nextCommand(status: Ops005PreflightStatus, gitWorktreeClean: boolean): string {
  if (status === "needs_local_implementation") return "obtain the explicit local implementation confirmation, implement V2, and run pnpm update-center:request-v2:selftest";
  if (status === "needs_signed_release" && !gitWorktreeClean) return "run pnpm ops:ops-005:local:selftest, create a clean Git checkpoint, then choose an unpublished version/tag for the signed Release";
  if (status === "needs_signed_release") return "choose an unpublished version/tag and create a signed Release from this clean verified implementation commit";
  if (status === "needs_production_evidence") return "obtain a separate production deployment confirmation and validate the redacted OPS-005 production evidence record";
  if (status === "ready_for_ops005_human_review") return "review AF-RISK-OPS-005 close conditions; do not close the residual automatically";
  return "fix invalid OPS-005 evidence before continuing";
}

function labelledEvidence(root: string, file: string) {
  if (!file) return { configured: false, pathLabel: null, exists: false, sha256: null };
  const fullPath = resolve(root, file);
  const exists = existsSync(fullPath);
  return {
    configured: true,
    pathLabel: path.basename(file),
    exists,
    sha256: exists ? `sha256:${sha256(readFileSync(fullPath, "utf8"))}` : null,
  };
}

function labelledDirectoryEvidence(root: string, directory: string) {
  if (!directory) return { configured: false, pathLabel: null, exists: false };
  const fullPath = resolve(root, directory);
  return {
    configured: true,
    pathLabel: path.basename(directory),
    exists: existsSync(fullPath),
  };
}

function referencedProductionEvidence(root: string, recordPath: string, field: string) {
  if (!recordPath) return { configured: false, pathLabel: null, exists: false, sha256: null };
  const raw = readOptional(root, recordPath);
  if (!raw) return { configured: false, pathLabel: null, exists: false, sha256: null };
  const relative = parseIndentedKeyValueRecord(raw).get(field) ?? "";
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]+/).includes("..")) {
    return { configured: Boolean(relative), pathLabel: relative ? path.basename(relative) : null, exists: false, sha256: null };
  }
  return labelledEvidence(path.dirname(resolve(root, recordPath)), relative);
}

function sourceEvidence(root: string, file: string) {
  return labelledEvidence(root, file);
}

function localGitCommit(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function localGitWorktreeClean(root: string): boolean {
  try {
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: root,
      encoding: "utf8",
    }).trim() === "";
  } catch {
    return false;
  }
}

function envNow(): Date {
  const value = process.env.AREAFORGE_OPS005_NOW;
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function readJson(root: string, file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(resolve(root, file), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readOptional(root: string, file: string): string {
  if (!file) return "";
  try {
    return readFileSync(resolve(root, file), "utf8");
  } catch {
    return "";
  }
}

function resolve(root: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main(): void {
  console.log(JSON.stringify(buildOps005EvidencePreflight(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
