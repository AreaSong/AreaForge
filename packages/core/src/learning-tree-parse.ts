import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import remarkStringify from "remark-stringify";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import type { Root, PhrasingContent, Content } from "mdast";
import {
  LEARNING_TREE_MAX_BYTES,
  LEARNING_TREE_MAX_DEPTH,
  LEARNING_TREE_MAX_OBJECTS,
  LEARNING_TREE_PROTOCOL,
  createStableKey,
  utf8ByteLength,
  type LearningTreeErrorCode,
  type LearningTreeFrontmatter,
  type LearningTreeIssue,
  type LearningTreeNoteKind,
  type LearningTreeObjectType,
  type LearningTreeScope,
} from "./learning-tree-protocol";
import { canonicalizeHttpsUrl } from "./learning-tree-url";

export interface LearningTreeGroupObject {
  type: "group";
  stableKey: string;
  title: string;
  sourceLine?: number;
}

export interface LearningTreeSubjectObject {
  type: "subject";
  stableKey: string;
  title: string;
  groupKey?: string;
  sourceLine?: number;
}

export interface LearningTreeNodeObject {
  type: "node";
  stableKey: string;
  title: string;
  depth: number;
  subjectKey: string;
  parentStableKey: string | null;
  pathTitles: string[];
  archived: boolean;
  sortOrder?: number;
  status?: string;
  sourceLine?: number;
}

export interface LearningTreeCardObject {
  type: "card";
  stableKey: string;
  title: string;
  kind: LearningTreeNoteKind;
  subjectKey: string;
  primaryNode?: string;
  relatedNodes: string[];
  bodyMarkdown: string;
  sourceLine?: number;
}

export interface LearningTreeResourceObject {
  type: "resource";
  stableKey: string;
  title: string;
  subjectKey: string;
  kind: "LINK";
  url: string;
  displayHost: string;
  sourceLine?: number;
}

export interface LearningTreePlanObject {
  type: "plan";
  stableKey: string;
  title: string;
  subjectKey: string;
  milestoneKey?: string;
  durationMinutes?: number;
  dependsOn?: string;
  dependencyType?: "SOFT" | "HARD";
  batchRef: string;
  originVersion: number;
  sourceLine?: number;
}

export type LearningTreeObject =
  | LearningTreeGroupObject
  | LearningTreeSubjectObject
  | LearningTreeNodeObject
  | LearningTreeCardObject
  | LearningTreeResourceObject
  | LearningTreePlanObject;

export interface LearningTreeParseResult {
  ok: boolean;
  frontmatter: LearningTreeFrontmatter | null;
  objects: LearningTreeObject[];
  canonicalMarkdown: string;
  sourceSha256: string;
  canonicalPlanHash: string;
  errors: LearningTreeIssue[];
  warnings: LearningTreeIssue[];
}

const NOTE_KINDS = new Set<LearningTreeNoteKind>([
  "GENERAL",
  "CONCEPT",
  "METHOD",
  "EXAMPLE",
  "JOURNAL",
  "SUMMARY",
]);

const ALLOWED_LEAF = new Set(["af-group", "af-subject", "af-node", "af-resource", "af-plan"]);
const ALLOWED_CONTAINER = new Set(["af-card"]);

