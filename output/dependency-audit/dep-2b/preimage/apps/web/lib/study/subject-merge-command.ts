import { z } from "zod";

export const subjectMergeConfirmSchema = z.object({
  targetSubjectId: z.string().trim().min(1).max(200),
  sourceSubjectIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  snapshotHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  expectedWorkspaceRevision: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirm: z.literal(true),
}).strict().superRefine((value, context) => {
  const normalized = value.sourceSubjectIds.map((id) => id.trim());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({
      code: "custom",
      path: ["sourceSubjectIds"],
      message: "sourceSubjectIds must not contain duplicates",
    });
  }
  if (normalized.includes(value.targetSubjectId.trim())) {
    context.addIssue({
      code: "custom",
      path: ["sourceSubjectIds"],
      message: "targetSubjectId must not be included in sourceSubjectIds",
    });
  }
});

export type SubjectMergeConfirmCommand = z.infer<typeof subjectMergeConfirmSchema>;

export const subjectMergeUndoSchema = z.object({
  expectedWorkspaceRevision: z.number().int().positive(),
  undoSnapshotHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirm: z.literal(true),
}).strict();

export type SubjectMergeUndoCommand = z.infer<typeof subjectMergeUndoSchema>;
