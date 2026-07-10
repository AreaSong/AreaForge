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
  checkProductionSmokeAlertingStrategy();
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
    "docs/development/maintenance-cadence.md",
    "docs/development/production-smoke-alerting-strategy.md",
    "docs/development/release-train.md",
    "docs/development/completion-evidence-checklist.md",
    "docs/development/runtime-write-boundary.md",
    "docs/development/production-readonly-smoke-record-template.md",
    "docs/development/alert-drill-record-template.md",
    "docs/development/incident-record-template.md",
    "docs/development/restore-drill-record-template.md",
    "docs/development/maintenance-window-record-template.md",
    "docs/development/update-agent-status-record-template.md",
    "docs/development/product-experience-review-record-template.md",
    "docs/deployment/operator-onboarding.md",
    "docs/development/residual-risk-ledger.md",
    "docs/development/residual-risk-ledger.json",
    ".codex/skills-src/areaforge-operating-loop/SKILL.md",
    ".codex/skills-src/areaforge-operating-loop/references/loop-map.md",
    "scripts/ops/operational-readiness-summary.ts",
    "scripts/ops/operational-evidence-bundle.ts",
    "scripts/ops/operational-alert-preview.ts",
    "scripts/ops/generate-alert-drill-record.ts",
    "scripts/ops/generate-incident-record.ts",
    "scripts/ops/local-ux-smoke.ts",
    "scripts/ops/generate-prod-readonly-smoke-record.ts",
    "scripts/ops/residual-review-due.ts",
    "scripts/quality/maintenance-cadence-preflight.ts",
    "scripts/quality/operator-onboarding-preflight.ts",
    "scripts/quality/release-train-preflight.ts",
    "scripts/quality/prod-readonly-smoke-validate.ts",
    "scripts/quality/prod-readonly-smoke-validate.selftest.ts",
    "scripts/quality/prod-readonly-smoke-config-preflight.ts",
    "scripts/quality/prod-readonly-smoke-config-preflight.selftest.ts",
    "scripts/quality/prod-readonly-smoke-record.selftest.ts",
    "scripts/quality/alert-drill-validate.ts",
    "scripts/quality/alert-drill-validate.selftest.ts",
    "scripts/quality/alert-drill-record.selftest.ts",
    "scripts/quality/incident-record-validate.ts",
    "scripts/quality/incident-record-validate.selftest.ts",
    "scripts/quality/restore-drill-validate.ts",
    "scripts/quality/restore-drill-validate.selftest.ts",
    "scripts/quality/maintenance-window-record-validate.ts",
    "scripts/quality/maintenance-window-record-validate.selftest.ts",
    "scripts/quality/update-agent-status-validate.ts",
    "scripts/quality/update-agent-status-validate.selftest.ts",
    "scripts/quality/product-experience-review-validate.ts",
    "scripts/quality/product-experience-review-validate.selftest.ts",
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
  const strategy = read("docs/development/production-smoke-alerting-strategy.md");
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
    "pnpm maintenance:cadence:preflight",
    "maintenance-cadence.md",
    "pnpm smoke:local-ux",
    "production-smoke-alerting-strategy.md",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-OPS-004",
    "AF-RISK-UX-001",
    "Product experience review",
    "pnpm experience:review:validate",
    "completion-evidence-checklist.md",
    "runtime-write-boundary.md",
    "residual-risk-ledger.md",
    "safetyFacts",
    "pnpm smoke:prod-readonly:validate",
    "pnpm smoke:prod-readonly:config",
  ];
  const combined = `${doc}\n${strategy}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "operational readiness doc",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "readiness doc defines signals, freshness, no-web-ops boundary, and residual linkage"
      : `missing ${missing.join(", ")}`,
  });
}

function checkProductionSmokeAlertingStrategy(): void {
  const strategy = read("docs/development/production-smoke-alerting-strategy.md");
  const requiredTerms = [
    "非执行草案",
    "不授权任何生产写入",
    "AREAFORGE_EXTRA_SMOKE_COMMAND",
    "production-readonly-smoke-record-template.md",
    "pnpm smoke:prod-readonly:validate",
    "safetyFacts",
    "[AF_SMOKE]",
    "允许写入范围",
    "禁止范围",
    "清理策略",
    "失败处理",
    "告警阈值",
    "pnpm ops:alert:preview",
    "pnpm alert:drill:validate",
    "read_only_alert_preview",
    "不调用外部告警接收人",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-OPS-004",
    "AF-RISK-UX-001",
  ];
  const missing = requiredTerms.filter((term) => !strategy.includes(term));
  checks.push({
    name: "production smoke and alerting strategy",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "strategy defines read-only smoke, confirmed write smoke boundaries, cleanup/failure handling, and alert thresholds without authorizing production writes"
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
  const bundleScript = packageJson.scripts?.["ops:evidence:bundle"] ?? "";
  const alertPreviewScript = packageJson.scripts?.["ops:alert:preview"] ?? "";
  const alertDrillValidateScript = packageJson.scripts?.["alert:drill:validate"] ?? "";
  const alertDrillSelftestScript = packageJson.scripts?.["alert:drill:selftest"] ?? "";
  const alertDrillRecordScript = packageJson.scripts?.["alert:drill:record"] ?? "";
  const alertDrillRecordSelftestScript = packageJson.scripts?.["alert:drill:record:selftest"] ?? "";
  const prodReadonlySmokeValidateScript = packageJson.scripts?.["smoke:prod-readonly:validate"] ?? "";
  const prodReadonlySmokeSelftestScript = packageJson.scripts?.["smoke:prod-readonly:selftest"] ?? "";
  const prodReadonlySmokeConfigScript = packageJson.scripts?.["smoke:prod-readonly:config"] ?? "";
  const prodReadonlySmokeConfigSelftestScript = packageJson.scripts?.["smoke:prod-readonly:config:selftest"] ?? "";
  const prodReadonlySmokeRecordScript = packageJson.scripts?.["smoke:prod-readonly:record"] ?? "";
  const prodReadonlySmokeRecordSelftestScript = packageJson.scripts?.["smoke:prod-readonly:record:selftest"] ?? "";
  const localUxSmokeScript = packageJson.scripts?.["smoke:local-ux"] ?? "";
  const experienceReviewValidateScript = packageJson.scripts?.["experience:review:validate"] ?? "";
  const experienceReviewSelftestScript = packageJson.scripts?.["experience:review:selftest"] ?? "";
  const residualReviewDueScript = packageJson.scripts?.["residuals:review-due"] ?? "";
  const operatorOnboardingPreflightScript = packageJson.scripts?.["operator:onboarding:preflight"] ?? "";
  const releaseTrainPreflightScript = packageJson.scripts?.["release:train:preflight"] ?? "";
  const maintenanceCadencePreflightScript = packageJson.scripts?.["maintenance:cadence:preflight"] ?? "";
  const enterpriseOperabilityPreflightScript = packageJson.scripts?.["enterprise:operability:preflight"] ?? "";
  const maintenanceWindowValidateScript = packageJson.scripts?.["maintenance:window:validate"] ?? "";
  const incidentRecordValidateScript = packageJson.scripts?.["incident:record:validate"] ?? "";
  const restoreDrillValidateScript = packageJson.scripts?.["restore:drill:validate"] ?? "";
  const updateAgentStatusValidateScript = packageJson.scripts?.["update-agent:status:validate"] ?? "";
  checks.push({
    name: "ops readiness package script",
    ok: script === "tsx scripts/quality/ops-readiness-preflight.ts" &&
      summaryScript === "tsx scripts/ops/operational-readiness-summary.ts" &&
      bundleScript === "tsx scripts/ops/operational-evidence-bundle.ts" &&
      alertPreviewScript === "tsx scripts/ops/operational-alert-preview.ts" &&
      alertDrillValidateScript === "tsx scripts/quality/alert-drill-validate.ts" &&
      alertDrillSelftestScript === "tsx scripts/quality/alert-drill-validate.selftest.ts" &&
      alertDrillRecordScript === "tsx scripts/ops/generate-alert-drill-record.ts" &&
      alertDrillRecordSelftestScript === "tsx scripts/quality/alert-drill-record.selftest.ts" &&
      prodReadonlySmokeValidateScript === "tsx scripts/quality/prod-readonly-smoke-validate.ts" &&
      prodReadonlySmokeSelftestScript === "tsx scripts/quality/prod-readonly-smoke-validate.selftest.ts" &&
      prodReadonlySmokeConfigScript === "tsx scripts/quality/prod-readonly-smoke-config-preflight.ts" &&
      prodReadonlySmokeConfigSelftestScript === "tsx scripts/quality/prod-readonly-smoke-config-preflight.selftest.ts" &&
      prodReadonlySmokeRecordScript === "tsx scripts/ops/generate-prod-readonly-smoke-record.ts" &&
      prodReadonlySmokeRecordSelftestScript === "tsx scripts/quality/prod-readonly-smoke-record.selftest.ts" &&
      packageJson.scripts?.["residuals:validate"] === "tsx scripts/quality/residual-ledger-validate.ts" &&
      residualReviewDueScript === "tsx scripts/ops/residual-review-due.ts" &&
      localUxSmokeScript === "tsx scripts/ops/local-ux-smoke.ts" &&
      experienceReviewValidateScript === "tsx scripts/quality/product-experience-review-validate.ts" &&
      experienceReviewSelftestScript === "tsx scripts/quality/product-experience-review-validate.selftest.ts" &&
      operatorOnboardingPreflightScript === "tsx scripts/quality/operator-onboarding-preflight.ts" &&
      releaseTrainPreflightScript === "tsx scripts/quality/release-train-preflight.ts" &&
      maintenanceCadencePreflightScript === "tsx scripts/quality/maintenance-cadence-preflight.ts" &&
      enterpriseOperabilityPreflightScript === "tsx scripts/quality/enterprise-operability-preflight.ts" &&
      maintenanceWindowValidateScript === "tsx scripts/quality/maintenance-window-record-validate.ts" &&
      incidentRecordValidateScript === "tsx scripts/quality/incident-record-validate.ts" &&
      restoreDrillValidateScript === "tsx scripts/quality/restore-drill-validate.ts" &&
      updateAgentStatusValidateScript === "tsx scripts/quality/update-agent-status-validate.ts",
    detail: `ops:readiness=${script || "missing"}; ops:readiness:summary=${summaryScript || "missing"}; ops:evidence:bundle=${bundleScript || "missing"}; ops:alert:preview=${alertPreviewScript || "missing"}; alert:drill:validate=${alertDrillValidateScript || "missing"}; alert:drill:selftest=${alertDrillSelftestScript || "missing"}; alert:drill:record=${alertDrillRecordScript || "missing"}; alert:drill:record:selftest=${alertDrillRecordSelftestScript || "missing"}; smoke:prod-readonly:validate=${prodReadonlySmokeValidateScript || "missing"}; smoke:prod-readonly:selftest=${prodReadonlySmokeSelftestScript || "missing"}; smoke:prod-readonly:config=${prodReadonlySmokeConfigScript || "missing"}; smoke:prod-readonly:config:selftest=${prodReadonlySmokeConfigSelftestScript || "missing"}; smoke:prod-readonly:record=${prodReadonlySmokeRecordScript || "missing"}; smoke:prod-readonly:record:selftest=${prodReadonlySmokeRecordSelftestScript || "missing"}; residuals:validate=${packageJson.scripts?.["residuals:validate"] ?? "missing"}; residuals:review-due=${residualReviewDueScript || "missing"}; smoke:local-ux=${localUxSmokeScript || "missing"}; experience:review:validate=${experienceReviewValidateScript || "missing"}; experience:review:selftest=${experienceReviewSelftestScript || "missing"}; operator:onboarding:preflight=${operatorOnboardingPreflightScript || "missing"}; release:train:preflight=${releaseTrainPreflightScript || "missing"}; maintenance:cadence:preflight=${maintenanceCadencePreflightScript || "missing"}; enterprise:operability:preflight=${enterpriseOperabilityPreflightScript || "missing"}; maintenance:window:validate=${maintenanceWindowValidateScript || "missing"}; incident:record:validate=${incidentRecordValidateScript || "missing"}; restore:drill:validate=${restoreDrillValidateScript || "missing"}; update-agent:status:validate=${updateAgentStatusValidateScript || "missing"}`,
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
    "product-experience-review-record-template.md",
    "pnpm experience:review:validate",
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
  const bundle = read("scripts/ops/operational-evidence-bundle.ts");
  const alertPreview = read("scripts/ops/operational-alert-preview.ts");
  const alertDrillRecord = read("scripts/ops/generate-alert-drill-record.ts");
  const alertDrillRecordSelftest = read("scripts/quality/alert-drill-record.selftest.ts");
  const prodReadonlySmokeValidate = read("scripts/quality/prod-readonly-smoke-validate.ts");
  const prodReadonlySmokeSelftest = read("scripts/quality/prod-readonly-smoke-validate.selftest.ts");
  const prodReadonlySmokeConfig = read("scripts/quality/prod-readonly-smoke-config-preflight.ts");
  const prodReadonlySmokeConfigSelftest = read("scripts/quality/prod-readonly-smoke-config-preflight.selftest.ts");
  const prodReadonlySmokeRecord = read("scripts/ops/generate-prod-readonly-smoke-record.ts");
  const prodReadonlySmokeRecordSelftest = read("scripts/quality/prod-readonly-smoke-record.selftest.ts");
  const alertDrill = read("scripts/quality/alert-drill-validate.ts");
  const alertDrillSelftest = read("scripts/quality/alert-drill-validate.selftest.ts");
  const productExperience = read("scripts/quality/product-experience-review-validate.ts");
  const productExperienceSelftest = read("scripts/quality/product-experience-review-validate.selftest.ts");
  const docs = read("docs/development/operational-readiness.md");
  const requiredTerms = [
    "AREAFORGE_READINESS_BASE_URL",
    "AREAFORGE_READINESS_UPDATE_STATUS_FILE",
    "AREAFORGE_READINESS_SMOKE_RESULT_FILE",
    "AREAFORGE_READINESS_RELEASE_MANIFEST_FILE",
    "AREAFORGE_READINESS_RELEASE_MANIFEST_URL",
    "AREAFORGE_READINESS_GITHUB_REPO",
    "AREAFORGE_READINESS_CERT_DAYS",
    "AREAFORGE_READINESS_FAIL_ON",
    "AF-RISK-OPS-001",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "pnpm ops:readiness:summary",
    "不得执行 Docker",
    "safetyFacts",
    "serverCommandAttempted",
    "backupRestoreAttempted",
    "productionWriteAttempted",
    "secretValuePrinted",
    "smoke:prod-readonly:validate",
    "smoke:prod-readonly:config",
    "smoke:prod-readonly:record",
    "production readonly smoke config preflight passed",
    "production readonly smoke config preflight selftest passed",
    "passwordFileContentRead",
    "production readonly smoke record generator selftest passed",
    "production readonly smoke validator selftest passed",
    "production readonly smoke record validation passed",
    "pnpm ops:evidence:bundle",
    "read_only_operational_evidence_bundle",
    "bundleHash",
    "automatic HTTPS certificate",
    "forbiddenActions",
    "pnpm ops:alert:preview",
    "read_only_alert_preview",
    "alert:drill:record",
    "alert drill record generator selftest passed",
    "notificationSent",
    "externalAlertReceiverCalled",
    "alert:drill:validate",
    "alert drill validator selftest passed",
    "alert drill validation passed",
    "AF-RISK-OPS-004",
    "AF-RISK-UX-001",
    "product experience review validation passed",
    "product experience review validator selftest passed",
  ];
  const combined = `${script}\n${bundle}\n${alertPreview}\n${alertDrillRecord}\n${alertDrillRecordSelftest}\n${prodReadonlySmokeValidate}\n${prodReadonlySmokeSelftest}\n${prodReadonlySmokeConfig}\n${prodReadonlySmokeConfigSelftest}\n${prodReadonlySmokeRecord}\n${prodReadonlySmokeRecordSelftest}\n${alertDrill}\n${alertDrillSelftest}\n${productExperience}\n${productExperienceSelftest}\n${docs}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "ops readiness summary, bundle, and alert preview scripts",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "summary, evidence bundle, and alert preview scripts expose read-only operational evidence aggregation"
      : `missing ${missing.join(", ")}`,
  });
}

function checkDocsIndex(): void {
  const docsReadme = read("docs/README.md");
  const rootReadme = read("README.md");
  const agents = read("AGENTS.md");
  const requiredTerms = [
    "development/operational-readiness.md",
    "development/maintenance-cadence.md",
    "development/release-train.md",
    "development/residual-risk-ledger.md",
    "development/product-experience-review-record-template.md",
    "deployment/operator-onboarding.md",
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
