import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

export type OperationalEvidenceFileInput = {
  key: string;
  envKey: string;
  configured: boolean;
  pathLabel: string | null;
  fileKind: "missing" | "regular" | "symlink" | "other";
  sha256: string | null;
};

export type OperationalEvidenceSourceSnapshot = {
  schemaVersion: 1;
  packageVersion: string;
  packageJsonHash: string;
  implementationHash: string;
  configHash: string;
  fileInputs: OperationalEvidenceFileInput[];
  sourceSetHash: string;
};

const implementationFiles = [
  "scripts/ops/operational-evidence-bundle.ts",
  "scripts/ops/operational-readiness-summary.ts",
  "scripts/quality/operational-evidence-source.ts",
  "scripts/quality/operational-evidence-bundle-validate.ts",
];

const fileInputDefinitions = [
  ["updateStatus", "AREAFORGE_READINESS_UPDATE_STATUS_FILE"],
  ["releaseManifest", "AREAFORGE_READINESS_RELEASE_MANIFEST_FILE"],
  ["smokeResult", "AREAFORGE_READINESS_SMOKE_RESULT_FILE"],
  ["backupRestorePreview", "AREAFORGE_READINESS_BACKUP_RESTORE_PREVIEW_FILE"],
] as const;

const configKeys = [
  "APP_ENV",
  "APP_URL",
  "APP_VERSION",
  "AREAFORGE_HEALTH_URL",
  "AREAFORGE_READINESS_BACKUP_EVIDENCE",
  "AREAFORGE_READINESS_BACKUP_RESTORE_PREVIEW_FILE",
  "AREAFORGE_READINESS_BASE_URL",
  "AREAFORGE_READINESS_CERT_DAYS",
  "AREAFORGE_READINESS_DISK_STATUS",
  "AREAFORGE_READINESS_ENVIRONMENT",
  "AREAFORGE_READINESS_EXPECTED_AUTO_APPLY",
  "AREAFORGE_READINESS_EXPECTED_VERSION",
  "AREAFORGE_READINESS_FRESHNESS_MAX_AGE_SECONDS",
  "AREAFORGE_READINESS_GITHUB_REPO",
  "AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST",
  "AREAFORGE_READINESS_RELEASE_MANIFEST_FILE",
  "AREAFORGE_READINESS_RELEASE_MANIFEST_URL",
  "AREAFORGE_READINESS_RELEASE_TAG",
  "AREAFORGE_READINESS_SCOPE",
  "AREAFORGE_READINESS_SMOKE_RESULT_FILE",
  "AREAFORGE_READINESS_TIMEOUT_MS",
  "AREAFORGE_READINESS_UPDATE_STATUS_FILE",
  "AREAFORGE_READINESS_WEB_IMAGE_DIGEST",
  "AREAFORGE_SMOKE_BASE_URL",
  "AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY",
  "AREAFORGE_SMOKE_EXPECTED_VERSION",
] as const;

const presenceOnlyConfigKeys = [
  "AREAFORGE_SMOKE_EMAIL",
  "AREAFORGE_SMOKE_PASSWORD",
  "AREAFORGE_SMOKE_PASSWORD_FILE",
] as const;

export function buildOperationalEvidenceSourceSnapshot(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): OperationalEvidenceSourceSnapshot {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const packageJsonPath = path.join(cwd, "package.json");
  const packageJsonRaw = readRequiredRegularFile(packageJsonPath);
  const packageVersion = packageVersionFrom(packageJsonRaw);
  const packageJsonHash = sha256(packageJsonRaw);
  const implementationHash = hashImplementation(cwd);
  const configHash = sha256(stableStringify({
    domain: "areaforge.operational-evidence.config.v1",
    values: Object.fromEntries(configKeys.map((key) => [key, env[key] ?? null])),
    presence: Object.fromEntries(presenceOnlyConfigKeys.map((key) => [key, Boolean(env[key])])),
  }));
  const fileInputs = fileInputDefinitions.map(([key, envKey]) => inspectFileInput(key, envKey, env[envKey]));
  const base = {
    schemaVersion: 1 as const,
    packageVersion,
    packageJsonHash,
    implementationHash,
    configHash,
    fileInputs,
  };
  return {
    ...base,
    sourceSetHash: sha256(stableStringify({ domain: "areaforge.operational-evidence.sources.v1", ...base })),
  };
}

function inspectFileInput(key: string, envKey: string, configuredPath: string | undefined): OperationalEvidenceFileInput {
  const value = configuredPath?.trim();
  if (!value) {
    return { key, envKey, configured: false, pathLabel: null, fileKind: "missing", sha256: null };
  }
  const absolutePath = path.resolve(value);
  try {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      return { key, envKey, configured: true, pathLabel: path.basename(absolutePath), fileKind: "symlink", sha256: null };
    }
    if (!stat.isFile()) {
      return { key, envKey, configured: true, pathLabel: path.basename(absolutePath), fileKind: "other", sha256: null };
    }
    const bytes = readRegularFileNoFollow(absolutePath);
    if (!bytes) {
      return { key, envKey, configured: true, pathLabel: path.basename(absolutePath), fileKind: "other", sha256: null };
    }
    return {
      key,
      envKey,
      configured: true,
      pathLabel: path.basename(absolutePath),
      fileKind: "regular",
      sha256: sha256(bytes),
    };
  } catch {
    return { key, envKey, configured: true, pathLabel: path.basename(absolutePath), fileKind: "missing", sha256: null };
  }
}

function hashImplementation(cwd: string): string {
  const files = implementationFiles.map((relativePath) => ({
    path: relativePath,
    sha256: sha256(readRequiredRegularFile(path.join(cwd, relativePath))),
  }));
  return sha256(stableStringify({ domain: "areaforge.operational-evidence.implementation.v1", files }));
}

function readRequiredRegularFile(file: string): Buffer {
  const bytes = readRegularFileNoFollow(file);
  if (!bytes) throw new Error(`required source is missing or unsafe: ${path.basename(file)}`);
  return bytes;
}

function readRegularFileNoFollow(file: string): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) return null;
    return readFileSync(descriptor);
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function packageVersionFrom(raw: Buffer): string {
  const parsed = JSON.parse(raw.toString("utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    throw new Error("package.json version must be semver");
  }
  return parsed.version;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
