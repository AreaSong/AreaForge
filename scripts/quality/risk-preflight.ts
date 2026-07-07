import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const checks: CheckResult[] = [];

const packageDocs = [
  "docs/development/attachment-upload-access-design.md",
  "docs/development/structured-state-migration-design.md",
  "docs/development/ai-provider-integration-design.md",
  "docs/development/second-stage-long-term-loop-design.md",
  "docs/development/production-release-runbook.md",
] as const;

const requiredEnvKeys = [
  "DATABASE_URL",
  "AUTH_SESSION_SECRET",
  "UPLOAD_DIR",
  "MAX_UPLOAD_MB",
  "ALLOWED_UPLOAD_MIME",
  "AI_ENABLED",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_TIMEOUT_MS",
  "AI_MAX_RETRIES",
] as const;

const requiredProductionEnvKeys = [
  "APP_URL",
  "APP_VERSION",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "AUTH_SESSION_SECRET",
  "AREAFORGE_IMAGE",
  "UPLOAD_DIR",
  "BACKUP_DIR",
  "BACKUP_RETENTION_DAYS",
] as const;

function main(): void {
  checkDesignDocs();
  checkHighRiskPreconfirmationMatrix();
  checkExplicitConfirmationPhrases();
  checkEnvExample();
  checkAttachmentDesign();
  checkAttachmentStillBeforePackageA();
  checkAiDesign();
  checkAiStillBeforePackageC();
  checkStructuredMigrationDesign();
  checkMasteryProofBasicImplementation();
  checkSecondStageDesign();
  checkSecondStageStillBeforePackageD();
  checkProductionCompose();
  checkPackageBBatchBoundaries();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`risk preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("risk preflight passed: this script ran read-only checks and found current confirmation guardrails and pre-confirmation boundaries.");
}

function checkHighRiskPreconfirmationMatrix(): void {
  const evidence = readIfExists("docs/development/docs-100-acceptance-evidence.md");
  const requiredTerms = [
    "高风险确认前验收矩阵",
    "确认前可安全推进",
    "确认前禁止越界",
    "确认后完成证据",
    "Package A",
    "Package B",
    "Package C",
    "Package D",
    "Package E",
    "写入 `UPLOAD_DIR`",
    "未确认批次的 schema/migration",
    "真实 provider 外呼",
    "重排应用写 API",
    "生产部署",
  ];
  const missingTerms = requiredTerms.filter((term) => !evidence.includes(term));
  checks.push({
    name: "high-risk preconfirmation acceptance matrix",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0
      ? "A-E preconfirmation safe work, forbidden boundary, and post-confirmation evidence are documented"
      : `missing ${missingTerms.join(", ")}`,
  });
}

function checkDesignDocs(): void {
  const missing = packageDocs.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "package design docs",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${packageDocs.length} design docs present` : `missing ${missing.join(", ")}`,
  });

  const packets = readIfExists("docs/development/high-risk-confirmation-packets.md");
  const missingRefs = packageDocs.filter((file) => !packets.includes(file));
  checks.push({
    name: "high-risk packet references",
    ok: missingRefs.length === 0,
    detail: missingRefs.length === 0 ? "all package design docs referenced" : `missing refs ${missingRefs.join(", ")}`,
  });
}

function checkExplicitConfirmationPhrases(): void {
  const packets = readIfExists("docs/development/high-risk-confirmation-packets.md");
  const requiredPhrases = [
    "确认执行 Package A：附件上传与鉴权访问",
    "确认执行 Package B Batch 1：CheckIn 日快照",
    "确认执行 Package B Batch 2：新增 `StudyTask.parentTaskId` 与 `TaskDebtEvent` additive migration",
    "确认执行 Package B Batch 3：新增 `RecoveryState` additive migration",
    "确认执行 Package B Batch 4：掌握证明条件、证据和复测记录",
    "确认执行 Package B Batch 5：结构化模拟考试和科目结果",
    "确认执行 Package B Batch 6：阶段计划和阶段调整草稿",
    "确认执行 Package C：真实 AI Provider 第一版",
    "确认执行 Package D：第二阶段长期闭环",
    "确认执行 Package E：生产部署、备份与恢复",
  ];
  const missingPhrases = requiredPhrases.filter((phrase) => !packets.includes(phrase));

  checks.push({
    name: "explicit high-risk confirmation phrases",
    ok: missingPhrases.length === 0,
    detail: missingPhrases.length === 0
      ? "Package A-E and Package B Batch 1-6 have exact confirmation phrases"
      : `missing ${missingPhrases.join("; ")}`,
  });
}

function checkEnvExample(): void {
  const envExample = readIfExists(".env.example");
  const missingKeys = requiredEnvKeys.filter((key) => !new RegExp(`^${key}=`, "m").test(envExample));
  checks.push({
    name: ".env.example package keys",
    ok: missingKeys.length === 0,
    detail: missingKeys.length === 0 ? "upload and AI keys documented" : `missing ${missingKeys.join(", ")}`,
  });

  const config = readIfExists("packages/config/src/index.ts");
  const missingInSchema = requiredEnvKeys
    .filter((key) => !["AI_API_KEY", "AI_MODEL"].includes(key))
    .filter((key) => !config.includes(key));
  checks.push({
    name: "config schema package keys",
    ok: missingInSchema.length === 0,
    detail: missingInSchema.length === 0 ? "server env schema covers high-risk package keys" : `missing ${missingInSchema.join(", ")}`,
  });

  const missingProdKeys = requiredProductionEnvKeys.filter((key) => !new RegExp(`^${key}=`, "m").test(envExample));
  checks.push({
    name: ".env.example production release keys",
    ok: missingProdKeys.length === 0,
    detail: missingProdKeys.length === 0
      ? "production release, upload, and backup keys are documented"
      : `missing ${missingProdKeys.join(", ")}`,
  });
}

function checkAttachmentDesign(): void {
  const design = readIfExists("docs/development/attachment-upload-access-design.md");
  const storage = readIfExists("packages/storage/src/index.ts");
  const apiSurface = readIfExists("docs/architecture/api-surface.md");
  const task = readIfExists("tasks/done/0004-mvp-syllabus-notes-upload.md");
  const requiredDesignTerms = [
    "POST /api/notes/[noteId]/attachments",
    "GET /api/attachments/:id",
    "不进入 `public/`",
    "downloadApiPath",
    "响应不得包含内部 `uri`",
    "ATTACHMENT_MULTIPLE_FILES",
    "ATTACHMENT_BAD_MULTIPART",
    "ATTACHMENT_INVALID_DISPOSITION",
    "Content-Disposition",
    "补偿",
    "软链接逃逸",
    "独占写入",
    "ATTACHMENT_METADATA_WRITE_FAILED",
    "ATTACHMENT_FILE_MISMATCH",
    "action=report_only",
  ];
  const missingDesignTerms = requiredDesignTerms.filter((term) => !design.includes(term));
  checks.push({
    name: "Package A design guardrails",
    ok: missingDesignTerms.length === 0,
    detail: missingDesignTerms.length === 0 ? "upload scope, compensation, and symlink guardrails present" : `missing ${missingDesignTerms.join(", ")}`,
  });

  const hasStorageGuards =
    storage.includes("createSafeAttachmentFilePath") &&
    storage.includes("forbiddenDirectories") &&
    storage.includes("parseAttachmentUri") &&
    storage.includes("createAttachmentResponseHeaders") &&
    storage.includes("private, no-store") &&
    storage.includes("nosniff");
  checks.push({
    name: "Package A storage primitives",
    ok: hasStorageGuards,
    detail: hasStorageGuards
      ? "safe URI, path, response header, private cache, and nosniff helpers present"
      : "expected safe URI, path, response header, private cache, and nosniff helpers",
  });

  const hasScopedApi = apiSurface.includes("POST /api/notes/:noteId/attachments") && !apiSurface.includes("POST /api/attachments");
  checks.push({
    name: "Package A API surface",
    ok: hasScopedApi,
    detail: hasScopedApi ? "attachment upload remains note-scoped" : "expected note-scoped upload API and no old top-level upload",
  });

  const requiredTaskPrepTerms = [
    "确认后实施切入点",
    "attachments-service.ts",
    "POST /api/notes/[noteId]/attachments",
    "GET /api/attachments/[id]",
    "/notes",
    "上传中/成功/失败状态",
    "空文件",
    "超大文件",
    "声明 MIME 不一致",
    "软链接逃逸",
    "DB 写入失败",
    "孤儿清理必须另走只读对账和单独确认",
  ];
  const missingTaskPrepTerms = requiredTaskPrepTerms.filter((term) => !task.includes(term));
  checks.push({
    name: "Package A implementation prep",
    ok: missingTaskPrepTerms.length === 0,
    detail: missingTaskPrepTerms.length === 0
      ? "attachment service, route, UI, failure, and orphan-audit prep are documented"
      : `missing ${missingTaskPrepTerms.join(", ")}`,
  });
}

function checkAiDesign(): void {
  const design = readIfExists("docs/development/ai-provider-integration-design.md");
  const ai = readIfExists("packages/ai/src/index.ts");
  const task = readIfExists("tasks/backlog/0005-mvp-ai-discipline.md");
  const requiredTerms = [
    "AI_ENABLED=false",
    "动机档案",
    "禁止记录",
    "完整 prompt",
    "客户端 bundle 搜索不到 `AI_API_KEY`",
    "首页",
  ];
  const missingTerms = requiredTerms.filter((term) => !design.includes(term));
  checks.push({
    name: "Package C privacy and cost guardrails",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? "AI privacy, fallback, and homepage cost guardrails documented" : `missing ${missingTerms.join(", ")}`,
  });

  const hasSensitiveContextGuard =
    ai.includes("findSensitiveContextKeys") &&
    ai.includes("normalizeContextKey") &&
    ai.includes("apikey") &&
    ai.includes("filepath") &&
    ai.includes("pdfcontent");
  checks.push({
    name: "Package C sensitive context guard",
    ok: hasSensitiveContextGuard,
    detail: hasSensitiveContextGuard ? "AI package blocks sensitive context variants" : "expected sensitive context guard variants",
  });

  const requiredTaskPrepTerms = [
    "确认后实施切入点",
    "OpenAI-compatible JSON provider",
    "chat/completions",
    "AI_ENABLED=false",
    "AI_ENABLED=true",
    "配置缺失",
    "首页服务端渲染不得因为普通打开页面产生真实外呼成本",
    "用户显式触发",
    "不得发送动机档案",
    "完整复盘正文",
    "客户端 bundle 搜不到 `AI_API_KEY`",
  ];
  const missingTaskPrepTerms = requiredTaskPrepTerms.filter((term) => !task.includes(term));
  checks.push({
    name: "Package C implementation prep",
    ok: missingTaskPrepTerms.length === 0,
    detail: missingTaskPrepTerms.length === 0
      ? "provider, env, homepage cost, minimized context, and key-scan prep are documented"
      : `missing ${missingTaskPrepTerms.join(", ")}`,
  });

  const validation = readIfExists("docs/development/validation-matrix.md");
  const requiredValidationTerms = [
    "Package C 专项验证",
    "AI_ENABLED=false",
    "配置缺失 fallback",
    "429",
    "401",
    "5xx",
    "invalid JSON",
    "客户端 bundle 搜不到 `AI_API_KEY`",
    "标题隐私烟测",
    "task title may contain private content",
  ];
  const missingValidationTerms = requiredValidationTerms.filter((term) => !validation.includes(term));
  checks.push({
    name: "Package C validation matrix",
    ok: missingValidationTerms.length === 0,
    detail: missingValidationTerms.length === 0
      ? "AI confirmation and post-confirmation provider validation gates are documented"
      : `missing ${missingValidationTerms.join(", ")}`,
  });
}

