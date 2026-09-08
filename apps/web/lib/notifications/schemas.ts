import { z } from "zod";

export const userNotificationActionSchema = z.object({
  action: z.enum(["read", "unread", "dismiss", "restore"]),
  expectedRevision: z.number().int().positive(),
}).strict();
