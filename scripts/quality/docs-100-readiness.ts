import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface FeatureRow {
  section: string;
  feature: string;
  status: string;
}

const root = process.cwd();

const requiredFiles = [
  "docs/development/feature-traceability.md",
  "docs/development/high-risk-confirmation-packets.md",
  "docs/development/docs-100-acceptance-evidence.md",
  "docs/development/docs-100-completion-record.md",
  "docs/development/attachment-upload-access-design.md",
  "docs/development/structured-state-migration-design.md",
  "docs/development/ai-provider-integration-design.md",
  "docs/development/second-stage-long-term-loop-design.md",
  "docs/development/production-release-runbook.md",
  "docs/development/release-record-template.md",
  "docs/development/release-train.md",
  "docs/development/completion-evidence-checklist.md",
  "docs/development/runtime-write-boundary.md",
  "docs/development/dependency-policy.md",
  "docs/development/external-capability-admission.md",
  "docs/development/support-intake.md",
  "docs/development/maintenance-cadence.md",
  "docs/development/operational-readiness.md",
  "docs/development/production-smoke-alerting-strategy.md",
  "docs/development/product-experience-review-record-template.md",
  "docs/development/product-experience-review-20260710-local.md",
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "SECURITY.md",
  "SUPPORT.md",
  "CODE_REVIEW.md",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  "scripts/quality/governance-preflight.ts",
  "scripts/quality/ops-readiness-preflight.ts",
  "scripts/quality/residual-ledger-validate.ts",
  "scripts/quality/product-experience-review-validate.ts",
  "scripts/quality/product-experience-review-validate.selftest.ts",
  "scripts/ops/operational-readiness-summary.ts",
  "scripts/ops/local-ux-smoke.ts",
  "scripts/quality/package-d-preflight.ts",
  "scripts/quality/package-e-preflight.ts",
  "tasks/backlog/0015-structured-state-migration.md",
  "tasks/backlog/0016-second-stage-long-term-loop.md",
  "tasks/backlog/0017-ai-stage-privacy-cost.md",
  "tasks/indexes/residuals.md",
  "workflow/versions/v0.2-first-version-risk-closures.md",
  "workflow/versions/v0.3-structured-learning-state.md",
  "workflow/versions/v0.4-second-stage-long-term-loop.md",
  "workflow/versions/v1.0-prod-release.md",
] as const;

const highRiskPackages = [
  "Package A",
  "Package B",
  "Package C",
  "Package D",
  "Package E",
] as const;

const packageReferences = [
  "docs/development/attachment-upload-access-design.md",
  "docs/development/structured-state-migration-design.md",
  "docs/development/ai-provider-integration-design.md",
  "docs/development/second-stage-long-term-loop-design.md",
  "docs/development/production-release-runbook.md",
] as const;

const highRiskConfirmationPhrases = [
  "确认执行 Package A：附件上传与鉴权访问",
  "确认执行 Package B Batch 0",
  "确认执行 Package B Batch 1：CheckIn 日快照",
  "确认执行 Package B Batch 2：新增 `StudyTask.parentTaskId` 与 `TaskDebtEvent` additive migration",
  "确认执行 Package B Batch 3：新增 `RecoveryState` additive migration",
  "确认执行 Package B Batch 4：掌握证明条件、证据和复测记录",
  "确认执行 Package B Batch 5：结构化模拟考试和科目结果",
  "确认执行 Package B Batch 6：阶段计划和阶段调整草稿",
  "确认执行 Package C：真实 AI Provider 第一版",
  "确认执行 Package D：第二阶段长期闭环",
  "确认执行 Package D Batch D1：报告决策入口",
  "确认执行 Package D Batch D2：任务债务重排确认流",
  "确认执行 Package D Batch D3：长期阶段 AI 草稿",
  "确认执行 Package D Batch D4：长期风险和主题闭环补强",
  "确认执行 Package D Batch D5：Package D 收口",
  "确认执行 Package E：生产部署、备份与恢复",
  "确认执行 Package E Batch E1：生产配置与发布工件预检",
  "确认执行 Package E Batch E2：发布前备份与恢复演练",
  "确认执行 Package E Batch E3：生产发布与 migration deploy",
  "确认执行 Package E Batch E4：回滚演练与 Package E 收口",
] as const;

