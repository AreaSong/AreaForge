import { createHash } from "node:crypto";
import { stableStringify } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { workspaceOwnerWhere } from "@/lib/workspace/access-service";
import type {
  SubjectMergeOperationDto,
  SubjectMergeUndoResultDto,
} from "@/lib/contracts/workspace";
import { lockActorWorkspaceScope } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  normalizeIdempotencyKey,
} from "./persistent-idempotency";
import {
  SUBJECT_MERGE_UNDO_WINDOW_MS,
} from "./subject-merge-service";
import {
  assertSubjectMergeScopeStillAtTarget,
  restoreSubjectMergeReferences,
} from "./subject-merge-undo-migration";
import {
  isSubjectMergeSerializationFailure,
  isSubjectMergeUniqueConstraintError,
  parseSubjectMergeScope,
  serializeSubjectMergeWorkspace,
} from "./subject-merge-support";

const MERGE_ACTION = "SUBJECT_MERGE_CONFIRMED";
const MERGE_ENTITY = "SubjectMerge";
const UNDO_ACTION = "SUBJECT_MERGE_UNDONE";
const UNDO_ENTITY = "SubjectMergeUndo";
const UNDO_PROTOCOL = "subject-merge-undo-v1";
const UNDO_LOCK_NAMESPACE = 2026090402;

type MergeTx = Prisma.TransactionClient;

export interface SubjectMergeUndoInput {
  workspaceId: string;
  operationId: string;
  expectedWorkspaceRevision: number;
  undoSnapshotHash: string;
  idempotencyKey: string;
  confirm: true;
}

