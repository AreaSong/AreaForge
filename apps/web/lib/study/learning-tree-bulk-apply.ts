import {
  type LearningTreeDiffItem,
  type LearningTreeObject,
  type LearningTreeObjectType,
} from "@areaforge/core";
import { sha256Hex } from "@areaforge/auth";
import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";

const WRITE_CHUNK_SIZE = 500;

type Selection = { choice: "apply" | "skip"; mappedTargetId?: string };

export interface LearningTreeBulkApplyContext {
  tx: Prisma.TransactionClient;
  actorId: string;
  workspaceId: string;
  importBatchId: string;
  diffItems: LearningTreeDiffItem[];
  objectByKey: Map<string, LearningTreeObject>;
  selectionByKey: Map<string, Selection>;
  subjectByKey: Map<string, string>;
  nodeIdByStableKey: Map<string, string>;
  archivedNodeKeys: Set<string>;
  planOriginVersionBySourceKey: Map<string, number>;
}

export async function bulkApplyLearningTreeAdds(
  objectType: LearningTreeObjectType,
  context: LearningTreeBulkApplyContext,
  options?: { nodeDepth?: number },
): Promise<Map<string, string>> {
  const objects = selectedAdds(objectType, context, options?.nodeDepth);
  if (!objects.length) return new Map();
  switch (objectType) {
    case "group":
      return bulkGroups(objects, context);
    case "subject":
      return bulkSubjects(objects, context);
    case "node":
      return bulkNodes(objects, context);
    case "card":
      return bulkCards(objects, context);
    case "resource":
      return bulkResources(objects, context);
    case "plan":
      return bulkPlans(objects, context);
  }
}

function selectedAdds(
  objectType: LearningTreeObjectType,
  context: LearningTreeBulkApplyContext,
  nodeDepth?: number,
): LearningTreeObject[] {
  return context.diffItems.flatMap((item) => {
    const object = context.objectByKey.get(item.stableKey);
    const selection = context.selectionByKey.get(item.stableKey);
    return item.objectType === objectType &&
      item.diffType === "ADD" &&
      object?.type === objectType &&
      (object.type !== "node" || nodeDepth === undefined || object.depth === nodeDepth) &&
      selection?.choice === "apply"
      ? [object]
      : [];
  });
}

async function bulkGroups(
  objects: LearningTreeObject[],
  { tx, workspaceId }: LearningTreeBulkApplyContext,
): Promise<Map<string, string>> {
  const groups = objects.filter((object) => object.type === "group");
  const result = new Map<string, string>();
  for (const chunk of chunks(groups)) {
    const created = await tx.subjectGroup.createManyAndReturn({
      data: chunk.map((group) => ({ workspaceId, stableKey: group.stableKey, name: group.title })),
      select: { id: true, stableKey: true },
    });
    for (const row of created) result.set(row.stableKey, row.id);
  }
  return result;
}

async function bulkSubjects(
  objects: LearningTreeObject[],
  context: LearningTreeBulkApplyContext,
): Promise<Map<string, string>> {
  const subjects = objects.filter((object) => object.type === "subject");
  const groupKeys = Array.from(new Set(subjects.flatMap((subject) => subject.groupKey ? [subject.groupKey] : [])));
  const groups = groupKeys.length
    ? await context.tx.subjectGroup.findMany({
        where: { workspaceId: context.workspaceId, stableKey: { in: groupKeys }, archivedAt: null },
        select: { id: true, stableKey: true },
      })
    : [];
  const groupByKey = new Map(groups.map((group) => [group.stableKey, group.id]));
  const result = new Map<string, string>();
  for (const chunk of chunks(subjects)) {
    const created = await context.tx.subject.createManyAndReturn({
      data: chunk.map((subject) => ({
        workspaceId: context.workspaceId,
        stableKey: subject.stableKey,
        name: subject.title,
        color: "#4B5563",
        groupId: subject.groupKey ? groupByKey.get(subject.groupKey) ?? null : null,
      })),
      select: { id: true, stableKey: true },
    });
    for (const row of created) {
      result.set(row.stableKey, row.id);
      context.subjectByKey.set(row.stableKey, row.id);
    }
  }
  return result;
}

