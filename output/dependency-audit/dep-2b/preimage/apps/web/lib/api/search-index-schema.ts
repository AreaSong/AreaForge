import { z } from "zod";

export const searchIndexJobSchema = z.object({
  id: z.string().min(1), status: z.enum(["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]),
  revision: z.number().int().nonnegative(), generation: z.number().int().positive(), progress: z.number().min(0).max(1),
  attempt: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(), retryable: z.boolean(), pauseRequested: z.boolean(),
  deadLettered: z.boolean(), errorCode: z.string().max(120).nullable(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  nextAttemptAt: z.string().datetime().nullable(), controls: z.array(z.enum(["PAUSE", "RESUME", "CANCEL", "REPLAY"])),
}).strict().refine(job => job.attempt <= job.maxAttempts && new Set(job.controls).size === job.controls.length);
export const searchIndexStatusSchema = z.object({ workspaceId: z.string().min(1), enabled: z.boolean(), generation: z.number().int().nonnegative(),
  index: z.object({ state: z.enum(["CURRENT", "STALE"]), indexedAt: z.string().datetime().nullable(), documentCount: z.number().int().min(0).max(10000) }).strict()
    .refine(index => index.state === "CURRENT" ? index.indexedAt !== null : index.indexedAt === null && index.documentCount === 0).nullable(),
  jobs: z.array(searchIndexJobSchema).max(10),
}).strict();
export type SearchIndexStatus = z.infer<typeof searchIndexStatusSchema>;
