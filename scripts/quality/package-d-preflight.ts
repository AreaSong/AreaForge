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

  console.log("Package D preflight passed: long-term-loop prep is present, and D1-D5 write/AI paths remain locked until explicit confirmation.");
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
  const incompleteBatches = packageDBatches.flatMap((batch) => {
    const line = findLine(record, `| ${batch}：`);
    if (!line) return [`${batch}=missing`];
    const cells = parseMarkdownCells(line);
    const status = cells[1] ?? "";
    const confirmation = cells[2] ?? "";
    return status.includes("NOT_READY / 未完成") && confirmation.includes("待用户明确确认") ? [] : [`${batch}=${status || "missing status"}`];
  });

  checks.push({
    name: "Package D completion ledger locked",
    ok: packageStatus.includes("NOT_READY / 未完成") && incompleteBatches.length === 0,
    detail: packageStatus.includes("NOT_READY / 未完成") && incompleteBatches.length === 0
      ? "Package D and D1-D5 remain NOT_READY until explicit batch evidence exists"
      : `Package D status=${packageStatus || "missing"}; batches ${incompleteBatches.join(", ") || "ok"}`,
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

function checkNoUnconfirmedWriteRoutes(): void {
  const routeFiles = listFiles("apps/web/app/api").filter((file) => file.endsWith("/route.ts"));
  const forbidden = routeFiles.filter((file) => {
    const normalized = file.replaceAll(path.sep, "/");
    if (isBatch6StageDraftDecisionRoute(normalized)) return false;
    if (normalized.endsWith("/tasks/debt-reorder/route.ts")) return false;
    return [
      /\/reports\/.*(confirm|reject|apply|decision|snapshot)/,
      /\/tasks\/debt-reorder\/.+/,
      /\/simulation\/stage\/.*(confirm|reject|apply)/,
      /\/simulation\/exams\/.*(confirm|reject|apply)/,
    ].some((pattern) => pattern.test(normalized));
  });

  checks.push({
    name: "Package D unconfirmed write-route boundary",
    ok: forbidden.length === 0,
    detail: forbidden.length === 0
      ? "no D1/D2/D3/D4 report, debt, stage, or simulation apply routes exist before confirmation"
      : `found unconfirmed write route: ${forbidden.join(", ")}`,
  });
}

function checkNoUnconfirmedPersistence(): void {
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
    ...forbiddenSchemaTerms.filter((term) => schema.includes(term)).map((term) => `schema:${term}`),
    ...forbiddenRuntimeTerms.filter((term) => webStudyText.includes(term)).map((term) => `web:${term}`),
  ];

  checks.push({
    name: "Package D unconfirmed persistence boundary",
    ok: matches.length === 0,
    detail: matches.length === 0
      ? "no report decision, task reorder application, stage application, or long-term AI persistence surface exists before confirmation"
      : `found unconfirmed persistence surface: ${matches.join(", ")}`,
  });
}

function checkLongTermAiBoundary(): void {
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

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
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
