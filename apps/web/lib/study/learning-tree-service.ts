import { randomUUID } from "node:crypto";
import {
  buildLearningTreeDiff,
  exportLearningTreeMarkdown,
  getLearningTreeTemplate,
  parseLearningTreeMarkdown,
  type LearningTreeExistingRef,
  type LearningTreeExportNode,
  type LearningTreeScope,
} from "@areaforge/core";
import {
  createPlanBatchRef,
  mintLearningTreePreviewToken,
  sha256Hex,
} from "@areaforge/auth";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";
import { resolveActiveWorkspace } from "./exam-workspace-service";

export interface LearningTreePreviewDto {
  operationId: string;
  workspaceId: string;
  scope: LearningTreeScope;
  protocolVersion: string;
  parserVersion: string;
  sourceSha256: string;
  canonicalPlanHash: string;
  canonicalMarkdown: string;
  rootRevision: number;
  previewToken: string;
  previewExpiresAt: string;
  items: ReturnType<typeof buildLearningTreeDiff>;
  errors: Array<{ code: string; message: string; sourceLine?: number; stableKey?: string }>;
  warnings: Array<{ code: string; message: string; sourceLine?: number }>;
  blocking: boolean;
  objectCount: number;
}

export function getLearningTreeTemplateContent(scope: LearningTreeScope): {
  scope: LearningTreeScope;
  filename: string;
  contentType: string;
  markdown: string;
} {
  return {
    scope,
    filename: `areaforge-learning-tree-${scope}.md`,
    contentType: "text/markdown; charset=utf-8",
    markdown: getLearningTreeTemplate(scope),
  };
}