const versionFiles = [
  "versions/v0.2-first-version-risk-closures.md",
  "versions/v0.3-structured-learning-state.md",
  "versions/v0.4-second-stage-long-term-loop.md",
  "versions/v1.0-prod-release.md",
] as const;

const allowedTraceabilityStatuses = new Set([
  "已完成",
  "基础版",
  "待确认",
  "基础版 / 待确认",
  "暂缓",
  "暂缓 / 高风险",
]);

const checks: CheckResult[] = [];

function main(): void {
  checkRequiredFiles();
  checkFeatureScopeTraceability();
  checkTraceabilityStatusVocabulary();
  checkDocsReadme();
  checkWorkflowReadme();
  checkHighRiskPackets();
  checkAcceptanceEvidence();
  checkCompletionGateTerms();
  checkCompletionScriptGates();
  checkRiskPreflightBatchGuardTerms();
  checkGovernancePreflightTerms();
  checkOpsReadinessTerms();
  checkPackageDPreflightTerms();
  checkPackageEPreflightTerms();
  checkMasteryProofBasicTraceability();
  checkApiSurface();
  checkOldReferences();
  reportTraceabilityStatus();

  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    console.log(`${mark} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`docs readiness failed: ${failed.length} structural issue(s).`);
    process.exit(1);
  }

  console.log("docs readiness passed: governance structure is present; product completion is still tracked separately.");
}

function checkRequiredFiles(): void {
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkFeatureScopeTraceability(): void {
  const featureScope = read("docs/product/feature-scope.md");
  const traceability = read("docs/development/feature-traceability.md");
  const sections = [
    "## 第一版必须有",
    "## 第二阶段增强",
    "## 暂缓",
  ];
  const missing: string[] = [];

  for (const section of sections) {
    const items = extractBulletsFromSection(featureScope, section);
    for (const item of items) {
      if (!traceability.includes(item)) missing.push(`${section}:${item}`);
    }
  }

  checks.push({
    name: "feature scope traceability",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "all product scope items are tracked" : `missing ${missing.join(", ")}`,
  });
}

function checkTraceabilityStatusVocabulary(): void {
  const rows = parseTraceabilityRows(read("docs/development/feature-traceability.md"));
  const invalid = rows
    .filter((row) => !allowedTraceabilityStatuses.has(row.status))
    .map((row) => `${row.section}:${row.feature}=${row.status}`);

  checks.push({
    name: "feature traceability statuses",
    ok: invalid.length === 0,
    detail: invalid.length === 0 ? "all status values use the controlled vocabulary" : `invalid ${invalid.join("; ")}`,
  });
}

function checkDocsReadme(): void {
  const readme = read("docs/README.md");
  const missing = requiredFiles
    .filter((file) => file.startsWith("docs/development/"))
    .map((file) => file.replace("docs/", ""))
    .filter((entry) => !readme.includes(entry));

  checks.push({
    name: "docs README entries",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "all development entries linked" : `missing ${missing.join(", ")}`,
  });
}

function checkWorkflowReadme(): void {
  const readme = read("workflow/README.md");
  const missing = versionFiles.filter((file) => !readme.includes(file));

  checks.push({
    name: "workflow README versions",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "all post-v0.1 versions linked" : `missing ${missing.join(", ")}`,
  });
}

function checkHighRiskPackets(): void {
  const packets = read("docs/development/high-risk-confirmation-packets.md");
  const missingPackages = highRiskPackages.filter((item) => !packets.includes(item));
  const missingRefs = packageReferences.filter((item) => !packets.includes(item));
  const missingPhrases = highRiskConfirmationPhrases.filter((item) => !packets.includes(item));

  checks.push({
    name: "high-risk packets",
    ok: missingPackages.length === 0 && missingRefs.length === 0 && missingPhrases.length === 0,
    detail:
      missingPackages.length === 0 && missingRefs.length === 0 && missingPhrases.length === 0
        ? "packages A-E, design references, and exact confirmation phrases present"
        : `missing packages ${missingPackages.join(", ") || "none"}; missing refs ${missingRefs.join(", ") || "none"}; missing phrases ${missingPhrases.join("; ") || "none"}`,
  });
}

function checkAcceptanceEvidence(): void {
  const evidence = read("docs/development/docs-100-acceptance-evidence.md");
  const requiredSections = [
    "## 全局验收门",
    "## 第一版必须项验收",
    "## 第二阶段增强验收",
    "## 暂缓项验收",
    "## 高风险完成证据",
    "## 高风险确认前验收矩阵",
    "## 最终完成判定",
  ];
  const missingSections = requiredSections.filter((section) => !evidence.includes(section));
  const missingPackages = highRiskPackages.filter((item) => !evidence.includes(item));

  checks.push({
    name: "docs 100 evidence",
    ok: missingSections.length === 0 && missingPackages.length === 0,
    detail:
      missingSections.length === 0 && missingPackages.length === 0
        ? "sections and package evidence present"
        : `missing sections ${missingSections.join(", ") || "none"}; missing packages ${missingPackages.join(", ") || "none"}`,
  });
}

function checkCompletionGateTerms(): void {
  const evidence = read("docs/development/docs-100-acceptance-evidence.md");
  const completionRecord = read("docs/development/docs-100-completion-record.md");
  const validationMatrix = read("docs/development/validation-matrix.md");
  const gateText = `${evidence}\n${completionRecord}\n${validationMatrix}`;
  const requiredTerms = [
    "Package B Batch 0-6",
    "Package D D1-D5",
    "Package E E1-E4",
    "DONE / 已完成",
    "验证命令",
    "烟测证据",
    "文档同步",
    "残余风险",
    "pnpm docs:completion",
    "release:evidence:validate",
    "report_only",
    "migration deploy 执行载体",
    "镜像 digest",
    "Nginx",
  ];
  const missing = requiredTerms.filter((term) => !gateText.includes(term));

  checks.push({
    name: "docs completion gate terms",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "final gate documents package evidence, Package B batches, validation, smoke, docs sync, and residual risk"
      : `missing ${missing.join(", ")}`,
  });
}

function checkCompletionScriptGates(): void {
  const completionScript = read("scripts/quality/docs-100-completion.ts");
  const requiredTokens = [
    "requiredPackageBBatches",
    "requiredPackageDBatches",
    "requiredPackageEBatches",
    "requiredPackageEvidenceKeywords",
    "checkPackageBBatches",
    "checkCompletionBatches",
    "missingBatchEvidenceDetails",
    "checkPackageECompletionDetail",
    "missingPackageEBatchEvidenceDetails",
    "batch completion detail",
    "DONE / 已完成",
    "用户已明确确认",
    "验证",
    "烟测",
    "文档",
    "残余风险",
    "release:evidence:validate",
    "report_only",
    "migration deploy 执行载体",
  ];
  const missing = requiredTokens.filter((token) => !completionScript.includes(token));

  checks.push({
    name: "docs completion script gates",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "completion script enforces Package B/D/E batch rows, batch detail evidence, and package evidence keywords"
      : `missing ${missing.join(", ")}`,
  });
}

function checkRiskPreflightBatchGuardTerms(): void {
  const riskPreflight = read("scripts/quality/risk-preflight.ts");
  const requiredTokens = [
    "getPackageDBatchStatus",
    "isPackageDBatchDone",
    "confirmation.includes(\"用户已明确确认\")",
    "validation.includes(\"pnpm\")",
    "smoke",
    "docsSync.includes(\"已同步\")",
    "residualRisk.length",
    "hasWriteRouteMethod",
    "export\\s+const\\s+",
    "isReportDecisionScopeRoute",
    "/periodic-reports/",
    "stage-adjustment-drafts/ai",
    "longTermAiSpecificTerms",
    "isPackageDReportDecisionRoute",
    "isPackageDDebtReorderDecisionRoute",
    "isPackageDStageAiDraftRoute",
    "isAllowedPackageDPersistenceTerm",
    "checkPackageDCompletedBatchEvidence",
    "Package D D3 completed-batch evidence",
    "Package D D4 completed-batch evidence",
    "Package D D5 completed-batch evidence",
    "long-term-risk-service",
    "previewTaskDebtReorderApplication",
    "summarizeLongTermRisks",
    "小批量上限",
    "跳过摘要",
  ];
  const missing = requiredTokens.filter((token) => !riskPreflight.includes(token));

  checks.push({
    name: "risk preflight Package D batch guards",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "risk preflight keeps D1-D5 unlocks evidence-gated and route/token scans narrow"
      : `missing ${missing.join(", ")}`,
  });
}

function checkGovernancePreflightTerms(): void {
  const packageJson = read("package.json");
  const ci = read(".github/workflows/ci.yml");
  const readme = read("README.md");
  const agents = read("AGENTS.md");
  const codeReview = read("CODE_REVIEW.md");
  const validationMatrix = read("docs/development/validation-matrix.md");
  const docsReadme = read("docs/README.md");
  const governancePreflight = read("scripts/quality/governance-preflight.ts");
  const dependencyPolicy = read("docs/development/dependency-policy.md");
  const requiredTokens = [
    [packageJson, "\"governance:preflight\": \"tsx scripts/quality/governance-preflight.ts\"", "package.json"],
    [ci, "pnpm governance:preflight", ".github/workflows/ci.yml"],
    [readme, "pnpm governance:preflight", "README.md"],
    [agents, "docs/development/dependency-policy.md", "AGENTS.md"],
    [validationMatrix, "pnpm governance:preflight", "validation-matrix"],
    [docsReadme, "development/dependency-policy.md", "docs/README.md"],
    [docsReadme, "development/external-capability-admission.md", "docs/README.md"],
    [readme, "CODE_REVIEW.md", "README.md"],
    [docsReadme, "CODE_REVIEW.md", "docs/README.md"],
    [codeReview, "findings first", "CODE_REVIEW.md"],
    [codeReview, "AF-RISK-*", "CODE_REVIEW.md"],
    [governancePreflight, "SECURITY.md", "governance-preflight"],
    [governancePreflight, "CODE_REVIEW.md", "governance-preflight"],
    [governancePreflight, ".github/dependabot.yml", "governance-preflight"],
    [governancePreflight, ".github/pull_request_template.md", "governance-preflight"],
    [governancePreflight, "external-capability-admission.md", "governance-preflight"],
    [dependencyPolicy, "Dependabot", "dependency-policy"],
    [dependencyPolicy, "SBOM", "dependency-policy"],
  ] as const;
  const missing = requiredTokens
    .filter(([content, token]) => !content.includes(token))
    .map(([, token, source]) => `${source}:${token}`);

  checks.push({
    name: "governance preflight terms",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "public governance entrypoints, dependency policy, CI gate, and docs references are present"
      : `missing ${missing.join(", ")}`,
  });
}

function checkOpsReadinessTerms(): void {
  const readiness = read("docs/development/operational-readiness.md");
  const residual = read("docs/development/residual-risk-ledger.md");
  const script = read("scripts/quality/ops-readiness-preflight.ts");
  const skillsReadme = read(".codex/skills-src/README.md");
  const requiredTerms = [
    "只读运营证据聚合入口",
    "AF-RISK-OPS-001",
    "AF-RISK-REL-001",
    "AF-RISK-SC-001",
    "AF-RISK-UX-001",
    "pnpm ops:readiness",
    "pnpm ops:readiness:summary",
    "pnpm smoke:local-ux",
    "pnpm experience:review:validate",
    "areaforge-operating-loop",
    "release workflow validates before build",
  ];
  const combined = `${readiness}\n${residual}\n${script}\n${skillsReadme}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "ops readiness terms",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "operating loop, ops readiness, residual IDs, and release hard-gate evidence are present"
      : `missing ${missing.join(", ")}`,
  });
}

