import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, openSync, readSync, closeSync, realpathSync, readdirSync } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { inflateSync } from "node:zlib";
import {
  containsV11SecretLikeText,
  isV11Commit,
  isV11Sha256,
  isV11Version,
  readV11PngDimensions,
  readV11SafeRepoFile,
  safeV11Error,
} from "./v11-browser-evidence-contract";
import { validateRuntimeIdentity, type RuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";

export const RESPONSIVE_SCHEMA = "responsive-layout-browser-matrix-v2" as const;
export const GOVERNANCE_SCHEMA = "web-governance-browser-interactions-v2" as const;

export const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 1000 },
] as const;

/** This is the route inventory consumed by the G8 browser runner. */
export const RESPONSIVE_ROUTES = [
  ["/", "/", "AreaForge"],
  ["/login", "/login", "登录"],
  ["/today", "/today", "今日行动中心"],
  ["/focus", "/focus", "开始学习"],
  ["/roadmap", "/roadmap", "路线总览"],
  ["/roadmap/allocation", "/roadmap/allocation", "投入安排"],
  ["/roadmap/allocation/drafts", "/roadmap/allocation/drafts", "投入草稿"],
  ["/roadmap/allocation/drafts/[itemId]", "/roadmap/allocation/drafts/test-inbox-open", "投入草稿详情"],
  ["/roadmap/allocation/tasks/[taskId]", "/roadmap/allocation/tasks/test-task-today", "行动详情"],
  ["/roadmap/stages", "/roadmap/stages", "阶段"],
  ["/roadmap/stages/trend", "/roadmap/stages/trend", "阶段趋势"],
  ["/roadmap/reviews", "/roadmap/reviews", "周期复盘"],
  ["/roadmap/reviews/daily", "/roadmap/reviews/daily", "每日复盘"],
  ["/roadmap/reviews/history/[decisionId]", "/roadmap/reviews/history/test-report-decision?period=week", "冻结报告"],
  ["/test", "/test", "检验中心"],
  ["/test/retests", "/test/retests", "专项复测"],
  ["/test/retests/new", "/test/retests/new", "安排专项复测"],
  ["/test/retests/[retestId]", "/test/retests/test-knowledge-retest", "专项复测详情"],
  ["/test/simulations", "/test/simulations", "模拟考试"],
  ["/test/simulations/[examId]", "/test/simulations/test-simulation", "模拟考试详情"],
  ["/confirmations", "/confirmations", "确认中心"],
  ["/confirmations/history", "/confirmations/history", "确认记录"],
  ["/confirmations/[confirmationId]", "/confirmations/test-stage-draft-pending", "确认事项详情"],
  ["/knowledge/reviews/[scheduleId]/run", "/knowledge/reviews/test-review-schedule/run", "快速复习"],
  ["/knowledge", "/knowledge", "知识工作台"],
  ["/knowledge/points", "/knowledge/points", "知识点"],
  ["/knowledge/points/[pointId]", "/knowledge/points/test-kp-derivative", "知识点详情"],
  ["/knowledge/canvas", "/knowledge/canvas", "关联画布"],
  ["/knowledge/imports", "/knowledge/imports", "学习树导入"],
  ["/knowledge/imports/[importId]", "/knowledge/imports/test-import-batch", "导入批次"],
  ["/knowledge/syllabi", "/knowledge/syllabi", "考纲"],
  ["/knowledge/syllabi/[nodeId]", "/knowledge/syllabi/test-node-derivative", "考纲节点详情"],
  ["/knowledge/cards", "/knowledge/cards", "知识卡片"],
  ["/knowledge/cards/[noteId]", "/knowledge/cards/test-note-limit", "知识卡片详情"],
  ["/knowledge/mistakes", "/knowledge/mistakes", "错题"],
  ["/knowledge/mistakes/practice", "/knowledge/mistakes/practice", "错题练习"],
  ["/knowledge/mistakes/[mistakeId]", "/knowledge/mistakes/test-mistake-english", "错题详情"],
  ["/knowledge/resources", "/knowledge/resources", "资料"],
  ["/knowledge/resources/[resourceId]/preview", "/knowledge/resources/test-resource-link/preview", "资料预览"],
  ["/knowledge/resources/[resourceId]", "/knowledge/resources/test-resource-link", "资料详情"],
  ["/knowledge/reviews", "/knowledge/reviews", "复习"],
  ["/knowledge/reviews/[scheduleId]", "/knowledge/reviews/test-review-schedule", "复习排期详情"],
  ["/settings", "/settings", "设置总览"],
  ["/settings/exams", "/settings/exams", "考试与科目"],
  ["/settings/profile", "/settings/profile", "个人与恢复"],
  ["/settings/learning", "/settings/learning", "学习与提醒"],
  ["/settings/ai", "/settings/ai", "AI 与隐私"],
  ["/settings/data", "/settings/data", "数据与安全"],
  ["/settings/system", "/settings/system", "系统与更新"],
] as const;