function checkSecondStageDesign(): void {
  const design = readIfExists("docs/development/second-stage-long-term-loop-design.md");
  const task = readIfExists("tasks/backlog/0016-second-stage-long-term-loop.md");
  const requiredTerms = [
    "Package B",
    "Package C",
    "canAutoApply=false",
    "requiresUserConfirmation=true",
    "确认前禁用项",
    "依赖-允许能力矩阵",
    "审计记录",
    "部分应用失败",
    "不自动覆盖阶段计划",
  ];
  const missingTerms = requiredTerms.filter((term) => !design.includes(term));
  checks.push({
    name: "Package D long-term loop guardrails",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0
      ? "dependency, confirmation, audit, and partial-failure guardrails documented"
      : `missing ${missingTerms.join(", ")}`,
  });

  const packets = readIfExists("docs/development/high-risk-confirmation-packets.md");
  const requiredPacketTerms = [
    "docs/development/second-stage-long-term-loop-design.md",
    "canAutoApply=false",
    "requiresUserConfirmation=true",
    "部分应用失败",
  ];
  const missingPacketTerms = requiredPacketTerms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package D high-risk packet",
    ok: missingPacketTerms.length === 0,
    detail: missingPacketTerms.length === 0
      ? "Package D packet references design and confirm-only semantics"
      : `missing ${missingPacketTerms.join(", ")}`,
  });

  const requiredTaskPrepTerms = [
    "确认后实施切入点",
    "报告决策入口",
    "确认本周期策略",
    "驳回策略",
    "任务债务重排",
    "重复提交",
    "部分失败",
    "StagePlan",
    "StageAdjustmentDraft",
    "SimulationExam",
    "SimulationSubjectResult",
    "状态主题深度联动",
    "长期 AI 阶段调整",
    "未确认时保持本地规则草稿",
    "长期 AI 关闭",
  ];
  const missingTaskPrepTerms = requiredTaskPrepTerms.filter((term) => !task.includes(term));
  checks.push({
    name: "Package D implementation prep",
    ok: missingTaskPrepTerms.length === 0,
    detail: missingTaskPrepTerms.length === 0
      ? "report decisions, debt application, stage adjustment, simulation, theme, and long-term AI prep are documented"
      : `missing ${missingTaskPrepTerms.join(", ")}`,
  });
}

function checkSecondStageStillBeforePackageD(): void {
  const completionRecord = readIfExists("docs/development/docs-100-completion-record.md");
  const batch6Done = isPackageBBatchDone(completionRecord, 6);
  const debtReorderRoute = readIfExists("apps/web/app/api/tasks/debt-reorder/route.ts");
  const reportsPeriodicRoute = readIfExists("apps/web/app/api/reports/periodic/route.ts");
  const simulationStageRoute = readIfExists("apps/web/app/api/simulation/stage/route.ts");
  const stageAdjustmentCore = readIfExists("packages/core/src/stage-adjustment.ts");
  const simulationService = readIfExists("apps/web/lib/study/simulation-service.ts");
  const simulationPage = readIfExists("apps/web/app/simulation/page.tsx");
  const reportsService = readIfExists("apps/web/lib/study/reports-service.ts");
  const reportsPage = readIfExists("apps/web/app/reports/page.tsx");
  const taskPanel = readIfExists("apps/web/components/task-panel.tsx");
  const taskDebtDocs = readIfExists("docs/modules/task-debt.md");
  const apiSurface = readIfExists("docs/architecture/api-surface.md");
  const schema = readIfExists("prisma/schema.prisma");
  const allApiFiles = listFiles("apps/web/app/api");
  const studyRuntimeFiles = listFiles("apps/web/lib/study").filter((file) => file.endsWith(".ts"));
  const studyRuntimeText = studyRuntimeFiles.map((file) => readIfExists(file)).join("\n");
  const packageDForbiddenRouteTerms = ["apply", "confirm", "reject"];
  const packageDWriteRouteScopes = [
    "/tasks/debt-reorder/",
    "/reports/",
    "/periodic-reports/",
    "/simulation/stage",
    "/simulation/stage-adjustment",
    "/simulation/exams/",
  ];
  const forbiddenDebtApplyRoutes = allApiFiles.filter((file) =>
    file.includes("/tasks/debt-reorder/") && packageDForbiddenRouteTerms.some((term) => file.includes(`/${term}/`)),
  );
  const forbiddenStageApplyRoutesByScan = allApiFiles.filter((file) =>
    file.includes("/simulation/stage") &&
    packageDForbiddenRouteTerms.some((term) => file.includes(`/${term}/`)) &&
    !isBatch6StageDraftDecisionRoute(file, batch6Done),
  );
  const forbiddenLongTermWriteRoutes = allApiFiles.filter((file) => {
    const normalized = file.replaceAll(path.sep, "/");
    const scoped = packageDWriteRouteScopes.some((scope) => normalized.includes(scope));
    const hasForbiddenAction = packageDForbiddenRouteTerms.some((term) => normalized.includes(`/${term}/`));
    return scoped && hasForbiddenAction && !isBatch6StageDraftDecisionRoute(normalized, batch6Done);
  });

  const forbiddenDebtReorderMethods = ["POST", "PATCH", "PUT", "DELETE"].filter((method) =>
    new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(debtReorderRoute),
  );
  checks.push({
    name: "Package D debt reorder API boundary",
    ok: debtReorderRoute.includes("export async function GET") &&
      forbiddenDebtReorderMethods.length === 0 &&
      forbiddenDebtApplyRoutes.length === 0,
    detail: forbiddenDebtReorderMethods.length === 0 && forbiddenDebtApplyRoutes.length === 0
      ? "debt reorder remains read-only GET without apply write handlers"
      : `found debt reorder write surface before confirmation: ${[...forbiddenDebtReorderMethods, ...forbiddenDebtApplyRoutes].join(", ")}`,
  });

  const forbiddenReportsPeriodicMethods = ["POST", "PATCH", "PUT", "DELETE"].filter((method) =>
    new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(reportsPeriodicRoute),
  );
  checks.push({
    name: "Package D periodic reports API boundary",
    ok: reportsPeriodicRoute.includes("export async function GET") && forbiddenReportsPeriodicMethods.length === 0,
    detail: forbiddenReportsPeriodicMethods.length === 0
      ? "periodic reports remain read-only GET without decision write handlers"
      : `found periodic report write methods before confirmation: ${forbiddenReportsPeriodicMethods.join(", ")}`,
  });

  const forbiddenStageMethods = ["POST", "PATCH", "PUT", "DELETE"].filter((method) =>
    new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(simulationStageRoute),
  );
  const forbiddenStageApplyRoutes = [
    "apps/web/app/api/simulation/stage/apply/route.ts",
    "apps/web/app/api/simulation/stage/confirm/route.ts",
    "apps/web/app/api/simulation/stage-adjustment/apply/route.ts",
    "apps/web/app/api/simulation/stage-adjustment/confirm/route.ts",
  ].filter((file) => existsSync(resolve(file)));
  const allForbiddenStageRoutes = [...forbiddenStageApplyRoutes, ...forbiddenStageApplyRoutesByScan];
  checks.push({
    name: "Package D stage adjustment API boundary",
    ok: simulationStageRoute.includes("export async function GET") &&
      forbiddenStageMethods.length === 0 &&
      allForbiddenStageRoutes.length === 0,
    detail: forbiddenStageMethods.length === 0 && allForbiddenStageRoutes.length === 0
      ? "stage adjustment remains read-only draft without apply write handlers"
      : `found stage adjustment write surface before confirmation: ${[...forbiddenStageMethods, ...allForbiddenStageRoutes].join(", ")}`,
  });

  checks.push({
    name: "Package D long-term apply route boundary",
    ok: forbiddenLongTermWriteRoutes.length === 0,
    detail: forbiddenLongTermWriteRoutes.length === 0
      ? "no report/debt/stage/simulation apply-confirm-reject routes exist before confirmation"
      : `found long-term write routes before confirmation: ${forbiddenLongTermWriteRoutes.join(", ")}`,
  });

  const stageConfirmTerms = [
    "canAutoApply: false;",
    "requiresUserConfirmation: true;",
    "canAutoApply: false,",
    "requiresUserConfirmation: true,",
    "canAutoApply: stageAdjustment.canAutoApply",
    "requiresUserConfirmation: stageAdjustment.requiresUserConfirmation",
    "workspace.stage.draft.canAutoApply",
    "workspace.stage.draft.requiresUserConfirmation",
  ];
  const stageText = `${stageAdjustmentCore}\n${simulationService}\n${simulationPage}`;
  const missingStageConfirmTerms = stageConfirmTerms.filter((term) => !stageText.includes(term));
  checks.push({
    name: "Package D stage adjustment confirm-only boundary",
    ok: missingStageConfirmTerms.length === 0,
    detail: missingStageConfirmTerms.length === 0
      ? "stage adjustment draft exposes confirm-only DTO and UI boundary"
      : `missing ${missingStageConfirmTerms.join(", ")}`,
  });

  const reportConfirmFields = [
    "canAutoApply: false;",
    "requiresUserConfirmation: true;",
    "canAutoApply: strategy.canAutoApply",
    "requiresUserConfirmation: strategy.requiresUserConfirmation",
    "canAutoApply: false,",
    "requiresUserConfirmation: true,",
  ];
  const missingReportConfirmFields = reportConfirmFields.filter((term) => !reportsService.includes(term));
  checks.push({
    name: "Package D report confirm-only DTO",
    ok: missingReportConfirmFields.length === 0,
    detail: missingReportConfirmFields.length === 0
      ? "periodic strategy and local draft expose confirm-only fields"
      : `missing ${missingReportConfirmFields.join(", ")}`,
  });

  const requiredUiTerms = [
    "report.strategy.canAutoApply",
    "report.strategy.requiresUserConfirmation",
    "report.aiDraft.canAutoApply",
    "report.aiDraft.requiresUserConfirmation",
    "debtReorder.canAutoApply",
    "debtReorder.requiresUserConfirmation",
  ];
  const uiText = `${reportsPage}\n${taskPanel}`;
  const missingUiTerms = requiredUiTerms.filter((term) => !uiText.includes(term));
  checks.push({
    name: "Package D confirm-only UI labels",
    ok: missingUiTerms.length === 0,
    detail: missingUiTerms.length === 0
      ? "reports and debt reorder UI display read-only confirmation boundaries"
      : `missing ${missingUiTerms.join(", ")}`,
  });

  const requiredDocsTerms = [
    "canAutoApply=false",
    "requiresUserConfirmation=true",
    "`GET /api/tasks/debt-reorder` 只读",
  ];
  const docsText = `${taskDebtDocs}\n${apiSurface}`;
  const missingDocsTerms = requiredDocsTerms.filter((term) => !docsText.includes(term));
  checks.push({
    name: "Package D confirm-only docs",
    ok: missingDocsTerms.length === 0,
    detail: missingDocsTerms.length === 0
      ? "task debt and API docs document read-only confirmation boundaries"
      : `missing ${missingDocsTerms.join(", ")}`,
  });

  const forbiddenLongTermAiTerms = ["@areaforge/ai", "generateAdviceWithProvider", "createConfiguredAiProvider"];
  const longTermServiceText = `${reportsService}\n${simulationService}\n${simulationStageRoute}`;
  const longTermAiMatches = forbiddenLongTermAiTerms.filter((term) => longTermServiceText.includes(term));
  checks.push({
    name: "Package D long-term AI boundary",
    ok: longTermAiMatches.length === 0,
    detail: longTermAiMatches.length === 0
      ? "reports and stage services do not call AI before Package C/D confirmation"
      : `found long-term AI call surface before confirmation: ${longTermAiMatches.join(", ")}`,
  });

  const forbiddenReportSnapshotTerms = [
    "model ReportDecision",
    "model ReportSnapshot",
    "model PeriodicReportSnapshot",
    "model PeriodicReportDecision",
    "model ReportApplication",
    "model TaskReorderApplication",
    "model TaskDebtReorderApplication",
    "model StageAdjustmentApplication",
    "model StagePlanApplication",
    "model LongTermAiAdvice",
    "reportSnapshot",
    "periodicReportSnapshot",
    "reportDecision",
    "periodicReportDecision",
    "reportApplication",
    "taskReorderApplication",
    "debtReorderApplication",
    "stageAdjustmentApplication",
    "stagePlanApplication",
    "longTermAiAdvice",
  ];
  const reportSnapshotMatches = forbiddenReportSnapshotTerms.filter((term) =>
    schema.includes(term) ||
    studyRuntimeText.includes(term),
  );
  checks.push({
    name: "Package D report and decision persistence boundary",
    ok: reportSnapshotMatches.length === 0,
    detail: reportSnapshotMatches.length === 0
      ? "periodic reports, debt reorder, and stage drafts remain read-only with no decision/snapshot/application persistence"
      : `found report/decision/application persistence surface before confirmation: ${reportSnapshotMatches.join(", ")}`,
  });
}

