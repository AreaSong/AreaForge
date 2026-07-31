import {
  type LearningTreeDiffItem,
  type LearningTreeObject,
  type LearningTreeObjectType,
} from "@areaforge/core";
import { sha256Hex } from "@areaforge/auth";
import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { LearningTreeBulkApplyContext } from "./learning-tree-bulk-apply";

const WRITE_CHUNK_SIZE = 500;
type MutationDiffType = "UPDATE" | "MOVE" | "ARCHIVE" | "CONFLICT";

interface MutationTarget {
  object: LearningTreeObject;
  item: LearningTreeDiffItem;
  targetId: string;
}

export interface LearningTreeBulkMutationResult {
  entityIds: Map<string, string>;
  objectCount: number;
  writeBatchCount: number;
  diffTypeCounts: Record<MutationDiffType, number>;
}

export async function bulkApplyLearningTreeMutations(
  objectType: LearningTreeObjectType,
  context: LearningTreeBulkApplyContext,
  options?: { nodeDepth?: number },
): Promise<LearningTreeBulkMutationResult> {
  const targets = selectedMutations(objectType, context, options?.nodeDepth);
  if (!targets.length) return emptyResult();
  const applied = await applyByType(objectType, targets, context);
  const diffTypeCounts = emptyDiffTypeCounts();
  for (const target of targets) diffTypeCounts[target.item.diffType as MutationDiffType] += 1;
  return {
    ...applied,
    objectCount: targets.length,
    diffTypeCounts,
  };
}

function selectedMutations(
  objectType: LearningTreeObjectType,
  context: LearningTreeBulkApplyContext,
  nodeDepth?: number,
): MutationTarget[] {
  return context.diffItems.flatMap((item) => {
    const object = context.objectByKey.get(item.stableKey);
    const selection = context.selectionByKey.get(item.stableKey);
    const targetId = selection?.mappedTargetId ?? item.candidateMatches[0]?.entityId;
    const mutating = item.diffType === "UPDATE" || item.diffType === "MOVE" ||
      item.diffType === "ARCHIVE" || item.diffType === "CONFLICT";
    return item.objectType === objectType && object?.type === objectType &&
      (object.type !== "node" || nodeDepth === undefined || object.depth === nodeDepth) &&
      selection?.choice === "apply" && mutating && targetId
      ? [{ object, item, targetId }]
      : [];
  });
}

async function applyByType(
  objectType: LearningTreeObjectType,
  targets: MutationTarget[],
  context: LearningTreeBulkApplyContext,
): Promise<Pick<LearningTreeBulkMutationResult, "entityIds" | "writeBatchCount">> {
  switch (objectType) {
    case "group": return bulkGroups(targets, context);
    case "subject": return bulkSubjects(targets, context);
    case "node": return bulkNodes(targets, context);
    case "card": return bulkCards(targets, context);
    case "resource": return bulkResources(targets, context);
    case "plan": return bulkPlans(targets, context);
  }
}

async function bulkGroups(
  targets: MutationTarget[],
  context: LearningTreeBulkApplyContext,
) {
  const result = new Map<string, string>();
  let writeBatchCount = 0;
  for (const chunk of chunks(targets)) {
    const args: unknown[] = [context.workspaceId];
    const values = chunk.map(({ object, targetId }) =>
      `(${parameter(args, targetId, "text")},${parameter(args, object.title, "text")})`
    ).join(",");
    await executeExpected(context.tx, `
      UPDATE "SubjectGroup" AS target
      SET name = data.name, "updatedAt" = NOW()
      FROM (VALUES ${values}) AS data(id, name)
      WHERE target.id = data.id AND target."workspaceId" = $1::text
    `, args, chunk.length);
    writeBatchCount += 1;
    for (const target of chunk) result.set(target.item.stableKey, target.targetId);
  }
  return { entityIds: result, writeBatchCount };
}

