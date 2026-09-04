import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { SubjectDuplicateSetDto, SubjectMergeResultDto } from "@/lib/contracts/workspace";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  normalizeIdempotencyKey,
} from "./persistent-idempotency";
import {
  listSubjectDuplicatePreviewsWithClient,
} from "./subject-duplicate-query-service";
import { lockActorWorkspaceScope } from "./exam-workspace-service";
import {
  collectSubjectMergeScope,
  migrateSubjectReferences,
} from "./subject-merge-migration";
import {
  buildSubjectMergeScopeHash,
  isSubjectMergeSerializationFailure,
  isSubjectMergeUniqueConstraintError,
  normalizeSubjectIds,
  parseSubjectMergeReplayResult,
  serializeMergedSubject,
  serializeSubjectMergeWorkspace,
  subjectMergeScopeByteLength,
} from "./subject-merge-support";

const SUBJECT_MERGE_ACTION = "SUBJECT_MERGE_CONFIRMED";
const SUBJECT_MERGE_ENTITY = "SubjectMerge";
const SUBJECT_MERGE_PROTOCOL = "subject-merge-v1";
const SUBJECT_MERGE_LOCK_NAMESPACE = 2026090401;
const SUBJECT_MERGE_MAX_MAPPING_BYTES = 4 * 1024 * 1024;
export const SUBJECT_MERGE_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

type MergeTx = Prisma.TransactionClient;

export interface SubjectMergeInput {
  workspaceId: string;
  targetSubjectId: string;
  sourceSubjectIds: string[];
  snapshotHash: string;
  expectedWorkspaceRevision: number;
  idempotencyKey: string;
  confirm: true;
}

