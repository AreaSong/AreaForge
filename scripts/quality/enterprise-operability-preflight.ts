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
    executableNow?: boolean;
    ownerSkills?: string[];
    closeCondition?: string;
    requiredEvidence?: string;
  }>;
}

const root = process.cwd();
const checks: CheckResult[] = [];

function main(): void {
  checkRequiredFiles();
  checkControlPlaneDoc();
  checkReleaseDecisionMatrix();
  checkResidualCoverage();
  checkPackageScript();
  checkEntryPoints();
  checkWorkflowTemplateBinding();
  checkSkillBoundaries();
  checkValidationCoverage();
  checkNoWebOpsBoundary();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`enterprise operability preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("enterprise operability preflight passed: long-term control plane is documented, linked, and evidence-gated.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "docs/development/long-term-operability-control-plane.md",
    "docs/development/completion-evidence-checklist.md",
    "docs/development/runtime-write-boundary.md",
    "docs/development/maintenance-cadence.md",
    "docs/development/operational-readiness.md",
    "docs/development/support-bundle-preview.md",
    "docs/development/production-smoke-alerting-strategy.md",
    "docs/development/release-train.md",
    "docs/development/release-record-template.md",
    "docs/development/release-supply-chain-record-template.md",
    "docs/development/ci-supply-chain-record-template.md",
    "docs/development/incident-record-template.md",
    "docs/development/restore-drill-record-template.md",
    "docs/development/maintenance-window-record-template.md",
    "docs/development/update-agent-status-record-template.md",
    "docs/development/ops-001-closure-packet-template.md",
    "docs/development/product-experience-review-record-template.md",
    "docs/development/residual-risk-ledger.md",
    "docs/development/residual-risk-ledger.json",
    "docs/development/validation-matrix.md",
    "docs/development/doc-sync-checklist.md",
    "workflow/templates/version-template.md",
    ".codex/skills-src/README.md",
    ".codex/skills-src/areaforge-operating-loop/SKILL.md",
    ".codex/skills-src/areaforge-validation-driver/SKILL.md",
    ".codex/skills-src/areaforge-release-operator/SKILL.md",
    ".codex/skills-src/areaforge-residual-ledger/SKILL.md",
    ".codex/skills-src/areaforge-product-experience/SKILL.md",
    "scripts/ops/operability-status.ts",
    "scripts/quality/operability-status.selftest.ts",
    "scripts/ops/operational-handoff.ts",
    "scripts/quality/operational-handoff.selftest.ts",
    "scripts/quality/operational-evidence-bundle-validate.ts",
    "scripts/quality/operational-evidence-bundle-validate.selftest.ts",
    "scripts/ops/support-bundle-preview.ts",
    "scripts/quality/support-bundle-preview-validate.ts",
    "scripts/quality/support-bundle-preview.selftest.ts",
    "scripts/ops/generate-ci-supply-chain-record.ts",
    "scripts/quality/ci-supply-chain-record-validate.ts",
    "scripts/quality/ci-supply-chain-record.selftest.ts",
    "scripts/ops/generate-ops001-closure-packet.ts",
    "scripts/quality/ops001-closure-packet-validate.ts",
    "scripts/quality/ops001-closure-packet.selftest.ts",
    "scripts/ops/generate-incident-record.ts",
    "scripts/quality/incident-record-validate.ts",
    "scripts/quality/incident-record-validate.selftest.ts",
    "scripts/quality/restore-drill-validate.ts",
    "scripts/quality/restore-drill-validate.selftest.ts",
    "scripts/ops/generate-update-agent-status-record.ts",
    "scripts/quality/update-agent-status-record.selftest.ts",
    "scripts/quality/maintenance-window-record-validate.ts",
    "scripts/quality/maintenance-window-record-validate.selftest.ts",
    "scripts/quality/update-agent-status-validate.ts",
    "scripts/quality/update-agent-status-validate.selftest.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required enterprise operability files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkControlPlaneDoc(): void {
  const doc = read("docs/development/long-term-operability-control-plane.md");
  const requiredTerms = [
    "Long-Term Operability Control Plane",
    "不是发布授权",
    "不执行生产 deploy",
    "Package A-E",
    "docs 100%",
    "AREAFORGE_AUTO_APPLY=none",
    "从 AreaMatrix 和 AreaFlow 借鉴的轻量机制",
    "不建议搬运",
    "控制面分层",
    "功能更新后的 Release 决策矩阵",
    "维护窗口执行顺序",
    "Skill 增减规则",
    "默认不新增第 18 个 skill",
    "areaforge-data-governance",
    "pnpm enterprise:operability:preflight",
    "pnpm ops:status",
    "pnpm ops:handoff",
    "pnpm ops:support:bundle-preview",
    "pnpm ops:evidence:bundle:validate",
    "pnpm ops:ops-001:closure:validate",
    "不连接生产",
    "不创建 GitHub Release",
    "不写生产",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  checks.push({
    name: "long-term control plane doc",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "control plane documents scope, borrowed mechanisms, non-goals, release decisions, maintenance order, and skill policy"
      : `missing ${missing.join(", ")}`,
  });
}

function checkReleaseDecisionMatrix(): void {
  const doc = read("docs/development/long-term-operability-control-plane.md");
  const requiredTerms = [
    "纯拼写、链接、历史记录标注",
    "用户可见功能、页面、API、学习闭环行为",
    "Prisma schema",
    "上传、附件",
    "AI provider",
    "updater、Docker、Nginx",
    "依赖、安全、GitHub Actions",
    "repo-local skill",
    "Release 完成不等于生产更新完成",
    "pnpm release:train:preflight",
    "pnpm smoke:local-ux",
    "pnpm governance:preflight",
    "pnpm release:supply-chain:selftest",
    "pnpm ci:supply-chain:selftest",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  checks.push({
    name: "release decision matrix",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "release decision matrix covers docs, UX/API, DB, upload, AI, updater, supply-chain, and skill changes"
      : `missing ${missing.join(", ")}`,
  });
}

function checkResidualCoverage(): void {
  const doc = read("docs/development/long-term-operability-control-plane.md");
  const ledger = JSON.parse(read("docs/development/residual-risk-ledger.json")) as ResidualLedger;
  const ledgerIds = new Set((ledger.items ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)));
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
  const missingFromLedger = requiredIds.filter((id) => !ledgerIds.has(id));
  const missingFromDoc = requiredIds.filter((id) => !doc.includes(id));
  const incomplete = (ledger.items ?? [])
    .filter((item) => requiredIds.includes(item.id ?? ""))
    .filter((item) => !item.reviewAt || !item.closeCondition || !item.requiredEvidence || !item.ownerSkills?.length)
    .map((item) => item.id ?? "<missing-id>");
  checks.push({
    name: "residual operability coverage",
    ok: missingFromLedger.length === 0 && missingFromDoc.length === 0 && incomplete.length === 0,
    detail: missingFromLedger.length === 0 && missingFromDoc.length === 0 && incomplete.length === 0
      ? `${requiredIds.length} residual IDs are covered with reviewAt, closeCondition, requiredEvidence, and ownerSkills`
      : `missing ledger ${missingFromLedger.join(", ") || "none"}; missing doc ${missingFromDoc.join(", ") || "none"}; incomplete ${incomplete.join(", ") || "none"}`,
  });
}

function checkPackageScript(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const expectedScripts: Record<string, string> = {
    "enterprise:operability:preflight": "tsx scripts/quality/enterprise-operability-preflight.ts",
    "ops:status": "tsx scripts/ops/operability-status.ts",
    "ops:status:selftest": "tsx scripts/quality/operability-status.selftest.ts",
    "ops:handoff": "tsx scripts/ops/operational-handoff.ts",
    "ops:handoff:selftest": "tsx scripts/quality/operational-handoff.selftest.ts",
    "ops:evidence:bundle:validate": "tsx scripts/quality/operational-evidence-bundle-validate.ts",
    "ops:evidence:bundle:selftest": "tsx scripts/quality/operational-evidence-bundle-validate.selftest.ts",
    "ops:support:bundle-preview": "tsx scripts/ops/support-bundle-preview.ts",
    "ops:support:bundle-preview:validate": "tsx scripts/quality/support-bundle-preview-validate.ts",
    "ops:support:bundle-preview:selftest": "tsx scripts/quality/support-bundle-preview.selftest.ts",
    "ops:ops-001:preflight": "tsx scripts/ops/ops001-evidence-preflight.ts",
    "ops:ops-001:preflight:selftest": "tsx scripts/quality/ops001-evidence-preflight.selftest.ts",
    "ops:ops-001:closure": "tsx scripts/ops/generate-ops001-closure-packet.ts",
    "ops:ops-001:closure:validate": "tsx scripts/quality/ops001-closure-packet-validate.ts",
    "ops:ops-001:closure:selftest": "tsx scripts/quality/ops001-closure-packet.selftest.ts",
    "maintenance:window:validate": "tsx scripts/quality/maintenance-window-record-validate.ts",
    "maintenance:window:selftest": "tsx scripts/quality/maintenance-window-record-validate.selftest.ts",
    "incident:record": "tsx scripts/ops/generate-incident-record.ts",
    "incident:record:validate": "tsx scripts/quality/incident-record-validate.ts",
    "incident:record:selftest": "tsx scripts/quality/incident-record-validate.selftest.ts",
    "restore:drill:validate": "tsx scripts/quality/restore-drill-validate.ts",
    "restore:drill:selftest": "tsx scripts/quality/restore-drill-validate.selftest.ts",
    "update-agent:status:record": "tsx scripts/ops/generate-update-agent-status-record.ts",
    "update-agent:status:record:selftest": "tsx scripts/quality/update-agent-status-record.selftest.ts",
    "update-agent:status:validate": "tsx scripts/quality/update-agent-status-validate.ts",
    "update-agent:status:selftest": "tsx scripts/quality/update-agent-status-validate.selftest.ts",
    "ci:supply-chain:record": "tsx scripts/ops/generate-ci-supply-chain-record.ts",
    "ci:supply-chain:validate": "tsx scripts/quality/ci-supply-chain-record-validate.ts",
    "ci:supply-chain:selftest": "tsx scripts/quality/ci-supply-chain-record.selftest.ts",
  };
  const mismatches = Object.entries(expectedScripts)
    .filter(([name, expected]) => packageJson.scripts?.[name] !== expected)
    .map(([name, expected]) => `${name}=${packageJson.scripts?.[name] ?? "missing"} expected ${expected}`);
  checks.push({
    name: "enterprise operability package scripts",
    ok: mismatches.length === 0,
    detail: mismatches.length === 0 ? `${Object.keys(expectedScripts).length} scripts configured` : `mismatches ${mismatches.join("; ")}`,
  });
}

function checkEntryPoints(): void {
  const rootReadme = read("README.md");
  const docsReadme = read("docs/README.md");
  const workflowReadme = read("workflow/README.md");
  const docSync = read("docs/development/doc-sync-checklist.md");
  const maintenance = read("docs/development/maintenance-cadence.md");
  const releaseTrain = read("docs/development/release-train.md");
  const requiredLinks = [
    [rootReadme, "docs/development/long-term-operability-control-plane.md", "README.md"],
    [rootReadme, "pnpm enterprise:operability:preflight", "README.md"],
    [rootReadme, "pnpm ops:status", "README.md"],
    [rootReadme, "pnpm ops:handoff", "README.md"],
    [docsReadme, "development/long-term-operability-control-plane.md", "docs/README.md"],
    [workflowReadme, "long-term-operability-control-plane.md", "workflow/README.md"],
    [docSync, "docs/development/long-term-operability-control-plane.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/incident-record-template.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/restore-drill-record-template.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/maintenance-window-record-template.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/update-agent-status-record-template.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/ops-001-closure-packet-template.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/ci-supply-chain-record-template.md", "docs/development/doc-sync-checklist.md"],
    [docSync, "docs/development/support-bundle-preview.md", "docs/development/doc-sync-checklist.md"],
    [maintenance, "pnpm enterprise:operability:preflight", "docs/development/maintenance-cadence.md"],
    [maintenance, "pnpm ops:support:bundle-preview", "docs/development/maintenance-cadence.md"],
    [maintenance, "pnpm ops:ops-001:preflight", "docs/development/maintenance-cadence.md"],
    [maintenance, "pnpm ops:ops-001:closure:validate", "docs/development/maintenance-cadence.md"],
    [maintenance, "pnpm ci:supply-chain:validate", "docs/development/maintenance-cadence.md"],
    [maintenance, "pnpm maintenance:window:validate", "docs/development/maintenance-cadence.md"],
    [maintenance, "pnpm incident:record:validate", "docs/development/maintenance-cadence.md"],
    [maintenance, "pnpm restore:drill:validate", "docs/development/maintenance-cadence.md"],
    [releaseTrain, "pnpm enterprise:operability:preflight", "docs/development/release-train.md"],
    [releaseTrain, "pnpm update-agent:status:validate", "docs/development/release-train.md"],
    [releaseTrain, "pnpm ci:supply-chain:validate", "docs/development/release-train.md"],
    [rootReadme, "pnpm update-agent:status:record", "README.md"],
    [rootReadme, "pnpm ops:support:bundle-preview", "README.md"],
    [rootReadme, "pnpm ops:ops-001:preflight", "README.md"],
    [rootReadme, "pnpm ci:supply-chain:record", "README.md"],
    [rootReadme, "pnpm ops:ops-001:closure", "README.md"],
  ];
  const missing = requiredLinks
    .filter(([content, token]) => !content.includes(token))
    .map(([, token, source]) => `${source}:${token}`);
  checks.push({
    name: "enterprise operability entrypoints",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "README, docs index, workflow, doc sync, maintenance, and release train link the control plane"
      : `missing ${missing.join(", ")}`,
  });
}

function checkWorkflowTemplateBinding(): void {
  const template = read("workflow/templates/version-template.md");
  const requiredTerms = [
    "Owner skill",
    "Validation profile",
    "Source docs",
    "Residual risk IDs",
    "Release trigger",
    "Apply boundary",
    "Evidence freshness",
    "Source baseline",
  ];
  const missing = requiredTerms.filter((term) => !template.includes(term));
  checks.push({
    name: "workflow version binding fields",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "version template records owner skill, validation profile, source docs, residuals, release trigger, apply boundary, and source baseline"
      : `missing ${missing.join(", ")}`,
  });
}

function checkSkillBoundaries(): void {
  const skillReadme = read(".codex/skills-src/README.md");
  const operatingLoop = read(".codex/skills-src/areaforge-operating-loop/SKILL.md");
  const validation = read(".codex/skills-src/areaforge-validation-driver/SKILL.md");
  const release = read(".codex/skills-src/areaforge-release-operator/SKILL.md");
  const residual = read(".codex/skills-src/areaforge-residual-ledger/SKILL.md");
  const productExperience = read(".codex/skills-src/areaforge-product-experience/SKILL.md");
  const combined = `${skillReadme}\n${operatingLoop}\n${validation}\n${release}\n${residual}\n${productExperience}`;
  const requiredTerms = [
    "long-term-operability-control-plane.md",
    "enterprise:operability:preflight",
    "health",
    "readiness",
    "doctor",
    "gate",
    "不能互相替代",
    "默认不新增第 18 个 skill",
    "AF-RISK-UX-001",
  ];
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "skill operability boundaries",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "skills reference control plane, state-word discipline, release/UX residuals, and skill-addition policy"
      : `missing ${missing.join(", ")}`,
  });
}

function checkValidationCoverage(): void {
  const matrix = read("docs/development/validation-matrix.md");
  const skillMap = read(".codex/skills-src/areaforge-validation-driver/references/validation-map.md");
  const requiredTerms = [
    "docs/development/long-term-operability-control-plane.md",
    "scripts/quality/enterprise-operability-preflight.ts",
    "pnpm enterprise:operability:preflight",
    "pnpm maintenance:cadence:preflight",
    "pnpm release:train:preflight",
    "pnpm residuals:review-due",
    "pnpm skills:validate",
    "pnpm docs:readiness",
  ];
  const combined = `${matrix}\n${skillMap}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "validation coverage",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "validation matrix and skill map include enterprise operability control plane checks" : `missing ${missing.join(", ")}`,
  });
}

function checkNoWebOpsBoundary(): void {
  const files = [
    "docs/development/long-term-operability-control-plane.md",
    "docs/development/runtime-write-boundary.md",
    "docs/development/operational-readiness.md",
    "docs/deployment/github-release-updater.md",
  ];
  const combined = files.map(read).join("\n");
  const requiredTerms = [
    "Web runtime",
    "不得执行 Docker",
    "备份",
    "恢复",
    "migration",
    "updater apply",
    "rollback",
    "服务器命令",
  ];
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "no-web-ops boundary",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "control plane and runtime docs preserve Web runtime no-server-command boundary"
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