export const GOVERNANCE_SCENARIOS = [
  { id: "overlay-escape-focus", viewport: "820x1180", screenshot: "overlay-window-open.png" },
  { id: "draft-current", viewport: "390x844", screenshot: "resource-draft-current.png" },
  { id: "draft-stale", viewport: "390x844", screenshot: "resource-draft-stale.png" },
  { id: "draft-legacy", viewport: "390x844", screenshot: "resource-draft-legacy.png" },
  { id: "resource-409-input-retention", viewport: "390x844", screenshot: "resource-409-conflict.png" },
  { id: "ai-latest-wins", viewport: "820x1180", screenshot: "ai-latest-wins.png" },
  { id: "upload-batch-lock", viewport: "820x1180", screenshot: "upload-batch-pending-lock.png" },
] as const;

export const RESPONSIVE_DOES_NOT_PROVE = [
  "GitHub Release exists for this checkout",
  "production apply completed",
  "production health or production UX",
  "business mutation journeys",
] as const;

export const GOVERNANCE_DOES_NOT_PROVE = [
  "GitHub Release exists for this checkout",
  "production apply completed",
  "production health or production UX",
  "real AI provider behavior",
  "real upload persistence or attachment storage",
  "multi-device concurrency against a live server writer",
] as const;

export type JsonRecord = Record<string, unknown>;
export type G8Schema = typeof RESPONSIVE_SCHEMA | typeof GOVERNANCE_SCHEMA;
export type G8ValidationIssue = { field: string; message: string };
export type G8EvidenceBinding = {
  root: string;
  expectedCommit: string;
  expectedVersion: string;
  expectedSourceHash: string;
  validationTime?: number;
};
export type G8PoolEvidence = {
  slot: number;
  container: string;
  port: number;
  generation: number;
  url: string;
  status: "running";
  commit: string;
  sourceFingerprint: string;
  buildId: string;
  observedAt: string;
};
export type G8ScreenshotEvidence = {
  path: string;
  sha256: string;
  width: number;
  height: number;
};
export type G8ValidationResult = {
  valid: boolean;
  schemaVersion: G8Schema | null;
  itemCount: number;
  issues: G8ValidationIssue[];
  screenshots: G8ScreenshotEvidence[];
};
export type G8LoadedJson = {
  relativePath: string;
  sha256: string;
  bytes: Buffer;
  raw: string;
  value: JsonRecord | null;
};

export const G8_POOL_KEYS = [
  "slot", "container", "port", "generation", "url", "status", "commit", "sourceFingerprint",
  "buildId", "observedAt",
] as const;

export const MAX_G8_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const MAX_G8_SCREENSHOT_BYTES = 20 * 1024 * 1024;
export const MAX_G8_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_G8_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_G8_OBSERVATION_LEAD_MS = 2 * 60 * 60 * 1000;

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function exactKeys(value: JsonRecord, expected: readonly string[], field: string, issues: G8ValidationIssue[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    addIssue(issues, field, `keys must be exactly ${wanted.join(", ")}`);
  }
}

export function addIssue(issues: G8ValidationIssue[], field: string, message: string): void {
  if (issues.length < 300) issues.push({ field, message });
}

export function finishResult(
  schemaVersion: G8Schema | null,
  itemCount: number,
  issues: G8ValidationIssue[],
  screenshots: G8ScreenshotEvidence[] = [],
): G8ValidationResult {
  const unique = [...new Map(issues.map((item) => [`${item.field}\0${item.message}`, item])).values()];
  return { valid: unique.length === 0, schemaVersion, itemCount, issues: unique, screenshots };
}

export function parseIso(value: unknown): number | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function requireIso(value: unknown, field: string, issues: G8ValidationIssue[]): number | null {
  const parsed = parseIso(value);
  if (parsed === null) addIssue(issues, field, "must be an ISO-8601 timestamp with timezone");
  return parsed;
}

