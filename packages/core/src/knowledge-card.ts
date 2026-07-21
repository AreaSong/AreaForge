export const NOTE_KINDS = ["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export function isNoteKind(value: string): value is NoteKind {
  return (NOTE_KINDS as readonly string[]).includes(value);
}

export function normalizeRelatedNodeIds(input: {
  primaryNodeId: string | null | undefined;
  relatedNodeIds: string[];
  nodeSubjectIds: Record<string, string>;
  taskSubjectId: string;
}): { ok: true; relatedNodeIds: string[] } | { ok: false; reason: "primary_subject_mismatch" | "related_subject_mismatch" } {
  const uniqueRelated = Array.from(new Set(input.relatedNodeIds.filter(Boolean)));
  if (input.primaryNodeId) {
    const primarySubject = input.nodeSubjectIds[input.primaryNodeId];
    if (!primarySubject || primarySubject !== input.taskSubjectId) {
      return { ok: false, reason: "primary_subject_mismatch" };
    }
  }

  for (const nodeId of uniqueRelated) {
    if (nodeId === input.primaryNodeId) continue;
    const subjectId = input.nodeSubjectIds[nodeId];
    if (!subjectId || subjectId !== input.taskSubjectId) {
      return { ok: false, reason: "related_subject_mismatch" };
    }
  }

  return {
    ok: true,
    relatedNodeIds: uniqueRelated.filter((nodeId) => nodeId !== input.primaryNodeId),
  };
}