function checkPackageDPreflightTerms(): void {
  const packageJson = read("package.json");
  const packageDPreflight = read("scripts/quality/package-d-preflight.ts");
  const validationMatrix = read("docs/development/validation-matrix.md");
  const completionRecord = read("docs/development/docs-100-completion-record.md");
  const task = read("tasks/backlog/0016-second-stage-long-term-loop.md");
  const requiredPackageTokens = [
    "\"package-d:preflight\": \"tsx scripts/quality/package-d-preflight.ts\"",
  ];
  const requiredScriptTokens = [
    "checkCompletionRecordState",
    "checkReadOnlyRoutes",
    "checkNoUnconfirmedWriteRoutes",
    "checkNoUnconfirmedPersistence",
    "checkLongTermAiBoundary",
    "previewTaskDebtReorderApplication",
    "summarizeLongTermRisks",
    "source: \\\"local_rule\\\"",
  ];
  const documentationText = `${validationMatrix}\n${completionRecord}\n${task}`;
  const requiredDocTokens = [
    "pnpm package-d:preflight",
    "D1-D5",
    "不写库",
    "不新增 API",
    "长期 AI 禁区",
  ];
  const missing = [
    ...requiredPackageTokens.filter((token) => !packageJson.includes(token)).map((token) => `package.json:${token}`),
    ...requiredScriptTokens.filter((token) => !packageDPreflight.includes(token)).map((token) => `package-d-preflight:${token}`),
    ...requiredDocTokens.filter((token) => !documentationText.includes(token)).map((token) => `docs:${token}`),
  ];

  checks.push({
    name: "Package D preflight script",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "Package D has a dedicated read-only preflight script and docs references before D1-D5 confirmation"
      : `missing ${missing.join(", ")}`,
  });
}