export function validateEvidenceTimestamp(
  value: unknown,
  binding: G8EvidenceBinding,
  issues: G8ValidationIssue[],
): number | null {
  const parsed = requireIso(value, "generatedAt", issues);
  if (parsed === null) return null;
  const now = binding.validationTime ?? Date.now();
  if (parsed > now + MAX_G8_CLOCK_SKEW_MS) addIssue(issues, "generatedAt", "must not be more than five minutes in the future");
  if (now - parsed > MAX_G8_EVIDENCE_AGE_MS) addIssue(issues, "generatedAt", "must be no more than 24 hours old");
  return parsed;
}

export function requireSha(value: unknown, field: string, issues: G8ValidationIssue[]): value is string {
  if (!isV11Sha256(value)) {
    addIssue(issues, field, "must be a non-zero sha256 digest");
    return false;
  }
  return true;
}

export function requireInteger(value: unknown, field: string, issues: G8ValidationIssue[], min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    addIssue(issues, field, `must be an integer from ${min} to ${max}`);
    return false;
  }
  return true;
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  try { return stableStringify(left) === stableStringify(right); } catch { return false; }
}

export function validateCommonBinding(
  value: JsonRecord,
  binding: G8EvidenceBinding,
  issues: G8ValidationIssue[],
  generatedAt: number | null = null,
): RuntimeIdentity | null {
  if (!isV11Commit(binding.expectedCommit)) addIssue(issues, "expectedCommit", "must be a non-zero lowercase 40-character commit SHA");
  if (!isV11Version(binding.expectedVersion)) addIssue(issues, "expectedVersion", "must be a semantic version");
  if (!isV11Sha256(binding.expectedSourceHash)) addIssue(issues, "expectedSourceHash", "must be a non-zero sha256 digest");

  const identityValue = value.runtimeIdentity;
  let identity: RuntimeIdentity | null = null;
  try {
    identity = validateRuntimeIdentity(identityValue);
  } catch (error) {
    addIssue(issues, "runtimeIdentity", safeV11Error(error));
  }
  if (identity) {
    if (identity.appVersion !== binding.expectedVersion) addIssue(issues, "runtimeIdentity.appVersion", "must match the expected app version");
    if (identity.gitCommit !== binding.expectedCommit) addIssue(issues, "runtimeIdentity.gitCommit", "must match the expected checkout commit");
    if (identity.productExperienceSourceHash !== binding.expectedSourceHash) addIssue(issues, "runtimeIdentity.productExperienceSourceHash", "must match the expected source fingerprint");
    if (identity.runtimeMode !== "production-build") addIssue(issues, "runtimeIdentity.runtimeMode", "must be production-build");
    const observedAt = requireIso(identity.observedAt, "runtimeIdentity.observedAt", issues);
    validateObservationTime(observedAt, generatedAt, "runtimeIdentity.observedAt", issues);
    // 即使 runtime identity 合法，artifact binding 仍必须存在，避免缺少采集阶段/源码绑定的记录放行。
    validateArtifactBinding(value.binding, binding, identity, issues);
  }
  return identity;
}

export function validateArtifactBinding(
  raw: unknown,
  binding: G8EvidenceBinding,
  identity: RuntimeIdentity | null,
  issues: G8ValidationIssue[],
): void {
  if (!isRecord(raw)) {
    addIssue(issues, "binding", "must be an object");
    return;
  }
  exactKeys(raw, ["commit", "sourceFingerprint", "capturePhase"], "binding", issues);
  if (!isV11Commit(raw.commit)) addIssue(issues, "binding.commit", "must be a non-zero lowercase 40-character commit SHA");
  if (!isV11Sha256(raw.sourceFingerprint)) addIssue(issues, "binding.sourceFingerprint", "must be a non-zero sha256 digest");
  if (raw.capturePhase !== "after-collection") addIssue(issues, "binding.capturePhase", "must be after-collection");
  if (raw.commit !== binding.expectedCommit) addIssue(issues, "binding.commit", "must match the expected checkout commit");
  if (raw.sourceFingerprint !== binding.expectedSourceHash) addIssue(issues, "binding.sourceFingerprint", "must match the expected source fingerprint");
  if (identity && raw.commit !== identity.gitCommit) addIssue(issues, "binding.commit", "must match runtimeIdentity.gitCommit");
  if (identity && raw.sourceFingerprint !== identity.productExperienceSourceHash) addIssue(issues, "binding.sourceFingerprint", "must match runtimeIdentity.productExperienceSourceHash");
}

