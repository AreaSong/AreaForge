import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const canonicalWorkflowPath = path.join(root, ".github/workflows/release.yml");
const workflowPath = path.resolve(process.env.AREAFORGE_RELEASE_WORKFLOW_PATH ?? canonicalWorkflowPath);
const packagePath = path.resolve(process.env.AREAFORGE_RELEASE_PACKAGE_PATH ?? path.join(root, "package.json"));
const expectedWorkflowSha256 = "e3a247ad55ce434939c2ddc7ec34de0c88a0b7b022f8bb3687625c79ba6ca7dd";
const semanticsOnly = process.env.AREAFORGE_RELEASE_WORKFLOW_POLICY_MODE === "semantics";

interface StepBlock {
  name: string;
  jobName: string;
  startLine: number;
  indent: number;
  body: string;
}

function main(): void {
  const workflow = readFileSync(workflowPath, "utf8");
  const canonicalWorkflow = readFileSync(canonicalWorkflowPath, "utf8");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> };
  const issues: string[] = [];
  if (!semanticsOnly) {
    if (createHash("sha256").update(workflow).digest("hex") !== expectedWorkflowSha256) {
      issues.push("RELEASE_WORKFLOW_DIGEST_MISMATCH");
    }
    if (createHash("sha256").update(canonicalWorkflow).digest("hex") !== expectedWorkflowSha256) {
      issues.push("RELEASE_CANONICAL_WORKFLOW_DIGEST_MISMATCH");
    }
  }
  const requiredScripts: Record<string, string> = {
    "release:admission": "tsx scripts/quality/release-admission.ts",
    "release:admission:selftest": "tsx scripts/quality/release-admission.selftest.ts",
    "release:identity:probe": "tsx scripts/quality/release-identity-probe.ts",
    "release:identity:probe:selftest": "tsx scripts/quality/release-identity-probe.selftest.ts",
    "release:workflow:policy": "tsx scripts/quality/release-workflow-policy.ts",
    "release:workflow:policy:selftest": "tsx scripts/quality/release-workflow-policy.selftest.ts",
  };
  for (const [name, expected] of Object.entries(requiredScripts)) {
    if (packageJson.scripts?.[name] !== expected) issues.push(`PACKAGE_SCRIPT_${name}`);
  }

  validateConcurrency(workflow, issues);
  validateWorkflowEnvelope(workflow, issues);
  validateJobHardGate(workflow, "validate", issues);
  validateJobHardGate(workflow, "build-release", issues);
  validateAllActionsPinned(workflow, issues);
  requireJobDependency(workflow, "build-release", "validate", issues);
  const steps = parseSteps(workflow);
  const checkoutSteps = steps.filter((step) => /^actions\/checkout@[a-f0-9]{40}$/.test(directValue(step, "uses") ?? ""));
  if (checkoutSteps.length !== 2) issues.push("RELEASE_CHECKOUT_COUNT_INVALID");
  for (const checkout of checkoutSteps) {
    requireNestedValue(checkout, "with", "persist-credentials", "false", "RELEASE_CHECKOUT_CREDENTIALS_PERSISTED", issues);
  }
  const installGitleaks = uniqueStep(steps, "Install gitleaks", issues);
  const secretScan = uniqueStep(steps, "Commit secret scan", issues);
  const resolve = uniqueStep(steps, "Resolve release tag", issues);
  const fetchDefault = uniqueStep(steps, "Fetch default branch for release admission", issues);
  const admission = uniqueStep(steps, "Validate release admission", issues);
  const replay = uniqueStep(steps, "Reject existing immutable release identity", issues);
  const webPush = uniqueStep(steps, "Build and push web image", issues);
  const migrationPush = uniqueStep(steps, "Build and push migration image", issues);
  const manifest = uniqueStep(steps, "Generate release manifest", issues);
  const supplyChain = uniqueStep(steps, "Generate release supply-chain metadata", issues);
  const checksums = uniqueStep(steps, "Generate release checksums", issues);
  const installCosign = uniqueStep(steps, "Install cosign", issues);
  const signing = uniqueStep(steps, "Sign checksums", issues);
  const supplyChainRecord = uniqueStep(steps, "Generate signed release supply-chain record", issues);
  const supplyChainValidation = uniqueStep(steps, "Validate signed release supply chain", issues);
  const publish = uniqueStep(steps, "Publish GitHub Release", issues);

  validatePublishUniqueness(steps, publish, issues);

  for (const step of [installGitleaks, secretScan]) {
    requireStepJob(step, "validate", issues);
    requireHardGateStep(step, issues);
  }
  requireNestedValue(installGitleaks, "env", "GITLEAKS_VERSION", "8.30.1", "GITLEAKS_VERSION_NOT_PINNED", issues);
  requireNestedValue(installGitleaks, "env", "GITLEAKS_SHA256", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb", "GITLEAKS_CHECKSUM_NOT_PINNED", issues);
  requireRunLine(installGitleaks, "printf '%s  %s\\n' \"${GITLEAKS_SHA256}\" \"${RUNNER_TEMP}/${archive}\" | sha256sum -c -", "GITLEAKS_CHECKSUM_NOT_VERIFIED", issues);
  requireScalarValue(secretScan, "run", "pnpm secrets:scan", "SECRET_SCAN_NOT_CALLED", issues);

  for (const step of [resolve, fetchDefault, admission, replay, webPush, migrationPush, manifest, supplyChain, checksums, installCosign, signing, supplyChainRecord, supplyChainValidation, publish]) {
    requireStepJob(step, "build-release", issues);
    requireHardGateStep(step, issues);
  }

  requireNestedValue(resolve, "env", "INPUT_TAG", "${{ inputs.tag }}", "DISPATCH_TAG_NOT_ENV_BOUND", issues);
  requireNestedValue(resolve, "env", "INPUT_CHANNEL", "${{ inputs.channel }}", "DISPATCH_CHANNEL_NOT_ENV_BOUND", issues);
  requireRunLine(resolve, 'if [[ "${channel}" != "stable" && "${channel}" != "preview" ]]; then', "CHANNEL_NOT_VALIDATED", issues);
  requireRunLine(resolve, "printf 'channel=%s\\n' \"${channel}\" >> \"$GITHUB_OUTPUT\"", "CHANNEL_NOT_NORMALIZED", issues);
  requireScalarValue(admission, "run", "pnpm release:admission", "ADMISSION_NOT_CALLED", issues);
  requireNestedValue(admission, "env", "AREAFORGE_RELEASE_TAG", "${{ steps.vars.outputs.tag }}", "ADMISSION_TAG_NOT_BOUND", issues);
  requireNestedValue(admission, "env", "AREAFORGE_WORKFLOW_SHA", "${{ github.sha }}", "ADMISSION_SHA_NOT_BOUND", issues);
  requireScalarValue(replay, "run", "pnpm release:identity:probe", "IDENTITY_PROBE_NOT_CALLED", issues);
  requireNestedValue(replay, "env", "AREAFORGE_RELEASE_REPOSITORY", "${{ github.repository }}", "IDENTITY_REPOSITORY_NOT_BOUND", issues);
  requireNestedValue(replay, "env", "AREAFORGE_RELEASE_WEB_IMAGE", "${{ steps.vars.outputs.web_image }}", "WEB_IDENTITY_NOT_BOUND", issues);
  requireNestedValue(replay, "env", "AREAFORGE_RELEASE_MIGRATION_IMAGE", "${{ steps.vars.outputs.migration_image }}", "MIGRATION_IDENTITY_NOT_BOUND", issues);
  requireNestedValue(manifest, "env", "CHANNEL", "${{ steps.vars.outputs.channel }}", "MANIFEST_CHANNEL_NOT_NORMALIZED", issues);
  requireNestedValue(supplyChain, "env", "AREAFORGE_RELEASE_CHANNEL", "${{ steps.vars.outputs.channel }}", "SUPPLY_CHAIN_CHANNEL_NOT_NORMALIZED", issues);
  requireNestedValue(signing, "env", "CHANNEL", "${{ steps.vars.outputs.channel }}", "SIGNING_CHANNEL_NOT_NORMALIZED", issues);
  requireRunLine(signing, 'signing_key="${RUNNER_TEMP}/areaforge-cosign.key"', "SIGNING_KEY_NOT_RUNNER_TEMP_BOUND", issues);
  requireRunLine(signing, 'signing_error="${RUNNER_TEMP}/areaforge-cosign-sign.err"', "SIGNING_ERROR_NOT_RUNNER_TEMP_BOUND", issues);
  requireRunLine(signing, "trap cleanup_signing EXIT", "SIGNING_CLEANUP_TRAP_MISSING", issues);
  requireRunLine(signing, 'rm -f "${signing_key}" "${signing_error}"', "SIGNING_CLEANUP_MISSING", issues);
  requireRunLine(signing, 'if ! cosign sign-blob --yes --key "${signing_key}" --bundle SHA256SUMS.sig SHA256SUMS 2>"${signing_error}"; then', "SIGNING_COMMAND_NOT_CALLED", issues);
  requireScalarValue(supplyChainRecord, "run", "pnpm release:supply-chain:record . > areaforge-release-supply-chain.md", "SUPPLY_CHAIN_RECORD_NOT_GENERATED", issues);
  requireNestedValue(supplyChainRecord, "env", "AREAFORGE_RELEASE_WORKFLOW_RUN_CONCLUSION", "success", "SUPPLY_CHAIN_RECORD_WORKFLOW_STATUS_UNBOUND", issues);
  requireNestedValue(supplyChainRecord, "env", "AREAFORGE_SIGNATURE_VERIFICATION", "pass", "SUPPLY_CHAIN_RECORD_SIGNATURE_STATUS_UNBOUND", issues);
  requireScalarValue(supplyChainValidation, "run", "pnpm release:supply-chain:validate areaforge-release-supply-chain.md . --strict", "SUPPLY_CHAIN_STRICT_VALIDATION_NOT_CALLED", issues);
  requireNestedValue(supplyChainValidation, "env", "AREAFORGE_COSIGN_PUBLIC_KEY", "docs/deployment/keys/areaforge-cosign.pub", "SUPPLY_CHAIN_PUBLIC_KEY_UNBOUND", issues);
  requirePinnedAction(publish, "softprops/action-gh-release", "RELEASE_PUBLISH_ACTION_INVALID", issues);
  requireNestedValue(publish, "with", "prerelease", "${{ steps.vars.outputs.channel != 'stable' }}", "RELEASE_CHANNEL_NOT_NORMALIZED", issues);
  requireNestedValue(webPush, "with", "push", "true", "RELEASE_WEB_IMAGE_PUSH_DISABLED", issues);
  requireNestedValue(webPush, "with", "tags", "${{ steps.vars.outputs.web_image }}", "RELEASE_WEB_IMAGE_TAG_UNBOUND", issues);
  requireNestedValue(migrationPush, "with", "push", "true", "RELEASE_MIGRATION_IMAGE_PUSH_DISABLED", issues);
  requireNestedValue(migrationPush, "with", "tags", "${{ steps.vars.outputs.migration_image }}", "RELEASE_MIGRATION_IMAGE_TAG_UNBOUND", issues);
  requireNestedValue(publish, "with", "tag_name", "${{ steps.vars.outputs.tag }}", "RELEASE_TAG_NAME_UNBOUND", issues);
  requireNestedList(publish, "with", "files", [
    "areaforge-release-manifest.json",
    "areaforge-sbom.spdx.json",
    "areaforge-provenance.json",
    "SHA256SUMS",
    "SHA256SUMS.sig",
    "docker-compose.prod.yml",
    "areaforge-release-supply-chain.md",
  ], "RELEASE_ASSET_LIST_INVALID", issues);
  for (const asset of [
    "areaforge-release-manifest.json \\",
    "areaforge-sbom.spdx.json \\",
    "areaforge-provenance.json \\",
    "docker-compose.prod.yml > SHA256SUMS",
  ]) {
    requireRunLine(checksums, asset, "RELEASE_CHECKSUM_ASSET_SET_INVALID", issues);
  }

  const activeWorkflow = workflow.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#")).join("\n");
  const allRunCommands = workflowRunCommands(activeWorkflow).join("\n");
  if (/\bgh release view\b|\bdocker buildx imagetools inspect\b/.test(allRunCommands)) {
    issues.push("INLINE_IDENTITY_PROBE_FORBIDDEN");
  }
  if (/\bgh\s+release\s+create\b|\bgh\s+api\b[^\n]*\/releases\b/.test(allRunCommands)) {
    issues.push("INLINE_RELEASE_PUBLISH_FORBIDDEN");
  }

  if (installGitleaks && secretScan && !(installGitleaks.startLine < secretScan.startLine)) {
    issues.push("SECRET_SCAN_INSTALL_ORDER_INVALID");
  }

  if (resolve && fetchDefault && admission && replay && webPush && migrationPush && manifest &&
      supplyChain && checksums && installCosign && signing && supplyChainRecord && supplyChainValidation && publish &&
      !(resolve.startLine < fetchDefault.startLine && fetchDefault.startLine < admission.startLine &&
        admission.startLine < replay.startLine && replay.startLine < webPush.startLine &&
        webPush.startLine < migrationPush.startLine && migrationPush.startLine < manifest.startLine &&
        manifest.startLine < supplyChain.startLine && supplyChain.startLine < checksums.startLine &&
        checksums.startLine < installCosign.startLine && installCosign.startLine < signing.startLine &&
        signing.startLine < supplyChainRecord.startLine && supplyChainRecord.startLine < supplyChainValidation.startLine &&
        supplyChainValidation.startLine < publish.startLine)) {
    issues.push("RELEASE_GUARD_ORDER_INVALID");
  }

  if (issues.length > 0) {
    issues.forEach((issue) => console.error(issue));
    process.exit(1);
  }
  console.log("release workflow policy passed");
}

