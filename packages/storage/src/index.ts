import { createHash } from "node:crypto";
import path from "node:path";

export const defaultAllowedUploadMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

/** StudyResource FILE allowlist: notes keep defaultAllowedUploadMimeTypes. */
export const studyResourceAllowedUploadMimeTypes = [
  ...defaultAllowedUploadMimeTypes,
  "application/zip",
  "text/markdown",
] as const;

export type AllowedUploadMimeType =
  | (typeof defaultAllowedUploadMimeTypes)[number]
  | (typeof studyResourceAllowedUploadMimeTypes)[number];

export const STUDY_RESOURCE_MAX_UPLOAD_MB = 20;
export const STUDY_RESOURCE_MAX_FILES_PER_BATCH = 5;

export interface UploadPolicy {
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

export interface AttachmentMetadataDraft {
  originalName: string;
  storedName: string;
  mimeType: AllowedUploadMimeType;
  sizeBytes: number;
  hash: string;
  uri: string;
}

export interface UploadValidationResult {
  allowed: boolean;
  detectedMimeType: AllowedUploadMimeType | null;
  reason:
    | "ok"
    | "empty_file"
    | "too_large"
    | "unknown_magic_bytes"
    | "mime_not_allowed"
    | "declared_mime_mismatch";
}

export type AttachmentMetadataDraftResult =
  | {
      ok: true;
      draft: AttachmentMetadataDraft;
      validation: UploadValidationResult;
    }
  | {
      ok: false;
      draft: null;
      validation: UploadValidationResult;
    };

export interface SafeAttachmentPath {
  uploadRoot: string;
  filePath: string;
}

export interface SafeAttachmentPathOptions {
  forbiddenDirectories?: readonly string[];
}

export interface AttachmentResponseHeaderInput {
  mimeType: string;
  originalName: string;
  sizeBytes?: number;
  disposition?: "attachment" | "inline";
}

const attachmentUriPrefix = "upload://attachment/";

export function createUploadPolicy(
  maxUploadMb: number,
  allowedMimeTypes: readonly string[] = defaultAllowedUploadMimeTypes,
): UploadPolicy {
  return {
    maxBytes: maxUploadMb * 1024 * 1024,
    allowedMimeTypes,
  };
}

export function isAllowedUpload(mimeType: string, sizeBytes: number, policy: UploadPolicy): boolean {
  return policy.allowedMimeTypes.includes(mimeType) && sizeBytes > 0 && sizeBytes <= policy.maxBytes;
}

export function detectUploadMimeType(
  bytes: Uint8Array,
  options?: { originalName?: string; declaredMimeType?: string | null },
): AllowedUploadMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 12 &&
    asciiAt(bytes, 0, 4) === "RIFF" &&
    asciiAt(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }

  // ZIP local/central/end signatures (PK..)
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "application/zip";
  }

  if (looksLikeMarkdown(bytes, options?.originalName, options?.declaredMimeType)) {
    return "text/markdown";
  }

  return null;
}

export function validateUploadBytes(
  bytes: Uint8Array,
  declaredMimeType: string | null | undefined,
  policy: UploadPolicy,
  options?: { originalName?: string },
): UploadValidationResult {
  if (bytes.length <= 0) {
    return { allowed: false, detectedMimeType: null, reason: "empty_file" };
  }

  if (bytes.length > policy.maxBytes) {
    return { allowed: false, detectedMimeType: null, reason: "too_large" };
  }

  const detectedMimeType = detectUploadMimeType(bytes, {
    originalName: options?.originalName,
    declaredMimeType,
  });
  if (!detectedMimeType) {
    return { allowed: false, detectedMimeType: null, reason: "unknown_magic_bytes" };
  }

  if (!policy.allowedMimeTypes.includes(detectedMimeType)) {
    return { allowed: false, detectedMimeType, reason: "mime_not_allowed" };
  }

  if (declaredMimeType && !mimeTypesCompatible(declaredMimeType, detectedMimeType)) {
    return { allowed: false, detectedMimeType, reason: "declared_mime_mismatch" };
  }

  return { allowed: true, detectedMimeType, reason: "ok" };
}

export function createAttachmentMetadataDraft(input: {
  bytes: Uint8Array;
  declaredMimeType?: string | null;
  originalName: string;
  randomId: string;
  policy: UploadPolicy;
}): AttachmentMetadataDraftResult {
  const validation = validateUploadBytes(input.bytes, input.declaredMimeType, input.policy, {
    originalName: input.originalName,
  });
  if (!validation.allowed || !validation.detectedMimeType) {
    return {
      ok: false,
      draft: null,
      validation,
    };
  }

  const storedName = createStoredAttachmentName(input.randomId, validation.detectedMimeType);
  return {
    ok: true,
    draft: {
      originalName: normalizeOriginalFileName(input.originalName),
      storedName,
      mimeType: validation.detectedMimeType,
      sizeBytes: input.bytes.length,
      hash: createSha256Hex(input.bytes),
      uri: createAttachmentUri(storedName),
    },
    validation,
  };
}

