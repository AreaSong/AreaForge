import { prisma } from "@areaforge/db";
import { getAuthEnv } from "@/lib/auth/env";
import { ApiError } from "@/lib/api/responses";
import {
  AiProviderCredentialCryptoError,
  decryptAiProviderApiKey,
  encryptAiProviderApiKey,
  fingerprintAiProviderApiKey,
  isAiProviderCredentialEncryptionConfigured,
} from "./ai-provider-credential-crypto";

export type AiProviderCredentialSource = "account" | "environment" | "none";

export interface AiProviderCredentialStatus {
  accountConfigured: boolean;
  effectiveConfigured: boolean;
  source: AiProviderCredentialSource;
  baseUrl: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  encryptionConfigured: boolean;
  globalEnabled: boolean;
  revision: number | null;
  updatedAt: string | null;
}

export interface EffectiveAiProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  source: Exclude<AiProviderCredentialSource, "none">;
}

export interface AiProviderCredentialInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  expectedRevision?: number;
}

const maxBaseUrlLength = 2048;
const maxModelLength = 200;
const maxApiKeyLength = 4096;

export async function getAiProviderCredentialStatus(userId: string): Promise<AiProviderCredentialStatus> {
  const [credential] = await Promise.all([
    prisma.aiProviderCredential.findUnique({
      where: { userId },
      select: { baseUrl: true, model: true, apiKeyCiphertext: true, revision: true, updatedAt: true },
    }),
  ]);
  const env = getAuthEnv();
  const encryptionConfigured = isAiProviderCredentialEncryptionConfigured();
  const environmentConfigured = Boolean(
    env.AI_BASE_URL
    && env.AI_API_KEY
    && env.AI_MODEL
    && tryValidateAiProviderBaseUrl(env.AI_BASE_URL),
  );
  const accountConfigured = Boolean(credential);
  const accountUsable = accountConfigured && encryptionConfigured && canDecryptCredential(credential?.apiKeyCiphertext);
  const source: AiProviderCredentialSource = accountConfigured
    ? "account"
    : environmentConfigured
      ? "environment"
      : "none";
  const effectiveConfigured = accountConfigured
    ? Boolean(credential?.baseUrl && credential.model && accountUsable)
    : environmentConfigured;

  return {
    accountConfigured,
    effectiveConfigured,
    source,
    baseUrl: credential?.baseUrl ?? env.AI_BASE_URL ?? null,
    model: credential?.model ?? env.AI_MODEL ?? null,
    apiKeyConfigured: accountConfigured ? Boolean(credential?.apiKeyCiphertext) : Boolean(env.AI_API_KEY),
    encryptionConfigured,
    globalEnabled: env.AI_ENABLED,
    revision: credential?.revision ?? null,
    updatedAt: credential?.updatedAt?.toISOString() ?? null,
  };
}

export async function loadEffectiveAiProviderConfig(
  userId: string,
): Promise<{ config?: EffectiveAiProviderConfig; unavailableReason?: string }> {
  const credential = await prisma.aiProviderCredential.findUnique({
    where: { userId },
    select: { baseUrl: true, model: true, apiKeyCiphertext: true },
  });

  if (credential) {
    const baseUrl = tryValidateAiProviderBaseUrl(credential.baseUrl);
    if (!baseUrl) return { unavailableReason: "账户 Provider 地址无效，请重新保存配置。" };
    if (!isAiProviderCredentialEncryptionConfigured()) {
      return { unavailableReason: "账户 Provider 配置已保存，但服务端加密主密钥未配置。" };
    }

    try {
      const apiKey = decryptAiProviderApiKey(credential.apiKeyCiphertext);
      return {
        config: {
          baseUrl,
          model: credential.model,
          apiKey,
          source: "account",
        },
      };
    } catch (error) {
      const reason = error instanceof AiProviderCredentialCryptoError ? error.reason : "decrypt_failed";
      console.warn("AI provider credential unavailable", { reason });
      return { unavailableReason: "账户 Provider 配置无法解密，请重新保存配置。" };
    }
  }

  const env = getAuthEnv();
  const baseUrl = env.AI_BASE_URL ? tryValidateAiProviderBaseUrl(env.AI_BASE_URL) : null;
  if (baseUrl && env.AI_API_KEY && env.AI_MODEL) {
    return {
      config: {
        baseUrl,
        model: env.AI_MODEL,
        apiKey: env.AI_API_KEY,
        source: "environment",
      },
    };
  }

  return { unavailableReason: "AI provider 配置缺失，已回退本地规则建议。" };
}

