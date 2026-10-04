import { hashDataExportBytes } from "./data-lifecycle";
import { stableStringify } from "./ai-draft";

export type StorageQuotaEnvironment = Readonly<Record<string, string | undefined>>;
export const STORAGE_QUOTA_MAX_BYTES = BigInt("9007199254740991");
export type WorkspaceStorageQuotaErrorCode = "WORKSPACE_STORAGE_QUOTA_LIMIT" | "WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID"
  | "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN" | "WORKSPACE_STORAGE_QUOTA_BUSY" | "WORKSPACE_STORAGE_QUOTA_ISOLATION_UNSUPPORTED";
export class WorkspaceStorageQuotaError extends Error {
  constructor(readonly code: WorkspaceStorageQuotaErrorCode) { super(code); this.name = "WorkspaceStorageQuotaError"; }
}
export interface WorkspaceStorageQuotaPolicy { maxBytes: bigint }
export interface StorageReleaseIdentity {
  id: string; ownerUserId: string; storageWorkspaceId: string | null; storedName: string; uri: string;
  hash: string; sizeBytes: number; protocolVersion: number;
}
export interface StorageReleaseRecord extends StorageReleaseIdentity {
  status: string; stagingName: string | null; storageReleasedAt: Date | string | null; storageReleaseProof: string | null;
}

export function readWorkspaceStorageQuotaPolicy(env: StorageQuotaEnvironment): WorkspaceStorageQuotaPolicy | null {
  const enabled = env.WORKSPACE_STORAGE_QUOTA_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  const raw = env.WORKSPACE_STORAGE_QUOTA_MAX_BYTES;
  if (enabled !== "true" || raw === undefined || !/^(0|[1-9]\d{0,15})$/.test(raw)) {
    throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID");
  }
  const maxBytes = BigInt(raw);
  if (maxBytes > STORAGE_QUOTA_MAX_BYTES) throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID");
  return { maxBytes };
}

export function workspaceStorageQuotaRejection(policy: WorkspaceStorageQuotaPolicy, usedBytes: bigint, requestedBytes: number): WorkspaceStorageQuotaErrorCode | null {
  if (typeof policy.maxBytes !== "bigint" || policy.maxBytes < BigInt(0) || policy.maxBytes > STORAGE_QUOTA_MAX_BYTES) {
    return "WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID";
  }
  if (typeof usedBytes !== "bigint" || usedBytes < BigInt(0) || !Number.isSafeInteger(requestedBytes) || requestedBytes < 1 || requestedBytes > 2_147_483_647) {
    return "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN";
  }
  return usedBytes + BigInt(requestedBytes) > policy.maxBytes ? "WORKSPACE_STORAGE_QUOTA_LIMIT" : null;
}

/** 这是内部状态一致性证明，不是签名，也不能替代文件缺失和目录持久化检查。 */
export function storageReleaseProof(identity: StorageReleaseIdentity): string {
  if (![identity.id, identity.ownerUserId].every(validId) || (identity.storageWorkspaceId !== null && !validId(identity.storageWorkspaceId))
    || !/^[A-Za-z0-9_-]{16,}\.(png|jpg|webp|pdf|zip|md)$/.test(identity.storedName)
    || identity.uri !== "upload://attachment/" + identity.storedName || !/^[a-f0-9]{64}$/.test(identity.hash)
    || !Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes < 1 || identity.sizeBytes > 2_147_483_647
    || !Number.isInteger(identity.protocolVersion) || identity.protocolVersion < 0) unknown();
  return hashDataExportBytes(utf8(stableStringify({ protocol: "workspace-storage-release-v1", id: identity.id, ownerUserId: identity.ownerUserId,
    storageWorkspaceId: identity.storageWorkspaceId, storedName: identity.storedName, uri: identity.uri,
    hash: identity.hash, sizeBytes: identity.sizeBytes, protocolVersion: identity.protocolVersion })));
}

export function isVerifiedStorageRelease(row: StorageReleaseRecord): boolean {
  if (row.storageReleasedAt === null && row.storageReleaseProof === null) return false;
  if (row.storageReleasedAt === null || !Number.isFinite(new Date(row.storageReleasedAt).getTime())
    || row.status !== "FAILED" || row.stagingName !== null || row.storageReleaseProof !== storageReleaseProof(row)) unknown();
  return true;
}

function validId(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 191 && value.trim() === value; }
function unknown(): never { throw new WorkspaceStorageQuotaError("WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN"); }

// Core 只依赖 ES；保留原证明的 UTF-8 字节，不引入浏览器/Node API 或导出脱敏。
function utf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value); const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16)); index += 2;
    } else bytes.push(encoded.charCodeAt(index));
  }
  return Uint8Array.from(bytes);
}
