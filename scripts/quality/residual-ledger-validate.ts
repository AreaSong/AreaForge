import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type ResidualItemV2,
  type ResidualLedgerIssue,
  type ResidualLedgerV2,
  validateResidualLedgerV2,
} from "./residual-ledger-common";

interface MarkdownResidual {
  id: string;
  type: string;
  reviewAt: string;
  executableNow: boolean;
}

const root = process.cwd();
const markdownPath = "docs/development/residual-risk-ledger.md";
const jsonPath = "docs/development/residual-risk-ledger.json";
const taskIndexPath = "tasks/indexes/residuals.md";

function main(): void {
  const issues: ResidualLedgerIssue[] = [];
  if (!existsSync(resolve(markdownPath))) issues.push({ field: markdownPath, message: "missing markdown ledger" });
  if (!existsSync(resolve(jsonPath))) issues.push({ field: jsonPath, message: "missing machine-readable ledger" });
  if (!existsSync(resolve(taskIndexPath))) issues.push({ field: taskIndexPath, message: "missing task-facing residual index" });
  if (issues.length > 0) fail(issues);

  const markdown = read(markdownPath);
  const taskIndex = read(taskIndexPath);
  const result = validateResidualLedgerV2(readLedger(jsonPath, issues), { root });
  issues.push(...result.issues);
  const ledger = result.ledger;
  validateMarkdownSync(ledger, parseMarkdownResiduals(markdown), issues);
  validateTaskIndexSync(ledger, taskIndex, issues);
  validateReferences(ledger, issues);
  validateCurrentStatusClaims(ledger, issues);

  if (issues.length > 0) fail(issues);
  console.log(`residual ledger validation passed: ${ledger.items.length} schema V2 residual IDs are synced and executable bindings are valid.`);
}

function readLedger(file: string, issues: ResidualLedgerIssue[]): unknown {
  try {
    return JSON.parse(read(file)) as unknown;
  } catch (error) {
    issues.push({ field: file, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
}

function validateMarkdownSync(
  ledger: ResidualLedgerV2,
  markdownItems: MarkdownResidual[],
  issues: ResidualLedgerIssue[],
): void {
  const byId = new Map(markdownItems.map((item) => [item.id, item]));
  const jsonIds = new Set(ledger.items.map((item) => item.id));
  for (const item of ledger.items) {
    const markdown = byId.get(item.id);
    if (!markdown) {
      issues.push({ field: item.id, message: "missing from markdown residual table" });
      continue;
    }
    if (markdown.type !== item.type) {
      issues.push({ field: item.id, message: `type mismatch: json=${item.type}, markdown=${markdown.type}` });
    }
    if (markdown.reviewAt !== item.reviewAt) {
      issues.push({ field: item.id, message: `reviewAt mismatch: json=${item.reviewAt}, markdown=${markdown.reviewAt}` });
    }
    if (markdown.executableNow !== item.executableNow) {
      issues.push({ field: item.id, message: `executableNow mismatch: json=${item.executableNow}, markdown=${markdown.executableNow}` });
    }
  }
  for (const item of markdownItems) {
    if (!jsonIds.has(item.id)) issues.push({ field: item.id, message: "missing from machine-readable residual ledger" });
  }
}

function validateReferences(ledger: ResidualLedgerV2, issues: ResidualLedgerIssue[]): void {
  const combined = [
    read("docs/development/operational-readiness.md"),
    read("docs/development/docs-100-completion-record.md"),
    read("docs/development/validation-matrix.md"),
  ].join("\n");
  for (const item of ledger.items) {
    if (!combined.includes(item.id) && item.type !== "deferred-work") {
      issues.push({ field: item.id, message: "non-deferred residual should be referenced by operational/completion/validation docs" });
    }
  }
  const ops001 = ledger.items.find((item) => item.id === "AF-RISK-OPS-001");
  if (ops001) validateOps001SourceTerms(ops001, issues);
}

function validateOps001SourceTerms(item: ResidualItemV2, issues: ResidualLedgerIssue[]): void {
  const text = [item.currentImpact, item.closeCondition, item.requiredEvidence].join("\n");
  for (const term of ["pnpm ops:ops-001:preflight", "ready_for_human_close", "pnpm ops:ops-001:closure:validate"]) {
    if (!text.includes(term)) issues.push({ field: item.id, message: `missing OPS-001 source term: ${term}` });
  }
}

function validateTaskIndexSync(
  ledger: ResidualLedgerV2,
  taskIndex: string,
  issues: ResidualLedgerIssue[],
): void {
  for (const item of ledger.items) {
    if (!taskIndex.includes(item.id)) {
      issues.push({ field: `${taskIndexPath}:${item.id}`, message: "missing from task-facing residual index" });
    }
  }
  const requiredTermsById: Record<string, string[]> = {
    "AF-RISK-OPS-001": [
      "pnpm ops:ops-001:preflight",
      "pnpm ops:ops-001:closure:validate",
      "redacted update-agent status",
      "operational evidence bundle",
    ],
    "AF-RISK-SC-002": [
      "pnpm sc:sc-002:preflight",
      "pnpm ci:supply-chain:validate",
      "pnpm release:supply-chain:validate",
    ],
    "AF-RISK-UX-001": ["pnpm experience:review:validate"],
  };
  for (const [id, terms] of Object.entries(requiredTermsById)) {
    if (!taskIndex.includes(id)) continue;
    for (const term of terms) {
      if (!taskIndex.includes(term)) {
        issues.push({ field: `${taskIndexPath}:${id}`, message: `missing task-facing term: ${term}` });
      }
    }
  }
}

function validateCurrentStatusClaims(ledger: ResidualLedgerV2, issues: ResidualLedgerIssue[]): void {
  const currentDocs = [
    "docs/development/operational-readiness.md",
    "docs/development/long-term-operability-control-plane.md",
  ];
  for (const item of ledger.items) {
    const lines = currentDocs
      .flatMap((file) => read(file).split(/\r?\n/).map((line) => ({ file, line })))
      .filter(({ line }) => line.trimStart().startsWith(`- \`${item.id}\``));
    if (item.type === "current-blocker") {
      for (const { file, line } of lines) {
        if (/已关闭|closed as|status\s*[=:]\s*closed/i.test(line)) {
          issues.push({ field: `${file}:${item.id}`, message: "current-blocker must not be described as closed in current status text" });
        }
      }
    }
    if (item.id === "AF-RISK-UX-001" && /\bfail\b/i.test(item.currentImpact)) {
      for (const { file, line } of lines) {
        if (/复核通过|reviewStatus\s*[=:]\s*pass|local smoke[^。；]*通过/i.test(line)) {
          issues.push({ field: `${file}:${item.id}`, message: "UX monitoring gap with a fail record must not be described as passed" });
        }
      }
    }
  }
}

function parseMarkdownResiduals(markdown: string): MarkdownResidual[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| AF-RISK-"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map((cells) => ({
      id: cells[0] ?? "",
      type: cells[1] ?? "",
      reviewAt: cells[2] ?? "",
      executableNow: (cells[4] ?? "") === "是",
    }));
}

function fail(issues: ResidualLedgerIssue[]): never {
  for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
  console.error(`residual ledger validation failed: ${issues.length} issue(s).`);
  process.exit(1);
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