async function bulkSubjects(
  targets: MutationTarget[],
  context: LearningTreeBulkApplyContext,
) {
  const subjects = targets.map((target) => target.object).filter((object) => object.type === "subject");
  const groupKeys = [...new Set(subjects.flatMap((subject) => subject.groupKey ? [subject.groupKey] : []))];
  const groups = groupKeys.length ? await context.tx.subjectGroup.findMany({
    where: { workspaceId: context.workspaceId, stableKey: { in: groupKeys }, archivedAt: null },
    select: { id: true, stableKey: true },
  }) : [];
  const groupByKey = new Map(groups.map((group) => [group.stableKey, group.id]));
  const result = new Map<string, string>();
  let writeBatchCount = 0;
  for (const chunk of chunks(targets)) {
    const args: unknown[] = [context.workspaceId];
    const values = chunk.map(({ object, targetId }) => {
      if (object.type !== "subject") throw new ApiError("LEARNING_TREE_BULK_TYPE_MISMATCH", 409);
      return `(${parameter(args, targetId, "text")},${parameter(args, object.title, "text")},${parameter(args, object.groupKey ? groupByKey.get(object.groupKey) ?? null : null, "text")})`;
    }).join(",");
    await executeExpected(context.tx, `
      UPDATE "Subject" AS target
      SET name = data.name, "groupId" = data.group_id, "updatedAt" = NOW()
      FROM (VALUES ${values}) AS data(id, name, group_id)
      WHERE target.id = data.id AND target."workspaceId" = $1::text
    `, args, chunk.length);
    writeBatchCount += 1;
    for (const target of chunk) {
      result.set(target.item.stableKey, target.targetId);
      context.subjectByKey.set(target.item.stableKey, target.targetId);
    }
  }
  return { entityIds: result, writeBatchCount };
}

async function bulkNodes(
  targets: MutationTarget[],
  context: LearningTreeBulkApplyContext,
) {
  const result = new Map<string, string>();
  let writeBatchCount = 0;
  for (const chunk of chunks(targets)) {
    const args: unknown[] = [context.workspaceId];
    const values = chunk.map(({ object, targetId }) => {
      if (object.type !== "node") throw new ApiError("LEARNING_TREE_BULK_TYPE_MISMATCH", 409);
      const subjectId = context.subjectByKey.get(object.subjectKey);
      if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
      const parentId = object.parentStableKey
        ? context.nodeIdByStableKey.get(nodeLookupKey(object.subjectKey, object.parentStableKey)) ?? null
        : null;
      if (object.parentStableKey && !parentId) throw new ApiError("LEARNING_TREE_PARENT_MISSING", 409);
      return [
        parameter(args, targetId, "text"),
        parameter(args, subjectId, "text"),
        parameter(args, parentId, "text"),
        parameter(args, object.title, "text"),
        parameter(args, object.stableKey, "text"),
        parameter(args, object.sortOrder !== undefined, "boolean"),
        parameter(args, object.sortOrder ?? null, "integer"),
        parameter(args, object.status !== undefined, "boolean"),
        parameter(args, object.status ?? null, "text"),
        parameter(args, object.archived, "boolean"),
      ].join(",");
    }).map((row) => `(${row})`).join(",");
    await executeExpected(context.tx, `
      UPDATE "SyllabusNode" AS target
      SET title = data.title,
          "parentId" = data.parent_id,
          "stableKey" = data.stable_key,
          "sortOrder" = CASE WHEN data.has_sort THEN data.sort_order ELSE target."sortOrder" END,
          status = CASE WHEN data.has_status THEN data.status::"SyllabusNodeStatus" ELSE target.status END,
          "archivedAt" = CASE WHEN data.archived THEN NOW() ELSE NULL END,
          revision = target.revision + 1,
          "updatedAt" = NOW()
      FROM (VALUES ${values}) AS data(id, subject_id, parent_id, title, stable_key, has_sort, sort_order, has_status, status, archived)
      WHERE target.id = data.id AND target."subjectId" = data.subject_id
        AND EXISTS (SELECT 1 FROM "Subject" subject WHERE subject.id = target."subjectId" AND subject."workspaceId" = $1::text)
    `, args, chunk.length);
    const archivedNodeIds = chunk
      .filter((target) => target.object.type === "node" && target.object.archived)
      .map((target) => target.targetId);
    if (archivedNodeIds.length) {
      await context.tx.reviewSchedule.updateMany({
        where: { syllabusNodeId: { in: archivedNodeIds }, status: "ACTIVE" },
        data: {
          status: "PAUSED",
          dueDate: null,
          pausedReason: "TARGET_ARCHIVED",
          revision: { increment: 1 },
        },
      });
    }
    writeBatchCount += 1;
    for (const target of chunk) {
      if (target.object.type !== "node") continue;
      const key = nodeLookupKey(target.object.subjectKey, target.object.stableKey);
      if (target.object.archived) {
        // Archived descendants still need their parent id later in this transaction.
        context.nodeIdByStableKey.set(key, target.targetId);
        context.archivedNodeKeys.add(key);
      } else {
        context.nodeIdByStableKey.set(key, target.targetId);
        context.archivedNodeKeys.delete(key);
      }
      result.set(target.item.stableKey, target.targetId);
    }
  }
  return { entityIds: result, writeBatchCount };
}

