import path from "node:path";
import {
  buildEvidenceHash,
  parseIndentedKeyValueRecord,
  readRequiredFile,
  requireField,
  requireIsoTimestamp,
  requireNo,
  requireOneOf,
  scanForSecrets,
  type ValidationIssue,
} from "./record-validator-common";

const requiredScalarFields = [
  "recordId",
  "recordedAt",
  "workflowKind",
  "repository",
  "workflowName",
  "workflowRunUrl",
  "workflowRunConclusion",
  "gitCommit",
  "expectedGitCommit",
  "commitMatchStatus",
  "headBranch",
  "packageVersion",
  "ciWorkflowStatus",
  "auditProdStatus",
  "governancePreflightStatus",
  "actionsPinningStatus",
  "skillsValidateStatus",
  "releaseSupplyChainSelftestStatus",
  "pinnedActionsCount",
  "unpinnedExternalActions",
  "highCriticalVulnerabilities",
  "residualRiskIds",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "safetyFacts.secretsPrinted",
  "safetyFacts.productionEnvIncluded",
  "safetyFacts.backupIncluded",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.releaseCreated",
  "safetyFacts.tagPushed",
] as const;

const passFields = [
  "ciWorkflowStatus",
  "auditProdStatus",
  "governancePreflightStatus",
  "actionsPinningStatus",
  "skillsValidateStatus",
  "releaseSupplyChainSelftestStatus",
  "commitMatchStatus",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm ci:supply-chain:validate <ci-supply-chain-record.md|txt>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(recordPath));
  const issues = validateCiSupplyChainRecord(raw);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`CI supply-chain record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  const fields = parseIndentedKeyValueRecord(raw);
  console.log("CI supply-chain record validation passed: CI run, audit, governance, actions pinning, skills, and SC-002 residual evidence are present.");
  console.log(`ciSupplyChainEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredNestedFields])}`);
  console.log("safetyFacts: secretsPrinted=false productionEnvIncluded=false backupIncluded=false productionWriteAttempted=false releaseCreated=false tagPushed=false");
}

export function validateCiSupplyChainRecord(raw: string): ValidationIssue[] {
  const fields = parseIndentedKeyValueRecord(raw);
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireIsoTimestamp(fields, "recordedAt", issues);
  requireOneOf(fields, "workflowKind", ["ci"], issues);
  const repository = fields.get("repository");
  if (repository?.toLowerCase() !== "areasong/areaforge") {
    issues.push({ field: "repository", message: "must be AreaSong/AreaForge" });
  }
  requireOneOf(fields, "workflowRunConclusion", ["success"], issues);
  requireOneOf(fields, "unpinnedExternalActions", ["none"], issues);
  requireOneOf(fields, "highCriticalVulnerabilities", ["none"], issues);

  for (const field of passFields) {
    requireOneOf(fields, field, ["pass"], issues);
  }
  for (const field of requiredNestedFields) {
    requireNo(fields, field, issues);
  }

  const workflowRunUrl = fields.get("workflowRunUrl");
  if (workflowRunUrl && !/^https:\/\/github\.com\/AreaSong\/AreaForge\/actions\/runs\/\d+/i.test(workflowRunUrl)) {
    issues.push({ field: "workflowRunUrl", message: "must be an AreaSong/AreaForge GitHub Actions run URL" });
  }

  const gitCommit = fields.get("gitCommit");
  if (gitCommit && !/^[a-f0-9]{40}$/i.test(gitCommit)) {
    issues.push({ field: "gitCommit", message: "must be a 40-character commit SHA" });
  }
  const expectedGitCommit = fields.get("expectedGitCommit");
  if (expectedGitCommit && !/^[a-f0-9]{40}$/i.test(expectedGitCommit)) {
    issues.push({ field: "expectedGitCommit", message: "must be a 40-character commit SHA" });
  }
  if (gitCommit && expectedGitCommit && gitCommit.toLowerCase() !== expectedGitCommit.toLowerCase()) {
    issues.push({ field: "expectedGitCommit", message: "must match gitCommit so stale CI evidence cannot be reused for another checkout" });
  }

  const packageVersion = fields.get("packageVersion");
  if (packageVersion && !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    issues.push({ field: "packageVersion", message: "must look like X.Y.Z" });
  }

  const pinnedActionsCount = fields.get("pinnedActionsCount");
  if (pinnedActionsCount && !/^[1-9]\d*$/.test(pinnedActionsCount)) {
    issues.push({ field: "pinnedActionsCount", message: "must be a positive integer" });
  }

  const residualRiskIds = fields.get("residualRiskIds") ?? "";
  if (!residualRiskIds.includes("AF-RISK-SC-002")) {
    issues.push({ field: "residualRiskIds", message: "must include AF-RISK-SC-002" });
  }
  if (residualRiskIds.includes("AF-RISK-SC-001")) {
    issues.push({ field: "residualRiskIds", message: "must not include AF-RISK-SC-001; CI-only evidence does not close SBOM/provenance release evidence" });
  }

  scanForSecrets(raw, issues);
  return issues;
}

main();
