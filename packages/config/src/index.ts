import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : value === "true"));

const intFromString = z
  .union([z.number().int(), z.string()])
  .transform((value) => (typeof value === "number" ? value : Number.parseInt(value, 10)));

export const serverEnvSchema = z.object({
  APP_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://127.0.0.1:3000"),
  APP_VERSION: z.string().default("0.1.0"),
  DATABASE_URL: z.string().min(1),
  AUTH_SESSION_COOKIE_NAME: z.string().default("af_session"),
  AUTH_SESSION_SECRET: z.string().min(32),
  AUTH_ADMIN_EMAIL: z.string().email().optional(),
  AUTH_ADMIN_PASSWORD_HASH: z.string().optional(),
  AI_ENABLED: booleanFromString.default(false),
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: intFromString.default(30000),
  AI_MAX_RETRIES: intFromString.default(2),
  AI_LOG_PROMPTS: booleanFromString.default(false),
  AI_ALLOW_SENSITIVE_CONTEXT: booleanFromString.default(false),
  AI_PAYLOAD_BINDING_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.length >= 32 ? value : undefined),
    z.string().min(32).optional(),
  ),
  UPLOAD_DIR: z.string().default("/app/uploads"),
  MAX_UPLOAD_MB: intFromString.default(20),
  ALLOWED_UPLOAD_MIME: z.string().default("image/png,image/jpeg,image/webp,application/pdf"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(env: NodeJS.ProcessEnv): ServerEnv {
  return serverEnvSchema.parse(env);
}
