import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type BackupRestorePreviewRecord = {
  content: string;
  displayPath: string;
};

export type BackupRestorePreviewSourceInputs = {
  schemaVersion: 1;
  packageVersion: string;
  packageJsonHash: string;
  implementationHash: string;
  releaseRecordPath: string;
  releaseRecordHash: string;
  restoreDrillRecordPath: string | null;
  restoreDrillRecordHash: string | null;
  sourceSetHash: string;
};

export type BackupRestorePreviewSources = {
  packageJson: Record<string, unknown>;
  releaseRecord: BackupRestorePreviewRecord;
  restoreRecord: BackupRestorePreviewRecord | null;
  sourceInputs: BackupRestorePreviewSourceInputs;
};

export const defaultBackupPreviewReleaseRecord = "docs/development/release-v0.1.7-record.md";

const maxRecordBytes = 2 * 1024 * 1024;
const allowedRecordExtensions = new Set([".md", ".txt", ".json"]);
const implementationFiles = [
  "scripts/ops/backup-restore-preview.ts",
  "scripts/quality/backup-restore-preview-source.ts",
  "scripts/quality/backup-restore-preview-validate.ts",
];

export function collectBackupRestorePreviewSources(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): BackupRestorePreviewSources {
  const projectRoot = realpathSync(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const packageBytes = readRegularFileNoFollow(path.join(projectRoot, "package.json"), "package.json");
  const packageJson = JSON.parse(packageBytes.toString("utf8")) as Record<string, unknown>;
  const packageVersion = packageJson.version;
  if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    throw new Error("package.json version must be semver");
  }
  const releaseRecordPath = env.AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD ?? defaultBackupPreviewReleaseRecord;
  const restoreDrillRecordPath = env.AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD?.trim() || null;
  const releaseRecord = readAllowedRecord(releaseRecordPath, "release record", projectRoot);
  const restoreRecord = restoreDrillRecordPath
    ? readAllowedRecord(restoreDrillRecordPath, "restore drill record", projectRoot)
    : null;
  const base = {
    schemaVersion: 1 as const,
    packageVersion,
    packageJsonHash: `sha256:${sha256(packageBytes)}`,
    implementationHash: `sha256:${hashImplementation(projectRoot)}`,
    releaseRecordPath: releaseRecord.displayPath,
    releaseRecordHash: `sha256:${sha256(releaseRecord.content)}`,
    restoreDrillRecordPath: restoreRecord?.displayPath ?? null,
    restoreDrillRecordHash: restoreRecord ? `sha256:${sha256(restoreRecord.content)}` : null,
  };
  return {
    packageJson,
    releaseRecord,
    restoreRecord,
    sourceInputs: {
      ...base,
      sourceSetHash: `sha256:${sha256(stableStringify({ domain: "areaforge.backup-restore-preview.sources.v1", ...base }))}`,
    },
  };
}

function readAllowedRecord(file: string, purpose: string, projectRoot: string): BackupRestorePreviewRecord {
  const resolved = path.resolve(projectRoot, file);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(resolved);
  } catch {
    throw new Error(`${purpose} not found or not readable`);
  }
  if (stats.isSymbolicLink()) throw new Error(`${purpose} must not be a symlink`);
  const realPath = realpathSync(resolved);
  if (!isInsideOrEqual(projectRoot, realPath) && !isInsideOrEqual(path.resolve(tmpdir()), realPath)) {
    throw new Error(`${purpose} must be under the workspace or system temp directory`);
  }
  const content = readRegularFileNoFollow(realPath, purpose, maxRecordBytes).toString("utf8");
  assertAllowedRecordName(realPath, purpose);
  if (containsSensitiveRecordContent(content)) {
    throw new Error(`${purpose} contains sensitive-looking values; use a redacted record`);
  }
  return { content, displayPath: displayPath(realPath, projectRoot) };
}

function assertAllowedRecordName(realPath: string, purpose: string): void {
  const lowerPath = realPath.replaceAll(path.sep, "/").toLowerCase();
  const baseName = path.basename(realPath).toLowerCase();
  const extension = path.extname(baseName);
  const forbiddenPathTerms = ["/.git/", "/node_modules/", "/.next/", "/apps/web/public/", "/public/", "/uploads/", "/backups/"];
  if (!allowedRecordExtensions.has(extension) || forbiddenPathTerms.some((term) => lowerPath.includes(term))) {
    throw new Error(`${purpose} path is not an allowed redacted record file`);
  }
  const forbiddenNamePatterns = [
    /^\.env(?:\.|$)/,
    /^updater\.env$/,
    /password/,
    /secret/,
    /token/,
    /^id_(?:rsa|ed25519)$/,
    /cosign.*\.(?:key|pem)$/,
  ];
  const forbiddenExtensions = [".dump", ".sql", ".sqlite", ".db", ".tar", ".gz", ".tgz", ".zip", ".7z", ".pem", ".key", ".p12", ".pfx", ".log"];
  if (forbiddenNamePatterns.some((pattern) => pattern.test(baseName)) || forbiddenExtensions.some((item) => lowerPath.endsWith(item))) {
    throw new Error(`${purpose} path is not an allowed redacted record file`);
  }
}

function containsSensitiveRecordContent(content: string): boolean {
  return [
    /\bDATABASE_URL\s*=/i,
    /\bpostgres(?:ql)?:\/\/[^\s]+/i,
    /\b(?:AI_API_KEY|OPENAI_API_KEY|AUTH_SESSION_SECRET|POSTGRES_PASSWORD|GITHUB_TOKEN|COSIGN_PASSWORD|PRIVATE_KEY)\s*[:=]/i,
    /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/,
  ].some((pattern) => pattern.test(content));
}

function hashImplementation(projectRoot: string): string {
  const files = implementationFiles.map((relativePath) => ({
    path: relativePath,
    sha256: sha256(readRegularFileNoFollow(path.join(projectRoot, relativePath), path.basename(relativePath))),
  }));
  return sha256(stableStringify({ domain: "areaforge.backup-restore-preview.implementation.v1", files }));
}

function readRegularFileNoFollow(file: string, purpose: string, maxBytes?: number): Buffer {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error(`${purpose} must be a regular file`);
    if (maxBytes !== undefined && stats.size > maxBytes) throw new Error(`${purpose} is too large for a metadata-only redacted record`);
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(purpose)) throw error;
    throw new Error(`${purpose} not found, unsafe, or unreadable`);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function displayPath(realPath: string, projectRoot: string): string {
  if (isInsideOrEqual(projectRoot, realPath)) return path.relative(projectRoot, realPath) || ".";
  const tempRoot = path.resolve(tmpdir());
  if (isInsideOrEqual(tempRoot, realPath)) return path.join("<tmp>", path.relative(tempRoot, realPath));
  return "<redacted-record>";
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