async function bulkCards(
  targets: MutationTarget[],
  context: LearningTreeBulkApplyContext,
) {
  const result = new Map<string, string>();
  let writeBatchCount = 0;
  for (const chunk of chunks(targets)) {
    const relations: Array<{ noteId: string; syllabusNodeId: string }> = [];
    const args: unknown[] = [context.workspaceId];
    const values = chunk.map(({ object, targetId }) => {
      if (object.type !== "card") throw new ApiError("LEARNING_TREE_BULK_TYPE_MISMATCH", 409);
      const subjectId = context.subjectByKey.get(object.subjectKey);
      if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
      const primaryNodeId = resolveNode(object.subjectKey, object.primaryNode, context);
      for (const stableKey of object.relatedNodes) {
        relations.push({ noteId: targetId, syllabusNodeId: resolveNode(object.subjectKey, stableKey, context)! });
      }
      return [
        parameter(args, targetId, "text"), parameter(args, subjectId, "text"),
        parameter(args, object.title, "text"), parameter(args, object.bodyMarkdown, "text"),
        parameter(args, object.kind, "text"), parameter(args, object.stableKey, "text"),
        parameter(args, primaryNodeId, "text"),
      ].join(",");
    }).map((row) => `(${row})`).join(",");
    await executeExpected(context.tx, `
      UPDATE "Note" AS target
      SET title = data.title, content = data.content, kind = data.kind::"NoteKind",
          "stableKey" = data.stable_key, "syllabusNodeId" = data.primary_node_id,
          revision = target.revision + 1, "updatedAt" = NOW()
      FROM (VALUES ${values}) AS data(id, subject_id, title, content, kind, stable_key, primary_node_id)
      WHERE target.id = data.id AND target."subjectId" = data.subject_id
        AND EXISTS (SELECT 1 FROM "Subject" subject WHERE subject.id = target."subjectId" AND subject."workspaceId" = $1::text)
    `, args, chunk.length);
    writeBatchCount += 1;
    await context.tx.noteRelatedSyllabusNode.deleteMany({ where: { noteId: { in: chunk.map((row) => row.targetId) } } });
    for (const relationChunk of chunks(relations)) {
      if (relationChunk.length) await context.tx.noteRelatedSyllabusNode.createMany({ data: relationChunk });
    }
    for (const target of chunk) result.set(target.item.stableKey, target.targetId);
  }
  return { entityIds: result, writeBatchCount };
}

async function bulkResources(
  targets: MutationTarget[],
  context: LearningTreeBulkApplyContext,
) {
  const result = new Map<string, string>();
  let writeBatchCount = 0;
  for (const chunk of chunks(targets)) {
    const args: unknown[] = [context.workspaceId];
    const values = chunk.map(({ object, targetId }) => {
      if (object.type !== "resource") throw new ApiError("LEARNING_TREE_BULK_TYPE_MISMATCH", 409);
      const subjectId = context.subjectByKey.get(object.subjectKey);
      if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
      return [
        parameter(args, targetId, "text"), parameter(args, subjectId, "text"),
        parameter(args, object.title, "text"), parameter(args, object.url, "text"),
        parameter(args, object.displayHost, "text"),
      ].join(",");
    }).map((row) => `(${row})`).join(",");
    await executeExpected(context.tx, `
      UPDATE "StudyResource" AS target
      SET title = data.title, "externalUrl" = data.external_url, "displayHost" = data.display_host,
          "subjectId" = data.subject_id, revision = target.revision + 1, "updatedAt" = NOW()
      FROM (VALUES ${values}) AS data(id, subject_id, title, external_url, display_host)
      WHERE target.id = data.id AND target."workspaceId" = $1::text
    `, args, chunk.length);
    writeBatchCount += 1;
    for (const target of chunk) result.set(target.item.stableKey, target.targetId);
  }
  return { entityIds: result, writeBatchCount };
}

