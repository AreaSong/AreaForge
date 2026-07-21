import { randomUUID } from "node:crypto";
import {
  LEARNING_TREE_PARSER_VERSION,
  LEARNING_TREE_PROTOCOL,
  buildLearningTreeDiff,
  exportLearningTreeMarkdown,
  getLearningTreeTemplate,
  isNoteKind,
  parseLearningTreeMarkdown,
  type LearningTreeDiffItem,
  type LearningTreeExistingRef,
  type LearningTreeExportNode,
  type LearningTreeObject,
  type LearningTreeScope,
} from "@areaforge/core";
import {
  createPlanBatchRef,
  mintLearningTreePreviewToken,
  sha256Hex,
  verifyLearningTreePreviewToken,
} from "@areaforge/auth";
import { prisma, type Prisma } from "@areaforge/db";
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
      const parent = node.parentId ? nodeById.get(node.parentId) : null;
      refs.push({
        objectType: "node",
        stableKey: node.stableKey,
        title: node.title,
        subjectKey: subject.stableKey,
        parentStableKey: parent?.stableKey ?? null,
        pathTitles,
        archived: Boolean(node.archivedAt),
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
    stableKey: string | null;
    archivedAt: Date | null;
  }>,
  rootNodeKey?: string,
): LearningTreeExportNode[] {
  const byParent = new Map<string | null, typeof nodes>();
  for (const node of nodes) {
    if (node.archivedAt) continue;
    const key = node.parentId;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }

  const resolveKey = (node: { id: string; stableKey: string | null }) =>
    node.stableKey ?? `legacy_${node.id}`;

  const walk = (parentId: string | null, depth: number): LearningTreeExportNode[] => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );
    return children.map((node) => ({
      stableKey: resolveKey(node),
      title: node.title,
      depth,
      children: walk(node.id, depth + 1),
    }));
  };

  if (rootNodeKey) {
    const root =
      nodes.find((node) => node.stableKey === rootNodeKey) ??
      (rootNodeKey.startsWith("legacy_")
        ? nodes.find((node) => node.id === rootNodeKey.slice("legacy_".length))
        : undefined);
    if (!root) return [];
    return [
      {
        stableKey: resolveKey(root),
        title: root.title,
        depth: 1,
        children: walk(root.id, 2),
      },
    ];
  }

  return walk(null, 1);
}

export interface LearningTreeConfirmSelection {
  stableKey: string;
  choice: "apply" | "skip";
  mappedTargetId?: string;
}

export interface LearningTreeConfirmResultDto {
  batchId: string;
  workspaceId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  reused: boolean;
  appliedCount: number;
  skippedCount: number;
  confirmedAt: string;
}

export interface LearningTreeImportBatchSummaryDto {
  id: string;
  workspaceId: string;
  scope: string;
  protocolVersion: string;
  parserVersion: string;
  sourceSha256: string;
  canonicalPlanHash: string;
  rootRevision: number;
  idempotencyKey: string;
  stats: unknown;
  archivedAt: string | null;
  confirmedAt: string;
  itemCount: number;
}

export interface LearningTreeImportBatchDetailDto extends LearningTreeImportBatchSummaryDto {
  items: Array<{
    id: string;
    stableRef: string;
    objectType: string;
    diffType: string;
    sourceLine: number | null;
    userChoice: string;
    applyResult: string;
    redactedErrorCode: string | null;
  }>;
}

