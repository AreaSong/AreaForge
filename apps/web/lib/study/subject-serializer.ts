import type { SubjectDto } from "@/lib/contracts";

export interface SerializableSubjectRecord {
  id: string;
  legacyCode: string | null;
  stableKey: string;
  workspaceId: string | null;
  groupId: string | null;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt?: Date | null;
}

export function serializeSubject(subject: SerializableSubjectRecord): SubjectDto {
  return {
    id: subject.id,
    code: subject.legacyCode ?? subject.stableKey,
    legacyCode: subject.legacyCode,
    stableKey: subject.stableKey,
    workspaceId: subject.workspaceId,
    groupId: subject.groupId,
    name: subject.name,
    color: subject.color,
    sortOrder: subject.sortOrder,
    archivedAt: subject.archivedAt?.toISOString() ?? null,
    legacyScope: subject.workspaceId === null,
  };
}
