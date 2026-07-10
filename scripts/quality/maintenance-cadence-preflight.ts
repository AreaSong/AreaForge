import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface ResidualLedger {
  items?: Array<{
    id?: string;
    type?: string;
    reviewAt?: string;
    ownerSkills?: string[];
  }>;
}

const root = process.cwd();
const checks: CheckResult[] = [];

function main(): void {
  checkRequiredFiles();
  checkMaintenanceDoc();
  checkResidualReviewMetadata();
  checkPackageScript();
  checkEntryPoints();
  checkOpsReadinessCoverage();
  checkSkillReferences();
  checkValidationMatrix();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`maintenance cadence preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("maintenance cadence preflight passed: maintenance rhythm is documented, evidence-gated, and read-only.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "docs/development/maintenance-cadence.md",
    "docs/development/operational-readiness.md",
    "docs/development/production-smoke-alerting-strategy.md",
    "docs/development/residual-risk-ledger.md",
    "docs/development/residual-risk-ledger.json",
    "docs/development/release-train.md",
    "docs/development/support-intake.md",
    "docs/deployment/operator-onboarding.md",
    "scripts/ops/operational-readiness-summary.ts",
    "scripts/ops/operational-evidence-bundle.ts",
    "scripts/ops/operational-alert-preview.ts",
    "scripts/quality/residual-ledger-validate.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required maintenance files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkMaintenanceDoc(): void {
  const doc = read("docs/development/maintenance-cadence.md");
  const requiredTerms = [
    "Maintenance Cadence",
    "不是自动运维授权",
    "Readiness、preview、evidence bundle 和 preflight",
    "不等于 apply",
    "每天",
    "每周",
    "每月",
    "每次 Release",
    "Incident 后",
    "Residual Review",
    "pnpm ops:readiness:summary",
    "pnpm ops:evidence:bundle",
    "pnpm ops:alert:preview",
    "pnpm maintenance:cadence:preflight",
    "pnpm residuals:validate",
    "pnpm alert:drill:validate",
    "pnpm release:supply-chain:validate",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-REL-001",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "AF-RISK-SC-003",
    "AF-RISK-OPS-003",
    "AF-RISK-OPS-004",
    "不连接生产",
    "不执行 Docker",
    "不写生产",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  checks.push({
    name: "maintenance cadence doc",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "maintenance doc covers daily/weekly/monthly/release/incident cadence, residual review, and forbidden actions"
      : `missing ${missing.join(", ")}`,
  });
}

function checkResidualReviewMetadata(): void {
  const ledger = JSON.parse(read("docs/development/residual-risk-ledger.json")) as ResidualLedger;
  const ids = new Set<string>();
  const invalid: string[] = [];
  for (const item of ledger.items ?? []) {
    if (item.id) ids.add(item.id);
    if (!item.id || !item.type || !item.reviewAt || !/^\d{4}-\d{2}-\d{2}$/.test(item.reviewAt)) {
      invalid.push(item.id ?? "<missing-id>");
    }
    if (!Array.isArray(item.ownerSkills) || item.ownerSkills.length === 0) {
      invalid.push(`${item.id ?? "<missing-id>"}:ownerSkills`);
    }
  }
  const requiredIds = [
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-REL-001",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "AF-RISK-SC-003",
    "AF-RISK-OPS-003",
    "AF-RISK-OPS-004",
  ];
  const missingIds = requiredIds.filter((id) => !ids.has(id));
  checks.push({
    name: "residual review metadata",
    ok: invalid.length === 0 && missingIds.length === 0,
    detail: invalid.length === 0 && missingIds.length === 0
      ? `${ids.size} residual items have reviewAt and ownerSkills`
      : `invalid ${invalid.join(", ") || "none"}; missing ${missingIds.join(", ") || "none"}`,
  });
}

function checkPackageScript(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["maintenance:cadence:preflight"] ?? "";
  checks.push({
    name: "maintenance cadence package script",
    ok: script === "tsx scripts/quality/maintenance-cadence-preflight.ts",
    detail: script ? `maintenance:cadence:preflight=${script}` : "maintenance:cadence:preflight missing",
  });
}

function checkEntryPoints(): void {
  const rootReadme = read("README.md");
  const docsReadme = read("docs/README.md");
  const workflowReadme = read("workflow/README.md");
  const docSync = read("docs/development/doc-sync-checklist.md");
  const requiredLinks = [
    [rootReadme, "docs/development/maintenance-cadence.md", "README.md"],
    [docsReadme, "development/maintenance-cadence.md", "docs/README.md"],
    [workflowReadme, "docs/development/maintenance-cadence.md", "workflow/README.md"],
    [docSync, "docs/development/maintenance-cadence.md", "docs/development/doc-sync-checklist.md"],
  ];
  const missing = requiredLinks
    .filter(([content, token]) => !content.includes(token))
    .map(([, token, source]) => `${source}:${token}`);
  checks.push({
    name: "maintenance entrypoints",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "README, docs index, workflow, and doc sync checklist link maintenance cadence" : `missing ${missing.join(", ")}`,
  });
}

function checkOpsReadinessCoverage(): void {
  const opsReadiness = read("scripts/quality/ops-readiness-preflight.ts");
  const operationalReadiness = read("docs/development/operational-readiness.md");
  const requiredTerms = [
    "docs/development/maintenance-cadence.md",
    "scripts/quality/maintenance-cadence-preflight.ts",
    "maintenance:cadence:preflight",
    "pnpm maintenance:cadence:preflight",
  ];
  const combined = `${opsReadiness}\n${operationalReadiness}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "ops readiness maintenance coverage",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "ops readiness covers maintenance cadence docs and preflight" : `missing ${missing.join(", ")}`,
  });
}

function checkSkillReferences(): void {
  const observability = read(".codex/skills-src/areaforge-observability/SKILL.md");
  const residual = read(".codex/skills-src/areaforge-residual-ledger/SKILL.md");
  const enterprise = read(".codex/skills-src/areaforge-enterprise-governance/SKILL.md");
  const skillReadme = read(".codex/skills-src/README.md");
  const requiredTerms = [
    "docs/development/maintenance-cadence.md",
    "maintenance:cadence:preflight",
  ];
  const combined = `${observability}\n${residual}\n${enterprise}\n${skillReadme}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "maintenance skill references",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "observability, residual, enterprise, and skill index reference maintenance cadence" : `missing ${missing.join(", ")}`,
  });
}

function checkValidationMatrix(): void {
  const matrix = read("docs/development/validation-matrix.md");
  const requiredTerms = [
    "docs/development/maintenance-cadence.md",
    "scripts/quality/maintenance-cadence-preflight.ts",
    "pnpm maintenance:cadence:preflight",
    "pnpm ops:readiness",
    "pnpm residuals:validate",
    "pnpm docs:readiness",
    "pnpm skills:validate",
  ];
  const missing = requiredTerms.filter((term) => !matrix.includes(term));
  checks.push({
    name: "validation matrix maintenance path",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "validation matrix defines maintenance cadence checks" : `missing ${missing.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