function checkPackageEPreflightTerms(): void {
  const packageJson = read("package.json");
  const packageEPreflight = read("scripts/quality/package-e-preflight.ts");
  const validationMatrix = read("docs/development/validation-matrix.md");
  const completionRecord = read("docs/development/docs-100-completion-record.md");
  const runbook = read("docs/development/production-release-runbook.md");
  const requiredPackageTokens = [
    "\"package-e:preflight\": \"tsx scripts/quality/package-e-preflight.ts\"",
    "\"release:evidence:validate\": \"tsx scripts/quality/release-evidence-validate.ts\"",
    "\"release:evidence:selftest\": \"tsx scripts/quality/release-evidence-validate.selftest.ts\"",
  ];
  const requiredScriptTokens = [
    "checkComposeConfig",
    "checkComposeBoundaries",
    "checkDockerfileBoundaries",
    "checkNginxBoundaries",
    "checkWebRuntimeOpsBoundary",
    "release-evidence-validate.ts",
    "release-evidence-validate.selftest.ts",
    "attachment-reconciliation.ts",
    "docker compose config",
    "web binds localhost",
    "does not pretend to be a migration runner",
    "no production deploy, backup, restore, or migration was executed",
    "envBackupSha256",
    "migrationRunner",
    "rollbackPlan",
    "rollbackDrillResult",
  ];
  const documentationText = `${validationMatrix}\n${completionRecord}\n${runbook}`;
  const requiredDocTokens = [
    "pnpm package-e:preflight",
    "不执行生产部署",
    "不运行生产 migration",
    "不触碰生产数据库或上传目录",
    "Web runtime",
    "migration deploy 执行载体",
    "pnpm release:evidence:validate",
    "report_only",
    "envBackupSha256",
    "composeConfigBackupPath",
    "nginxConfigBackupPath",
    "migrationRunner",
    "rollbackPlan",
    "rollbackDrillResult",
  ];
  const missing = [
    ...requiredPackageTokens.filter((token) => !packageJson.includes(token)).map((token) => `package.json:${token}`),
    ...requiredScriptTokens.filter((token) => !packageEPreflight.includes(token)).map((token) => `package-e-preflight:${token}`),
    ...requiredDocTokens.filter((token) => !documentationText.includes(token)).map((token) => `docs:${token}`),
  ];

  checks.push({
    name: "Package E preflight script",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "Package E has a dedicated read-only preflight script and docs references before E1-E4 confirmation"
      : `missing ${missing.join(", ")}`,
  });
}

