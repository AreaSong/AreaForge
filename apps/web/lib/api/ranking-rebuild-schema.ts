import { z } from "zod";
import { dataJobStatuses } from "@areaforge/core";

/** API parser 校验回执；contracts 目录保持纯类型，不能用2xx替代完整任务身份。 */
export const rankingRebuildJobViewSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/), status: z.enum(dataJobStatuses), revision: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1), attempt: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(),
  errorCode: z.string().regex(/^[A-Z0-9_.:-]{1,80}$/).nullable(), retryable: z.boolean(), pauseRequested: z.boolean(),
  deadLettered: z.boolean(), nextAttemptAt: z.string().datetime().nullable(), createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(), dataCutoff: z.string().datetime(), controls: z.array(z.enum(["PAUSE", "RESUME", "CANCEL", "REPLAY"])),
}).strict();