async function bulkNodes(
  objects: LearningTreeObject[],
  context: LearningTreeBulkApplyContext,
): Promise<Map<string, string>> {
  const nodes = objects.filter((object) => object.type === "node");
  const result = new Map<string, string>();
  const subjectKeyById = new Map(
    Array.from(context.subjectByKey, ([stableKey, id]) => [id, stableKey] as const),
  );
  for (let depth = 1; depth <= 6; depth += 1) {
    const atDepth = nodes.filter((node) => node.depth === depth);
    for (const chunk of chunks(atDepth)) {
      const data = chunk.map((node) => {
        const subjectId = context.subjectByKey.get(node.subjectKey);
        if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
        const parentId = node.parentStableKey
          ? context.nodeIdByStableKey.get(nodeLookupKey(node.subjectKey, node.parentStableKey)) ?? null
          : null;
        if (node.parentStableKey && !parentId) {
          throw new ApiError("LEARNING_TREE_PARENT_MISSING", 409);
        }
        return {
          subjectId,
          parentId,
          title: node.title,
          kind: kindForDepth(node.depth),
          stableKey: node.stableKey,
          sortOrder: node.sortOrder ?? 0,
          status: syllabusStatus(node.status ?? "NOT_STARTED"),
          archivedAt: node.archived ? new Date() : null,
        };
      });
      const created = await context.tx.syllabusNode.createManyAndReturn({
        data,
        select: { id: true, stableKey: true, subjectId: true, archivedAt: true },
      });
      for (const row of created) {
        if (!row.stableKey) continue;
        const subjectKey = subjectKeyById.get(row.subjectId);
        if (!subjectKey) throw new ApiError("LEARNING_TREE_BULK_RESULT_MISSING", 409);
        const lookupKey = nodeLookupKey(subjectKey, row.stableKey);
        context.nodeIdByStableKey.set(lookupKey, row.id);
        if (row.archivedAt) context.archivedNodeKeys.add(lookupKey);
        result.set(row.stableKey, row.id);
      }
    }
  }
  return result;
}

async function bulkCards(
  objects: LearningTreeObject[],
  context: LearningTreeBulkApplyContext,
): Promise<Map<string, string>> {
  const cards = objects.filter((object) => object.type === "card");
  const result = new Map<string, string>();
  for (const chunk of chunks(cards)) {
    const data = chunk.map((card) => {
      const subjectId = context.subjectByKey.get(card.subjectKey);
      if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
      const primaryNodeId = resolveCardNode(card.subjectKey, card.primaryNode, context);
      return {
        subjectId,
        title: card.title,
        content: card.bodyMarkdown,
        kind: card.kind,
        stableKey: card.stableKey,
        syllabusNodeId: primaryNodeId,
      };
    });
    const created = await context.tx.note.createManyAndReturn({
      data,
      select: { id: true, stableKey: true, subjectId: true },
    });
    const createdByIdentity = new Map(created.map((row) => [`${row.subjectId}\u0000${row.stableKey ?? ""}`, row]));
    const relationRows: Array<{ noteId: string; syllabusNodeId: string }> = [];
    for (const card of chunk) {
      const subjectId = context.subjectByKey.get(card.subjectKey)!;
      const createdCard = createdByIdentity.get(`${subjectId}\u0000${card.stableKey}`);
      if (!createdCard) throw new ApiError("LEARNING_TREE_BULK_RESULT_MISSING", 409);
      result.set(card.stableKey, createdCard.id);
      for (const stableKey of card.relatedNodes) {
        relationRows.push({
          noteId: createdCard.id,
          syllabusNodeId: resolveCardNode(card.subjectKey, stableKey, context)!,
        });
      }
    }
    for (const relationChunk of chunks(relationRows)) {
      if (relationChunk.length) await context.tx.noteRelatedSyllabusNode.createMany({ data: relationChunk });
    }
  }
  return result;
}

async function bulkResources(
  objects: LearningTreeObject[],
  context: LearningTreeBulkApplyContext,
): Promise<Map<string, string>> {
  const resources = objects.filter((object) => object.type === "resource");
  const result = new Map<string, string>();
  for (const chunk of chunks(resources)) {
    const created = await context.tx.studyResource.createManyAndReturn({
      data: chunk.map((resource) => {
        const subjectId = context.subjectByKey.get(resource.subjectKey);
        if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
        return {
          workspaceId: context.workspaceId,
          stableKey: resource.stableKey,
          title: resource.title,
          sourceType: "LINK" as const,
          externalUrl: resource.url,
          displayHost: resource.displayHost,
          subjectId,
          actorId: context.actorId,
        };
      }),
      select: { id: true, stableKey: true },
    });
    for (const row of created) result.set(row.stableKey, row.id);
  }
  return result;
}