function checkMasteryProofBasicTraceability(): void {
  const traceability = read("docs/development/feature-traceability.md");
  const completionRecord = read("docs/development/docs-100-completion-record.md");
  const masteryDoc = read("docs/modules/mastery-proof.md");
  const rows = parseTraceabilityRows(traceability);
  const row = rows.find((item) => item.feature === "知识点掌握证明基础版");
  const rowLine = traceability
    .split(/\r?\n/)
    .find((line) => line.startsWith("| 知识点掌握证明基础版 |")) ?? "";
  const requiredRowTerms = [
    "/syllabus",
    "PATCH /api/syllabus/nodes/:id",
    "MASTERY_PROOF_REQUIRED",
    "AuditEvent",
    "Package B Batch 4",
  ];
  const requiredRecordTerms = [
    "知识点掌握证明基础版",
    "/syllabus",
    "PATCH /api/syllabus/nodes/:id",
    "AuditEvent",
    "Package B Batch 4",
  ];
  const requiredDocTerms = [
    "目标掌握等级",
    "掌握条件",
    "PATCH /api/syllabus/nodes/:id",
    "MASTERY_PROOF_REQUIRED",
    "AuditEvent",
    "Package B Batch 4",
  ];
  const missingRowTerms = requiredRowTerms.filter((term) => !rowLine.includes(term));
  const missingRecordTerms = requiredRecordTerms.filter((term) => !completionRecord.includes(term));
  const missingDocTerms = requiredDocTerms.filter((term) => !masteryDoc.includes(term));
  const ok =
    row?.status === "已完成" &&
    missingRowTerms.length === 0 &&
    missingRecordTerms.length === 0 &&
    missingDocTerms.length === 0;

  checks.push({
    name: "mastery proof basic traceability",
    ok,
    detail: ok
      ? "basic mastery proof is tracked as complete with proof gate, audit, UI/API, and Batch 4 boundary"
      : `status=${row?.status ?? "missing"}; row missing ${missingRowTerms.join(", ") || "none"}; record missing ${missingRecordTerms.join(", ") || "none"}; doc missing ${missingDocTerms.join(", ") || "none"}`,
  });
}