export async function listRecentSubjectMergeOperations(
  actorId: string,
  workspaceId: string,
): Promise<SubjectMergeOperationDto[]> {
  return prisma.$transaction(async (tx) => {
    const workspace = await findOwnedWorkspace(tx, actorId, workspaceId);
    const events = await tx.auditEvent.findMany({
      where: {
        actorId,
        action: MERGE_ACTION,
        entityType: MERGE_ENTITY,
        AND: [
          { metadata: { path: ["workspaceId"], equals: workspaceId } },
          { metadata: { path: ["claimState"], equals: "completed" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const undoneEvents = await tx.auditEvent.findMany({
      where: {
        actorId,
        action: UNDO_ACTION,
        entityType: UNDO_ENTITY,
        AND: [
          { metadata: { path: ["workspaceId"], equals: workspaceId } },
          { metadata: { path: ["claimState"], equals: "completed" } },
        ],
      },
      select: { metadata: true },
    });
    const undoneIds = new Set(undoneEvents.flatMap((event) => {
      const operationId = stringField(asRecord(event.metadata), "mergeOperationId");
      return operationId ? [operationId] : [];
    }));
    const allSubjectIds = new Set(events.flatMap((event) => {
      const metadata = asRecord(event.metadata);
      return [stringField(metadata, "targetSubjectId"), ...stringArrayField(metadata, "sourceSubjectIds")];
    }).filter(Boolean));
    const subjects = await tx.subject.findMany({
      where: { id: { in: [...allSubjectIds] }, workspaceId },
      select: { id: true, name: true, archivedAt: true },
    });
    const byId = new Map(subjects.map((subject) => [subject.id, subject]));

    const results: SubjectMergeOperationDto[] = [];
    for (const event of events) {
      try {
        const operation = parseMergeOperation(event);
        const target = byId.get(operation.targetSubjectId);
        const sources = operation.sourceSubjectIds.map((id) => byId.get(id)).filter(Boolean);
        let status: SubjectMergeOperationDto["status"] = "AVAILABLE";
        const blockingFields: string[] = [];
        if (undoneIds.has(event.id)) status = "UNDONE";
        else if (Date.now() > operation.undoUntil.getTime()) status = "EXPIRED";
        else if (!target || target.archivedAt || sources.length !== operation.sourceSubjectIds.length || sources.some((row) => !row?.archivedAt)) {
          status = "BLOCKED";
          blockingFields.push("subjectLifecycle");
        } else {
          try {
            await assertSubjectMergeScopeStillAtTarget(tx, operation.targetSubjectId, operation.scope);
          } catch (error) {
            status = "BLOCKED";
            if (error instanceof ApiError) blockingFields.push(...(error.details?.conflictFields ?? ["sourceMapping"]));
            else throw error;
          }
        }
        results.push({
          id: event.id,
          targetSubjectId: operation.targetSubjectId,
          targetSubjectName: target?.name ?? "已移除科目",
          sourceSubjects: operation.sourceSubjectIds.map((id) => ({
            id,
            name: byId.get(id)?.name ?? "已移除科目",
          })),
          mergedAt: event.createdAt.toISOString(),
          undoUntil: operation.undoUntil.toISOString(),
          status,
          workspaceRevision: workspace.revision,
          undoSnapshotHash: buildSubjectMergeUndoSnapshot({
            workspaceId,
            workspaceRevision: workspace.revision,
            operationId: event.id,
            scopeHash: operation.scopeHash,
            targetSubjectId: operation.targetSubjectId,
            sourceSubjectIds: operation.sourceSubjectIds,
          }),
          blockingFields,
        });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const metadata = asRecord(event.metadata);
        const targetSubjectId = stringField(metadata, "targetSubjectId");
        const sourceSubjectIds = stringArrayField(metadata, "sourceSubjectIds");
        const explicitUndoUntil = stringField(metadata, "undoUntil");
        const parsedUndoUntil = explicitUndoUntil ? new Date(explicitUndoUntil) : null;
        results.push({
          id: event.id,
          targetSubjectId: targetSubjectId || `invalid-target:${event.id}`,
          targetSubjectName: targetSubjectId ? byId.get(targetSubjectId)?.name ?? "已移除科目" : "目标科目记录缺失",
          sourceSubjects: sourceSubjectIds.length > 0
            ? sourceSubjectIds.map((id) => ({ id, name: byId.get(id)?.name ?? "已移除科目" }))
            : [{ id: `invalid-source:${event.id}`, name: "来源科目记录缺失" }],
          mergedAt: event.createdAt.toISOString(),
          undoUntil: parsedUndoUntil && !Number.isNaN(parsedUndoUntil.getTime())
            ? parsedUndoUntil.toISOString()
            : new Date(event.createdAt.getTime() + SUBJECT_MERGE_UNDO_WINDOW_MS).toISOString(),
          status: "BLOCKED",
          workspaceRevision: workspace.revision,
          undoSnapshotHash: "",
          blockingFields: ["mergeOperation"],
        });
      }
    }
    return results;
  }, { isolationLevel: "RepeatableRead" });
}

export async function undoWorkspaceSubjectMerge(
  actorId: string,
  input: SubjectMergeUndoInput,
): Promise<SubjectMergeUndoResultDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint(UNDO_PROTOCOL, input);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockActorWorkspaceScope(tx, actorId);
      await lockUndoScope(tx, input.workspaceId);
      const workspace = await findOwnedWorkspace(tx, actorId, input.workspaceId);
      const command = {
        actorId,
        workspaceId: input.workspaceId,
        action: UNDO_ACTION,
        entityType: UNDO_ENTITY,
        idempotencyKey,
        requestFingerprint,
        conflictCode: "SUBJECT_MERGE_UNDO_IDEMPOTENCY_CONFLICT",
      };
      const claim = await claimPersistentCreateCommand(tx, command);
      if (claim.state === "pending") throw undoConflict("SUBJECT_MERGE_UNDO_IN_PROGRESS", ["idempotencyKey"]);
      if (claim.state === "replayed") return parseUndoReplay(claim.replay.resultSnapshot);

      const event = await findOwnedMergeEvent(tx, actorId, input.workspaceId, input.operationId);
      const operation = parseMergeOperation(event);
      await assertNotUndone(tx, actorId, input.workspaceId, input.operationId);
      if (Date.now() > operation.undoUntil.getTime()) {
        throw undoConflict("SUBJECT_MERGE_UNDO_WINDOW_EXPIRED", ["undoUntil"]);
      }
      if (workspace.revision !== input.expectedWorkspaceRevision) {
        throw undoConflict("SUBJECT_MERGE_UNDO_SNAPSHOT_CONFLICT", ["workspaceRevision"]);
      }
      const expectedSnapshot = buildSubjectMergeUndoSnapshot({
        workspaceId: input.workspaceId,
        workspaceRevision: workspace.revision,
        operationId: input.operationId,
        scopeHash: operation.scopeHash,
        targetSubjectId: operation.targetSubjectId,
        sourceSubjectIds: operation.sourceSubjectIds,
      });
      if (expectedSnapshot !== input.undoSnapshotHash) {
        throw undoConflict("SUBJECT_MERGE_UNDO_SNAPSHOT_CONFLICT", ["undoSnapshotHash"]);
      }
      await assertUndoSubjectLifecycle(tx, input.workspaceId, operation.targetSubjectId, operation.sourceSubjectIds);
      await assertNoActiveSessions(tx, [operation.targetSubjectId, ...operation.sourceSubjectIds]);
      await assertSubjectMergeScopeStillAtTarget(tx, operation.targetSubjectId, operation.scope);

      const restored = await restoreSubjectMergeReferences(tx, operation.targetSubjectId, operation.scope);
      const restoredSubjects = await tx.subject.updateMany({
        where: { workspaceId: input.workspaceId, id: { in: operation.sourceSubjectIds }, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      if (restoredSubjects.count !== operation.sourceSubjectIds.length) {
        throw undoConflict("SUBJECT_MERGE_UNDO_SUBJECT_STATE_CONFLICT", ["sourceSubjectIds", "archivedAt"]);
      }
      const updatedWorkspace = await bumpWorkspaceRevision(tx, input.workspaceId, workspace.revision);
      const undoneAt = new Date();
      const result: SubjectMergeUndoResultDto = {
        operationId: input.operationId,
        workspace: serializeSubjectMergeWorkspace(updatedWorkspace),
        restoredSubjectIds: operation.sourceSubjectIds,
        restoredReferenceCounts: restored.counts,
        recreatedRelatedKnowledgePointLinks: restored.recreatedRelatedKnowledgePointLinks,
        scopeHash: operation.scopeHash,
        undoneAt: undoneAt.toISOString(),
      };
      await completePersistentCreateClaim(tx, command, claim.claimEventId, input.operationId, {
        protocol: UNDO_PROTOCOL,
        mergeOperationId: input.operationId,
        scopeHash: operation.scopeHash,
        restoredReferenceCounts: restored.counts,
        recreatedRelatedKnowledgePointLinks: restored.recreatedRelatedKnowledgePointLinks,
        undoneAt: undoneAt.toISOString(),
      }, result as unknown as Prisma.InputJsonValue);
      return result;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isSubjectMergeSerializationFailure(error)) {
      throw undoConflict("SUBJECT_MERGE_UNDO_RETRY_REQUIRED", ["workspaceRevision"]);
    }
    if (isSubjectMergeUniqueConstraintError(error)) {
      throw undoConflict("SUBJECT_MERGE_UNDO_UNIQUE_CONFLICT", ["uniqueReference"]);
    }
    throw error;
  }
}

export function buildSubjectMergeUndoSnapshot(input: {
  workspaceId: string;
  workspaceRevision: number;
  operationId: string;
  scopeHash: string;
  targetSubjectId: string;
  sourceSubjectIds: string[];
}): string {
  return "sha256:" + createHash("sha256")
    .update(stableStringify({ ...input, sourceSubjectIds: [...input.sourceSubjectIds].sort() }), "utf8")
    .digest("hex");
}

function parseMergeOperation(event: { id: string; createdAt: Date; metadata: Prisma.JsonValue | null }) {
  const metadata = asRecord(event.metadata);
  const targetSubjectId = stringField(metadata, "targetSubjectId");
  const sourceSubjectIds = stringArrayField(metadata, "sourceSubjectIds");
  const scopeHash = stringField(metadata, "scopeHash");
  const explicitUndoUntil = stringField(metadata, "undoUntil");
  const undoUntil = explicitUndoUntil
    ? new Date(explicitUndoUntil)
    : new Date(event.createdAt.getTime() + SUBJECT_MERGE_UNDO_WINDOW_MS);
  if (!targetSubjectId || sourceSubjectIds.length === 0 || !scopeHash || Number.isNaN(undoUntil.getTime())) {
    throw undoConflict("SUBJECT_MERGE_MAPPING_INVALID", ["mergeOperation"]);
  }
  return {
    targetSubjectId,
    sourceSubjectIds,
    scopeHash,
    undoUntil,
    scope: parseSubjectMergeScope(metadata.sourceMapping),
  };
}

async function findOwnedMergeEvent(tx: MergeTx, actorId: string, workspaceId: string, operationId: string) {
  const event = await tx.auditEvent.findFirst({
    where: {
      id: operationId,
      actorId,
      action: MERGE_ACTION,
      entityType: MERGE_ENTITY,
      metadata: { path: ["workspaceId"], equals: workspaceId },
    },
  });
  if (!event) throw new ApiError("SUBJECT_MERGE_OPERATION_NOT_FOUND", 404);
  return event;
}

async function assertNotUndone(tx: MergeTx, actorId: string, workspaceId: string, operationId: string) {
  const undone = await tx.auditEvent.findFirst({
    where: {
      actorId,
      action: UNDO_ACTION,
      entityType: UNDO_ENTITY,
      AND: [
        { metadata: { path: ["workspaceId"], equals: workspaceId } },
        { metadata: { path: ["mergeOperationId"], equals: operationId } },
        { metadata: { path: ["claimState"], equals: "completed" } },
      ],
    },
    select: { id: true },
  });
  if (undone) throw undoConflict("SUBJECT_MERGE_ALREADY_UNDONE", ["operationId"]);
}

async function assertUndoSubjectLifecycle(
  tx: MergeTx,
  workspaceId: string,
  targetSubjectId: string,
  sourceSubjectIds: string[],
) {
  const rows = await tx.subject.findMany({
    where: { workspaceId, id: { in: [targetSubjectId, ...sourceSubjectIds] } },
    select: { id: true, archivedAt: true },
  });
  const target = rows.find((row) => row.id === targetSubjectId);
  const sources = rows.filter((row) => sourceSubjectIds.includes(row.id));
  if (!target || target.archivedAt || sources.length !== sourceSubjectIds.length || sources.some((row) => !row.archivedAt)) {
    throw undoConflict("SUBJECT_MERGE_UNDO_SUBJECT_STATE_CONFLICT", ["subjectLifecycle"]);
  }
}

async function assertNoActiveSessions(tx: MergeTx, subjectIds: string[]) {
  const count = await tx.studySession.count({
    where: { subjectId: { in: subjectIds }, status: { in: ["RUNNING", "PAUSED", "CLOSING"] } },
  });
  if (count > 0) throw undoConflict("ACTIVE_SESSION_BLOCKS_SUBJECT_MERGE_UNDO", ["activeSessions"]);
}

async function findOwnedWorkspace(tx: MergeTx, actorId: string, workspaceId: string) {
  const workspace = await tx.examWorkspace.findFirst({
    where: { id: workspaceId, ...workspaceOwnerWhere(actorId), status: "ACTIVE" },
  });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  return workspace;
}

async function bumpWorkspaceRevision(tx: MergeTx, workspaceId: string, expectedRevision: number) {
  const changed = await tx.examWorkspace.updateMany({
    where: { id: workspaceId, revision: expectedRevision },
    data: { revision: { increment: 1 } },
  });
  if (changed.count !== 1) throw undoConflict("WORKSPACE_REVISION_CONFLICT", ["revision"]);
  return tx.examWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
}

async function lockUndoScope(tx: MergeTx, workspaceId: string) {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${UNDO_LOCK_NAMESPACE}, hashtext(${workspaceId}))`;
}

function parseUndoReplay(value: Prisma.JsonValue | undefined): SubjectMergeUndoResultDto {
  const record = asRecord(value ?? null);
  if (
    typeof record.operationId !== "string"
    || !record.workspace
    || !Array.isArray(record.restoredSubjectIds)
    || !record.restoredReferenceCounts
    || typeof record.scopeHash !== "string"
    || typeof record.undoneAt !== "string"
  ) throw undoConflict("SUBJECT_MERGE_UNDO_IDEMPOTENCY_RESULT_UNAVAILABLE", ["idempotencyKey"]);
  return record as unknown as SubjectMergeUndoResultDto;
}

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function stringField(record: Record<string, Prisma.JsonValue>, key: string): string {
  return typeof record[key] === "string" ? record[key] : "";
}

function stringArrayField(record: Record<string, Prisma.JsonValue>, key: string): string[] {
  return Array.isArray(record[key])
    ? (record[key] as Prisma.JsonArray).filter((value): value is string => typeof value === "string")
    : [];
}

function undoConflict(code: string, conflictFields: string[]): ApiError {
  return new ApiError(code, 409, { conflictFields, workbench: "/settings/exams" });
}
