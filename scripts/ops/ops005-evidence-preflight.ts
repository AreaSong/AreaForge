import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseIndentedKeyValueRecord, sha256 } from "../quality/record-validator-common";
import { validateOps005ProductionEvidence } from "../quality/ops005-production-evidence-validate";

export type Ops005PreflightStatus =
  | "needs_local_implementation"
  | "needs_signed_release"
  | "needs_production_evidence"
  | "ready_for_ops005_human_review"
  | "invalid";

type BuildOptions = {
  root?: string;
  now?: Date;
  gitCommit?: string;
  releaseRecordPath?: string;
  productionEvidencePath?: string;
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
  const gitCommit = options.gitCommit ?? process.env.AREAFORGE_OPS005_GIT_COMMIT?.trim() ?? localGitCommit(root);
  const releaseRecordPath = options.releaseRecordPath ?? process.env.AREAFORGE_OPS005_RELEASE_RECORD?.trim() ??
    `docs/development/release-supply-chain-${releaseTag}.md`;
  const productionEvidencePath = options.productionEvidencePath ??
    process.env.AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD?.trim() ?? "";

  const localImplementation = checkLocalImplementation(root);
  const signedRelease = checkSignedRelease(root, releaseRecordPath, packageVersion, releaseTag, gitCommit);
  const productionEvidence = checkProductionEvidence(
    root,
    productionEvidencePath,
    packageVersion,
    releaseTag,
    gitCommit,
    options.now ?? envNow(),
  );
  const status = stageStatus(localImplementation, signedRelease, productionEvidence);

  return {
    schemaVersion: 1,
    mode: "read_only_ops005_expected_before_preflight",
    generatedAt: (options.now ?? envNow()).toISOString(),
    status,
    packageVersion,
    releaseTag,
    gitCommit: /^[a-f0-9]{40}$/i.test(gitCommit) ? gitCommit : null,
    checks: {
      localImplementation,
      signedRelease,
      productionEvidence,
    },
    evidence: {
      design: sourceEvidence(root, "docs/development/update-request-expected-before-design.md"),
      activeTask: sourceEvidence(root, "tasks/active/0019-update-request-expected-before-binding.md"),
      releaseRecord: labelledEvidence(root, releaseRecordPath),
      productionRecord: labelledEvidence(root, productionEvidencePath),
    },
    requiredEvidence: [
      "schema V2, expected-before, target identity, dual hash, idempotency, TTL, atomic publish, processing reconciliation, shared production-state lock, and dual compare local implementation",
      "matching signed Release supply-chain record for the current packageVersion, releaseTag, and gitCommit",
      "fresh redacted OPS-005 production evidence record with V2 check and expected-before rejection executionAttempted=no",
      "AREAFORGE_AUTO_APPLY=none",
    ],
    nextCommand: nextCommand(status),
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
    typeof localSelftest === "string" && localSelftest.includes("update-agent-request-v2.selftest.ts") &&
      localSelftest.includes("update-production-state-lock.selftest.ts") ? null : "ops:ops-005:local:selftest",
    ...["schemaVersion", "expectedBefore", "semanticHash", "idempotencyKey", "expiresAt"]
      .filter((token) => !web.includes(token))
      .map((token) => `web:${token}`),
    ...["EXPECTED_BEFORE_MISMATCH", "LEGACY_MUTATION_UNBOUND", "needs_reconciliation", "executionAttempted", "production-state.lock"]
      .filter((token) => !agent.includes(token))
      .map((token) => `agent:${token}`),
    updater.includes("production-state.lock") ? null : "updater:production-state.lock",
  ].filter((value): value is string => Boolean(value));
  return missing.length === 0
    ? { status: "pass", detail: "V2 Web/agent/updater source tokens and complete local selftest entries are present" }
    : { status: "missing", detail: `missing ${missing.join(", ")}` };
}

function checkSignedRelease(
  root: string,
  recordPath: string,
  packageVersion: string,
  releaseTag: string,
  gitCommit: string,
): StageCheck {
  const raw = readOptional(root, recordPath);
  if (!raw) return { status: "missing", detail: "matching signed Release supply-chain record is missing" };
  const fields = parseIndentedKeyValueRecord(raw);
  const matches = fields.get("packageVersion") === packageVersion &&
    fields.get("releaseTag") === releaseTag &&
    fields.get("gitCommit") === gitCommit &&
    fields.get("workflowRunConclusion") === "success" &&
    fields.get("checksumVerification") === "pass" &&
    fields.get("signatureVerification") === "pass" &&
    fields.get("unsignedPlaceholderPresent") === "no";
  return matches
    ? { status: "pass", detail: "signed Release identity matches current packageVersion, releaseTag, and gitCommit" }
    : { status: "missing", detail: "signed Release record is stale, incomplete, or does not match the current checkout" };
}

function checkProductionEvidence(
  root: string,
  recordPath: string,
  packageVersion: string,
  releaseTag: string,
  gitCommit: string,
  now: Date,
): StageCheck {
  if (!recordPath) return { status: "missing", detail: "AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD is not configured" };
  const raw = readOptional(root, recordPath);
  if (!raw) return { status: "missing", detail: "OPS-005 production evidence record is missing" };
  const issues = validateOps005ProductionEvidence(raw, { now });
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

function nextCommand(status: Ops005PreflightStatus): string {
  if (status === "needs_local_implementation") return "obtain the explicit local implementation confirmation, implement V2, and run pnpm update-center:request-v2:selftest";
  if (status === "needs_signed_release") return "create and validate a signed Release from the verified V2 implementation commit";
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
