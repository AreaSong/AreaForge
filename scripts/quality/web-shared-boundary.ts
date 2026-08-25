import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

export const INVENTORY_SCHEMA_VERSION = 1 as const;
export const INVENTORY_MODE = "areaforge_web_shared_capability_inventory" as const;

export const CAPABILITY_KINDS = [
  "react-primitives",
  "route-contract",
  "pure-route-helper",
  "pure-helper",
  "browser-adapter",
  "type-contract",
  "pure-domain-rules",
  "browser-primitives",
  "browser-state-primitives",
  "browser-event-adapter",
  "server-adapter",
  "security-boundary",
  "quality-policy",
] as const;

export const CAPABILITY_STATUSES = [
  "active",
  "in-progress",
  "pending-confirmation",
] as const;

export const CAPABILITY_BATCHES = [
  "keep-and-batch1",
  "batch1",
  "batch2",
  "batch3",
  "batch4",
  "batch5",
  "batch6",
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];
export type CapabilityBatch = (typeof CAPABILITY_BATCHES)[number];

export interface CapabilityInventoryItem {
  id: string;
  path: string;
  kind: string;
  owner: string;
  status: string;
  batch: string;
  contract: string;
  validation: string[];
}

export interface CapabilityInventory {
  schemaVersion: number;
  mode: string;
  owner: string;
  capabilities: CapabilityInventoryItem[];
}

export interface BoundaryViolation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

interface ModuleReference {
  specifier: string;
  typeOnly: boolean;
  node: ts.Node;
}

const root = process.cwd();
const sourceExtensions = /\.(?:ts|tsx|mts|cts)$/;
const serverComponentStudyImportAllowlist = new Map([
  ["apps/web/components/workspace-required-layout.tsx", "@/lib/study/exam-workspace-service"],
]);
const legacyStudyServiceRoot = "apps/web/lib/study";
const canonicalContractsRoot = "apps/web/lib/contracts";
const browserApiRoot = "apps/web/lib/api";
const browserClientRoot = "apps/web/lib/client";
const removedStudyFacades = [
  "apps/web/lib/contracts/study.ts",
  "apps/web/lib/study/service.ts",
  "apps/web/lib/study/types.ts",
] as const;
const inventoryKeys = new Set(["id", "path", "kind", "owner", "status", "batch", "contract", "validation"]);
const inventoryRootKeys = new Set(["schemaVersion", "mode", "owner", "capabilities"]);
const capabilityIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** 严格校验只读清单；先校验路径形状，再访问文件系统，避免畸形输入逃逸门禁。 */
export function validateInventory(value: unknown, workspaceRoot = root): string[] {
  if (!isRecord(value)) return ["inventory must be an object"];
  const errors: string[] = [];
  reportUnknownKeys(value, inventoryRootKeys, "inventory", errors);

  if (value.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${INVENTORY_SCHEMA_VERSION}`);
  }
  if (value.mode !== INVENTORY_MODE) errors.push("mode is invalid");
  requireNonEmptyString(value.owner, "owner", errors);

  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    errors.push("capabilities must be a non-empty array");
    return errors;
  }

  const ids = new Map<string, number>();
  const paths: Array<{ index: number; value: string }> = [];

  for (const [index, candidate] of value.capabilities.entries()) {
    const field = `capabilities[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(`${field} must be an object`);
      continue;
    }
    reportUnknownKeys(candidate, inventoryKeys, field, errors);

    const id = requireNonEmptyString(candidate.id, `${field}.id`, errors);
    if (id) {
      if (!capabilityIdPattern.test(id)) errors.push(`${field}.id must be kebab-case`);
      const previous = ids.get(id);
      if (previous !== undefined) {
        errors.push(`${field}.id must be unique (already used by capabilities[${previous}])`);
      } else {
        ids.set(id, index);
      }
    }

    const capabilityPath = requireInventoryPath(candidate.path, `${field}.path`, workspaceRoot, errors);
    if (capabilityPath) paths.push({ index, value: capabilityPath });
    const kind = requireEnum(candidate.kind, CAPABILITY_KINDS, `${field}.kind`, errors);
    requireEnum(candidate.status, CAPABILITY_STATUSES, `${field}.status`, errors);
    requireNonEmptyString(candidate.owner, `${field}.owner`, errors);
    requireEnum(candidate.batch, CAPABILITY_BATCHES, `${field}.batch`, errors);
    const contractPath = requireInventoryPath(candidate.contract, `${field}.contract`, workspaceRoot, errors);
    validateValidationCommands(candidate.validation, field, errors);

    if (candidate.status === "legacy-facade" || isLegacyStudyServicePath(capabilityPath)) {
      errors.push(`${field} exposes a legacy study service; legacy-facade capabilities are forbidden`);
    }
    if (isLegacyStudyServicePath(contractPath)) {
      errors.push(`${field}.contract must not point at a legacy study service`);
    }
    if (kind === "server-adapter" && isLegacyStudyServicePath(capabilityPath)) {
      errors.push(`${field} must not publish a server-adapter under apps/web/lib/study`);
    }
    if (id === "study-services") {
      errors.push(`${field}.id study-services is a forbidden legacy service capability`);
    }
    if (id === "dto-contracts" && capabilityPath !== canonicalContractsRoot) {
      errors.push(`${field}.path must be ${canonicalContractsRoot} for the canonical DTO contract scope`);
    }
    if (
      kind === "type-contract"
      && capabilityPath?.startsWith(`${canonicalContractsRoot}/`)
    ) {
      errors.push(`${field}.path must use the single canonical DTO contract scope ${canonicalContractsRoot}`);
    }
  }

  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      const first = paths[left];
      const second = paths[right];
      if (!pathsOverlap(first.value, second.value)) continue;
      errors.push(
        `capabilities[${first.index}].path overlaps capabilities[${second.index}].path `
        + `(${first.value} and ${second.value}); parent, child, and intersecting scopes are forbidden`,
      );
    }
  }
  return errors;
}