function validateConcurrency(workflow: string, issues: string[]): void {
  const lines = workflow.split(/\r?\n/);
  const indexes = lines.flatMap((line, index) => line === "concurrency:" ? [index] : []);
  if (indexes.length !== 1) {
    issues.push(indexes.length === 0 ? "CONCURRENCY_MISSING" : "CONCURRENCY_DUPLICATE");
    return;
  }
  const start = indexes[0] as number;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z_][\w-]*:/.test(lines[index] ?? "")) { end = index; break; }
  }
  const block = lines.slice(start, end).filter((line) => !line.trimStart().startsWith("#")).join("\n");
  if (!/^\s{2}group: release-\$\{\{ github\.repository \}\}-\$\{\{ inputs\.tag \|\| github\.ref_name \}\}\s*$/m.test(block)) {
    issues.push("CONCURRENCY_NOT_TAG_BOUND");
  }
  if (!/^\s{2}cancel-in-progress: false\s*$/m.test(block)) issues.push("CONCURRENCY_CANCELS_RELEASE");
}

function validateWorkflowEnvelope(workflow: string, issues: string[]): void {
  const requiredFragments = [
    '      - "v*.*.*"',
    "  workflow_dispatch:",
    "      tag:",
    "      channel:",
    "          - stable",
    "          - preview",
  ];
  if (requiredFragments.some((fragment) => !workflow.includes(fragment))) {
    issues.push("RELEASE_TRIGGER_POLICY_INVALID");
  }

  const permissions = topLevelBlock(workflow, "permissions");
  if (normalizedBlockEntries(permissions).join("\n") !== "contents: read") {
    issues.push("RELEASE_TOP_LEVEL_PERMISSIONS_INVALID");
  }

  const buildJob = jobBlock(workflow, "build-release");
  const buildPermissions = nestedBlock(buildJob, 4, "permissions");
  const expectedBuildPermissions = ["contents: write", "packages: write"];
  if (JSON.stringify(normalizedBlockEntries(buildPermissions)) !== JSON.stringify(expectedBuildPermissions)) {
    issues.push("RELEASE_BUILD_PERMISSIONS_INVALID");
  }
}