function checkApiSurface(): void {
  const apiSurface = read("docs/architecture/api-surface.md");
  const hasScopedUpload = apiSurface.includes("POST /api/notes/:noteId/attachments");
  const hasOldUpload = apiSurface.includes("POST /api/attachments");

  checks.push({
    name: "attachment API surface",
    ok: hasScopedUpload && !hasOldUpload,
    detail: hasScopedUpload && !hasOldUpload
      ? "scoped note attachment API documented"
      : "expected POST /api/notes/:noteId/attachments and no old POST /api/attachments",
  });
}

function checkOldReferences(): void {
  const filesToScan = [
    "README.md",
    "AGENTS.md",
    ...requiredFiles,
    "docs/README.md",
    "docs/development/implementation-order.md",
    "workflow/README.md",
  ];
  const patterns = [
    "AreaForge产品方案",
    "AreaForge工程结构方案",
    "产品方案.md",
    "工程结构方案.md",
  ];
  const matches: string[] = [];

  for (const file of filesToScan) {
    if (!existsSync(resolve(file))) continue;
    const content = read(file);
    for (const pattern of patterns) {
      if (content.includes(pattern)) matches.push(`${file}:${pattern}`);
    }
  }

  checks.push({
    name: "old document references",
    ok: matches.length === 0,
    detail: matches.length === 0 ? "no legacy top-level plan references" : matches.join(", "),
  });
}

function reportTraceabilityStatus(): void {
  const rows = parseTraceabilityRows(read("docs/development/feature-traceability.md"));
  const trackedStatuses = [
    "基础版",
    "待确认",
    "未实现",
    "暂缓",
  ];
  const counts = trackedStatuses.map((status) => `${status}=${rows.filter((row) => row.status.includes(status)).length}`);

  checks.push({
    name: "traceability status report",
    ok: true,
    detail: counts.join(", "),
  });
}

function parseTraceabilityRows(content: string): FeatureRow[] {
  const rows: FeatureRow[] = [];
  let section = "";

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      section = line.replace(/^##\s+/, "").trim();
      continue;
    }
    if (!line.startsWith("| ")) continue;
    if (line.includes("---")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (cells[0] === "功能项" || cells[0] === "功能") continue;

    rows.push({
      section,
      feature: cells[0],
      status: cells[1],
    });
  }

  return rows;
}

function extractBulletsFromSection(content: string, heading: string): string[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];

  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const match = line.match(/^- (.+)$/);
    if (!match) continue;
    items.push(stripSentencePunctuation(match[1].trim()));
  }
  return items;
}

function stripSentencePunctuation(value: string): string {
  return value.replace(/[。.]$/, "");
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
