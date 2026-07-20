import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { validateGovernanceRegister } from "./governance-register-validate";

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
  checkGovernanceBoundaryMatrix();
  checkGovernanceRegister();
  checkCiRunsGovernance();
  checkReleaseWorkflowGovernance();
  checkSecretScanGate();
  checkSecretScanExceptions();
  checkCheckoutCredentialPersistence();
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
    "docs/development/governance-boundary-matrix.md",
    "docs/development/governance-register.json",
    "docs/development/governance-register.md",
    "docs/development/protected-path-review-record-template.md",
    "docs/development/support-intake.md",
    ".gitleaksignore",
    ".codex/skills-src/areaforge-public-maintenance/SKILL.md",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required governance files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkGovernanceRegister(): void {
  const register = JSON.parse(read("docs/development/governance-register.json")) as unknown;
  const issues = validateGovernanceRegister(register, root);
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const scriptsOk = packageJson.scripts?.["governance:register:validate"] === "tsx scripts/quality/governance-register-validate.ts" &&
    packageJson.scripts?.["governance:register:selftest"] === "tsx scripts/quality/governance-register-validate.selftest.ts";
  checks.push({
    name: "governance register",
    ok: issues.length === 0 && scriptsOk,
    detail: issues.length === 0 && scriptsOk
      ? "authority paths, accountable owners, enforcement refs, and review triggers are centrally indexed without duplicating lifecycle or residual state"
      : `issues=${issues.map((issue) => `${issue.field}:${issue.message}`).join(" | ") || "none"}; scriptsOk=${scriptsOk}`,
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
    "pnpm audit:all",
    "SBOM",
    "provenance",
    "40 位 commit SHA",
    "pnpm secrets:scan",
    "Gitleaks CLI `8.30.1`",
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

function checkSecretScanGate(): void {
  const packageJson = read("package.json");
  const script = read("scripts/quality/secret-scan.ts");
  const workflows = `${read(".github/workflows/ci.yml")}\n${read(".github/workflows/release.yml")}`;
  const admission = read("docs/development/external-capability-admission.md");
  const ignores = read(".gitleaksignore");
  const requiredTerms = [
    '"secrets:scan": "tsx scripts/quality/secret-scan.ts"',
    "--redact=100",
    "GITLEAKS_VERSION: 8.30.1",
    "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    "run: pnpm secrets:scan",
    "forbiddenOutputs: 匹配值、原始报告、SARIF 上传、PR 评论、secret 内容",
    "fd2cca12d7fb4aa945b1a9a5e39f5f4ce1021f7a:scripts/quality/update-production-state-lock.selftest.ts:generic-api-key:284",
  ];
  const combined = `${packageJson}\n${script}\n${workflows}\n${admission}\n${ignores}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  const runCount = workflows.split("run: pnpm secrets:scan").length - 1;
  checks.push({
    name: "commit secret scan",
    ok: missing.length === 0 && runCount === 2,
    detail: missing.length === 0 && runCount === 2
      ? "CI and Release run checksum-pinned, redacted Gitleaks scans without Actions secret access or report upload"
      : `missing ${missing.join(", ") || "workflow invocation count=2"}`,
  });
}

function checkSecretScanExceptions(): void {
  const ignoreLines = read(".gitleaksignore")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const expectedFingerprint = "fd2cca12d7fb4aa945b1a9a5e39f5f4ce1021f7a:scripts/quality/update-production-state-lock.selftest.ts:generic-api-key:284";
  const markers: string[] = [];
  for (const file of trackedFiles()) {
    if (!existsSync(resolve(file))) continue;
    let content: string;
    try {
      content = read(file);
    } catch {
      continue;
    }
    content.split(/\r?\n/).forEach((line, index) => {
      if (/(?:\/\/|#)\s*gitleaks:allow\b/.test(line)) markers.push(`${file}:${index + 1}:${line.trim()}`);
    });
  }
  const expectedMarkerPrefix = "scripts/quality/update-production-state-lock.selftest.ts:";
  const markerOk = markers.length === 1 && markers[0]?.startsWith(expectedMarkerPrefix) && markers[0]?.includes("synthetic invalid manifest fixture");
  checks.push({
    name: "secret scan exceptions",
    ok: ignoreLines.length === 1 && ignoreLines[0] === expectedFingerprint && Boolean(markerOk),
    detail: ignoreLines.length === 1 && ignoreLines[0] === expectedFingerprint && markerOk
      ? "secret scan exceptions are limited to one reviewed historical fingerprint and one synthetic fixture line"
      : `unexpected fingerprints=${ignoreLines.length}; inline markers=${markers.length}`,
  });
}

function checkCheckoutCredentialPersistence(): void {
  const workflows = `${read(".github/workflows/ci.yml")}\n${read(".github/workflows/release.yml")}`;
  const checkoutCount = workflows.split("uses: actions/checkout@").length - 1;
  const disabledCount = workflows.split("persist-credentials: false").length - 1;
  checks.push({
    name: "checkout credential persistence",
    ok: checkoutCount === 3 && disabledCount === checkoutCount,
    detail: checkoutCount === 3 && disabledCount === checkoutCount
      ? "all CI and Release checkout steps disable persisted Git credentials"
      : `checkout steps=${checkoutCount}; persist-credentials disabled=${disabledCount}`,
  });
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
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

function checkGovernanceBoundaryMatrix(): void {
  const matrix = read("docs/development/governance-boundary-matrix.md");
  const template = read("docs/development/protected-path-review-record-template.md");
  const packageJson = read("package.json");
  const requiredMatrixTerms = [
    "R0",
    "R1",
    "R2",
    "R3",
    "R4",
    "apps/web/**",
    "packages/core/**",
    "prisma/**",
    "ops/**",
    ".github/**",
    "Web runtime 不执行服务器运维命令",
    "pnpm governance:protected-path-review:validate",
  ];
  const requiredTemplateTerms = [
    "worktreeStatusHash",
    "protectedPathFingerprint",
    "doesNotProve",
    "residual ledger closure",
    "pnpm governance:protected-path-review:validate",
  ];
  const requiredScripts = [
    "governance:changed-paths",
    "governance:changed-paths:selftest",
    "governance:protected-path-review:validate",
    "governance:protected-path-review:selftest",
  ];
  const missing = [
    ...requiredMatrixTerms.filter((term) => !matrix.includes(term)).map((term) => `matrix:${term}`),
    ...requiredTemplateTerms.filter((term) => !template.includes(term)).map((term) => `template:${term}`),
    ...requiredScripts.filter((term) => !packageJson.includes(term)).map((term) => `package.json:${term}`),
  ];
  checks.push({
    name: "governance boundary matrix",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "directory ownership, R0-R4 routing, changed-path classification, and protected-path review gate are present"
      : `missing ${missing.join(", ")}`,
  });
}

function checkCiRunsGovernance(): void {
  const ci = read(".github/workflows/ci.yml");
  const requiredTerms = [
    "pnpm db:generate",
    "pnpm governance:preflight",
    "pnpm governance:changed-paths --base",
    "pnpm governance:changed-paths:selftest",
    "pnpm governance:protected-path-review:selftest",
    "pnpm skills:validate",
    "pnpm audit:all",
    "pnpm ci:supply-chain:selftest",
  ];
  const missing = requiredTerms.filter((term) => !ci.includes(term));
  const installDependenciesIndex = ci.indexOf("run: pnpm install --frozen-lockfile");
  const generatePrismaIndex = ci.indexOf("run: pnpm db:generate");
  const opsConfirmationSelftestsIndex = ci.indexOf("- name: OPS-006/007/008 confirmation-before selftests");
  const prismaGenerationOrderValid = installDependenciesIndex >= 0 &&
    generatePrismaIndex > installDependenciesIndex &&
    opsConfirmationSelftestsIndex > generatePrismaIndex;
  checks.push({
    name: "CI governance gate",
    ok: missing.length === 0 && prismaGenerationOrderValid,
    detail: missing.length === 0 && prismaGenerationOrderValid
      ? "CI generates the Prisma client before database-importing ops selftests and runs governance and skills validation"
      : `CI must run ${missing.join(", ") || "all required commands"}; Prisma generation order valid=${prismaGenerationOrderValid}`,
  });
}

function checkReleaseWorkflowGovernance(): void {
  const release = read(".github/workflows/release.yml");
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const requiredTerms = [
    "validate:",
    "needs: validate",
    "pnpm governance:preflight",
    "pnpm ops:readiness",
    "pnpm skills:validate",
    "pnpm audit:all",
    "stable releases require COSIGN_PRIVATE_KEY_B64 or COSIGN_PRIVATE_KEY",
    "pnpm release:admission:selftest",
    "pnpm release:admission",
    "AREAFORGE_RELEASE_TAG:",
    "AREAFORGE_WORKFLOW_SHA:",
    "Reject existing immutable release identity",
    "pnpm release:identity:probe:selftest",
    "pnpm release:identity:probe",
    "pnpm release:workflow:policy:selftest",
    "AREAFORGE_RELEASE_REPOSITORY:",
    "AREAFORGE_RELEASE_WEB_IMAGE:",
    "AREAFORGE_RELEASE_MIGRATION_IMAGE:",
    "release channel must be stable or preview",
  ];
  const missing = requiredTerms.filter((term) => !release.includes(term));
  const scriptsOk = packageJson.scripts?.["release:admission"] === "tsx scripts/quality/release-admission.ts" &&
    packageJson.scripts?.["release:admission:selftest"] === "tsx scripts/quality/release-admission.selftest.ts" &&
    packageJson.scripts?.["release:identity:probe"] === "tsx scripts/quality/release-identity-probe.ts" &&
    packageJson.scripts?.["release:identity:probe:selftest"] === "tsx scripts/quality/release-identity-probe.selftest.ts" &&
    packageJson.scripts?.["release:workflow:policy"] === "tsx scripts/quality/release-workflow-policy.ts" &&
    packageJson.scripts?.["release:workflow:policy:selftest"] === "tsx scripts/quality/release-workflow-policy.selftest.ts";
  checks.push({
    name: "release governance gate",
    ok: missing.length === 0 && scriptsOk,
    detail: missing.length === 0 && scriptsOk
      ? "release workflow validates structured admission and immutable identities before publishing, and stable signing fails closed"
      : `missing ${missing.join(", ") || "none"}; release scripts exact=${scriptsOk}`,
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
