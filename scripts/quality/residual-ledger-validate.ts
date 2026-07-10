import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface ResidualLedger {
  schemaVersion: number;
  source: string;
  items: ResidualItem[];
}

interface ResidualItem {
  id: string;
  type: string;
  reviewAt: string;
  currentImpact: string;
  executableNow: boolean;
  closeCondition: string;
  requiredEvidence: string;
  ownerSkills: string[];
}

interface MarkdownResidual {
  id: string;
  type: string;
  reviewAt: string;
  executableNow: boolean;
}

interface Issue {
  field: string;
  message: string;
}

const root = process.cwd();
const markdownPath = "docs/development/residual-risk-ledger.md";
const jsonPath = "docs/development/residual-risk-ledger.json";
const taskIndexPath = "tasks/indexes/residuals.md";
const allowedTypes = new Set([
  "current-blocker",
  "deferred-work",
  "accepted-exception",
  "monitoring-gap",
  "release-follow-up",
  "historical-reference",
  "template-marker",
  "closed-evidence",
]);
const allowedPrefixes = new Set(["OPS", "REL", "SC", "UX", "AI"]);

function main(): void {
  const issues: Issue[] = [];
  if (!existsSync(resolve(markdownPath))) issues.push({ field: markdownPath, message: "missing markdown ledger" });
  if (!existsSync(resolve(jsonPath))) issues.push({ field: jsonPath, message: "missing machine-readable ledger" });
  if (!existsSync(resolve(taskIndexPath))) issues.push({ field: taskIndexPath, message: "missing task-facing residual index" });
  if (issues.length > 0) fail(issues);

  const markdown = read(markdownPath);
  const taskIndex = read(taskIndexPath);
  const ledger = readLedger(jsonPath, issues);
  const markdownItems = parseMarkdownResiduals(markdown);
  validateLedgerShape(ledger, issues);
  validateMarkdownSync(ledger, markdownItems, issues);
  validateTaskIndexSync(ledger, taskIndex, issues);
  validateReferences(ledger, issues);

  if (issues.length > 0) fail(issues);
  console.log(`residual ledger validation passed: ${ledger.items.length} residual IDs are machine-readable and synced with markdown/task index.`);
}

function readLedger(file: string, issues: Issue[]): ResidualLedger {
  try {
    return JSON.parse(read(file)) as ResidualLedger;
  } catch (error) {
    issues.push({ field: file, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
    return { schemaVersion: 0, source: "", items: [] };
  }
}

function validateLedgerShape(ledger: ResidualLedger, issues: Issue[]): void {
  if (ledger.schemaVersion !== 1) {
    issues.push({ field: "schemaVersion", message: "must be 1" });
  }
  if (ledger.source !== markdownPath) {
    issues.push({ field: "source", message: `must be ${markdownPath}` });
  }
  if (!Array.isArray(ledger.items) || ledger.items.length === 0) {
    issues.push({ field: "items", message: "must contain at least one residual item" });
    return;
  }

  const seen = new Set<string>();
  for (const [index, item] of ledger.items.entries()) {
    const prefix = item.id.match(/^AF-RISK-([A-Z]+)-\d{3}$/)?.[1] ?? "";
    if (!prefix || !allowedPrefixes.has(prefix)) {
      issues.push({ field: `items[${index}].id`, message: "must match AF-RISK-(OPS|REL|SC|UX|AI)-NNN" });
    }
    if (seen.has(item.id)) {
      issues.push({ field: `items[${index}].id`, message: "duplicate residual ID" });
    }
    seen.add(item.id);
    if (!allowedTypes.has(item.type)) {
      issues.push({ field: `${item.id}.type`, message: `invalid type ${item.type}` });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.reviewAt)) {
      issues.push({ field: `${item.id}.reviewAt`, message: "must be YYYY-MM-DD" });
    }
    for (const field of ["currentImpact", "closeCondition", "requiredEvidence"] as const) {
      if (!item[field] || item[field].trim().length === 0) {
        issues.push({ field: `${item.id}.${field}`, message: "must be non-empty" });
      }
    }
    if (!Array.isArray(item.ownerSkills) || item.ownerSkills.length === 0) {
      issues.push({ field: `${item.id}.ownerSkills`, message: "must list at least one owner skill" });
    }
  }
}

function validateMarkdownSync(ledger: ResidualLedger, markdownItems: MarkdownResidual[], issues: Issue[]): void {
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
    if (!jsonIds.has(item.id)) {
      issues.push({ field: item.id, message: "missing from machine-readable residual ledger" });
    }
  }
}

function validateReferences(ledger: ResidualLedger, issues: Issue[]): void {
  const operationalReadiness = read("docs/development/operational-readiness.md");
  const completionRecord = read("docs/development/docs-100-completion-record.md");
  const validationMatrix = read("docs/development/validation-matrix.md");
  const combined = `${operationalReadiness}\n${completionRecord}\n${validationMatrix}`;
  for (const item of ledger.items) {
    if (!combined.includes(item.id) && item.type !== "deferred-work") {
      issues.push({ field: item.id, message: "non-deferred residual should be referenced by operational/completion/validation docs" });
    }
  }

  const ops001 = ledger.items.find((item) => item.id === "AF-RISK-OPS-001");
  if (ops001) {
    const combinedOps001Text = [
      ops001.currentImpact,
      ops001.closeCondition,
      ops001.requiredEvidence,
    ].join("\n");
    for (const term of ["pnpm ops:ops-001:preflight", "ready_for_human_close", "pnpm ops:ops-001:closure:validate"]) {
      if (!combinedOps001Text.includes(term)) {
        issues.push({ field: "AF-RISK-OPS-001", message: `missing OPS-001 source term: ${term}` });
      }
    }
  }
}

function validateTaskIndexSync(ledger: ResidualLedger, taskIndex: string, issues: Issue[]): void {
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
    "AF-RISK-UX-001": [
      "pnpm experience:review:validate",
    ],
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

function fail(issues: Issue[]): never {
  for (const issue of issues) {
    console.error(`FAIL ${issue.field}: ${issue.message}`);
  }
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