function checkStructuredMigrationDesign(): void {
  const design = readIfExists("docs/development/structured-state-migration-design.md");
  const packets = readIfExists("docs/development/high-risk-confirmation-packets.md");
  const task = readIfExists("tasks/backlog/0015-structured-state-migration.md");
  const completionRecord = readIfExists("docs/development/docs-100-completion-record.md");
  const validationMatrix = readIfExists("docs/development/validation-matrix.md");
  const checkInDoc = readIfExists("docs/modules/check-in.md");
  const coreRules = readIfExists("packages/core/src/index.ts");
  const coreTests = readIfExists("packages/core/src/index.test.ts");
  const requiredTerms = [
    "additive migration",
    "Batch 0",
    "Batch 1",
    "Batch 2",
    "Batch 3",
    "Batch 4",
    "Batch 5",
    "Batch 6",
    "不删除旧字段",
    "不做不可靠解析",
  ];
  const missingTerms = requiredTerms.filter((term) => !design.includes(term));
  checks.push({
    name: "Package B migration guardrails",
    ok: missingTerms.length === 0,
    detail: missingTerms.length === 0 ? "additive batches and compatibility guardrails documented" : `missing ${missingTerms.join(", ")}`,
  });

  const requiredBatch0Terms = [
    "Batch 0 确认包",
    "understandingLevel String?",
    "minimalOutput String?",
    "nextAction String?",
    "producedNote Boolean @default(false)",
    "producedMistake Boolean @default(false)",
    "isLowConversion Boolean?",
    "antiFakeReason String?",
    "requiredOutput String?",
    "closeoutVersion Int @default(1)",
    "不新增 `CheckIn`",
    "历史 `StudySession.note` 不解析、不回填",
    "docs/architecture/data-model.md",
    "docs/architecture/api-surface.md",
    "docs/development/docs-100-completion-record.md",
  ];
  const missingBatch0Terms = requiredBatch0Terms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package B Batch 0 confirmation packet",
    ok: missingBatch0Terms.length === 0,
    detail: missingBatch0Terms.length === 0
      ? "StudySession closeout migration fields, exclusions, and doc sync targets documented"
      : `missing ${missingBatch0Terms.join(", ")}`,
  });

  const requiredBatch1Terms = [
    "Batch 1 确认包",
    "model CheckIn",
    "studyDate DateTime @unique",
    "completedMinimumAction Boolean @default(false)",
    "totalMinutes Int @default(0)",
    "effectiveMinutes Int @default(0)",
    "effectiveSessionCount Int @default(0)",
    "taskCompletionRate Float @default(0)",
    "reviewSubmitted Boolean @default(false)",
    "lowEfficiency Boolean @default(false)",
    "lowConversionCount Int @default(0)",
    "sourceVersion Int @default(1)",
    "结束计时、任务状态变化和每日复盘保存后 upsert 当日 `CheckIn`",
    "缺失日期 fallback 正常",
    "逐日快照平均值",
    "不新增债务事件、恢复状态、掌握证明、模拟考试或阶段计划模型",
  ];
  const missingBatch1Terms = requiredBatch1Terms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package B Batch 1 confirmation packet",
    ok: missingBatch1Terms.length === 0,
    detail: missingBatch1Terms.length === 0
      ? "CheckIn snapshot migration fields, write paths, fallbacks, and exclusions documented"
      : `missing ${missingBatch1Terms.join(", ")}`,
  });

  const requiredBatch2Terms = [
    "Batch 2 确认包",
    "StudyTask.parentTaskId String?",
    "parent StudyTask? @relation(\"TaskTree\", fields: [parentTaskId], references: [id])",
    "children StudyTask[] @relation(\"TaskTree\")",
    "model TaskDebtEvent",
    "recover/defer/drop/split/merge/convert_review/complete/reorder_suggested/reorder_applied",
    "同时继续保留现有 `reviewText`",
    "继续双写或保留现有 `AuditEvent`",
    "旧任务没有债务事件时",
    "不自动应用任务重排",
    "不新增 `RecoveryState`",
  ];
  const missingBatch2Terms = requiredBatch2Terms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package B Batch 2 confirmation packet",
    ok: missingBatch2Terms.length === 0,
    detail: missingBatch2Terms.length === 0
      ? "task parent relation, debt event ledger, audit double-write, fallback, and exclusions documented"
      : `missing ${missingBatch2Terms.join(", ")}`,
  });

  const requiredBatch3Terms = [
    "Batch 3 确认包",
    "model RecoveryState",
    "status String`：`active/completed/canceled",
    "triggerType String`：`rule/manual",
    "targetMinutes Int",
    "visibleTaskLimit Int",
    "exitCondition String?",
    "没有 active 状态时继续使用 `createRecoveryPlan` 实时规则",
    "不自动批量改历史欠账",
    "不删除、不隐藏原任务",
  ];
  const missingBatch3Terms = requiredBatch3Terms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package B Batch 3 confirmation packet",
    ok: missingBatch3Terms.length === 0,
    detail: missingBatch3Terms.length === 0
      ? "recovery state fields, active fallback, non-destructive task boundary, and exclusions documented"
      : `missing ${missingBatch3Terms.join(", ")}`,
  });

  const requiredBatch4Terms = [
    "Batch 4 确认包",
    "model MasteryConditionRecord",
    "condition String`：`course_or_textbook/own_explanation/basic_exercise/comprehensive_exercise/mistake_reviewed/delayed_retest",
    "@@unique([syllabusNodeId, condition])",
    "model MasteryEvidence",
    "evidenceType String`：`task/session/note/mistake/retest",
    "model MasteryRetest",
    "result String`：`passed/failed/partial",
    "继续调用 `evaluateMasteryProof`",
    "fallback 现有 `_count`",
    "复测失败或部分通过只生成下一步动作建议，不自动降低节点状态",
  ];
  const missingBatch4Terms = requiredBatch4Terms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package B Batch 4 confirmation packet",
    ok: missingBatch4Terms.length === 0,
    detail: missingBatch4Terms.length === 0
      ? "mastery condition, evidence, retest, proof gate, fallback, and non-demotion boundary documented"
      : `missing ${missingBatch4Terms.join(", ")}`,
  });

  const requiredBatch5Terms = [
    "Batch 5 确认包",
    "model SimulationExam",
    "isFirstSynchronized Boolean @default(false)",
    "model SimulationSubjectResult",
    "@@unique([simulationExamId, subjectId])",
    "旧 `StudyTask.type = \"simulation_exam\"` 只读兼容",
    "不自动迁移",
    "不自动调整阶段计划",
    "不接真实 AI",
  ];
  const missingBatch5Terms = requiredBatch5Terms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package B Batch 5 confirmation packet",
    ok: missingBatch5Terms.length === 0,
    detail: missingBatch5Terms.length === 0
      ? "structured simulation exam, subject result uniqueness, legacy read-only fallback, and exclusions documented"
      : `missing ${missingBatch5Terms.join(", ")}`,
  });

  const requiredBatch6Terms = [
    "Batch 6 确认包",
    "model StagePlan",
    "mode String`：`recovery/strengthen/sprint/maintain",
    "model StageAdjustmentDraft",
    "source String`：`local_rule/ai",
    "canAutoApply Boolean @default(false)",
    "requiresUserConfirmation Boolean @default(true)",
    "用户显式确认前只保存草稿",
    "不自动重排任务",
    "不批量修改任务",
    "Package C 未确认前，长期阶段调整只能使用本地规则，不能真实 AI 外呼",
  ];
  const missingBatch6Terms = requiredBatch6Terms.filter((term) => !packets.includes(term));
  checks.push({
    name: "Package B Batch 6 confirmation packet",
    ok: missingBatch6Terms.length === 0,
    detail: missingBatch6Terms.length === 0
      ? "stage plan, confirm-only adjustment draft, local-rule boundary, and non-auto-apply exclusions documented"
      : `missing ${missingBatch6Terms.join(", ")}`,
  });

  const requiredBatchStatusTerms = [
    "## 批次状态",
    "Batch 0 验收标准",
    "Package B 总体验收标准",
    "Batch 0 完成时只更新 Package B Batch 0 证据",
    "Batch 0-6 已全部完成后，Package B 主状态可以在完成记录中标为完成",
  ];
  const missingBatchStatusTerms = requiredBatchStatusTerms.filter((term) => !task.includes(term));
  checks.push({
    name: "Package B task batch status",
    ok: missingBatchStatusTerms.length === 0,
    detail: missingBatchStatusTerms.length === 0
      ? "task tracks Batch 0-6 states and separates Batch 0 from package-wide acceptance"
      : `missing ${missingBatchStatusTerms.join(", ")}`,
  });

  const requiredBatch1PrepTerms = [
    "Batch 1 确认后实施切入点",
    "createStudyTask",
    "updateStudyTask",
    "completeStudyTask",
    "deferStudyTask",
    "dropStudyTask",
    "recoverStudyTask",
    "splitStudyTask",
    "convertStudyTaskToReview",
    "startStudySession",
    "endStudySession",
    "saveTodayReview",
    "getTodayDashboard",
    "getAnalyticsSummary",
    "getPeriodicReport",
    "active session",
    "不能把无快照历史日直接当作断签",
    "按学习日重算快照",
    "同一天重复调用必须幂等",
    "刷新旧计划日和新计划日",
    "同一事务后刷新对应学习日",
    "逐日混合快照和旧派生",
  ];
  const missingBatch1PrepTerms = requiredBatch1PrepTerms.filter((term) => !task.includes(term));
  checks.push({
    name: "Package B Batch 1 implementation prep",
    ok: missingBatch1PrepTerms.length === 0,
    detail: missingBatch1PrepTerms.length === 0
      ? "CheckIn write paths, read paths, active-session display, and historical fallback prep are documented"
      : `missing ${missingBatch1PrepTerms.join(", ")}`,
  });

  const hasCheckInSnapshotRule =
    coreRules.includes("buildDailyCheckInSnapshot") &&
    coreRules.includes("sourceVersion: 1") &&
    coreTests.includes("buildDailyCheckInSnapshot derives Batch 1 fields") &&
    coreTests.includes("historical low conversion fallback");
  checks.push({
    name: "Package B Batch 1 pure rule prep",
    ok: hasCheckInSnapshotRule,
    detail: hasCheckInSnapshotRule
      ? "core exposes and tests pure CheckIn snapshot aggregation before schema implementation"
      : "expected buildDailyCheckInSnapshot and low-conversion fallback tests in packages/core",
  });

  const requiredCheckInDocTerms = [
    "按学习日逐日混合",
    "不能把无快照历史日直接当作断签或 0 学习",
    "active session",
    "不能写入 `CheckIn`",
    "刷新旧计划日和新计划日",
    "同一天重复刷新必须幂等",
  ];
  const missingCheckInDocTerms = requiredCheckInDocTerms.filter((term) => !checkInDoc.includes(term));
  checks.push({
    name: "Package B CheckIn module contract",
    ok: missingCheckInDocTerms.length === 0,
    detail: missingCheckInDocTerms.length === 0
      ? "CheckIn module documents day-level fallback, active-session display, and idempotent refresh contract"
      : `missing ${missingCheckInDocTerms.join(", ")}`,
  });

  const requiredCompletionTerms = [
    "Package B 批次完成记录",
    "完成单个批次不等于 Package B 完成",
    "Batch 0：`StudySession` 收口字段",
    "不得把 Package B 主状态改成完成",
  ];
  const missingCompletionTerms = requiredCompletionTerms.filter((term) => !completionRecord.includes(term));
  checks.push({
    name: "Package B batch completion ledger",
    ok: missingCompletionTerms.length === 0,
    detail: missingCompletionTerms.length === 0
      ? "completion record has package-level and per-batch evidence separation"
      : `missing ${missingCompletionTerms.join(", ")}`,
  });

  const requiredValidationTerms = [
    "Package B Batch 0 专项验证",
    "Package B Batch 1 专项验证",
    "Package B Batch 2 专项验证",
    "Package B Batch 3 专项验证",
    "Package B Batch 4 专项验证",
    "Package B Batch 5 专项验证",
    "Package B Batch 6 专项验证",
    "确认前只允许做文档和护栏准备",
    "用户明确确认 Batch 0 后",
    "用户明确确认 Batch 1 后",
    "用户明确确认 Batch 2 后",
    "用户明确确认 Batch 3 后",
    "用户明确确认 Batch 4 后",
    "用户明确确认 Batch 5 后",
    "用户明确确认 Batch 6 后",
    "DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy",
    "允许 Batch 0 字段存在，继续阻止 Batch 1-6 未确认模型越界",
    "继续阻止 `model CheckIn` 在 schema 中出现",
    "active session 烟测",
    "prisma.checkIn` / `tx.checkIn",
    "继续阻止 `parentTaskId` 和 `model TaskDebtEvent`",
    "继续阻止 `model RecoveryState`",
    "继续阻止 `model MasteryConditionRecord`",
    "继续阻止 `model SimulationExam`",
    "继续阻止 `model StagePlan`",
  ];
  const missingValidationTerms = requiredValidationTerms.filter((term) => !validationMatrix.includes(term));
  checks.push({
    name: "Package B Batch 0-6 validation gates",
    ok: missingValidationTerms.length === 0,
    detail: missingValidationTerms.length === 0
      ? "validation matrix separates pre-confirmation checks from post-confirmation migration checks for Batch 0-6"
      : `missing ${missingValidationTerms.join(", ")}`,
  });
}

