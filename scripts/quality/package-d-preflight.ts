import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const checks: CheckResult[] = [];

const requiredFiles = [
  "docs/development/docs-100-completion-record.md",
  "docs/development/high-risk-confirmation-packets.md",
  "docs/development/second-stage-long-term-loop-design.md",
  "docs/development/validation-matrix.md",
  "tasks/backlog/0016-second-stage-long-term-loop.md",
  "packages/core/src/periodic-report.ts",
  "packages/core/src/study-integrity.ts",
  "packages/core/src/long-term-risk.ts",
  "apps/web/app/api/reports/periodic/route.ts",
  "apps/web/app/api/tasks/debt-reorder/route.ts",
  "apps/web/app/api/simulation/stage/route.ts",
] as const;

const packageDBatches = [
  "Batch D1",
  "Batch D2",
  "Batch D3",
  "Batch D4",
  "Batch D5",
] as const;

function main(): void {
  checkRequiredFiles();
  checkConfirmationPhrases();
  checkCompletionRecordState();
  checkPureRulePrep();
  checkReadOnlyRoutes();
  checkD1ImplementationIfDone();
  checkD2ImplementationIfDone();
  checkD3ImplementationIfDone();
  checkD4ImplementationIfDone();
  checkD5CompletionIfDone();
  checkNoUnconfirmedWriteRoutes();
  checkNoUnconfirmedPersistence();
  checkLongTermAiBoundary();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`Package D preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("Package D preflight passed: long-term-loop prep is present, completed batches are evidence-gated, D2 is narrowly unlocked, and D3-D5 write/AI paths remain locked until explicit confirmation.");
}

function checkRequiredFiles(): void {
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required Package D files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkConfirmationPhrases(): void {
  const packets = read("docs/development/high-risk-confirmation-packets.md");
  const requiredPhrases = [
    "确认执行 Package D：第二阶段长期闭环",
    "确认执行 Package D Batch D1：报告决策入口",
    "确认执行 Package D Batch D2：任务债务重排确认流",
    "确认执行 Package D Batch D3：长期阶段 AI 草稿",
    "确认执行 Package D Batch D4：长期风险和主题闭环补强",
    "确认执行 Package D Batch D5：Package D 收口",
  ];
  const missing = requiredPhrases.filter((phrase) => !packets.includes(phrase));
  checks.push({
    name: "explicit Package D confirmation phrases",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "main Package D and D1-D5 confirmation phrases are documented" : `missing ${missing.join(", ")}`,
  });
}

function checkCompletionRecordState(): void {
  const record = read("docs/development/docs-100-completion-record.md");
  const packageLine = findLine(record, "| Package D |");
  const packageCells = packageLine ? parseMarkdownCells(packageLine) : [];
  const packageStatus = packageCells[1] ?? "";
  const packageEvidence = packageCells[2] ?? "";
  const batchStates = getPackageDBatchStates(record);
  const allBatchesDone = packageDBatches.every((batch) => {
    const batchKey = batch.replace("Batch ", "").toLowerCase() as keyof ReturnType<typeof getPackageDBatchStates>;
    return batchStates[batchKey];
  });
  const packageDoneWithEvidence = packageStatus.includes("DONE / 已完成") &&
    ["验证", "烟测", "文档同步", "残余风险"].every((term) => packageEvidence.includes(term));
  const incompleteBatches = packageDBatches.flatMap((batch) => {
    const line = findLine(record, `| ${batch}：`);
    if (!line) return [`${batch}=missing`];
    const cells = parseMarkdownCells(line);
    const status = cells[1] ?? "";
    const confirmation = cells[2] ?? "";
    const batchKey = batch.replace("Batch ", "").toLowerCase() as keyof ReturnType<typeof getPackageDBatchStates>;
    if (batchStates[batchKey]) return [];
    return status.includes("NOT_READY / 未完成") && confirmation.includes("待用户明确确认") ? [] : [`${batch}=${status || "missing status"}`];
  });
  const ok = allBatchesDone
    ? packageDoneWithEvidence
    : packageStatus.includes("NOT_READY / 未完成") && incompleteBatches.length === 0;

  checks.push({
    name: "Package D completion ledger locked",
    ok,
    detail: ok
      ? allBatchesDone
        ? "Package D may be marked DONE only after D1-D5 evidence and package-level validation/smoke/docs/risk evidence exist"
        : "Package D remains NOT_READY until all D1-D5 evidence exists; completed batches may unlock only their narrow surface"
      : `Package D status=${packageStatus || "missing"}; packageEvidence=${packageEvidence ? "present" : "missing"}; batches ${incompleteBatches.join(", ") || "ok"}`,
  });
}

function checkPureRulePrep(): void {
  const periodicReport = read("packages/core/src/periodic-report.ts");
  const studyIntegrity = read("packages/core/src/study-integrity.ts");
  const longTermRisk = read("packages/core/src/long-term-risk.ts");
  const requiredTerms = [
    ["periodic-report", periodicReport, "createPeriodicReportDecisionSnapshot"],
    ["periodic-report", periodicReport, "createPeriodicNextCycleDraft"],
    ["periodic-report", periodicReport, "canAutoApply: false"],
    ["study-integrity", studyIntegrity, "previewTaskDebtReorderApplication"],
    ["study-integrity", studyIntegrity, "shouldStopOnFirstFailure: true"],
    ["study-integrity", studyIntegrity, "requiresUserConfirmation: true"],
    ["long-term-risk", longTermRisk, "summarizeLongTermRisks"],
    ["long-term-risk", longTermRisk, "sourceVersion: 1"],
    ["long-term-risk", longTermRisk, "requiresUserConfirmation: true"],
  ];
  const missing = requiredTerms
    .filter(([, content, term]) => !content.includes(term))
    .map(([file, , term]) => `${file}:${term}`);

  checks.push({
    name: "Package D pure-rule prep",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "report decision snapshots, debt application preview, and long-term risk DTO remain pure confirm-only rules"
      : `missing ${missing.join(", ")}`,
  });
}

function checkReadOnlyRoutes(): void {
  const routeFiles = [
    "apps/web/app/api/reports/periodic/route.ts",
    "apps/web/app/api/tasks/debt-reorder/route.ts",
    "apps/web/app/api/simulation/stage/route.ts",
  ];
  const unsafe = routeFiles.filter((file) => {
    const content = read(file);
    const hasGet = /export\s+async\s+function\s+GET\b/.test(content);
    const hasAuth = content.includes("requireApiUser(request)");
    const hasWriteMethod = ["POST", "PUT", "PATCH", "DELETE"].some((method) =>
      new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(content),
    );
    return !hasGet || !hasAuth || hasWriteMethod;
  });

  checks.push({
    name: "Package D read-only API boundary",
    ok: unsafe.length === 0,
    detail: unsafe.length === 0
      ? "periodic reports, debt reorder, and simulation stage routes stay authenticated GET-only"
      : `found non-read-only route risk: ${unsafe.join(", ")}`,
  });
}

function checkD1ImplementationIfDone(): void {
  const record = read("docs/development/docs-100-completion-record.md");
  const { d1 } = getPackageDBatchStates(record);
  if (!d1) {
    checks.push({
      name: "Package D D1 implementation boundary",
      ok: true,
      detail: "D1 is not marked done, so report decision implementation remains locked",
    });
    return;
  }

  const schema = read("prisma/schema.prisma");
  const route = read("apps/web/app/api/reports/periodic/decisions/route.ts");
  const service = read("apps/web/lib/study/report-decisions-service.ts");
  const reportsService = read("apps/web/lib/study/reports-service.ts");
  const reportsPage = read("apps/web/app/reports/page.tsx");
  const reportDecisionActions = read("apps/web/components/report-decision-actions.tsx");
  const exportedMethods = getExportedRouteMethods(route);
  const unexpectedMethods = exportedMethods.filter((method) => !["GET", "POST"].includes(method));
  const requiredTerms = [
    ["schema", schema, "model PeriodicReportDecision"],
    ["schema", schema, "@@unique([kind, rangeStart, rangeEnd])"],
    ["route", route, "export async function GET"],
    ["route", route, "export async function POST"],
    ["route", route, "requireApiUser(request)"],
    ["service", service, "PERIODIC_REPORT_DECISION_CONFIRMED"],
    ["service", service, "PERIODIC_REPORT_DECISION_REJECTED"],
    ["service", service, "PERIODIC_REPORT_DECISION_CONFLICT"],
    ["service", service, "boundary: \"report_decision_only_no_task_or_stage_mutation\""],
    ["service", service, "periodicReportDecision.create"],
    ["reports-service", reportsService, "serializePeriodicReportDecision"],
    ["reports-page", reportsPage, "ReportDecisionActions"],
    ["report-decision-actions", reportDecisionActions, "确认本报告"],
    ["report-decision-actions", reportDecisionActions, "驳回本报告"],
    ["report-decision-actions", reportDecisionActions, "不自动修改任务或阶段计划"],
  ];
  const missing = requiredTerms
    .filter(([, content, term]) => !content.includes(term))
    .map(([file, , term]) => `${file}:${term}`);
  const routeIssues = unexpectedMethods.map((method) => `route:unexpected ${method}`);

  checks.push({
    name: "Package D D1 implementation boundary",
    ok: missing.length === 0 && routeIssues.length === 0,
    detail: missing.length === 0 && routeIssues.length === 0
      ? "D1 report decisions are implemented with auth, audit, frozen replay, and no task/stage mutation wording"
      : `missing ${[...missing, ...routeIssues].join(", ")}`,
  });
}

function checkD2ImplementationIfDone(): void {
  const record = read("docs/development/docs-100-completion-record.md");
  const { d2 } = getPackageDBatchStates(record);
  if (!d2) {
    checks.push({
      name: "Package D D2 implementation boundary",
      ok: true,
      detail: "D2 is not marked done, so debt reorder write implementation remains locked",
    });
    return;
  }

  const decisionsRoute = read("apps/web/app/api/tasks/debt-reorder/decisions/route.ts");
  const applicationsRoute = read("apps/web/app/api/tasks/debt-reorder/applications/route.ts");
  const service = read("apps/web/lib/study/task-debt-reorder-service.ts");
  const taskDebtEvents = read("apps/web/lib/study/task-debt-event-service.ts");
  const taskPanel = read("apps/web/components/task-panel.tsx");
  const forbiddenMethods = [
    ...getExportedRouteMethods(decisionsRoute).filter((method) => !["POST"].includes(method)).map((method) => `decisions:${method}`),
    ...getExportedRouteMethods(applicationsRoute).filter((method) => !["POST"].includes(method)).map((method) => `applications:${method}`),
  ];
  const requiredTerms = [
    ["decisions-route", decisionsRoute, "export async function POST"],
    ["decisions-route", decisionsRoute, "requireApiUser(request)"],
    ["applications-route", applicationsRoute, "export async function POST"],
    ["applications-route", applicationsRoute, "requireApiUser(request)"],
    ["service", service, "previewTaskDebtReorderApplication"],
    ["service", service, "decideTaskDebtReorder"],
    ["service", service, "applyTaskDebtReorder"],
    ["service", service, "reorder_suggested"],
    ["service", service, "reorder_applied"],
    ["service", service, "shouldStopOnFirstFailure"],
    ["service", service, "only_selected_task_debt_reorder_items"],
    ["task-debt-events", taskDebtEvents, "\"reorder_suggested\""],
    ["task-debt-events", taskDebtEvents, "\"reorder_applied\""],
    ["task-panel", taskPanel, "只处理所选项"],
    ["task-panel", taskPanel, "确认所选"],
    ["task-panel", taskPanel, "驳回所选"],
    ["task-panel", taskPanel, "应用所选"],
  ];
  const missing = requiredTerms
    .filter(([, content, term]) => !content.includes(term))
    .map(([file, , term]) => `${file}:${term}`);

  checks.push({
    name: "Package D D2 implementation boundary",
    ok: missing.length === 0 && forbiddenMethods.length === 0,
    detail: missing.length === 0 && forbiddenMethods.length === 0
      ? "D2 debt reorder decisions/applications are implemented with auth, selected-only application, audit/event evidence, and no broad apply route"
      : `missing ${[...missing, ...forbiddenMethods].join(", ")}`,
  });
}

function checkD3ImplementationIfDone(): void {
  const record = read("docs/development/docs-100-completion-record.md");
  const { d3 } = getPackageDBatchStates(record);
  const aiRoutePath = "apps/web/app/api/simulation/stage-adjustment-drafts/ai/route.ts";

  if (!d3) {
    const routeExists = existsSync(resolve(aiRoutePath));
    const stageService = read("apps/web/lib/study/stage-service.ts");
    const longTermFiles = [
      "apps/web/lib/study/reports-service.ts",
      "apps/web/lib/study/simulation-service.ts",
      "apps/web/lib/study/stage-service.ts",
      "apps/web/lib/study/service.ts",
      "apps/web/lib/study/analytics-service.ts",
    ];
    const forbiddenTerms = [
      "createAiStageAdjustmentDraft",
      "allowExternalProvider: true",
      "source: \"ai\"",
      "source: 'ai'",
    ];
    const matches = longTermFiles.flatMap((file) => {
      const content = read(file);
      return forbiddenTerms
        .filter((term) => content.includes(term))
        .map((term) => `${file}:${term}`);
    });

    checks.push({
      name: "Package D D3 implementation boundary",
      ok: !routeExists && matches.length === 0 && stageService.includes("source: \"local_rule\""),
      detail: !routeExists && matches.length === 0 && stageService.includes("source: \"local_rule\"")
        ? "D3 is not marked done, so long-term stage AI draft route and source=ai writes remain locked"
        : `found unconfirmed D3 surface: routeExists=${routeExists}; matches=${matches.join(", ") || "none"}; localRule=${stageService.includes("source: \"local_rule\"")}`,
    });
    return;
  }

  const route = readIfExists(aiRoutePath);
  const service = readIfExists("apps/web/lib/study/long-term-stage-ai-service.ts");
  const routeMethods = route ? getExportedRouteMethods(route) : [];
  const forbiddenMethods = routeMethods.filter((method) => method !== "POST").map((method) => `ai-route:${method}`);
  const requiredTerms = [
    ["ai-route", route, "export async function POST"],
    ["ai-route", route, "requireApiUser(request)"],
    ["ai-route", route, "allowExternalProvider: true"],
    ["service", service, "createAiStageAdjustmentDraft"],
    ["service", service, "minimizedLongTermStageContext"],
    ["service", service, "source: \"ai\""],
    ["service", service, "canAutoApply: false"],
    ["service", service, "requiresUserConfirmation: true"],
    ["service", service, "AI_STAGE_ADJUSTMENT_DRAFT_CREATED"],
    ["service", service, "fallbackToLocalRule"],
  ];
  const forbiddenPrivacyTerms = [
    ["service", service, "motivationProfile"],
    ["service", service, "fullMoodRecord"],
    ["service", service, "fullReviewText"],
    ["service", service, "attachmentContent"],
    ["service", service, "promptResponse"],
  ];
  const missing = requiredTerms
    .filter(([, content, term]) => !content || !content.includes(term))
    .map(([file, , term]) => `${file}:${term}`);
  const privacyMatches = forbiddenPrivacyTerms
    .filter(([, content, term]) => content?.includes(term))
    .map(([file, , term]) => `${file}:${term}`);

  checks.push({
    name: "Package D D3 implementation boundary",
    ok: missing.length === 0 && forbiddenMethods.length === 0 && privacyMatches.length === 0,
    detail: missing.length === 0 && forbiddenMethods.length === 0 && privacyMatches.length === 0
      ? "D3 long-term stage AI draft is implemented as authenticated POST-only, minimized, confirm-only, and fallback-capable"
      : `missing ${[...missing, ...forbiddenMethods].join(", ") || "none"}; privacy ${privacyMatches.join(", ") || "none"}`,
  });
}

function checkD4ImplementationIfDone(): void {
  const record = read("docs/development/docs-100-completion-record.md");
  const { d4 } = getPackageDBatchStates(record);
  if (!d4) {
    checks.push({
      name: "Package D D4 implementation boundary",
      ok: true,
      detail: "D4 is not marked done, so long-term risk/theme closure may remain pure/read-only prep",
    });
    return;
  }

  const riskService = readIfExists("apps/web/lib/study/long-term-risk-service.ts");
  const riskRoute = readIfExists("apps/web/app/api/analytics/long-term-risks/route.ts");
  const syllabusPage = readIfExists("apps/web/app/syllabus/page.tsx") ?? readIfExists("apps/web/components/syllabus-panel.tsx");
  const notesPage = readIfExists("apps/web/app/notes/page.tsx") ?? readIfExists("apps/web/components/notes-panel.tsx");
  const reportsPage = readIfExists("apps/web/app/reports/page.tsx");
  const taskPanel = readIfExists("apps/web/components/task-panel.tsx");
  const routeMethods = riskRoute ? getExportedRouteMethods(riskRoute) : [];
  const forbiddenMethods = routeMethods.filter((method) => method !== "GET").map((method) => `risk-route:${method}`);
  const requiredTerms = [
    ["risk-service", riskService, "summarizeLongTermRisks"],
    ["risk-service", riskService, "evidenceFreshness"],
    ["risk-route", riskRoute, "export async function GET"],
    ["risk-route", riskRoute, "requireApiUser(request)"],
    ["syllabus", syllabusPage, "作战地图"],
    ["syllabus", syllabusPage, "遗忘风险"],
    ["notes", notesPage, "复习提醒"],
    ["reports", reportsPage, "长期风险"],
    ["task-panel", taskPanel, "状态主题"],
  ];
  const missing = requiredTerms
    .filter(([, content, term]) => !content || !content.includes(term))
    .map(([file, , term]) => `${file}:${term}`);

  checks.push({
    name: "Package D D4 implementation boundary",
    ok: missing.length === 0 && forbiddenMethods.length === 0,
    detail: missing.length === 0 && forbiddenMethods.length === 0
      ? "D4 long-term risk, review reminders, combat map, reports, and theme evidence are wired through read-only/API surfaces"
      : `missing ${[...missing, ...forbiddenMethods].join(", ")}`,
  });
}

function checkD5CompletionIfDone(): void {
  const record = read("docs/development/docs-100-completion-record.md");
  const { d1, d2, d3, d4, d5 } = getPackageDBatchStates(record);
  if (!d5) {
    checks.push({
      name: "Package D D5 completion boundary",
      ok: true,
      detail: "D5 is not marked done, so Package D remains open after D1 and future D2-D4 implementation",
    });
    return;
  }

  const packageLine = findLine(record, "| Package D |") ?? "";
  const packageCells = parseMarkdownCells(packageLine);
  const packageStatus = packageCells[1] ?? "";
  const packageEvidence = packageCells[2] ?? "";
  const featureTraceability = read("docs/development/feature-traceability.md");
  const missingEarlierBatches = [
    ["D1", d1],
    ["D2", d2],
    ["D3", d3],
    ["D4", d4],
  ].filter(([, done]) => !done).map(([batch]) => String(batch));
  const packageDoneWithEvidence = packageStatus.includes("DONE / 已完成") &&
    ["验证", "烟测", "文档同步", "残余风险"].every((term) => packageEvidence.includes(term));
  const longTermAiStatus = findFeatureTraceabilityStatus(featureTraceability, "AI 根据长期数据生成阶段调整建议");
  const lingeringFeatureGap = !longTermAiStatus ||
    ["基础版", "待确认", "未实现"].some((status) => longTermAiStatus.includes(status));

  checks.push({
    name: "Package D D5 completion boundary",
    ok: missingEarlierBatches.length === 0 && packageDoneWithEvidence && !lingeringFeatureGap,
    detail: missingEarlierBatches.length === 0 && packageDoneWithEvidence && !lingeringFeatureGap
      ? "D5 may close Package D only after D1-D4, package evidence, and feature traceability are complete"
      : `missingEarlierBatches=${missingEarlierBatches.join(", ") || "none"}; packageDone=${packageDoneWithEvidence}; longTermAiStatus=${longTermAiStatus ?? "missing"}; lingeringFeatureGap=${lingeringFeatureGap}`,
  });
}

function checkNoUnconfirmedWriteRoutes(): void {
  const { d1, d2, d3 } = getPackageDBatchStates(read("docs/development/docs-100-completion-record.md"));
  const routeFiles = listFiles("apps/web/app/api").filter((file) => file.endsWith("/route.ts"));
  const forbidden = routeFiles.filter((file) => {
    const normalized = file.replaceAll(path.sep, "/");
    if (isBatch6StageDraftDecisionRoute(normalized)) return false;
    if (d1 && isD1ReportDecisionRoute(normalized)) return false;
    if (d2 && isD2DebtReorderDecisionRoute(normalized)) return false;
    if (d3 && isD3StageAiDraftRoute(normalized)) return false;
    if (normalized.endsWith("/tasks/debt-reorder/route.ts")) return false;
    return [
      /\/reports\/.*(confirm|reject|apply|decision|snapshot)/,
      /\/tasks\/debt-reorder\/.+/,
      /\/simulation\/stage-adjustment-drafts\/ai\/route\.ts$/,
      /\/simulation\/stage\/.*(confirm|reject|apply)/,
      /\/simulation\/exams\/.*(confirm|reject|apply)/,
    ].some((pattern) => pattern.test(normalized));
  });

  checks.push({
    name: "Package D unconfirmed write-route boundary",
    ok: forbidden.length === 0,
    detail: forbidden.length === 0
      ? "no unconfirmed report, debt, stage, or simulation apply routes exist; D1 is allowed only with complete evidence"
      : `found unconfirmed write route: ${forbidden.join(", ")}`,
  });
}

function checkNoUnconfirmedPersistence(): void {
  const { d1 } = getPackageDBatchStates(read("docs/development/docs-100-completion-record.md"));
  const schema = read("prisma/schema.prisma");
  const webStudyText = listFiles("apps/web/lib/study")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => read(file))
    .join("\n");
  const forbiddenSchemaTerms = [
    "model PeriodicReportDecision",
    "model ReportSnapshot",
    "model TaskReorderApplication",
    "model StagePlanApplication",
    "model AiStageAdjustment",
  ];
  const forbiddenRuntimeTerms = [
    "periodicReportDecision",
    "reportSnapshot.create",
    "taskReorderApplication",
    "stagePlanApplication",
    "aiStageAdjustment",
  ];
  const matches = [
    ...forbiddenSchemaTerms.filter((term) => !isAllowedD1PersistenceTerm(term, d1) && schema.includes(term)).map((term) => `schema:${term}`),
    ...forbiddenRuntimeTerms.filter((term) => !isAllowedD1PersistenceTerm(term, d1) && webStudyText.includes(term)).map((term) => `web:${term}`),
  ];

  checks.push({
    name: "Package D unconfirmed persistence boundary",
    ok: matches.length === 0,
    detail: matches.length === 0
      ? "no unconfirmed task reorder application, stage application, or long-term AI persistence surface exists; D1 report decisions are evidence-gated"
      : `found unconfirmed persistence surface: ${matches.join(", ")}`,
  });
}

function checkLongTermAiBoundary(): void {
  const { d3 } = getPackageDBatchStates(read("docs/development/docs-100-completion-record.md"));
  if (d3) {
    checks.push({
      name: "Package D long-term AI boundary",
      ok: true,
      detail: "D3 is marked done, so long-term AI allowance is governed by the D3 exact route/service evidence gate",
    });
    return;
  }

  const files = [
    "apps/web/lib/study/reports-service.ts",
    "apps/web/lib/study/simulation-service.ts",
    "apps/web/lib/study/stage-service.ts",
    "apps/web/lib/study/service.ts",
    "apps/web/lib/study/analytics-service.ts",
  ];
  const forbiddenTerms = [
    "createOpenAiCompatibleJsonProvider",
    "generateAdviceWithProvider",
    "allowExternalProvider",
    "AI_ENABLED",
    "source: \"ai\"",
    "source: 'ai'",
  ];
  const matches = files.flatMap((file) => {
    const content = read(file);
    return forbiddenTerms
      .filter((term) => content.includes(term))
      .map((term) => `${file}:${term}`);
  });
  const stageService = read("apps/web/lib/study/stage-service.ts");

  checks.push({
    name: "Package D long-term AI boundary",
    ok: matches.length === 0 && stageService.includes("source: \"local_rule\""),
    detail: matches.length === 0 && stageService.includes("source: \"local_rule\"")
      ? "long-term report/stage services do not call AI, and stage draft creation remains local_rule"
      : `found long-term AI risk: ${matches.join(", ") || "none"}; localRule=${stageService.includes("source: \"local_rule\"")}`,
  });
}

function isBatch6StageDraftDecisionRoute(file: string): boolean {
  return /\/simulation\/stage-adjustment-drafts\/\[[^\]]+\]\/(confirm|reject)\/route\.ts$/.test(file);
}

function isD1ReportDecisionRoute(file: string): boolean {
  return /\/reports\/periodic\/decisions\/route\.ts$/.test(file);
}

function isD2DebtReorderDecisionRoute(file: string): boolean {
  return /\/tasks\/debt-reorder\/(decisions|applications)\/route\.ts$/.test(file);
}

function isD3StageAiDraftRoute(file: string): boolean {
  return /\/simulation\/stage-adjustment-drafts\/ai\/route\.ts$/.test(file);
}

function isAllowedD1PersistenceTerm(term: string, d1Done: boolean): boolean {
  return d1Done && [
    "model PeriodicReportDecision",
    "periodicReportDecision",
  ].includes(term);
}

function getPackageDBatchStates(record: string): { d1: boolean; d2: boolean; d3: boolean; d4: boolean; d5: boolean } {
  return {
    d1: isPackageDBatchDone(record, "D1"),
    d2: isPackageDBatchDone(record, "D2"),
    d3: isPackageDBatchDone(record, "D3"),
    d4: isPackageDBatchDone(record, "D4"),
    d5: isPackageDBatchDone(record, "D5"),
  };
}

function isPackageDBatchDone(record: string, batch: "D1" | "D2" | "D3" | "D4" | "D5"): boolean {
  const line = findLine(record, `| Batch ${batch}：`) ?? "";
  if (!line.includes("DONE / 已完成")) return false;
  const cells = parseMarkdownCells(line);
  const confirmation = cells[2] ?? "";
  const validation = cells[3] ?? "";
  const smoke = cells[4] ?? "";
  const docsSync = cells[5] ?? "";
  const residualRisk = cells[6] ?? "";
  return confirmation.includes("用户已明确确认") &&
    validation.includes("pnpm") &&
    /(烟测|smoke|服务级)/i.test(smoke) &&
    docsSync.includes("已同步") &&
    residualRisk.length >= 20 &&
    !["待同步", "未运行", "缺"].some((token) => residualRisk.includes(token));
}

function findLine(content: string, prefix: string): string | undefined {
  return content.split(/\r?\n/).find((line) => line.startsWith(prefix));
}

function parseMarkdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function findFeatureTraceabilityStatus(content: string, feature: string): string | null {
  const line = findLine(content, `| ${feature} |`);
  if (!line) return null;
  const cells = parseMarkdownCells(line);
  return cells[1] ?? null;
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function readIfExists(file: string): string | null {
  return existsSync(resolve(file)) ? read(file) : null;
}

function getExportedRouteMethods(routeContent: string): string[] {
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((method) =>
    new RegExp(`\\bexport\\s+async\\s+function\\s+${method}\\b`).test(routeContent) ||
    new RegExp(`\\bexport\\s+const\\s+${method}\\b`).test(routeContent) ||
    new RegExp(`\\bexport\\s*\\{\\s*${method}(\\s+as\\s+${method})?\\s*\\}`).test(routeContent),
  );
}

function resolve(file: string): string {
  return path.join(root, file);
}

function listFiles(dir: string): string[] {
  const absolute = resolve(dir);
  if (!existsSync(absolute)) return [];

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(child);
    if (entry.isFile()) return [child];
    return [];
  });
}

main();