export function collectBoundaryViolations(workspaceRoot = root): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const relative of removedStudyFacades) {
    if (!existsSync(path.join(workspaceRoot, relative))) continue;
    violations.push({
      file: relative,
      line: 1,
      text: "",
      reason: "removed study compatibility facades must not be recreated",
    });
  }
  for (const file of listSourceFiles(path.join(workspaceRoot, "apps/web"), true)) {
    scanLegacyStudyFacadeImports(file, workspaceRoot, violations);
  }
  for (const file of listSourceFiles(path.join(workspaceRoot, "apps/web/components"))) {
    const relative = path.relative(workspaceRoot, file).split(path.sep).join("/");
    if (relative.startsWith("apps/web/components/ui/")) continue;
    scanFile(file, workspaceRoot, violations, [
      { pattern: /@areaforge\/(?:db|storage)\b|@prisma\/client\b/, reason: "components must not access database or storage adapters directly" },
    ]);
    scanTypeOnlyStudyImports(file, workspaceRoot, violations);
    scanClientStudyImports(file, workspaceRoot, violations);
  }
  for (const file of listSourceFiles(path.join(workspaceRoot, "apps/web/components/ui"))) {
    scanFile(file, workspaceRoot, violations, [
      { pattern: /@\/lib\/(?:study|client|auth)\b|@areaforge\/(?:db|storage|ai)\b|@prisma\/client\b/, reason: "shared UI primitives must not depend on business, browser-state, auth, or persistence adapters" },
    ]);
    scanModuleReferences(file, workspaceRoot, violations, (reference) => {
      if (isApiModule(reference.specifier, file, workspaceRoot)) {
        return "shared UI primitives must not depend on API transport adapters";
      }
      return null;
    });
  }
  for (const file of listSourceFiles(path.join(workspaceRoot, "apps/web/lib/contracts"), true)) {
    scanFile(file, workspaceRoot, violations, [
      { pattern: /(?:from|import\()\s*["'](?:next|react|@areaforge\/(?:db|storage|ai)|@\/components|@\/lib\/client)/, reason: "contracts must remain type-only and platform-neutral" },
    ]);
    scanContractStudyImports(file, workspaceRoot, violations);
  }
  for (const file of listSourceFiles(path.join(workspaceRoot, "apps/web/lib/study"))) {
    if (isTestFile(file)) continue;
    scanModuleReferences(file, workspaceRoot, violations, (reference) => {
      if (reference.specifier.startsWith("@/components/")) {
        return "study services must not depend on UI components";
      }
      if (reference.specifier.startsWith("@/lib/client/")) {
        return "study services must not depend on browser/client adapters";
      }
      return null;
    });
  }
  for (const file of listSourceFiles(path.join(workspaceRoot, "apps/web/lib/client"), true)) {
    scanTypeOnlyStudyImports(file, workspaceRoot, violations);
    scanClientStudyImports(file, workspaceRoot, violations);
  }
  for (const file of listSourceFiles(path.join(workspaceRoot, browserApiRoot), true)) {
    if (isTestFile(file)) continue;
    scanModuleReferences(file, workspaceRoot, violations, (reference) => {
      // Type-only references erase at build time and do not reverse runtime ownership.
      if (!reference.typeOnly && isClientModule(reference.specifier, file, workspaceRoot)) {
        return "API transport adapters must not runtime-depend on browser/client adapters";
      }
      return null;
    });
  }
  return violations;
}

function scanLegacyStudyFacadeImports(
  file: string,
  workspaceRoot: string,
  violations: BoundaryViolation[],
): void {
  scanModuleReferences(file, workspaceRoot, violations, (reference) => {
    if (reference.specifier === "@/lib/study/service" || reference.specifier === "@/lib/study/service.ts") {
      return "the removed study service facade must not be imported; use the concrete study owner";
    }
    if (!reference.specifier.startsWith(".")) return null;
    const resolved = path.resolve(path.dirname(file), reference.specifier);
    const facade = path.resolve(workspaceRoot, "apps/web/lib/study/service");
    return resolved === facade || resolved === `${facade}.ts`
      ? "the removed relative study service facade must not be imported"
      : null;
  });
}

function isTestFile(file: string): boolean {
  return /(?:\.test|\.spec)\.(?:ts|tsx|mts|cts)$/.test(file);
}

function scanTypeOnlyStudyImports(
  file: string,
  workspaceRoot: string,
  violations: BoundaryViolation[],
): void {
  scanModuleReferences(file, workspaceRoot, violations, (reference) => {
    if (!reference.typeOnly || !isStudyModule(reference.specifier, file, workspaceRoot)) {
      return null;
    }
    return "components and browser clients must consume shared DTO types through @/lib/contracts";
  });
}

function scanClientStudyImports(
  file: string,
  workspaceRoot: string,
  violations: BoundaryViolation[],
): void {
  const relative = path.relative(workspaceRoot, file).split(path.sep).join("/");
  const allowedSpecifier = serverComponentStudyImportAllowlist.get(relative);
  scanModuleReferences(file, workspaceRoot, violations, (reference) => {
    if (!reference.typeOnly && isStudyModule(reference.specifier, file, workspaceRoot) && reference.specifier !== allowedSpecifier) {
      return "components and browser clients may not runtime-import legacy study services; use contracts or a pure domain module";
    }
    return null;
  });
}

function scanContractStudyImports(
  file: string,
  workspaceRoot: string,
  violations: BoundaryViolation[],
): void {
  scanModuleReferences(file, workspaceRoot, violations, (reference) => {
    if (!isStudyModule(reference.specifier, file, workspaceRoot)) return null;
    if (!reference.typeOnly) return "contracts must not runtime-import legacy study services";
    return "contracts must define canonical DTOs without importing legacy study services";
  });
}

function scanModuleReferences(
  file: string,
  workspaceRoot: string,
  violations: BoundaryViolation[],
  reasonFor: (reference: ModuleReference) => string | null,
): void {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: ModuleReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: importDeclarationIsTypeOnly(node),
        node,
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: exportDeclarationIsTypeOnly(node),
        node,
      });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        references.push({ specifier: argument.text, typeOnly: false, node });
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        references.push({ specifier: argument.text, typeOnly: false, node });
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteralLike(expression)) {
        references.push({ specifier: expression.text, typeOnly: node.isTypeOnly, node });
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      references.push({ specifier: node.argument.literal.text, typeOnly: true, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const seen = new Set<string>();
  for (const reference of references) {
    const reason = reasonFor(reference);
    if (!reason) continue;
    const start = reference.node.getStart(sourceFile);
    const key = `${start}:${reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      file: path.relative(workspaceRoot, file).split(path.sep).join("/"),
      line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
      text: reference.node.getText(sourceFile),
      reason,
    });
  }
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings) return false;
  if (!ts.isNamedImports(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((item) => item.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return node.exportClause.elements.length > 0 && node.exportClause.elements.every((item) => item.isTypeOnly);
}

function scanFile(
  file: string,
  workspaceRoot: string,
  violations: BoundaryViolation[],
  rules: Array<{ pattern: RegExp; reason: string }>,
): void {
  const relative = path.relative(workspaceRoot, file).split(path.sep).join("/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((text, index) => {
    if (/^\s*(?:\/\/|\*)/.test(text)) return;
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(text)) violations.push({ file: relative, line: index + 1, text, reason: rule.reason });
    }
  });
}

function listSourceFiles(directory: string, _optional = false): string[] {
  if (!existsSync(directory)) return [];
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (sourceExtensions.test(entry) && !entry.endsWith(".d.ts")) result.push(absolute);
    }
  };
  walk(directory);
  return result;
}

function reportUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, field: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${field}.${key} is not allowed by the inventory contract`);
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    errors.push(`${field} must be a non-empty string`);
    return null;
  }
  return value;
}

function requireEnum<T extends readonly string[]>(value: unknown, allowed: T, field: string, errors: string[]): T[number] | null {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${field} must be one of ${allowed.join(", ")}`);
    return null;
  }
  return value as T[number];
}

function validateValidationCommands(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field}.validation must be a non-empty array`);
    return;
  }
  const seen = new Set<string>();
  for (const [index, command] of value.entries()) {
    if (typeof command !== "string" || command.trim().length === 0 || command !== command.trim()) {
      errors.push(`${field}.validation[${index}] must be a non-empty string`);
      continue;
    }
    if (seen.has(command)) errors.push(`${field}.validation must not contain duplicates`);
    seen.add(command);
  }
}