export async function mergeWorkspaceSubjects(
  actorId: string,
  input: SubjectMergeInput,
): Promise<SubjectMergeResultDto> {
  const sourceSubjectIds = normalizeSubjectIds(input.sourceSubjectIds, input.targetSubjectId);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint(SUBJECT_MERGE_PROTOCOL, {
    workspaceId: input.workspaceId,
    targetSubjectId: input.targetSubjectId,
    sourceSubjectIds,
    snapshotHash: input.snapshotHash,
    expectedWorkspaceRevision: input.expectedWorkspaceRevision,
    confirm: input.confirm,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      await lockActorWorkspaceScope(tx, actorId);
      await lockSubjectMergeScope(tx, input.workspaceId);

      const workspace = await findOwnedWorkspace(tx, actorId, input.workspaceId);
      const command = {
        actorId,
        workspaceId: input.workspaceId,
        action: SUBJECT_MERGE_ACTION,
        entityType: SUBJECT_MERGE_ENTITY,
        idempotencyKey,
        requestFingerprint,
        conflictCode: "SUBJECT_MERGE_IDEMPOTENCY_CONFLICT",
      };
      const claim = await claimPersistentCreateCommand(tx, command);
      if (claim.state === "pending") {
        throw new ApiError("SUBJECT_MERGE_IN_PROGRESS", 409, {
          conflictFields: ["idempotencyKey"],
          workbench: "/settings/exams",
        });
      }
      if (claim.state === "replayed") {
        return parseSubjectMergeReplayResult(claim.replay.resultSnapshot);
      }

      const preview = await resolveRequestedPreview(
        actorId,
        input.workspaceId,
        input.targetSubjectId,
        sourceSubjectIds,
        input.snapshotHash,
        input.expectedWorkspaceRevision,
        workspace.revision,
        tx,
      );
      assertMergeablePreview(preview);
      assertSubjectLifecycle(preview, input.targetSubjectId, sourceSubjectIds);

      const candidateIds = [input.targetSubjectId, ...sourceSubjectIds];
      const activeSessions = await tx.studySession.findMany({
        where: {
          subjectId: { in: candidateIds },
          status: { in: ["RUNNING", "PAUSED", "CLOSING"] },
        },
        select: { id: true },
      });
      if (activeSessions.length > 0) {
        throw new ApiError("ACTIVE_SESSION_BLOCKS_SUBJECT_MERGE", 409, {
          latest: preview,
          conflictFields: ["activeSessions"],
          workbench: "/settings/exams",
        });
      }

      const scope = await collectSubjectMergeScope(tx, sourceSubjectIds);
      if (subjectMergeScopeByteLength(scope) > SUBJECT_MERGE_MAX_MAPPING_BYTES) {
        throw new ApiError("SUBJECT_MERGE_SCOPE_TOO_LARGE", 409, {
          conflictFields: ["sourceMapping"],
          workbench: "/settings/exams",
        });
      }
      const migration = await migrateSubjectReferences(tx, input.targetSubjectId, sourceSubjectIds, scope);
      const reversibleScope = {
        ...scope,
        relatedKnowledgePointLinks: migration.relatedKnowledgePointLinks,
      };
      if (subjectMergeScopeByteLength(reversibleScope) > SUBJECT_MERGE_MAX_MAPPING_BYTES) {
        throw new ApiError("SUBJECT_MERGE_SCOPE_TOO_LARGE", 409, {
          conflictFields: ["sourceMapping"],
          workbench: "/settings/exams",
        });
      }
      const archivedAt = new Date();
      const archived = await tx.subject.updateMany({
        where: {
          workspaceId: input.workspaceId,
          id: { in: sourceSubjectIds },
          archivedAt: null,
        },
        data: { archivedAt },
      });
      if (archived.count !== sourceSubjectIds.length) {
        throw new ApiError("SUBJECT_MERGE_SOURCE_STATE_CONFLICT", 409, {
          latest: preview,
          conflictFields: ["sourceSubjectIds", "archivedAt"],
          workbench: "/settings/exams",
        });
      }

      const updatedWorkspace = await bumpWorkspaceRevision(tx, workspace.id, workspace.revision);
      const target = await tx.subject.findFirst({
        where: { id: input.targetSubjectId, workspaceId: input.workspaceId },
      });
      if (!target) throw new ApiError("SUBJECT_NOT_FOUND", 404);

      const scopeHash = buildSubjectMergeScopeHash({
        workspaceId: input.workspaceId,
        targetSubjectId: input.targetSubjectId,
        sourceSubjectIds,
        scope: reversibleScope,
      });
      const undoUntil = new Date(archivedAt.getTime() + SUBJECT_MERGE_UNDO_WINDOW_MS);
      const result: SubjectMergeResultDto = {
        operationId: claim.claimEventId,
        undoUntil: undoUntil.toISOString(),
        workspace: serializeSubjectMergeWorkspace(updatedWorkspace),
        targetSubject: serializeMergedSubject(target),
        archivedSubjectIds: sourceSubjectIds,
        migratedReferenceCounts: migration.counts,
        deduplicatedRelatedKnowledgePointLinks: migration.deduplicatedRelatedKnowledgePointLinks,
        scopeHash,
        snapshotHash: input.snapshotHash,
      };
      await completePersistentCreateClaim(
        tx,
        command,
        claim.claimEventId,
        input.targetSubjectId,
        {
          protocol: SUBJECT_MERGE_PROTOCOL,
          targetSubjectId: input.targetSubjectId,
          sourceSubjectIds,
          snapshotHash: input.snapshotHash,
          scopeHash,
          undoUntil: undoUntil.toISOString(),
          migratedReferenceCounts: migration.counts,
          deduplicatedRelatedKnowledgePointLinks: migration.deduplicatedRelatedKnowledgePointLinks,
          sourceMapping: reversibleScope as unknown as Prisma.InputJsonObject,
        },
        result as unknown as Prisma.InputJsonValue,
      );
      return result;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isSubjectMergeSerializationFailure(error)) {
      throw new ApiError("SUBJECT_MERGE_RETRY_REQUIRED", 409, {
        conflictFields: ["workspaceRevision"],
        workbench: "/settings/exams",
      });
    }
    if (isSubjectMergeUniqueConstraintError(error)) {
      throw new ApiError("SUBJECT_MERGE_UNIQUE_CONFLICT", 409, {
        conflictFields: ["uniqueReference"],
        workbench: "/settings/exams",
      });
    }
    throw error;
  }
}

