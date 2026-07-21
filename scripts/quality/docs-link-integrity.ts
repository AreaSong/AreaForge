import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

interface BrokenLink {
  file: string;
  line: number;
  target: string;
}

const workspaceRoot = process.cwd();

const scanRoots = ["docs", "workflow", "tasks", "ops"] as const;
const scanFiles = ["README.md", "AGENTS.md", "SECURITY.md", "SUPPORT.md", "CODE_REVIEW.md"] as const;

const markdownLinkPattern = /\[[^\]]*\]\(([^()\s]+(?:\([^()]*\)[^()\s]*)*)\)/g;

function main(): void {
  const broken: BrokenLink[] = [];
  let scannedFiles = 0;
  let checkedLinks = 0;

  for (const file of collectMarkdownFiles()) {
    scannedFiles += 1;
    checkedLinks += checkFile(file, broken);
  }

  if (broken.length > 0) {
    for (const item of broken) {
      console.error(`FAIL ${item.file}:${item.line}: broken relative link -> ${item.target}`);
    }
    console.error(`docs link integrity failed: ${broken.length} broken link(s) across ${scannedFiles} markdown file(s).`);
    process.exit(1);
  }

  console.log(
    `docs link integrity passed: ${checkedLinks} relative link(s) across ${scannedFiles} markdown file(s) resolve to existing repository paths.`,
  );
}

function collectMarkdownFiles(): string[] {
  const results: string[] = [];
  for (const file of scanFiles) {
    const absolute = path.join(workspaceRoot, file);
    if (existsSync(absolute)) results.push(absolute);
  }
  const skipDirs = new Set(["node_modules", ".next", "generated", "dist"]);
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (!skipDirs.has(entry)) walk(absolute);
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

function checkFile(absoluteFile: string, broken: BrokenLink[]): number {
  const relativeFile = path.relative(workspaceRoot, absoluteFile);
  const lines = readFileSync(absoluteFile, "utf8").split(/\r?\n/);
  let checked = 0;
  let insideFence = false;

  lines.forEach((text, index) => {
    if (/^\s*(```|~~~)/.test(text)) {
      insideFence = !insideFence;
      return;
    }
    if (insideFence) return;

    for (const match of text.matchAll(markdownLinkPattern)) {
      const rawTarget = match[1] ?? "";
      const target = normalizeTarget(rawTarget);
      if (!target) continue;
      checked += 1;
      const resolved = target.startsWith("/")
        ? path.join(workspaceRoot, target)
        : path.resolve(path.dirname(absoluteFile), target);
      if (!existsSync(resolved)) {
        broken.push({ file: relativeFile, line: index + 1, target: rawTarget });
      }
    }
  });

  return checked;
}

function normalizeTarget(rawTarget: string): string | null {
  const withoutAnchor = rawTarget.split("#")[0]?.trim() ?? "";
  if (!withoutAnchor) return null;
  if (/^(?:https?|mailto|tel):/i.test(withoutAnchor)) return null;
  // 模板占位（<version>、X.Y.Z、通配）不作为可解析路径检查。
  if (/[<>*]|X\.Y\.Z|vX\./.test(withoutAnchor)) return null;
  try {
    return decodeURIComponent(withoutAnchor);
  } catch {
    return withoutAnchor;
  }
}

main();