export async function confirmLearningTreeImport(
  actorId: string,
  input: {
    markdown: string;
    previewToken: string;
    idempotencyKey: string;
    selections: LearningTreeConfirmSelection[];
    previewOperationId?: string;
  },
): Promise<LearningTreeConfirmResultDto> {
  const env = getAuthEnv();
  const verified = verifyLearningTreePreviewToken(input.previewToken, env.AUTH_SESSION_SECRET);
  if (!verified.ok) {
    throw new ApiError(
      verified.reason === "expired" ? "LEARNING_TREE_PREVIEW_EXPIRED" : "LEARNING_TREE_PREVIEW_INVALID",
      verified.reason === "expired" ? 409 : 400,
    );
  }
  const claims = verified.claims;
  if (claims.actorId !== actorId) {
    throw new ApiError("LEARNING_TREE_PREVIEW_ACTOR_MISMATCH", 403);
  }

  const workspace = await resolveActiveWorkspace(actorId);
  if (workspace.id !== claims.workspaceId) {
    throw new ApiError("LEARNING_TREE_PREVIEW_WORKSPACE_MISMATCH", 409);
  }
  if (workspace.revision !== claims.rootRevision) {
    throw new ApiError("LEARNING_TREE_ROOT_REVISION_CONFLICT", 409, {
      latest: { revision: workspace.revision },
      conflictFields: ["rootRevision"],
    });
  }

  const parsed = parseLearningTreeMarkdown(input.markdown);
  if (!parsed.ok || !parsed.canonicalMarkdown) {
    throw new ApiError("LEARNING_TREE_CONFIRM_PARSE_FAILED", 400);
  }
  const submittedSha256 = sha256Hex(input.markdown);
  const canonicalPlanHash = sha256Hex(parsed.canonicalMarkdown);
  const sourceMatches =
    submittedSha256 === claims.sourceSha256 || submittedSha256 === claims.canonicalPlanHash;
  if (
    !sourceMatches ||
    canonicalPlanHash !== claims.canonicalPlanHash ||
    claims.parserVersion !== LEARNING_TREE_PARSER_VERSION ||
    claims.protocolVersion !== LEARNING_TREE_PROTOCOL
  ) {
    throw new ApiError("LEARNING_TREE_CONFIRM_FINGERPRINT_MISMATCH", 409);
  }
  const sourceSha256 = claims.sourceSha256;

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
  const diffItems = buildLearningTreeDiff({ incoming: parsed.objects, existing });
  if (diffItems.some((item) => item.blocking)) {
    throw new ApiError("LEARNING_TREE_CONFIRM_BLOCKED", 409);
  }

  const selectionMap = new Map(input.selections.map((row) => [row.stableKey, row]));
  const selectionFingerprint = input.selections
    .slice()
    .sort((a, b) => a.stableKey.localeCompare(b.stableKey))
    .map((row) => `${row.stableKey}:${row.choice}:${row.mappedTargetId ?? ""}`)
    .join("|");
  const requestFingerprint = sha256Hex(
    [
      "learning-tree-confirm:v1",
      claims.nonce,
      sourceSha256,
      canonicalPlanHash,
      claims.scope,
      String(claims.rootRevision),
      selectionFingerprint,
    ].join("|"),
  );

  const prior = await prisma.learningTreeImportBatch.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: workspace.id,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) {
      throw new ApiError("LEARNING_TREE_IDEMPOTENCY_CONFLICT", 409, {
        latest: { batchId: prior.id },
        conflictFields: ["idempotencyKey", "requestFingerprint"],
      });
    }
    const stats = prior.statsJson as { appliedCount?: number; skippedCount?: number };
    return {
      batchId: prior.id,
      workspaceId: prior.workspaceId,
      idempotencyKey: prior.idempotencyKey,
      requestFingerprint: prior.requestFingerprint,
      reused: true,
      appliedCount: stats.appliedCount ?? 0,
      skippedCount: stats.skippedCount ?? 0,
      confirmedAt: prior.confirmedAt.toISOString(),
    };
  }

  const nonceTaken = await prisma.learningTreeImportBatch.findFirst({
    where: { workspaceId: workspace.id, previewNonce: claims.nonce },
    select: { id: true },
  });
  if (nonceTaken) {
    throw new ApiError("LEARNING_TREE_PREVIEW_NONCE_CONSUMED", 409);
  }

  const objectByKey = new Map(parsed.objects.map((object) => [object.stableKey, object]));
  const subjectByKey = new Map(
    (
      await prisma.subject.findMany({
        where: { workspaceId: workspace.id },
        select: { id: true, stableKey: true },
      })
    ).map((row) => [row.stableKey, row.id]),
  );

  try {
    const result = await prisma.$transaction(async (tx) => {
      const appliedKeys: string[] = [];
      const skippedKeys: string[] = [];
      const itemRows: Array<{
        stableRef: string;
        objectType: string;
        diffType: string;
        sourceLine: number | null;
        sourceTargetKey: string | null;
        mappedTargetId: string | null;
        mappedTargetKey: string | null;
        userChoice: string;
        applyResult: string;
        redactedErrorCode: string | null;
      }> = [];

      const nodeIdByStableKey = new Map<string, string>();
      const existingNodes = await tx.syllabusNode.findMany({
        where: { subject: { workspaceId: workspace.id } },
        select: { id: true, stableKey: true, subjectId: true },
      });
      for (const node of existingNodes) {
        if (node.stableKey) nodeIdByStableKey.set(node.stableKey, node.id);
      }

      // Apply nodes first (parents before children by depth)
      const ordered = [...diffItems].sort((a, b) => {
        const ao = objectByKey.get(a.stableKey);
        const bo = objectByKey.get(b.stableKey);
        const ad = ao && ao.type === "node" ? ao.depth : 0;
        const bd = bo && bo.type === "node" ? bo.depth : 0;
        return ad - bd;
      });

      for (const item of ordered) {
        const selection = selectionMap.get(item.stableKey);
        const choice = selection?.choice ?? (item.diffType === "UNCHANGED" ? "skip" : "apply");
        if (choice === "skip" || item.diffType === "UNCHANGED" || item.diffType === "SKIP") {
          skippedKeys.push(item.stableKey);
          itemRows.push({
            stableRef: item.stableKey,
            objectType: item.objectType,
            diffType: item.diffType,
            sourceLine: item.sourceLine ?? null,
            sourceTargetKey: item.stableKey,
            mappedTargetId: item.candidateMatches[0]?.entityId ?? null,
            mappedTargetKey: item.candidateMatches[0]?.stableKey ?? null,
            userChoice: "skip",
            applyResult: "skipped",
            redactedErrorCode: null,
          });
          continue;
        }

        const object = objectByKey.get(item.stableKey);
        if (!object) {
          throw new ApiError("LEARNING_TREE_CONFIRM_OBJECT_MISSING", 400);
        }

        const mappedId = await applyLearningTreeObject(tx, {
          actorId,
          workspaceId: workspace.id,
          object,
          item,
          mappedTargetId: selection?.mappedTargetId ?? item.candidateMatches[0]?.entityId,
          subjectByKey,
          nodeIdByStableKey,
        });

        appliedKeys.push(item.stableKey);
        itemRows.push({
          stableRef: item.stableKey,
          objectType: item.objectType,
          diffType: item.diffType,
          sourceLine: item.sourceLine ?? null,
          sourceTargetKey: item.stableKey,
          mappedTargetId: mappedId,
          mappedTargetKey: item.stableKey,
          userChoice: "apply",
          applyResult: "applied",
          redactedErrorCode: null,
        });
      }

      const batch = await tx.learningTreeImportBatch.create({
        data: {
          workspaceId: workspace.id,
          protocolVersion: LEARNING_TREE_PROTOCOL,
          parserVersion: LEARNING_TREE_PARSER_VERSION,
          scope: claims.scope,
          canonicalMarkdown: parsed.canonicalMarkdown,
          sourceSha256,
          canonicalPlanHash,
          rootRevision: claims.rootRevision,
          statsJson: {
            appliedCount: appliedKeys.length,
            skippedCount: skippedKeys.length,
            objectCount: parsed.objects.length,
          },
          resultJson: { appliedKeys, skippedKeys },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          previewNonce: claims.nonce,
          previewOperationId: input.previewOperationId ?? null,
          actorId,
          items: {
            create: itemRows,
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "LEARNING_TREE_IMPORT_CONFIRMED",
          entityType: "LearningTreeImportBatch",
          entityId: batch.id,
          metadata: {
            operationId: input.previewOperationId ?? null,
            batchId: batch.id,
            appliedCount: appliedKeys.length,
            skippedCount: skippedKeys.length,
          },
        },
      });

      return {
        batchId: batch.id,
        workspaceId: workspace.id,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        reused: false,
        appliedCount: appliedKeys.length,
        skippedCount: skippedKeys.length,
        confirmedAt: batch.confirmedAt.toISOString(),
      };
    });

    return result;
  } catch (error) {
    if (isUnique(error)) {
      const raced = await prisma.learningTreeImportBatch.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: workspace.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (raced && raced.requestFingerprint === requestFingerprint) {
        const stats = raced.statsJson as { appliedCount?: number; skippedCount?: number };
        return {
          batchId: raced.id,
          workspaceId: raced.workspaceId,
          idempotencyKey: raced.idempotencyKey,
          requestFingerprint: raced.requestFingerprint,
          reused: true,
          appliedCount: stats.appliedCount ?? 0,
          skippedCount: stats.skippedCount ?? 0,
          confirmedAt: raced.confirmedAt.toISOString(),
        };
      }
      throw new ApiError("LEARNING_TREE_IDEMPOTENCY_CONFLICT", 409);
    }
    throw error;
  }
}

