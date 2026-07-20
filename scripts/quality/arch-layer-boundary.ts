import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

interface BoundaryRule {
  name: string;
  root: string;
  exclude?: RegExp;
  forbiddenImports: { pattern: RegExp; reason: string }[];
  forbiddenUsages?: { pattern: RegExp; reason: string }[];
}

interface Violation {
  rule: string;
  file: string;
  line: number;
  text: string;
  reason: string;
}

const workspaceRoot = process.cwd();

// 分层源事实见 docs/architecture/overview.md 与 AGENTS.md：
// - 页面和组件不直接调用 Prisma，数据库访问集中在 packages/db 的公开入口。
// - packages/core 平台无关，不依赖 Next.js、React、Prisma、浏览器 API 或环境变量。
// - packages/ai 只生成建议或草稿，不直接读写数据库。
const rules: BoundaryRule[] = [
  {
    name: "apps/web must access the database only through @areaforge/db public entry",
    root: "apps/web",
    forbiddenImports: [
      { pattern: /^@prisma\/client(\/|$)/, reason: "import Prisma client via @areaforge/db instead" },
      { pattern: /^@areaforge\/db\/(generated|src)(\/|$)/, reason: "deep import into packages/db internals is forbidden" },
      { pattern: /(^|\/)packages\/db\/(generated|src)(\/|$)/, reason: "relative reach into packages/db internals is forbidden" },
    ],
  },
  {
    name: "packages/core must stay platform-agnostic",
    root: "packages/core",
    forbiddenImports: [
      { pattern: /^next(\/|$)/, reason: "core must not depend on Next.js" },
      { pattern: /^react(-dom)?(\/|$)/, reason: "core must not depend on React" },
      { pattern: /^@prisma\/client(\/|$)/, reason: "core must not depend on Prisma" },
      { pattern: /^@areaforge\/(db|web|storage)(\/|$)/, reason: "core must not depend on db/web/storage packages" },
    ],
    forbiddenUsages: [
      { pattern: /\bprocess\.env\b/, reason: "core must not read environment variables" },
      {
        // 只匹配明确的浏览器 API 成员访问，避免把领域词（如时间窗口参数 window）误报。
        pattern:
          /\bwindow\.(?:location|document|localStorage|sessionStorage|addEventListener|navigator|history|fetch)\b|\bdocument\.(?:querySelector|getElementById|createElement|cookie|body|title)\b|\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\b/,
        reason: "core must not use browser APIs",
      },
    ],
  },
  {
    name: "packages/ai must not access the database directly",
    root: "packages/ai",
    forbiddenImports: [
      { pattern: /^@prisma\/client(\/|$)/, reason: "ai must not depend on Prisma" },
      { pattern: /^@areaforge\/db(\/|$)/, reason: "ai only produces suggestions/drafts and must not touch the database" },
    ],
  },
];

const importStatementPattern =
  /(?:^|\s)(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function main(): void {
  const violations: Violation[] = [];
  for (const rule of rules) {
    const rootDir = path.join(workspaceRoot, rule.root);
    if (!existsSync(rootDir)) {
      console.error(`FAIL ${rule.root}: layer root is missing; the boundary rule cannot be enforced.`);
      process.exit(1);
    }
    for (const file of listSourceFiles(rootDir)) {
      const relative = path.relative(workspaceRoot, file);
      if (rule.exclude?.test(relative)) continue;
      collectViolations(rule, relative, readFileSync(file, "utf8"), violations);
    }
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`FAIL ${violation.file}:${violation.line}: ${violation.reason} [${violation.rule}]`);
      console.error(`  ${violation.text.trim()}`);
    }
    console.error(`arch layer boundary check failed: ${violations.length} violation(s).`);
    process.exit(1);
  }

  console.log(
    "arch layer boundary check passed: apps/web uses only the @areaforge/db public entry, packages/core stays platform-agnostic, and packages/ai does not touch the database.",
  );
}

export function collectViolations(
  rule: BoundaryRule,
  file: string,
  content: string,
  violations: Violation[],
): void {
  const lines = content.split(/\r?\n/);
  lines.forEach((text, index) => {
    if (/^\s*(?:\/\/|\*)/.test(text)) return;
    for (const match of text.matchAll(importStatementPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      for (const forbidden of rule.forbiddenImports) {
        if (forbidden.pattern.test(specifier)) {
          violations.push({ rule: rule.name, file, line: index + 1, text, reason: forbidden.reason });
        }
      }
    }
    for (const usage of rule.forbiddenUsages ?? []) {
      if (usage.pattern.test(text) && !isStringOnlyMatch(text, usage.pattern)) {
        violations.push({ rule: rule.name, file, line: index + 1, text, reason: usage.reason });
      }
    }
  });
}

function isStringOnlyMatch(line: string, pattern: RegExp): boolean {
  // 去掉字符串字面量后再匹配一次，避免把提示文案（如 "DATABASE_URL is required"）误报为用法。
  const withoutStrings = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return !pattern.test(withoutStrings);
}

function listSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const skipDirs = new Set(["node_modules", ".next", "generated", "dist", "coverage"]);
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (!skipDirs.has(entry)) walk(absolute);
        continue;
      }
      if (/\.(ts|tsx|mts|cts)$/.test(entry) && !entry.endsWith(".d.ts")) {
        results.push(absolute);
      }
    }
  };
  walk(dir);
  return results;
}

main();
