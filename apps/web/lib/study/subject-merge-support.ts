import { createHash } from "node:crypto";
import { stableStringify } from "@areaforge/core";
import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  ExamWorkspaceDto,
  SubjectMergeResultDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts/workspace";

export interface SubjectMergeReferencePreimage {
  id: string;
  sourceSubjectId: string;
}

export interface SubjectMergeInboxPreimage extends SubjectMergeReferencePreimage {
  originType: string;
  originKey: string;
  originVersion: number;
  stableKey: string;
  originSnapshot: Prisma.JsonValue;
}

export interface SubjectMergeKnowledgeLinkPreimage extends SubjectMergeReferencePreimage {
  knowledgePointId: string;
  role: string;
  createdAt: string;
  disposition: "updated" | "deleted" | null;
}

export interface SubjectMergeScope {
  studyTasks: SubjectMergeReferencePreimage[];
  studySessions: SubjectMergeReferencePreimage[];
  syllabusNodes: SubjectMergeReferencePreimage[];
  notes: SubjectMergeReferencePreimage[];
  mistakes: SubjectMergeReferencePreimage[];
  simulationSubjectResults: SubjectMergeReferencePreimage[];
  planMilestones: SubjectMergeReferencePreimage[];
  planInboxItems: SubjectMergeInboxPreimage[];
  studyResources: SubjectMergeReferencePreimage[];
  primaryKnowledgePoints: SubjectMergeReferencePreimage[];
  relatedKnowledgePointLinks: SubjectMergeKnowledgeLinkPreimage[];
  knowledgeGroups: SubjectMergeReferencePreimage[];
  learningArrangements: SubjectMergeReferencePreimage[];
}

export interface SubjectMergeCounts extends Record<string, number> {
  studyTasks: number;
  studySessions: number;
  syllabusNodes: number;
  notes: number;
  mistakes: number;
  simulationSubjectResults: number;
  planMilestones: number;
  planInboxItems: number;
  studyResources: number;
  primaryKnowledgePoints: number;
  relatedKnowledgePointLinks: number;
  knowledgeGroups: number;
  learningArrangements: number;
}

export function buildSubjectMergeScopeHash(input: {
  workspaceId: string;
  targetSubjectId: string;
  sourceSubjectIds: string[];
  scope: SubjectMergeScope;
}): string {
  return "sha256:" + createHash("sha256")
    .update(stableStringify({
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      targetSubjectId: input.targetSubjectId,
      sourceSubjectIds: [...input.sourceSubjectIds].sort(),
      scope: input.scope,
    }), "utf8")
    .digest("hex");
}

export function subjectMergeScopeByteLength(scope: SubjectMergeScope): number {
  return Buffer.byteLength(stableStringify(scope), "utf8");
}

export function normalizeSubjectIds(sourceSubjectIds: string[], targetSubjectId: string): string[] {
  const targetId = targetSubjectId.trim();
  const candidates = sourceSubjectIds.map((id) => id.trim()).filter(Boolean);
  const normalized = [...new Set(candidates)].sort();
  if (
    !targetId
    || normalized.length === 0
    || normalized.length !== candidates.length
    || normalized.includes(targetId)
  ) {
    throw new ApiError("SUBJECT_MERGE_SCOPE_INVALID", 400, {
      conflictFields: ["sourceSubjectIds", "targetSubjectId"],
      workbench: "/settings/exams",
    });
  }
  return normalized;
}

export function parseSubjectMergeReplayResult(
  value: Prisma.JsonValue | undefined,
): SubjectMergeResultDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw replayUnavailable();
  }
  const result = value as Partial<SubjectMergeResultDto>;
  if (
    typeof result.scopeHash !== "string"
    || typeof result.operationId !== "string"
    || typeof result.undoUntil !== "string"
    || typeof result.snapshotHash !== "string"
    || !Array.isArray(result.archivedSubjectIds)
    || !result.workspace
    || !result.targetSubject
    || !result.migratedReferenceCounts
    || typeof result.deduplicatedRelatedKnowledgePointLinks !== "number"
  ) {
    throw replayUnavailable();
  }
  return result as SubjectMergeResultDto;
}

