import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface FeatureRow {
  section: string;
  feature: string;
  status: string;
}

interface CompletionIssue {
  name: string;
  detail: string;
}

const root = process.cwd();
const traceabilityPath = "docs/development/feature-traceability.md";
const completionRecordPath = "docs/development/docs-100-completion-record.md";
const blockingStatusKeywords = [
  "基础版",
  "待确认",
  "未实现",
] as const;
const requiredHighRiskPackages = [
  "Package A",
  "Package B",
  "Package C",
  "Package D",
  "Package E",
] as const;
const requiredPackageBBatches = [
  "Batch 0",
  "Batch 1",
  "Batch 2",
  "Batch 3",
  "Batch 4",
  "Batch 5",
  "Batch 6",
] as const;
const incompleteEvidenceKeywords = [
  "待确认",
  "未完成",
  "未验证",
  "缺失",
  "阻塞",
  "NOT_READY",
] as const;
const requiredPackageEvidenceKeywords = [
  "验证",
  "烟测",
  "文档",
  "残余风险",
] as const;

function main(): void {
  const issues: CompletionIssue[] = [];

  if (!existsSync(resolve(traceabilityPath))) {
    issues.push({
      name: "traceability file",
      detail: `${traceabilityPath} is missing`,
    });
  } else {
    issues.push(...checkTraceabilityCompletion());
  }

  issues.push(...checkCompletionRecord());

  if (issues.length === 0) {
    console.log("docs 100 completion passed: all non-deferred scope has completion evidence.");
    return;
  }

  for (const issue of issues) {
    console.log(`NOT_READY ${issue.name}: ${issue.detail}`);
  }
  console.error(`docs 100 completion not ready: ${issues.length} blocker(s).`);
  process.exit(1);
}

function checkTraceabilityCompletion(): CompletionIssue[] {
  const rows = parseTraceabilityRows(read(traceabilityPath));
  const blockingRows = rows.filter((row) => {
    if (row.section === "暂缓项") return false;
    return blockingStatusKeywords.some((status) => row.status.includes(status));
  });

  if (blockingRows.length === 0) return [];

  const bySection = new Map<string, string[]>();
  for (const row of blockingRows) {
    const items = bySection.get(row.section) ?? [];
    items.push(`${row.feature}=${row.status}`);
    bySection.set(row.section, items);
  }

  return Array.from(bySection.entries()).map(([section, items]) => ({
    name: `feature traceability ${section}`,
    detail: items.join("; "),
  }));
}

function checkCompletionRecord(): CompletionIssue[] {
  if (!existsSync(resolve(completionRecordPath))) {
    return [
      {
        name: "completion record",
        detail: `${completionRecordPath} is missing; final docs 100 needs current evidence, not only target criteria`,
      },
    ];
  }

  const record = read(completionRecordPath);
  const issues: CompletionIssue[] = [];
  const missingPackages = requiredHighRiskPackages.filter((item) => !record.includes(item));
  if (missingPackages.length > 0) {
    issues.push({
      name: "high-risk completion evidence",
      detail: `missing ${missingPackages.join(", ")} in ${completionRecordPath}`,
    });
  }

  for (const item of requiredHighRiskPackages) {
    const line = findLine(record, `| ${item} |`);
    if (!line) continue;
    const cells = parseMarkdownCells(line);
    const status = cells[1] ?? "";
    const evidence = cells[2] ?? "";
    const isComplete = status.includes("完成") && !incompleteEvidenceKeywords.some((keyword) => line.includes(keyword));
    if (!isComplete) {
      issues.push({
        name: `${item} completion evidence`,
        detail: `expected a completed evidence line in ${completionRecordPath}`,
      });
      continue;
    }

    const missingEvidenceKeywords = requiredPackageEvidenceKeywords.filter((keyword) => !evidence.includes(keyword));
    if (missingEvidenceKeywords.length > 0) {
      issues.push({
        name: `${item} completion evidence detail`,
        detail: `completed package row must include evidence for ${missingEvidenceKeywords.join(", ")}`,
      });
    }

    if (item === "Package A") {
      issues.push(...checkPackageACompletionDetail(line));
    }
  }

  issues.push(...checkPackageBBatches(record));

  return issues;
}

function checkPackageACompletionDetail(line: string): CompletionIssue[] {
  const requiredTerms = [
    "401",
    "PDF/PNG/JPEG/WebP",
    "413",
    "MIME_MISMATCH",
    "BAD_MULTIPART",
    "INVALID_DISPOSITION",
    "软链接逃逸",
    "补偿删除",
    "hash/size 对账",
    "private, no-store",
    "nosniff",
    "不泄露 uri/storedName/绝对路径",
  ];
  const missingTerms = requiredTerms.filter((term) => !line.includes(term));
  if (missingTerms.length === 0) return [];

  return [
    {
      name: "Package A attachment evidence detail",
      detail: `completed Package A row must include attachment smoke evidence for ${missingTerms.join(", ")}`,
    },
  ];
}

function checkPackageBBatches(record: string): CompletionIssue[] {
  const missingOrIncomplete: string[] = [];
  const missingDetails: string[] = [];

  for (const batch of requiredPackageBBatches) {
    const line = findLine(record, `| ${batch}：`);
    if (!line) {
      missingOrIncomplete.push(`${batch}=missing`);
      continue;
    }

    const cells = parseMarkdownCells(line);
    const status = cells[1] ?? "";
    if (!status.includes("DONE / 已完成")) {
      missingOrIncomplete.push(`${batch}=${status || "missing status"}`);
      continue;
    }

    const detailIssues = missingBatchEvidenceDetails(cells);
    if (detailIssues.length > 0) {
      missingDetails.push(`${batch}: ${detailIssues.join(", ")}`);
    }
  }

  const issues: CompletionIssue[] = [];

  if (missingOrIncomplete.length > 0) {
    issues.push({
      name: "Package B batch completion evidence",
      detail: `expected Batch 0-6 rows to be DONE / 已完成; ${missingOrIncomplete.join("; ")}`,
    });
  }

  if (missingDetails.length > 0) {
    issues.push({
      name: "Package B batch completion detail",
      detail: `completed Batch rows must include confirmation, validation commands, smoke evidence, docs sync, and residual risk; ${missingDetails.join("; ")}`,
    });
  }

  return issues;
}

function missingBatchEvidenceDetails(cells: string[]): string[] {
  const confirmation = cells[2] ?? "";
  const validation = cells[3] ?? "";
  const smoke = cells[4] ?? "";
  const docsSync = cells[5] ?? "";
  const residualRisk = cells[6] ?? "";
  const missing: string[] = [];

  if (!confirmation.includes("用户已明确确认")) missing.push("confirmation");
  if (!validation.includes("pnpm")) missing.push("validation commands");
  if (!/(烟测|smoke|Playwright)/i.test(smoke)) missing.push("smoke evidence");
  if (!docsSync.includes("已同步")) missing.push("docs sync");
  if (residualRisk.length < 20 || ["待同步", "未运行", "缺"].some((token) => residualRisk.includes(token))) {
    missing.push("residual risk");
  }

  return missing;
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

function findLine(content: string, needle: string): string | undefined {
  return content.split(/\r?\n/).find((line) => line.includes(needle));
}

function parseMarkdownCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