function checkMasteryProofBasicImplementation(): void {
  const schema = readIfExists("apps/web/lib/study/schemas.ts");
  const route = readIfExists("apps/web/app/api/syllabus/nodes/[id]/route.ts");
  const syllabusManager = readIfExists("apps/web/components/syllabus-manager.tsx");
  const service = readIfExists("apps/web/lib/study/syllabus-service.ts");
  const coreTests = readIfExists("packages/core/src/index.test.ts");
  const masteryDoc = readIfExists("docs/modules/mastery-proof.md");
  const traceability = readIfExists("docs/development/feature-traceability.md");
  const conditions = [
    "course_or_textbook",
    "own_explanation",
    "basic_exercise",
    "comprehensive_exercise",
    "mistake_reviewed",
    "delayed_retest",
  ];

  const missingSchemaTerms = [
    "updateSyllabusNodeSchema",
    "masteryConditions",
    ".max(6)",
    ...conditions,
  ].filter((term) => !schema.includes(term));
  checks.push({
    name: "mastery proof basic schema",
    ok: missingSchemaTerms.length === 0,
    detail: missingSchemaTerms.length === 0
      ? "PATCH schema accepts one-shot masteryConditions and enumerates the six basic conditions"
      : `missing ${missingSchemaTerms.join(", ")}`,
  });

  const missingRouteTerms = [
    "updateSyllabusNodeSchema.safeParse",
    "updateSyllabusNode(id, parsed.data, user.id)",
    "requireApiUser(request)",
  ].filter((term) => !route.includes(term));
  checks.push({
    name: "mastery proof basic PATCH route",
    ok: missingRouteTerms.length === 0,
    detail: missingRouteTerms.length === 0
      ? "syllabus node PATCH route stays authenticated and wired through schema/service"
      : `missing ${missingRouteTerms.join(", ")}`,
  });

  const missingUiTerms = [
    "type MasteryCondition",
    "masteryConditions: MasteryCondition[]",
    "const masteryConditionOptions",
    ...conditions,
    "function proveMastery",
    'status: "mastered"',
    "masteryLevel: targetMasteryLevel",
    "masteryConditions: selectedConditions",
    'type="checkbox"',
    "disabled={!canSubmitProof}",
    "保存证明",
  ].filter((term) => !syllabusManager.includes(term));
  checks.push({
    name: "mastery proof basic UI chain",
    ok: missingUiTerms.length === 0,
    detail: missingUiTerms.length === 0
      ? "/syllabus still exposes target level, condition checkboxes, evidence gating, and proof submit"
      : `missing ${missingUiTerms.join(", ")}`,
  });

  const missingServiceTerms = [
    "resolveMasteryProofRequest",
    "assertNodeCanMarkMastery",
    "input.masteryConditions ?? []",
    "MASTERY_PROOF_REQUIRED",
    "SYLLABUS_NODE_MASTERY_PROVED",
    "createMasteryAuditMetadata",
    "requestedLevel",
    "completedConditions",
    "evidence",
    "allowedLevel",
  ].filter((term) => !service.includes(term));
  checks.push({
    name: "mastery proof basic service gate",
    ok: missingServiceTerms.length === 0,
    detail: missingServiceTerms.length === 0
      ? "service still blocks insufficient proof and audits successful mastery proof summaries"
      : `missing ${missingServiceTerms.join(", ")}`,
  });

  const missingTestTerms = [
    "evaluateMasteryProof allows basic level with manual conditions and real evidence",
    "evaluateMasteryProof keeps manual conditions gated by evidence",
  ].filter((term) => !coreTests.includes(term));
  checks.push({
    name: "mastery proof basic core tests",
    ok: missingTestTerms.length === 0,
    detail: missingTestTerms.length === 0
      ? "core tests cover manual conditions and evidence-gated proof"
      : `missing ${missingTestTerms.join(", ")}`,
  });

  const missingDocTerms = [
    "知识点掌握证明基础版",
    "MASTERY_PROOF_REQUIRED",
    "AuditEvent",
    "Package B Batch 4",
    "MasteryConditionRecord",
    "MasteryEvidence",
    "MasteryRetest",
  ].filter((term) => !`${traceability}\n${masteryDoc}`.includes(term));
  checks.push({
    name: "mastery proof basic docs boundary",
    ok: missingDocTerms.length === 0,
    detail: missingDocTerms.length === 0
      ? "docs keep basic proof complete while explicit records remain gated to Batch 4"
      : `missing ${missingDocTerms.join(", ")}`,
  });
}