export function validateEnvironment(
  raw: unknown,
  identity: RuntimeIdentity | null,
  generatedAt: number | null,
  issues: G8ValidationIssue[],
): void {
  if (!isRecord(raw)) {
    addIssue(issues, "environment", "must be an object");
    return;
  }
  exactKeys(raw, ["baseUrl", "browser", "mode", "pool"], "environment", issues);
  if (typeof raw.baseUrl !== "string") addIssue(issues, "environment.baseUrl", "must be a loopback HTTP origin");
  else {
    try {
      const url = new URL(raw.baseUrl);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
        || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        addIssue(issues, "environment.baseUrl", "must be a loopback HTTP origin without credentials or path");
      }
    } catch { addIssue(issues, "environment.baseUrl", "must be a loopback HTTP origin"); }
  }
  if (raw.browser !== "chromium") addIssue(issues, "environment.browser", "must be chromium");
  if (raw.mode !== "local-production-build") addIssue(issues, "environment.mode", "must be local-production-build");
  validatePool(raw.pool, raw.baseUrl, identity, generatedAt, issues);
}

export function validatePool(
  raw: unknown,
  baseUrl: unknown,
  identity: RuntimeIdentity | null,
  generatedAt: number | null,
  issues: G8ValidationIssue[],
): void {
  if (!isRecord(raw)) {
    addIssue(issues, "environment.pool", "must be present; browser evidence must bind a test-pool instance");
    return;
  }
  exactKeys(raw, G8_POOL_KEYS, "environment.pool", issues);
  if (typeof raw.slot !== "number" || !Number.isInteger(raw.slot) || raw.slot < 1 || raw.slot > 3) addIssue(issues, "environment.pool.slot", "must be an integer from 1 to 3");
  if (typeof raw.container !== "string" || !/^areaforge-dev-test-[123]$/.test(raw.container)) addIssue(issues, "environment.pool.container", "must be the owned areaforge-dev-test-N container");
  if (typeof raw.slot === "number" && raw.container !== `areaforge-dev-test-${raw.slot}`) addIssue(issues, "environment.pool.container", "must correspond to pool.slot");
  if (typeof raw.port !== "number" || !Number.isInteger(raw.port) || raw.port < 1024 || raw.port > 65535) addIssue(issues, "environment.pool.port", "must be a valid TCP port");
  if (typeof raw.generation !== "number" || !Number.isSafeInteger(raw.generation) || raw.generation <= 0) addIssue(issues, "environment.pool.generation", "must be a positive generation number");
  if (typeof raw.url !== "string") addIssue(issues, "environment.pool.url", "must be a loopback HTTP origin");
  else {
    try {
      const poolUrl = new URL(raw.url);
      if (poolUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(poolUrl.hostname)
        || poolUrl.username || poolUrl.password || poolUrl.pathname !== "/" || poolUrl.search || poolUrl.hash) {
        addIssue(issues, "environment.pool.url", "must be a loopback HTTP origin without credentials or path");
      }
      if (typeof raw.port === "number" && Number(poolUrl.port) !== raw.port) addIssue(issues, "environment.pool.url", "port must match environment.pool.port");
      if (typeof baseUrl === "string" && raw.url !== baseUrl) addIssue(issues, "environment.pool.url", "must match environment.baseUrl");
    } catch { addIssue(issues, "environment.pool.url", "must be a loopback HTTP origin"); }
  }
  if (raw.status !== "running") addIssue(issues, "environment.pool.status", "must be running at capture time");
  if (!isV11Commit(raw.commit)) addIssue(issues, "environment.pool.commit", "must be a non-zero lowercase 40-character commit SHA");
  if (!isV11Sha256(raw.sourceFingerprint)) addIssue(issues, "environment.pool.sourceFingerprint", "must be a non-zero sha256 digest");
  if (!isV11Sha256(raw.buildId)) addIssue(issues, "environment.pool.buildId", "must be a non-zero sha256 digest");
  const observedAt = requireIso(raw.observedAt, "environment.pool.observedAt", issues);
  validateObservationTime(observedAt, generatedAt, "environment.pool.observedAt", issues);
  if (identity) {
    if (raw.commit !== identity.gitCommit) addIssue(issues, "environment.pool.commit", "must match runtimeIdentity.gitCommit");
    if (raw.sourceFingerprint !== identity.productExperienceSourceHash) addIssue(issues, "environment.pool.sourceFingerprint", "must match runtimeIdentity.productExperienceSourceHash");
    if (raw.buildId !== identity.buildId) addIssue(issues, "environment.pool.buildId", "must match runtimeIdentity.buildId");
  }
}