function requireInventoryPath(value: unknown, field: string, workspaceRoot: string, errors: string[]): string | null {
  const candidate = requireNonEmptyString(value, field, errors);
  if (!candidate) return null;
  const normalized = normalizeInventoryPath(candidate);
  if (!normalized) {
    errors.push(`${field} must be a normalized relative path without traversal, separators, or globs`);
    return null;
  }
  const absolute = path.resolve(workspaceRoot, normalized);
  const resolvedRoot = path.resolve(workspaceRoot);
  if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`)) {
    errors.push(`${field} escapes the workspace root`);
    return null;
  }
  if (!existsSync(absolute)) errors.push(`${field} references missing path ${normalized}`);
  return normalized;
}

function normalizeInventoryPath(value: string): string | null {
  if (
    value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || value.endsWith("/")
    || value.includes("\\")
    || value.includes("\0")
    || value.includes("*")
    || value.includes("?")
    || value.includes("[")
    || value.includes("]")
  ) return null;
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function isLegacyStudyServicePath(value: string | null): boolean {
  return value === legacyStudyServiceRoot || value?.startsWith(`${legacyStudyServiceRoot}/`) === true;
}

function isStudyModule(value: string, importerFile?: string, workspaceRoot?: string): boolean {
  if (value === "@/lib/study" || value.startsWith("@/lib/study/")) return true;
  if (!importerFile || !workspaceRoot || !value.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(importerFile), value);
  const studyRoot = path.resolve(workspaceRoot, legacyStudyServiceRoot);
  return resolved === studyRoot || resolved.startsWith(`${studyRoot}${path.sep}`);
}

function isApiModule(value: string, importerFile?: string, workspaceRoot?: string): boolean {
  if (value === "@/lib/api" || value.startsWith("@/lib/api/")) return true;
  if (!importerFile || !workspaceRoot || !value.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(importerFile), value);
  const apiRoot = path.resolve(workspaceRoot, browserApiRoot);
  return resolved === apiRoot || resolved.startsWith(`${apiRoot}${path.sep}`);
}

function isClientModule(value: string, importerFile: string, workspaceRoot: string): boolean {
  if (value === "@/lib/client" || value.startsWith("@/lib/client/")) return true;
  if (!value.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(importerFile), value);
  const clientRoot = path.resolve(workspaceRoot, browserClientRoot);
  return resolved === clientRoot || resolved.startsWith(`${clientRoot}${path.sep}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function main(): void {
  const inventoryPath = path.join(root, "docs/architecture/web-shared-capability-inventory.json");
  let inventory: unknown;
  try {
    inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as unknown;
  } catch (error) {
    console.error(`FAIL inventory: unable to parse ${inventoryPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const inventoryErrors = validateInventory(inventory);
  const violations = collectBoundaryViolations();
  if (inventoryErrors.length > 0 || violations.length > 0) {
    for (const error of inventoryErrors) console.error(`FAIL inventory: ${error}`);
    for (const violation of violations) {
      console.error(`FAIL ${violation.file}:${violation.line}: ${violation.reason}`);
      console.error(`  ${violation.text.trim()}`);
    }
    process.exit(1);
  }
  console.log("web shared boundary check passed: inventory, UI ownership, contracts, and API/study directions are valid.");
}

if (process.argv[1]?.endsWith("web-shared-boundary.ts")) main();