export function parseLearningTreeMarkdown(markdown: string): LearningTreeParseResult {
  const errors: LearningTreeIssue[] = [];
  const warnings: LearningTreeIssue[] = [];
  const byteLength = utf8ByteLength(markdown);
  if (byteLength > LEARNING_TREE_MAX_BYTES) {
    return emptyFail([{ code: "SIZE_LIMIT", message: `导入超过 ${LEARNING_TREE_MAX_BYTES} 字节上限。` }]);
  }

  let tree: Root;
  try {
    tree = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkDirective).parse(markdown) as Root;
  } catch (error) {
    return emptyFail([
      {
        code: "PARSE_ERROR",
        message: error instanceof Error ? error.message : "Markdown 解析失败。",
      },
    ]);
  }

  scanForbiddenSyntax(tree, errors);
  const frontmatter = parseFrontmatter(tree, errors);
  if (!frontmatter) {
    return {
      ok: false,
      frontmatter: null,
      objects: [],
      canonicalMarkdown: "",
      sourceSha256: "",
      canonicalPlanHash: "",
      errors,
      warnings,
    };
  }

  const objects: LearningTreeObject[] = [];
  const stableKeys = new Set<string>();
  const subjectKeys = new Set<string>();
  let currentSubjectKey: string | null =
    frontmatter.scope === "global" ? null : (frontmatter.subjectKey ?? null);
  const nodeStack: Array<{ depth: number; stableKey: string; title: string }> = [];
  let objectCount = 0;
  let generatedSeq = 0;

  const bump = () => {
    objectCount += 1;
    if (objectCount > LEARNING_TREE_MAX_OBJECTS) {
      pushError(errors, "OBJECT_LIMIT", `业务对象超过 ${LEARNING_TREE_MAX_OBJECTS} 上限。`);
      return false;
    }
    return true;
  };

  const ensureKey = (type: LearningTreeObjectType, explicit: string | undefined, seed: string) => {
    const key = explicit?.trim() || createStableKey(type, `${seed}:${++generatedSeq}`);
    if (stableKeys.has(key)) {
      pushError(errors, "DUPLICATE_STABLE_KEY", `稳定键重复：${key}`, undefined, key);
      return null;
    }
    stableKeys.add(key);
    return key;
  };

  for (const [index, node] of tree.children.entries()) {
    if (node.type === "yaml") continue;

    if (node.type === "heading") {
      const depth = node.depth;
      if (depth > LEARNING_TREE_MAX_DEPTH) {
        pushError(errors, "DEPTH_LIMIT", `考纲深度超过 ${LEARNING_TREE_MAX_DEPTH}。`, node.position?.start.line);
        continue;
      }
      const title = phrasingToText(node.children).trim();
      if (!title) {
        pushError(errors, "EMPTY_TITLE", "考纲标题不能为空。", node.position?.start.line);
        continue;
      }
      if (!currentSubjectKey) {
        pushError(errors, "MISSING_SUBJECT", "考纲节点必须归属科目。", node.position?.start.line);
        continue;
      }

      let explicitKey: string | undefined;
      let archived = false;
      let sortOrder: number | undefined;
      let status: string | undefined;
      const next = tree.children[index + 1];
      if (next && isLeafDirective(next) && directiveName(next) === "af-node") {
        const attrs = directiveAttributes(next);
        explicitKey = attrs.id || attrs.stableKey;
        archived = attrs.archived === "true";
        if (attrs.sortOrder) sortOrder = Number.parseInt(attrs.sortOrder, 10);
        status = attrs.status;
      }

      const stableKey = ensureKey("node", explicitKey, `${currentSubjectKey}:${title}:${depth}`);
      if (!stableKey || !bump()) continue;

      while (nodeStack.length > 0 && nodeStack[nodeStack.length - 1]!.depth >= depth) {
        nodeStack.pop();
      }
      const parent = nodeStack[nodeStack.length - 1] ?? null;
      const pathTitles = [...nodeStack.map((item) => item.title), title];
      objects.push({
        type: "node",
        stableKey,
        title,
        depth,
        subjectKey: currentSubjectKey,
        parentStableKey: parent?.stableKey ?? null,
        pathTitles,
        archived,
        sortOrder,
        status,
        sourceLine: node.position?.start.line,
      });
      nodeStack.push({ depth, stableKey, title });
      continue;
    }

    if (isContainerDirective(node) && directiveName(node) === "af-card") {
      const attrs = directiveAttributes(node);
      const title = (attrs.title ?? "").trim();
      if (!title) {
        pushError(errors, "EMPTY_TITLE", "知识卡片标题不能为空。", node.position?.start.line);
        continue;
      }
      const kind = (attrs.kind ?? "GENERAL") as LearningTreeNoteKind;
      if (!NOTE_KINDS.has(kind)) {
        pushError(errors, "PARSE_ERROR", `未知卡片类型：${kind}`, node.position?.start.line);
        continue;
      }
      const subjectKey = attrs.subjectKey || currentSubjectKey;
      if (!subjectKey) {
        pushError(errors, "MISSING_SUBJECT", "知识卡片必须归属科目。", node.position?.start.line);
        continue;
      }
      const stableKey = ensureKey("card", attrs.id || attrs.stableKey, `${subjectKey}:${title}`);
      if (!stableKey || !bump()) continue;
      const bodyMarkdown = childrenToMarkdown(node.children as Content[]);
      objects.push({
        type: "card",
        stableKey,
        title,
        kind,
        subjectKey,
        primaryNode: attrs.primaryNode,
        relatedNodes: splitList(attrs.relatedNodes),
        bodyMarkdown,
        sourceLine: node.position?.start.line,
      });
      continue;
    }

    if (isLeafDirective(node)) {
      const name = directiveName(node);
      if (!ALLOWED_LEAF.has(name)) {
        pushError(errors, "UNKNOWN_DIRECTIVE", `未知指令：${name}`, node.position?.start.line);
        continue;
      }
      const attrs = directiveAttributes(node);

      if (name === "af-group") {
        if (frontmatter.scope !== "global") {
          pushError(errors, "SCOPE_INVALID", "af-group 仅允许 global scope。", node.position?.start.line);
          continue;
        }
        const title = (attrs.title ?? "").trim();
        const stableKey = ensureKey("group", attrs.id || attrs.stableKey || attrs.groupKey, title || "group");
        if (!stableKey || !bump()) continue;
        if (!title) {
          pushError(errors, "EMPTY_TITLE", "分组标题不能为空。", node.position?.start.line, stableKey);
          continue;
        }
        objects.push({
          type: "group",
          stableKey,
          title,
          sourceLine: node.position?.start.line,
        });
        continue;
      }

      if (name === "af-subject") {
        if (frontmatter.scope !== "global") {
          pushError(errors, "SCOPE_INVALID", "af-subject 仅允许 global scope。", node.position?.start.line);
          continue;
        }
        const title = (attrs.title ?? "").trim();
        const stableKey = ensureKey(
          "subject",
          attrs.id || attrs.stableKey || attrs.subjectKey,
          title || "subject",
        );
        if (!stableKey || !bump()) continue;
        if (!title) {
          pushError(errors, "EMPTY_TITLE", "科目标题不能为空。", node.position?.start.line, stableKey);
          continue;
        }
        subjectKeys.add(stableKey);
        currentSubjectKey = stableKey;
        nodeStack.length = 0;
        objects.push({
          type: "subject",
          stableKey,
          title,
          groupKey: attrs.group,
          sourceLine: node.position?.start.line,
        });
        continue;
      }

      if (name === "af-node") {
        // Handled with preceding heading; standalone af-node is ignored as metadata.
        continue;
      }

      if (name === "af-resource") {
        const title = (attrs.title ?? "").trim();
        const subjectKey = attrs.subjectKey || currentSubjectKey;
        if (!subjectKey) {
          pushError(errors, "MISSING_SUBJECT", "资料必须归属科目。", node.position?.start.line);
          continue;
        }
        if (!title) {
          pushError(errors, "EMPTY_TITLE", "资料标题不能为空。", node.position?.start.line);
          continue;
        }
        if ((attrs.kind ?? "LINK") !== "LINK") {
          pushError(errors, "PARSE_ERROR", "学习树仅允许 LINK 资料指令。", node.position?.start.line);
          continue;
        }
        const urlResult = canonicalizeHttpsUrl(attrs.url ?? "");
        if (!urlResult.ok) {
          pushError(errors, "URL_INVALID", `资料 URL 非法：${urlResult.reason}`, node.position?.start.line);
          continue;
        }
        const stableKey = ensureKey("resource", attrs.id || attrs.stableKey, `${subjectKey}:${title}`);
        if (!stableKey || !bump()) continue;
        objects.push({
          type: "resource",
          stableKey,
          title,
          subjectKey,
          kind: "LINK",
          url: urlResult.url,
          displayHost: urlResult.host,
          sourceLine: node.position?.start.line,
        });
        continue;
      }

      if (name === "af-plan") {
        const title = (attrs.title ?? "").trim();
        const subjectKey = attrs.subjectKey || currentSubjectKey;
        if (!subjectKey) {
          pushError(errors, "MISSING_SUBJECT", "计划必须归属科目。", node.position?.start.line);
          continue;
        }
        if (!title) {
          pushError(errors, "EMPTY_TITLE", "计划标题不能为空。", node.position?.start.line);
          continue;
        }
        const stableKey = ensureKey("plan", attrs.id || attrs.stableKey, `${subjectKey}:${title}`);
        if (!stableKey || !bump()) continue;
        const dependsOn = attrs.dependsOn?.trim() || undefined;
        if (dependsOn && !dependsOn.startsWith("plan:")) {
          pushError(errors, "PARSE_ERROR", "dependsOn 只能引用 plan:<stableKey>。", node.position?.start.line, stableKey);
        }
        objects.push({
          type: "plan",
          stableKey,
          title,
          subjectKey,
          milestoneKey: attrs.milestoneKey,
          durationMinutes: attrs.durationMinutes ? Number.parseInt(attrs.durationMinutes, 10) : undefined,
          dependsOn,
          dependencyType: attrs.dependencyType === "HARD" ? "HARD" : "SOFT",
          batchRef: "",
          originVersion: 1,
          sourceLine: node.position?.start.line,
        });
      }
      continue;
    }

    if (isContainerDirective(node) && !ALLOWED_CONTAINER.has(directiveName(node))) {
      pushError(errors, "UNKNOWN_DIRECTIVE", `未知容器指令：${directiveName(node)}`, node.position?.start.line);
      continue;
    }

    if (node.type === "paragraph" || node.type === "list" || node.type === "blockquote") {
      // Ordinary markdown outside cards is ignored only when not business syntax;
      // unknown directives already fail above. Loose paragraphs are warnings.
      warnings.push({
        code: "PARSE_ERROR",
        message: "卡片外普通段落不会作为业务对象导入。",
        sourceLine: node.position?.start.line,
      });
    }
  }

  validatePlanDependencies(objects, errors);

  const canonicalMarkdown = serializeCanonical(frontmatter, objects);

  return {
    ok: errors.length === 0,
    frontmatter,
    objects,
    canonicalMarkdown,
    // Hashes and plan batch refs are filled by the server crypto layer.
    sourceSha256: "",
    canonicalPlanHash: "",
    errors,
    warnings,
  };
}

