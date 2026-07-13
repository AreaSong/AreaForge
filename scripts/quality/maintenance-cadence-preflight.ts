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
    "docs/development/support-bundle-preview.md",
    "docs/development/production-smoke-alerting-strategy.md",
    "docs/development/product-experience-review-record-template.md",
    "docs/development/incident-record-template.md",
    "docs/development/restore-drill-record-template.md",
    "docs/development/maintenance-window-record-template.md",
    "docs/development/update-agent-status-record-template.md",
    "docs/development/ops-001-closure-packet-template.md",
    "docs/development/ci-supply-chain-record-template.md",
    "docs/development/residual-risk-ledger.md",
    "docs/development/residual-risk-ledger.json",
    "docs/development/residual-closure-review-template.md",
    "docs/development/release-train.md",
    "docs/development/support-intake.md",
    "docs/deployment/operator-onboarding.md",
    "scripts/ops/operability-status.ts",
    "scripts/quality/operability-status-validate.ts",
    "scripts/quality/operability-status-validate.selftest.ts",
    "scripts/ops/operational-handoff.ts",
    "scripts/quality/operational-handoff-validate.ts",
    "scripts/quality/operational-handoff-validate.selftest.ts",
    "scripts/ops/support-bundle-preview.ts",
    "scripts/quality/support-bundle-preview-validate.ts",
    "scripts/quality/support-bundle-preview.selftest.ts",
    "scripts/ops/backup-restore-preview.ts",
    "scripts/quality/backup-restore-preview-validate.ts",
    "scripts/quality/backup-restore-preview.selftest.ts",
    "scripts/quality/residual-evidence-preflight.ts",
    "scripts/quality/residual-evidence-preflight.selftest.ts",
    "scripts/ops/operational-readiness-summary.ts",
    "scripts/ops/operational-evidence-bundle.ts",
    "scripts/quality/operational-evidence-bundle-validate.ts",
    "scripts/quality/operational-evidence-bundle-validate.selftest.ts",
    "scripts/ops/ops001-evidence-preflight.ts",
    "scripts/quality/ops001-evidence-preflight.selftest.ts",
    "scripts/ops/ops004-alert-evidence-preflight.ts",
    "scripts/quality/ops004-alert-evidence-preflight.selftest.ts",
    "scripts/ops/sc002-supply-chain-preflight.ts",
    "scripts/quality/sc002-supply-chain-preflight.selftest.ts",
    "scripts/ops/generate-ops001-closure-packet.ts",
    "scripts/quality/ops001-closure-packet-validate.ts",
    "scripts/quality/ops001-closure-packet.selftest.ts",
    "scripts/ops/operational-alert-preview.ts",
    "scripts/ops/residual-review-due.ts",
    "scripts/ops/generate-incident-record.ts",
    "scripts/quality/product-experience-review-validate.ts",
    "scripts/quality/product-experience-review-validate.selftest.ts",
    "scripts/quality/incident-record-validate.ts",
    "scripts/quality/incident-record-validate.selftest.ts",
    "scripts/quality/restore-drill-validate.ts",
    "scripts/quality/restore-drill-validate.selftest.ts",
    "scripts/ops/generate-update-agent-status-record.ts",
    "scripts/quality/update-agent-status-record.selftest.ts",
    "scripts/quality/maintenance-window-record-validate.ts",
    "scripts/quality/maintenance-window-record-validate.selftest.ts",
    "scripts/ops/generate-maintenance-window-record.ts",
    "scripts/quality/maintenance-window-record.selftest.ts",
    "scripts/quality/update-agent-status-validate.ts",
    "scripts/quality/update-agent-status-validate.selftest.ts",
    "scripts/quality/residual-ledger-validate.ts",
    "scripts/quality/residual-evidence-preflight.ts",
    "scripts/quality/residual-evidence-preflight.selftest.ts",
    "scripts/quality/residual-closure-review-validate.ts",
    "scripts/quality/residual-closure-review-validate.selftest.ts",
    "scripts/quality/operability-status-validate.ts",
    "scripts/quality/operability-status-validate.selftest.ts",
    "scripts/quality/operability-status.selftest.ts",
    "scripts/quality/operational-handoff-validate.ts",
    "scripts/quality/operational-handoff-validate.selftest.ts",
    "scripts/quality/operational-handoff.selftest.ts",
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
    "Readiness、support bundle preview、alert preview、evidence bundle、long-term evidence snapshot 和 preflight",
    "ops:long-term:snapshot",
    "support bundle preview",
    "不等于 apply",
    "evidenceFreshnessStatus",
    "evidenceFreshnessMaxAgeSeconds",
    "latestEvidenceCheckedAt",
    "result",
    "不能是 `pass`",
    "每天",
    "每周",
    "每月",
    "每次 Release",
    "Incident 后",
    "Residual Review",
    "pnpm ops:readiness:summary",
    "pnpm ops:handoff",
    "pnpm ops:status",
    "pnpm ops:support:bundle-preview",
    "pnpm ops:support:bundle-preview:validate",
    "pnpm ops:backup-restore:preview",
    "pnpm ops:backup-restore:preview:validate",
    "pnpm ops:evidence:bundle",
    "pnpm ops:evidence:bundle:validate",
    "pnpm ops:ops-001:preflight",
    "pnpm ops:ops-004:preflight",
    "pnpm ops:ops-001:closure:validate",
    "pnpm ops:alert:preview",
    "pnpm maintenance:cadence:preflight",
    "pnpm enterprise:operability:preflight",
    "pnpm maintenance:window:record",
    "pnpm maintenance:window:validate",
    "pnpm incident:record:validate",
    "pnpm restore:drill:validate",
    "pnpm residuals:validate",
    "pnpm residuals:closure:validate",
    "pnpm residuals:review-due",
    "--fail-on-due-soon",
    "pnpm alert:drill:validate",
    "pnpm experience:review:validate",
    "pnpm release:supply-chain:validate",
    "pnpm ci:supply-chain:validate",
    "pnpm sc:sc-002:preflight",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-REL-001",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "AF-RISK-SC-003",
    "AF-RISK-OPS-003",
    "AF-RISK-OPS-004",
    "AF-RISK-UX-001",
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
    "AF-RISK-UX-001",
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
  const opsStatusScript = packageJson.scripts?.["ops:status"] ?? "";
  const opsStatusValidateScript = packageJson.scripts?.["ops:status:validate"] ?? "";
  const opsStatusValidateSelftestScript = packageJson.scripts?.["ops:status:validate:selftest"] ?? "";
  const opsStatusSelftestScript = packageJson.scripts?.["ops:status:selftest"] ?? "";
  const opsHandoffScript = packageJson.scripts?.["ops:handoff"] ?? "";
  const opsHandoffValidateScript = packageJson.scripts?.["ops:handoff:validate"] ?? "";
  const opsHandoffValidateSelftestScript = packageJson.scripts?.["ops:handoff:validate:selftest"] ?? "";
  const opsHandoffSelftestScript = packageJson.scripts?.["ops:handoff:selftest"] ?? "";
  const evidenceBundleValidateScript = packageJson.scripts?.["ops:evidence:bundle:validate"] ?? "";
  const evidenceBundleSelftestScript = packageJson.scripts?.["ops:evidence:bundle:selftest"] ?? "";
  const supportBundlePreviewScript = packageJson.scripts?.["ops:support:bundle-preview"] ?? "";
  const supportBundlePreviewValidateScript = packageJson.scripts?.["ops:support:bundle-preview:validate"] ?? "";
  const supportBundlePreviewSelftestScript = packageJson.scripts?.["ops:support:bundle-preview:selftest"] ?? "";
  const backupRestorePreviewScript = packageJson.scripts?.["ops:backup-restore:preview"] ?? "";
  const backupRestorePreviewValidateScript = packageJson.scripts?.["ops:backup-restore:preview:validate"] ?? "";
  const backupRestorePreviewSelftestScript = packageJson.scripts?.["ops:backup-restore:preview:selftest"] ?? "";
  const ops001PreflightScript = packageJson.scripts?.["ops:ops-001:preflight"] ?? "";
  const ops001PreflightSelftestScript = packageJson.scripts?.["ops:ops-001:preflight:selftest"] ?? "";
  const ops004PreflightScript = packageJson.scripts?.["ops:ops-004:preflight"] ?? "";
  const ops004PreflightSelftestScript = packageJson.scripts?.["ops:ops-004:preflight:selftest"] ?? "";
  const sc002PreflightScript = packageJson.scripts?.["sc:sc-002:preflight"] ?? "";
  const sc002PreflightSelftestScript = packageJson.scripts?.["sc:sc-002:preflight:selftest"] ?? "";
  const ops001ClosureScript = packageJson.scripts?.["ops:ops-001:closure"] ?? "";
  const ops001ClosureValidateScript = packageJson.scripts?.["ops:ops-001:closure:validate"] ?? "";
  const ops001ClosureSelftestScript = packageJson.scripts?.["ops:ops-001:closure:selftest"] ?? "";
  const residualEvidencePreflightScript = packageJson.scripts?.["residuals:evidence:preflight"] ?? "";
  const residualEvidencePreflightSelftestScript = packageJson.scripts?.["residuals:evidence:preflight:selftest"] ?? "";
  const residualClosureValidateScript = packageJson.scripts?.["residuals:closure:validate"] ?? "";
  const residualClosureSelftestScript = packageJson.scripts?.["residuals:closure:selftest"] ?? "";
  const reviewDueScript = packageJson.scripts?.["residuals:review-due"] ?? "";
  const experienceReviewSelftestScript = packageJson.scripts?.["experience:review:selftest"] ?? "";
  const enterpriseOperabilityPreflightScript = packageJson.scripts?.["enterprise:operability:preflight"] ?? "";
  const maintenanceWindowRecordScript = packageJson.scripts?.["maintenance:window:record"] ?? "";
  const maintenanceWindowRecordSelftestScript = packageJson.scripts?.["maintenance:window:record:selftest"] ?? "";
  const maintenanceWindowValidateScript = packageJson.scripts?.["maintenance:window:validate"] ?? "";
  const maintenanceWindowSelftestScript = packageJson.scripts?.["maintenance:window:selftest"] ?? "";
  const incidentRecordValidateScript = packageJson.scripts?.["incident:record:validate"] ?? "";
  const restoreDrillValidateScript = packageJson.scripts?.["restore:drill:validate"] ?? "";
  const updateAgentStatusRecordScript = packageJson.scripts?.["update-agent:status:record"] ?? "";
  const updateAgentStatusRecordSelftestScript = packageJson.scripts?.["update-agent:status:record:selftest"] ?? "";
  const updateAgentStatusValidateScript = packageJson.scripts?.["update-agent:status:validate"] ?? "";
  checks.push({
    name: "maintenance cadence package script",
    ok: script === "tsx scripts/quality/maintenance-cadence-preflight.ts" &&
      opsStatusScript === "tsx scripts/ops/operability-status.ts" &&
      opsStatusValidateScript === "tsx scripts/quality/operability-status-validate.ts" &&
      opsStatusValidateSelftestScript === "tsx scripts/quality/operability-status-validate.selftest.ts" &&
      opsStatusSelftestScript === "tsx scripts/quality/operability-status.selftest.ts" &&
      opsHandoffScript === "tsx scripts/ops/operational-handoff.ts" &&
      opsHandoffValidateScript === "tsx scripts/quality/operational-handoff-validate.ts" &&
      opsHandoffValidateSelftestScript === "tsx scripts/quality/operational-handoff-validate.selftest.ts" &&
      opsHandoffSelftestScript === "tsx scripts/quality/operational-handoff.selftest.ts" &&
      evidenceBundleValidateScript === "tsx scripts/quality/operational-evidence-bundle-validate.ts" &&
      evidenceBundleSelftestScript === "tsx scripts/quality/operational-evidence-bundle-validate.selftest.ts" &&
      supportBundlePreviewScript === "tsx scripts/ops/support-bundle-preview.ts" &&
      supportBundlePreviewValidateScript === "tsx scripts/quality/support-bundle-preview-validate.ts" &&
      supportBundlePreviewSelftestScript === "tsx scripts/quality/support-bundle-preview.selftest.ts" &&
      backupRestorePreviewScript === "tsx scripts/ops/backup-restore-preview.ts" &&
      backupRestorePreviewValidateScript === "tsx scripts/quality/backup-restore-preview-validate.ts" &&
      backupRestorePreviewSelftestScript === "tsx scripts/quality/backup-restore-preview.selftest.ts" &&
      ops001PreflightScript === "tsx scripts/ops/ops001-evidence-preflight.ts" &&
      ops001PreflightSelftestScript === "tsx scripts/quality/ops001-evidence-preflight.selftest.ts" &&
      ops004PreflightScript === "tsx scripts/ops/ops004-alert-evidence-preflight.ts" &&
      ops004PreflightSelftestScript === "tsx scripts/quality/ops004-alert-evidence-preflight.selftest.ts" &&
      sc002PreflightScript === "tsx scripts/ops/sc002-supply-chain-preflight.ts" &&
      sc002PreflightSelftestScript === "tsx scripts/quality/sc002-supply-chain-preflight.selftest.ts" &&
      ops001ClosureScript === "tsx scripts/ops/generate-ops001-closure-packet.ts" &&
      ops001ClosureValidateScript === "tsx scripts/quality/ops001-closure-packet-validate.ts" &&
      ops001ClosureSelftestScript === "tsx scripts/quality/ops001-closure-packet.selftest.ts" &&
      residualEvidencePreflightScript === "tsx scripts/quality/residual-evidence-preflight.ts" &&
      residualEvidencePreflightSelftestScript === "tsx scripts/quality/residual-evidence-preflight.selftest.ts" &&
      residualClosureValidateScript === "tsx scripts/quality/residual-closure-review-validate.ts" &&
      residualClosureSelftestScript === "tsx scripts/quality/residual-closure-review-validate.selftest.ts" &&
      reviewDueScript === "tsx scripts/ops/residual-review-due.ts" &&
      experienceReviewSelftestScript === "tsx scripts/quality/product-experience-review-validate.selftest.ts" &&
      enterpriseOperabilityPreflightScript === "tsx scripts/quality/enterprise-operability-preflight.ts" &&
      maintenanceWindowRecordScript === "tsx scripts/ops/generate-maintenance-window-record.ts" &&
      maintenanceWindowRecordSelftestScript === "tsx scripts/quality/maintenance-window-record.selftest.ts" &&
      maintenanceWindowValidateScript === "tsx scripts/quality/maintenance-window-record-validate.ts" &&
      maintenanceWindowSelftestScript === "tsx scripts/quality/maintenance-window-record-validate.selftest.ts" &&
      incidentRecordValidateScript === "tsx scripts/quality/incident-record-validate.ts" &&
      restoreDrillValidateScript === "tsx scripts/quality/restore-drill-validate.ts" &&
      updateAgentStatusRecordScript === "tsx scripts/ops/generate-update-agent-status-record.ts" &&
      updateAgentStatusRecordSelftestScript === "tsx scripts/quality/update-agent-status-record.selftest.ts" &&
      updateAgentStatusValidateScript === "tsx scripts/quality/update-agent-status-validate.ts",
    detail: `maintenance:cadence:preflight=${script || "missing"}; ops:status=${opsStatusScript || "missing"}; ops:status:validate=${opsStatusValidateScript || "missing"}; ops:status:validate:selftest=${opsStatusValidateSelftestScript || "missing"}; ops:status:selftest=${opsStatusSelftestScript || "missing"}; ops:handoff=${opsHandoffScript || "missing"}; ops:handoff:validate=${opsHandoffValidateScript || "missing"}; ops:handoff:validate:selftest=${opsHandoffValidateSelftestScript || "missing"}; ops:handoff:selftest=${opsHandoffSelftestScript || "missing"}; ops:evidence:bundle:validate=${evidenceBundleValidateScript || "missing"}; ops:evidence:bundle:selftest=${evidenceBundleSelftestScript || "missing"}; ops:support:bundle-preview=${supportBundlePreviewScript || "missing"}; ops:support:bundle-preview:validate=${supportBundlePreviewValidateScript || "missing"}; ops:support:bundle-preview:selftest=${supportBundlePreviewSelftestScript || "missing"}; ops:backup-restore:preview=${backupRestorePreviewScript || "missing"}; ops:backup-restore:preview:validate=${backupRestorePreviewValidateScript || "missing"}; ops:backup-restore:preview:selftest=${backupRestorePreviewSelftestScript || "missing"}; ops:ops-001:preflight=${ops001PreflightScript || "missing"}; ops:ops-001:preflight:selftest=${ops001PreflightSelftestScript || "missing"}; ops:ops-004:preflight=${ops004PreflightScript || "missing"}; ops:ops-004:preflight:selftest=${ops004PreflightSelftestScript || "missing"}; sc:sc-002:preflight=${sc002PreflightScript || "missing"}; sc:sc-002:preflight:selftest=${sc002PreflightSelftestScript || "missing"}; ops:ops-001:closure=${ops001ClosureScript || "missing"}; ops:ops-001:closure:validate=${ops001ClosureValidateScript || "missing"}; ops:ops-001:closure:selftest=${ops001ClosureSelftestScript || "missing"}; residuals:evidence:preflight=${residualEvidencePreflightScript || "missing"}; residuals:evidence:preflight:selftest=${residualEvidencePreflightSelftestScript || "missing"}; residuals:closure:validate=${residualClosureValidateScript || "missing"}; residuals:closure:selftest=${residualClosureSelftestScript || "missing"}; residuals:review-due=${reviewDueScript || "missing"}; experience:review:selftest=${experienceReviewSelftestScript || "missing"}; enterprise:operability:preflight=${enterpriseOperabilityPreflightScript || "missing"}; maintenance:window:record=${maintenanceWindowRecordScript || "missing"}; maintenance:window:record:selftest=${maintenanceWindowRecordSelftestScript || "missing"}; maintenance:window:validate=${maintenanceWindowValidateScript || "missing"}; maintenance:window:selftest=${maintenanceWindowSelftestScript || "missing"}; incident:record:validate=${incidentRecordValidateScript || "missing"}; restore:drill:validate=${restoreDrillValidateScript || "missing"}; update-agent:status:record=${updateAgentStatusRecordScript || "missing"}; update-agent:status:record:selftest=${updateAgentStatusRecordSelftestScript || "missing"}; update-agent:status:validate=${updateAgentStatusValidateScript || "missing"}`,
  });
}

