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
  checkOnboardingDoc();
  checkEnvExample();
  checkEntryPoints();
  checkValidationMatrix();
  checkPackageScript();
  checkSkillReferences();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`operator onboarding preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("operator onboarding preflight passed: self-host onboarding entrypoints are present and safety-gated.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "docs/deployment/operator-onboarding.md",
    "docs/deployment/docker-compose.md",
    "docs/deployment/github-release-updater.md",
    "docs/deployment/backup-restore.md",
    "docs/development/operational-readiness.md",
    "docs/development/production-release-runbook.md",
    "docs/development/production-readonly-smoke-record-template.md",
    "docs/development/alert-drill-record-template.md",
    "docs/development/release-supply-chain-record-template.md",
    "docs/development/residual-risk-ledger.md",
    "docs/deployment/keys/areaforge-cosign.pub",
    "docker-compose.prod.yml",
    ".env.example",
    "ops/github-release-updater/areaforge-updater.env.example",
    "ops/github-release-updater/areaforge-updater.sh",
    "ops/github-release-updater/areaforge-updater.timer",
    "ops/update-agent/areaforge-update-agent.sh",
    "ops/update-agent/areaforge-ops001-evidence-export.sh",
    "ops/update-agent/areaforge-update-agent.timer",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required operator files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkOnboardingDoc(): void {
  const doc = read("docs/deployment/operator-onboarding.md");
  const requiredTerms = [
    "自托管操作者上手",
    "不是生产执行授权",
    "high-risk-confirmation-packets.md",
    ".env.production",
    "pnpm auth:hash",
    "AUTH_SESSION_SECRET",
    "AUTH_ADMIN_PASSWORD_HASH",
    "UPLOAD_DIR",
    "不在 `public/`",
    "docker-compose.prod.yml",
    "Nginx HTTPS",
    "Web runtime 不挂载 `docker.sock`",
    "GitHub Release 更新器",
    "AREAFORGE_REQUIRE_SIGNATURE=true",
    "AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub",
    "AREAFORGE_AUTO_APPLY=none",
    "AF-RISK-REL-001",
    "备份与恢复",
    "pnpm release:evidence:validate",
    "pnpm smoke:prod-readonly",
    "AREAFORGE_SMOKE_PASSWORD_FILE",
    "pnpm smoke:prod-readonly:validate",
    "areaforge-ops001-evidence-export.sh",
    "pnpm ops:readiness:summary",
    "pnpm ops:evidence:bundle",
    "pnpm ops:alert:preview",
    "pnpm alert:drill:validate",
    "release-supply-chain-record-template.md",
    "pnpm release:supply-chain:validate",
    "不让 Web runtime 执行 Docker",
    "不在没有确认和清理策略时执行生产写入型 smoke",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "AF-RISK-OPS-003",
    "AF-RISK-OPS-004",
    "pnpm operator:onboarding:preflight",
    "git diff --check",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  const forbiddenTerms = [
    "pnpm git diff --check",
    "docker.sock 挂进 Web",
    "默认开启 patch 自动应用",
  ];
  const presentForbidden = forbiddenTerms.filter((term) => doc.includes(term));
  checks.push({
    name: "operator onboarding doc",
    ok: missing.length === 0 && presentForbidden.length === 0,
    detail: missing.length === 0 && presentForbidden.length === 0
      ? "onboarding doc covers env, admin, uploads, updater, backup, smoke, alerting, release train, and forbidden actions"
      : `missing ${missing.join(", ") || "none"}; forbidden wording ${presentForbidden.join(", ") || "none"}`,
  });
}

function checkEnvExample(): void {
  const env = read(".env.example");
  const requiredKeys = [
    "NODE_ENV=",
    "APP_ENV=",
    "APP_URL=",
    "APP_VERSION=",
    "DATABASE_URL=",
    "POSTGRES_DB=",
    "POSTGRES_USER=",
    "POSTGRES_PASSWORD=",
    "WEB_PORT=",
    "AREAFORGE_IMAGE=",
    "AREAFORGE_OPS_STATE_DIR=",
    "AREAFORGE_OPS_STATE_HOST_DIR=",
    "AUTH_SESSION_SECRET=",
    "AUTH_ADMIN_EMAIL=",
    "AUTH_ADMIN_PASSWORD_HASH=",
    "AI_ENABLED=",
    "AI_API_KEY=",
    "AI_LOG_PROMPTS=false",
    "AI_ALLOW_SENSITIVE_CONTEXT=false",
    "UPLOAD_DIR=",
    "BACKUP_DIR=",
    "TRUST_PROXY=",
  ];
  const missing = requiredKeys.filter((term) => !env.includes(term));
  checks.push({
    name: "env example operator keys",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "env example exposes required self-host configuration keys" : `missing ${missing.join(", ")}`,
  });
}

function checkEntryPoints(): void {
  const rootReadme = read("README.md");
  const docsReadme = read("docs/README.md");
  const webReadme = read("apps/web/README.md");
  const dockerComposeDoc = read("docs/deployment/docker-compose.md");
  const requiredLinks = [
    [rootReadme, "docs/deployment/operator-onboarding.md", "README.md"],
    [docsReadme, "deployment/operator-onboarding.md", "docs/README.md"],
    [webReadme, "docs/deployment/operator-onboarding.md", "apps/web/README.md"],
    [dockerComposeDoc, "operator-onboarding.md", "docs/deployment/docker-compose.md"],
  ];
  const missing = requiredLinks
    .filter(([content, token]) => !content.includes(token))
    .map(([, token, source]) => `${source}:${token}`);
  checks.push({
    name: "operator docs entrypoints",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "README, docs index, web README, and deployment docs link onboarding" : `missing ${missing.join(", ")}`,
  });
}

function checkValidationMatrix(): void {
  const matrix = read("docs/development/validation-matrix.md");
  const requiredTerms = [
    "docs/deployment/operator-onboarding.md",
    "scripts/quality/operator-onboarding-preflight.ts",
    "pnpm operator:onboarding:preflight",
    "pnpm docs:readiness",
    "pnpm ops:readiness",
    "pnpm skills:validate",
  ];
  const missing = requiredTerms.filter((term) => !matrix.includes(term));
  checks.push({
    name: "validation matrix onboarding path",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "validation matrix defines onboarding docs/script checks" : `missing ${missing.join(", ")}`,
  });
}

function checkPackageScript(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["operator:onboarding:preflight"] ?? "";
  checks.push({
    name: "operator onboarding package script",
    ok: script === "tsx scripts/quality/operator-onboarding-preflight.ts",
    detail: script ? `operator:onboarding:preflight=${script}` : "operator:onboarding:preflight missing",
  });
}

function checkSkillReferences(): void {
  const sreSkill = read(".codex/skills-src/areaforge-sre-ops/SKILL.md");
  const opsRunbook = read(".codex/skills-src/areaforge-sre-ops/references/ops-runbook.md");
  const skillReadme = read(".codex/skills-src/README.md");
  const requiredTerms = [
    "docs/deployment/operator-onboarding.md",
    "operator:onboarding:preflight",
  ];
  const combined = `${sreSkill}\n${opsRunbook}\n${skillReadme}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "operator skill references",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "SRE skill and skill index reference operator onboarding" : `missing ${missing.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
