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
  "tasks/backlog/0015-structured-state-migration.md",
  "tasks/backlog/0016-second-stage-long-term-loop.md",
  "tasks/backlog/0017-ai-stage-privacy-cost.md",
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

  checks.push({
    name: "high-risk packets",
    ok: missingPackages.length === 0 && missingRefs.length === 0,
    detail:
      missingPackages.length === 0 && missingRefs.length === 0
        ? "packages A-E and design references present"
        : `missing packages ${missingPackages.join(", ") || "none"}; missing refs ${missingRefs.join(", ") || "none"}`,
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
