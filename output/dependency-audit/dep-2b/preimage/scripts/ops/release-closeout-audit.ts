import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveReleaseEvidenceValidationArgs } from "../quality/release-evidence-validate";
import {
  effectiveExceptionStatus,
  isAcceptedExceptionEffective,
  readResidualLedgerV2,
  ResidualLedgerValidationError,
  type EffectiveExceptionStatus,
  type ResidualItemV2,
  type ResidualLedgerIssue,
  type ResidualLedgerV2,
} from "../quality/residual-ledger-common";

type GateStatus = "pass" | "pending_observation" | "needs_attention" | "blocked";

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
  status: "blocked" | "needs_attention" | "pending_observation" | "ready_for_human_review";
  source: {
    releaseRecord: string;
    supplyChainRecord: string;
    operationalEvidenceBundle: string | null;
    postReleaseObservation: string | null;
    residualLedger: "docs/development/residual-risk-ledger.json";
    inputHashes: Array<{ key: string; path: string; sha256: string }>;
  };
  checks: {
    releaseRecord: AuditCheck & { validator: ValidatorResult };
    supplyChainRecord: AuditCheck & { validator: ValidatorResult };
    identityConsistency: AuditCheck;
    residualLedger: AuditCheck & { issues: ResidualLedgerIssue[] };
    residualConsistency: AuditCheck;
    operationalEvidence: AuditCheck;
    postReleaseObservation: AuditCheck & { validator: ValidatorResult };
    rollbackTarget: AuditCheck;
  };
  identity: {
    releaseGitCommit: string | null;
    releasedAt: string | null;
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
    blockedAcceptedExceptionIds: string[];
    acceptedExceptions: Array<{ id: string; status: EffectiveExceptionStatus; effective: boolean }>;
    records: Array<Pick<ResidualItemV2, "id" | "type" | "reviewAt" | "ownerSkills">>;
  };
  blockedBy: string[];
  attentionBy: string[];
  pendingBy: string[];
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
  const conventionalObservationPath = `docs/development/post-release-observation-v${version}.json`;
  const observationPath = safeRepositoryPath(
    releaseFields.get("postReleaseObservationPath") ?? releaseFields.get("postReleaseObservationSourcePath"),
  ) ?? (readOptional(root, conventionalObservationPath) === null ? null : conventionalObservationPath);
  const observationRaw = observationPath ? readOptional(root, observationPath) : null;
  const observation = parseJsonRecord(observationRaw);
  const validatorRunner = options.validatorRunner ?? runValidator;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const ledgerRead = readLedger(root, new Date(generatedAt));
  const ledger = ledgerRead.ledger;

  const releaseValidator = releaseRaw
    ? validatorRunner("scripts/quality/release-evidence-validate.ts", releaseRecordPath, root)
    : missingValidator("pnpm release:evidence:validate");
  const supplyValidator = supplyRaw
    ? validatorRunner("scripts/quality/release-supply-chain-validate.ts", supplyChainRecordPath, root)
    : missingValidator("pnpm release:supply-chain:validate");
  const observationValidator = observationRaw && observationPath
    ? validatorRunner("scripts/quality/post-release-observation-validate.ts", observationPath, root)
    : missingValidator("pnpm exec tsx scripts/quality/post-release-observation-validate.ts");

  const releaseIds = parseList(releaseFields.get("residualRiskIds"));
  const supplyIds = parseList(supplyFields.get("residualRiskIds"));
  const referencedIds = [...new Set([...releaseIds, ...supplyIds])].sort();
  const ledgerById = new Map((ledger?.items ?? []).map((item) => [item.id, item]));
  const missingLedgerIds = ledger ? referencedIds.filter((id) => !ledgerById.has(id)) : [];
  const referencedItems = ledger
    ? referencedIds.flatMap((id) => {
      const item = ledgerById.get(id);
      return item ? [item] : [];
    })
    : [];
  const residualRecords = referencedIds.flatMap((id) => {
    const item = ledgerById.get(id);
    return item ? [{ id: item.id, type: item.type, reviewAt: item.reviewAt, ownerSkills: item.ownerSkills }] : [];
  });
  const currentBlockerIds = residualRecords.filter((item) => item.type === "current-blocker").map((item) => item.id);
  const needsAttentionIds = residualRecords
    .filter((item) => ["deferred-work", "monitoring-gap", "release-follow-up"].includes(item.type))
    .map((item) => item.id);
  const acceptedExceptions = referencedItems
    .filter((item) => item.type === "accepted-exception")
    .map((item) => ({
      id: item.id,
      status: effectiveExceptionStatus(item, new Date(generatedAt)),
      effective: isAcceptedExceptionEffective(item, new Date(generatedAt)),
    }));
  const blockedAcceptedExceptionIds = acceptedExceptions
    .filter((item) => !item.effective)
    .map((item) => item.id);

  const checks = {
    releaseRecord: validatorCheck(releaseValidator, releaseRecordPath),
    supplyChainRecord: validatorCheck(supplyValidator, supplyChainRecordPath),
    identityConsistency: identityCheck(version, releaseFields, supplyFields),
    residualLedger: residualLedgerCheck(ledgerRead),
    residualConsistency: residualCheck(
      ledger !== null,
      missingLedgerIds,
      currentBlockerIds,
      needsAttentionIds,
      blockedAcceptedExceptionIds,
    ),
    operationalEvidence: operationalEvidenceCheck(releaseFields, operationalEvidencePath, operationalBundle),
    postReleaseObservation: postReleaseObservationCheck({
      version,
      generatedAt,
      release: releaseFields,
      releaseRecordPath,
      releaseRaw,
      observationPath,
      observationRaw,
      observation,
      validator: observationValidator,
    }),
    rollbackTarget: rollbackTargetCheck(releaseFields),
  };
  const blockedBy = Object.entries(checks)
    .filter(([, check]) => check.status === "blocked")
    .map(([key, check]) => `${key}: ${check.detail}`);
  const attentionBy = Object.entries(checks)
    .filter(([, check]) => check.status === "needs_attention")
    .map(([key, check]) => `${key}: ${check.detail}`);
  const pendingBy = Object.entries(checks)
    .filter(([, check]) => check.status === "pending_observation")
    .map(([key, check]) => `${key}: ${check.detail}`);
  const statuses = Object.values(checks).map((check) => check.status);
  const status: ReleaseCloseoutAudit["status"] = statuses.includes("blocked")
    ? "blocked"
    : statuses.includes("needs_attention")
      ? "needs_attention"
      : statuses.includes("pending_observation") ? "pending_observation" : "ready_for_human_review";

  const inputSources = [
    { key: "releaseRecord", path: releaseRecordPath },
    { key: "supplyChainRecord", path: supplyChainRecordPath },
    { key: "residualLedger", path: ledgerPath },
    ...(operationalEvidencePath ? [{ key: "operationalEvidenceBundle", path: operationalEvidencePath }] : []),
    ...(observationPath ? [{ key: "postReleaseObservation", path: observationPath }] : []),
  ];
  const resultWithoutHash = {
    schemaVersion: 1 as const,
    mode: "read_only_release_closeout_audit" as const,
    generatedAt,
    version,
    releaseTag,
    status,
    source: {
      releaseRecord: releaseRecordPath,
      supplyChainRecord: supplyChainRecordPath,
      operationalEvidenceBundle: operationalEvidencePath,
      postReleaseObservation: observationPath,
      residualLedger: ledgerPath,
      inputHashes: inputSources.flatMap((source) => {
        const raw = readOptional(root, source.path);
        return raw === null ? [] : [{ ...source, sha256: `sha256:${sha256(raw)}` }];
      }),
    },
    checks,
    identity: {
      releaseGitCommit: stringOrNull(releaseFields.get("gitCommit")),
      releasedAt: stringOrNull(releaseFields.get("releasedAt")),
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
      blockedAcceptedExceptionIds,
      acceptedExceptions,
      records: residualRecords,
    },
    blockedBy,
    attentionBy,
    pendingBy,
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

function residualLedgerCheck(result: LedgerReadResult): AuditCheck & { issues: ResidualLedgerIssue[] } {
  if (result.ledger) {
    return { status: "pass", detail: "residual ledger schema V2 validation passed", issues: [] };
  }
  const detail = result.issues
    .slice(0, 3)
    .map((issue) => `${issue.field}: ${issue.message}`)
    .join("; ");
  return {
    status: "blocked",
    detail: `residual ledger unavailable or invalid${detail ? `: ${detail}` : ""}`,
    issues: result.issues,
  };
}

function residualCheck(
  ledgerAvailable: boolean,
  missing: string[],
  current: string[],
  attention: string[],
  blockedExceptions: string[],
): AuditCheck {
  if (!ledgerAvailable) return { status: "blocked", detail: "residual consistency cannot be evaluated without a valid schema V2 ledger" };
  if (missing.length > 0) return { status: "blocked", detail: `residual IDs missing from ledger: ${missing.join(", ")}` };
  if (current.length > 0) return { status: "blocked", detail: `current blocker residuals: ${current.join(", ")}` };
  if (blockedExceptions.length > 0) {
    return { status: "blocked", detail: `accepted exceptions are not currently effective: ${blockedExceptions.join(", ")}` };
  }
  if (attention.length > 0) return { status: "needs_attention", detail: `open release residuals: ${attention.join(", ")}` };
  return { status: "pass", detail: "all referenced residual IDs exist; no blocker or ineffective accepted exception remains" };
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

function postReleaseObservationCheck(input: {
  version: string;
  generatedAt: string;
  release: Map<string, string>;
  releaseRecordPath: string;
  releaseRaw: string | null;
  observationPath: string | null;
  observationRaw: string | null;
  observation: Record<string, unknown> | null;
  validator: ValidatorResult;
}): AuditCheck & { validator: ValidatorResult } {
  const { generatedAt, observationPath, observationRaw, observation, validator } = input;
  if (!observationPath || !observationRaw || !observation) {
    return { status: "needs_attention", detail: "post-release observation evidence is missing", validator };
  }
  if (validator.status !== "pass") {
    return {
      status: "blocked",
      detail: `post-release observation validator ${validator.status}${validator.issueFields.length ? ` (${validator.issueFields.join(", ")})` : ""}`,
      validator,
    };
  }

  const bindingIssue = observationBindingIssue(input);
  if (bindingIssue) return { status: "blocked", detail: bindingIssue, validator };
  const projection = deriveObservationProjection(observation);
  if (projection.error) return { status: "blocked", detail: projection.error, validator };
  if (projection.overallStatus === "fail") {
    return { status: "blocked", detail: "post-release observation real threshold gate failed", validator };
  }
  if (projection.overallStatus === "pass") {
    return { status: "pass", detail: "D14 and D30 post-release observation gates passed", validator };
  }

  const overdue = projection.pendingWindows.filter((item) => item.dueDate < generatedAt.slice(0, 10));
  return overdue.length > 0
    ? {
      status: "needs_attention",
      detail: `expired observation evidence: ${overdue.map((item) => `${item.key} due ${item.dueDate}`).join(", ")}`,
      validator,
    }
    : {
      status: "pending_observation",
      detail: `valid ${projection.pendingWindows.map((item) => item.key).join("/")} observation window is pending`,
      validator,
    };
}

function observationBindingIssue(input: {
  version: string;
  release: Map<string, string>;
  releaseRecordPath: string;
  releaseRaw: string | null;
  observation: Record<string, unknown> | null;
}): string | null {
  const { version, release, releaseRecordPath, releaseRaw, observation } = input;
  if (!observation) return "post-release observation evidence is invalid";
  const identity = isRecord(observation.release) ? observation.release : null;
  const observationReleaseRecord = identity && isRecord(identity.releaseRecord) ? identity.releaseRecord : null;
  const mismatches: string[] = [];
  compareObservationIdentity("release.version", identity?.version, version, mismatches);
  compareObservationIdentity("release.releaseTag", identity?.releaseTag, release.get("releaseTag"), mismatches);
  compareObservationIdentity("release.gitCommit", identity?.gitCommit, release.get("gitCommit"), mismatches);
  compareObservationIdentity("release.releasedAt", identity?.releasedAt, release.get("releasedAt"), mismatches);
  compareObservationIdentity("release.releaseRecord.path", observationReleaseRecord?.path, releaseRecordPath, mismatches);
  if (mismatches.length > 0) return `post-release observation identity mismatch: ${mismatches.join(", ")}`;
  const expectedReleaseHash = releaseRaw === null ? null : `sha256:${sha256(releaseRaw)}`;
  if (!expectedReleaseHash || observationReleaseRecord?.sha256 !== expectedReleaseHash) {
    return "post-release observation Release record hash binding failed";
  }
  return null;
}

function deriveObservationProjection(observation: Record<string, unknown>): {
  overallStatus: "pending_observation" | "pass" | "fail" | null;
  pendingWindows: Array<{ key: "D14" | "D30"; dueDate: string }>;
  error: string | null;
} {
  const checkpoints = isRecord(observation.checkpoints) ? observation.checkpoints : null;
  const d14 = checkpoints && isRecord(checkpoints.d14) ? checkpoints.d14 : null;
  const d30 = checkpoints && isRecord(checkpoints.d30) ? checkpoints.d30 : null;
  const d14Status = deriveD14Status(d14);
  const d30Status = deriveD30Status(d30);
  if (!d14 || !d30 || !d14Status || !d30Status) {
    return { overallStatus: null, pendingWindows: [], error: "post-release observation checkpoint structure is invalid" };
  }
  const identity = isRecord(observation.release) ? observation.release : null;
  const expectedD14 = addUtcCalendarDays(identity?.releasedAt, 14);
  const expectedD30 = addUtcCalendarDays(identity?.releasedAt, 30);
  const d14DueDate = stringValue(d14.dueDate);
  const d30DueDate = stringValue(d30.dueDate);
  if (!expectedD14 || !expectedD30 || d14DueDate !== expectedD14 || d30DueDate !== expectedD30) {
    return { overallStatus: null, pendingWindows: [], error: "post-release observation D14/D30 due dates do not match releasedAt" };
  }
  const d14Gate = isRecord(d14.gate) ? d14.gate.status : null;
  const d30Gate = isRecord(d30.gate) ? d30.gate.status : null;
  const overallStatus = d14Status === "fail" || d30Status === "fail"
    ? "fail"
    : d14Status === "pending_observation" || d30Status === "pending_observation" ? "pending_observation" : "pass";
  const gate = isRecord(observation.gate) ? observation.gate : null;
  if (d14Gate !== d14Status || d30Gate !== d30Status || gate?.status !== overallStatus) {
    return { overallStatus: null, pendingWindows: [], error: "post-release observation checkpoint or record gate is not derived from real thresholds" };
  }
  const pendingWindows = [
    ...(d14Status === "pending_observation" ? [{ key: "D14" as const, dueDate: d14DueDate }] : []),
    ...(d30Status === "pending_observation" ? [{ key: "D30" as const, dueDate: d30DueDate }] : []),
  ];
  return { overallStatus, pendingWindows, error: null };
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

type LedgerReadResult = {
  ledger: ResidualLedgerV2 | null;
  issues: ResidualLedgerIssue[];
};

function readLedger(root: string, now: Date): LedgerReadResult {
  try {
    return { ledger: readResidualLedgerV2({ root, file: ledgerPath, now }), issues: [] };
  } catch (error) {
    if (error instanceof ResidualLedgerValidationError) {
      return { ledger: null, issues: error.issues };
    }
    return {
      ledger: null,
      issues: [{
        field: ledgerPath,
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
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

function compareObservationIdentity(field: string, actual: unknown, expected: string | undefined, mismatches: string[]): void {
  if (typeof actual !== "string" || !expected || actual !== expected) mismatches.push(field);
}

function deriveD14Status(checkpoint: Record<string, unknown> | null): "pending_observation" | "pass" | "fail" | null {
  if (!checkpoint) return null;
  const technical = observationItemStatus(checkpoint.technicalObservation);
  const incident = observationItemStatus(checkpoint.incident);
  const errorBudget = observationItemStatus(checkpoint.errorBudget);
  if (!technical || !incident || !errorBudget) return null;
  if (technical === "fail" || incident === "open" || errorBudget === "exhausted") return "fail";
  if ([technical, incident, errorBudget].includes("pending_observation")) return "pending_observation";
  return technical === "pass" && ["none", "resolved"].includes(incident) && errorBudget === "within_budget" ? "pass" : null;
}

function deriveD30Status(checkpoint: Record<string, unknown> | null): "pending_observation" | "pass" | "fail" | null {
  if (!checkpoint) return null;
  const productReview = observationItemStatus(checkpoint.productReview);
  return ["pending_observation", "pass", "fail"].includes(productReview) ? productReview as "pending_observation" | "pass" | "fail" : null;
}

function observationItemStatus(value: unknown): string {
  return isRecord(value) && typeof value.status === "string" ? value.status : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function addUtcCalendarDays(value: unknown, days: number): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function stringOrNull(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
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