function assertSubjectLifecycle(
  preview: SubjectDuplicateSetDto,
  targetSubjectId: string,
  sourceSubjectIds: string[],
): void {
  const target = preview.subjects.find(({ subject }) => subject.id === targetSubjectId)?.subject;
  const archivedSourceIds = preview.subjects
    .filter(({ subject }) => sourceSubjectIds.includes(subject.id) && Boolean(subject.archivedAt))
    .map(({ subject }) => subject.id);
  if (!target || target.archivedAt || archivedSourceIds.length > 0) {
    throw new ApiError("SUBJECT_MERGE_SUBJECT_ARCHIVED", 409, {
      latest: preview,
      conflictFields: ["targetSubjectId", "sourceSubjectIds", "archivedAt"],
      workbench: "/settings/exams",
    });
  }
}

async function resolveRequestedPreview(
  actorId: string,
  workspaceId: string,
  targetSubjectId: string,
  sourceSubjectIds: string[],
  snapshotHash: string,
  expectedWorkspaceRevision: number,
  actualWorkspaceRevision: number,
  tx: MergeTx,
): Promise<SubjectDuplicateSetDto> {
  if (expectedWorkspaceRevision !== actualWorkspaceRevision) {
    throw new ApiError("SUBJECT_MERGE_SNAPSHOT_CONFLICT", 409, {
      conflictFields: ["workspaceRevision", "snapshotHash"],
      workbench: "/settings/exams",
    });
  }
  const previews = await listSubjectDuplicatePreviewsWithClient(actorId, workspaceId, tx);
  const requestedIds = new Set([targetSubjectId, ...sourceSubjectIds]);
  const preview = previews.find((candidate) => (
    candidate.recommendedTargetId === targetSubjectId
    && candidate.subjects.length === requestedIds.size
    && candidate.subjects.every(({ subject }) => requestedIds.has(subject.id))
  ));
  if (!preview || preview.snapshotHash !== snapshotHash || preview.workspaceRevision !== actualWorkspaceRevision) {
    throw new ApiError("SUBJECT_MERGE_SNAPSHOT_CONFLICT", 409, {
      latest: preview,
      conflictFields: ["snapshotHash", "workspaceRevision", "sourceSubjectIds", "targetSubjectId"],
      workbench: "/settings/exams",
    });
  }
  return preview;
}

function assertMergeablePreview(preview: SubjectDuplicateSetDto): void {
  const conflictFields: string[] = [];
  if (preview.conflictCounts.syllabusStableKeys > 0) conflictFields.push("syllabusNode.stableKey");
  if (preview.conflictCounts.simulationExams > 0) conflictFields.push("simulationSubjectResult.simulationExamId");
  if (preview.conflictCounts.simulationInboxOrigins > 0) conflictFields.push("planInboxItem.originKey");
  if (preview.conflictCounts.invalidSimulationInboxOrigins > 0) conflictFields.push("planInboxItem.originSnapshot");
  if (conflictFields.length > 0) {
    throw new ApiError("SUBJECT_MERGE_UNIQUE_CONFLICT", 409, {
      latest: preview,
      conflictFields,
      workbench: "/settings/exams",
    });
  }
}

async function findOwnedWorkspace(
  tx: MergeTx,
  actorId: string,
  workspaceId: string,
) {
  const workspace = await tx.examWorkspace.findFirst({
    where: { id: workspaceId, userId: actorId, status: "ACTIVE" },
  });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  return workspace;
}

async function bumpWorkspaceRevision(
  tx: MergeTx,
  workspaceId: string,
  expectedRevision: number,
) {
  const changed = await tx.examWorkspace.updateMany({
    where: { id: workspaceId, revision: expectedRevision },
    data: { revision: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw new ApiError("WORKSPACE_REVISION_CONFLICT", 409, {
      conflictFields: ["revision"],
      workbench: "/settings/exams",
    });
  }
  return tx.examWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
}

async function lockSubjectMergeScope(tx: MergeTx, workspaceId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(
    ${SUBJECT_MERGE_LOCK_NAMESPACE},
    hashtext(${workspaceId})
  )`;
}