function validateObservationTime(
  observedAt: number | null,
  generatedAt: number | null,
  field: string,
  issues: G8ValidationIssue[],
): void {
  if (observedAt === null || generatedAt === null) return;
  if (observedAt > generatedAt + MAX_G8_CLOCK_SKEW_MS || generatedAt - observedAt > MAX_G8_OBSERVATION_LEAD_MS) {
    addIssue(issues, field, "must be within two hours before generatedAt and at most five minutes after it");
  }
}

export function validateRunIdentity(value: unknown, schemaPrefix: string, issues: G8ValidationIssue[]): void {
  if (typeof value !== "string" || !value.startsWith(schemaPrefix) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) {
    addIssue(issues, "runId", `must be a canonical ${schemaPrefix}<id> value`);
  }
}

export function validateSafety(raw: unknown, expected: JsonRecord, issues: G8ValidationIssue[]): void {
  if (!isRecord(raw)) {
    addIssue(issues, "safety", "must be an object");
    return;
  }
  exactKeys(raw, Object.keys(expected), "safety", issues);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (raw[key] !== expectedValue) addIssue(issues, `safety.${key}`, `must be ${String(expectedValue)}`);
  }
}

export function validateDoesNotProve(raw: unknown, expected: readonly string[], issues: G8ValidationIssue[]): void {
  if (!Array.isArray(raw) || JSON.stringify(raw) !== JSON.stringify(expected)) {
    addIssue(issues, "doesNotProve", "must match the fixed claim boundary exactly");
  }
}

export function validateArtifactPath(value: unknown, field: string, expected: string, issues: G8ValidationIssue[]): value is string {
  if (typeof value !== "string" || value !== expected || path.posix.isAbsolute(value) || value.includes("\\") || value.includes("\0") || value.split("/").includes("..")) {
    addIssue(issues, field, `must use the canonical repo-relative path ${expected}`);
    return false;
  }
  return true;
}

export function readG8JsonFile(root: string, evidencePath: string): { file: G8LoadedJson | null; issues: G8ValidationIssue[] } {
  const issues: G8ValidationIssue[] = [];
  let safeFile;
  try {
    safeFile = readV11SafeRepoFile(root, evidencePath, MAX_G8_EVIDENCE_BYTES);
  } catch (error) {
    addIssue(issues, "recordPath", safeV11Error(error));
    return { file: null, issues };
  }
  if (!safeFile.relativePath.endsWith(".json")) addIssue(issues, "recordPath", "must be a repo-relative JSON file");
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(safeFile.bytes);
  } catch {
    addIssue(issues, "record", "must use valid UTF-8");
    return { file: null, issues };
  }
  if (containsG8SecretLikeText(raw)) addIssue(issues, "record", "must not contain secret-like or absolute-path text");
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { addIssue(issues, "record", "must contain valid JSON"); }
  const value = isRecord(parsed) ? parsed : null;
  return { file: { relativePath: safeFile.relativePath, sha256: safeFile.sha256, bytes: safeFile.bytes, raw, value }, issues };
}

export function rereadUnchanged(root: string, relativePath: string, expectedSha256: string, issues: G8ValidationIssue[]): void {
  try {
    const reread = readV11SafeRepoFile(root, relativePath, MAX_G8_EVIDENCE_BYTES);
    if (reread.sha256 !== expectedSha256) addIssue(issues, "recordPath", "evidence file changed during validation");
  } catch (error) { addIssue(issues, "recordPath", safeV11Error(error)); }
}

