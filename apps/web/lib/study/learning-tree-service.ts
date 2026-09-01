import { randomUUID } from "node:crypto";
import {
  LEARNING_TREE_PARSER_VERSION,
  LEARNING_TREE_PROTOCOL,
  buildLearningTreeDiff,
  exportLearningTreeMarkdown,
  getLearningTreeTemplate,
  learningTreeObjectSemanticSignature,
  parseLearningTreeMarkdown,
  stableStringify,
  type LearningTreeDiffItem,
  type LearningTreeExistingRef,
  type LearningTreeExportNode,
  type LearningTreeObject,
  type LearningTreeScope,
} from "@areaforge/core";
import {
  createPlanBatchRef,
  mintLearningTreeExportToken,
  mintLearningTreePreviewToken,
  sha256Hex,
  verifyLearningTreeExportToken,
  verifyLearningTreePreviewToken,
} from "@areaforge/auth";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";
import type {
  LearningTreeConfirmResultDto,
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchDetailDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/contracts/learning-tree";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { bulkApplyLearningTreeAdds } from "./learning-tree-bulk-apply";
import { bulkApplyLearningTreeMutations } from "./learning-tree-bulk-mutate";

export type {
  LearningTreeConfirmResultDto,
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchDetailDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/contracts/learning-tree";

const LEARNING_TREE_IMPORTS_WORKBENCH = "/knowledge/imports";

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
): Promise<{ markdown: string; workspaceId: string; filename: string; rootRevision: number }> {
  const workspace = await resolveActiveWorkspace(actorId);
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: workspace.id, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      syllabusNodes: {
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
      notes: {
        where: { archivedAt: null },
        orderBy: [{ title: "asc" }, { id: "asc" }],
        include: {
          syllabusNode: { select: { id: true, stableKey: true } },
          relatedSyllabusNodes: {
            include: { syllabusNode: { select: { id: true, stableKey: true } } },
          },
        },
      },
      studyResources: {
        where: { archivedAt: null, sourceType: "LINK" },
        orderBy: [{ title: "asc" }, { id: "asc" }],
        include: {
          syllabusNodeLinks: { select: { syllabusNodeId: true } },
        },
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

  let rootParentNodeKey: string | undefined;
  if (scope === "branch") {
    if (!options?.rootNodeKey) throw new ApiError("ROOT_NODE_KEY_REQUIRED", 400);
    const branchSubject = filteredSubjects[0]!;
    const root = branchSubject.syllabusNodes.find(
      (node) => !node.archivedAt && exportStableKey("node", node.id, node.stableKey) === options.rootNodeKey,
    );
    if (!root) throw new ApiError("ROOT_NODE_NOT_FOUND", 404);
    const parent = root.parentId
      ? branchSubject.syllabusNodes.find((node) => node.id === root.parentId)
      : undefined;
    rootParentNodeKey = parent
      ? exportStableKey("node", parent.id, parent.stableKey)
      : undefined;
  }

  const includedSubjectIds = filteredSubjects.map((subject) => subject.id);
  const plans = await prisma.planInboxItem.findMany({
    where: {
      workspaceId: workspace.id,
      status: "OPEN",
      supersededByItemId: null,
      originType: "learning_tree_plan",
      subjectId: { in: includedSubjectIds },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      planMilestone: { select: { stableKey: true } },
      dependencyRefs: {
        where: { targetType: "INBOX_STABLE_REF" },
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
  const plansBySubject = new Map<string, typeof plans>();
  for (const plan of plans) {
    if (!plan.subjectId) continue;
    const rows = plansBySubject.get(plan.subjectId) ?? [];
    rows.push(plan);
    plansBySubject.set(plan.subjectId, rows);
  }

  const markdown = exportLearningTreeMarkdown({
    scope,
    workspaceKey: workspace.stableKey,
    subjectKey: options?.subjectKey,
    rootNodeKey: options?.rootNodeKey,
    rootParentNodeKey,
    groups: groups.map((group) => ({ stableKey: group.stableKey, title: group.name })),
    subjects: filteredSubjects.map((subject) => {
      const branchNodeIds = getExportBranchNodeIds(subject.syllabusNodes, options?.rootNodeKey);
      const subjectPlans = (plansBySubject.get(subject.id) ?? []).filter((plan) =>
        scope !== "branch" || planReferencesBranch(plan.primaryNodeId, plan.relatedNodeIds, branchNodeIds),
      );
      const includedPlanKeys = new Set(subjectPlans.map((plan) => planSourceStableKey(plan)));
      return {
        stableKey: subject.stableKey,
        title: subject.name,
        groupKey: subject.group?.stableKey,
        nodes: buildExportTree(subject.syllabusNodes, options?.rootNodeKey),
        cards: subject.notes
          .filter((note) => scope !== "branch" || noteReferencesBranch(note, branchNodeIds))
          .map((note) => ({
            stableKey: exportStableKey("card", note.id, note.stableKey),
            title: note.title,
            kind: note.kind,
            subjectKey: subject.stableKey,
            primaryNode: note.syllabusNode && branchNodeIds.has(note.syllabusNode.id)
              ? exportStableKey("node", note.syllabusNode.id, note.syllabusNode.stableKey)
              : undefined,
            relatedNodes: note.relatedSyllabusNodes
              .filter(({ syllabusNode }) => branchNodeIds.has(syllabusNode.id))
              .map(({ syllabusNode }) => exportStableKey("node", syllabusNode.id, syllabusNode.stableKey)),
            bodyMarkdown: note.content,
          })),
        resources: subject.studyResources
          .filter((resource) =>
            Boolean(resource.externalUrl) &&
            (scope !== "branch" || resource.syllabusNodeLinks.some((link) => branchNodeIds.has(link.syllabusNodeId))),
          )
          .map((resource) => ({
            stableKey: resource.stableKey,
            title: resource.title,
            subjectKey: subject.stableKey,
            url: resource.externalUrl!,
          })),
        plans: subjectPlans.map((plan) => {
          const dependency = plan.dependencyRefs.find(
            (ref) => ref.planStableKey && includedPlanKeys.has(ref.planStableKey),
          );
          return {
            stableKey: planSourceStableKey(plan),
            title: plan.title,
            subjectKey: subject.stableKey,
            milestoneKey: plan.planMilestone?.stableKey,
            durationMinutes: plan.estimatedMinutes ?? undefined,
            dependsOn: dependency?.planStableKey ? `plan:${dependency.planStableKey}` : undefined,
            dependencyType: dependency?.dependencyType,
          };
        }),
      };
    }),
  });

  return {
    markdown,
    workspaceId: workspace.id,
    filename: `areaforge-learning-tree-export-${scope}.md`,
    rootRevision: workspace.revision,
  };
}

function planSourceStableKey(plan: { stableKey: string; originSnapshot: Prisma.JsonValue }): string {
  return stringValue(asRecord(plan.originSnapshot).sourceStableKey) ?? plan.stableKey;
}

export async function listLearningTreeExportOptions(actorId: string): Promise<LearningTreeExportOptionsDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: workspace.id, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      stableKey: true,
      name: true,
      syllabusNodes: {
        where: { archivedAt: null, stableKey: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        select: { stableKey: true, title: true },
      },
    },
  });
  return {
    workspaceKey: workspace.stableKey,
    subjects: subjects.map((subject) => ({
      id: subject.id,
      stableKey: subject.stableKey,
      name: subject.name,
      nodes: subject.syllabusNodes.flatMap((node) =>
        node.stableKey ? [{ stableKey: node.stableKey, title: node.title }] : [],
      ),
    })),
  };
}

export async function previewActiveLearningTreeExport(
  actorId: string,
  scope: LearningTreeScope,
  options?: { subjectKey?: string; rootNodeKey?: string },
) {
  const exported = await exportActiveLearningTreeMarkdown(actorId, scope, options);
  const parsed = parseLearningTreeMarkdown(exported.markdown);
  if (!parsed.ok) {
    throw learningTreeConflict(
      "LEARNING_TREE_EXPORT_INVALID",
      {
        state: "EXPORT_INVALID",
        workspaceId: exported.workspaceId,
        rootRevision: exported.rootRevision,
      },
      ["exportSnapshot"],
    );
  }
  const sourceSha256 = sha256Hex(exported.markdown);
  const env = getAuthEnv();
  const minted = mintLearningTreeExportToken({
    actorId,
    workspaceId: exported.workspaceId,
    sourceSha256,
    scope,
    subjectKey: options?.subjectKey,
    rootNodeKey: options?.rootNodeKey,
    rootRevision: exported.rootRevision,
  }, env.AUTH_SESSION_SECRET);
  await prisma.learningTreeExportGrant.create({
    data: {
      nonce: minted.claims.nonce,
      actorId,
      workspaceId: exported.workspaceId,
      scope,
      subjectKey: options?.subjectKey,
      rootNodeKey: options?.rootNodeKey,
      sourceSha256,
      rootRevision: exported.rootRevision,
      expiresAt: new Date(minted.claims.expiry),
    },
  });
  const externalHosts = Array.from(
    new Set(
      parsed.objects.flatMap((object) =>
        object.type === "resource" && object.displayHost ? [object.displayHost] : [],
      ),
    ),
  ).sort();
  return {
    scope,
    objectCount: parsed.objects.length,
    cardBodyCount: parsed.objects.filter((object) => object.type === "card" && object.bodyMarkdown.trim()).length,
    planTitleCount: parsed.objects.filter((object) => object.type === "plan").length,
    externalHosts,
    bytes: Buffer.byteLength(exported.markdown, "utf8"),
    sourceSha256,
    exportToken: minted.token,
    exportExpiresAt: new Date(minted.claims.expiry).toISOString(),
  };
}

export async function consumeLearningTreeExport(
  actorId: string,
  input: {
    token: string;
    scope: LearningTreeScope;
    subjectKey?: string;
    rootNodeKey?: string;
  },
) {
  const env = getAuthEnv();
  const verified = verifyLearningTreeExportToken(input.token, env.AUTH_SESSION_SECRET);
  if (!verified.ok) {
    if (verified.reason !== "expired") throw new ApiError("LEARNING_TREE_EXPORT_TOKEN_INVALID", 400);
    throw learningTreeConflict(
      "LEARNING_TREE_EXPORT_EXPIRED",
      {
        state: "EXPORT_EXPIRED",
        workspaceId: null,
        rootRevision: null,
      },
      ["exportToken"],
    );
  }
  const claims = verified.claims;
  if (claims.actorId !== actorId) throw new ApiError("LEARNING_TREE_EXPORT_ACTOR_MISMATCH", 403);
  if (
    claims.scope !== input.scope ||
    (claims.subjectKey ?? null) !== (input.subjectKey ?? null) ||
    (claims.rootNodeKey ?? null) !== (input.rootNodeKey ?? null)
  ) {
    throw learningTreeConflict(
      "LEARNING_TREE_EXPORT_SCOPE_MISMATCH",
      {
        state: "EXPORT_SCOPE_CHANGED",
        workspaceId: claims.workspaceId,
        rootRevision: claims.rootRevision,
        scope: claims.scope,
        subjectKey: claims.subjectKey ?? null,
        rootNodeKey: claims.rootNodeKey ?? null,
      },
      ["scope", "subjectKey", "rootNodeKey"],
    );
  }

  const exported = await exportActiveLearningTreeMarkdown(actorId, input.scope, input);
  if (
    claims.workspaceId !== exported.workspaceId ||
    claims.rootRevision !== exported.rootRevision ||
    claims.sourceSha256 !== sha256Hex(exported.markdown)
  ) {
    throw learningTreeConflict(
      "LEARNING_TREE_EXPORT_STALE",
      {
        state: "EXPORT_STALE",
        workspaceId: exported.workspaceId,
        rootRevision: exported.rootRevision,
        sourceSha256: sha256Hex(exported.markdown),
      },
      ["workspaceId", "rootRevision", "sourceSha256"],
    );
  }

  const now = new Date();
  const consumed = await prisma.$transaction(async (tx) => {
    const cas = await tx.learningTreeExportGrant.updateMany({
      where: {
        nonce: claims.nonce,
        actorId,
        workspaceId: exported.workspaceId,
        scope: input.scope,
        subjectKey: input.subjectKey ?? null,
        rootNodeKey: input.rootNodeKey ?? null,
        sourceSha256: claims.sourceSha256,
        rootRevision: claims.rootRevision,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (cas.count !== 1) return false;
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "LEARNING_TREE_EXPORT_DOWNLOADED",
        entityType: "LearningTreeExportGrant",
        entityId: claims.nonce,
        metadata: {
          scope: input.scope,
          sourceSha256: claims.sourceSha256,
          objectCount: parseLearningTreeMarkdown(exported.markdown).objects.length,
        },
      },
    });
    return true;
  });
  if (!consumed) {
    const latestGrant = await prisma.learningTreeExportGrant.findUnique({
      where: { nonce: claims.nonce },
      select: { workspaceId: true, rootRevision: true, consumedAt: true, expiresAt: true },
    });
    throw learningTreeConflict(
      "LEARNING_TREE_EXPORT_TOKEN_CONSUMED",
      {
        state: latestGrant?.consumedAt
          ? "EXPORT_CONSUMED"
          : latestGrant && latestGrant.expiresAt <= now
            ? "EXPORT_EXPIRED"
            : "EXPORT_UNAVAILABLE",
        workspaceId: latestGrant?.workspaceId ?? exported.workspaceId,
        rootRevision: latestGrant?.rootRevision ?? exported.rootRevision,
      },
      ["exportToken"],
    );
  }
  return exported;
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
  const existing = parseOk ? await loadExistingRefs(workspace.id) : [];
  if (parseOk) prepareLearningTreePlans(parsed.objects, existing, sourceSha256, canonicalPlanHash);
  const items = parseOk ? buildLearningTreeDiff({ incoming: parsed.objects, existing }) : [];
  protectBranchRootMove(items, parsed.objects, existing, input.scope ?? parsed.frontmatter?.scope);
  const missingMilestoneKeys = parseOk
    ? await findMissingPlanMilestoneKeys(workspace.id, parsed.objects)
    : [];
  if (missingMilestoneKeys.length) {
    markMissingPlanMilestones(items, parsed.objects, missingMilestoneKeys);
    const missing = new Set(missingMilestoneKeys);
    for (const object of parsed.objects) {
      if (object.type === "plan" && object.milestoneKey && missing.has(object.milestoneKey)) {
        errors.push({
          code: "MILESTONE_NOT_FOUND",
          message: `里程碑 ${object.milestoneKey} 不存在，请先在阶段计划中创建后重新预览。`,
          sourceLine: object.sourceLine,
          stableKey: object.stableKey,
        });
      }
    }
  }
  const blocking = !parseOk || items.some((item) => item.blocking);
  const diffSnapshotHash = createLearningTreeDiffSnapshotHash(items, existing);

  const env = getAuthEnv();
  const minted = mintLearningTreePreviewToken(
    {
      actorId,
      workspaceId: workspace.id,
      sourceSha256: sourceSha256 || "0".repeat(64),
      canonicalPlanHash: canonicalPlanHash || "0".repeat(64),
      diffSnapshotHash,
      scope: input.scope ?? parsed.frontmatter?.scope ?? "subject",
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
    scope: input.scope ?? parsed.frontmatter?.scope ?? "subject",
    protocolVersion: parsed.frontmatter?.protocol ?? "AREAFORGE_LEARNING_TREE_V1",
    parserVersion: LEARNING_TREE_PARSER_VERSION,
    sourceSha256,
    canonicalPlanHash,
    diffSnapshotHash,
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

type LearningTreeReadClient = Pick<
  Prisma.TransactionClient,
  "subjectGroup" | "subject" | "studyResource" | "planInboxItem" | "planMilestone"
>;

async function loadExistingRefs(
  workspaceId: string,
  client: LearningTreeReadClient = prisma,
): Promise<LearningTreeExistingRef[]> {
  const groups = await client.subjectGroup.findMany({
    where: { workspaceId },
    select: { id: true, stableKey: true, name: true, archivedAt: true, updatedAt: true },
  });
  const subjects = await client.subject.findMany({
    where: { workspaceId },
    include: {
      group: { select: { stableKey: true } },
      syllabusNodes: true,
      notes: {
        include: {
          syllabusNode: { select: { id: true, stableKey: true } },
          relatedSyllabusNodes: {
            include: { syllabusNode: { select: { id: true, stableKey: true } } },
          },
        },
      },
    },
  });
  const resources = await client.studyResource.findMany({
    where: { workspaceId },
    select: {
      id: true,
      title: true,
      stableKey: true,
      subjectId: true,
      archivedAt: true,
      externalUrl: true,
      revision: true,
      updatedAt: true,
      subject: { select: { stableKey: true } },
    },
  });
  const plans = await client.planInboxItem.findMany({
    where: { workspaceId, originType: "learning_tree_plan" },
    orderBy: [{ originVersion: "desc" }, { updatedAt: "desc" }],
    include: {
      planMilestone: { select: { stableKey: true } },
      dependencyRefs: { where: { targetType: "INBOX_STABLE_REF" }, orderBy: { createdAt: "asc" } },
    },
  });

  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const refs: LearningTreeExistingRef[] = [];

  for (const group of groups) {
    refs.push({
      objectType: "group",
      stableKey: group.stableKey,
      title: group.name,
      subjectKey: null,
      entityId: group.id,
      archived: Boolean(group.archivedAt),
      updatedAt: group.updatedAt.toISOString(),
      semanticSignature: JSON.stringify(["group", group.name]),
    });
  }

  for (const subject of subjects) {
    refs.push({
      objectType: "subject",
      stableKey: subject.stableKey,
      title: subject.name,
      subjectKey: subject.stableKey,
      entityId: subject.id,
      archived: Boolean(subject.archivedAt),
      updatedAt: subject.updatedAt.toISOString(),
      semanticSignature: JSON.stringify(["subject", subject.name, subject.group?.stableKey ?? null]),
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
        parentStableKey: parent ? exportStableKey("node", parent.id, parent.stableKey) : null,
        pathTitles,
        archived: Boolean(node.archivedAt),
        entityId: node.id,
        revision: node.revision,
        updatedAt: node.updatedAt.toISOString(),
        sortOrder: node.sortOrder,
        status: node.status,
        semanticSignature: JSON.stringify([
          "node",
          node.title,
          subject.stableKey,
          parent ? exportStableKey("node", parent.id, parent.stableKey) : null,
          Boolean(node.archivedAt),
        ]),
      });
    }

    for (const note of subject.notes) {
      refs.push({
        objectType: "card",
        stableKey: note.stableKey,
        title: note.title,
        subjectKey: subject.stableKey,
        entityId: note.id,
        archived: Boolean(note.archivedAt),
        revision: note.revision,
        updatedAt: note.updatedAt.toISOString(),
        semanticSignature: JSON.stringify([
          "card",
          note.title,
          subject.stableKey,
          note.kind,
          note.syllabusNode
            ? exportStableKey("node", note.syllabusNode.id, note.syllabusNode.stableKey)
            : null,
          note.relatedSyllabusNodes
            .map(({ syllabusNode }) => exportStableKey("node", syllabusNode.id, syllabusNode.stableKey))
            .sort(),
          note.content,
        ]),
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
      revision: resource.revision,
      updatedAt: resource.updatedAt.toISOString(),
      semanticSignature: JSON.stringify([
        "resource",
        resource.title,
        resource.subject?.stableKey ?? subjectById.get(resource.subjectId ?? "")?.stableKey ?? null,
        "LINK",
        resource.externalUrl ?? "",
      ]),
    });
  }

  const seenPlans = new Set<string>();
  for (const plan of plans) {
    const snapshot = asRecord(plan.originSnapshot);
    const sourceStableKey = stringValue(snapshot.sourceStableKey) ?? plan.stableKey;
    const subjectKey = subjectById.get(plan.subjectId ?? "")?.stableKey ?? null;
    const identity = `${subjectKey ?? ""}:${sourceStableKey}`;
    if (seenPlans.has(identity)) continue;
    seenPlans.add(identity);
    const dependency = plan.dependencyRefs.find((ref) => ref.planStableKey);
    refs.push({
      objectType: "plan",
      stableKey: sourceStableKey,
      title: plan.title,
      subjectKey,
      entityId: plan.id,
      revision: plan.revision,
      updatedAt: plan.updatedAt.toISOString(),
      originVersion: plan.originVersion,
      semanticSignature: JSON.stringify([
        "plan",
        plan.title,
        subjectKey,
        stringValue(snapshot.milestoneKey) ?? plan.planMilestone?.stableKey ?? null,
        numberValue(snapshot.durationMinutes) ?? plan.estimatedMinutes ?? null,
        stringValue(snapshot.dependsOn) ?? (dependency?.planStableKey ? `plan:${dependency.planStableKey}` : null),
        stringValue(snapshot.dependencyType) ?? dependency?.dependencyType ?? "SOFT",
      ]),
    });
  }

  return refs;
}

function prepareLearningTreePlans(
  objects: LearningTreeObject[],
  existing: LearningTreeExistingRef[],
  sourceSha256: string,
  canonicalPlanHash: string,
): void {
  for (const object of objects) {
    if (object.type !== "plan") continue;
    const previous = existing.find((ref) =>
      ref.objectType === "plan" &&
      ref.stableKey === object.stableKey &&
      ref.subjectKey === object.subjectKey,
    );
    object.originVersion = previous
      ? previous.semanticSignature === learningTreeObjectSemanticSignature(object)
        ? previous.originVersion ?? 1
        : (previous.originVersion ?? 1) + 1
      : 1;
    object.batchRef = createPlanBatchRef({
      sourceSha256,
      canonicalPlanHash,
      planStableKey: object.stableKey,
      originVersion: object.originVersion,
    });
  }
}

function createLearningTreeDiffSnapshotHash(
  items: LearningTreeDiffItem[],
  existing: LearningTreeExistingRef[],
): string {
  const orderedExisting = [...existing].sort((left, right) =>
    [left.objectType, left.subjectKey ?? "", left.stableKey ?? "", left.entityId ?? ""].join(":")
      .localeCompare([right.objectType, right.subjectKey ?? "", right.stableKey ?? "", right.entityId ?? ""].join(":")),
  );
  const semanticItems = items.map(({ sourceLine, ...item }) => {
    void sourceLine;
    return item;
  });
  return sha256Hex(stableStringify({ items: semanticItems, existing: orderedExisting }));
}

function protectBranchRootMove(
  items: LearningTreeDiffItem[],
  objects: LearningTreeObject[],
  existing: LearningTreeExistingRef[],
  scope: LearningTreeScope | undefined,
): void {
  if (scope !== "branch") return;
  const nodes = objects.filter((object) => object.type === "node");
  const nodeKeys = new Set(nodes.map((node) => node.stableKey));
  const roots = nodes.filter((node) => !node.parentStableKey || !nodeKeys.has(node.parentStableKey));
  if (roots.length !== 1) return;
  const actualRoot = roots[0]!;
  const rootItem = items.find(
    (item) => item.objectType === "node" && item.stableKey === actualRoot.stableKey,
  );
  if (!rootItem) return;
  const candidateIds = new Set(rootItem.candidateMatches.flatMap((candidate) =>
    candidate.entityId ? [candidate.entityId] : []
  ));
  const persistedRoot = existing.find((row) =>
    row.objectType === "node" &&
    row.subjectKey === actualRoot.subjectKey &&
    (candidateIds.has(row.entityId ?? "") || row.stableKey === actualRoot.stableKey)
  );
  if (!persistedRoot || (persistedRoot.parentStableKey ?? null) === (actualRoot.parentStableKey ?? null)) return;
  rootItem.blocking = true;
  rootItem.reason = "branch_root_parent_mismatch";
}

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function stringValue(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
    status: string;
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

  const walk = (parentId: string | null, depth: number): LearningTreeExportNode[] => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );
    return children.map((node) => ({
      stableKey: exportStableKey("node", node.id, node.stableKey),
      title: node.title,
      depth,
      sortOrder: node.sortOrder,
      status: node.status,
      children: walk(node.id, depth + 1),
    }));
  };

  if (rootNodeKey) {
    const root =
      nodes.find((node) => !node.archivedAt && exportStableKey("node", node.id, node.stableKey) === rootNodeKey);
    if (!root) throw new ApiError("ROOT_NODE_NOT_FOUND", 404);
    return [
      {
        stableKey: exportStableKey("node", root.id, root.stableKey),
        title: root.title,
        depth: 1,
        sortOrder: root.sortOrder,
        status: root.status,
        children: walk(root.id, 2),
      },
    ];
  }

  return walk(null, 1);
}

function exportStableKey(type: "node" | "card", id: string, stableKey: string | null): string {
  return stableKey ?? `legacy_${type}_${id}`;
}

function getExportBranchNodeIds(
  nodes: Array<{ id: string; parentId: string | null; stableKey: string | null; archivedAt: Date | null }>,
  rootNodeKey?: string,
): Set<string> {
  const active = nodes.filter((node) => !node.archivedAt);
  if (!rootNodeKey) return new Set(active.map((node) => node.id));
  const root = active.find((node) => exportStableKey("node", node.id, node.stableKey) === rootNodeKey);
  if (!root) throw new ApiError("ROOT_NODE_NOT_FOUND", 404);
  const result = new Set([root.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of active) {
      if (node.parentId && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function noteReferencesBranch(
  note: {
    syllabusNodeId: string | null;
    relatedSyllabusNodes: Array<{ syllabusNodeId: string }>;
  },
  branchNodeIds: Set<string>,
): boolean {
  return Boolean(note.syllabusNodeId && branchNodeIds.has(note.syllabusNodeId)) ||
    note.relatedSyllabusNodes.some((link) => branchNodeIds.has(link.syllabusNodeId));
}

function planReferencesBranch(
  primaryNodeId: string | null,
  relatedNodeIds: Prisma.JsonValue | null,
  branchNodeIds: Set<string>,
): boolean {
  if (primaryNodeId && branchNodeIds.has(primaryNodeId)) return true;
  return Array.isArray(relatedNodeIds) && relatedNodeIds.some(
    (nodeId) => typeof nodeId === "string" && branchNodeIds.has(nodeId),
  );
}

export interface LearningTreeConfirmSelection {
  stableKey: string;
  choice: "apply" | "skip";
  mappedTargetId?: string;
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
  if (!verified.ok && verified.reason !== "expired") {
    throw new ApiError("LEARNING_TREE_PREVIEW_INVALID", 400);
  }
  const claims = verified.claims;
  const previewExpired = !verified.ok;
  if (claims.actorId !== actorId) {
    throw new ApiError("LEARNING_TREE_PREVIEW_ACTOR_MISMATCH", 403);
  }

  const claimedWorkspace = await prisma.examWorkspace.findFirst({
    where: { id: claims.workspaceId, userId: actorId },
    select: { id: true, stableKey: true, status: true, revision: true },
  });
  if (!claimedWorkspace) {
    throw learningTreeConfirmConflict(
      "LEARNING_TREE_PREVIEW_WORKSPACE_MISMATCH",
      { state: "UNAVAILABLE", workspaceId: null, rootRevision: null },
      ["workspaceId"],
    );
  }
  const parsed = parseLearningTreeMarkdown(input.markdown);
  if (!parsed.ok || !parsed.canonicalMarkdown) {
    throw new ApiError("LEARNING_TREE_CONFIRM_PARSE_FAILED", 400);
  }
  if (
    parsed.frontmatter?.workspaceKey !== claimedWorkspace.stableKey ||
    parsed.frontmatter.scope !== claims.scope
  ) {
    const conflictFields = [
      parsed.frontmatter?.workspaceKey !== claimedWorkspace.stableKey ? "workspaceKey" : null,
      parsed.frontmatter?.scope !== claims.scope ? "scope" : null,
    ].filter((field): field is string => field !== null);
    throw learningTreeConfirmConflict(
      "LEARNING_TREE_CONFIRM_FRONTMATTER_MISMATCH",
      {
        state: claimedWorkspace.status,
        workspaceId: claimedWorkspace.id,
        workspaceKey: claimedWorkspace.stableKey,
        scope: claims.scope,
        rootRevision: claimedWorkspace.revision,
      },
      conflictFields,
    );
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
    throw learningTreeConfirmConflict(
      "LEARNING_TREE_CONFIRM_FINGERPRINT_MISMATCH",
      {
        state: "PREVIEW_CHANGED",
        workspaceId: claimedWorkspace.id,
        rootRevision: claimedWorkspace.revision,
        sourceSha256: claims.sourceSha256,
        canonicalPlanHash: claims.canonicalPlanHash,
        parserVersion: claims.parserVersion,
        protocolVersion: claims.protocolVersion,
      },
      ["sourceSha256", "canonicalPlanHash", "parserVersion", "protocolVersion"],
    );
  }
  const sourceSha256 = claims.sourceSha256;

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

  const persisted = await prisma.learningTreeImportBatch.findFirst({
    where: {
      workspaceId: claimedWorkspace.id,
      actorId,
      idempotencyKey: input.idempotencyKey,
    },
  });
  if (persisted) return reuseLearningTreeImport(persisted, requestFingerprint);
  if (previewExpired) {
    throw learningTreeConfirmConflict(
      "LEARNING_TREE_PREVIEW_EXPIRED",
      {
        state: "PREVIEW_EXPIRED",
        workspaceId: claimedWorkspace.id,
        rootRevision: claimedWorkspace.revision,
        previewExpiresAt: new Date(claims.expiry).toISOString(),
      },
      ["previewToken"],
    );
  }

  const workspace = await resolveActiveWorkspace(actorId);
  if (workspace.id !== claimedWorkspace.id) {
    throw learningTreeConfirmConflict(
      "LEARNING_TREE_PREVIEW_WORKSPACE_MISMATCH",
      {
        state: workspace.status,
        workspaceId: workspace.id,
        rootRevision: workspace.revision,
      },
      ["workspaceId"],
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ revision: number }>>`
        SELECT revision FROM "ExamWorkspace"
        WHERE id = ${workspace.id} AND "userId" = ${actorId} AND status = 'ACTIVE'
        FOR UPDATE
      `;
      const prior = await tx.learningTreeImportBatch.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: workspace.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (prior) return reuseLearningTreeImport(prior, requestFingerprint);

      if (lockedRows[0]?.revision !== claims.rootRevision) {
        throw learningTreeConfirmConflict(
          "LEARNING_TREE_ROOT_REVISION_CONFLICT",
          {
            state: "ACTIVE",
            workspaceId: workspace.id,
            rootRevision: lockedRows[0]?.revision ?? null,
          },
          ["rootRevision"],
        );
      }

      const nonceTaken = await tx.learningTreeImportBatch.findFirst({
        where: { workspaceId: workspace.id, previewNonce: claims.nonce },
        select: { id: true },
      });
      if (nonceTaken) {
        throw learningTreeConfirmConflict(
          "LEARNING_TREE_PREVIEW_NONCE_CONSUMED",
          {
            state: "CONFIRMED",
            workspaceId: workspace.id,
            rootRevision: lockedRows[0]?.revision ?? null,
            batchId: nonceTaken.id,
          },
          ["previewToken"],
        );
      }

      const existing = await loadExistingRefs(workspace.id, tx);
      prepareLearningTreePlans(parsed.objects, existing, sourceSha256, canonicalPlanHash);
      const diffItems = buildLearningTreeDiff({ incoming: parsed.objects, existing });
      protectBranchRootMove(diffItems, parsed.objects, existing, claims.scope);
      const missingMilestoneKeys = await findMissingPlanMilestoneKeys(workspace.id, parsed.objects, tx);
      markMissingPlanMilestones(diffItems, parsed.objects, missingMilestoneKeys);
      const currentDiffSnapshotHash = createLearningTreeDiffSnapshotHash(diffItems, existing);
      if (currentDiffSnapshotHash !== claims.diffSnapshotHash) {
        throw learningTreeConfirmConflict(
          "LEARNING_TREE_DIFF_SNAPSHOT_CONFLICT",
          {
            state: "DIFF_CHANGED",
            workspaceId: workspace.id,
            rootRevision: lockedRows[0]?.revision ?? null,
            diffSnapshotHash: currentDiffSnapshotHash,
          },
          ["diffSnapshotHash"],
        );
      }
      if (missingMilestoneKeys.length) {
        throw learningTreeConfirmConflict(
          "LEARNING_TREE_MILESTONE_MISSING",
          {
            state: "BLOCKED",
            workspaceId: workspace.id,
            rootRevision: lockedRows[0]?.revision ?? null,
            missingMilestoneKeys,
          },
          missingMilestoneKeys.map((key) => `milestone:${key}`),
        );
      }
      assertValidConfirmSelections(input.selections, diffItems);
      if (hasUnresolvedBlockingDiff(input.selections, diffItems)) {
        const blockingItems = diffItems.filter((item) => item.blocking);
        throw learningTreeConfirmConflict(
          "LEARNING_TREE_CONFIRM_BLOCKED",
          {
            state: "BLOCKED",
            workspaceId: workspace.id,
            rootRevision: lockedRows[0]?.revision ?? null,
            blockingCount: blockingItems.length,
            blockingStableKeys: blockingItems.slice(0, 50).map((item) => item.stableKey),
          },
          ["selections"],
        );
      }

      const selectionMap = new Map(input.selections.map((row) => [row.stableKey, row]));
      const objectByKey = new Map(parsed.objects.map((object) => [object.stableKey, object]));
      const subjectByKey = new Map(
        (
          await tx.subject.findMany({
            where: { workspaceId: workspace.id, archivedAt: null },
            select: { id: true, stableKey: true },
          })
        ).map((row) => [row.stableKey, row.id]),
      );

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
          statsJson: { appliedCount: 0, skippedCount: 0, objectCount: parsed.objects.length },
          resultJson: { appliedKeys: [], skippedKeys: [] },
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          previewNonce: claims.nonce,
          previewOperationId: input.previewOperationId ?? null,
          actorId,
        },
      });

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
      const archivedNodeKeys = new Set<string>();
      const existingNodes = await tx.syllabusNode.findMany({
        where: { subject: { workspaceId: workspace.id } },
        select: {
          id: true,
          stableKey: true,
          archivedAt: true,
          subject: { select: { stableKey: true } },
        },
      });
      for (const node of existingNodes) {
        const stableKey = node.stableKey ?? exportStableKey("node", node.id, null);
        const lookupKey = nodeLookupKey(node.subject.stableKey, stableKey);
        if (node.archivedAt) archivedNodeKeys.add(lookupKey);
        else nodeIdByStableKey.set(lookupKey, node.id);
      }

      const ordered = [...diffItems].sort((left, right) =>
        compareLearningTreeApplyOrder(left, right, objectByKey),
      );
      const planOriginVersionBySourceKey = new Map(
        parsed.objects.flatMap((candidate) =>
          candidate.type === "plan" ? [[candidate.stableKey, candidate.originVersion] as const] : [],
        ),
      );
      const bulkAppliedIds = new Map<string, string>();
      const bulkMutationStats = {
        objectCount: 0,
        writeBatchCount: 0,
        diffTypeCounts: { UPDATE: 0, MOVE: 0, ARCHIVE: 0, CONFLICT: 0 },
      };
      const bulkContext = {
        tx,
        actorId,
        workspaceId: workspace.id,
        importBatchId: batch.id,
        diffItems,
        objectByKey,
        selectionByKey: selectionMap,
        subjectByKey,
        nodeIdByStableKey,
        archivedNodeKeys,
        planOriginVersionBySourceKey,
      };
      for (const objectType of ["group", "subject", "node", "card", "resource", "plan"] as const) {
        const depths = objectType === "node" ? [1, 2, 3, 4, 5, 6] : [undefined];
        for (const nodeDepth of depths) {
          const created = await bulkApplyLearningTreeAdds(objectType, bulkContext, { nodeDepth });
          for (const [stableKey, entityId] of created) bulkAppliedIds.set(stableKey, entityId);
          const mutated = await bulkApplyLearningTreeMutations(objectType, bulkContext, { nodeDepth });
          for (const [stableKey, entityId] of mutated.entityIds) bulkAppliedIds.set(stableKey, entityId);
          bulkMutationStats.objectCount += mutated.objectCount;
          bulkMutationStats.writeBatchCount += mutated.writeBatchCount;
          for (const diffType of ["UPDATE", "MOVE", "ARCHIVE", "CONFLICT"] as const) {
            bulkMutationStats.diffTypeCounts[diffType] += mutated.diffTypeCounts[diffType];
          }
        }
        if (objectType === "node" && hasAppliedNodeArchive(selectionMap, objectByKey)) {
          await assertNoActiveNodeHasArchivedAncestor(tx, workspace.id);
        }
      }

      for (const item of ordered) {
        const selection = selectionMap.get(item.stableKey)!;
        const choice = selection.choice;
        const object = objectByKey.get(item.stableKey);
        if (!object) throw new ApiError("LEARNING_TREE_CONFIRM_OBJECT_MISSING", 400);
        const stableRef = object.type === "plan" ? object.batchRef : item.stableKey;
        if (choice === "skip" || item.diffType === "UNCHANGED" || item.diffType === "SKIP") {
          skippedKeys.push(item.stableKey);
          itemRows.push({
            stableRef,
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

        const mappedId = bulkAppliedIds.get(item.stableKey);
        if (!mappedId) {
          throw learningTreeConfirmConflict(
            "LEARNING_TREE_BULK_RESULT_MISSING",
            {
              state: "BLOCKED",
              workspaceId: workspace.id,
              rootRevision: lockedRows[0]?.revision ?? null,
              stableKey: item.stableKey,
            },
            ["applyResult"],
          );
        }

        appliedKeys.push(item.stableKey);
        itemRows.push({
          stableRef,
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

      const revisionChanged = await tx.examWorkspace.updateMany({
        where: { id: workspace.id, userId: actorId, status: "ACTIVE", revision: claims.rootRevision },
        data: { revision: { increment: 1 } },
      });
      if (revisionChanged.count !== 1) {
        throw learningTreeConfirmConflict(
          "LEARNING_TREE_ROOT_REVISION_CONFLICT",
          {
            state: "ACTIVE",
            workspaceId: workspace.id,
            rootRevision: lockedRows[0]?.revision ?? null,
          },
          ["rootRevision"],
        );
      }

      if (itemRows.length) {
        await tx.learningTreeImportItem.createMany({
          data: itemRows.map((row) => ({ batchId: batch.id, ...row })),
        });
      }
      await tx.learningTreeImportBatch.update({
        where: { id: batch.id },
        data: {
          statsJson: {
            appliedCount: appliedKeys.length,
            skippedCount: skippedKeys.length,
            objectCount: parsed.objects.length,
            bulkMutation: bulkMutationStats,
          },
          resultJson: { appliedKeys, skippedKeys },
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
            bulkMutation: bulkMutationStats,
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
    }, {
      maxWait: 5_000,
      timeout: 60_000,
      isolationLevel: "Serializable",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status !== 409) throw error;
      const latestWorkspace = await prisma.examWorkspace.findFirst({
        where: { id: workspace.id, userId: actorId },
        select: { id: true, status: true, revision: true },
      });
      throw completeLearningTreeConfirmConflict(error, {
        state: latestWorkspace?.status ?? "UNAVAILABLE",
        workspaceId: latestWorkspace?.id ?? null,
        rootRevision: latestWorkspace?.revision ?? null,
      });
    }
    const retryable = isRetryableTransactionError(error);
    if (isUnique(error) || retryable) {
      const raced = await prisma.learningTreeImportBatch.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: workspace.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (raced) return reuseLearningTreeImport(raced, requestFingerprint);
    }
    if (retryable) {
      throw learningTreeConfirmConflict(
        "LEARNING_TREE_CONFIRM_RETRYABLE",
        {
          state: "RETRY_REQUIRED",
          workspaceId: workspace.id,
          rootRevision: workspace.revision,
        },
        ["transaction"],
      );
    }
    throw error;
  }
}

function assertValidConfirmSelections(
  selections: LearningTreeConfirmSelection[],
  diffItems: LearningTreeDiffItem[],
): void {
  if (selections.length !== diffItems.length) {
    throw new ApiError("LEARNING_TREE_CONFIRM_SELECTION_INVALID", 400);
  }
  const diffByKey = new Map(diffItems.map((item) => [item.stableKey, item]));
  const seen = new Set<string>();
  const targetOwners = new Map<string, string>();

  for (const selection of selections) {
    const item = diffByKey.get(selection.stableKey);
    if (!item || seen.has(selection.stableKey)) {
      throw new ApiError("LEARNING_TREE_CONFIRM_SELECTION_INVALID", 400);
    }
    seen.add(selection.stableKey);

    if (
      (item.diffType === "UNCHANGED" || item.diffType === "SKIP") &&
      (selection.choice !== "skip" || selection.mappedTargetId)
    ) {
      throw new ApiError("LEARNING_TREE_CONFIRM_SELECTION_INVALID", 400);
    }

    if (
      selection.mappedTargetId &&
      !item.candidateMatches.some((candidate) => candidate.entityId === selection.mappedTargetId)
    ) {
      throw new ApiError("LEARNING_TREE_CONFIRM_MAPPING_NOT_ALLOWED", 403);
    }

    const targetId = selection.choice === "apply"
      ? selection.mappedTargetId ?? item.candidateMatches[0]?.entityId
      : undefined;
    if (targetId) {
      const targetKey = `${item.objectType}:${targetId}`;
      const owner = targetOwners.get(targetKey);
      if (owner && owner !== selection.stableKey) {
        throw new ApiError("LEARNING_TREE_CONFIRM_TARGET_REUSED", 409, {
          conflictFields: ["mappedTargetId"],
        });
      }
      targetOwners.set(targetKey, selection.stableKey);
    }
  }
  if (seen.size !== diffItems.length) {
    throw new ApiError("LEARNING_TREE_CONFIRM_SELECTION_INVALID", 400);
  }
}

function hasAppliedNodeArchive(
  selections: Map<string, LearningTreeConfirmSelection>,
  objects: Map<string, LearningTreeObject>,
): boolean {
  for (const [stableKey, selection] of selections) {
    const object = objects.get(stableKey);
    if (selection.choice === "apply" && object?.type === "node" && object.archived) return true;
  }
  return false;
}

async function assertNoActiveNodeHasArchivedAncestor(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const nodes = await tx.syllabusNode.findMany({
    where: { subject: { workspaceId } },
    select: { id: true, parentId: true, archivedAt: true },
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.archivedAt) continue;
    const visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new ApiError("LEARNING_TREE_NODE_CYCLE", 409);
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.archivedAt) {
        throw new ApiError("LEARNING_TREE_ARCHIVE_DESCENDANT_ACTIVE", 409, {
          conflictFields: ["archivedNodes"],
        });
      }
      parentId = parent.parentId;
    }
  }
}

function hasUnresolvedBlockingDiff(
  selections: LearningTreeConfirmSelection[],
  diffItems: LearningTreeDiffItem[],
): boolean {
  const selectionsByKey = new Map(selections.map((selection) => [selection.stableKey, selection]));
  return diffItems.some((item) => {
    if (!item.blocking) return false;
    const selection = selectionsByKey.get(item.stableKey);
    if (selection?.choice === "skip") return false;
    return !(
      item.diffType === "CONFLICT" &&
      selection?.choice === "apply" &&
      selection.mappedTargetId &&
      item.candidateMatches.some((candidate) => candidate.entityId === selection.mappedTargetId)
    );
  });
}

function learningTreeConflict(
  code: string,
  latest: unknown,
  conflictFields: string[],
): ApiError {
  return new ApiError(code, 409, {
    latest,
    conflictFields,
    workbench: LEARNING_TREE_IMPORTS_WORKBENCH,
  });
}

function learningTreeConfirmConflict(code: string, latest: unknown, conflictFields: string[]): ApiError {
  return learningTreeConflict(code, latest, conflictFields);
}

function completeLearningTreeConfirmConflict(error: ApiError, latestFallback: unknown): ApiError {
  return learningTreeConfirmConflict(
    error.code,
    error.details?.latest ?? latestFallback,
    error.details?.conflictFields?.length
      ? error.details.conflictFields
      : learningTreeConflictFields(error.code),
  );
}

function learningTreeConflictFields(code: string): string[] {
  if (code.includes("IDEMPOTENCY")) return ["idempotencyKey", "requestFingerprint"];
  if (code.includes("ROOT_REVISION")) return ["rootRevision"];
  if (code.includes("PREVIEW_NONCE") || code.includes("PREVIEW_EXPIRED")) return ["previewToken"];
  if (code.includes("DIFF_SNAPSHOT")) return ["diffSnapshotHash"];
  if (code.includes("MILESTONE")) return ["milestoneKeys"];
  if (code.includes("MAPPING") || code.includes("TARGET_REUSED")) return ["mappedTargetId"];
  if (code.includes("PARENT") || code.includes("ARCHIVE") || code.includes("CYCLE")) return ["treeState"];
  if (code.includes("BULK")) return ["applyResult"];
  if (code.includes("RETRYABLE")) return ["transaction"];
  return ["selections"];
}

function reuseLearningTreeImport(
  row: {
    id: string;
    workspaceId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    statsJson: Prisma.JsonValue;
    confirmedAt: Date;
  },
  requestFingerprint: string,
): LearningTreeConfirmResultDto {
  if (row.requestFingerprint !== requestFingerprint) {
    throw learningTreeConfirmConflict(
      "LEARNING_TREE_IDEMPOTENCY_CONFLICT",
      { state: "CONFIRMED", workspaceId: row.workspaceId, batchId: row.id },
      ["idempotencyKey", "requestFingerprint"],
    );
  }
  const stats = asRecord(row.statsJson);
  return {
    batchId: row.id,
    workspaceId: row.workspaceId,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    reused: true,
    appliedCount: numberValue(stats.appliedCount) ?? 0,
    skippedCount: numberValue(stats.skippedCount) ?? 0,
    confirmedAt: row.confirmedAt.toISOString(),
  };
}

function compareLearningTreeApplyOrder(
  left: LearningTreeDiffItem,
  right: LearningTreeDiffItem,
  objectByKey: Map<string, LearningTreeObject>,
): number {
  const leftObject = objectByKey.get(left.stableKey);
  const rightObject = objectByKey.get(right.stableKey);
  const phase = (object: LearningTreeObject | undefined): number => {
    if (!object) return 999;
    if (object.type === "group") return 0;
    if (object.type === "subject") return 10;
    if (object.type === "node") return 20 + object.depth;
    if (object.type === "card") return 100;
    if (object.type === "resource") return 110;
    return 120;
  };
  return phase(leftObject) - phase(rightObject) ||
    (left.sourceLine ?? 0) - (right.sourceLine ?? 0) ||
    left.stableKey.localeCompare(right.stableKey);
}

function nodeLookupKey(subjectKey: string, stableKey: string): string {
  return `${subjectKey}\u0000${stableKey}`;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "P2034" ||
    code === "P2028" ||
    /(?:40001|40P01|deadlock|transaction.+(?:timeout|closed))/i.test(message);
}

async function findMissingPlanMilestoneKeys(
  workspaceId: string,
  objects: LearningTreeObject[],
  client: Pick<Prisma.TransactionClient, "planMilestone"> = prisma,
): Promise<string[]> {
  const keys = Array.from(new Set(objects.flatMap((object) =>
    object.type === "plan" && object.milestoneKey ? [object.milestoneKey] : [],
  )));
  if (!keys.length) return [];
  const existing = await client.planMilestone.findMany({
    where: { workspaceId, stableKey: { in: keys }, archivedAt: null },
    select: { stableKey: true },
  });
  const existingKeys = new Set(existing.map((milestone) => milestone.stableKey));
  return keys.filter((key) => !existingKeys.has(key));
}

function markMissingPlanMilestones(
  items: LearningTreeDiffItem[],
  objects: LearningTreeObject[],
  missingKeys: string[],
): void {
  if (!missingKeys.length) return;
  const missing = new Set(missingKeys);
  const objectByKey = new Map(objects.map((object) => [object.stableKey, object]));
  for (const item of items) {
    const object = objectByKey.get(item.stableKey);
    if (object?.type === "plan" && object.milestoneKey && missing.has(object.milestoneKey)) {
      item.blocking = true;
      item.reason = `milestone_missing:${object.milestoneKey}`;
    }
  }
}

export async function listLearningTreeImports(
  actorId: string,
  options?: { includeArchived?: boolean },
): Promise<LearningTreeImportBatchSummaryDto[]> {
  const rows = await prisma.learningTreeImportBatch.findMany({
    where: {
      workspace: { userId: actorId },
      archivedAt: options?.includeArchived ? undefined : null,
    },
    orderBy: [{ confirmedAt: "desc" }],
    include: {
      workspace: { select: { status: true, revision: true } },
      _count: { select: { items: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceStatus: row.workspace.status,
    workspaceRevision: row.workspace.revision,
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
  const row = await prisma.learningTreeImportBatch.findFirst({
    where: { id: batchId, workspace: { userId: actorId } },
    include: {
      workspace: { select: { status: true, revision: true } },
      items: { orderBy: [{ createdAt: "asc" }] },
    },
  });
  if (!row) throw new ApiError("LEARNING_TREE_IMPORT_NOT_FOUND", 404);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceStatus: row.workspace.status,
    workspaceRevision: row.workspace.revision,
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
    canonicalMarkdown: row.canonicalMarkdown,
    result: row.resultJson,
    items: row.items.map((item) => ({
      id: item.id,
      stableRef: item.stableRef,
      objectType: item.objectType,
      diffType: item.diffType,
      sourceLine: item.sourceLine,
      userChoice: item.userChoice,
      applyResult: item.applyResult,
      mappedTargetId: item.mappedTargetId,
      mappedTargetKey: item.mappedTargetKey,
      redactedErrorCode: item.redactedErrorCode,
    })),
  };
}

export async function setLearningTreeImportArchived(
  actorId: string,
  batchId: string,
  archived: boolean,
): Promise<LearningTreeImportBatchSummaryDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const row = await tx.learningTreeImportBatch.findFirst({
      where: { id: batchId, workspaceId: workspace.id },
      include: {
        workspace: { select: { status: true, revision: true } },
        _count: { select: { items: true } },
      },
    });
    if (!row) throw new ApiError("LEARNING_TREE_IMPORT_NOT_FOUND", 404);
    const alreadyInState = archived ? Boolean(row.archivedAt) : !row.archivedAt;
    if (alreadyInState) return serializeLearningTreeImportSummary(row);

    const updated = await tx.learningTreeImportBatch.update({
      where: { id: row.id },
      data: { archivedAt: archived ? new Date() : null },
      include: {
        workspace: { select: { status: true, revision: true } },
        _count: { select: { items: true } },
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: archived ? "LEARNING_TREE_IMPORT_ARCHIVED" : "LEARNING_TREE_IMPORT_RESTORED",
        entityType: "LearningTreeImportBatch",
        entityId: row.id,
      },
    });
    return serializeLearningTreeImportSummary(updated);
  });
}

export async function exportLearningTreeImportCanonical(
  actorId: string,
  batchId: string,
): Promise<{ markdown: string; filename: string; workspaceId: string }> {
  const row = await prisma.learningTreeImportBatch.findFirst({
    where: { id: batchId, workspace: { userId: actorId } },
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

function serializeLearningTreeImportSummary(row: {
  id: string;
  workspaceId: string;
  workspace: { status: "ACTIVE" | "ARCHIVED"; revision: number };
  scope: string;
  protocolVersion: string;
  parserVersion: string;
  sourceSha256: string;
  canonicalPlanHash: string;
  rootRevision: number;
  idempotencyKey: string;
  statsJson: unknown;
  archivedAt: Date | null;
  confirmedAt: Date;
  _count: { items: number };
}): LearningTreeImportBatchSummaryDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceStatus: row.workspace.status,
    workspaceRevision: row.workspace.revision,
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
  };
}
