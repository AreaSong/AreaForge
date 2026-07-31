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
const SYLLABUS_STATUSES = new Set([
  "NOT_STARTED",
  "LEARNING",
  "COVERED",
  "NEEDS_REVIEW",
  "MASTERED",
  "WEAK",
  "DEFERRED",
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
  const consumedNodeDirectiveIndexes = new Set<number>();
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
        consumedNodeDirectiveIndexes.add(index + 1);
        const attrs = directiveAttributes(next);
        validateDirectiveAttributes(attrs, ["id", "stableKey", "archived", "sortOrder", "status"], "af-node", errors, next.position?.start.line);
        explicitKey = attrs.id || attrs.stableKey;
        if (attrs.archived && attrs.archived !== "true" && attrs.archived !== "false") {
          pushError(errors, "PARSE_ERROR", "af-node archived 只能为 true 或 false。", next.position?.start.line);
        }
        archived = attrs.archived === "true";
        if (attrs.sortOrder) {
          const parsedSortOrder = Number(attrs.sortOrder);
          if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0 || parsedSortOrder > 1_000_000) {
            pushError(errors, "PARSE_ERROR", "af-node sortOrder 必须为 0 到 1000000 的整数。", next.position?.start.line);
          } else {
            sortOrder = parsedSortOrder;
          }
        }
        status = attrs.status;
        if (status && !SYLLABUS_STATUSES.has(status)) {
          pushError(errors, "PARSE_ERROR", `未知考纲状态：${status}`, next.position?.start.line);
          status = undefined;
        }
      }

      const stableKey = ensureKey("node", explicitKey, `${currentSubjectKey}:${title}:${depth}`);
      if (!stableKey || !bump()) continue;

      while (nodeStack.length > 0 && nodeStack[nodeStack.length - 1]!.depth >= depth) {
        nodeStack.pop();
      }
      const parent = nodeStack[nodeStack.length - 1] ?? null;
      const branchRootParent =
        frontmatter.scope === "branch" &&
        stableKey === frontmatter.rootNodeKey &&
        !parent
          ? frontmatter.rootParentNodeKey ?? null
          : null;
      const pathTitles = [...nodeStack.map((item) => item.title), title];
      objects.push({
        type: "node",
        stableKey,
        title,
        depth,
        subjectKey: currentSubjectKey,
        parentStableKey: parent?.stableKey ?? branchRootParent,
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
      validateDirectiveAttributes(
        attrs,
        ["id", "stableKey", "kind", "title", "subjectKey", "primaryNode", "relatedNodes"],
        "af-card",
        errors,
        node.position?.start.line,
      );
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
      const primaryNode = attrs.primaryNode?.trim() || undefined;
      const relatedNodes = Array.from(new Set(splitList(attrs.relatedNodes)))
        .filter((relatedKey) => relatedKey !== primaryNode);
      objects.push({
        type: "card",
        stableKey,
        title,
        kind,
        subjectKey,
        primaryNode,
        relatedNodes,
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
        validateDirectiveAttributes(attrs, ["id", "stableKey", "groupKey", "title"], name, errors, node.position?.start.line);
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
        validateDirectiveAttributes(
          attrs,
          ["id", "stableKey", "subjectKey", "title", "group"],
          name,
          errors,
          node.position?.start.line,
        );
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
        if (!consumedNodeDirectiveIndexes.has(index)) {
          pushError(errors, "PARSE_ERROR", "af-node 必须紧跟在对应标题之后。", node.position?.start.line);
        }
        continue;
      }

      if (name === "af-resource") {
        validateDirectiveAttributes(
          attrs,
          ["id", "stableKey", "kind", "subjectKey", "title", "url"],
          name,
          errors,
          node.position?.start.line,
        );
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
        validateDirectiveAttributes(
          attrs,
          [
            "id",
            "stableKey",
            "subjectKey",
            "title",
            "milestoneKey",
            "durationMinutes",
            "dependsOn",
            "dependencyType",
          ],
          name,
          errors,
          node.position?.start.line,
        );
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
        let durationMinutes: number | undefined;
        if (attrs.durationMinutes) {
          const parsedDuration = Number(attrs.durationMinutes);
          if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1_440) {
            pushError(errors, "PARSE_ERROR", "durationMinutes 必须为 1 到 1440 的整数。", node.position?.start.line, stableKey);
          } else {
            durationMinutes = parsedDuration;
          }
        }
        if (attrs.dependencyType && attrs.dependencyType !== "SOFT" && attrs.dependencyType !== "HARD") {
          pushError(errors, "PARSE_ERROR", "dependencyType 只能为 SOFT 或 HARD。", node.position?.start.line, stableKey);
        }
        objects.push({
          type: "plan",
          stableKey,
          title,
          subjectKey,
          milestoneKey: attrs.milestoneKey,
          durationMinutes,
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

  validateBranchRoot(objects, frontmatter, errors);
  validateObjectReferences(objects, frontmatter, errors);
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
    const parsed = parseYaml(yamlNode.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      pushError(errors, "FRONTMATTER_INVALID", "YAML frontmatter 必须是对象。", yamlNode.position?.start.line);
      return null;
    }
    data = parsed as Record<string, unknown>;
  } catch {
    pushError(errors, "FRONTMATTER_INVALID", "YAML frontmatter 无法解析。");
    return null;
  }
  const allowedFrontmatter = new Set([
    "protocol",
    "scope",
    "workspaceKey",
    "subjectKey",
    "rootNodeKey",
    "rootParentNodeKey",
  ]);
  const unknownFrontmatter = Object.keys(data).filter((key) => !allowedFrontmatter.has(key));
  if (unknownFrontmatter.length) {
    pushError(errors, "FRONTMATTER_INVALID", `未知 frontmatter 字段：${unknownFrontmatter.join("、")}。`);
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
  const rootParentNodeKey = data.rootParentNodeKey ? String(data.rootParentNodeKey).trim() : undefined;
  if ((scope === "subject" || scope === "branch") && !subjectKey) {
    pushError(errors, "FRONTMATTER_INVALID", "subject/branch scope 必须声明 subjectKey。");
    return null;
  }
  if (scope === "branch" && !rootNodeKey) {
    pushError(errors, "FRONTMATTER_INVALID", "branch scope 必须声明 rootNodeKey。");
    return null;
  }
  if (scope !== "branch" && rootParentNodeKey) {
    pushError(errors, "FRONTMATTER_INVALID", "rootParentNodeKey 仅允许 branch scope。");
    return null;
  }
  if (rootParentNodeKey && rootParentNodeKey === rootNodeKey) {
    pushError(errors, "FRONTMATTER_INVALID", "rootParentNodeKey 不能与 rootNodeKey 相同。");
    return null;
  }
  return {
    protocol: LEARNING_TREE_PROTOCOL,
    scope,
    workspaceKey,
    subjectKey,
    rootNodeKey,
    rootParentNodeKey,
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

function validateObjectReferences(
  objects: LearningTreeObject[],
  frontmatter: LearningTreeFrontmatter,
  errors: LearningTreeIssue[],
): void {
  const declaredSubjects = new Set(
    objects.filter((object): object is LearningTreeSubjectObject => object.type === "subject")
      .map((subject) => subject.stableKey),
  );
  const declaredGroups = new Set(
    objects.filter((object): object is LearningTreeGroupObject => object.type === "group")
      .map((group) => group.stableKey),
  );
  if (frontmatter.subjectKey) declaredSubjects.add(frontmatter.subjectKey);
  const nodes = new Map(
    objects.filter((object): object is LearningTreeNodeObject => object.type === "node")
      .map((node) => [node.stableKey, node]),
  );

  for (const object of objects) {
    if (object.type === "subject" && object.groupKey && !declaredGroups.has(object.groupKey)) {
      pushError(errors, "PARSE_ERROR", `科目引用了未声明分组：${object.groupKey}`, object.sourceLine, object.stableKey);
      continue;
    }
    if ("subjectKey" in object && !declaredSubjects.has(object.subjectKey)) {
      pushError(errors, "MISSING_SUBJECT", `对象引用了未声明科目：${object.subjectKey}`, object.sourceLine, object.stableKey);
      continue;
    }
    if (object.type === "node" && object.parentStableKey) {
      const isExternalBranchParent =
        frontmatter.scope === "branch" &&
        object.stableKey === frontmatter.rootNodeKey &&
        object.parentStableKey === frontmatter.rootParentNodeKey;
      if (isExternalBranchParent) continue;
      const parent = nodes.get(object.parentStableKey);
      if (!parent || parent.subjectKey !== object.subjectKey) {
        pushError(errors, "CROSS_SUBJECT_REF", `考纲父节点无效：${object.parentStableKey}`, object.sourceLine, object.stableKey);
      } else if (parent.archived && !object.archived) {
        pushError(errors, "PARSE_ERROR", `未归档节点不能挂在已归档父节点下：${object.parentStableKey}`, object.sourceLine, object.stableKey);
      }
    }
    if (object.type !== "card") continue;
    for (const nodeKey of [object.primaryNode, ...object.relatedNodes].filter((key): key is string => Boolean(key))) {
      const node = nodes.get(nodeKey);
      if (!node) {
        pushError(errors, "PARSE_ERROR", `卡片引用的节点不存在：${nodeKey}`, object.sourceLine, object.stableKey);
      } else if (node.subjectKey !== object.subjectKey) {
        pushError(errors, "CROSS_SUBJECT_REF", `卡片不能跨科目引用节点：${nodeKey}`, object.sourceLine, object.stableKey);
      }
    }
  }
}

function validateBranchRoot(
  objects: LearningTreeObject[],
  frontmatter: LearningTreeFrontmatter,
  errors: LearningTreeIssue[],
): void {
  if (frontmatter.scope !== "branch" || !frontmatter.rootNodeKey) return;
  const nodes = objects.filter((object): object is LearningTreeNodeObject => object.type === "node");
  const nodeKeys = new Set(nodes.map((node) => node.stableKey));
  const roots = nodes.filter((node) => !node.parentStableKey || !nodeKeys.has(node.parentStableKey));
  if (roots.length !== 1) {
    pushError(errors, "FRONTMATTER_INVALID", "branch scope 必须且只能包含一个根节点。");
    return;
  }
  if (roots[0]!.stableKey !== frontmatter.rootNodeKey) {
    pushError(
      errors,
      "FRONTMATTER_INVALID",
      `branch rootNodeKey 必须指向实际根节点：${roots[0]!.stableKey}`,
      roots[0]!.sourceLine,
      roots[0]!.stableKey,
    );
  }
}

function validatePlanDependencies(objects: LearningTreeObject[], errors: LearningTreeIssue[]): void {
  const plans = objects.filter((object): object is LearningTreePlanObject => object.type === "plan");
  const plansByKey = new Map(plans.map((plan) => [plan.stableKey, plan]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const adj = new Map<string, string>();
  for (const plan of plans) {
    if (!plan.dependsOn) continue;
    const target = plan.dependsOn.replace(/^plan:/, "");
    const targetPlan = plansByKey.get(target);
    if (!targetPlan) {
      pushError(errors, "PARSE_ERROR", `计划依赖不存在：${plan.dependsOn}`, plan.sourceLine, plan.stableKey);
      continue;
    }
    if (targetPlan.subjectKey !== plan.subjectKey) {
      pushError(errors, "CROSS_SUBJECT_REF", `计划不能跨科目依赖：${plan.dependsOn}`, plan.sourceLine, plan.stableKey);
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
  if (frontmatter.rootParentNodeKey) lines.push(`rootParentNodeKey: ${frontmatter.rootParentNodeKey}`);
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

function validateDirectiveAttributes(
  attrs: Record<string, string>,
  allowed: string[],
  directive: string,
  errors: LearningTreeIssue[],
  sourceLine?: number,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(attrs).filter((key) => !allowedKeys.has(key));
  if (unknown.length) {
    pushError(errors, "PARSE_ERROR", `${directive} 包含未知属性：${unknown.join("、")}。`, sourceLine);
  }
}