function validateJobHardGate(workflow: string, jobName: string, issues: string[]): void {
  const block = jobBlock(workflow, jobName);
  if (!block) return;
  if (/^    if:/m.test(block)) issues.push(`RELEASE_${jobName.replace(/\W+/g, "_").toUpperCase()}_JOB_CONDITIONAL`);
  if (/^    defaults:/m.test(block)) issues.push(`RELEASE_${jobName.replace(/\W+/g, "_").toUpperCase()}_JOB_DEFAULTS_FORBIDDEN`);
}

function validateAllActionsPinned(workflow: string, issues: string[]): void {
  const uses = workflow.split(/\r?\n/).flatMap((line) => {
    const match = /^\s+(?:-\s+)?uses:\s*([^\s#]+)(?:\s+#.*)?$/.exec(line);
    return match ? [match[1] as string] : [];
  });
  if (uses.some((value) => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/.test(value))) {
    issues.push("RELEASE_ACTION_UNPINNED");
  }
  const publishers = uses.filter((value) => value.startsWith("softprops/action-gh-release@"));
  if (publishers.length !== 1) issues.push("RELEASE_PUBLISH_ACTION_DUPLICATE_OR_RENAMED");
}

function topLevelBlock(workflow: string, key: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() && lines[index]?.search(/\S/) === 0) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function jobBlock(workflow: string, jobName: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z_][\w-]*:\s*$/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function nestedBlock(content: string, indent: number, key: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${" ".repeat(indent)}${key}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const currentIndent = line.search(/\S/);
    if (line.trim() && currentIndent >= 0 && currentIndent <= indent) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function normalizedBlockEntries(block: string): string[] {
  return block.split(/\r?\n/)
    .map((line) => stripYamlComment(line.trim()))
    .filter(Boolean);
}

function requireJobDependency(workflow: string, jobName: string, dependency: string, issues: string[]): void {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) {
    issues.push(`RELEASE_JOB_MISSING_${jobName.replace(/\W+/g, "_").toUpperCase()}`);
    return;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z_][\w-]*:\s*$/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  const needsPattern = /^    needs:\s*(.*?)\s*$/;
  const needs = lines.slice(start + 1, end).map((line) => needsPattern.exec(line)?.[1]).find((value) => value !== undefined);
  if (stripYamlComment(needs ?? "") !== dependency) issues.push("RELEASE_BUILD_JOB_VALIDATION_DEPENDENCY_MISSING");
}

function parseSteps(workflow: string): StepBlock[] {
  const lines = workflow.split(/\r?\n/);
  const steps: StepBlock[] = [];
  let inJobs = false;
  let currentJob = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "jobs:") {
      inJobs = true;
      currentJob = "";
      continue;
    }
    if (inJobs && line.trim() && !line.trimStart().startsWith("#") && line.search(/\S/) === 0) {
      inJobs = false;
      currentJob = "";
    }
    const jobMatch = inJobs ? /^  ([A-Za-z_][\w-]*):\s*$/.exec(line) : null;
    if (jobMatch) currentJob = jobMatch[1] as string;

    const match = /^(\s+)- name:\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      if (new RegExp(`^\\s{${indent}}- name:`).test(candidate) || (candidate.trim() && !candidate.trimStart().startsWith("#") && candidate.search(/\S/) < indent)) {
        end = cursor;
        break;
      }
    }
    steps.push({ name: match[2] as string, jobName: currentJob, startLine: index, indent, body: lines.slice(index, end).join("\n") });
  }
  return steps;
}