function emptyFail(errors: LearningTreeIssue[]): LearningTreeParseResult {
  return {
    ok: false,
    frontmatter: null,
    objects: [],
    canonicalMarkdown: "",
    sourceSha256: "",
    canonicalPlanHash: "",
    errors,
    warnings: [],
  };
}

function parseFrontmatter(tree: Root, errors: LearningTreeIssue[]): LearningTreeFrontmatter | null {
  const yamlNode = tree.children.find((child) => child.type === "yaml");
  if (!yamlNode || yamlNode.type !== "yaml") {
    pushError(errors, "FRONTMATTER_INVALID", "缺少 YAML frontmatter。");
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = parseYaml(yamlNode.value) as Record<string, unknown>;
  } catch {
    pushError(errors, "FRONTMATTER_INVALID", "YAML frontmatter 无法解析。");
    return null;
  }
  if (data.protocol !== LEARNING_TREE_PROTOCOL) {
    pushError(errors, "PROTOCOL_INVALID", `protocol 必须为 ${LEARNING_TREE_PROTOCOL}。`);
    return null;
  }
  const scope = data.scope as LearningTreeScope;
  if (scope !== "global" && scope !== "subject" && scope !== "branch") {
    pushError(errors, "SCOPE_INVALID", "scope 必须为 global|subject|branch。");
    return null;
  }
  const workspaceKey = String(data.workspaceKey ?? "").trim();
  if (!workspaceKey) {
    pushError(errors, "FRONTMATTER_INVALID", "workspaceKey 必填。");
    return null;
  }
  const subjectKey = data.subjectKey ? String(data.subjectKey).trim() : undefined;
  const rootNodeKey = data.rootNodeKey ? String(data.rootNodeKey).trim() : undefined;
  if ((scope === "subject" || scope === "branch") && !subjectKey) {
    pushError(errors, "FRONTMATTER_INVALID", "subject/branch scope 必须声明 subjectKey。");
    return null;
  }
  if (scope === "branch" && !rootNodeKey) {
    pushError(errors, "FRONTMATTER_INVALID", "branch scope 必须声明 rootNodeKey。");
    return null;
  }
  return {
    protocol: LEARNING_TREE_PROTOCOL,
    scope,
    workspaceKey,
    subjectKey,
    rootNodeKey,
  };
}