export interface BoundedUploadScanInput {
  sizeBytes: number;
  sha256Hex: string;
  detectedMimeType: AllowedUploadMimeType | null;
  declaredMimeType?: string | null;
  originalName: string;
  randomId: string;
  policy: UploadPolicy;
}

export function createStudyResourceUploadPolicy(
  maxUploadMb: number = STUDY_RESOURCE_MAX_UPLOAD_MB,
): UploadPolicy {
  return createUploadPolicy(maxUploadMb, studyResourceAllowedUploadMimeTypes);
}

/** ZIP must never be served inline; PDF/image/markdown may use inline for private preview. */
export function preferredDownloadDisposition(mimeType: string): "attachment" | "inline" {
  if (mimeType === "application/zip") return "attachment";
  if (
    mimeType === "application/pdf" ||
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "text/markdown"
  ) {
    return "inline";
  }
  return "attachment";
}

export function isInlinePreviewAllowed(mimeType: string): boolean {
  return preferredDownloadDisposition(mimeType) === "inline";
}

/** 基于有界流式扫描结果构建 metadata draft，不重复缓冲或重复哈希文件内容。 */
export function createAttachmentMetadataDraftFromScan(input: BoundedUploadScanInput): AttachmentMetadataDraftResult {
  const validation = validateScannedUpload(input);
  if (!validation.allowed || !validation.detectedMimeType) {
    return { ok: false, draft: null, validation };
  }

  const storedName = createStoredAttachmentName(input.randomId, validation.detectedMimeType);
  return {
    ok: true,
    draft: {
      originalName: normalizeOriginalFileName(input.originalName),
      storedName,
      mimeType: validation.detectedMimeType,
      sizeBytes: input.sizeBytes,
      hash: input.sha256Hex,
      uri: createAttachmentUri(storedName),
    },
    validation,
  };
}

function validateScannedUpload(input: BoundedUploadScanInput): UploadValidationResult {
  if (input.sizeBytes <= 0) {
    return { allowed: false, detectedMimeType: null, reason: "empty_file" };
  }
  if (input.sizeBytes > input.policy.maxBytes) {
    return { allowed: false, detectedMimeType: null, reason: "too_large" };
  }
  if (!input.detectedMimeType) {
    return { allowed: false, detectedMimeType: null, reason: "unknown_magic_bytes" };
  }
  if (!input.policy.allowedMimeTypes.includes(input.detectedMimeType)) {
    return { allowed: false, detectedMimeType: input.detectedMimeType, reason: "mime_not_allowed" };
  }
  if (input.declaredMimeType && !mimeTypesCompatible(input.declaredMimeType, input.detectedMimeType)) {
    return { allowed: false, detectedMimeType: input.detectedMimeType, reason: "declared_mime_mismatch" };
  }
  return { allowed: true, detectedMimeType: input.detectedMimeType, reason: "ok" };
}

export function parseAllowedUploadMimeTypes(value: string | null | undefined): readonly string[] {
  if (!value) return defaultAllowedUploadMimeTypes;

  const allowed = new Set<string>(defaultAllowedUploadMimeTypes);
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => allowed.has(item));

  return parsed.length > 0 ? Array.from(new Set(parsed)) : defaultAllowedUploadMimeTypes;
}

export function createStoredAttachmentName(randomId: string, mimeType: AllowedUploadMimeType): string {
  if (!/^[a-zA-Z0-9_-]{16,}$/.test(randomId)) {
    throw new Error("UNSAFE_STORAGE_ID");
  }

  return `${randomId}.${extensionForMimeType(mimeType)}`;
}

export function createAttachmentUri(storedName: string): string {
  if (!isSafeStoredAttachmentName(storedName)) {
    throw new Error("UNSAFE_STORED_NAME");
  }

  return `${attachmentUriPrefix}${storedName}`;
}

export function parseAttachmentUri(uri: string): string | null {
  if (!uri.startsWith(attachmentUriPrefix)) {
    return null;
  }

  const storedName = uri.slice(attachmentUriPrefix.length);
  return isSafeStoredAttachmentName(storedName) ? storedName : null;
}

export function normalizeOriginalFileName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? "attachment";
  const normalized = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.slice(0, 180) || "attachment";
}

