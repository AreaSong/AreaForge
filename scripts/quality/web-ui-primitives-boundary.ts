import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

export const RAW_UI_PRIMITIVE_TAGS = ["input", "select", "textarea", "button"] as const;
export type RawUiPrimitiveTag = (typeof RAW_UI_PRIMITIVE_TAGS)[number];
export type UiPrimitiveCounts = Partial<Record<RawUiPrimitiveTag, number>>;

export const PUBLIC_UI_CLONE_KINDS = [
  "local-icon-button",
  "segmented-control-clone",
  "tablist-clone",
  "color-swatch-clone",
] as const;
export type PublicUiCloneKind = (typeof PUBLIC_UI_CLONE_KINDS)[number];
export type PublicUiCloneCounts = Partial<Record<PublicUiCloneKind, number>>;

export interface PublicUiCloneViolation {
  file: string;
  line: number;
  kind: PublicUiCloneKind;
  message: string;
}

export interface PublicUiPaletteOccurrence {
  file: string;
  line: number;
  fingerprint: string;
  colors: string[];
}

/**
 * 公共 UI 克隆的精确迁移台账。迁移完成后应删除对应条目，而不是扩大预算。
 * 预算按文件和规则精确计数，避免用一个总数掩盖新增债务。
 */
export const PUBLIC_UI_CLONE_BUDGET: Readonly<Record<string, Readonly<PublicUiCloneCounts>>> = {};

/**
 * 复杂 Tabs 可以保留自己的面板/流程语义，但必须显式登记；简单互斥模式仍应使用 SegmentedControl。
 */
export const PUBLIC_UI_CLONE_ALLOWLIST: Readonly<Record<string, readonly PublicUiCloneKind[]>> = {
  "apps/web/app/login/components/journey-timeline.tsx": ["tablist-clone"],
  "apps/web/components/simulation-detail-workspace.tsx": ["tablist-clone"],
};

/**
 * 现有原生控件的精确迁移台账。新增债务必须先迁移到 components/ui 原语；
 * 不允许通过新增文件或放宽此处计数绕过门禁。
 */
export const LEGACY_UI_PRIMITIVE_BUDGET: Readonly<Record<string, Readonly<UiPrimitiveCounts>>> = {};

export interface UiPrimitiveDebt {
  file: string;
  line: number;
  tag: RawUiPrimitiveTag;
}

export interface UiPrimitiveParseFailure {
  file: string;
  line: number;
  message: string;
}

export interface UiPrimitiveBoundaryReport {
  debt: UiPrimitiveDebt[];
  parseFailures: UiPrimitiveParseFailure[];
  summary: Record<string, UiPrimitiveCounts>;
  publicUiViolations: PublicUiCloneViolation[];
  publicUiSummary: Record<string, PublicUiCloneCounts>;
  publicUiPalettes: PublicUiPaletteOccurrence[];
  issues: string[];
}

const root = process.cwd();
const scanRoots = ["apps/web/app", "apps/web/components", "apps/web/lib/routes"];
const excludedDirectoryNames = new Set(["ui", "tests", "__tests__", "generated", "__generated__"]);
const exemptInputTypes = new Set(["file", "hidden"]);

