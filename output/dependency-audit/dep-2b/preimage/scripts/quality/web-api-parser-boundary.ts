import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

/**
 * Client-side API bodies must go through the shared parser in
 * `apps/web/lib/api/client.ts`. This check deliberately scans only browser
 * code, including App Router modules with a valid top-level `"use client"`
 * directive; server request parsing remains owned by `apps/web/lib/api/auth.ts`.
 */
export const PARSER_MODULE = "@/lib/api/client" as const;
export const PARSER_IMPLEMENTATION = "apps/web/lib/api/client.ts" as const;
export const PARSER_HELPER_NAMES = ["readApiJson", "parseApiJson", "parseResponseJson", "readResponseJson"] as const;

export interface ParserBoundaryViolation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

export const TRANSPORT_BOUNDARY_REASON = "direct fetch is forbidden in browser components and client adapters; use a typed adapter from @/lib/api" as const;

export interface ParserBoundaryOptions {
  /**
   * Request parsing is a server concern and is rejected by default. Focused
   * AST tests may enable it only to verify request/response classification.
   */
  allowRequestJson?: boolean;
}

export interface ParserImportReference {
  file: string;
  line: number;
  specifier: string;
  typeOnly: boolean;
  dynamic: boolean;
  text: string;
}

interface SourceContext {
  sourceFile: ts.SourceFile;
  requestBindings: Set<string>;
}

const sourceExtensions = /\.(?:ts|tsx|mts|cts)$/;
const appClientExtensions = /\.tsx?$/;
const skipDirectories = new Set(["node_modules", ".next", "dist", "generated", "coverage"]);
const skippedFileSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".d.ts"];
const requestIdentifierPattern = /^(?:request|req)$/i;
const responseIdentifierPattern = /^(?:response|res)$/i;
const staticResponseFactories = new Set(["Response", "NextResponse"]);

/**
 * Scan the browser component/client roots for direct body parsing.  The
 * returned paths are workspace-relative and sorted for deterministic output.
 */
export function collectParserViolations(
  workspaceRoot = process.cwd(),
  options: ParserBoundaryOptions = {},
): ParserBoundaryViolation[] {
  const allowRequestJson = options.allowRequestJson ?? false;
  const violations: ParserBoundaryViolation[] = [];
  const roots = ["apps/web/components", "apps/web/lib/client"];

  for (const relativeRoot of roots) {
    const absoluteRoot = path.join(workspaceRoot, relativeRoot);
    if (!existsSync(absoluteRoot)) {
      violations.push({
        file: relativeRoot,
        line: 1,
        text: "",
        reason: "parser boundary root is missing",
      });
      continue;
    }
    for (const file of listSourceFiles(absoluteRoot)) {
      const relative = toWorkspaceRelative(file, workspaceRoot);
      if (relative === PARSER_IMPLEMENTATION || isTestFile(file)) continue;
      scanFile(file, workspaceRoot, allowRequestJson, violations);
    }
  }

  const appRoot = "apps/web/app";
  const absoluteAppRoot = path.join(workspaceRoot, appRoot);
  if (!existsSync(absoluteAppRoot)) {
    violations.push({ file: appRoot, line: 1, text: "", reason: "parser boundary root is missing" });
  } else {
    for (const file of listSourceFiles(absoluteAppRoot)) {
      if (!appClientExtensions.test(file) || isTestFile(file) || !hasUseClientDirective(file)) continue;
      scanFile(file, workspaceRoot, allowRequestJson, violations);
    }
  }

  return violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.reason.localeCompare(right.reason));
}

/**
 * Return parser imports found by the same TypeScript AST traversal used by the
 * gate.  Keeping this exported makes import-shape regressions testable without
 * coupling the gate to a regular-expression approximation.
 */
