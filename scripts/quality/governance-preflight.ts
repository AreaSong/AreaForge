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
  checkSupportPolicy();
  checkIssueTemplates();
  checkDependabot();
  checkPullRequestTemplate();
  checkCodeReviewPolicy();
  checkDependencyPolicy();
  checkExternalCapabilityAdmission();
  checkCiRunsGovernance();
  checkReleaseWorkflowGovernance();
  checkPinnedGitHubActions();

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
    "SUPPORT.md",
    "CODE_REVIEW.md",
    ".github/ISSUE_TEMPLATE/bug_report.md",
    ".github/ISSUE_TEMPLATE/feature_request.md",
    ".github/ISSUE_TEMPLATE/ops_support.md",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/dependabot.yml",
    ".github/pull_request_template.md",
    "docs/development/dependency-policy.md",
    "docs/development/external-capability-admission.md",
    "docs/development/support-intake.md",
    ".codex/skills-src/areaforge-public-maintenance/SKILL.md",
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

function checkSupportPolicy(): void {
  const support = read("SUPPORT.md");
  const intake = read("docs/development/support-intake.md");
  const requiredTerms = [
    "best-effort",
    "Bug Report",
    "Feature Request",
    "Ops Support",
    "Security",
    "Do Not Post Publicly",
    "production `.env`",
    "database URLs",
    "API keys",
    "cosign private",
    "smoke passwords",
    "docs/development/support-intake.md",
    "areaforge-public-maintenance",
    "公开 issue 不构成执行确认",
    "operator-onboarding.md",
    "release-train.md",
  ];
  const combined = `${support}\n${intake}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "support policy",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "SUPPORT and support intake docs route public issues without leaking secrets or authorizing production ops"
      : `missing ${missing.join(", ")}`,
  });
}

function checkIssueTemplates(): void {
  const bug = read(".github/ISSUE_TEMPLATE/bug_report.md");
  const feature = read(".github/ISSUE_TEMPLATE/feature_request.md");
  const ops = read(".github/ISSUE_TEMPLATE/ops_support.md");
  const config = read(".github/ISSUE_TEMPLATE/config.yml");
  const packageJson = read("package.json");
  const requiredTerms = [
    "needs-triage",
    "SUPPORT.md",
    "Security",
    "AUTH_SESSION_SECRET",
    "AI_API_KEY",
    "GitHub token",
    "operator:onboarding:preflight",
    "release:train:preflight",
    "AF-RISK-OPS-001",
    "blank_issues_enabled: false",
    "security/advisories/new",
    "support:intake:preflight",
  ];
  const combined = `${bug}\n${feature}\n${ops}\n${config}\n${packageJson}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "issue templates",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "Issue templates collect redacted bug/feature/ops evidence and route security privately"
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
    "CODE_REVIEW.md",
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

function checkCodeReviewPolicy(): void {
  const policy = read("CODE_REVIEW.md");
  const requiredTerms = [
    "评审目标",
    "阻断项",
    "评审顺序",
    "输出格式",
    "findings first",
    "Web runtime",
    "Attachment.uri",
    "SHA256SUMS",
    "residual-risk-ledger.md",
    "AF-RISK-*",
  ];
  const missing = requiredTerms.filter((term) => !policy.includes(term));
  checks.push({
    name: "code review policy",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "CODE_REVIEW.md defines AreaForge source-fact, high-risk, evidence, and residual-risk review gates"
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
    "pnpm audit:prod",
    "SBOM",
    "provenance",
    "40 位 commit SHA",
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

function checkExternalCapabilityAdmission(): void {
  const doc = read("docs/development/external-capability-admission.md");
  const agents = read("AGENTS.md");
  const docsReadme = read("docs/README.md");
  const ci = read(".github/workflows/ci.yml");
  const requiredTerms = [
    "Subagent",
    "Browser / Computer Use",
    "MCP",
    "Web runtime",
    "Docker",
    "备份",
    "migration",
    "服务器命令",
    "高风险确认",
    "preview_only",
    "fixture_only",
    "confirmed_apply",
    "production_scoped",
    "suspended",
    "pnpm governance:preflight",
    "pnpm skills:validate",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  const linked = [
    [agents, "docs/development/external-capability-admission.md", "AGENTS.md"],
    [docsReadme, "development/external-capability-admission.md", "docs/README.md"],
    [ci, "pnpm skills:validate", ".github/workflows/ci.yml"],
  ].filter(([content, token]) => !content.includes(token)).map(([, token, source]) => `${source}:${token}`);

  checks.push({
    name: "external capability admission",
    ok: missing.length === 0 && linked.length === 0,
    detail: missing.length === 0 && linked.length === 0
      ? "external tool/subagent/automation boundary is documented and CI validates repo-local skills"
      : `missing terms ${missing.join(", ") || "none"}; missing links ${linked.join(", ") || "none"}`,
  });
}

function checkCiRunsGovernance(): void {
  const ci = read(".github/workflows/ci.yml");
  const requiredTerms = [
    "pnpm governance:preflight",
    "pnpm skills:validate",
    "pnpm audit:prod",
  ];
  const missing = requiredTerms.filter((term) => !ci.includes(term));
  checks.push({
    name: "CI governance gate",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "CI runs governance preflight and skills validation"
      : `CI must run ${missing.join(", ")}`,
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
    "pnpm audit:prod",
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

function checkPinnedGitHubActions(): void {
  const workflowFiles = [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ];
  const unpinned: string[] = [];
  const entries: string[] = [];

  for (const file of workflowFiles) {
    const lines = read(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*uses:\s*([^@\s#]+)@([^\s#]+)/);
      if (!match) {
        return;
      }

      const [, action, ref] = match;
      if (action.startsWith("./")) {
        return;
      }

      entries.push(`${file}:${index + 1}:${action}@${ref}`);
      if (!/^[a-f0-9]{40}$/i.test(ref)) {
        unpinned.push(`${file}:${index + 1}:${action}@${ref}`);
      }
    });
  }

  checks.push({
    name: "pinned GitHub Actions",
    ok: entries.length > 0 && unpinned.length === 0,
    detail: entries.length === 0
      ? "no external GitHub Actions uses entries found"
      : unpinned.length === 0
        ? `${entries.length} external GitHub Actions entries pinned to 40-character commit SHAs`
        : `unpinned entries ${unpinned.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