function checkProductionCompose(): void {
  const compose = readIfExists("docker-compose.prod.yml");
  const task = readIfExists("tasks/backlog/0014-deployment-backup-release.md");
  const runbook = readIfExists("docs/development/production-release-runbook.md");
  const backupRestore = readIfExists("docs/deployment/backup-restore.md");
  const webBlock = getComposeServiceBlock(compose, "web");
  const postgresBlock = getComposeServiceBlock(compose, "postgres");
  const webImageLine = findYamlKeyLine(webBlock, "image");
  const hasLocalWebBind = webBlock.includes("127.0.0.1:${WEB_PORT:-3000}:3000");
  const hasNoPostgresPort =
    postgresBlock.length > 0 &&
    !hasYamlKey(postgresBlock, "ports") &&
    !/^\s+network_mode:\s*host\s*$/m.test(stripYamlCommentLines(postgresBlock));
  const usesImageTag = Boolean(webImageLine?.includes("AREAFORGE_IMAGE")) && !Boolean(webImageLine?.includes(":latest"));
  const hasUploadsVolume = webBlock.includes("areaforge-uploads:/app/uploads") && compose.includes("areaforge-uploads:");
  const ok = hasLocalWebBind && hasNoPostgresPort && usesImageTag && hasUploadsVolume;
  checks.push({
    name: "Package E compose guardrails",
    ok,
    detail: ok
      ? "web binds localhost, postgres has no public port, image tag and uploads volume configured"
      : `localWeb=${hasLocalWebBind}; noPostgresPort=${hasNoPostgresPort}; fixedImage=${usesImageTag}; uploadsVolume=${hasUploadsVolume}`,
  });

  const requiredTaskPrepTerms = [
    "确认后实施切入点",
    "发布记录",
    "镜像 digest",
    "compose 文件 hash",
    "docker compose --env-file .env.example -f docker-compose.prod.yml config",
    "发布前备份",
    "PostgreSQL dump",
    "上传目录归档",
    "Migration deploy",
    "恢复演练",
    "临时库",
    "发布后烟测",
    "回滚记录",
    "网页内一键更新",
  ];
  const missingTaskPrepTerms = requiredTaskPrepTerms.filter((term) => !task.includes(term));
  checks.push({
    name: "Package E release prep",
    ok: missingTaskPrepTerms.length === 0,
    detail: missingTaskPrepTerms.length === 0
      ? "release record, backup, restore drill, smoke, rollback, and no-web-update prep are documented"
      : `missing ${missingTaskPrepTerms.join(", ")}`,
  });

  const requiredRunbookTerms = [
    "发布记录模板",
    "中止条件",
    "expectedFailureOrStopConditions",
    "docker compose --env-file .env.example -f docker-compose.prod.yml config",
    "AUTH_SESSION_SECRET is required",
    "required production env",
    "pg_dump",
    "pg_restore",
    "上传目录归档",
    "恢复演练",
    "回滚",
    "发布后烟测",
    "nginxConfigHash",
    "databaseBackupSha256",
    "uploadsBackupSha256",
    "恢复演练验收判定表",
  ];
  const releaseDocs = `${runbook}\n${backupRestore}`;
  const missingRunbookTerms = requiredRunbookTerms.filter((term) => !releaseDocs.includes(term));
  checks.push({
    name: "Package E runbook commands",
    ok: missingRunbookTerms.length === 0,
    detail: missingRunbookTerms.length === 0
      ? "release, backup, restore, smoke, and rollback command templates are documented"
      : `missing ${missingRunbookTerms.join(", ")}`,
  });

  const apiFiles = listFiles("apps/web/app/api").filter((file) => file.endsWith("/route.ts"));
  const forbiddenOpsRouteFiles = apiFiles.filter((file) => {
    const normalized = file.replaceAll(path.sep, "/").toLowerCase();
    const content = readIfExists(file).toLowerCase();
    return ["deploy", "backup", "restore", "migration", "migrate"].some((term) =>
      normalized.includes(term) || content.includes(term),
    );
  });
  checks.push({
    name: "Package E no web ops route boundary",
    ok: forbiddenOpsRouteFiles.length === 0,
    detail: forbiddenOpsRouteFiles.length === 0
      ? "no web API route can trigger deploy, backup, restore, or migration before confirmation"
      : `found web ops route risk before confirmation: ${forbiddenOpsRouteFiles.join(", ")}`,
  });
}

