import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const WEB_GOVERNANCE_GATES = [
  "web:shared-boundary",
  "web:api-parser-boundary",
  "web:ui-primitives-boundary",
  "web:client-boundary",
  "web:component-complexity",
] as const;

export const WEB_GOVERNANCE_SELFTESTS = WEB_GOVERNANCE_GATES.map(
  (gate) => `${gate}:selftest`,
);
export const WEB_GOVERNANCE_PREFLIGHT_SELFTEST = "web:governance:preflight:selftest" as const;

/** G8 browser evidence quality scripts owned by the web governance gate. */
export const WEB_GOVERNANCE_G8_QUALITY_FILES = [
  "scripts/quality/g8-browser-evidence-common.ts",
  "scripts/quality/g8-browser-evidence-selftest-fixture.ts",
  "scripts/quality/g8-browser-evidence-validate.ts",
  "scripts/quality/g8-browser-evidence-validate.selftest.ts",
  "scripts/quality/g8-browser-evidence-pair-validate.ts",
  "scripts/quality/g8-browser-evidence-pair-validate.selftest.ts",
  "scripts/quality/responsive-layout-browser-matrix-validate.ts",
  "scripts/quality/responsive-layout-browser-matrix-validate.selftest.ts",
  "scripts/quality/web-governance-browser-interactions-validate.ts",
  "scripts/quality/web-governance-browser-interactions-validate.selftest.ts",
] as const;

export const WEB_GOVERNANCE_G8_VALIDATORS = [
  ["ops:g8:browser-evidence:validate", "scripts/quality/g8-browser-evidence-validate.ts"],
  ["ops:g8:browser-evidence:pair:validate", "scripts/quality/g8-browser-evidence-pair-validate.ts"],
  ["ops:responsive-layout:browser-matrix:validate", "scripts/quality/responsive-layout-browser-matrix-validate.ts"],
  ["ops:web-governance:browser-interactions:validate", "scripts/quality/web-governance-browser-interactions-validate.ts"],
] as const;

export const WEB_GOVERNANCE_G8_SELFTESTS = [
  ["ops:g8:browser-evidence:selftest", "scripts/quality/g8-browser-evidence-validate.selftest.ts"],
  ["ops:g8:browser-evidence:pair:selftest", "scripts/quality/g8-browser-evidence-pair-validate.selftest.ts"],
  ["ops:responsive-layout:browser-matrix:selftest", "scripts/quality/responsive-layout-browser-matrix-validate.selftest.ts"],
  ["ops:web-governance:browser-interactions:selftest", "scripts/quality/web-governance-browser-interactions-validate.selftest.ts"],
] as const;

export interface WebGovernancePreflightReport {
  issues: string[];
  requiredFiles: string[];
}

const REQUIRED_FILES = [
  "docs/architecture/web-shared-capability-inventory.json",
  ...WEB_GOVERNANCE_GATES.map((name) => qualityScriptPath(name)),
  ...WEB_GOVERNANCE_SELFTESTS.map((name) => qualityScriptPath(name)),
  qualityScriptPath(WEB_GOVERNANCE_PREFLIGHT_SELFTEST),
  ...WEB_GOVERNANCE_G8_QUALITY_FILES,
] as const;

function qualityScriptPath(name: string): string {
  const selftest = name.endsWith(":selftest");
  const base = name.replace(/^web:/, "web-").replace(/:selftest$/, "").replaceAll(":", "-");
  return `scripts/quality/${base}${selftest ? ".selftest" : ""}.ts`;
}

export function collectWebGovernancePreflightReport(
  workspaceRoot = process.cwd(),
): WebGovernancePreflightReport {
  const issues: string[] = [];
  const packagePath = path.join(workspaceRoot, "package.json");
  const workflowPath = path.join(workspaceRoot, ".github/workflows/ci.yml");
  if (!existsSync(packagePath)) issues.push("package.json is missing");
  if (!existsSync(workflowPath)) issues.push(".github/workflows/ci.yml is missing");

  for (const relative of REQUIRED_FILES) {
    if (!existsSync(path.join(workspaceRoot, relative))) issues.push(`${relative} is missing`);
  }

  if (!existsSync(packagePath)) return { issues, requiredFiles: [...REQUIRED_FILES] };
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  const scripts = packageJson.scripts ?? {};
  for (const gate of WEB_GOVERNANCE_GATES) {
    if (typeof scripts[gate] !== "string" || !scripts[gate].includes(qualityScriptPath(gate))) {
      issues.push(`${gate} must point to its canonical quality script`);
    }
    const selftest = `${gate}:selftest`;
    if (typeof scripts[selftest] !== "string" || !scripts[selftest].includes(qualityScriptPath(selftest))) {
      issues.push(`${selftest} must point to its canonical selftest`);
    }
  }
  if (typeof scripts[WEB_GOVERNANCE_PREFLIGHT_SELFTEST] !== "string"
    || !scripts[WEB_GOVERNANCE_PREFLIGHT_SELFTEST].includes(qualityScriptPath(WEB_GOVERNANCE_PREFLIGHT_SELFTEST))) {
    issues.push(`${WEB_GOVERNANCE_PREFLIGHT_SELFTEST} must point to its canonical selftest`);
  }

  for (const [command, script] of [...WEB_GOVERNANCE_G8_VALIDATORS, ...WEB_GOVERNANCE_G8_SELFTESTS]) {
    if (typeof scripts[command] !== "string" || !scripts[command].includes(script)) {
      issues.push(`${command} must point to its canonical quality script`);
    }
  }

  const typecheck = String(scripts["web:governance:typecheck"] ?? "");
  for (const relative of REQUIRED_FILES.filter((file) => file.startsWith("scripts/quality/"))) {
    if (!typecheck.includes(relative)) issues.push(`web:governance:typecheck must include ${relative}`);
  }

  const selftestAggregate = String(scripts["web:governance:selftest"] ?? "");
  for (const selftest of [...WEB_GOVERNANCE_SELFTESTS, WEB_GOVERNANCE_PREFLIGHT_SELFTEST]) {
    if (!selftestAggregate.includes(`pnpm ${selftest}`)) issues.push(`web:governance:selftest must run ${selftest}`);
  }
  for (const [command] of WEB_GOVERNANCE_G8_SELFTESTS) {
    if (!selftestAggregate.includes(`pnpm ${command}`)) issues.push(`web:governance:selftest must run ${command}`);
  }

  const check = String(scripts.check ?? "");
  for (const required of [
    "web:governance:preflight",
    "web:governance:selftest",
    "web:governance:typecheck",
    ...WEB_GOVERNANCE_GATES,
  ]) {
    if (!check.includes(`pnpm ${required}`)) issues.push(`check must include pnpm ${required}`);
  }

  if (existsSync(workflowPath)) {
    const workflow = readFileSync(workflowPath, "utf8");
    for (const required of ["web:governance:preflight", "web:governance:selftest"]) {
      if (!workflow.includes(`pnpm ${required}`)) issues.push(`CI must run pnpm ${required}`);
    }
  }

  return { issues, requiredFiles: [...REQUIRED_FILES] };
}

export function assertWebGovernancePreflight(workspaceRoot = process.cwd()): WebGovernancePreflightReport {
  const report = collectWebGovernancePreflightReport(workspaceRoot);
  for (const issue of report.issues) console.error(`FAIL web governance preflight: ${issue}`);
  if (report.issues.length > 0) throw new Error(`web governance preflight failed: ${report.issues.length} issue(s)`);
  console.log(`web governance preflight passed: ${report.requiredFiles.length} owned files and all check/CI bindings present`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  assertWebGovernancePreflight();
}
