import { createHash } from "node:crypto";
import path from "node:path";

export const defaultAllowedUploadMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedUploadMimeType = (typeof defaultAllowedUploadMimeTypes)[number];

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

export function detectUploadMimeType(bytes: Uint8Array): AllowedUploadMimeType | null {
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

  return null;
}

export function validateUploadBytes(
  bytes: Uint8Array,
  declaredMimeType: string | null | undefined,
  policy: UploadPolicy,
): UploadValidationResult {
  if (bytes.length <= 0) {
    return { allowed: false, detectedMimeType: null, reason: "empty_file" };
  }

  if (bytes.length > policy.maxBytes) {
    return { allowed: false, detectedMimeType: null, reason: "too_large" };
  }

  const detectedMimeType = detectUploadMimeType(bytes);
  if (!detectedMimeType) {
    return { allowed: false, detectedMimeType: null, reason: "unknown_magic_bytes" };
  }

  if (!policy.allowedMimeTypes.includes(detectedMimeType)) {
    return { allowed: false, detectedMimeType, reason: "mime_not_allowed" };
  }

  if (declaredMimeType && declaredMimeType !== detectedMimeType) {
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
  const validation = validateUploadBytes(input.bytes, input.declaredMimeType, input.policy);
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

export function parseAllowedUploadMimeTypes(value: string | null | undefined): readonly string[] {
  if (!value) return defaultAllowedUploadMimeTypes;

  const allowed = new Set(defaultAllowedUploadMimeTypes);
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => allowed.has(item as AllowedUploadMimeType));

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
  return /^[a-zA-Z0-9_-]{16,}\.(png|jpg|webp|pdf)$/.test(storedName);
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

function extensionForMimeType(mimeType: AllowedUploadMimeType): "png" | "jpg" | "webp" | "pdf" {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
