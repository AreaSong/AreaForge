import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

export interface ClientBoundaryViolation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

export interface ClientBoundarySummary {
  storage: Record<string, number>;
  status: Record<string, number>;
}

export interface ClientBoundaryBudgets {
  storage: Readonly<Record<string, number>>;
  status: Readonly<Record<string, number>>;
}

const CLIENT_ROOTS = ["apps/web/components", "apps/web/lib/client"] as const;
const USE_CLIENT_ROOTS = ["apps/web/app", "apps/web/lib/routes"] as const;
const STORAGE_PORT = "apps/web/lib/client/storage-port.ts";
const API_ERRORS = "apps/web/lib/client/api-errors.ts";
const sourceExtensions = /\.(?:ts|tsx)$/;
const skippedDirectories = new Set(["generated", "node_modules", "ui"]);
const appSkippedDirectories = new Set(["generated", "node_modules"]);
const skippedFileSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".d.ts"];
const statusOperators = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** Historical debt is cleared; any direct browser-global storage access fails. */
export const STORAGE_LEGACY_BUDGET: Readonly<Record<string, number>> = {};

/** Shared API error predicates are the target replacement and stay exempt. */
export const STATUS_LEGACY_BUDGET: Readonly<Record<string, number>> = {};

const DEFAULT_BUDGETS: ClientBoundaryBudgets = {
  storage: STORAGE_LEGACY_BUDGET,
  status: STATUS_LEGACY_BUDGET,
};

/**
 * Gate browser-global storage resolution and scattered HTTP status branching
 * in browser components, client adapters, and App Router `"use client"` modules.
 */
export function collectClientBoundaryViolations(
  workspaceRoot = process.cwd(),
  budgets: ClientBoundaryBudgets = DEFAULT_BUDGETS,
): ClientBoundaryViolation[] {
  const violations: ClientBoundaryViolation[] = [];
  const storageCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  const files = listClientSourceFiles(workspaceRoot, violations);
  const program = createSourceProgram(files);
  const checker = program.getTypeChecker();
  for (const file of files) {
    const relative = toWorkspaceRelative(file, workspaceRoot);
    const sourceFile = program.getSourceFile(file) ?? createSourceFile(file, readFileSync(file, "utf8"));
    const diagnostics = getParseDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      for (const diagnostic of diagnostics) addParseViolation(violations, sourceFile, relative, diagnostic);
      continue;
    }

    let storageCount = 0;
    let statusCount = 0;
    const visit = (node: ts.Node): void => {
      if (isBrowserStorageAccess(node)) storageCount += 1;
      if (isExplicitStatusComparison(node, checker)) statusCount += 1;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    if (storageCount > 0 && relative !== STORAGE_PORT) storageCounts.set(relative, storageCount);
    if (statusCount > 0 && relative !== API_ERRORS) statusCounts.set(relative, statusCount);
  }

  enforceBudget("browser storage access", storageCounts, budgets.storage, violations);
  enforceBudget("explicit HTTP 401/409 status comparison", statusCounts, budgets.status, violations);
  return violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.reason.localeCompare(right.reason));
}

