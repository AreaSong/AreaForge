import { readFileSync } from "node:fs";
import { PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA } from "./product-experience-contract";
import {
  validateStoredRuntimeIdentity,
  type RuntimeIdentity,
  type StoredRuntimeIdentity,
} from "./runtime-identity-core";

export * from "./runtime-identity-core";

const DEVELOPMENT_IDENTITY_ENV = "AREAFORGE_DEVELOPMENT_RUNTIME_IDENTITY_JSON";
const PRODUCTION_IDENTITY_FILE = "/app/runtime-identity.json";

export function getRuntimeIdentity(now = new Date(), configuredDevelopmentIdentity?: unknown): RuntimeIdentity {
  try {
    const stored = process.env.NODE_ENV === "production"
      ? readStoredProductionIdentity()
      : readStoredDevelopmentIdentity(configuredDevelopmentIdentity);
    if (process.env.APP_VERSION && process.env.APP_VERSION !== stored.appVersion) {
      throw new Error("runtime APP_VERSION does not match immutable identity");
    }
    return { ...stored, observedAt: now.toISOString(), reasonCode: "NONE" };
  } catch {
    return {
      schemaVersion: 1,
      status: "unavailable",
      appVersion: safeAppVersion(),
      gitCommit: "0".repeat(40),
      sourceFingerprintSchema: PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
      productExperienceSourceHash: `sha256:${"0".repeat(64)}`,
      buildId: `sha256:${"0".repeat(64)}`,
      runtimeMode: process.env.NODE_ENV === "production" ? "production-build" : "development",
      identityHash: `sha256:${"0".repeat(64)}`,
      observedAt: now.toISOString(),
      reasonCode: "RUNTIME_IDENTITY_INVALID",
    };
  }
}

function readStoredProductionIdentity(): StoredRuntimeIdentity {
  const stored = validateStoredRuntimeIdentity(JSON.parse(readFileSync(PRODUCTION_IDENTITY_FILE, "utf8")) as unknown);
  if (stored.runtimeMode !== "production-build") throw new Error("production runtime identity mode is invalid");
  return stored;
}

function readStoredDevelopmentIdentity(configured: unknown): StoredRuntimeIdentity {
  const raw = configured ?? process.env[DEVELOPMENT_IDENTITY_ENV];
  const value = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  const stored = validateStoredRuntimeIdentity(value);
  if (stored.runtimeMode !== "development") throw new Error("development runtime identity mode is invalid");
  return stored;
}

function safeAppVersion(): string {
  const value = process.env.APP_VERSION ?? "0.1.0";
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) ? value : "0.1.0";
}