export function collectUiPrimitiveBoundaryReport(
  workspaceRoot = root,
  budget: Readonly<Record<string, Readonly<UiPrimitiveCounts>>> = LEGACY_UI_PRIMITIVE_BUDGET,
  publicUiBudget: Readonly<Record<string, Readonly<PublicUiCloneCounts>>> = PUBLIC_UI_CLONE_BUDGET,
  publicUiAllowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>> = PUBLIC_UI_CLONE_ALLOWLIST,
): UiPrimitiveBoundaryReport {
  const debt: UiPrimitiveDebt[] = [];
  const parseFailures: UiPrimitiveParseFailure[] = [];
  const publicUiViolations: PublicUiCloneViolation[] = [];
  const publicUiPalettes: PublicUiPaletteOccurrence[] = [];

  for (const scanRoot of scanRoots) {
    const excludeUiPrimitives = scanRoot === "apps/web/components";
    const absoluteRoot = path.join(workspaceRoot, scanRoot);
    if (!existsSync(absoluteRoot)) {
      parseFailures.push({ file: scanRoot, line: 1, message: "UI primitive boundary root is missing" });
      continue;
    }
    for (const file of listTsxFiles(absoluteRoot, excludeUiPrimitives)) {
      scanTsxFile(file, workspaceRoot, debt, parseFailures, publicUiViolations, publicUiPalettes, publicUiAllowlist);
    }
  }

  // 原语目录不参与 raw 控件债务统计，但仍要阻止第二套公共原语实现。
  const uiRoot = path.join(workspaceRoot, "apps/web/components/ui");
  for (const file of listTsxFiles(uiRoot, false)) {
    scanPublicTsxFile(file, workspaceRoot, parseFailures, publicUiViolations, publicUiPalettes, publicUiAllowlist);
  }

  appendDuplicatePaletteViolations(publicUiPalettes, publicUiViolations, publicUiAllowlist);
  const summary = summarizeDebt(debt);
  const publicUiSummary = summarizePublicUiViolations(publicUiViolations);
  const issues = [...parseFailures.map((failure) => `${failure.file}:${failure.line} cannot parse TSX: ${failure.message}`)];
  for (const [file, counts] of Object.entries(summary)) {
    const allowed = budget[file];
    if (!allowed) {
      issues.push(`${file} introduces unbudgeted raw UI primitives: ${formatCounts(counts)}`);
      continue;
    }
    for (const tag of RAW_UI_PRIMITIVE_TAGS) {
      const actual = counts[tag] ?? 0;
      const limit = allowed[tag] ?? 0;
      if (actual !== limit) issues.push(`${file} ${tag} debt is ${actual}, but the exact legacy budget is ${limit}`);
    }
  }
  for (const [file, counts] of Object.entries(budget)) {
    if (summary[file]) continue;
    issues.push(`${file} has a stale legacy budget (${formatCounts(counts)}); remove the cleared debt entry`);
  }

  appendPublicUiIssues(issues, publicUiViolations, publicUiSummary, publicUiBudget);

  return { debt, parseFailures, summary, publicUiViolations, publicUiSummary, publicUiPalettes, issues };
}

export function assertUiPrimitiveBoundary(
  workspaceRoot = root,
  budget: Readonly<Record<string, Readonly<UiPrimitiveCounts>>> = LEGACY_UI_PRIMITIVE_BUDGET,
  publicUiBudget: Readonly<Record<string, Readonly<PublicUiCloneCounts>>> = PUBLIC_UI_CLONE_BUDGET,
  publicUiAllowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>> = PUBLIC_UI_CLONE_ALLOWLIST,
): UiPrimitiveBoundaryReport {
  const report = collectUiPrimitiveBoundaryReport(workspaceRoot, budget, publicUiBudget, publicUiAllowlist);
  printDebtSummary(report.summary);
  if (report.issues.length > 0) throw new Error(`web UI primitive boundary failed:\n${report.issues.join("\n")}`);
  return report;
}

function scanTsxFile(
  file: string,
  workspaceRoot: string,
  debt: UiPrimitiveDebt[],
  parseFailures: UiPrimitiveParseFailure[],
  publicUiViolations: PublicUiCloneViolation[],
  publicUiPalettes: PublicUiPaletteOccurrence[],
  publicUiAllowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const syntaxDiagnostics = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest },
    fileName: file,
    reportDiagnostics: true,
  }).diagnostics ?? [];
  for (const diagnostic of syntaxDiagnostics) {
    const position = diagnostic.start ?? 0;
    parseFailures.push({
      file: toRelativePath(workspaceRoot, file),
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    });
  }
  if (syntaxDiagnostics.length > 0) return;

  const relativeFile = toRelativePath(workspaceRoot, file);
  const publicScanEnabled = !isCanonicalUiPrimitiveFile(relativeFile);
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (isRawUiPrimitiveTag(tag) && !isExemptInput(tag, node.attributes)) {
        debt.push({
          file: toRelativePath(workspaceRoot, file),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          tag,
        });
      }
    }
    if (publicScanEnabled) scanPublicUiNode(node, sourceFile, relativeFile, publicUiViolations, publicUiPalettes, publicUiAllowlist);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function scanPublicTsxFile(
  file: string,
  workspaceRoot: string,
  parseFailures: UiPrimitiveParseFailure[],
  publicUiViolations: PublicUiCloneViolation[],
  publicUiPalettes: PublicUiPaletteOccurrence[],
  publicUiAllowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const syntaxDiagnostics = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest },
    fileName: file,
    reportDiagnostics: true,
  }).diagnostics ?? [];
  for (const diagnostic of syntaxDiagnostics) {
    const position = diagnostic.start ?? 0;
    parseFailures.push({
      file: toRelativePath(workspaceRoot, file),
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    });
  }
  if (syntaxDiagnostics.length > 0) return;
  const relativeFile = toRelativePath(workspaceRoot, file);
  const visit = (node: ts.Node): void => {
    scanPublicUiNode(node, sourceFile, relativeFile, publicUiViolations, publicUiPalettes, publicUiAllowlist);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function scanPublicUiNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  relativeFile: string,
  violations: PublicUiCloneViolation[],
  palettes: PublicUiPaletteOccurrence[],
  allowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  if (isCanonicalUiPrimitiveFile(relativeFile)) return;
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    scanIconButtonClone(node, sourceFile, relativeFile, violations, allowlist);
    scanSegmentedControlClone(node, sourceFile, relativeFile, violations, allowlist);
    scanTablistClone(node, sourceFile, relativeFile, violations, allowlist);
    scanColorSwatchClone(node, sourceFile, relativeFile, violations, allowlist);
  }
  if (ts.isArrayLiteralExpression(node)) scanColorPalette(node, sourceFile, relativeFile, palettes);
}