export function collectClientBoundarySummary(workspaceRoot = process.cwd()): ClientBoundarySummary {
  const storage: Record<string, number> = {};
  const status: Record<string, number> = {};
  const parseViolations: ClientBoundaryViolation[] = [];
  const files = listClientSourceFiles(workspaceRoot, parseViolations);
  const program = createSourceProgram(files);
  const checker = program.getTypeChecker();
  for (const file of files) {
    const relative = toWorkspaceRelative(file, workspaceRoot);
    const sourceFile = program.getSourceFile(file) ?? createSourceFile(file, readFileSync(file, "utf8"));
    if (getParseDiagnostics(sourceFile).length > 0) continue;
    let storageCount = 0;
    let statusCount = 0;
    const visit = (node: ts.Node): void => {
      if (isBrowserStorageAccess(node)) storageCount += 1;
      if (isExplicitStatusComparison(node, checker)) statusCount += 1;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (storageCount > 0 && relative !== STORAGE_PORT) storage[relative] = storageCount;
    if (statusCount > 0 && relative !== API_ERRORS) status[relative] = statusCount;
  }
  return { storage, status };
}

function enforceBudget(
  rule: string,
  actual: ReadonlyMap<string, number>,
  budget: Readonly<Record<string, number>>,
  violations: ClientBoundaryViolation[],
): void {
  for (const [file, count] of actual) {
    const allowed = budget[file];
    if (allowed === undefined) {
      violations.push({ file, line: 1, text: "", reason: `${rule} is not in the legacy budget (${count} occurrence(s))` });
    } else if (count !== allowed) {
      violations.push({ file, line: 1, text: "", reason: `${rule} count ${count} does not match exact legacy budget ${allowed}` });
    }
  }
  for (const [file, count] of Object.entries(budget)) {
    if (!actual.has(file)) {
      violations.push({ file, line: 1, text: "", reason: `${rule} legacy budget ${count} is stale and must be removed` });
    }
  }
}

function isBrowserStorageAccess(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const name = getStaticPropertyName(node);
  if (name !== "localStorage" && name !== "sessionStorage") return false;
  const owner = unwrapExpression(node.expression);
  return ts.isIdentifier(owner) && (owner.text === "window" || owner.text === "globalThis");
}

function isExplicitStatusComparison(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (!ts.isBinaryExpression(node) || !statusOperators.has(node.operatorToken.kind)) return false;
  return (isStatusAccess(node.left, checker) && isTargetStatusCode(node.right))
    || (isTargetStatusCode(node.left) && isStatusAccess(node.right, checker));
}

function isStatusAccess(
  node: ts.Expression,
  checker: ts.TypeChecker,
  visited = new Set<ts.Symbol>(),
): boolean {
  const candidate = unwrapExpression(node);
  if ((ts.isPropertyAccessExpression(candidate) || ts.isElementAccessExpression(candidate))
    && getStaticPropertyName(candidate) === "status") return true;
  if (!ts.isIdentifier(candidate)) return false;

  const symbol = checker.getSymbolAtLocation(candidate);
  if (!symbol) return isStatusLikeName(candidate.text);
  if (visited.has(symbol)) return false;
  visited.add(symbol);
  return symbol.declarations?.some((declaration) => isStatusDeclaration(declaration, checker, visited)) ?? false;
}

function isStatusDeclaration(
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
  visited: Set<ts.Symbol>,
): boolean {
  if (ts.isBindingElement(declaration)) {
    const propertyName = declaration.propertyName && staticPropertyName(declaration.propertyName);
    return propertyName === "status"
      || (ts.isIdentifier(declaration.name) && isStatusLikeName(declaration.name.text));
  }
  if (!ts.isVariableDeclaration(declaration) && !ts.isParameter(declaration)) return false;
  if (!ts.isIdentifier(declaration.name)) return false;
  if (isStatusLikeName(declaration.name.text)) return true;
  return Boolean(declaration.initializer && isStatusAccess(declaration.initializer, checker, visited));
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function isStatusLikeName(name: string): boolean {
  return /^(?:(?:http|response)Status(?:Code)?|status(?:Code)?)$/i.test(name);
}

function isTargetStatusCode(node: ts.Expression): boolean {
  const candidate = unwrapExpression(node);
  return ts.isNumericLiteral(candidate) && (candidate.text === "401" || candidate.text === "409");
}

function getStaticPropertyName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

function listClientSourceFiles(workspaceRoot: string, violations: ClientBoundaryViolation[]): string[] {
  const files: string[] = [];
  for (const relativeRoot of CLIENT_ROOTS) {
    const absoluteRoot = path.join(workspaceRoot, relativeRoot);
    if (!existsSync(absoluteRoot)) {
      violations.push({ file: relativeRoot, line: 1, text: "", reason: "client boundary root is missing" });
      continue;
    }
    collectSourceFiles(absoluteRoot, files, skippedDirectories, false);
  }

  for (const relativeRoot of USE_CLIENT_ROOTS) {
    const absoluteRoot = path.join(workspaceRoot, relativeRoot);
    if (!existsSync(absoluteRoot)) {
      violations.push({ file: relativeRoot, line: 1, text: "", reason: "client boundary root is missing" });
    } else {
      collectSourceFiles(absoluteRoot, files, appSkippedDirectories, true);
    }
  }
  return files.sort();
}

function createSourceProgram(files: string[]): ts.Program {
  return ts.createProgram({
    rootNames: files,
    options: {
      jsx: ts.JsxEmit.Preserve,
      noResolve: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.Latest,
    },
  });
}

function collectSourceFiles(
  directory: string,
  files: string[],
  directoriesToSkip: ReadonlySet<string>,
  useClientOnly: boolean,
): void {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (!directoriesToSkip.has(entry)) collectSourceFiles(absolute, files, directoriesToSkip, useClientOnly);
      continue;
    }
    if (!sourceExtensions.test(entry) || skippedFileSuffixes.some((suffix) => entry.endsWith(suffix))) continue;
    if (!useClientOnly || hasUseClientDirective(absolute)) files.push(absolute);
  }
}

function hasUseClientDirective(file: string): boolean {
  const sourceFile = createSourceFile(file, readFileSync(file, "utf8"));
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteralLike(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function createSourceFile(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function getParseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
}

function addParseViolation(violations: ClientBoundaryViolation[], sourceFile: ts.SourceFile, file: string, diagnostic: ts.Diagnostic): void {
  const position = diagnostic.start ?? 0;
  const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  violations.push({
    file,
    line,
    text: sourceFile.text.split(/\r?\n/)[line - 1] ?? "",
    reason: `unable to parse TypeScript source: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
  });
}

function toWorkspaceRelative(file: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, file).split(path.sep).join("/");
}

function resolveWorkspaceRoot(argv: string[]): string {
  const index = argv.indexOf("--workspace");
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : process.cwd();
}

function formatDebt(summary: Record<string, number>): string {
  const entries = Object.entries(summary).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0 ? "none" : entries.map(([file, count]) => `${file}=${count}`).join(", ");
}

function main(): void {
  const workspaceRoot = resolveWorkspaceRoot(process.argv.slice(2));
  const violations = collectClientBoundaryViolations(workspaceRoot);
  const summary = collectClientBoundarySummary(workspaceRoot);
  console.log(`web client boundary debt: storage [${formatDebt(summary.storage)}]`);
  console.log(`web client boundary debt: status [${formatDebt(summary.status)}]`);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`FAIL ${violation.file}:${violation.line}: ${violation.reason}`);
      if (violation.text.trim()) console.error(`  ${violation.text.trim()}`);
    }
    console.error(`web client boundary check failed: ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log("web client boundary check passed: direct browser storage and explicit 401/409 comparisons are absent.");
}

if (process.argv[1]?.endsWith("web-client-boundary.ts")) main();
