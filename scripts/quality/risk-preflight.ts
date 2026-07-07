import { existsSync, readFileSync } from "node:fs";
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

function main(): void {
  checkDesignDocs();
  checkEnvExample();
  checkAttachmentDesign();
  checkAttachmentStillBeforePackageA();
  checkAiDesign();
  checkAiStillBeforePackageC();
  checkStructuredMigrationDesign();
  checkSecondStageDesign();
  checkSecondStageStillBeforePackageD();
  checkProductionCompose();
  checkPrismaStillBeforePackageB();

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
}

function checkAttachmentDesign(): void {
  const design = readIfExists("docs/development/attachment-upload-access-design.md");
  const storage = readIfExists("packages/storage/src/index.ts");
  const apiSurface = readIfExists("docs/architecture/api-surface.md");
  const requiredDesignTerms = [
    "POST /api/notes/[noteId]/attachments",
    "GET /api/attachments/:id",
    "不进入 `public/`",
    "补偿",
    "软链接逃逸",
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
    storage.includes("createAttachmentResponseHeaders");
  checks.push({
    name: "Package A storage primitives",
    ok: hasStorageGuards,
    detail: hasStorageGuards ? "safe path and response header helpers present" : "expected safe path and response header helpers",
  });

  const hasScopedApi = apiSurface.includes("POST /api/notes/:noteId/attachments") && !apiSurface.includes("POST /api/attachments");
  checks.push({
    name: "Package A API surface",
    ok: hasScopedApi,
    detail: hasScopedApi ? "attachment upload remains note-scoped" : "expected note-scoped upload API and no old top-level upload",
  });
}

function checkAiDesign(): void {
  const design = readIfExists("docs/development/ai-provider-integration-design.md");
  const ai = readIfExists("packages/ai/src/index.ts");
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
}

function checkSecondStageDesign(): void {
  const design = readIfExists("docs/development/second-stage-long-term-loop-design.md");
  const requiredTerms = [
    "Package B",
    "Package C",
    "canAutoApply=false",
    "requiresUserConfirmation=true",
    "确认前禁用项",
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
}

function checkSecondStageStillBeforePackageD(): void {
  const debtReorderRoute = readIfExists("apps/web/app/api/tasks/debt-reorder/route.ts");
  const simulationStageRoute = readIfExists("apps/web/app/api/simulation/stage/route.ts");
  const stageAdjustmentCore = readIfExists("packages/core/src/stage-adjustment.ts");
  const simulationService = readIfExists("apps/web/lib/study/simulation-service.ts");
  const simulationPage = readIfExists("apps/web/app/simulation/page.tsx");
  const reportsService = readIfExists("apps/web/lib/study/reports-service.ts");
  const reportsPage = readIfExists("apps/web/app/reports/page.tsx");
  const taskPanel = readIfExists("apps/web/components/task-panel.tsx");
  const taskDebtDocs = readIfExists("docs/modules/task-debt.md");
  const apiSurface = readIfExists("docs/architecture/api-surface.md");

  const forbiddenDebtReorderMethods = ["POST", "PATCH", "PUT", "DELETE"].filter((method) =>
    new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(debtReorderRoute),
  );
  checks.push({
    name: "Package D debt reorder API boundary",
    ok: debtReorderRoute.includes("export async function GET") && forbiddenDebtReorderMethods.length === 0,
    detail: forbiddenDebtReorderMethods.length === 0
      ? "debt reorder remains read-only GET without apply write handlers"
      : `found write handlers before confirmation: ${forbiddenDebtReorderMethods.join(", ")}`,
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
  checks.push({
    name: "Package D stage adjustment API boundary",
    ok: simulationStageRoute.includes("export async function GET") &&
      forbiddenStageMethods.length === 0 &&
      forbiddenStageApplyRoutes.length === 0,
    detail: forbiddenStageMethods.length === 0 && forbiddenStageApplyRoutes.length === 0
      ? "stage adjustment remains read-only draft without apply write handlers"
      : `found stage adjustment write surface before confirmation: ${[...forbiddenStageMethods, ...forbiddenStageApplyRoutes].join(", ")}`,
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
}

function checkStructuredMigrationDesign(): void {
  const design = readIfExists("docs/development/structured-state-migration-design.md");
  const packets = readIfExists("docs/development/high-risk-confirmation-packets.md");
  const task = readIfExists("tasks/backlog/0015-structured-state-migration.md");
  const completionRecord = readIfExists("docs/development/docs-100-completion-record.md");
  const validationMatrix = readIfExists("docs/development/validation-matrix.md");
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

  const requiredBatchStatusTerms = [
    "## 批次状态",
    "Batch 0 验收标准",
    "Package B 总体验收标准",
    "完成后只更新 Package B Batch 0 证据",
  ];
  const missingBatchStatusTerms = requiredBatchStatusTerms.filter((term) => !task.includes(term));
  checks.push({
    name: "Package B task batch status",
    ok: missingBatchStatusTerms.length === 0,
    detail: missingBatchStatusTerms.length === 0
      ? "task tracks Batch 0-6 states and separates Batch 0 from package-wide acceptance"
      : `missing ${missingBatchStatusTerms.join(", ")}`,
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
    "确认前只允许做文档和护栏准备",
    "用户明确确认 Batch 0 后",
    "DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy",
    "允许 Batch 0 字段存在，继续阻止 Batch 1-6 未确认模型越界",
  ];
  const missingValidationTerms = requiredValidationTerms.filter((term) => !validationMatrix.includes(term));
  checks.push({
    name: "Package B Batch 0 validation gate",
    ok: missingValidationTerms.length === 0,
    detail: missingValidationTerms.length === 0
      ? "validation matrix separates pre-confirmation checks from post-confirmation migration checks"
      : `missing ${missingValidationTerms.join(", ")}`,
  });
}

function checkProductionCompose(): void {
  const compose = readIfExists("docker-compose.prod.yml");
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
}

function getComposeServiceBlock(compose: string, serviceName: string): string {
  const lines = stripYamlCommentLines(compose).split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start < 0) return "";

  const end = lines.findIndex((line, index) => index > start && /^  [a-zA-Z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

function checkPrismaStillBeforePackageB(): void {
  const schema = readIfExists("prisma/schema.prisma");
  const notYetMigratedModels = [
    "understandingLevel",
    "minimalOutput",
    "nextAction",
    "producedNote",
    "producedMistake",
    "isLowConversion",
    "antiFakeReason",
    "requiredOutput",
    "closeoutVersion",
    "model CheckIn",
    "parentTaskId",
    "model TaskDebtEvent",
    "model RecoveryState",
    "model MasteryConditionRecord",
    "model MasteryEvidence",
    "model MasteryRetest",
    "model SimulationExam",
    "model SimulationSubjectResult",
    "model StagePlan",
    "model StageAdjustmentDraft",
  ];
  const present = notYetMigratedModels.filter((model) => schema.includes(model));
  checks.push({
    name: "Package B implementation boundary",
    ok: present.length === 0,
    detail: present.length === 0
      ? "structured migration models are still gated behind confirmation"
      : `found models before confirmation: ${present.join(", ")}`,
  });
}

function checkAttachmentStillBeforePackageA(): void {
  const packageABoundaryFiles = [
    "apps/web/app/api/notes/[noteId]/attachments/route.ts",
    "apps/web/app/api/attachments/[id]/route.ts",
    "apps/web/lib/study/attachments-service.ts",
  ];
  const present = packageABoundaryFiles.filter((file) => existsSync(resolve(file)));
  checks.push({
    name: "Package A implementation boundary",
    ok: present.length === 0,
    detail: present.length === 0
      ? "upload/download route handlers remain gated behind confirmation"
      : `found upload/download implementation before confirmation: ${present.join(", ")}`,
  });
}

function checkAiStillBeforePackageC(): void {
  const ai = readIfExists("packages/ai/src/index.ts");
  const webAiService = readIfExists("apps/web/lib/study/ai-service.ts");
  const homePage = readIfExists("apps/web/app/page.tsx");
  const externalProviderTokens = [
    "fetch(",
    "chat/completions",
    "responses",
    "AI_ENABLED",
    "AI_BASE_URL",
    "AI_API_KEY",
  ];
  const aiMatches = externalProviderTokens.filter((token) => ai.includes(token));
  const webMatches = ["AI_BASE_URL", "AI_API_KEY"].filter((token) => webAiService.includes(token));
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

function resolve(file: string): string {
  return path.join(root, file);
}

main();