function checkEntryPoints(): void {
  const rootReadme = read("README.md");
  const docsReadme = read("docs/README.md");
  const workflowReadme = read("workflow/README.md");
  const docSync = read("docs/development/doc-sync-checklist.md");
  const requiredLinks = [
    [rootReadme, "docs/development/maintenance-cadence.md", "README.md"],
    [rootReadme, "pnpm ops:status", "README.md"],
    [rootReadme, "pnpm ops:handoff", "README.md"],
    [rootReadme, "pnpm ops:support:bundle-preview", "README.md"],
    [rootReadme, "pnpm ops:backup-restore:preview", "README.md"],
    [rootReadme, "pnpm residuals:review-due", "README.md"],
    [rootReadme, "pnpm experience:review:validate", "README.md"],
    [rootReadme, "pnpm update-agent:status:record", "README.md"],
    [rootReadme, "pnpm ops:ops-001:closure", "README.md"],
    [rootReadme, "pnpm ops:ops-004:preflight", "README.md"],
    [rootReadme, "pnpm ci:supply-chain:record", "README.md"],
    [rootReadme, "pnpm sc:sc-002:preflight", "README.md"],
    [rootReadme, "pnpm maintenance:window:record", "README.md"],
    [docsReadme, "development/maintenance-cadence.md", "docs/README.md"],
    [docsReadme, "development/support-bundle-preview.md", "docs/README.md"],
    [docsReadme, "deployment/backup-restore.md", "docs/README.md"],
    [docsReadme, "development/ops-001-closure-packet-template.md", "docs/README.md"],
    [docsReadme, "development/ci-supply-chain-record-template.md", "docs/README.md"],
    [docsReadme, "development/product-experience-review-record-template.md", "docs/README.md"],
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
    "scripts/ops/operational-handoff.ts",
    "maintenance:cadence:preflight",
    "pnpm maintenance:cadence:preflight",
    "pnpm ops:handoff",
    "scripts/ops/residual-review-due.ts",
    "residuals:review-due",
    "pnpm residuals:review-due",
    "pnpm ops:ops-001:closure:validate",
    "pnpm experience:review:validate",
    "pnpm maintenance:window:record",
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
  const residualReference = read(".codex/skills-src/areaforge-residual-ledger/references/classification.md");
  const enterprise = read(".codex/skills-src/areaforge-enterprise-governance/SKILL.md");
  const productExperience = read(".codex/skills-src/areaforge-product-experience/SKILL.md");
  const qaSmoke = read(".codex/skills-src/areaforge-qa-smoke/SKILL.md");
  const skillReadme = read(".codex/skills-src/README.md");
  const requiredTerms = [
    "docs/development/maintenance-cadence.md",
    "maintenance:cadence:preflight",
    "residuals:review-due",
    "AF-RISK-UX-001",
  ];
  const combined = `${observability}\n${residual}\n${residualReference}\n${enterprise}\n${productExperience}\n${qaSmoke}\n${skillReadme}`;
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
    "scripts/ops/residual-review-due.ts",
    "docs/development/product-experience-review-record-template.md",
    "scripts/quality/product-experience-review-validate.ts",
    "pnpm maintenance:cadence:preflight",
    "pnpm residuals:review-due",
    "pnpm maintenance:window:record:selftest",
    "pnpm experience:review:selftest",
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