async function applyLearningTreeObject(
  tx: Prisma.TransactionClient,
  context: {
    actorId: string;
    workspaceId: string;
    object: LearningTreeObject;
    item: LearningTreeDiffItem;
    mappedTargetId?: string;
    subjectByKey: Map<string, string>;
    nodeIdByStableKey: Map<string, string>;
  },
): Promise<string | null> {
  const { object, item, subjectByKey, nodeIdByStableKey, workspaceId, actorId } = context;

  if (object.type === "group") {
    const existing = await tx.subjectGroup.findFirst({
      where: { workspaceId, stableKey: object.stableKey },
    });
    if (existing) {
      await tx.subjectGroup.update({
        where: { id: existing.id },
        data: { name: object.title },
      });
      return existing.id;
    }
    const created = await tx.subjectGroup.create({
      data: {
        workspaceId,
        stableKey: object.stableKey,
        name: object.title,
      },
    });
    return created.id;
  }

  if (object.type === "subject") {
    let groupId: string | null = null;
    if (object.groupKey) {
      const group = await tx.subjectGroup.findFirst({
        where: { workspaceId, stableKey: object.groupKey },
        select: { id: true },
      });
      groupId = group?.id ?? null;
    }
    const existing = await tx.subject.findFirst({
      where: { workspaceId, stableKey: object.stableKey },
    });
    if (existing) {
      await tx.subject.update({
        where: { id: existing.id },
        data: { name: object.title, groupId },
      });
      subjectByKey.set(object.stableKey, existing.id);
      return existing.id;
    }
    const created = await tx.subject.create({
      data: {
        workspaceId,
        stableKey: object.stableKey,
        name: object.title,
        color: "#4B5563",
        groupId,
      },
    });
    subjectByKey.set(object.stableKey, created.id);
    return created.id;
  }

  if (object.type === "node") {
    const subjectId = subjectByKey.get(object.subjectKey);
    if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
    const parentId = object.parentStableKey
      ? nodeIdByStableKey.get(object.parentStableKey) ?? null
      : null;
    if (object.parentStableKey && !parentId) {
      throw new ApiError("LEARNING_TREE_PARENT_MISSING", 400);
    }

    const targetId = context.mappedTargetId ?? item.candidateMatches[0]?.entityId;
    if (targetId && (item.diffType === "UPDATE" || item.diffType === "MOVE" || item.diffType === "ARCHIVE")) {
      await tx.syllabusNode.update({
        where: { id: targetId },
        data: {
          title: object.title,
          parentId,
          stableKey: object.stableKey,
          sortOrder: object.sortOrder ?? 0,
          archivedAt: object.archived ? new Date() : null,
          revision: { increment: 1 },
        },
      });
      nodeIdByStableKey.set(object.stableKey, targetId);
      return targetId;
    }

    if (item.diffType === "ADD" || !targetId) {
      const created = await tx.syllabusNode.create({
        data: {
          subjectId,
          parentId,
          title: object.title,
          kind: kindForDepth(object.depth),
          stableKey: object.stableKey,
          sortOrder: object.sortOrder ?? 0,
          archivedAt: object.archived ? new Date() : null,
        },
      });
      nodeIdByStableKey.set(object.stableKey, created.id);
      return created.id;
    }

    await tx.syllabusNode.update({
      where: { id: targetId },
      data: {
        title: object.title,
        parentId,
        stableKey: object.stableKey,
        revision: { increment: 1 },
      },
    });
    nodeIdByStableKey.set(object.stableKey, targetId);
    return targetId;
  }

  if (object.type === "card") {
    const subjectId = subjectByKey.get(object.subjectKey);
    if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
    const kind = isNoteKind(object.kind) ? object.kind : "GENERAL";
    const primaryNodeId = object.primaryNode
      ? nodeIdByStableKey.get(object.primaryNode) ?? null
      : null;
    const targetId = context.mappedTargetId ?? item.candidateMatches[0]?.entityId;
    if (targetId && item.diffType !== "ADD") {
      await tx.note.update({
        where: { id: targetId },
        data: {
          title: object.title,
          content: object.bodyMarkdown,
          kind,
          stableKey: object.stableKey,
          syllabusNodeId: primaryNodeId,
          revision: { increment: 1 },
        },
      });
      return targetId;
    }
    const created = await tx.note.create({
      data: {
        subjectId,
        title: object.title,
        content: object.bodyMarkdown,
        kind,
        stableKey: object.stableKey,
        syllabusNodeId: primaryNodeId,
      },
    });
    return created.id;
  }

  if (object.type === "resource") {
    const subjectId = subjectByKey.get(object.subjectKey) ?? null;
    const targetId = context.mappedTargetId ?? item.candidateMatches[0]?.entityId;
    if (targetId && item.diffType !== "ADD") {
      await tx.studyResource.update({
        where: { id: targetId },
        data: {
          title: object.title,
          externalUrl: object.url,
          displayHost: object.displayHost,
          subjectId,
          revision: { increment: 1 },
        },
      });
      return targetId;
    }
    const created = await tx.studyResource.create({
      data: {
        workspaceId,
        stableKey: object.stableKey,
        title: object.title,
        sourceType: "LINK",
        externalUrl: object.url,
        displayHost: object.displayHost,
        subjectId,
        actorId,
      },
    });
    return created.id;
  }

  if (object.type === "plan") {
    const subjectId = subjectByKey.get(object.subjectKey) ?? null;
    let planMilestoneId: string | null = null;
    if (object.milestoneKey) {
      const milestone = await tx.planMilestone.findFirst({
        where: { workspaceId, stableKey: object.milestoneKey },
        select: { id: true },
      });
      if (!milestone) {
        throw new ApiError("LEARNING_TREE_MILESTONE_MISSING", 409);
      }
      planMilestoneId = milestone.id;
    }
    const created = await tx.planInboxItem.create({
      data: {
        workspaceId,
        stableKey: object.stableKey,
        originKey: object.batchRef,
        originVersion: object.originVersion,
        originType: "learning_tree_plan",
        originSnapshot: {
          title: object.title,
          subjectKey: object.subjectKey,
          milestoneKey: object.milestoneKey ?? null,
          durationMinutes: object.durationMinutes ?? null,
          dependsOn: object.dependsOn ?? null,
          batchRef: object.batchRef,
        },
        title: object.title,
        subjectId,
        estimatedMinutes: object.durationMinutes ?? null,
        planMilestoneId,
        actorId,
      },
    });
    if (object.dependsOn?.startsWith("plan:")) {
      const depKey = object.dependsOn.slice("plan:".length);
      await tx.planInboxDependencyRef.create({
        data: {
          inboxItemId: created.id,
          targetType: "INBOX_STABLE_REF",
          dependencyType: object.dependencyType === "HARD" ? "HARD" : "SOFT",
          planStableKey: depKey,
          planOriginVersion: object.originVersion,
        },
      });
    }
    return created.id;
  }

  return null;
}