function scanIconButtonClone(
  node: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  relativeFile: string,
  violations: PublicUiCloneViolation[],
  allowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  const tag = node.tagName.getText(sourceFile);
  if (tag === "IconButton" || tag.endsWith(".IconButton")) return;
  if (!isButtonLikeTag(tag) || !hasAccessibleLabel(node.attributes)) return;
  if (hasBackgroundColorStyle(node.attributes)) return;
  if (!hasCompactButtonClass(node.attributes)) return;
  const element = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : null;
  if (element && hasVisibleJsxText(element.children)) return;
  if (element && !hasIconChild(element.children)) return;
  if (isOverlayBackdrop(node.attributes)) return;
  addPublicUiViolation(violations, relativeFile, node, sourceFile, "local-icon-button", allowlist, "use the canonical IconButton primitive for icon-only commands");
}

function scanTablistClone(
  node: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  relativeFile: string,
  violations: PublicUiCloneViolation[],
  allowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  if (readStaticAttribute(node.attributes, "role") !== "tablist") return;
  const element = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : null;
  if (element && !containsTabLikeDescendant(element.children, sourceFile)) return;
  addPublicUiViolation(violations, relativeFile, node, sourceFile, "tablist-clone", allowlist, "use the canonical SegmentedControl/Tabs primitive instead of cloning a tablist");
}

function scanSegmentedControlClone(
  node: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  relativeFile: string,
  violations: PublicUiCloneViolation[],
  allowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  const role = readStaticAttribute(node.attributes, "role");
  const tag = node.tagName.getText(sourceFile);
  const element = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : null;
  if (!element || (role !== "group" && tag !== "nav")) return;
  if (!hasAccessibleLabel(node.attributes)) return;
  if (hasColorSwatchDescendant(element.children)) return;
  if (countSegmentedOptionMarkers(element.children, sourceFile) < 2) return;
  addPublicUiViolation(
    violations,
    relativeFile,
    node,
    sourceFile,
    "segmented-control-clone",
    allowlist,
    "use the canonical SegmentedControl primitive for compact mutually exclusive controls",
  );
}

function scanColorSwatchClone(
  node: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  relativeFile: string,
  violations: PublicUiCloneViolation[],
  allowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  const tag = node.tagName.getText(sourceFile);
  const role = readStaticAttribute(node.attributes, "role");
  if (!isButtonLikeTag(tag) && role !== "button" && role !== "radio") return;
  if (!hasBackgroundColorStyle(node.attributes)) return;
  if (!hasInteractiveAttribute(node.attributes)) return;
  if (!hasCompactButtonClass(node.attributes) && role !== "radio" && !hasAttribute(node.attributes, "aria-pressed")) return;
  addPublicUiViolation(violations, relativeFile, node, sourceFile, "color-swatch-clone", allowlist, "use the canonical ColorSwatches primitive instead of cloning a color swatch");
}

function scanColorPalette(
  node: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  relativeFile: string,
  palettes: PublicUiPaletteOccurrence[],
): void {
  const colors = node.elements
    .filter((element): element is ts.StringLiteral => ts.isStringLiteral(element))
    .map((element) => element.text.trim().toLowerCase())
    .filter(isColorLiteral);
  if (colors.length === 0 || !isColorPaletteContext(node)) return;
  const unique = new Set(colors);
  palettes.push({
    file: relativeFile,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    fingerprint: colors.join("|") ,
    colors,
  });
  if (unique.size === colors.length) return;
  // 每个重复值只报一次，保留完整色值方便迁移者直接定位来源。
  const duplicates = [...new Set(colors.filter((color, index) => colors.indexOf(color) !== index))];
  if (duplicates.length === 0) return;
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  palettes[palettes.length - 1]!.fingerprint = `${colors.join("|")}#duplicate:${duplicates.join(",")}`;
}

