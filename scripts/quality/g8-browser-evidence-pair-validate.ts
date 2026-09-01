import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  GOVERNANCE_SCHEMA,
  RESPONSIVE_SCHEMA,
  addIssue,
  buildExpectedBinding,
  exactKeys,
  finishResult,
  isRecord,
  jsonEqual,
  readG8JsonFile,
  rereadUnchanged,
  safeString,
  type G8EvidenceBinding,
  type G8ValidationIssue,
} from "./g8-browser-evidence-common";
import { validateResponsiveLayoutBrowserMatrix } from "./responsive-layout-browser-matrix-validate";
import { validateWebGovernanceBrowserInteractions } from "./web-governance-browser-interactions-validate";
import { safeV11Error } from "./v11-browser-evidence-contract";
import {
  computeProductExperienceSourceHash,
  currentGitCommit,
  findWorkspaceRoot,
} from "./product-experience-source";

type JsonRecord = Record<string, unknown>;

export type G8BrowserEvidencePairValidationResult = {
  valid: boolean;
  issues: G8ValidationIssue[];
  responsiveValid: boolean;
  governanceValid: boolean;
  responsiveScreenshots: number;
  governanceScreenshots: number;
};

const PAIR_POOL_KEYS = ["slot", "container", "port", "generation", "url", "status", "commit", "sourceFingerprint", "buildId", "observedAt"] as const;

export function validateG8BrowserEvidencePair(
  responsive: unknown,
  governance: unknown,
  binding: G8EvidenceBinding,
): G8BrowserEvidencePairValidationResult {
  const issues: G8ValidationIssue[] = [];
  const responsiveResult = validateResponsiveLayoutBrowserMatrix(responsive, binding);
  const governanceResult = validateWebGovernanceBrowserInteractions(governance, binding);
  for (const issue of responsiveResult.issues) addIssue(issues, `responsive.${issue.field}`, issue.message);
  for (const issue of governanceResult.issues) addIssue(issues, `governance.${issue.field}`, issue.message);
  if (isRecord(responsive) && isRecord(governance)) validatePairIdentity(responsive, governance, issues);
  return {
    valid: issues.length === 0,
    issues: [...new Map(issues.map((item) => [`${item.field}\0${item.message}`, item])).values()],
    responsiveValid: responsiveResult.valid,
    governanceValid: governanceResult.valid,
    responsiveScreenshots: responsiveResult.screenshots.length,
    governanceScreenshots: governanceResult.screenshots.length,
  };
}

export function validateG8BrowserEvidencePairFiles(
  responsivePath: string,
  governancePath: string,
  binding: G8EvidenceBinding,
): G8BrowserEvidencePairValidationResult {
  const responsiveLoaded = readG8JsonFile(binding.root, responsivePath);
  const governanceLoaded = readG8JsonFile(binding.root, governancePath);
  const issues = [...responsiveLoaded.issues.map((issue) => ({ ...issue, field: `responsive.${issue.field}` })), ...governanceLoaded.issues.map((issue) => ({ ...issue, field: `governance.${issue.field}` }))];
  if (!responsiveLoaded.file?.value || !governanceLoaded.file?.value) {
    return {
      valid: false,
      issues,
      responsiveValid: false,
      governanceValid: false,
      responsiveScreenshots: 0,
      governanceScreenshots: 0,
    };
  }
  const result = validateG8BrowserEvidencePair(responsiveLoaded.file.value, governanceLoaded.file.value, binding);
  const combined = [...issues, ...result.issues];
  rereadUnchanged(binding.root, responsiveLoaded.file.relativePath, responsiveLoaded.file.sha256, combined);
  rereadUnchanged(binding.root, governanceLoaded.file.relativePath, governanceLoaded.file.sha256, combined);
  if (responsiveLoaded.file.relativePath === governanceLoaded.file.relativePath) addIssue(combined, "pair", "responsive and governance evidence paths must be distinct");
  return {
    ...result,
    valid: combined.length === 0,
    issues: [...new Map(combined.map((issue) => [`${issue.field}\0${issue.message}`, issue])).values()],
  };
}

