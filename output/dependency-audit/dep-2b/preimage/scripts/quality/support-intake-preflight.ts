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
  checkSupportPolicy();
  checkIssueTemplates();
  checkSupportIntakeDoc();
  checkPackageScript();
  checkEntryPoints();
  checkValidationMatrix();
  checkGovernancePreflight();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`support intake preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("support intake preflight passed: public support entrypoints are present and privacy-bounded.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "SUPPORT.md",
    "SECURITY.md",
    "CODE_REVIEW.md",
    "docs/development/support-intake.md",
    "docs/development/support-bundle-preview.md",
    ".codex/skills-src/areaforge-public-maintenance/SKILL.md",
    ".codex/skills-src/areaforge-public-maintenance/references/public-triage.md",
    ".github/ISSUE_TEMPLATE/bug_report.md",
    ".github/ISSUE_TEMPLATE/feature_request.md",
    ".github/ISSUE_TEMPLATE/ops_support.md",
    ".github/ISSUE_TEMPLATE/config.yml",
    "scripts/ops/support-bundle-preview.ts",
    "scripts/quality/support-bundle-preview-validate.ts",
    "scripts/quality/support-bundle-preview.selftest.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required support files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkSupportPolicy(): void {
  const support = read("SUPPORT.md");
  const requiredTerms = [
    "AreaForge Support",
    "best-effort",
    "Bug Report",
    "Feature Request",
    "Ops Support",
    "Security",
    "Do Not Post Publicly",
    "production `.env`",
    "database URLs",
    "API keys",
    "session secrets",
    "cosign private",
    "smoke passwords",
    "attachment contents",
    "full review text",
    "docs/development/support-intake.md",
  ];
  const missing = requiredTerms.filter((term) => !support.includes(term));
  checks.push({
    name: "support policy",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "SUPPORT.md routes support and forbids public sensitive data" : `missing ${missing.join(", ")}`,
  });
}

function checkIssueTemplates(): void {
  const bug = read(".github/ISSUE_TEMPLATE/bug_report.md");
  const feature = read(".github/ISSUE_TEMPLATE/feature_request.md");
  const ops = read(".github/ISSUE_TEMPLATE/ops_support.md");
  const config = read(".github/ISSUE_TEMPLATE/config.yml");
  const requiredTerms = [
    "needs-triage",
    "AUTH_SESSION_SECRET",
    "AI_API_KEY",
    "GitHub token",
    "cosign",
    "smoke 密码",
    "SUPPORT.md",
    "operator:onboarding:preflight",
    "ops:support:bundle-preview",
    "ops:support:bundle-preview:validate",
    "release:train:preflight",
    "AF-RISK-OPS-001",
    "AF-RISK-SC-001",
    "blank_issues_enabled: false",
    "security/advisories/new",
  ];
  const combined = `${bug}\n${feature}\n${ops}\n${config}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "issue templates",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "issue templates collect useful evidence and block public secret leakage" : `missing ${missing.join(", ")}`,
  });
}