async function bulkPlans(
  targets: MutationTarget[],
  context: LearningTreeBulkApplyContext,
) {
  const plans = targets.map((target) => target.object).filter((object) => object.type === "plan");
  const milestoneKeys = [...new Set(plans.flatMap((plan) => plan.milestoneKey ? [plan.milestoneKey] : []))];
  const milestones = milestoneKeys.length ? await context.tx.planMilestone.findMany({
    where: { workspaceId: context.workspaceId, stableKey: { in: milestoneKeys }, archivedAt: null },
    select: { id: true, stableKey: true },
  }) : [];
  const milestoneByKey = new Map(milestones.map((milestone) => [milestone.stableKey, milestone.id]));
  const result = new Map<string, string>();
  let writeBatchCount = 0;
  for (const chunk of chunks(targets)) {
    const rows = chunk.map((target) => {
      const plan = target.object;
      if (plan.type !== "plan") throw new ApiError("LEARNING_TREE_BULK_TYPE_MISMATCH", 409);
      const subjectId = context.subjectByKey.get(plan.subjectKey);
      if (!subjectId) throw new ApiError("LEARNING_TREE_SUBJECT_MISSING", 400);
      const originKey = learningTreePlanOriginKey(plan.subjectKey, plan.stableKey);
      return { target, plan, subjectId, originKey };
    });
    const versionByOrigin = new Map(rows.map((row) => [row.originKey, row.plan.originVersion]));
    const previous = await context.tx.planInboxItem.findMany({
      where: {
        workspaceId: context.workspaceId,
        originKey: { in: [...versionByOrigin.keys()] },
        status: "OPEN",
        supersededByItemId: null,
      },
      select: { id: true, originKey: true, originVersion: true },
    });
    const created = await context.tx.planInboxItem.createManyAndReturn({
      data: rows.map(({ plan, subjectId, originKey }) => ({
        workspaceId: context.workspaceId,
        stableKey: plan.batchRef,
        originKey,
        originVersion: plan.originVersion,
        originType: "learning_tree_plan",
        originSnapshot: {
          title: plan.title, subjectKey: plan.subjectKey, milestoneKey: plan.milestoneKey ?? null,
          durationMinutes: plan.durationMinutes ?? null, dependsOn: plan.dependsOn ?? null,
          dependencyType: plan.dependencyType ?? "SOFT", batchRef: plan.batchRef,
          sourceStableKey: plan.stableKey,
        },
        title: plan.title,
        subjectId,
        estimatedMinutes: plan.durationMinutes ?? null,
        planMilestoneId: plan.milestoneKey ? milestoneByKey.get(plan.milestoneKey) ?? null : null,
        actorId: context.actorId,
      })),
      select: { id: true, stableKey: true, originKey: true },
    });
    writeBatchCount += 1;
    const createdByOrigin = new Map(created.map((item) => [item.originKey, item]));
    const supersedeRows = previous.flatMap((item) => {
      const next = createdByOrigin.get(item.originKey);
      const nextVersion = versionByOrigin.get(item.originKey);
      return next && nextVersion !== undefined && item.originVersion < nextVersion
        ? [{ id: item.id, supersededByItemId: next.id }]
        : [];
    });
    if (supersedeRows.length) {
      await bulkSupersedePlans(context, supersedeRows);
      writeBatchCount += 1;
    }
    const dependencyRows = rows.flatMap(({ plan, originKey }) => {
      if (!plan.dependsOn?.startsWith("plan:")) return [];
      const createdItem = createdByOrigin.get(originKey);
      if (!createdItem) throw new ApiError("LEARNING_TREE_BULK_RESULT_MISSING", 409);
      const dependencyKey = plan.dependsOn.slice("plan:".length);
      return [{
        inboxItemId: createdItem.id,
        targetType: "INBOX_STABLE_REF" as const,
        dependencyType: plan.dependencyType === "HARD" ? "HARD" as const : "SOFT" as const,
        importBatchId: context.importBatchId,
        planStableKey: dependencyKey,
        planOriginVersion: context.planOriginVersionBySourceKey.get(dependencyKey) ?? null,
      }];
    });
    if (dependencyRows.length) {
      await context.tx.planInboxDependencyRef.createMany({ data: dependencyRows });
      writeBatchCount += 1;
    }
    const supersededCountById = new Map<string, number>();
    for (const row of supersedeRows) {
      supersededCountById.set(row.supersededByItemId, (supersededCountById.get(row.supersededByItemId) ?? 0) + 1);
    }
    await context.tx.auditEvent.createMany({
      data: created.map((item) => ({
        actorId: context.actorId,
        action: "PLAN_INBOX_CREATED",
        entityType: "PlanInboxItem",
        entityId: item.id,
        metadata: {
          originKey: item.originKey,
          originVersion: versionByOrigin.get(item.originKey) ?? 1,
          supersededCount: supersededCountById.get(item.id) ?? 0,
        },
      })),
    });
    writeBatchCount += 1;
    for (const { target, plan, originKey } of rows) {
      const createdItem = createdByOrigin.get(originKey);
      if (!createdItem) throw new ApiError("LEARNING_TREE_BULK_RESULT_MISSING", 409);
      result.set(plan.stableKey, createdItem.id);
      void target;
    }
  }
  return { entityIds: result, writeBatchCount };
}