function validatePairIdentity(responsive: JsonRecord, governance: JsonRecord, issues: G8ValidationIssue[]): void {
  if (responsive.schemaVersion !== RESPONSIVE_SCHEMA) addIssue(issues, "responsive.schemaVersion", `must be ${RESPONSIVE_SCHEMA}`);
  if (governance.schemaVersion !== GOVERNANCE_SCHEMA) addIssue(issues, "governance.schemaVersion", `must be ${GOVERNANCE_SCHEMA}`);
  if (responsive.runId === governance.runId) addIssue(issues, "pair.runId", "responsive and governance run IDs must be distinct");
  if (typeof responsive.runId !== "string" || !responsive.runId.startsWith("responsive-g8-")) addIssue(issues, "responsive.runId", "must use the responsive G8 namespace");
  if (typeof governance.runId !== "string" || !governance.runId.startsWith("governance-g8-")) addIssue(issues, "governance.runId", "must use the governance G8 namespace");

  const responsiveBinding = isRecord(responsive.binding) ? responsive.binding : null;
  const governanceBinding = isRecord(governance.binding) ? governance.binding : null;
  if (!responsiveBinding || !governanceBinding) {
    addIssue(issues, "pair.binding", "both artifacts must expose an exact binding object");
  } else {
    for (const key of ["commit", "sourceFingerprint", "capturePhase"] as const) {
      if (responsiveBinding[key] !== governanceBinding[key]) addIssue(issues, `pair.binding.${key}`, "must match between the two artifacts");
    }
  }

  const responsiveIdentity = isRecord(responsive.runtimeIdentity) ? responsive.runtimeIdentity : null;
  const governanceIdentity = isRecord(governance.runtimeIdentity) ? governance.runtimeIdentity : null;
  if (!responsiveIdentity || !governanceIdentity) {
    addIssue(issues, "pair.runtimeIdentity", "both artifacts must expose a verified runtime identity");
  } else {
    for (const key of ["schemaVersion", "status", "appVersion", "gitCommit", "sourceFingerprintSchema", "productExperienceSourceHash", "buildId", "runtimeMode", "identityHash", "reasonCode"] as const) {
      if (responsiveIdentity[key] !== governanceIdentity[key]) addIssue(issues, `pair.runtimeIdentity.${key}`, "must match between the two artifacts");
    }
  }

  validateSharedEnvironment(responsive.environment, governance.environment, issues);
  const generatedResponsive = parseTime(responsive.generatedAt);
  const generatedGovernance = parseTime(governance.generatedAt);
  if (generatedResponsive === null) addIssue(issues, "responsive.generatedAt", "must be a valid timestamp");
  if (generatedGovernance === null) addIssue(issues, "governance.generatedAt", "must be a valid timestamp");
  if (generatedResponsive !== null && generatedGovernance !== null && Math.abs(generatedResponsive - generatedGovernance) > 24 * 60 * 60 * 1000) {
    addIssue(issues, "pair.generatedAt", "the two captures must be within 24 hours of one another");
  }
  if (isRecord(responsive.summary) && responsive.summary.result !== "PASS") addIssue(issues, "responsive.summary.result", "must be PASS before pair admission");
  if (isRecord(governance.summary) && governance.summary.result !== "PASS") addIssue(issues, "governance.summary.result", "must be PASS before pair admission");
}

function validateSharedEnvironment(responsive: unknown, governance: unknown, issues: G8ValidationIssue[]): void {
  if (!isRecord(responsive) || !isRecord(governance)) {
    addIssue(issues, "pair.environment", "both artifacts must expose environment objects");
    return;
  }
  for (const key of ["baseUrl", "browser", "mode"] as const) {
    if (responsive[key] !== governance[key]) addIssue(issues, `pair.environment.${key}`, "must match between the two artifacts");
  }
  const responsivePool = isRecord(responsive.pool) ? responsive.pool : null;
  const governancePool = isRecord(governance.pool) ? governance.pool : null;
  if (!responsivePool || !governancePool) {
    addIssue(issues, "pair.environment.pool", "both artifacts must bind the same test-pool instance");
    return;
  }
  exactKeys(responsivePool, PAIR_POOL_KEYS, "responsive.environment.pool", issues);
  exactKeys(governancePool, PAIR_POOL_KEYS, "governance.environment.pool", issues);
  for (const key of PAIR_POOL_KEYS.filter((candidate) => candidate !== "observedAt")) {
    if (responsivePool[key] !== governancePool[key]) addIssue(issues, `pair.environment.pool.${key}`, "must match between the two artifacts");
  }
  const responsiveObserved = parseTime(responsivePool.observedAt);
  const governanceObserved = parseTime(governancePool.observedAt);
  if (responsiveObserved === null || governanceObserved === null || Math.abs(responsiveObserved - governanceObserved) > 5 * 60 * 1000) {
    addIssue(issues, "pair.environment.pool.observedAt", "must be within five minutes between the two artifacts");
  }
}

function parseTime(value: unknown): number | null {
  if (!safeString(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function currentBinding(root: string): { commit: string; version: string; sourceHash: string } {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  return { commit: currentGitCommit(root), version: packageJson.version ?? "", sourceHash: computeProductExperienceSourceHash(root) };
}

function main(): void {
  const usage = "Usage: pnpm exec tsx scripts/quality/g8-browser-evidence-pair-validate.ts <responsive.json> <governance.json> [--expected-commit <sha>] [--expected-version <version>] [--expected-source-hash <sha>]";
  const args = process.argv.slice(2);
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      index += 1;
      continue;
    }
    paths.push(arg);
  }
  if (paths.length !== 2) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  try {
    const root = findWorkspaceRoot();
    const options = parseOptions(args, usage);
    const binding = buildExpectedBinding(root, options, currentBinding(root));
    const result = validateG8BrowserEvidencePairFiles(paths[0] as string, paths[1] as string, binding);
    if (!result.valid) {
      for (const issue of result.issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
      console.error(`FAIL g8-browser-evidence-pair-validate ${result.issues.length} issue(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS g8-browser-evidence-pair-validate (responsive ${result.responsiveScreenshots} screenshots; governance ${result.governanceScreenshots} screenshots)`);
  } catch (error) {
    console.error(`ERROR ${safeV11Error(error)}`);
    console.error(usage);
    process.exitCode = 2;
  }
}

function parseOptions(args: string[], usage: string): Partial<Omit<G8EvidenceBinding, "root">> {
  const options: Partial<Omit<G8EvidenceBinding, "root">> = {};
  const allowed = new Set(["--expected-commit", "--expected-version", "--expected-source-hash"]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const next = args[index + 1];
    if (!allowed.has(arg) || !next || next.startsWith("--") || seen.has(arg)) throw new Error(usage);
    seen.add(arg);
    if (arg === "--expected-commit") options.expectedCommit = next;
    if (arg === "--expected-version") options.expectedVersion = next;
    if (arg === "--expected-source-hash") options.expectedSourceHash = next;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
