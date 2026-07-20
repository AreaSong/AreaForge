import {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  canonicalSha256,
} from "./product-experience-contract";

export interface RuntimeIdentityProjection {
  appVersion: string;
  gitCommit: string;
  sourceFingerprintSchema: string;
  productExperienceSourceHash: string;
  buildId: string;
  runtimeMode: "development" | "production-build";
}

export interface StoredRuntimeIdentity extends RuntimeIdentityProjection {
  schemaVersion: 1;
  status: "verified";
  identityHash: string;
}

export interface RuntimeIdentity extends Omit<StoredRuntimeIdentity, "status"> {
  status: "verified" | "unavailable";
  observedAt: string;
  reasonCode: "NONE" | "RUNTIME_IDENTITY_INVALID";
}

export function createStoredRuntimeIdentity(projection: RuntimeIdentityProjection): StoredRuntimeIdentity {
  validateProjection(projection);
  return {
    schemaVersion: 1,
    status: "verified",
    ...projection,
    identityHash: runtimeIdentityHash(projection),
  };
}

export function validateStoredRuntimeIdentity(value: unknown): StoredRuntimeIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("runtime identity must be an object");
  const record = value as Record<string, unknown>;
  const expectedKeys = ["appVersion", "buildId", "gitCommit", "identityHash", "productExperienceSourceHash", "runtimeMode", "schemaVersion", "sourceFingerprintSchema", "status"].sort();
  if (Object.keys(record).sort().join(",") !== expectedKeys.join(",")) throw new Error("runtime identity fields are not exact");
  if (record.schemaVersion !== 1 || record.status !== "verified") throw new Error("runtime identity must be verified schema V1");
  const projection = projectionFromRecord(record);
  validateProjection(projection);
  if (record.identityHash !== runtimeIdentityHash(projection)) throw new Error("runtime identity hash mismatch");
  return record as unknown as StoredRuntimeIdentity;
}

export function validateRuntimeIdentity(value: unknown): RuntimeIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("runtime identity must be an object");
  const record = value as Record<string, unknown>;
  const expectedKeys = ["appVersion", "buildId", "gitCommit", "identityHash", "observedAt", "productExperienceSourceHash", "reasonCode", "runtimeMode", "schemaVersion", "sourceFingerprintSchema", "status"].sort();
  if (Object.keys(record).sort().join(",") !== expectedKeys.join(",")) throw new Error("runtime identity response fields are not exact");
  if (record.status !== "verified" || record.reasonCode !== "NONE") throw new Error("runtime identity response is unavailable");
  if (typeof record.observedAt !== "string" || Number.isNaN(Date.parse(record.observedAt))) throw new Error("runtime identity observedAt is invalid");
  validateStoredRuntimeIdentity(Object.fromEntries(Object.entries(record).filter(([key]) => !["observedAt", "reasonCode"].includes(key))));
  return record as unknown as RuntimeIdentity;
}

export function runtimeIdentityHash(projection: RuntimeIdentityProjection): string {
  return canonicalSha256({ domain: "areaforge.runtime-identity.v1", ...projection });
}

function projectionFromRecord(value: Record<string, unknown>): RuntimeIdentityProjection {
  return {
    appVersion: String(value.appVersion ?? ""),
    gitCommit: String(value.gitCommit ?? ""),
    sourceFingerprintSchema: String(value.sourceFingerprintSchema ?? ""),
    productExperienceSourceHash: String(value.productExperienceSourceHash ?? ""),
    buildId: String(value.buildId ?? ""),
    runtimeMode: value.runtimeMode as RuntimeIdentityProjection["runtimeMode"],
  };
}

function validateProjection(value: RuntimeIdentityProjection): void {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.appVersion)) throw new Error("runtime identity appVersion is invalid");
  if (!/^[a-f0-9]{40}$/.test(value.gitCommit) || /^0+$/.test(value.gitCommit)) throw new Error("runtime identity gitCommit is invalid");
  if (value.sourceFingerprintSchema !== PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA) throw new Error("runtime identity source schema is invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(value.productExperienceSourceHash) || /^sha256:0+$/.test(value.productExperienceSourceHash)) throw new Error("runtime identity source hash is invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(value.buildId) || /^sha256:0+$/.test(value.buildId)) throw new Error("runtime identity buildId is invalid");
  if (value.runtimeMode !== "development" && value.runtimeMode !== "production-build") throw new Error("runtime identity mode is invalid");
}