async function bulkSupersedePlans(
  context: LearningTreeBulkApplyContext,
  rows: Array<{ id: string; supersededByItemId: string }>,
): Promise<void> {
  const args: unknown[] = [context.workspaceId];
  const values = rows.map((row) =>
    `(${parameter(args, row.id, "text")},${parameter(args, row.supersededByItemId, "text")})`
  ).join(",");
  await executeExpected(context.tx, `
    UPDATE "PlanInboxItem" AS target
    SET "supersededByItemId" = data.superseded_by_id, revision = target.revision + 1, "updatedAt" = NOW()
    FROM (VALUES ${values}) AS data(id, superseded_by_id)
    WHERE target.id = data.id AND target."workspaceId" = $1::text
      AND target.status = 'OPEN' AND target."supersededByItemId" IS NULL
  `, args, rows.length);
}

function resolveNode(
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

async function executeExpected(
  tx: Prisma.TransactionClient,
  query: string,
  args: unknown[],
  expected: number,
): Promise<void> {
  const changed = Number(await tx.$executeRawUnsafe(query, ...args));
  if (changed !== expected) throw new ApiError("LEARNING_TREE_BULK_TARGET_CONFLICT", 409);
}

function parameter(args: unknown[], value: unknown, cast: string): string {
  args.push(value);
  return `$${args.length}::${cast}`;
}

function learningTreePlanOriginKey(subjectKey: string, stableKey: string): string {
  return sha256Hex(["learning-tree-plan-origin:v1", subjectKey, stableKey].join("|"));
}

function nodeLookupKey(subjectKey: string, stableKey: string): string {
  return `${subjectKey}\u0000${stableKey}`;
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += WRITE_CHUNK_SIZE) {
    result.push(values.slice(index, index + WRITE_CHUNK_SIZE));
  }
  return result;
}

function emptyDiffTypeCounts(): Record<MutationDiffType, number> {
  return { UPDATE: 0, MOVE: 0, ARCHIVE: 0, CONFLICT: 0 };
}

function emptyResult(): LearningTreeBulkMutationResult {
  return { entityIds: new Map(), objectCount: 0, writeBatchCount: 0, diffTypeCounts: emptyDiffTypeCounts() };
}
