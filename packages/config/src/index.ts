import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : value === "true"));

const intFromString = z
  .union([z.number().int(), z.string()])
  .transform((value) => (typeof value === "number" ? value : Number(value)))
  .pipe(z.number().int());

const positiveIntFromString = intFromString.pipe(z.number().positive());
const portFromString = positiveIntFromString.pipe(z.number().max(65_535));

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const serverEnvSchema = z.object({
  APP_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://127.0.0.1:3000"),
  APP_VERSION: z.string().default("0.1.0"),
  DATABASE_URL: z.string().min(1),
  AUTH_SESSION_COOKIE_NAME: z.string().default("af_session"),
  AUTH_SESSION_SECRET: z.string().min(32),
  AUTH_ADMIN_EMAIL: z.string().email().optional(),
  AUTH_ADMIN_PASSWORD_HASH: z.string().optional(),
  AUTH_MULTI_USER_ENABLED: booleanFromString.default(false),
  AUTH_ACTION_TOKEN_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.length >= 32 ? value : undefined),
    z.string().min(32).optional(),
  ),
  AUTH_REAUTH_MAX_AGE_SECONDS: positiveIntFromString.default(600),
  AUTH_INVITATION_TTL_SECONDS: positiveIntFromString.default(259200),
  AUTH_EMAIL_VERIFICATION_TTL_SECONDS: positiveIntFromString.default(86400),
  AUTH_PASSWORD_RESET_TTL_SECONDS: positiveIntFromString.default(1800),
  SMTP_HOST: optionalNonEmptyString,
  SMTP_PORT: portFromString.default(587),
  SMTP_SECURE: booleanFromString.default(false),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASSWORD: optionalNonEmptyString,
  SMTP_FROM: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(3).optional(),
  ),
  AI_ENABLED: booleanFromString.default(false),
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: intFromString.default(30000),
  AI_MAX_RETRIES: intFromString.default(2),
  AI_LOG_PROMPTS: booleanFromString.default(false),
  AI_ALLOW_SENSITIVE_CONTEXT: booleanFromString.default(false),
  AI_CREDENTIALS_ENCRYPTION_KEY: z.preprocess(
    (value) => (typeof value === "string" && value.length >= 32 ? value : undefined),
    z.string().min(32).optional(),
  ),
  AI_PAYLOAD_BINDING_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.length >= 32 ? value : undefined),
    z.string().min(32).optional(),
  ),
  UPLOAD_DIR: z.string().default("/app/uploads"),
  MAX_UPLOAD_MB: intFromString.default(20),
  ALLOWED_UPLOAD_MIME: z.string().default("image/png,image/jpeg,image/webp,application/pdf"),
}).superRefine((env, context) => {
  if (env.AUTH_MULTI_USER_ENABLED && !env.AUTH_ACTION_TOKEN_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["AUTH_ACTION_TOKEN_SECRET"],
      message: "AUTH_ACTION_TOKEN_SECRET is required when multi-user auth is enabled",
    });
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    context.addIssue({
      code: "custom",
      path: [env.SMTP_USER ? "SMTP_PASSWORD" : "SMTP_USER"],
      message: "SMTP_USER and SMTP_PASSWORD must be configured together",
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(env: NodeJS.ProcessEnv): ServerEnv {
  return serverEnvSchema.parse(env);
}
