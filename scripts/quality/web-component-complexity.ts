import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

export const DEFAULT_COMPONENT_LINE_LIMIT = 500;
export const DEFAULT_CLIENT_STATE_LINE_LIMIT = 500;
export const DEFAULT_FUNCTION_LINE_LIMIT = 50;
const COMPONENT_ROOTS = ["apps/web/app", "apps/web/components", "apps/web/lib/routes"] as const;
const CLIENT_STATE_ROOTS = ["apps/web/lib/client"] as const;

/** Legacy exceptions are closed; every scanned non-test TSX file uses the hard limit. */
export const LEGACY_COMPONENT_LINE_BUDGETS: Readonly<Record<string, number>> = {};

export interface ComponentComplexityViolation {
  file: string;
  line: number;
  reason: string;
}

export interface LongFunctionObservation {
  file: string;
  line: number;
  name: string;
  lines: number;
}

export interface ClientStateComplexityViolation {
  file: string;
  line: number;
  reason: string;
}

export interface ComponentComplexityReport {
  scannedFiles: number;
  legacyFiles: number;
  violations: ComponentComplexityViolation[];
  stateScannedFiles: number;
  stateViolations: ClientStateComplexityViolation[];
  longFunctions: LongFunctionObservation[];
}

export function inspectComponentComplexity(
  workspaceRoot = process.cwd(),
): ComponentComplexityReport {
  const violations: ComponentComplexityViolation[] = [];
  const stateViolations: ClientStateComplexityViolation[] = [];
  const longFunctions: LongFunctionObservation[] = [];
  const files: string[] = [];
  for (const root of COMPONENT_ROOTS) {
    const absolute = path.join(workspaceRoot, root);
    if (!existsSync(absolute)) {
      violations.push({ file: root, line: 1, reason: "component complexity root is missing" });
      continue;
    }
    files.push(...listTsxFiles(absolute));
  }
  files.sort();

  for (const file of files) {
    const relative = toRelative(workspaceRoot, file);
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const diagnostics = getParseDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      const first = diagnostics[0]!;
      violations.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(first.start ?? 0).line + 1,
        reason: `cannot measure malformed TSX: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
      });
      continue;
    }

    const lines = physicalLineCount(source);
    if (lines > DEFAULT_COMPONENT_LINE_LIMIT) {
      violations.push({
        file: relative,
        line: 1,
        reason: `${lines} lines exceeds the ${DEFAULT_COMPONENT_LINE_LIMIT}-line component limit`,
      });
    }
    collectLongFunctions(sourceFile, relative, longFunctions);
  }

  const stateFiles: string[] = [];
  for (const root of CLIENT_STATE_ROOTS) {
    const absolute = path.join(workspaceRoot, root);
    if (!existsSync(absolute)) continue;
    stateFiles.push(...listTsFiles(absolute));
  }
  stateFiles.sort();
  for (const file of stateFiles) {
    const relative = toRelative(workspaceRoot, file);
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diagnostics = getParseDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      const first = diagnostics[0]!;
      stateViolations.push({
        file: relative,
        line: sourceFile.getLineAndCharacterOfPosition(first.start ?? 0).line + 1,
        reason: `cannot measure malformed client state TS: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
      });
      continue;
    }
    const lines = physicalLineCount(source);
    if (lines > DEFAULT_CLIENT_STATE_LINE_LIMIT) {
      stateViolations.push({
        file: relative,
        line: 1,
        reason: `${lines} lines exceeds the ${DEFAULT_CLIENT_STATE_LINE_LIMIT}-line client state limit`,
      });
    }
    collectLongFunctions(sourceFile, relative, longFunctions);
  }

  return {
    scannedFiles: files.length,
    legacyFiles: Object.keys(LEGACY_COMPONENT_LINE_BUDGETS).length,
    violations,
    stateScannedFiles: stateFiles.length,
    stateViolations,
    longFunctions: longFunctions.sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file)),
  };
}

function collectLongFunctions(
  sourceFile: ts.SourceFile,
  file: string,
  observations: LongFunctionObservation[],
): void {
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      const lines = end - start + 1;
      if (lines > DEFAULT_FUNCTION_LINE_LIMIT) {
        observations.push({ file, line: start, name: functionName(node), lines });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText();
  return "<anonymous>";
}

function physicalLineCount(source: string): number {
  if (source.length === 0) return 0;
  const breaks = source.match(/\n/g)?.length ?? 0;
  return breaks + (source.endsWith("\n") ? 0 : 1);
}

function getParseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
}

function listTsxFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (["node_modules", ".next", "dist", "generated", "coverage"].includes(entry)) continue;
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (entry.endsWith(".tsx") && !/(?:\.test|\.spec)\.tsx$/.test(entry)) result.push(absolute);
    }
  };
  walk(directory);
  return result;
}

function listTsFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (["node_modules", ".next", "dist", "generated", "coverage"].includes(entry)) continue;
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !/(?:\.test|\.spec)\.ts$/.test(entry)) result.push(absolute);
    }
  };
  walk(directory);
  return result;
}

function toRelative(workspaceRoot: string, file: string): string {
  return path.relative(workspaceRoot, file).split(path.sep).join("/");
}

function main(): void {
  const report = inspectComponentComplexity();
  for (const violation of [...report.violations, ...report.stateViolations]) {
    console.error(`${violation.file}:${violation.line}: ${violation.reason}`);
  }
  if (report.violations.length > 0) process.exit(1);
  if (report.stateViolations.length > 0) process.exit(1);

  const longest = report.longFunctions.slice(0, 10);
  console.log(
    `web component complexity passed: ${report.scannedFiles} TSX files and ${report.stateScannedFiles} client state TS files, `
    + `${report.legacyFiles} legacy file budgets, ${report.longFunctions.length} functions above `
    + `${DEFAULT_FUNCTION_LINE_LIMIT} lines observed`,
  );
  for (const item of longest) {
    console.log(`  warning ${item.file}:${item.line} ${item.name} (${item.lines} lines)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