function appendDuplicatePaletteViolations(
  palettes: PublicUiPaletteOccurrence[],
  violations: PublicUiCloneViolation[],
  allowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
): void {
  const byFingerprint = new Map<string, PublicUiPaletteOccurrence[]>();
  for (const palette of palettes) {
    const inlineDuplicate = palette.fingerprint.match(/#duplicate:(.+)$/)?.[1];
    if (inlineDuplicate) {
      addPublicUiViolation(
        violations,
        palette.file,
        undefined,
        undefined,
        "color-swatch-clone",
        allowlist,
        `duplicate color swatch value(s): ${inlineDuplicate}`,
        palette.line,
      );
    }
    const fingerprint = palette.fingerprint.replace(/#duplicate:.+$/, "");
    const entries = byFingerprint.get(fingerprint) ?? [];
    entries.push(palette);
    byFingerprint.set(fingerprint, entries);
  }
  for (const entries of byFingerprint.values()) {
    if (entries.length < 2) continue;
    const first = entries[0]!;
    for (const duplicate of entries.slice(1)) {
      addPublicUiViolation(
        violations,
        duplicate.file,
        undefined,
        undefined,
        "color-swatch-clone",
        allowlist,
        `duplicate color palette (${duplicate.colors.join(", ")}); first declared at ${first.file}:${first.line}`,
        duplicate.line,
      );
    }
  }
}

function appendPublicUiIssues(
  issues: string[],
  violations: PublicUiCloneViolation[],
  summary: Record<string, PublicUiCloneCounts>,
  budget: Readonly<Record<string, Readonly<PublicUiCloneCounts>>>,
): void {
  const unbudgetedFiles = new Set(Object.keys(summary).filter((file) => !budget[file]));
  for (const violation of violations) {
    if (unbudgetedFiles.has(violation.file)) {
      issues.push(`${violation.file}:${violation.line} ${violation.kind}: ${violation.message}`);
    }
  }
  for (const [file, counts] of Object.entries(summary)) {
    const allowed = budget[file];
    if (!allowed) {
      issues.push(`${file} introduces unbudgeted public UI clones: ${formatPublicCounts(counts)}`);
      continue;
    }
    for (const kind of PUBLIC_UI_CLONE_KINDS) {
      const actual = counts[kind] ?? 0;
      const limit = allowed[kind] ?? 0;
      if (actual !== limit) issues.push(`${file} ${kind} debt is ${actual}, but the exact public UI budget is ${limit}`);
    }
  }
  for (const [file, counts] of Object.entries(budget)) {
    if (summary[file]) continue;
    issues.push(`${file} has a stale public UI budget (${formatPublicCounts(counts)}); remove the cleared debt entry`);
  }
}

function summarizePublicUiViolations(violations: PublicUiCloneViolation[]): Record<string, PublicUiCloneCounts> {
  const summary: Record<string, PublicUiCloneCounts> = {};
  for (const violation of violations) {
    const counts = summary[violation.file] ?? (summary[violation.file] = {});
    counts[violation.kind] = (counts[violation.kind] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)));
}

function formatPublicCounts(counts: PublicUiCloneCounts): string {
  return PUBLIC_UI_CLONE_KINDS.filter((kind) => counts[kind]).map((kind) => `${kind}=${counts[kind]}`).join(", ");
}

function addPublicUiViolation(
  violations: PublicUiCloneViolation[],
  relativeFile: string,
  node: ts.Node | undefined,
  sourceFile: ts.SourceFile | undefined,
  kind: PublicUiCloneKind,
  allowlist: Readonly<Record<string, readonly PublicUiCloneKind[]>>,
  message: string,
  explicitLine?: number,
): void {
  if (allowlist[relativeFile]?.includes(kind)) return;
  const line = explicitLine ?? (node && sourceFile
    ? sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    : 1);
  const key = `${relativeFile}:${line}:${kind}:${message}`;
  if (violations.some((violation) => `${violation.file}:${violation.line}:${violation.kind}:${violation.message}` === key)) return;
  violations.push({ file: relativeFile, line, kind, message });
}

function isCanonicalUiPrimitiveFile(relativeFile: string): boolean {
  return relativeFile === "apps/web/components/ui/button.tsx"
    || relativeFile === "apps/web/components/ui/segmented-control.tsx"
    || relativeFile === "apps/web/components/ui/color-swatches.tsx";
}

function isButtonLikeTag(tag: string): boolean {
  return tag === "button" || tag === "Button";
}

function hasAccessibleLabel(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some((property) => ts.isJsxAttribute(property)
    && ts.isIdentifier(property.name)
    && (property.name.text === "aria-label" || property.name.text === "title"));
}

function hasCompactButtonClass(attributes: ts.JsxAttributes): boolean {
  const className = readStaticAttribute(attributes, "className") ?? "";
  return /(?:^|\s)(?:!?aspect-square|!?size-[^\s]+|!?w-[^\s]+\s+!?h-[^\s]+|!?h-[^\s]+\s+!?w-[^\s]+|!?p-0|!?px-0|!?place-items-center)(?:\s|$)/.test(className)
    || /(?:items-center\s+justify-center|justify-center\s+items-center)/.test(className);
}

function hasVisibleJsxText(children: readonly ts.JsxChild[]): boolean {
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.text.trim().length > 0;
    if (ts.isJsxExpression(child)) {
      return child.expression !== undefined && !ts.isIdentifier(child.expression) && !ts.isPropertyAccessExpression(child.expression);
    }
    if (ts.isJsxElement(child)) return hasVisibleJsxText(child.children);
    return false;
  });
}