function checkSupportIntakeDoc(): void {
  const doc = read("docs/development/support-intake.md");
  const requiredTerms = [
    "Support Intake",
    "SUPPORT.md",
    "SECURITY.md",
    "Triage 分类",
    "P0",
    "P1",
    "areaforge-sre-ops",
    "areaforge-release-operator",
    "areaforge-supply-chain",
    "areaforge-security-governance",
    "areaforge-public-maintenance",
    "敏感信息边界",
    "operator-onboarding.md",
    "release-train.md",
    "residual-risk-ledger.md",
    "公开 issue 不构成执行确认",
    "best-effort support",
    "metadata-only",
    "pnpm ops:support:bundle-preview",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  checks.push({
    name: "support intake doc",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "support intake doc defines triage, severity, privacy, and high-risk boundaries" : `missing ${missing.join(", ")}`,
  });
}

function checkPackageScript(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["support:intake:preflight"] ?? "";
  const supportBundlePreviewScript = packageJson.scripts?.["ops:support:bundle-preview"] ?? "";
  const supportBundlePreviewValidateScript = packageJson.scripts?.["ops:support:bundle-preview:validate"] ?? "";
  const supportBundlePreviewSelftestScript = packageJson.scripts?.["ops:support:bundle-preview:selftest"] ?? "";
  checks.push({
    name: "support intake package script",
    ok: script === "tsx scripts/quality/support-intake-preflight.ts" &&
      supportBundlePreviewScript === "tsx scripts/ops/support-bundle-preview.ts" &&
      supportBundlePreviewValidateScript === "tsx scripts/quality/support-bundle-preview-validate.ts" &&
      supportBundlePreviewSelftestScript === "tsx scripts/quality/support-bundle-preview.selftest.ts",
    detail: `support:intake:preflight=${script || "missing"}; ops:support:bundle-preview=${supportBundlePreviewScript || "missing"}; ops:support:bundle-preview:validate=${supportBundlePreviewValidateScript || "missing"}; ops:support:bundle-preview:selftest=${supportBundlePreviewSelftestScript || "missing"}`,
  });
}

function checkEntryPoints(): void {
  const rootReadme = read("README.md");
  const docsReadme = read("docs/README.md");
  const docSync = read("docs/development/doc-sync-checklist.md");
  const requiredLinks = [
    [rootReadme, "SUPPORT.md", "README.md"],
    [rootReadme, "docs/development/support-intake.md", "README.md"],
    [rootReadme, "docs/development/support-bundle-preview.md", "README.md"],
    [docsReadme, "development/support-intake.md", "docs/README.md"],
    [docsReadme, "development/support-bundle-preview.md", "docs/README.md"],
    [docsReadme, ".codex/skills-src/areaforge-public-maintenance", "docs/README.md"],
    [docSync, "docs/development/support-bundle-preview.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/support-intake.md", "docs/development/doc-sync-checklist.md"],
    [docSync, ".codex/skills-src/areaforge-public-maintenance", "docs/development/doc-sync-checklist.md"],
  ];
  const missing = requiredLinks
    .filter(([content, token]) => !content.includes(token))
    .map(([, token, source]) => `${source}:${token}`);
  checks.push({
    name: "support entrypoints",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "README, docs index, and doc sync checklist link support intake" : `missing ${missing.join(", ")}`,
  });
}

function checkValidationMatrix(): void {
  const matrix = read("docs/development/validation-matrix.md");
  const requiredTerms = [
    "SUPPORT.md",
    ".github/ISSUE_TEMPLATE/**",
    ".codex/skills-src/areaforge-public-maintenance/**",
    "docs/development/support-intake.md",
    "docs/development/support-bundle-preview.md",
    "scripts/quality/support-intake-preflight.ts",
    "scripts/ops/support-bundle-preview.ts",
    "scripts/quality/support-bundle-preview-validate.ts",
    "pnpm ops:support:bundle-preview:selftest",
    "pnpm support:intake:preflight",
    "pnpm governance:preflight",
    "pnpm docs:readiness",
    "pnpm skills:validate",
  ];
  const missing = requiredTerms.filter((term) => !matrix.includes(term));
  checks.push({
    name: "validation matrix support path",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "validation matrix defines support intake checks" : `missing ${missing.join(", ")}`,
  });
}

function checkGovernancePreflight(): void {
  const preflight = read("scripts/quality/governance-preflight.ts");
  const requiredTerms = [
    "SUPPORT.md",
    "support-intake.md",
    "ISSUE_TEMPLATE",
    "support:intake:preflight",
    "areaforge-public-maintenance",
  ];
  const missing = requiredTerms.filter((term) => !preflight.includes(term));
  checks.push({
    name: "governance preflight support coverage",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "governance preflight covers support and issue templates" : `missing ${missing.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