async function bulkPlans(
  objects: LearningTreeObject[],
  context: LearningTreeBulkApplyContext,
): Promise<Map<string, string>> {
  const plans = objects.filter((object) => object.type === "plan");
  const milestoneKeys = Array.from(new Set(plans.flatMap((plan) => plan.milestoneKey ? [plan.milestoneKey] : [])));
  const milestones = milestoneKeys.length
    ? await context.tx.planMilestone.findMany({
        where: { workspaceId: context.workspaceId, stableKey: { in: milestoneKeys }, archivedAt: null },
        select: { id: true, stableKey: true },
      })
    : [];
  const milestoneByKey = new Map(milestones.map((milestone) => [milestone.stableKey, milestone.id]));
  const result = new Map<string, string>();
  for (const chunk of chunks(plans)) {
    const created = await context.tx.planInboxItem.createManyAndReturn({
      data: chunk.map((plan) => {
        const subjectId = context.subjectByKey.get(plan.subjectKey);
        if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
        return {
          workspaceId: context.workspaceId,
          stableKey: plan.batchRef,
          originKey: learningTreePlanOriginKey(plan.subjectKey, plan.stableKey),
          originVersion: plan.originVersion,
          originType: "learning_tree_plan",
          originSnapshot: {
            title: plan.title,
            subjectKey: plan.subjectKey,
            milestoneKey: plan.milestoneKey ?? null,
            durationMinutes: plan.durationMinutes ?? null,
            dependsOn: plan.dependsOn ?? null,
            dependencyType: plan.dependencyType ?? "SOFT",
            batchRef: plan.batchRef,
            sourceStableKey: plan.stableKey,
          },
          title: plan.title,
          subjectId,
          estimatedMinutes: plan.durationMinutes ?? null,
          planMilestoneId: plan.milestoneKey ? milestoneByKey.get(plan.milestoneKey) ?? null : null,
          actorId: context.actorId,
        };
      }),
      select: { id: true, stableKey: true },
    });
    const createdByBatchRef = new Map(created.map((row) => [row.stableKey, row.id]));
    const dependencyRows: Array<{
      inboxItemId: string;
      targetType: "INBOX_STABLE_REF";
      dependencyType: "SOFT" | "HARD";
      importBatchId: string;
      planStableKey: string;
      planOriginVersion: number | null;
    }> = [];
    const auditRows: Prisma.AuditEventCreateManyInput[] = [];
    for (const plan of chunk) {
      const itemId = createdByBatchRef.get(plan.batchRef);
      if (!itemId) throw new ApiError("LEARNING_TREE_BULK_RESULT_MISSING", 409);
      result.set(plan.stableKey, itemId);
      auditRows.push({
        actorId: context.actorId,
        action: "PLAN_INBOX_CREATED",
        entityType: "PlanInboxItem",
        entityId: itemId,
        metadata: {
          originKey: learningTreePlanOriginKey(plan.subjectKey, plan.stableKey),
          originVersion: plan.originVersion,
          supersededCount: 0,
        },
      });
      if (plan.dependsOn?.startsWith("plan:")) {
        const targetKey = plan.dependsOn.slice("plan:".length);
        dependencyRows.push({
          inboxItemId: itemId,
          targetType: "INBOX_STABLE_REF",
          dependencyType: plan.dependencyType === "HARD" ? "HARD" : "SOFT",
          importBatchId: context.importBatchId,
          planStableKey: targetKey,
          planOriginVersion: context.planOriginVersionBySourceKey.get(targetKey) ?? null,
        });
      }
    }
    if (dependencyRows.length) await context.tx.planInboxDependencyRef.createMany({ data: dependencyRows });
    if (auditRows.length) await context.tx.auditEvent.createMany({ data: auditRows });
  }
  return result;
}

function resolveCardNode(
  subjectKey: string,
  stableKey: string | undefined,
  context: LearningTreeBulkApplyContext,
): string | null {
  if (!stableKey) return null;
  const lookupKey = nodeLookupKey(subjectKey, stableKey);
  const nodeId = context.nodeIdByStableKey.get(lookupKey);
  if (!nodeId || context.archivedNodeKeys.has(lookupKey)) {
    throw new ApiError("LEARNING_TREE_CARD_NODE_MISSING", 409);
  }
  return nodeId;
}

function learningTreePlanOriginKey(subjectKey: string, stableKey: string): string {
  return sha256Hex(["learning-tree-plan-origin:v1", subjectKey, stableKey].join("|"));
}

function nodeLookupKey(subjectKey: string, stableKey: string): string {
  return `${subjectKey}\u0000${stableKey}`;
}

function kindForDepth(depth: number): "CHAPTER" | "TOPIC" | "PROBLEM_TYPE" {
  if (depth <= 1) return "CHAPTER";
  if (depth === 2) return "TOPIC";
  return "PROBLEM_TYPE";
}

function syllabusStatus(value: string):
  | "NOT_STARTED"
  | "LEARNING"
  | "COVERED"
  | "NEEDS_REVIEW"
  | "MASTERED"
  | "WEAK"
  | "DEFERRED" {
  switch (value) {
    case "NOT_STARTED":
    case "LEARNING":
    case "COVERED":
    case "NEEDS_REVIEW":
    case "MASTERED":
    case "WEAK":
    case "DEFERRED":
      return value;
    default:
      throw new ApiError("LEARNING_TREE_NODE_STATUS_INVALID", 400);
  }
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += WRITE_CHUNK_SIZE) {
    result.push(values.slice(index, index + WRITE_CHUNK_SIZE));
  }
  return result;
}