function uniqueStep(steps: StepBlock[], name: string, issues: string[]): StepBlock | null {
  const matches = steps.filter((step) => step.name === name);
  if (matches.length === 0) issues.push(`RELEASE_STEP_MISSING_${name.replace(/\W+/g, "_").toUpperCase()}`);
  if (matches.length > 1) issues.push(`RELEASE_STEP_DUPLICATE_${name.replace(/\W+/g, "_").toUpperCase()}`);
  return matches.length === 1 ? matches[0] as StepBlock : null;
}

function requireStepJob(step: StepBlock | null, jobName: string, issues: string[]): void {
  if (step && step.jobName !== jobName) {
    issues.push(`RELEASE_STEP_WRONG_JOB_${step.name.replace(/\W+/g, "_").toUpperCase()}`);
  }
}

function requireHardGateStep(step: StepBlock | null, issues: string[]): void {
  if (!step) return;
  if (directValue(step, "if") !== null) {
    issues.push(`RELEASE_STEP_CONDITIONAL_${step.name.replace(/\W+/g, "_").toUpperCase()}`);
  }
  const continueOnError = directValue(step, "continue-on-error");
  if (continueOnError !== null && continueOnError !== "false") {
    issues.push(`RELEASE_STEP_CONTINUE_ON_ERROR_${step.name.replace(/\W+/g, "_").toUpperCase()}`);
  }
  if (directValue(step, "run") !== null || executableRunLines(step).length > 0) {
    const shell = directValue(step, "shell");
    if (shell !== null && shell !== "bash") {
      issues.push(`RELEASE_STEP_SHELL_INVALID_${step.name.replace(/\W+/g, "_").toUpperCase()}`);
    }
    if (hasTopLevelSuccessExit(step)) {
      issues.push(`RELEASE_STEP_EARLY_SUCCESS_EXIT_${step.name.replace(/\W+/g, "_").toUpperCase()}`);
    }
  }
}

