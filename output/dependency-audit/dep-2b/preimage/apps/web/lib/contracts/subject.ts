export interface SubjectDto {
  id: string;
  /** Dual-read: legacy enum code when present, otherwise stableKey. */
  code: string;
  legacyCode: string | null;
  stableKey: string;
  workspaceId: string | null;
  groupId: string | null;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: string | null;
  legacyScope: boolean;
}