function scanForbiddenSyntax(tree: Root, errors: LearningTreeIssue[]): void {
  visit(tree, (node) => {
    if (node.type === "html") {
      pushError(errors, "RAW_HTML_FORBIDDEN", "禁止原始 HTML。", node.position?.start.line);
    }
    if (node.type === "image" || node.type === "imageReference") {
      pushError(errors, "IMAGE_FORBIDDEN", "禁止图片语法。", node.position?.start.line);
    }
  });
}

function validatePlanDependencies(objects: LearningTreeObject[], errors: LearningTreeIssue[]): void {
  const plans = objects.filter((object): object is LearningTreePlanObject => object.type === "plan");
  const keys = new Set(plans.map((plan) => plan.stableKey));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const adj = new Map<string, string>();
  for (const plan of plans) {
    if (!plan.dependsOn) continue;
    const target = plan.dependsOn.replace(/^plan:/, "");
    if (!keys.has(target)) {
      pushError(errors, "PARSE_ERROR", `计划依赖不存在：${plan.dependsOn}`, plan.sourceLine, plan.stableKey);
      continue;
    }
    adj.set(plan.stableKey, target);
  }

  const dfs = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const next = adj.get(key);
    if (next && dfs(next)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };

  for (const plan of plans) {
    if (dfs(plan.stableKey)) {
      pushError(errors, "DEPENDENCY_CYCLE", "计划依赖存在环。", plan.sourceLine, plan.stableKey);
      break;
    }
  }
}

