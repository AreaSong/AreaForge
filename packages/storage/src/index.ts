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

const attachmentUriPrefix = "upload://attachment/";

export function createUploadPolicy(maxUploadMb: number): UploadPolicy {
  return {
    maxBytes: maxUploadMb * 1024 * 1024,
    allowedMimeTypes: defaultAllowedUploadMimeTypes,
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

export function isSafeStoredAttachmentName(storedName: string): boolean {
  return /^[a-zA-Z0-9_-]{16,}\.(png|jpg|webp|pdf)$/.test(storedName);
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