export function createSafeAttachmentFilePath(
  uploadDir: string,
  storedName: string,
  options: SafeAttachmentPathOptions = {},
): SafeAttachmentPath {
  if (!isSafeStoredAttachmentName(storedName)) {
    throw new Error("UNSAFE_STORED_NAME");
  }

  if (!path.isAbsolute(uploadDir)) {
    throw new Error("UNSAFE_UPLOAD_DIR");
  }

  const uploadRoot = path.resolve(uploadDir);
  if (uploadRoot === path.parse(uploadRoot).root) {
    throw new Error("UNSAFE_UPLOAD_DIR");
  }

  for (const forbiddenDirectory of options.forbiddenDirectories ?? []) {
    if (!path.isAbsolute(forbiddenDirectory)) {
      throw new Error("UNSAFE_FORBIDDEN_DIR");
    }

    if (isPathInsideDirectory(forbiddenDirectory, uploadRoot)) {
      throw new Error("UPLOAD_DIR_PUBLIC");
    }
  }

  const filePath = path.resolve(uploadRoot, storedName);
  if (!isPathInsideDirectory(uploadRoot, filePath)) {
    throw new Error("UPLOAD_PATH_ESCAPE");
  }

  return {
    uploadRoot,
    filePath,
  };
}

export function isPathInsideDirectory(parentDir: string, childPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function createAttachmentResponseHeaders(input: AttachmentResponseHeaderInput): Record<string, string> {
  const originalName = normalizeOriginalFileName(input.originalName);
  const disposition = input.disposition ?? "attachment";
  const headers: Record<string, string> = {
    "Content-Type": input.mimeType,
    "Content-Disposition": createContentDisposition(disposition, originalName),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (input.sizeBytes !== undefined) {
    headers["Content-Length"] = String(input.sizeBytes);
  }

  return headers;
}

export function isSafeStoredAttachmentName(storedName: string): boolean {
  return /^[a-zA-Z0-9_-]{16,}\.(png|jpg|webp|pdf|zip|md)$/.test(storedName);
}

export const stagingDirectoryName = ".staging";

export function createStagingAttachmentName(storedName: string): string {
  if (!isSafeStoredAttachmentName(storedName)) {
    throw new Error("UNSAFE_STORED_NAME");
  }
  return `${storedName}.staging`;
}

export function isSafeStagingAttachmentName(stagingName: string): boolean {
  return /^[a-zA-Z0-9_-]{16,}\.(png|jpg|webp|pdf|zip|md)\.staging$/.test(stagingName);
}

export function createSafeStagingFilePath(
  uploadDir: string,
  stagingName: string,
  options: SafeAttachmentPathOptions = {},
): SafeAttachmentPath {
  if (!isSafeStagingAttachmentName(stagingName)) {
    throw new Error("UNSAFE_STAGING_NAME");
  }
  const root = createSafeAttachmentFilePath(uploadDir, stagingName.slice(0, -".staging".length), options);
  const stagingRoot = path.join(root.uploadRoot, stagingDirectoryName);
  return {
    uploadRoot: root.uploadRoot,
    filePath: path.join(stagingRoot, stagingName),
  };
}

function createSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createContentDisposition(disposition: "attachment" | "inline", fileName: string): string {
  const asciiName = fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[\\"]/g, "_")
    .trim() || "attachment";
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function extensionForMimeType(
  mimeType: AllowedUploadMimeType,
): "png" | "jpg" | "webp" | "pdf" | "zip" | "md" {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    case "application/zip":
      return "zip";
    case "text/markdown":
      return "md";
  }
}

function looksLikeMarkdown(
  bytes: Uint8Array,
  originalName?: string,
  declaredMimeType?: string | null,
): boolean {
  if (bytes.some((byte) => byte === 0)) return false;
  const name = (originalName ?? "").toLowerCase();
  const extensionOk = name.endsWith(".md") || name.endsWith(".markdown");
  const declaredOk =
    declaredMimeType === "text/markdown" ||
    declaredMimeType === "text/x-markdown" ||
    declaredMimeType === "text/plain";
  if (!extensionOk && !declaredOk) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch {
    return false;
  }
}

function mimeTypesCompatible(declared: string, detected: AllowedUploadMimeType): boolean {
  if (declared === detected) return true;
  if (detected === "text/markdown") {
    return declared === "text/markdown" || declared === "text/x-markdown" || declared === "text/plain";
  }
  if (detected === "application/zip") {
    return declared === "application/zip" || declared === "application/x-zip-compressed";
  }
  return false;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

export {
  BoundedMultipartError,
  multipartFramingOverheadBytes,
  multipartHeaderLimitBytes,
  multipartReadChunkBytes,
  parseMultipartBoundary,
  parseSingleFileMultipart,
} from "./bounded-multipart";
export type { BoundedFileScan, BoundedMultipartFailure } from "./bounded-multipart";