export async function saveAiProviderCredential(
  userId: string,
  input: AiProviderCredentialInput,
): Promise<AiProviderCredentialStatus> {
  const baseUrl = validateAiProviderBaseUrl(input.baseUrl);
  const model = normalizeModel(input.model);
  const apiKey = normalizeApiKey(input.apiKey);
  const encryptionConfigured = isAiProviderCredentialEncryptionConfigured();
  if (!encryptionConfigured) throw new ApiError("AI_PROVIDER_ENCRYPTION_NOT_CONFIGURED", 503);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.aiProviderCredential.findUnique({ where: { userId } });
    if (existing && input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) {
      throw new ApiError("AI_PROVIDER_CREDENTIAL_CONFLICT", 409);
    }
    if (!existing && apiKey === undefined) {
      throw new ApiError("AI_PROVIDER_API_KEY_REQUIRED", 400);
    }

    const next = existing
      ? await tx.aiProviderCredential.update({
        where: { id: existing.id },
        data: {
          baseUrl,
          model,
          ...(apiKey === undefined
            ? {}
            : {
              apiKeyCiphertext: encryptAiProviderApiKey(apiKey),
              apiKeyFingerprint: fingerprintAiProviderApiKey(apiKey),
            }),
          revision: { increment: 1 },
        },
      })
      : await tx.aiProviderCredential.create({
        data: {
          userId,
          baseUrl,
          model,
          apiKeyCiphertext: encryptAiProviderApiKey(apiKey as string),
          apiKeyFingerprint: fingerprintAiProviderApiKey(apiKey as string),
        },
      });

    await tx.auditEvent.create({
      data: {
        actorId: userId,
        action: existing ? "AI_PROVIDER_CREDENTIAL_UPDATED" : "AI_PROVIDER_CREDENTIAL_CREATED",
        entityType: "AiProviderCredential",
        entityId: next.id,
        metadata: { status: "success" },
      },
    });
    return next;
  });

  return getAiProviderCredentialStatus(userId).then((status) => ({
    ...status,
    accountConfigured: true,
    effectiveConfigured: true,
    source: "account",
    baseUrl: result.baseUrl,
    model: result.model,
    apiKeyConfigured: true,
    encryptionConfigured: true,
    revision: result.revision,
    updatedAt: result.updatedAt.toISOString(),
  }));
}

export async function deleteAiProviderCredential(userId: string): Promise<AiProviderCredentialStatus> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.aiProviderCredential.findUnique({ where: { userId }, select: { id: true } });
    if (!existing) return;
    await tx.aiProviderCredential.delete({ where: { id: existing.id } });
    await tx.auditEvent.create({
      data: {
        actorId: userId,
        action: "AI_PROVIDER_CREDENTIAL_DELETED",
        entityType: "AiProviderCredential",
        entityId: existing.id,
        metadata: { status: "success" },
      },
    });
  });
  return getAiProviderCredentialStatus(userId);
}

export async function recordAiProviderTest(
  userId: string,
  status: "success" | "failed" | "blocked",
): Promise<void> {
  const credential = await prisma.aiProviderCredential.findUnique({
    where: { userId },
    select: { id: true },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: userId,
      action: "AI_PROVIDER_CONNECTION_TESTED",
      entityType: "AiProviderCredential",
      entityId: credential?.id,
      metadata: { status },
    },
  });
}

export function validateAiProviderBaseUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxBaseUrlLength) {
    throw new ApiError("AI_PROVIDER_BASE_URL_INVALID", 400);
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ApiError("AI_PROVIDER_BASE_URL_INVALID", 400);
  }

  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) {
    throw new ApiError("AI_PROVIDER_BASE_URL_INVALID", 400);
  }
  const strictEnvironment = isProductionEnvironment();
  if (strictEnvironment && url.protocol !== "https:") {
    throw new ApiError("AI_PROVIDER_BASE_URL_HTTPS_REQUIRED", 400);
  }
  if (isBlockedProviderHost(url.hostname, strictEnvironment)) {
    throw new ApiError("AI_PROVIDER_BASE_URL_PRIVATE_HOST", 400);
  }

  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function tryValidateAiProviderBaseUrl(value: string): string | null {
  try {
    return validateAiProviderBaseUrl(value);
  } catch {
    return null;
  }
}

function normalizeModel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxModelLength) {
    throw new ApiError("AI_PROVIDER_MODEL_INVALID", 400);
  }
  return normalized;
}

function normalizeApiKey(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim();
  if (normalized.length > maxApiKeyLength) throw new ApiError("AI_PROVIDER_API_KEY_INVALID", 400);
  return normalized;
}

function isBlockedProviderHost(hostname: string, strict: boolean): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "metadata.google.internal" || host === "169.254.169.254") return true;
  if (!strict) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1") return true;
  if (host.includes(":")) {
    return host.startsWith("fc")
      || host.startsWith("fd")
      || host.startsWith("fe8")
      || host.startsWith("fe9")
      || host.startsWith("fea")
      || host.startsWith("feb")
      || host.startsWith("::ffff:");
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) return strict;
  const octets = host.split(".").map((part) => Number(part));
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = octets;
    if (
      a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
    ) {
      return true;
    }
  }
  return false;
}

function canDecryptCredential(ciphertext: string | undefined): boolean {
  if (!ciphertext) return false;
  try {
    decryptAiProviderApiKey(ciphertext);
    return true;
  } catch {
    return false;
  }
}

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
}