function validatePublishUniqueness(steps: StepBlock[], publish: StepBlock | null, issues: string[]): void {
  const actionSteps = steps.filter((step) => /^softprops\/action-gh-release@[a-f0-9]{40}$/.test(directValue(step, "uses") ?? ""));
  if (actionSteps.length !== 1 || !publish || actionSteps[0] !== publish) {
    issues.push("RELEASE_PUBLISH_ACTION_DUPLICATE_OR_RENAMED");
  }
  if (steps.some((step) => runCommandLines(step).some((line) => /\bgh\s+release\s+create\b|\bgh\s+api\b.*\/releases\b/.test(line)))) {
    issues.push("INLINE_RELEASE_PUBLISH_FORBIDDEN");
  }
}

function requireScalarValue(step: StepBlock | null, key: string, expected: string, issue: string, issues: string[]): void {
  if (step && directValue(step, key) !== expected) issues.push(issue);
}

function requireNestedValue(step: StepBlock | null, parent: string, key: string, expected: string, issue: string, issues: string[]): void {
  if (step && nestedValue(step, parent, key) !== expected) issues.push(issue);
}

function requireNestedList(
  step: StepBlock | null,
  parent: string,
  key: string,
  expected: string[],
  issue: string,
  issues: string[],
): void {
  if (!step) return;
  const lines = step.body.split(/\r?\n/);
  const parentIndent = step.indent + 2;
  const keyIndent = parentIndent + 2;
  const valueIndent = keyIndent + 2;
  const parentIndex = lines.findIndex((line) => line === `${" ".repeat(parentIndent)}${parent}:`);
  const keyIndex = lines.findIndex((line, index) => index > parentIndex &&
    new RegExp(`^\\s{${keyIndent}}${escapeRegExp(key)}:\\s*\\|[-+]?\\s*$`).test(line));
  if (parentIndex < 0 || keyIndex < 0) {
    issues.push(issue);
    return;
  }
  const actual: string[] = [];
  for (const line of lines.slice(keyIndex + 1)) {
    const indentation = line.search(/\S/);
    if (line.trim() && indentation >= 0 && indentation < valueIndent) break;
    if (indentation === valueIndent) actual.push(stripYamlComment(line.trim()));
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(issue);
}

function requireRunLine(step: StepBlock | null, expected: string, issue: string, issues: string[]): void {
  if (step && !executableRunLines(step).includes(expected)) issues.push(issue);
}

function requirePinnedAction(step: StepBlock | null, action: string, issue: string, issues: string[]): void {
  const uses = step ? directValue(step, "uses") : null;
  if (step && !new RegExp(`^${escapeRegExp(action)}@[a-f0-9]{40}$`).test(uses ?? "")) issues.push(issue);
}

function directValue(step: StepBlock, key: string): string | null {
  const fieldIndent = step.indent + 2;
  const pattern = new RegExp(`^\\s{${fieldIndent}}${escapeRegExp(key)}:\\s*(.*?)\\s*$`);
  for (const line of step.body.split(/\r?\n/).slice(1)) {
    const match = pattern.exec(line);
    if (match) return stripYamlComment(match[1] ?? "");
  }
  return null;
}

function nestedValue(step: StepBlock, parent: string, key: string): string | null {
  const lines = step.body.split(/\r?\n/);
  const parentIndent = step.indent + 2;
  const childIndent = parentIndent + 2;
  const parentPattern = new RegExp(`^\\s{${parentIndent}}${escapeRegExp(parent)}:\\s*$`);
  const childPattern = new RegExp(`^\\s{${childIndent}}${escapeRegExp(key)}:\\s*(.*?)\\s*$`);
  let inside = false;
  for (const line of lines.slice(1)) {
    const indentation = line.search(/\S/);
    if (parentPattern.test(line)) {
      inside = true;
      continue;
    }
    if (inside && line.trim() && indentation >= 0 && indentation <= parentIndent) break;
    if (inside) {
      const match = childPattern.exec(line);
      if (match) return stripYamlComment(match[1] ?? "");
    }
  }
  return null;
}

function executableRunLines(step: StepBlock): string[] {
  const lines = step.body.split(/\r?\n/);
  const runIndent = step.indent + 2;
  const runIndex = lines.findIndex((line) => new RegExp(`^\\s{${runIndent}}run:\\s*\\|[-+]?\\s*$`).test(line));
  if (runIndex < 0) return [];
  const result: string[] = [];
  let heredocEnd: string | null = null;
  for (const line of lines.slice(runIndex + 1)) {
    const indentation = line.search(/\S/);
    if (line.trim() && indentation >= 0 && indentation <= runIndent) break;
    const value = line.trim();
    if (heredocEnd) {
      if (value === heredocEnd) heredocEnd = null;
      continue;
    }
    if (!value || value.startsWith("#")) continue;
    result.push(value);
    const heredoc = /<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?/.exec(value);
    if (heredoc) heredocEnd = heredoc[1] as string;
  }
  return result;
}

function runCommandLines(step: StepBlock): string[] {
  const scalar = directValue(step, "run");
  if (scalar !== null && !/^\|[-+]?$/.test(scalar)) return [scalar];
  return executableRunLines(step);
}

function workflowRunCommands(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const commands: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(\s+)(?:-\s+)?run:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const scalar = stripYamlComment(match[2] ?? "");
    if (!/^[|>][-+]?$/.test(scalar)) {
      if (scalar) commands.push(scalar);
      continue;
    }
    const values: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      const candidateIndent = candidate.search(/\S/);
      if (candidate.trim() && candidateIndent >= 0 && candidateIndent <= indent) break;
      const value = candidate.trim();
      if (value && !value.startsWith("#")) values.push(value);
      index = cursor;
    }
    commands.push(scalar.startsWith(">") ? values.join(" ") : values.join("\n"));
  }
  return commands;
}

function hasTopLevelSuccessExit(step: StepBlock): boolean {
  let depth = 0;
  for (const line of runCommandLines(step)) {
    if (/^(fi|done|esac)\b/.test(line)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /(?:^|[;&|]\s*)(?:exit|return)\s+0\b/.test(line)) return true;
    if (/^(if|for|while|until|case)\b/.test(line)) depth += 1;
  }
  return false;
}

function stripYamlComment(value: string): string {
  const comment = value.search(/\s+#/);
  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();
