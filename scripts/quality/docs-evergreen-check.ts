import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

interface Violation {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

const workspaceRoot = process.cwd();

// 长期文档集合：正文禁止版本号、日期和 Package/Batch 过程叙事。
// 指定状态入口（README 状态节、AGENTS、operational-readiness、feature-traceability、
// residual 台账、workflow/**、tasks/**、docs/development/** 记录）不在扫描范围。
const scanRoots = [
  "docs/guide",
  "docs/product",
  "docs/modules",
  "docs/architecture",
  "docs/ux",
] as const;

const forbiddenPatterns: { name: string; regex: RegExp }[] = [
  { name: "package-narrative", regex: /Package [A-E]\b/ },
  { name: "batch-narrative", regex: /Batch ?[0-9DE]/ },
  { name: "implementation-status-heading", regex: /当前实现状态/ },
  { name: "pinned-version", regex: /\bv?0\.1\.[0-9]\b/ },
  { name: "pinned-date", regex: /\b20\d{2}-\d{2}-\d{2}\b/ },
];

// 白名单：门禁脚本要求的锚点短语与长期成立的产品/代码事实。
// 新增条目必须注明保留原因；白名单只按"文件 + 行内容"放行，不放行整个文件。
const allowlist: { file: string; allow: RegExp; reason: string }[] = [
  {
    file: "docs/modules/mastery-proof.md",
    allow: /Package B Batch 4/,
    reason: "docs-100-readiness.ts 要求该文档保留的追踪锚点",
  },
  {
    file: "docs/guide/configuration.md",
    allow: /`0\.1\.0`/,
    reason: "packages/config schema 中 APP_VERSION 的代码默认值",
  },
  {
    file: "docs/product/charter.md",
    allow: /2026-07-05/,
    reason: "备考起始日期，产品事实",
  },
  {
    file: "docs/product/roadmap.md",
    allow: /2026-07-05/,
    reason: "备考起始日期，产品事实",
  },
];

function main(): void {
  const violations: Violation[] = [];
  let scannedFiles = 0;

  for (const file of collectMarkdownFiles()) {
    scannedFiles += 1;
    checkFile(file, violations);
  }

  if (violations.length > 0) {
    for (const item of violations) {
      console.error(`FAIL ${item.file}:${item.line}: [${item.pattern}] ${item.text.trim()}`);
    }
    console.error(
      `docs evergreen check failed: ${violations.length} stage-narrative violation(s) across ${scannedFiles} long-term doc(s). ` +
        "长期文档不写版本号、日期或 Package/Batch 叙事；状态收敛到指定入口（见 doc-sync-checklist 文档分层规则）。",
    );
    process.exit(1);
  }

  console.log(
    `docs evergreen check passed: ${scannedFiles} long-term doc(s) contain no version pins, dates, or stage narrative outside the allowlist.`,
  );
}

function collectMarkdownFiles(): string[] {
  const results: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.endsWith(".md")) results.push(absolute);
    }
  };
  for (const root of scanRoots) {
    const absolute = path.join(workspaceRoot, root);
    if (existsSync(absolute)) walk(absolute);
  }
  return results;
}

function checkFile(absoluteFile: string, violations: Violation[]): void {
  const relativeFile = path.relative(workspaceRoot, absoluteFile).split(path.sep).join("/");
  const fileAllows = allowlist.filter((entry) => entry.file === relativeFile);
  const lines = readFileSync(absoluteFile, "utf8").split(/\r?\n/);

  lines.forEach((text, index) => {
    if (fileAllows.some((entry) => entry.allow.test(text))) return;
    for (const pattern of forbiddenPatterns) {
      if (pattern.regex.test(text)) {
        violations.push({
          file: relativeFile,
          line: index + 1,
          pattern: pattern.name,
          text,
        });
      }
    }
  });
}

main();
