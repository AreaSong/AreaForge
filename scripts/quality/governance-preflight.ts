import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const checks: CheckResult[] = [];

function main(): void {
  checkRequiredFiles();
  checkSecurityPolicy();
  checkDependabot();
  checkPullRequestTemplate();
  checkDependencyPolicy();
  checkCiRunsGovernance();
  checkReleaseWorkflowGovernance();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`governance preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("governance preflight passed: public project governance entrypoints are present and evidence-gated.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "SECURITY.md",
    ".github/dependabot.yml",
    ".github/pull_request_template.md",
    "docs/development/dependency-policy.md",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required governance files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkSecurityPolicy(): void {
  const security = read("SECURITY.md");
  const requiredTerms = [
    "private vulnerability",
    "Do not include exploit details",
    "auth/session",
    "upload/download",
    "AI provider",
    "updater/release",
    "Web runtime must not execute Docker",
    "docs/security/threat-model.md",
    "docs/security/file-ai-safety.md",
  ];
  const missing = requiredTerms.filter((term) => !security.includes(term));
  checks.push({
    name: "security policy",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "SECURITY.md documents private reporting, sensitive surfaces, and no-web-ops boundary"
      : `missing ${missing.join(", ")}`,
  });
}

function checkDependabot(): void {
  const dependabot = read(".github/dependabot.yml");
  const requiredTerms = [
    'package-ecosystem: "npm"',
    'package-ecosystem: "github-actions"',
    'package-ecosystem: "docker"',
    'directory: "/"',
    'directory: "/infra/docker"',
    'interval: "weekly"',
    "open-pull-requests-limit",
  ];
  const missing = requiredTerms.filter((term) => !dependabot.includes(term));
  checks.push({
    name: "dependabot config",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "Dependabot covers npm, GitHub Actions, and Docker weekly"
      : `missing ${missing.join(", ")}`,
  });
}

function checkPullRequestTemplate(): void {
  const template = read(".github/pull_request_template.md");
  const requiredTerms = [
    "High-Risk Boundary",
    "pnpm governance:preflight",
    "pnpm skills:validate",
    "pnpm docs:readiness",
    "pnpm docs:completion",
    "pnpm risk:preflight",
    "pnpm check",
    "Release / Ops Evidence",
    "Residual Risk",
  ];
  const missing = requiredTerms.filter((term) => !template.includes(term));
  checks.push({
    name: "pull request template",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "PR template requires high-risk, validation, release, and residual risk evidence"
      : `missing ${missing.join(", ")}`,
  });
}

function checkDependencyPolicy(): void {
  const policy = read("docs/development/dependency-policy.md");
  const requiredTerms = [
    "pnpm-lock.yaml",
    "GitHub Actions",
    "Docker base image",
    "Dependabot",
    "pnpm governance:preflight",
    "pnpm github-release-updater:preflight",
    "SBOM",
    "provenance",
  ];
  const missing = requiredTerms.filter((term) => !policy.includes(term));
  checks.push({
    name: "dependency policy",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "dependency policy documents admission, validation, Dependabot, and residual supply-chain gaps"
      : `missing ${missing.join(", ")}`,
  });
}

function checkCiRunsGovernance(): void {
  const ci = read(".github/workflows/ci.yml");
  checks.push({
    name: "CI governance gate",
    ok: ci.includes("pnpm governance:preflight"),
    detail: ci.includes("pnpm governance:preflight")
      ? "CI runs governance preflight"
      : "CI must run pnpm governance:preflight",
  });
}

function checkReleaseWorkflowGovernance(): void {
  const release = read(".github/workflows/release.yml");
  const requiredTerms = [
    "validate:",
    "needs: validate",
    "pnpm governance:preflight",
    "pnpm ops:readiness",
    "pnpm skills:validate",
    "stable releases require COSIGN_PRIVATE_KEY_B64 or COSIGN_PRIVATE_KEY",
    "release tag ${tag} does not match package.json version",
  ];
  const missing = requiredTerms.filter((term) => !release.includes(term));
  checks.push({
    name: "release governance gate",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "release workflow validates before publishing and stable signing fails closed"
      : `missing ${missing.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