function hasIconChild(children: readonly ts.JsxChild[]): boolean {
  return children.some((child) => {
    if (ts.isJsxElement(child)) return hasIconChildElement(child);
    if (ts.isJsxSelfClosingElement(child)) {
      const tag = child.tagName.getText(child.getSourceFile());
      return tag !== "span" && tag !== "div" && tag !== "Fragment";
    }
    if (ts.isJsxExpression(child)) return child.expression !== undefined;
    return false;
  });
}

function hasIconChildElement(element: ts.JsxElement): boolean {
  const tag = element.openingElement.tagName.getText(element.getSourceFile());
  if (tag !== "span" && tag !== "div" && tag !== "Fragment") return true;
  return hasIconChild(element.children);
}

function countSegmentedOptionMarkers(children: readonly ts.JsxChild[], sourceFile: ts.SourceFile): number {
  let count = 0;
  for (const child of children) {
    if (ts.isJsxElement(child)) {
      const opening = child.openingElement;
      const tag = opening.tagName.getText(sourceFile);
      const marked = hasAttribute(opening.attributes, "aria-pressed")
        || (tag.endsWith("Button") && (hasAttribute(opening.attributes, "active") || hasAttribute(opening.attributes, "selected")));
      if (marked) count += 1;
      count += countSegmentedOptionMarkers(child.children, sourceFile);
    } else if (ts.isJsxSelfClosingElement(child)) {
      const tag = child.tagName.getText(sourceFile);
      if (hasAttribute(child.attributes, "aria-pressed")
        || (tag.endsWith("Button") && (hasAttribute(child.attributes, "active") || hasAttribute(child.attributes, "selected")))) count += 1;
    }
  }
  return count;
}

function hasColorSwatchDescendant(children: readonly ts.JsxChild[]): boolean {
  return children.some((child) => {
    if (ts.isJsxElement(child)) return hasBackgroundColorStyle(child.openingElement.attributes) || hasColorSwatchDescendant(child.children);
    if (ts.isJsxSelfClosingElement(child)) return hasBackgroundColorStyle(child.attributes);
    return false;
  });
}

function containsTabLikeDescendant(children: readonly ts.JsxChild[], sourceFile: ts.SourceFile): boolean {
  return children.some((child) => {
    if (ts.isJsxElement(child)) {
      const opening = child.openingElement;
      return readStaticAttribute(opening.attributes, "role") === "tab"
        || hasAttribute(opening.attributes, "aria-selected")
        || containsTabLikeDescendant(child.children, sourceFile);
    }
    if (ts.isJsxSelfClosingElement(child)) {
      return readStaticAttribute(child.attributes, "role") === "tab" || hasAttribute(child.attributes, "aria-selected");
    }
    return false;
  });
}

function hasBackgroundColorStyle(attributes: ts.JsxAttributes): boolean {
  const style = attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property)
    && ts.isIdentifier(property.name)
    && property.name.text === "style");
  if (!style || !style.initializer || !ts.isJsxExpression(style.initializer) || !style.initializer.expression) return false;
  const expression = style.initializer.expression;
  if (!ts.isObjectLiteralExpression(expression)) return false;
  return expression.properties.some((property) => ts.isPropertyAssignment(property)
    && ((ts.isIdentifier(property.name) && property.name.text === "backgroundColor")
      || (ts.isStringLiteral(property.name) && property.name.text === "backgroundColor")));
}

