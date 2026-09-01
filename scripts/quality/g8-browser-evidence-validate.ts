import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  GOVERNANCE_SCHEMA,
  RESPONSIVE_SCHEMA,
  buildExpectedBinding,
  finishResult,
  isRecord,
  parseCliOptions,
  readG8JsonFile,
  rereadUnchanged,
  type G8EvidenceBinding,
  type G8ValidationIssue,
  type G8ValidationResult,
} from "./g8-browser-evidence-common";
import { validateResponsiveLayoutBrowserMatrix } from "./responsive-layout-browser-matrix-validate";
import { validateWebGovernanceBrowserInteractions } from "./web-governance-browser-interactions-validate";
import { safeV11Error } from "./v11-browser-evidence-contract";
import {
  computeProductExperienceSourceHash,
  currentGitCommit,
  findWorkspaceRoot,
} from "./product-experience-source";

const USAGE = "Usage: pnpm exec tsx scripts/quality/g8-browser-evidence-validate.ts <evidence.json> [--expected-commit <sha>] [--expected-version <version>] [--expected-source-hash <sha>]";

export type G8BrowserEvidenceValidationResult = G8ValidationResult;

/** Dispatch one G8 artifact to the schema-specific fail-closed validator. */
export function validateG8BrowserEvidence(
  value: unknown,
  binding: G8EvidenceBinding,
): G8BrowserEvidenceValidationResult {
  if (!isRecord(value)) {
    return finishResult(null, 0, [{ field: "record", message: "must be a JSON object" }]);
  }
  if (value.schemaVersion === RESPONSIVE_SCHEMA) {
    return validateResponsiveLayoutBrowserMatrix(value, binding);
  }
  if (value.schemaVersion === GOVERNANCE_SCHEMA) {
    return validateWebGovernanceBrowserInteractions(value, binding);
  }
  return finishResult(null, 0, [{
    field: "schemaVersion",
    message: `must be ${RESPONSIVE_SCHEMA} or ${GOVERNANCE_SCHEMA}`,
  }]);
}

/** Safely read, validate, and re-read one repo-relative G8 artifact. */
export function validateG8BrowserEvidenceFile(
  evidencePath: string,
  binding: G8EvidenceBinding,
): G8BrowserEvidenceValidationResult {
  const loaded = readG8JsonFile(binding.root, evidencePath);
  if (!loaded.file || !loaded.file.value) {
    return finishResult(null, 0, loaded.issues);
  }
  const result = validateG8BrowserEvidence(loaded.file.value, binding);
  const issues = [...loaded.issues, ...result.issues];
  rereadUnchanged(binding.root, loaded.file.relativePath, loaded.file.sha256, issues);
  return finishResult(result.schemaVersion, result.itemCount, issues, result.screenshots);
}

/** Resolve the checkout-bound values used by the CLI validator. */
export function currentG8Binding(root: string): G8EvidenceBinding {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  return {
    root,
    expectedCommit: currentGitCommit(root),
    expectedVersion: packageJson.version ?? "",
    expectedSourceHash: computeProductExperienceSourceHash(root),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  try {
    const parsed = parseCliOptions(args, USAGE);
    if (parsed.paths.length !== 1) {
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    const root = findWorkspaceRoot();
    const current = currentG8Binding(root);
    const binding = buildExpectedBinding(root, parsed.overrides, {
      commit: current.expectedCommit,
      version: current.expectedVersion,
      sourceHash: current.expectedSourceHash,
    });
    const result = validateG8BrowserEvidenceFile(parsed.paths[0] as string, binding);
    if (!result.valid) {
      printIssues(result.issues);
      console.error(`FAIL g8-browser-evidence-validate ${result.issues.length} issue(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS g8-browser-evidence-validate ${result.schemaVersion} (${result.itemCount} items; ${result.screenshots.length} screenshots hashed)`);
  } catch (error) {
    console.error(`ERROR ${safeV11Error(error)}`);
    console.error(USAGE);
    process.exitCode = 2;
  }
}

function printIssues(issues: G8ValidationIssue[]): void {
  for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
