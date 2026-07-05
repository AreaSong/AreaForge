export const defaultAllowedUploadMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export interface UploadPolicy {
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}

export function createUploadPolicy(maxUploadMb: number): UploadPolicy {
  return {
    maxBytes: maxUploadMb * 1024 * 1024,
    allowedMimeTypes: defaultAllowedUploadMimeTypes,
  };
}

export function isAllowedUpload(mimeType: string, sizeBytes: number, policy: UploadPolicy): boolean {
  return policy.allowedMimeTypes.includes(mimeType) && sizeBytes > 0 && sizeBytes <= policy.maxBytes;
}