function serializeCanonical(frontmatter: LearningTreeFrontmatter, objects: LearningTreeObject[]): string {
  const lines: string[] = ["---"];
  lines.push(`protocol: ${frontmatter.protocol}`);
  lines.push(`scope: ${frontmatter.scope}`);
  lines.push(`workspaceKey: ${frontmatter.workspaceKey}`);
  if (frontmatter.subjectKey) lines.push(`subjectKey: ${frontmatter.subjectKey}`);
  if (frontmatter.rootNodeKey) lines.push(`rootNodeKey: ${frontmatter.rootNodeKey}`);
  lines.push("---", "");

  let currentSubject: string | null = frontmatter.subjectKey ?? null;
  for (const object of objects) {
    if (object.type === "group") {
      lines.push(`::af-group{#${object.stableKey} title="${escapeAttr(object.title)}"}`, "");
      continue;
    }
    if (object.type === "subject") {
      currentSubject = object.stableKey;
      const group = object.groupKey ? ` group="${escapeAttr(object.groupKey)}"` : "";
      lines.push(`::af-subject{#${object.stableKey} title="${escapeAttr(object.title)}"${group}}`, "");
      continue;
    }
    if (object.type === "node") {
      const hashes = "#".repeat(object.depth);
      lines.push(`${hashes} ${object.title}`);
      const attrs = [`#${object.stableKey}`];
      if (object.archived) attrs.push('archived="true"');
      if (object.sortOrder != null && Number.isFinite(object.sortOrder)) {
        attrs.push(`sortOrder="${object.sortOrder}"`);
      }
      if (object.status) attrs.push(`status="${escapeAttr(object.status)}"`);
      lines.push(`::af-node{${attrs.join(" ")}}`, "");
      continue;
    }
    if (object.type === "card") {
      const related =
        object.relatedNodes.length > 0
          ? ` relatedNodes="${escapeAttr(object.relatedNodes.join(","))}"`
          : "";
      const primary = object.primaryNode ? ` primaryNode="${escapeAttr(object.primaryNode)}"` : "";
      lines.push(
        `:::af-card{#${object.stableKey} kind="${object.kind}" title="${escapeAttr(object.title)}" subjectKey="${escapeAttr(object.subjectKey)}"${primary}${related}}`,
      );
      if (object.bodyMarkdown.trim()) lines.push(object.bodyMarkdown.trimEnd());
      lines.push(":::", "");
      continue;
    }
    if (object.type === "resource") {
      lines.push(
        `::af-resource{#${object.stableKey} kind="LINK" subjectKey="${escapeAttr(object.subjectKey)}" title="${escapeAttr(object.title)}" url="${escapeAttr(object.url)}"}`,
        "",
      );
      continue;
    }
    if (object.type === "plan") {
      const parts = [
        `#${object.stableKey}`,
        `subjectKey="${escapeAttr(object.subjectKey)}"`,
        `title="${escapeAttr(object.title)}"`,
      ];
      if (object.milestoneKey) parts.push(`milestoneKey="${escapeAttr(object.milestoneKey)}"`);
      if (object.durationMinutes != null) parts.push(`durationMinutes="${object.durationMinutes}"`);
      if (object.dependsOn) parts.push(`dependsOn="${escapeAttr(object.dependsOn)}"`);
      if (object.dependencyType) parts.push(`dependencyType="${object.dependencyType}"`);
      lines.push(`::af-plan{${parts.join(" ")}}`, "");
    }
  }

  void currentSubject;
  return `${lines.join("\n").trimEnd()}\n`;
}

