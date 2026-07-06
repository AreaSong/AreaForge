import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAttachmentUri,
  createStoredAttachmentName,
  createUploadPolicy,
  detectUploadMimeType,
  isAllowedUpload,
  normalizeOriginalFileName,
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