function getComposeServiceBlock(compose: string, serviceName: string): string {
  const lines = stripYamlCommentLines(compose).split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start < 0) return "";

  const end = lines.findIndex((line, index) => index > start && /^  [a-zA-Z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

function checkPackageBBatchBoundaries(): void {
  const schema = readIfExists("prisma/schema.prisma");
  const completionRecord = readIfExists("docs/development/docs-100-completion-record.md");
  const migrationFiles = listFiles("prisma/migrations").filter((file) => file.endsWith(".sql"));
  const migrations = migrationFiles.map((file) => ({
    file,
    content: readIfExists(file),
  }));
  const batch0Fields = [
    "understandingLevel",
    "minimalOutput",
    "nextAction",
    "producedNote",
    "producedMistake",
    "isLowConversion",
    "antiFakeReason",
    "requiredOutput",
    "closeoutVersion",
  ];
  const missingBatch0Fields = batch0Fields.filter((field) => !schema.includes(field));
  checks.push({
    name: "Package B Batch 0 implementation evidence",
    ok: missingBatch0Fields.length === 0,
    detail: missingBatch0Fields.length === 0
      ? "StudySession structured closeout fields are present after Batch 0 confirmation"
      : `missing Batch 0 fields after confirmation: ${missingBatch0Fields.join(", ")}`,
  });

  const remainingBatchModels = [
    {
      batch: 1,
      label: "CheckIn 日快照",
      tokens: ["model CheckIn"],
      migrationTokens: ['"CheckIn"', "CheckIn"],
    },
    {
      batch: 2,
      label: "债务事件与父子任务",
      tokens: ["parentTaskId", "model TaskDebtEvent"],
      migrationTokens: ['"parentTaskId"', '"TaskDebtEvent"', "TaskDebtEvent"],
    },
    {
      batch: 3,
      label: "RecoveryState",
      tokens: ["model RecoveryState"],
      migrationTokens: ['"RecoveryState"', "RecoveryState"],
    },
    {
      batch: 4,
      label: "掌握证明证据",
      tokens: ["model MasteryConditionRecord", "model MasteryEvidence", "model MasteryRetest"],
      migrationTokens: [
        '"MasteryConditionRecord"',
        '"MasteryEvidence"',
        '"MasteryRetest"',
        "MasteryConditionRecord",
        "MasteryEvidence",
        "MasteryRetest",
      ],
    },
    {
      batch: 5,
      label: "结构化模拟考试",
      tokens: ["model SimulationExam", "model SimulationSubjectResult"],
      migrationTokens: ['"SimulationExam"', '"SimulationSubjectResult"', "SimulationExam", "SimulationSubjectResult"],
    },
    {
      batch: 6,
      label: "阶段计划与调整草稿",
      tokens: ["model StagePlan", "model StageAdjustmentDraft"],
      migrationTokens: ['"StagePlan"', '"StageAdjustmentDraft"', "StagePlan", "StageAdjustmentDraft"],
    },
  ];

  const stillGatedModels: string[] = [];
  const stillGatedMigrationTokens: Array<{ batch: number; token: string }> = [];
  for (const batch of remainingBatchModels) {
    const done = isPackageBBatchDone(completionRecord, batch.batch);
    const missing = done ? batch.tokens.filter((token) => !schema.includes(token)) : [];
    checks.push({
      name: `Package B Batch ${batch.batch} implementation evidence`,
      ok: missing.length === 0,
      detail: !done
        ? `Batch ${batch.batch} is not marked done, so ${batch.label} remains gated behind confirmation`
        : missing.length === 0
          ? `Batch ${batch.batch} schema tokens are present after completion record`
          : `Batch ${batch.batch} is marked done but missing ${missing.join(", ")}`,
    });

    if (!done) {
      stillGatedModels.push(...batch.tokens);
      stillGatedMigrationTokens.push(...batch.migrationTokens.map((token) => ({ batch: batch.batch, token })));
    }
  }

  const present = stillGatedModels.filter((model) => schema.includes(model));
  const migrationPresent = stillGatedMigrationTokens.flatMap((signal) =>
    migrations
      .filter((migration) => migration.content.includes(signal.token))
      .map((migration) => `Batch ${signal.batch} ${signal.token} in ${migration.file}`),
  );
  const firstOpenBatch = remainingBatchModels.find((batch) => !isPackageBBatchDone(completionRecord, batch.batch));
  const gatedDetail = firstOpenBatch
    ? `Batch ${firstOpenBatch.batch}-6 structured models remain gated behind later confirmation`
    : "all Batch 1-6 schema tokens are present according to completion record";
  checks.push({
    name: "Package B remaining implementation boundary",
    ok: present.length === 0 && migrationPresent.length === 0,
    detail: present.length === 0 && migrationPresent.length === 0
      ? gatedDetail
      : `found later-package schema/migration tokens before confirmation: ${[...present, ...migrationPresent].join(", ")}`,
  });

  const batch1Done = isPackageBBatchDone(completionRecord, 1);
  const checkInRuntimeFiles = [
    ...listFiles("apps/web/lib/study"),
    ...listFiles("apps/web/app/api"),
  ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const prematureCheckInRuntime = checkInRuntimeFiles.filter((file) => {
    const content = readIfExists(file);
    return content.includes("prisma.checkIn") || content.includes("tx.checkIn");
  });
  checks.push({
    name: "Package B Batch 1 CheckIn runtime boundary",
    ok: batch1Done || prematureCheckInRuntime.length === 0,
    detail: batch1Done
      ? "Batch 1 is marked done, so CheckIn runtime paths are allowed and covered by package evidence"
      : prematureCheckInRuntime.length === 0
        ? "no Prisma CheckIn read/write path exists before Batch 1 confirmation"
        : `found CheckIn runtime path before Batch 1 confirmation: ${prematureCheckInRuntime.join(", ")}`,
  });

  const batch3Done = isPackageBBatchDone(completionRecord, 3);
  const recoveryRuntimeFiles = [
    ...listFiles("apps/web/lib/study"),
    ...listFiles("apps/web/app/api"),
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/components"),
  ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const prematureRecoveryRuntime = recoveryRuntimeFiles.filter((file) => {
    const content = readIfExists(file);
    return (
      content.includes("prisma.recoveryState")
      || content.includes("tx.recoveryState")
      || content.includes("/api/recovery-states")
      || content.includes("RecoveryStateControls")
    );
  });
  const recoveryService = readIfExists("apps/web/lib/study/service.ts");
  const recoveryTypes = readIfExists("apps/web/lib/study/types.ts");
  const recoverySchemas = readIfExists("apps/web/lib/study/schemas.ts");
  const dashboardRoute = readIfExists("apps/web/app/api/dashboard/today/route.ts");
  const homePage = readIfExists("apps/web/app/page.tsx");
  const batch3RuntimeSignals = [
    {
      label: "RecoveryState additive migration",
      ok: migrations.some((migration) =>
        migration.file.includes("add_recovery_state") && migration.content.includes('"RecoveryState"'),
      ),
    },
    {
      label: "service RecoveryState read/write helpers",
      ok: [
        "createRuleRecoveryState",
        "startManualRecoveryState",
        "completeRecoveryState",
        "cancelRecoveryState",
        "findActiveRecoveryState",
      ].every((token) => recoveryService.includes(token)),
    },
    {
      label: "dashboard records rule trigger explicitly",
      ok: dashboardRoute.includes("recordRecoveryRule: true") && homePage.includes("recordRecoveryRule: true"),
    },
    {
      label: "RecoveryState DTO exposes source and state fields",
      ok: ["RecoverySourceDto", "RecoveryStateDto", "stateId", "triggerType"].every((token) =>
        recoveryTypes.includes(token),
      ),
    },
    {
      label: "RecoveryState schemas and API routes",
      ok: recoverySchemas.includes("startManualRecoveryStateSchema")
        && recoverySchemas.includes("finishRecoveryStateSchema")
        && fileExists("apps/web/app/api/recovery-states/manual/route.ts")
        && fileExists("apps/web/app/api/recovery-states/[id]/complete/route.ts")
        && fileExists("apps/web/app/api/recovery-states/[id]/cancel/route.ts"),
    },
    {
      label: "homepage recovery controls preserve full task panel",
      ok: fileExists("apps/web/components/recovery-state-controls.tsx")
        && homePage.includes("tasks={dashboard.tasks}")
        && homePage.includes("tasks={focusTasks}"),
    },
  ];
  const missingBatch3Signals = batch3RuntimeSignals.filter((signal) => !signal.ok).map((signal) => signal.label);
  checks.push({
    name: "Package B Batch 3 RecoveryState runtime boundary",
    ok: batch3Done ? missingBatch3Signals.length === 0 : prematureRecoveryRuntime.length === 0,
    detail: batch3Done
      ? missingBatch3Signals.length === 0
        ? "Batch 3 RecoveryState migration, service, API, DTO, and homepage controls are present"
        : `Batch 3 is marked done but missing ${missingBatch3Signals.join(", ")}`
      : prematureRecoveryRuntime.length === 0
        ? "no RecoveryState runtime path exists before Batch 3 completion"
        : `found RecoveryState runtime path before Batch 3 completion: ${prematureRecoveryRuntime.join(", ")}`,
  });

  const batch4Done = isPackageBBatchDone(completionRecord, 4);
  const masteryRuntimeFiles = [
    ...listFiles("apps/web/lib/study"),
    ...listFiles("apps/web/app/api"),
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/components"),
  ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const prematureMasteryRuntime = masteryRuntimeFiles.filter((file) => {
    const content = readIfExists(file);
    return [
      "prisma.masteryConditionRecord",
      "tx.masteryConditionRecord",
      "prisma.masteryEvidence",
      "tx.masteryEvidence",
      "prisma.masteryRetest",
      "tx.masteryRetest",
      "/mastery-evidence",
      "/mastery-retests",
      "MasteryConditionRecordDto",
      "MasteryEvidenceDto",
      "MasteryRetestDto",
    ].some((token) => content.includes(token));
  });
  const syllabusService = readIfExists("apps/web/lib/study/syllabus-service.ts");
  const syllabusTypes = readIfExists("apps/web/lib/study/types.ts");
  const syllabusSchemas = readIfExists("apps/web/lib/study/schemas.ts");
  const syllabusManager = readIfExists("apps/web/components/syllabus-manager.tsx");
  const batch4RuntimeSignals = [
    {
      label: "Mastery additive migration",
      ok: migrations.some((migration) =>
        migration.file.includes("add_mastery")
        && migration.content.includes('"MasteryConditionRecord"')
        && migration.content.includes('"MasteryEvidence"')
        && migration.content.includes('"MasteryRetest"'),
      ),
    },
    {
      label: "Mastery schema fields and unique condition key",
      ok: [
        "@@unique([syllabusNodeId, condition])",
        "evidenceType",
        "testedAt",
        "result",
        "nextReviewAt",
        "actorId",
      ].every((token) => schema.includes(token)),
    },
    {
      label: "service explicit mastery records and fallback",
      ok: [
        "masteryConditionRecord",
        "masteryEvidence",
        "masteryRetest",
        "evaluateMasteryProof",
        "_count",
        "failed",
        "partial",
        "actorId",
      ].every((token) => syllabusService.includes(token)),
    },
    {
      label: "Mastery DTO exposes condition evidence and retest records",
      ok: ["MasteryConditionRecordDto", "MasteryEvidenceDto", "MasteryRetestDto"].every((token) =>
        syllabusTypes.includes(token),
      ),
    },
    {
      label: "Mastery schemas and API routes",
      ok: syllabusSchemas.includes("masteryEvidence")
        && syllabusSchemas.includes("masteryRetest")
        && apiRouteContains("apps/web/app/api/syllabus/nodes/[id]/mastery-evidence/route.ts", ["requireApiUser"])
        && apiRouteContains("apps/web/app/api/syllabus/nodes/[id]/mastery-retests/route.ts", ["requireApiUser"]),
    },
    {
      label: "syllabus UI persists mastery records",
      ok: ["masteryEvidence", "masteryRetests", "/mastery-evidence", "/mastery-retests"].every((token) =>
        syllabusManager.includes(token),
      ),
    },
  ];
  const missingBatch4Signals = batch4RuntimeSignals.filter((signal) => !signal.ok).map((signal) => signal.label);
  checks.push({
    name: "Package B Batch 4 mastery records runtime boundary",
    ok: batch4Done ? missingBatch4Signals.length === 0 : prematureMasteryRuntime.length === 0,
    detail: batch4Done
      ? missingBatch4Signals.length === 0
        ? "Batch 4 mastery condition, evidence, retest migration, service, API, DTO, and UI evidence are present"
        : `Batch 4 is marked done but missing ${missingBatch4Signals.join(", ")}`
      : prematureMasteryRuntime.length === 0
        ? "no explicit mastery record runtime path exists before Batch 4 completion"
        : `found explicit mastery record runtime path before Batch 4 completion: ${prematureMasteryRuntime.join(", ")}`,
  });

  const batch5Done = isPackageBBatchDone(completionRecord, 5);
  const simulationRuntimeFiles = [
    ...listFiles("apps/web/lib/study"),
    ...listFiles("apps/web/app/api"),
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/components"),
  ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const prematureSimulationRuntime = simulationRuntimeFiles.filter((file) => {
    const content = readIfExists(file);
    return [
      "prisma.simulationExam",
      "tx.simulationExam",
      "prisma.simulationSubjectResult",
      "tx.simulationSubjectResult",
      "/api/simulation/exams",
      "SimulationExamDto",
      "SimulationSubjectResultDto",
    ].some((token) => content.includes(token));
  });
  const studyRuntimeTextForBatchB = listFiles("apps/web/lib/study")
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readIfExists(file))
    .join("\n");
  const simulationService = readIfExists("apps/web/lib/study/simulation-service.ts");
  const studyTypes = readIfExists("apps/web/lib/study/types.ts");
  const studySchemas = readIfExists("apps/web/lib/study/schemas.ts");
  const simulationWorkbench = readIfExists("apps/web/components/simulation-workbench.tsx");
  const simulationPage = readIfExists("apps/web/app/simulation/page.tsx");
  const batch5RuntimeSignals = [
    {
      label: "SimulationExam additive migration",
      ok: migrations.some((migration) =>
        migration.content.includes('"SimulationExam"')
        && migration.content.includes('"SimulationSubjectResult"'),
      ),
    },
    {
      label: "Simulation schema fields and subject uniqueness",
      ok: [
        "model SimulationExam",
        "model SimulationSubjectResult",
        "isFirstSynchronized",
        "targetDurationMinutes",
        "actualDurationMinutes",
        "blankQuestionCount",
        "lossReasons",
        "@@unique([simulationExamId, subjectId])",
      ].every((token) => schema.includes(token)),
    },
    {
      label: "simulation service structured records and legacy fallback",
      ok: [
        "simulationExam",
        "simulationSubjectResult",
        "summarizeSimulationResult",
        'type: "simulation_exam"',
        "StudyTask",
      ].every((token) => studyRuntimeTextForBatchB.includes(token)),
    },
    {
      label: "Simulation DTO exposes exam and subject result records",
      ok: ["SimulationExamDto", "SimulationSubjectResultDto"].every((token) =>
        `${studyTypes}\n${studyRuntimeTextForBatchB}`.includes(token),
      ),
    },
    {
      label: "Simulation schemas and authenticated exam API routes",
      ok: studySchemas.includes("simulationExam")
        && studySchemas.includes("simulationSubjectResult")
        && apiRouteContains("apps/web/app/api/simulation/exams/route.ts", ["requireApiUser"])
        && apiRouteContains("apps/web/app/api/simulation/exams/[id]/results/route.ts", ["requireApiUser"]),
    },
    {
      label: "simulation UI prefers structured exams while preserving page",
      ok: `${simulationWorkbench}\n${simulationPage}`.includes("/api/simulation/exams"),
    },
  ];
  const missingBatch5Signals = batch5RuntimeSignals.filter((signal) => !signal.ok).map((signal) => signal.label);
  checks.push({
    name: "Package B Batch 5 structured simulation runtime boundary",
    ok: batch5Done ? missingBatch5Signals.length === 0 : prematureSimulationRuntime.length === 0,
    detail: batch5Done
      ? missingBatch5Signals.length === 0
        ? "Batch 5 SimulationExam migration, service, API, DTO, UI, and legacy fallback evidence are present"
        : `Batch 5 is marked done but missing ${missingBatch5Signals.join(", ")}`
      : prematureSimulationRuntime.length === 0
        ? "no structured simulation exam runtime path exists before Batch 5 completion"
        : `found structured simulation runtime path before Batch 5 completion: ${prematureSimulationRuntime.join(", ")}`,
  });

  const batch6Done = isPackageBBatchDone(completionRecord, 6);
  const stageRuntimeFiles = [
    ...listFiles("apps/web/lib/study"),
    ...listFiles("apps/web/app/api"),
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/components"),
  ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const prematureStageRuntime = stageRuntimeFiles.filter((file) => {
    const content = readIfExists(file);
    return [
      "prisma.stagePlan",
      "tx.stagePlan",
      "prisma.stageAdjustmentDraft",
      "tx.stageAdjustmentDraft",
      "/api/simulation/stage-plans",
      "/api/simulation/stage-adjustment-drafts",
      "StagePlanDto",
      "PersistentStageAdjustmentDraftDto",
    ].some((token) => content.includes(token));
  });
  const reportsService = readIfExists("apps/web/lib/study/reports-service.ts");
  const reportsPage = readIfExists("apps/web/app/reports/page.tsx");
  const batch6RuntimeSignals = [
    {
      label: "StagePlan additive migration",
      ok: migrations.some((migration) =>
        migration.content.includes('"StagePlan"')
        && migration.content.includes('"StageAdjustmentDraft"'),
      ),
    },
    {
      label: "Stage schema fields and confirmation defaults",
      ok: [
        "model StagePlan",
        "model StageAdjustmentDraft",
        "taskAdjustmentActions",
        "nextStageEmphasis",
        "appliedAt",
        "actorId",
      ].every((token) => schema.includes(token)) &&
        /canAutoApply\s+Boolean\s+@default\(false\)/.test(schema) &&
        /requiresUserConfirmation\s+Boolean\s+@default\(true\)/.test(schema),
    },
    {
      label: "stage service persists plans and confirm-only drafts",
      ok: [
        "stagePlan",
        "stageAdjustmentDraft",
        "draftStageAdjustment",
        "canAutoApply: false",
        "requiresUserConfirmation: true",
        "AuditEvent",
      ].every((token) => studyRuntimeTextForBatchB.includes(token)),
    },
    {
      label: "Stage DTO exposes persisted plan and draft records",
      ok: ["StagePlanDto"].every((token) => `${studyTypes}\n${studyRuntimeTextForBatchB}`.includes(token)) &&
        (
          `${studyTypes}\n${studyRuntimeTextForBatchB}`.includes("PersistentStageAdjustmentDraftDto") ||
          `${studyTypes}\n${studyRuntimeTextForBatchB}`.includes("StageAdjustmentDraftRecordDto")
        ),
    },
    {
      label: "Stage schemas and authenticated plan/draft routes",
      ok: studySchemas.includes("stagePlan")
        && studySchemas.includes("stageAdjustmentDraft")
        && apiRouteContains("apps/web/app/api/simulation/stage-plans/route.ts", ["requireApiUser"])
        && apiRouteContains("apps/web/app/api/simulation/stage-adjustment-drafts/route.ts", ["requireApiUser"])
        && apiRouteContains("apps/web/app/api/simulation/stage-adjustment-drafts/[id]/confirm/route.ts", ["requireApiUser"])
        && apiRouteContains("apps/web/app/api/simulation/stage-adjustment-drafts/[id]/reject/route.ts", ["requireApiUser"]),
    },
    {
      label: "simulation and reports UI expose persisted stage boundaries",
      ok: [
        "/api/simulation/stage-plans",
        "/api/simulation/stage-adjustment-drafts",
        "requiresUserConfirmation",
        "canAutoApply",
      ].every((token) => `${simulationWorkbench}\n${simulationPage}\n${reportsService}\n${reportsPage}`.includes(token)),
    },
  ];
  const missingBatch6Signals = batch6RuntimeSignals.filter((signal) => !signal.ok).map((signal) => signal.label);
  checks.push({
    name: "Package B Batch 6 stage plan runtime boundary",
    ok: batch6Done ? missingBatch6Signals.length === 0 : prematureStageRuntime.length === 0,
    detail: batch6Done
      ? missingBatch6Signals.length === 0
        ? "Batch 6 StagePlan migration, service, API, DTO, UI, and confirmation boundary evidence are present"
        : `Batch 6 is marked done but missing ${missingBatch6Signals.join(", ")}`
      : prematureStageRuntime.length === 0
        ? "no persisted stage plan runtime path exists before Batch 6 completion"
        : `found persisted stage plan runtime path before Batch 6 completion: ${prematureStageRuntime.join(", ")}`,
  });
}

function checkAttachmentStillBeforePackageA(): void {
  const completionRecord = readIfExists("docs/development/docs-100-completion-record.md");
  const packageAConfirmed = isPackageConfirmedOrDone(completionRecord, "Package A");
  const apiRouteFiles = listFiles("apps/web/app/api").filter((file) => file.endsWith("/route.ts"));
  const attachmentRouteFiles = apiRouteFiles.filter((file) => {
    const normalized = file.replaceAll(path.sep, "/").toLowerCase();
    return normalized.includes("/attachments/") || normalized.includes("/attachment/") || normalized.includes("/upload");
  });
  const webStudyLibFiles = listFiles("apps/web/lib/study").filter((file) => file.endsWith(".ts"));
  const webRuntimeFiles = [
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/components"),
    ...listFiles("apps/web/lib"),
  ].filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const attachmentServiceFiles = webStudyLibFiles.filter((file) => {
    const normalized = file.replaceAll(path.sep, "/").toLowerCase();
    return normalized.includes("attachment") || normalized.includes("upload");
  });
  const webAttachmentIoFiles = webRuntimeFiles.filter((file) => {
    const content = readIfExists(file);
    const normalized = file.replaceAll(path.sep, "/").toLowerCase();
    const isAttachmentScope = normalized.includes("attachment") ||
      normalized.includes("upload") ||
      content.includes("Attachment") ||
      content.includes("attachment") ||
      content.includes("UPLOAD_DIR") ||
      content.includes("upload://attachment");
    const ioTokens = [
      "UPLOAD_DIR",
      "writeFile",
      "mkdir",
      "createWriteStream",
      "readFile",
      "stat(",
      "unlink(",
      "rename(",
    ];
    return isAttachmentScope && ioTokens.some((token) => content.includes(token));
  });
  const present = [...attachmentRouteFiles, ...attachmentServiceFiles, ...webAttachmentIoFiles];
  checks.push({
    name: "Package A implementation boundary",
    ok: packageAConfirmed ? hasPackageAImplementationEvidence() : present.length === 0,
    detail: packageAConfirmed
      ? hasPackageAImplementationEvidence()
        ? "confirmed Package A upload/download route handlers, service, UI, and web upload IO are present"
        : "Package A is confirmed or done but upload/download implementation evidence is incomplete"
      : present.length === 0
        ? "upload/download route handlers, attachment services, and web upload IO remain gated behind confirmation"
        : `found upload/download implementation before confirmation: ${Array.from(new Set(present)).join(", ")}`,
  });

  const forbiddenPublicUploadDirs = [
    "apps/web/public/uploads",
    "apps/web/public/attachments",
    "apps/web/public/files",
  ];
  const publicTree = listFiles("apps/web/public");
  const publicDirs = forbiddenPublicUploadDirs.filter((directory) => existsSync(resolve(directory)));
  const publicUploadFiles = publicTree.filter((file) => {
    const normalized = file.replaceAll(path.sep, "/").toLowerCase();
    return normalized.includes("/uploads/") || normalized.includes("/attachments/") || normalized.includes("/files/");
  });
  const publicExposure = [...publicDirs, ...publicUploadFiles];
  checks.push({
    name: "Package A public exposure boundary",
    ok: publicExposure.length === 0,
    detail: publicExposure.length === 0
      ? packageAConfirmed
        ? "no public upload or attachment directories/files exist after Package A implementation"
        : "no public upload or attachment directories/files exist before Package A confirmation"
      : `found publicly exposable upload paths: ${Array.from(new Set(publicExposure)).join(", ")}`,
  });

  const uiFiles = [...listFiles("apps/web/app"), ...listFiles("apps/web/components")].filter((file) =>
    file.endsWith(".ts") || file.endsWith(".tsx"),
  );
  const internalUriLinks = uiFiles.filter((file) => {
    const content = readIfExists(file);
    return content.includes("attachment.uri") ||
      content.includes("upload://attachment") ||
      /href=\{[^}]*\.uri[^}]*\}/.test(content);
  });
  const prematureDownloadLinks = packageAConfirmed
    ? []
    : uiFiles.filter((file) => {
      const content = readIfExists(file);
      return /href=\{[^}]*downloadApiPath[^}]*\}/.test(content) ||
        content.includes("/api/attachments/");
    });
  const directUriLinks = [...internalUriLinks, ...prematureDownloadLinks];
  checks.push({
    name: "Package A attachment direct-link boundary",
    ok: directUriLinks.length === 0,
    detail: directUriLinks.length === 0
      ? packageAConfirmed
        ? "UI only exposes authenticated downloadApiPath and no internal attachment uri metadata"
        : "UI does not expose attachment.uri, upload://attachment, or premature download URLs"
      : `found attachment direct link risk: ${directUriLinks.join(", ")}`,
  });

  const prematureUploadUiFiles = uiFiles.filter((file) => {
    const content = readIfExists(file);
    const attachmentScope = content.toLowerCase().includes("attachment") ||
      content.includes("附件") ||
      content.includes("/api/attachments") ||
      content.includes("upload://attachment");
    return attachmentScope && (
      content.includes('type="file"') ||
      content.includes("multipart/form-data") ||
      content.includes("new FormData") ||
      /fetch\([^)]*\/api\/attachments/.test(content)
    );
  });
  checks.push({
    name: "Package A premature upload UI boundary",
    ok: packageAConfirmed ? prematureUploadUiFiles.length > 0 : prematureUploadUiFiles.length === 0,
    detail: packageAConfirmed
      ? prematureUploadUiFiles.length > 0
        ? "confirmed Package A UI exposes file input and multipart upload flow"
        : "Package A is confirmed or done but attachment upload UI is missing"
      : prematureUploadUiFiles.length === 0
        ? "UI has no attachment file inputs, multipart upload calls, or premature attachment API hrefs before confirmation"
        : `found premature attachment upload UI/API surface: ${prematureUploadUiFiles.join(", ")}`,
  });

  const dtoText = [
    readIfExists("apps/web/lib/study/types.ts"),
    readIfExists("apps/web/lib/study/notes-service.ts"),
  ].join("\n");
  const dtoLeaksUri = dtoText.includes("uri: string;") || dtoText.includes("uri: attachment.uri");
  const dtoHasDownloadPath = dtoText.includes("downloadApiPath");
  checks.push({
    name: "Package A attachment DTO boundary",
    ok: !dtoLeaksUri && dtoHasDownloadPath,
    detail: !dtoLeaksUri && dtoHasDownloadPath
      ? "attachment DTO exposes a future API path and does not leak internal uri metadata"
      : "attachment DTO should expose downloadApiPath and omit internal uri metadata",
  });
}

function hasPackageAImplementationEvidence(): boolean {
  const uploadRoute = readIfExists("apps/web/app/api/notes/[noteId]/attachments/route.ts");
  const downloadRoute = readIfExists("apps/web/app/api/attachments/[id]/route.ts");
  const service = readIfExists("apps/web/lib/study/attachments-service.ts");
  const ui = readIfExists("apps/web/components/note-library.tsx");

  return [
    "requireApiUser",
    "formData",
    "ATTACHMENT_MULTIPLE_FILES",
    "createNoteAttachment",
  ].every((token) => uploadRoute.includes(token)) &&
    ["requireApiUser", "getAttachmentDownload", "ATTACHMENT_INVALID_DISPOSITION"].every((token) =>
      downloadRoute.includes(token),
    ) &&
    [
      "UPLOAD_DIR",
      "writeFile",
      "readFile",
      "createAttachmentMetadataDraft",
      "createAttachmentResponseHeaders",
      "ATTACHMENT_METADATA_WRITE_FAILED",
      "ATTACHMENT_FILE_MISMATCH",
      "removeBestEffort",
    ].every((token) => service.includes(token)) &&
    ["type=\"file\"", "new FormData", "downloadApiPath", "/api/notes/"].every((token) =>
      ui.includes(token),
    );
}

function checkAiStillBeforePackageC(): void {
  const ai = readIfExists("packages/ai/src/index.ts");
  const webAiService = readIfExists("apps/web/lib/study/ai-service.ts");
  const homePage = readIfExists("apps/web/app/page.tsx");
  const schema = readIfExists("prisma/schema.prisma");
  const aiDesign = readIfExists("docs/development/ai-provider-integration-design.md");
  const envExample = readIfExists(".env.example");
  const config = readIfExists("packages/config/src/index.ts");
  const aiRouteFiles = [
    "apps/web/app/api/ai/discipline/route.ts",
    "apps/web/app/api/ai/daily-review/route.ts",
    "apps/web/app/api/ai/tomorrow-plan/route.ts",
  ];
  const externalProviderTokens = [
    "fetch(",
    "chat/completions",
    "responses",
    "AI_ENABLED",
    "AI_BASE_URL",
    "AI_API_KEY",
  ];
  const aiMatches = externalProviderTokens.filter((token) => ai.includes(token));
  const webMatches = [
    "AI_ENABLED",
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_MODEL",
    "AI_TIMEOUT_MS",
    "AI_MAX_RETRIES",
    "AI_LOG_PROMPTS",
    "AI_ALLOW_SENSITIVE_CONTEXT",
  ].filter((token) => webAiService.includes(token));
  const matches = [...aiMatches.map((token) => `packages/ai:${token}`), ...webMatches.map((token) => `web-ai-service:${token}`)];
  checks.push({
    name: "Package C implementation boundary",
    ok: matches.length === 0,
    detail: matches.length === 0
      ? "real AI provider wiring remains gated behind confirmation"
      : `found real provider tokens before confirmation: ${matches.join(", ")}`,
  });

  const webProviderTerms = [
    "provider:",
    "createConfiguredAiProvider",
    "createOpenAiCompatibleJsonProvider",
    "AI_ENABLED",
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_MODEL",
  ];
  const providerTerms = webProviderTerms.filter((term) => webAiService.includes(term));
  checks.push({
    name: "Package C web provider boundary",
    ok: providerTerms.length === 0,
    detail: providerTerms.length === 0
      ? "web AI service still omits provider wiring and env key reads"
      : `found provider wiring before confirmation: ${providerTerms.join(", ")}`,
  });

  const forbiddenContextTerms = [
    "whyStarted",
    "neverReturnTo",
    "futureSelf",
    "messageToFuture",
    "firstSimulationDiary",
    "summary:",
    "lostControl",
    "keepAction",
    "tomorrowMinimum",
    "reviewText",
    "reviewBody",
    "moodText",
    "emotionText",
    "attachment",
    "pdfContent",
    "imageContent",
    "filePath",
    "uploadDir",
  ];
  const sensitiveContextTerms = forbiddenContextTerms.filter((term) => webAiService.includes(term));
  checks.push({
    name: "Package C minimized web contexts",
    ok: sensitiveContextTerms.length === 0,
    detail: sensitiveContextTerms.length === 0
      ? "web AI contexts remain aggregate-only and exclude private body fields"
      : `found sensitive context fields before confirmation: ${sensitiveContextTerms.join(", ")}`,
  });

  const homepageCallsAi = homePage.includes("getDailyReviewAiAdvice") || homePage.includes("getTomorrowPlanAiAdvice");
  const homepageExternalRisk = homepageCallsAi && providerTerms.length > 0;
  checks.push({
    name: "Package C homepage cost boundary",
    ok: !homepageExternalRisk,
    detail: homepageCallsAi
      ? "homepage may render local AI fallback, but provider wiring remains disabled"
      : "homepage does not request AI advice during render",
  });

  const requiredCostAndPrivacyTerms = [
    "client bundle key scan command",
    "NEXT_PUBLIC_",
    "topTaskTitle redaction",
    "task title may contain private content",
    "homepage local fallback only",
    "explicit trigger only",
    "cache or rate limit required",
    "真实 provider 第一版默认不发送原始任务标题",
    "AI_LOG_PROMPTS=false",
    "AI_ALLOW_SENSITIVE_CONTEXT=false",
    "allowSensitiveContext disabled before Package C",
    "model AiCall",
    "model AiUsage",
    "tokenUsage",
    "promptHash",
  ];
  const missingCostAndPrivacyTerms = requiredCostAndPrivacyTerms.filter((term) => !aiDesign.includes(term));
  checks.push({
    name: "Package C cost and privacy prep",
    ok: missingCostAndPrivacyTerms.length === 0,
    detail: missingCostAndPrivacyTerms.length === 0
      ? "AI design documents client key scan, homepage cost decision, title redaction, disabled sensitive logging, and no AI usage schema"
      : `missing ${missingCostAndPrivacyTerms.join(", ")}`,
  });

  const forbiddenPublicAiEnv = ["NEXT_PUBLIC_AI", "NEXT_PUBLIC_OPENAI", "NEXT_PUBLIC_SUB2API"].filter((term) =>
    `${envExample}\n${config}\n${webAiService}`.includes(term),
  );
  checks.push({
    name: "Package C public client env boundary",
    ok: forbiddenPublicAiEnv.length === 0,
    detail: forbiddenPublicAiEnv.length === 0
      ? "no NEXT_PUBLIC AI key/base/model env surface exists before confirmation"
      : `found public AI env surface before confirmation: ${forbiddenPublicAiEnv.join(", ")}`,
  });

  const unsafeAiConfig = ["AI_LOG_PROMPTS=true", "AI_ALLOW_SENSITIVE_CONTEXT=true"].filter((term) => envExample.includes(term));
  const missingSafeConfigDefaults = ["AI_LOG_PROMPTS=false", "AI_ALLOW_SENSITIVE_CONTEXT=false"].filter((term) => !envExample.includes(term));
  const missingConfigSchemaDefaults = [
    "AI_LOG_PROMPTS: booleanFromString.default(false)",
    "AI_ALLOW_SENSITIVE_CONTEXT: booleanFromString.default(false)",
  ].filter((term) => !config.includes(term));
  const aiConfigProblems = [...unsafeAiConfig, ...missingSafeConfigDefaults, ...missingConfigSchemaDefaults];
  checks.push({
    name: "Package C sensitive logging defaults",
    ok: aiConfigProblems.length === 0,
    detail: aiConfigProblems.length === 0
      ? "AI_LOG_PROMPTS and AI_ALLOW_SENSITIVE_CONTEXT stay false by default before confirmation"
      : `AI sensitive logging config issue: ${aiConfigProblems.join(", ")}`,
  });

  const unsafeAiRoutes = aiRouteFiles.filter((file) => {
    const route = readIfExists(file);
    const hasOnlyPost = route.includes("export async function POST") &&
      !["GET", "PUT", "PATCH", "DELETE"].some((method) => new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(route));
    return !hasOnlyPost || !route.includes("requireApiUser(request)");
  });
  checks.push({
    name: "Package C AI route auth boundary",
    ok: unsafeAiRoutes.length === 0,
    detail: unsafeAiRoutes.length === 0
      ? "AI advice routes remain authenticated POST-only endpoints"
      : `found unauthenticated or non-POST AI route risk: ${unsafeAiRoutes.join(", ")}`,
  });

  const persistenceScanText = [
    schema,
    webAiService,
    ai,
  ].join("\n");
  const forbiddenPersistenceTerms = [
    "model AiCall",
    "model AiUsage",
    "model AiPrompt",
    "model AiResponse",
    "tokenUsage",
    "promptHash",
    "promptText",
    "responseText",
    "rawPrompt",
    "rawResponse",
    "fullPrompt",
    "modelResponse",
  ];
  const persistenceMatches = forbiddenPersistenceTerms.filter((term) => persistenceScanText.includes(term));
  checks.push({
    name: "Package C prompt persistence boundary",
    ok: persistenceMatches.length === 0,
    detail: persistenceMatches.length === 0
      ? "schema and AI services do not persist full prompts or raw model responses before confirmation"
      : `found prompt/response persistence surface: ${persistenceMatches.join(", ")}`,
  });
}

function stripYamlCommentLines(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function hasYamlKey(block: string, key: string): boolean {
  return new RegExp(`^\\s+${escapeRegExp(key)}:\\s*`, "m").test(stripYamlCommentLines(block));
}

function findYamlKeyLine(block: string, key: string): string | undefined {
  return stripYamlCommentLines(block)
    .split(/\r?\n/)
    .find((line) => new RegExp(`^\\s+${escapeRegExp(key)}:\\s*`).test(line));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readIfExists(file: string): string {
  const filePath = resolve(file);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function fileExists(file: string): boolean {
  return existsSync(resolve(file));
}

function apiRouteContains(file: string, tokens: string[]): boolean {
  const content = readIfExists(file);
  return content.length > 0 && tokens.every((token) => content.includes(token));
}

function isBatch6StageDraftDecisionRoute(file: string, batch6Done: boolean): boolean {
  if (!batch6Done) return false;
  const normalized = file.replaceAll(path.sep, "/");
  return /\/simulation\/stage-adjustment-drafts\/\[[^\]]+\]\/(confirm|reject)\/route\.ts$/.test(normalized);
}

function listFiles(directory: string): string[] {
  const directoryPath = resolve(directory);
  if (!existsSync(directoryPath)) return [];

  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(relativePath);
    if (entry.isFile()) return [relativePath];
    return [];
  });
}

function isPackageBBatchDone(completionRecord: string, batch: number): boolean {
  return completionRecord
    .split(/\r?\n/)
    .some((line) => line.startsWith(`| Batch ${batch}：`) && line.includes("DONE / 已完成"));
}

function isPackageConfirmedOrDone(completionRecord: string, packageName: string): boolean {
  return completionRecord
    .split(/\r?\n/)
    .some((line) =>
      line.startsWith(`| ${packageName} |`) &&
      (line.includes("DONE / 已完成") || line.includes("用户已明确确认")),
    );
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