export function parseSubjectMergeScope(value: Prisma.JsonValue | undefined): SubjectMergeScope {
  const record = jsonRecord(value);
  return {
    studyTasks: referencePreimages(record.studyTasks),
    studySessions: referencePreimages(record.studySessions),
    syllabusNodes: referencePreimages(record.syllabusNodes),
    notes: referencePreimages(record.notes),
    mistakes: referencePreimages(record.mistakes),
    simulationSubjectResults: referencePreimages(record.simulationSubjectResults),
    planMilestones: referencePreimages(record.planMilestones),
    planInboxItems: inboxPreimages(record.planInboxItems),
    studyResources: referencePreimages(record.studyResources),
    primaryKnowledgePoints: referencePreimages(record.primaryKnowledgePoints),
    relatedKnowledgePointLinks: knowledgeLinkPreimages(record.relatedKnowledgePointLinks),
    knowledgeGroups: referencePreimages(record.knowledgeGroups),
    learningArrangements: referencePreimages(record.learningArrangements),
  };
}

function referencePreimages(value: Prisma.JsonValue | undefined): SubjectMergeReferencePreimage[] {
  if (!Array.isArray(value)) throw invalidMapping();
  return value.map((item) => {
    const row = jsonRecord(item);
    if (typeof row.id !== "string" || typeof row.sourceSubjectId !== "string") throw invalidMapping();
    return { id: row.id, sourceSubjectId: row.sourceSubjectId };
  });
}

function inboxPreimages(value: Prisma.JsonValue | undefined): SubjectMergeInboxPreimage[] {
  if (!Array.isArray(value)) throw invalidMapping();
  return value.map((item) => {
    const row = jsonRecord(item);
    if (
      typeof row.id !== "string"
      || typeof row.sourceSubjectId !== "string"
      || typeof row.originType !== "string"
      || typeof row.originKey !== "string"
      || typeof row.originVersion !== "number"
      || typeof row.stableKey !== "string"
      || row.originSnapshot === undefined
    ) throw invalidMapping();
    return {
      id: row.id,
      sourceSubjectId: row.sourceSubjectId,
      originType: row.originType,
      originKey: row.originKey,
      originVersion: row.originVersion,
      stableKey: row.stableKey,
      originSnapshot: row.originSnapshot as Prisma.JsonValue,
    };
  });
}

function knowledgeLinkPreimages(value: Prisma.JsonValue | undefined): SubjectMergeKnowledgeLinkPreimage[] {
  if (!Array.isArray(value)) throw invalidMapping();
  return value.map((item) => {
    const row = jsonRecord(item);
    if (
      typeof row.id !== "string"
      || typeof row.sourceSubjectId !== "string"
      || typeof row.knowledgePointId !== "string"
      || typeof row.role !== "string"
      || typeof row.createdAt !== "string"
      || Number.isNaN(Date.parse(row.createdAt))
      || (row.disposition !== "updated" && row.disposition !== "deleted")
    ) throw invalidMapping();
    return {
      id: row.id,
      sourceSubjectId: row.sourceSubjectId,
      knowledgePointId: row.knowledgePointId,
      role: row.role,
      createdAt: row.createdAt,
      disposition: row.disposition,
    };
  });
}

function jsonRecord(value: Prisma.JsonValue | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function invalidMapping(): ApiError {
  return new ApiError("SUBJECT_MERGE_MAPPING_INVALID", 409, {
    conflictFields: ["sourceMapping"],
    workbench: "/settings/exams",
  });
}

function replayUnavailable(): ApiError {
  return new ApiError("SUBJECT_MERGE_IDEMPOTENCY_RESULT_UNAVAILABLE", 409, {
    conflictFields: ["idempotencyKey"],
    workbench: "/settings/exams",
  });
}

export function serializeSubjectMergeWorkspace(row: {
  id: string;
  stableKey: string;
  name: string;
  targetExamDate: Date | null;
  stageSummary: string | null;
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ExamWorkspaceDto {
  return {
    id: row.id,
    stableKey: row.stableKey,
    name: row.name,
    targetExamDate: row.targetExamDate?.toISOString() ?? null,
    stageSummary: row.stageSummary,
    status: row.status,
    revision: row.revision,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeMergedSubject(row: {
  id: string;
  workspaceId: string | null;
  groupId: string | null;
  stableKey: string;
  legacyCode: WorkspaceSubjectDto["legacyCode"];
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: Date | null;
}): WorkspaceSubjectDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    groupId: row.groupId,
    stableKey: row.stableKey,
    legacyCode: row.legacyCode,
    name: row.name,
    color: row.color,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    legacyScope: false,
  };
}

export function isSubjectMergeUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function isSubjectMergeSerializationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "P2034"
    || (typeof candidate.message === "string" && /(?:40001|40P01|deadlock)/i.test(candidate.message));
}