export function readG8Screenshot(
  root: string,
  raw: unknown,
  expectedPath: string,
  field: string,
  expectedWidth: number | null,
  expectedHeight: number,
  allowFullPage = true,
  screenshots: G8ScreenshotEvidence[] = [],
  issues: G8ValidationIssue[] = [],
): G8ScreenshotEvidence | null {
  if (!isRecord(raw)) {
    addIssue(issues, field, "must be a screenshot evidence object");
    return null;
  }
  exactKeys(raw, ["path", "sha256", "width", "height"], field, issues);
  if (!validateArtifactPath(raw.path, `${field}.path`, expectedPath, issues)) return null;
  requireSha(raw.sha256, `${field}.sha256`, issues);
  requireInteger(raw.width, `${field}.width`, issues, 1, 20_000);
  requireInteger(raw.height, `${field}.height`, issues, 1, 100_000);
  try {
    const file = readV11SafeRepoFile(root, raw.path, MAX_G8_SCREENSHOT_BYTES);
    const dimensions = readV11PngDimensions(file.bytes);
    if (expectedWidth !== null && dimensions.width !== expectedWidth) addIssue(issues, field, `PNG width must be ${expectedWidth}`);
    if (allowFullPage ? dimensions.height < expectedHeight : dimensions.height !== expectedHeight) {
      addIssue(issues, field, allowFullPage ? `PNG height must be at least ${expectedHeight}` : `PNG height must be ${expectedHeight}`);
    }
    if (raw.sha256 !== file.sha256) addIssue(issues, `${field}.sha256`, "must match the current screenshot bytes");
    if (raw.width !== dimensions.width) addIssue(issues, `${field}.width`, "must match the current PNG width");
    if (raw.height !== dimensions.height) addIssue(issues, `${field}.height`, "must match the current PNG height");
    const visual = inspectG8PngVisualContent(file.bytes);
    if (visual.uniquePixelSamples < 2) addIssue(issues, field, "PNG must contain non-uniform visual content");
    const evidence = { path: file.relativePath, sha256: file.sha256, ...dimensions };
    if (screenshots.some((item) => item.path === evidence.path)) addIssue(issues, field, "screenshot path must be unique");
    screenshots.push(evidence);
    return evidence;
  } catch (error) {
    addIssue(issues, field, safeV11Error(error));
    return null;
  }
}

function inspectG8PngVisualContent(bytes: Buffer): { uniquePixelSamples: number } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  let idatBytes = 0;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IHDR") {
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8] as number;
      colorType = bytes[dataStart + 9] as number;
    }
    if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
      idatBytes += length;
    }
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (bitDepth !== 8 || !channels) throw new Error("G8 PNG must use non-interlaced 8-bit grayscale, RGB, grayscale-alpha, or RGBA pixels");
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idat, idatBytes), { maxOutputLength: (rowBytes + 1) * height + 1 });
  const pixels = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset] as number;
    sourceOffset += 1;
    const targetOffset = row * rowBytes;
    const previousOffset = targetOffset - rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = inflated[sourceOffset + column] as number;
      const left = column >= channels ? pixels[targetOffset + column - channels] as number : 0;
      const above = row > 0 ? pixels[previousOffset + column] as number : 0;
      const aboveLeft = row > 0 && column >= channels ? pixels[previousOffset + column - channels] as number : 0;
      pixels[targetOffset + column] = (encoded + pngFilterPredictor(filter, left, above, aboveLeft)) & 0xff;
    }
    sourceOffset += rowBytes;
  }
  const totalPixels = width * height;
  const step = Math.max(1, Math.floor(totalPixels / 4096));
  const samples = new Set<string>();
  for (let pixel = 0; pixel < totalPixels && samples.size < 8; pixel += step) {
    samples.add(pixelSample(pixels, pixel * channels, colorType));
  }
  return { uniquePixelSamples: samples.size };
}

function pngFilterPredictor(filter: number, left: number, above: number, aboveLeft: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return above;
  if (filter === 3) return Math.floor((left + above) / 2);
  if (filter === 4) {
    const estimate = left + above - aboveLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const diagonalDistance = Math.abs(estimate - aboveLeft);
    return leftDistance <= aboveDistance && leftDistance <= diagonalDistance ? left : aboveDistance <= diagonalDistance ? above : aboveLeft;
  }
  throw new Error("G8 PNG scanline filter is invalid");
}

function pixelSample(pixels: Buffer, offset: number, colorType: number): string {
  if (colorType === 0 || colorType === 4) return String(pixels[offset]);
  return `${pixels[offset]}:${pixels[offset + 1]}:${pixels[offset + 2]}`;
}