function childrenToMarkdown(children: Content[]): string {
  const root: Root = { type: "root", children };
  return String(
    unified()
      .use(remarkStringify, { handlers: {} })
      .stringify(root),
  ).trim();
}

function phrasingToText(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if ("value" in node && typeof node.value === "string") return node.value;
      if ("children" in node && Array.isArray(node.children)) {
        return phrasingToText(node.children as PhrasingContent[]);
      }
      return "";
    })
    .join("");
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeAttr(value: string): string {
  return value.replaceAll('"', '\\"');
}

function pushError(
  errors: LearningTreeIssue[],
  code: LearningTreeErrorCode,
  message: string,
  sourceLine?: number,
  stableKey?: string,
): void {
  errors.push({ code, message, sourceLine, stableKey });
}

function isLeafDirective(node: Content): node is Content & { type: "leafDirective"; name: string } {
  return node.type === "leafDirective";
}

function isContainerDirective(
  node: Content,
): node is Content & { type: "containerDirective"; name: string; children: Content[] } {
  return node.type === "containerDirective";
}

function directiveName(node: { name?: string }): string {
  return node.name ?? "";
}

function directiveAttributes(node: Content): Record<string, string> {
  const attrs: Record<string, string> = {};
  const data = (node as { data?: { hProperties?: Record<string, unknown> }; attributes?: Record<string, unknown> })
    .attributes;
  const props = (node as { data?: { hProperties?: Record<string, unknown> } }).data?.hProperties;
  const source = { ...(props ?? {}), ...(data ?? {}) };
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    attrs[key] = String(value);
  }
  // remark-directive puts id in attributes.id from {#id}
  if ("id" in attrs) attrs.stableKey = attrs.stableKey ?? attrs.id;
  return attrs;
}
