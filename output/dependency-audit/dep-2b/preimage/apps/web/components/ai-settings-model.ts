import type { AiProviderPreferenceDto } from "@/lib/contracts/ai";
import type { AiProviderCredentialStatus, AiRuntimeSettingStatus } from "@/lib/contracts";

export function providerSourceLabel(source: AiProviderCredentialStatus["source"]): string {
  if (source === "account") return "当前账户";
  if (source === "environment") return "部署环境回退";
  return "未配置";
}

export function isAiRuntimeSettingStatus(value: unknown): value is AiRuntimeSettingStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<AiRuntimeSettingStatus>;
  return typeof status.webEnabled === "boolean"
    && typeof status.serverEnabled === "boolean"
    && typeof status.effectiveEnabled === "boolean"
    && typeof status.revision === "number"
    && (status.updatedAt === null || typeof status.updatedAt === "string");
}

export function isAiProviderCredentialStatus(value: unknown): value is AiProviderCredentialStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<AiProviderCredentialStatus>;
  return typeof status.accountConfigured === "boolean"
    && typeof status.effectiveConfigured === "boolean"
    && (status.source === "account" || status.source === "environment" || status.source === "none")
    && (status.baseUrl === null || typeof status.baseUrl === "string")
    && (status.model === null || typeof status.model === "string")
    && typeof status.apiKeyConfigured === "boolean"
    && typeof status.encryptionConfigured === "boolean"
    && typeof status.globalEnabled === "boolean";
}

export function isAiProviderPreference(value: unknown): value is AiProviderPreferenceDto {
  if (!value || typeof value !== "object") return false;
  const preference = value as Partial<AiProviderPreferenceDto>;
  return typeof preference.externalProviderEnabled === "boolean"
    && preference.scope === "current_browser";
}