export function collectParserImports(workspaceRoot: string, file: string): ParserImportReference[] {
  const absolute = path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
  if (!existsSync(absolute)) return [];
  const source = readFileSync(absolute, "utf8");
  const sourceFile = createSourceFile(absolute, source);
  const references: ParserImportReference[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (isParserSpecifier(node.moduleSpecifier.text, sourceFile, workspaceRoot)) {
        addImportReference(
          sourceFile,
          workspaceRoot,
          node.moduleSpecifier.text,
          importDeclarationIsTypeOnly(node),
          false,
          node,
          references,
        );
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (isParserSpecifier(node.moduleSpecifier.text, sourceFile, workspaceRoot)) {
        addImportReference(
          sourceFile,
          workspaceRoot,
          node.moduleSpecifier.text,
          exportDeclarationIsTypeOnly(node),
          false,
          node,
          references,
        );
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument) && isParserSpecifier(argument.text, sourceFile, workspaceRoot)) {
        addImportReference(sourceFile, workspaceRoot, argument.text, false, true, node, references);
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteralLike(expression) && isParserSpecifier(expression.text, sourceFile, workspaceRoot)) {
        addImportReference(sourceFile, workspaceRoot, expression.text, node.isTypeOnly, false, node, references);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      if (isParserSpecifier(node.argument.literal.text, sourceFile, workspaceRoot)) {
        addImportReference(sourceFile, workspaceRoot, node.argument.literal.text, true, false, node, references);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function isParserSpecifier(specifier: string, sourceFile: ts.SourceFile, workspaceRoot: string): boolean {
  if (specifier === PARSER_MODULE || specifier === `${PARSER_MODULE}.ts`) return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(sourceFile.fileName), specifier);
  const parserPath = path.resolve(workspaceRoot, PARSER_IMPLEMENTATION);
  return resolved === parserPath || resolved.replace(/\.(?:ts|tsx|mts|cts)$/, "") === parserPath.replace(/\.ts$/, "");
}

/** Classify a `.json` receiver for focused AST tests and downstream gates. */
export function classifyJsonReceiver(
  expression: ts.Expression,
  requestBindings: ReadonlySet<string> = new Set(["request", "req"]),
): "request" | "response" | "unknown" | "static-response-factory" {
  const receiver = unwrapExpression(expression);
  if (isStaticResponseFactory(receiver)) return "static-response-factory";
  if (isRequestExpression(receiver, requestBindings)) return "request";
  if (isResponseExpression(receiver)) return "response";
  return "unknown";
}

function scanFile(
  file: string,
  workspaceRoot: string,
  allowRequestJson: boolean,
  violations: ParserBoundaryViolation[],
): void {
  const source = readFileSync(file, "utf8");
  const sourceFile = createSourceFile(file, source);
  const parseDiagnostics = getParseDiagnostics(sourceFile);
  for (const diagnostic of parseDiagnostics) {
    const position = diagnostic.start ?? 0;
    violations.push({
      file: toWorkspaceRelative(file, workspaceRoot),
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      text: sourceFile.text.split(/\r?\n/)[sourceFile.getLineAndCharacterOfPosition(position).line] ?? "",
      reason: `unable to parse TypeScript source: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    });
  }
  if (parseDiagnostics.length > 0) return;

  const context: SourceContext = { sourceFile, requestBindings: new Set(["request", "req"]) };
  collectTypedBindings(sourceFile, context.requestBindings);
  const seen = new Set<string>();

  const report = (node: ts.Node, receiver: ts.Expression): void => {
    const kind = classifyJsonReceiver(receiver, context.requestBindings);
    if (kind === "static-response-factory") return;
    if (kind === "request" && allowRequestJson) return;
    const start = node.getStart(sourceFile);
    const line = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
    const reason = kind === "request"
      ? "request.json() is reserved for server request parsing and is disabled for this browser parser boundary"
      : kind === "response"
        ? "direct response.json() parsing is forbidden; use readApiJson from @/lib/api/client"
        : "unknown receiver .json() parsing is forbidden; use readApiJson from @/lib/api/client";
    const key = `${start}:${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({
      file: toWorkspaceRelative(file, workspaceRoot),
      line,
      text: node.getText(sourceFile),
      reason,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (isDirectFetchCall(node.expression)) {
        const start = node.getStart(sourceFile);
        const line = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const key = `${start}:direct-fetch`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({
            file: toWorkspaceRelative(file, workspaceRoot),
            line,
            text: node.getText(sourceFile),
            reason: TRANSPORT_BOUNDARY_REASON,
          });
        }
      }
      const access = getJsonAccess(node.expression);
      if (access) report(node, access.receiver);
    } else {
      const access = getJsonAccessIfExpression(node);
      if (access && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        report(node, access.receiver);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isDirectFetchCall(expression: ts.Expression): boolean {
  const receiver = unwrapExpression(expression);
  if (ts.isIdentifier(receiver)) return receiver.text === "fetch";
  if (!ts.isPropertyAccessExpression(receiver)) return false;
  if (receiver.name.text !== "fetch") return false;
  const owner = unwrapExpression(receiver.expression);
  return ts.isIdentifier(owner) && (owner.text === "window" || owner.text === "globalThis");
}

function getParseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  // `parseDiagnostics` is populated by the TypeScript parser but is not part
  // of the public SourceFile type.  Reading it through a narrow structural
  // cast keeps this quality script type-safe across TypeScript minor versions.
  return (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
}

function createSourceFile(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function collectTypedBindings(sourceFile: ts.SourceFile, requestBindings: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      const name = getIdentifierName(node.name);
      if (name && isRequestType(node.type)) requestBindings.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isRequestType(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false;
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    return name === "Request" || name.endsWith("Request");
  }
  return false;
}

function getIdentifierName(name: ts.BindingName): string | null {
  return ts.isIdentifier(name) ? name.text : null;
}

function getJsonAccess(expression: ts.Expression): { receiver: ts.Expression } | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "json") {
    return { receiver: unwrapped.expression };
  }
  if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression && isJsonString(unwrapped.argumentExpression)) {
    return { receiver: unwrapped.expression };
  }
  return null;
}

function getJsonAccessIfExpression(node: ts.Node): { receiver: ts.Expression } | null {
  if (!ts.isExpression(node)) return null;
  return getJsonAccess(node);
}

function isJsonString(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node) && node.text === "json";
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isStaticResponseFactory(expression: ts.Expression): boolean {
  const receiver = unwrapExpression(expression);
  if (ts.isIdentifier(receiver)) return staticResponseFactories.has(receiver.text);
  if (ts.isPropertyAccessExpression(receiver)) return staticResponseFactories.has(receiver.name.text) && isGlobalThis(receiver.expression);
  return false;
}

function isGlobalThis(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isIdentifier(unwrapped) && unwrapped.text === "globalThis";
}

function isRequestExpression(expression: ts.Expression, requestBindings: ReadonlySet<string>): boolean {
  const receiver = unwrapExpression(expression);
  if (ts.isIdentifier(receiver)) return requestBindings.has(receiver.text) || requestIdentifierPattern.test(receiver.text);
  if (ts.isPropertyAccessExpression(receiver)) {
    if (receiver.name.text === "request") return true;
    return receiver.name.text === "clone" && isRequestExpression(receiver.expression, requestBindings);
  }
  if (ts.isElementAccessExpression(receiver)) return false;
  if (ts.isCallExpression(receiver)) return isRequestExpression(receiver.expression, requestBindings);
  if (ts.isNewExpression(receiver)) {
    const expressionName = receiver.expression.getText();
    return expressionName === "Request" || expressionName.endsWith(".Request");
  }
  return false;
}

function isResponseExpression(expression: ts.Expression): boolean {
  const receiver = unwrapExpression(expression);
  if (ts.isIdentifier(receiver)) return responseIdentifierPattern.test(receiver.text);
  if (ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver)) {
    return isResponseExpression(receiver.expression);
  }
  if (ts.isCallExpression(receiver)) return isResponseExpression(receiver.expression);
  return false;
}

function addImportReference(
  sourceFile: ts.SourceFile,
  workspaceRoot: string,
  specifier: string,
  typeOnly: boolean,
  dynamic: boolean,
  node: ts.Node,
  references: ParserImportReference[],
): void {
  const start = node.getStart(sourceFile);
  references.push({
    file: toWorkspaceRelative(sourceFile.fileName, workspaceRoot),
    line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
    specifier,
    typeOnly,
    dynamic,
    text: node.getText(sourceFile),
  });
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((item) => item.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return node.exportClause.elements.length > 0 && node.exportClause.elements.every((item) => item.isTypeOnly);
}

function listSourceFiles(directory: string): string[] {
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (!skipDirectories.has(entry)) walk(absolute);
        continue;
      }
      if (sourceExtensions.test(entry) && !entry.endsWith(".d.ts")) result.push(absolute);
    }
  };
  walk(directory);
  return result;
}

function isTestFile(file: string): boolean {
  return skippedFileSuffixes.some((suffix) => file.endsWith(suffix));
}

function hasUseClientDirective(file: string): boolean {
  const sourceFile = createSourceFile(file, readFileSync(file, "utf8"));
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteralLike(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function toWorkspaceRelative(file: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, file).split(path.sep).join("/");
}

function resolveWorkspaceRoot(argv: string[]): string {
  const index = argv.indexOf("--workspace");
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : process.cwd();
}

function main(): void {
  const workspaceRoot = resolveWorkspaceRoot(process.argv.slice(2));
  const violations = collectParserViolations(workspaceRoot);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`FAIL ${violation.file}:${violation.line}: ${violation.reason}`);
      if (violation.text.trim()) console.error(`  ${violation.text.trim()}`);
    }
    console.error(`web API parser boundary check failed: ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log("web API parser boundary check passed: browser response bodies use the shared API parser.");
}

if (process.argv[1]?.endsWith("web-api-parser-boundary.ts")) main();