function kindForDepth(depth: number): "CHAPTER" | "TOPIC" | "PROBLEM_TYPE" {
  if (depth <= 1) return "CHAPTER";
  if (depth === 2) return "TOPIC";
  return "PROBLEM_TYPE";
}

export async function listLearningTreeImports(
  actorId: string,
): Promise<LearningTreeImportBatchSummaryDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.learningTreeImportBatch.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ confirmedAt: "desc" }],
    include: { _count: { select: { items: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    scope: row.scope,
    protocolVersion: row.protocolVersion,
    parserVersion: row.parserVersion,
    sourceSha256: row.sourceSha256,
    canonicalPlanHash: row.canonicalPlanHash,
    rootRevision: row.rootRevision,
    idempotencyKey: row.idempotencyKey,
    stats: row.statsJson,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt.toISOString(),
    itemCount: row._count.items,
  }));
}

export async function getLearningTreeImport(
  actorId: string,
  batchId: string,
): Promise<LearningTreeImportBatchDetailDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const row = await prisma.learningTreeImportBatch.findFirst({
    where: { id: batchId, workspaceId: workspace.id },
    include: { items: { orderBy: [{ createdAt: "asc" }] } },
  });
  if (!row) throw new ApiError("LEARNING_TREE_IMPORT_NOT_FOUND", 404);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scope: row.scope,
    protocolVersion: row.protocolVersion,
    parserVersion: row.parserVersion,
    sourceSha256: row.sourceSha256,
    canonicalPlanHash: row.canonicalPlanHash,
    rootRevision: row.rootRevision,
    idempotencyKey: row.idempotencyKey,
    stats: row.statsJson,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt.toISOString(),
    itemCount: row.items.length,
    items: row.items.map((item) => ({
      id: item.id,
      stableRef: item.stableRef,
      objectType: item.objectType,
      diffType: item.diffType,
      sourceLine: item.sourceLine,
      userChoice: item.userChoice,
      applyResult: item.applyResult,
      redactedErrorCode: item.redactedErrorCode,
    })),
  };
}

export async function exportLearningTreeImportCanonical(
  actorId: string,
  batchId: string,
): Promise<{ markdown: string; filename: string; workspaceId: string }> {
  const workspace = await resolveActiveWorkspace(actorId);
  const row = await prisma.learningTreeImportBatch.findFirst({
    where: { id: batchId, workspaceId: workspace.id },
    select: {
      id: true,
      workspaceId: true,
      canonicalMarkdown: true,
      confirmedAt: true,
    },
  });
  if (!row) throw new ApiError("LEARNING_TREE_IMPORT_NOT_FOUND", 404);
  return {
    markdown: row.canonicalMarkdown,
    workspaceId: row.workspaceId,
    filename: `areaforge-learning-tree-import-${row.id}.md`,
  };
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