export function validateScreenshotDirectory(root: string, directory: string, expectedNames: readonly string[], issues: G8ValidationIssue[]): void {
  const absolute = path.resolve(root, directory);
  try {
    const rootReal = realpathSync(path.resolve(root));
    if (!isWithin(rootReal, realpathSync(absolute))) {
      addIssue(issues, "screenshots", "directory escapes the repository");
      return;
    }
    const entries = readdirSync(absolute, { withFileTypes: true });
    const names = entries.map((entry) => entry.name).sort();
    const wanted = [...expectedNames].sort();
    if (JSON.stringify(names) !== JSON.stringify(wanted)) addIssue(issues, "screenshots", `must contain exactly ${wanted.length} canonical PNG files`);
    for (const entry of entries) {
      const candidate = path.join(absolute, entry.name);
      const stat = lstatSync(candidate);
      if (entry.isSymbolicLink() || !stat.isFile()) addIssue(issues, `screenshots/${entry.name}`, "must be a regular non-symlink file");
    }
  } catch (error) { addIssue(issues, "screenshots", safeV11Error(error)); }
}

export function containsG8SecretLikeText(raw: string): boolean {
  if (containsV11SecretLikeText(raw)) return true;
  return /(?:authorization|set-cookie|password|secret|session\s*cookie|api[_-]?key)\s*[:=]/i.test(raw)
    || /(?:^|["\s:])\/(?:Users|opt|var|etc|home|srv|private|Volumes|tmp)\//im.test(raw)
    || /[A-Za-z]:\\/.test(raw);
}

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createG8ScreenshotEvidence(
  root: string,
  relativePath: string,
): G8ScreenshotEvidence {
  const file = readV11SafeRepoFile(root, relativePath, MAX_G8_SCREENSHOT_BYTES);
  const dimensions = readV11PngDimensions(file.bytes);
  return { path: file.relativePath, sha256: file.sha256, ...dimensions };
}

export function readG8PoolEvidenceFromEnvironment(
  prefix: string,
  baseOrigin: string,
): G8PoolEvidence {
  const read = (name: string): string => {
    const value = process.env[`${prefix}_${name}`];
    if (!value) throw new Error(`missing ${prefix}_${name}; pass the machine-returned dev test pool identity`);
    return value;
  };
  const slotText = read("POOL_SLOT");
  if (!/^[1-3]$/.test(slotText)) throw new Error(`${prefix}_POOL_SLOT is invalid; expected 1, 2, or 3`);
  const generationText = read("POOL_GENERATION");
  if (!/^[1-9]\d*$/.test(generationText)) throw new Error(`${prefix}_POOL_GENERATION is invalid; expected a positive integer`);
  const slot = Number(slotText);
  const generation = Number(generationText);
  const port = Number(read("POOL_PORT"));
  const container = read("POOL_CONTAINER");
  const url = read("POOL_URL").replace(/\/$/, "");
  const status = read("POOL_STATUS");
  const commit = read("POOL_COMMIT");
  const sourceFingerprint = read("POOL_SOURCE_FINGERPRINT");
  const buildId = read("POOL_BUILD_ID");
  const observedAt = read("POOL_OBSERVED_AT");
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error(`${prefix}_POOL_PORT is invalid`);
  if (!Number.isSafeInteger(generation)) throw new Error(`${prefix}_POOL_GENERATION is outside the safe integer range`);
  if (container !== `areaforge-dev-test-${slot}`) throw new Error(`${prefix}_POOL_CONTAINER does not match the selected slot`);
  if (url !== baseOrigin) throw new Error(`${prefix}_POOL_URL does not match the runner URL`);
  if (status !== "running") throw new Error(`${prefix}_POOL_STATUS must be running`);
  if (!isV11Commit(commit)) throw new Error(`${prefix}_POOL_COMMIT is invalid`);
  if (!isV11Sha256(sourceFingerprint)) throw new Error(`${prefix}_POOL_SOURCE_FINGERPRINT is invalid`);
  if (!isV11Sha256(buildId)) throw new Error(`${prefix}_POOL_BUILD_ID is invalid`);
  if (parseIso(observedAt) === null) throw new Error(`${prefix}_POOL_OBSERVED_AT is invalid`);
  return { slot, container, port, generation, url, status, commit, sourceFingerprint, buildId, observedAt };
}

export function safeString(value: unknown, max = 500): value is string {
  return typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseCliOptions(argv: string[], usage: string): { paths: string[]; overrides: Partial<Omit<G8EvidenceBinding, "root">> } {
  const paths: string[] = [];
  const overrides: Partial<Omit<G8EvidenceBinding, "root">> = {};
  const flags = new Set(["--expected-commit", "--expected-version", "--expected-source-hash"]);
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (!arg.startsWith("--")) { paths.push(arg); continue; }
    const next = argv[index + 1];
    if (!flags.has(arg) || !next || next.startsWith("--") || seen.has(arg)) throw new Error(usage);
    seen.add(arg);
    if (arg === "--expected-commit") overrides.expectedCommit = next;
    if (arg === "--expected-version") overrides.expectedVersion = next;
    if (arg === "--expected-source-hash") overrides.expectedSourceHash = next;
    index += 1;
  }
  if (overrides.expectedCommit && !isV11Commit(overrides.expectedCommit)) throw new Error("--expected-commit must be a non-zero lowercase 40-character SHA");
  if (overrides.expectedVersion && !isV11Version(overrides.expectedVersion)) throw new Error("--expected-version must be a semantic version");
  if (overrides.expectedSourceHash && !isV11Sha256(overrides.expectedSourceHash)) throw new Error("--expected-source-hash must be a non-zero sha256 digest");
  return { paths, overrides };
}

export function issueCount(value: JsonRecord, keys: readonly string[]): number {
  return keys.reduce((total, key) => total + (Array.isArray(value[key]) ? value[key].length : 0), 0);
}

export function validateTelemetry(raw: unknown, field: string, keys: readonly string[], issues: G8ValidationIssue[]): void {
  if (!isRecord(raw)) {
    addIssue(issues, field, "must be an object");
    return;
  }
  exactKeys(raw, keys, field, issues);
  for (const key of keys) {
    if (!Array.isArray(raw[key]) || raw[key].length !== 0) addIssue(issues, `${field}.${key}`, "must be an empty array");
  }
}

export function isSafeRoute(value: unknown): value is string {
  if (!safeString(value) || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("#")) return false;
  try {
    const url = new URL(value, "http://areaforge.invalid");
    return url.origin === "http://areaforge.invalid" && !url.username && !url.password;
  } catch { return false; }
}

export function expectedFinalPath(templatePath: string, concretePath: string, publicRoute: boolean): string | null {
  if (templatePath.startsWith("/confirmations")) return "/today";
  if (templatePath === "/knowledge/resources/[resourceId]/preview") return concretePath.replace(/\/preview(?=$|\?)/, "");
  if (templatePath === "/knowledge/reviews/[scheduleId]/run") return "/focus?returnTo=%2Ftoday";
  if (publicRoute) return templatePath === "/login" ? "/login" : "/login";
  return concretePath;
}

export function deriveResult(value: JsonRecord, telemetryKeys: readonly string[]): boolean {
  return value.failure === null
    && typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 200 && value.status < 400
    && value.measurement === "measured"
    && value.mainVisible === true
    && typeof value.finalOrigin === "string"
    && value.controlsWithinHorizontalBounds === true
    && typeof value.mainTextLength === "number" && value.mainTextLength > 0
    && value.titleMatched === true
    && typeof value.rootOverflow === "number" && Number.isInteger(value.rootOverflow) && value.rootOverflow <= 1
    && value.contractVerified === true
    && issueCount(value, telemetryKeys) === 0
    && value.passed === true;
}

export function buildExpectedBinding(root: string, overrides: Partial<Omit<G8EvidenceBinding, "root">>, current: { commit: string; version: string; sourceHash: string }): G8EvidenceBinding {
  return {
    root,
    expectedCommit: overrides.expectedCommit ?? current.commit,
    expectedVersion: overrides.expectedVersion ?? current.version,
    expectedSourceHash: overrides.expectedSourceHash ?? current.sourceHash,
    validationTime: overrides.validationTime,
  };
}

export function validateExpectedScreenshotDirectory(root: string, runId: string, expectedNames: readonly string[], issues: G8ValidationIssue[]): string {
  const directory = `output/playwright/${runId}/screenshots`;
  validateScreenshotDirectory(root, directory, expectedNames, issues);
  return directory;
}

function isWithinRoot(root: string, candidate: string): boolean {
  return isWithin(path.resolve(root), path.resolve(candidate));
}