export async function exportActiveLearningTreeMarkdown(
  actorId: string,
  scope: LearningTreeScope,
  options?: { subjectKey?: string; rootNodeKey?: string },
): Promise<{ markdown: string; workspaceId: string; filename: string }> {
  const workspace = await resolveActiveWorkspace(actorId);
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: workspace.id, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      syllabusNodes: {
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
      group: true,
    },
  });

  const groups = await prisma.subjectGroup.findMany({
    where: { workspaceId: workspace.id, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  let filteredSubjects = subjects;
  if (scope === "subject" || scope === "branch") {
    if (!options?.subjectKey) {
      throw new ApiError("SUBJECT_KEY_REQUIRED", 400);
    }
    filteredSubjects = subjects.filter((subject) => subject.stableKey === options.subjectKey);
    if (filteredSubjects.length === 0) {
      throw new ApiError("SUBJECT_NOT_FOUND", 404);
    }
  }

  const markdown = exportLearningTreeMarkdown({
    scope,
    workspaceKey: workspace.stableKey,
    subjectKey: options?.subjectKey,
    rootNodeKey: options?.rootNodeKey,
    groups: groups.map((group) => ({ stableKey: group.stableKey, title: group.name })),
    subjects: filteredSubjects.map((subject) => ({
      stableKey: subject.stableKey,
      title: subject.name,
      groupKey: subject.group?.stableKey,
      nodes: buildExportTree(subject.syllabusNodes, options?.rootNodeKey),
    })),
  });

  return {
    markdown,
    workspaceId: workspace.id,
    filename: `areaforge-learning-tree-export-${scope}.md`,
  };
}

export async function previewLearningTreeImport(
  actorId: string,
  input: { markdown: string; scope?: LearningTreeScope },
): Promise<LearningTreePreviewDto> {
  const startedAt = Date.now();
  const operationId = randomUUID();
  const workspace = await resolveActiveWorkspace(actorId);
  const parsed = parseLearningTreeMarkdown(input.markdown);

  const workspaceMismatch =
    Boolean(parsed.frontmatter) && parsed.frontmatter!.workspaceKey !== workspace.stableKey;
  const scopeMismatch =
    Boolean(input.scope && parsed.frontmatter) && parsed.frontmatter!.scope !== input.scope;
  const errors = [...parsed.errors];
  if (workspaceMismatch) {
    errors.push({
      code: "FRONTMATTER_INVALID",
      message: "workspaceKey 与当前 ACTIVE 工作区不匹配。",
    });
  }
  if (scopeMismatch) {
    errors.push({
      code: "SCOPE_INVALID",
      message: "请求 scope 与 frontmatter scope 不一致。",
    });
  }

  const parseOk = parsed.ok && errors.length === 0;
  const sourceSha256 = sha256Hex(input.markdown);
  const canonicalPlanHash = parsed.canonicalMarkdown ? sha256Hex(parsed.canonicalMarkdown) : "";
  for (const object of parsed.objects) {
    if (object.type === "plan") {
      object.batchRef = createPlanBatchRef({
        sourceSha256,
        canonicalPlanHash,
        planStableKey: object.stableKey,
        originVersion: object.originVersion,
      });
    }
  }

  const existing = await loadExistingRefs(workspace.id);
  const items = parseOk ? buildLearningTreeDiff({ incoming: parsed.objects, existing }) : [];
  const blocking = !parseOk || items.some((item) => item.blocking);

  const env = getAuthEnv();
  const minted = mintLearningTreePreviewToken(
    {
      actorId,
      workspaceId: workspace.id,
      sourceSha256: sourceSha256 || "0".repeat(64),
      canonicalPlanHash: canonicalPlanHash || "0".repeat(64),
      scope: parsed.frontmatter?.scope ?? input.scope ?? "subject",
      rootRevision: workspace.revision,
    },
    env.AUTH_SESSION_SECRET,
  );

  console.info("learning-tree preview", {
    operationId,
    workspaceId: workspace.id,
    status: blocking ? "blocked" : "ok",
    objectCount: parsed.objects.length,
    errorCodes: [...new Set(errors.map((error) => error.code))],
    durationMs: Date.now() - startedAt,
  });

  return {
    operationId,
    workspaceId: workspace.id,
    scope: parsed.frontmatter?.scope ?? input.scope ?? "subject",
    protocolVersion: parsed.frontmatter?.protocol ?? "AREAFORGE_LEARNING_TREE_V1",
    parserVersion: "1.0.0",
    sourceSha256,
    canonicalPlanHash,
    canonicalMarkdown: parsed.canonicalMarkdown,
    rootRevision: workspace.revision,
    previewToken: minted.token,
    previewExpiresAt: new Date(minted.claims.expiry).toISOString(),
    items,
    errors,
    warnings: parsed.warnings,
    blocking,
    objectCount: parsed.objects.length,
  };
}

async function loadExistingRefs(workspaceId: string): Promise<LearningTreeExistingRef[]> {
  const subjects = await prisma.subject.findMany({
    where: { workspaceId },
    include: {
      syllabusNodes: true,
      notes: { select: { id: true, title: true, stableKey: true, subjectId: true } },
    },
  });
  const resources = await prisma.studyResource.findMany({
    where: { workspaceId },
    select: {
      id: true,
      title: true,
      stableKey: true,
      subjectId: true,
      archivedAt: true,
      subject: { select: { stableKey: true } },
    },
  });

  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const refs: LearningTreeExistingRef[] = [];

  for (const subject of subjects) {
    refs.push({
      objectType: "subject",
      stableKey: subject.stableKey,
      title: subject.name,
      subjectKey: subject.stableKey,
      entityId: subject.id,
      archived: Boolean(subject.archivedAt),
    });

    const nodeById = new Map(subject.syllabusNodes.map((node) => [node.id, node]));
    for (const node of subject.syllabusNodes) {
      const pathTitles = buildPathTitles(node.id, nodeById);
      refs.push({
        objectType: "node",
        // SyllabusNode.stableKey arrives in Migration 5; Batch 4 matches by path/title.
        stableKey: null,
        title: node.title,
        subjectKey: subject.stableKey,
        parentStableKey: null,
        pathTitles,
        entityId: node.id,
      });
    }

    for (const note of subject.notes) {
      refs.push({
        objectType: "card",
        stableKey: note.stableKey,
        title: note.title,
        subjectKey: subject.stableKey,
        entityId: note.id,
      });
    }
  }

  for (const resource of resources) {
    refs.push({
      objectType: "resource",
      stableKey: resource.stableKey,
      title: resource.title,
      subjectKey: resource.subject?.stableKey ?? subjectById.get(resource.subjectId ?? "")?.stableKey ?? null,
      entityId: resource.id,
      archived: Boolean(resource.archivedAt),
    });
  }

  return refs;
}

function buildPathTitles(
  nodeId: string,
  nodeById: Map<string, { id: string; title: string; parentId: string | null }>,
): string[] {
  const titles: string[] = [];
  let current: string | null = nodeId;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    const node = nodeById.get(current);
    if (!node) break;
    titles.unshift(node.title);
    current = node.parentId;
  }
  return titles;
}

function buildExportTree(
  nodes: Array<{
    id: string;
    parentId: string | null;
    title: string;
    sortOrder: number;
  }>,
  rootNodeKey?: string,
): LearningTreeExportNode[] {
  const byParent = new Map<string | null, typeof nodes>();
  for (const node of nodes) {
    const key = node.parentId;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }

  const walk = (parentId: string | null, depth: number): LearningTreeExportNode[] => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );
    return children.map((node) => ({
      // Export uses entity id as provisional stable key until SyllabusNode.stableKey exists.
      stableKey: `legacy_${node.id}`,
      title: node.title,
      depth,
      children: walk(node.id, depth + 1),
    }));
  };

  if (rootNodeKey?.startsWith("legacy_")) {
    const rootId = rootNodeKey.slice("legacy_".length);
    const root = nodes.find((node) => node.id === rootId);
    if (!root) return [];
    return [
      {
        stableKey: rootNodeKey,
        title: root.title,
        depth: 1,
        children: walk(root.id, 2),
      },
    ];
  }

  return walk(null, 1);
}
