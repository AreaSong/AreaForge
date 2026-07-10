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
  checkOperationalReadinessDoc();
  checkResidualLedger();
  checkOperatingLoopSkill();
  checkReleaseWorkflowHardGates();
  checkPackageScripts();
  checkSummaryScript();
  checkLocalUxSmokeScript();
  checkDocsIndex();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`ops readiness preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("ops readiness preflight passed: long-term operations evidence entrypoints are present and read-only.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "docs/development/operational-readiness.md",
    "docs/development/residual-risk-ledger.md",
    "docs/development/residual-risk-ledger.json",
    ".codex/skills-src/areaforge-operating-loop/SKILL.md",
    ".codex/skills-src/areaforge-operating-loop/references/loop-map.md",
    "scripts/ops/operational-readiness-summary.ts",
    "scripts/ops/local-ux-smoke.ts",
    "scripts/quality/residual-ledger-validate.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required ops readiness files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkOperationalReadinessDoc(): void {
  const doc = read("docs/development/operational-readiness.md");
  const requiredTerms = [
    "只读运营证据聚合入口",
    "AREAFORGE_AUTO_APPLY=none",
    "Web runtime",
    "不得执行 Docker",
    "Public health",
    "Authenticated smoke",
    "Release identity",
    "Update-agent status",
    "Backup freshness",
    "Rollback target",
    "pnpm ops:readiness",
    "pnpm smoke:local-ux",
    "AF-RISK-OPS-002",
    "residual-risk-ledger.md",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  checks.push({
    name: "operational readiness doc",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "readiness doc defines signals, freshness, no-web-ops boundary, and residual linkage"
      : `missing ${missing.join(", ")}`,
  });
}

function checkResidualLedger(): void {
  const ledger = read("docs/development/residual-risk-ledger.md");
  const machineLedger = read("docs/development/residual-risk-ledger.json");
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
  const requiredTerms = [
    "monitoring-gap",
    "deferred-work",
    "accepted-exception",
    "关闭条件",
    "所需证据",
    "Owner",
  ];
  const combined = `${ledger}\n${machineLedger}`;
  const missingIds = requiredIds.filter((term) => !combined.includes(term));
  const missingTerms = requiredTerms.filter((term) => !ledger.includes(term));
  const hasValidationScript = read("package.json").includes("residuals:validate");
  checks.push({
    name: "residual risk ledger",
    ok: missingIds.length === 0 && missingTerms.length === 0 && hasValidationScript,
    detail: missingIds.length === 0 && missingTerms.length === 0 && hasValidationScript
      ? "ledger indexes long-term ops, release, supply-chain, and observability residuals with close evidence and machine validation"
      : `missing IDs ${missingIds.join(", ") || "none"}; missing terms ${missingTerms.join(", ") || "none"}; residuals:validate=${hasValidationScript}`,
  });
}

function checkOperatingLoopSkill(): void {
  const skill = read(".codex/skills-src/areaforge-operating-loop/SKILL.md");
  const loopMap = read(".codex/skills-src/areaforge-operating-loop/references/loop-map.md");
  const requiredTerms = [
    "production-release-runbook.md",
    "github-release-updater.md",
    "high-risk-confirmation-packets.md",
    ".github/workflows/release.yml",
    "areaforge-qa-smoke",
    "areaforge-security-governance",
    "post-release public health",
    "authenticated smoke",
    "update-agent status",
    "rollback target",
  ];
  const combined = `${skill}\n${loopMap}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "operating loop release routing",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "operating loop directly routes release/update work to runbook, updater, workflow, security, and smoke evidence"
      : `missing ${missing.join(", ")}`,
  });
}

function checkReleaseWorkflowHardGates(): void {
  const workflow = read(".github/workflows/release.yml");
  const requiredTerms = [
    "validate:",
    "needs: validate",
    "pnpm governance:preflight",
    "pnpm ops:readiness",
    "pnpm github-release-updater:preflight",
    "pnpm shellcheck:updater",
    "pnpm skills:validate",
    "pnpm check",
    "stable releases require COSIGN_PRIVATE_KEY_B64 or COSIGN_PRIVATE_KEY",
    "unsigned preview",
    "release tag ${tag} does not match package.json version",
  ];
  const missing = requiredTerms.filter((term) => !workflow.includes(term));
  checks.push({
    name: "release workflow hard gates",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "release workflow validates before build and fails closed for unsigned stable releases"
      : `missing ${missing.join(", ")}`,
  });
}

function checkPackageScripts(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["ops:readiness"] ?? "";
  const summaryScript = packageJson.scripts?.["ops:readiness:summary"] ?? "";
  const localUxSmokeScript = packageJson.scripts?.["smoke:local-ux"] ?? "";
  checks.push({
    name: "ops readiness package script",
    ok: script === "tsx scripts/quality/ops-readiness-preflight.ts" &&
      summaryScript === "tsx scripts/ops/operational-readiness-summary.ts" &&
      packageJson.scripts?.["residuals:validate"] === "tsx scripts/quality/residual-ledger-validate.ts" &&
      localUxSmokeScript === "tsx scripts/ops/local-ux-smoke.ts",
    detail: `ops:readiness=${script || "missing"}; ops:readiness:summary=${summaryScript || "missing"}; residuals:validate=${packageJson.scripts?.["residuals:validate"] ?? "missing"}; smoke:local-ux=${localUxSmokeScript || "missing"}`,
  });
}

function checkLocalUxSmokeScript(): void {
  const script = read("scripts/ops/local-ux-smoke.ts");
  const docs = read("docs/development/operational-readiness.md");
  const requiredTerms = [
    "AREAFORGE_SMOKE_ALLOW_WRITES",
    "AREAFORGE_SMOKE_ALLOW_NON_LOCAL",
    "isLocalBaseUrl",
    "upload note attachment",
    "update center request queued",
    "AF-RISK-OPS-002",
    "不能关闭生产写入型 smoke",
  ];
  const combined = `${script}\n${docs}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "local UX smoke guardrails",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "local UX smoke is present, write-gated, local-by-default, and separated from production write smoke"
      : `missing ${missing.join(", ")}`,
  });
}

function checkSummaryScript(): void {
  const script = read("scripts/ops/operational-readiness-summary.ts");
  const docs = read("docs/development/operational-readiness.md");
  const requiredTerms = [
    "AREAFORGE_READINESS_BASE_URL",
    "AREAFORGE_READINESS_UPDATE_STATUS_FILE",
    "AREAFORGE_READINESS_SMOKE_RESULT_FILE",
    "AREAFORGE_READINESS_FAIL_ON",
    "AF-RISK-OPS-001",
    "AF-RISK-SC-001",
    "pnpm ops:readiness:summary",
    "不得执行 Docker",
    "safetyFacts",
    "serverCommandAttempted",
    "backupRestoreAttempted",
    "productionWriteAttempted",
    "secretValuePrinted",
  ];
  const combined = `${script}\n${docs}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "ops readiness summary script",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "summary script and docs expose read-only operational evidence aggregation"
      : `missing ${missing.join(", ")}`,
  });
}

function checkDocsIndex(): void {
  const docsReadme = read("docs/README.md");
  const rootReadme = read("README.md");
  const agents = read("AGENTS.md");
  const requiredTerms = [
    "development/operational-readiness.md",
    "development/residual-risk-ledger.md",
    "areaforge-operating-loop",
  ];
  const combined = `${docsReadme}\n${rootReadme}\n${agents}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "docs index entries",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "README, AGENTS, and docs index expose operating loop, readiness, and residual ledger"
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
