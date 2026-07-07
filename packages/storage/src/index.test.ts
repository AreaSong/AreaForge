import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAttachmentMetadataDraft,
  createAttachmentResponseHeaders,
  createAttachmentUri,
  createSafeAttachmentFilePath,
  createStoredAttachmentName,
  createUploadPolicy,
  detectUploadMimeType,
  isAllowedUpload,
  isPathInsideDirectory,
  normalizeOriginalFileName,
  parseAllowedUploadMimeTypes,
  parseAttachmentUri,
  validateUploadBytes,
} from "./index";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

test("detectUploadMimeType recognizes first-version attachment formats", () => {
  assert.equal(detectUploadMimeType(png), "image/png");
  assert.equal(detectUploadMimeType(jpeg), "image/jpeg");
  assert.equal(detectUploadMimeType(pdf), "application/pdf");
  assert.equal(detectUploadMimeType(webp), "image/webp");
});

test("validateUploadBytes rejects MIME spoofing and oversize files", () => {
  const policy = createUploadPolicy(1);
  assert.deepEqual(validateUploadBytes(png, "image/jpeg", policy), {
    allowed: false,
    detectedMimeType: "image/png",
    reason: "declared_mime_mismatch",
  });

  const oversized = new Uint8Array(policy.maxBytes + 1);
  assert.equal(validateUploadBytes(oversized, "image/png", policy).reason, "too_large");
});

test("validateUploadBytes accepts allowed files by detected magic bytes", () => {
  const policy = createUploadPolicy(1);
  const result = validateUploadBytes(pdf, "application/pdf", policy);
  assert.equal(result.allowed, true);
  assert.equal(result.detectedMimeType, "application/pdf");
  assert.equal(isAllowedUpload("application/pdf", pdf.length, policy), true);
});

test("stored attachment names and URIs reject path traversal inputs", () => {
  const storedName = createStoredAttachmentName("abcDEF1234567890", "image/jpeg");
  const uri = createAttachmentUri(storedName);

  assert.equal(storedName, "abcDEF1234567890.jpg");
  assert.equal(parseAttachmentUri(uri), storedName);
  assert.throws(() => createStoredAttachmentName("../evil", "application/pdf"), /UNSAFE_STORAGE_ID/);
  assert.throws(() => createAttachmentUri("../abcDEF1234567890.pdf"), /UNSAFE_STORED_NAME/);
  assert.equal(parseAttachmentUri("upload://attachment/../abcDEF1234567890.pdf"), null);
});

test("normalizeOriginalFileName keeps metadata only and drops paths", () => {
  assert.equal(normalizeOriginalFileName("../notes/final.pdf"), "final.pdf");
  assert.equal(normalizeOriginalFileName(""), "attachment");
});

test("createAttachmentMetadataDraft prepares safe metadata without file writes", () => {
  const policy = createUploadPolicy(1);
  const result = createAttachmentMetadataDraft({
    bytes: pdf,
    declaredMimeType: "application/pdf",
    originalName: "../private/考研资料.pdf",
    randomId: "abcDEF1234567890",
    policy,
  });

  assert.equal(result.ok, true);
  assert.equal(result.validation.reason, "ok");
  if (!result.ok) throw new Error("expected draft");

  assert.equal(result.draft.originalName, "考研资料.pdf");
  assert.equal(result.draft.storedName, "abcDEF1234567890.pdf");
  assert.equal(result.draft.mimeType, "application/pdf");
  assert.equal(result.draft.sizeBytes, pdf.length);
  assert.equal(result.draft.hash.length, 64);
  assert.equal(result.draft.uri, "upload://attachment/abcDEF1234567890.pdf");
});

test("createAttachmentMetadataDraft returns validation failure without metadata", () => {
  const result = createAttachmentMetadataDraft({
    bytes: png,
    declaredMimeType: "application/pdf",
    originalName: "spoof.pdf",
    randomId: "abcDEF1234567890",
    policy: createUploadPolicy(1),
  });

  assert.equal(result.ok, false);
  assert.equal(result.draft, null);
  assert.equal(result.validation.reason, "declared_mime_mismatch");
});

test("parseAllowedUploadMimeTypes ignores unsupported env values", () => {
  assert.deepEqual(parseAllowedUploadMimeTypes("image/png,text/html,image/png"), ["image/png"]);
  assert.deepEqual(parseAllowedUploadMimeTypes("text/html,application/x-msdownload"), [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
  ]);
});

test("createSafeAttachmentFilePath keeps files inside upload root", () => {
  const resolved = createSafeAttachmentFilePath("/app/uploads", "abcDEF1234567890.png");

  assert.equal(resolved.uploadRoot, "/app/uploads");
  assert.equal(resolved.filePath, "/app/uploads/abcDEF1234567890.png");
  assert.equal(isPathInsideDirectory("/app/uploads", "/app/uploads/abcDEF1234567890.png"), true);
  assert.equal(isPathInsideDirectory("/app/uploads", "/app/uploads-next/abcDEF1234567890.png"), false);
  assert.throws(() => createSafeAttachmentFilePath("/", "abcDEF1234567890.png"), /UNSAFE_UPLOAD_DIR/);
  assert.throws(() => createSafeAttachmentFilePath("uploads", "abcDEF1234567890.png"), /UNSAFE_UPLOAD_DIR/);
  assert.throws(() => createSafeAttachmentFilePath("/app/uploads", "../abcDEF1234567890.png"), /UNSAFE_STORED_NAME/);
});

test("createSafeAttachmentFilePath rejects public upload roots", () => {
  assert.throws(
    () =>
      createSafeAttachmentFilePath("/app/apps/web/public/uploads", "abcDEF1234567890.png", {
        forbiddenDirectories: ["/app/apps/web/public"],
      }),
    /UPLOAD_DIR_PUBLIC/,
  );
  assert.throws(
    () =>
      createSafeAttachmentFilePath("/app/uploads", "abcDEF1234567890.png", {
        forbiddenDirectories: ["apps/web/public"],
      }),
    /UNSAFE_FORBIDDEN_DIR/,
  );
});

test("createAttachmentResponseHeaders emits private nosniff download headers", () => {
  const headers = createAttachmentResponseHeaders({
    mimeType: "application/pdf",
    originalName: "../资料 \"final\".pdf",
    sizeBytes: 7,
  });

  assert.equal(headers["Content-Type"], "application/pdf");
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Content-Length"], "7");
  assert.match(headers["Content-Disposition"], /^attachment;/);
  assert.match(headers["Content-Disposition"], /filename="[^"]*_final_\.pdf"/);
  assert.match(headers["Content-Disposition"], /filename\*=UTF-8''/);
});