function hasInteractiveAttribute(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some((property) => ts.isJsxAttribute(property)
    && ts.isIdentifier(property.name)
    && (property.name.text === "onClick"
      || property.name.text === "onChange"
      || property.name.text === "aria-pressed"
      || property.name.text === "aria-checked"));
}

function isOverlayBackdrop(attributes: ts.JsxAttributes): boolean {
  return readStaticAttribute(attributes, "aria-hidden") === "true"
    && readStaticAttribute(attributes, "tabIndex") === "-1";
}

function isColorPaletteContext(node: ts.ArrayLiteralExpression): boolean {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isJsxAttribute(parent) && ts.isIdentifier(parent.name) && parent.name.text === "colors") return true;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return /(?:color|swatch|palette)/i.test(parent.name.text);
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return /(?:color|swatch|palette)/i.test(parent.name.text);
    parent = parent.parent;
  }
  return false;
}

function isColorLiteral(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^(?:rgb|hsl)a?\(/i.test(value);
}

function readStaticAttribute(attributes: ts.JsxAttributes, name: string): string | undefined {
  const property = attributes.properties.find((candidate) => ts.isJsxAttribute(candidate)
    && ts.isIdentifier(candidate.name)
    && candidate.name.text === name);
  if (!property || !ts.isJsxAttribute(property)) return undefined;
  if (!property.initializer) return "true";
  if (ts.isStringLiteral(property.initializer)) return property.initializer.text;
  if (!ts.isJsxExpression(property.initializer) || !property.initializer.expression) return undefined;
  const expression = property.initializer.expression;
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) ? expression.text : undefined;
}

function hasAttribute(attributes: ts.JsxAttributes, name: string): boolean {
  return attributes.properties.some((property) => ts.isJsxAttribute(property)
    && ts.isIdentifier(property.name)
    && property.name.text === name);
}

function isExemptInput(tag: RawUiPrimitiveTag, attributes: ts.JsxAttributes): boolean {
  if (tag !== "input") return false;
  const typeAttribute = attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute => (
      ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === "type"
    ),
  );
  return Boolean(
    typeAttribute
      && typeAttribute.initializer
      && ts.isStringLiteral(typeAttribute.initializer)
      && exemptInputTypes.has(typeAttribute.initializer.text.toLowerCase()),
  );
}

function summarizeDebt(debt: UiPrimitiveDebt[]): Record<string, UiPrimitiveCounts> {
  const summary: Record<string, UiPrimitiveCounts> = {};
  for (const item of debt) {
    const counts = summary[item.file] ?? (summary[item.file] = {});
    counts[item.tag] = (counts[item.tag] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)));
}

function printDebtSummary(summary: Record<string, UiPrimitiveCounts>): void {
  const totals: UiPrimitiveCounts = {};
  for (const counts of Object.values(summary)) {
    for (const tag of RAW_UI_PRIMITIVE_TAGS) totals[tag] = (totals[tag] ?? 0) + (counts[tag] ?? 0);
  }
  console.log(`web UI primitive debt summary (${Object.keys(summary).length} files): ${formatCounts(totals) || "none"}`);
  for (const [file, counts] of Object.entries(summary)) console.log(`- ${file}: ${formatCounts(counts)}`);
}

function formatCounts(counts: UiPrimitiveCounts): string {
  return RAW_UI_PRIMITIVE_TAGS.filter((tag) => counts[tag]).map((tag) => `${tag}=${counts[tag]}`).join(", ");
}

function listTsxFiles(directory: string, excludeUiPrimitives: boolean): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (!excludedDirectoryNames.has(entry) || (entry === "ui" && !excludeUiPrimitives)) walk(absolute);
      } else if (entry.endsWith(".tsx") && !/\.(?:test|spec)\.tsx$/.test(entry)) {
        files.push(absolute);
      }
    }
  };
  walk(directory);
  return files;
}

function isRawUiPrimitiveTag(value: string): value is RawUiPrimitiveTag {
  return (RAW_UI_PRIMITIVE_TAGS as readonly string[]).includes(value);
}

function toRelativePath(workspaceRoot: string, file: string): string {
  return path.relative(workspaceRoot, file).split(path.sep).join("/");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertUiPrimitiveBoundary();
}
