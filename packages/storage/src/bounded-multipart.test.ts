import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoundedMultipartError,
  createUploadPolicy,
  multipartFramingOverheadBytes,
  parseMultipartBoundary,
  parseMultipleFilesMultipart,
  parseSingleFileMultipart,
} from "./index";

const boundary = "----areaforge-test-boundary";
const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildBody(parts: Array<{ name: string; fileName?: string; contentType?: string; bytes: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const fileName = part.fileName === undefined ? "" : `; filename="${part.fileName}"`;
    const contentType = part.contentType === undefined ? "" : `Content-Type: ${part.contentType}\r\n`;
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${fileName}\r\n${contentType}\r\n`));
    chunks.push(part.bytes);
    chunks.push(encoder.encode("\r\n"));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(pngMagic.slice(0, Math.min(size, pngMagic.length)));
  return bytes;
}

async function* chunked(bytes: Uint8Array, chunkSize: number): AsyncIterable<Uint8Array> {
  for (let index = 0; index < bytes.length; index += chunkSize) {
    yield bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
  }
}

function policyWithMaxBytes(maxBytes: number) {
  const policy = createUploadPolicy(1);
  return { ...policy, maxBytes };
}

const contentType = `multipart/form-data; boundary=${boundary}`;

test("parseMultipartBoundary accepts quoted and plain boundaries and rejects garbage", () => {
  assert.equal(parseMultipartBoundary(contentType), boundary);
  assert.equal(parseMultipartBoundary(`multipart/form-data; boundary="${boundary}"`), boundary);
  assert.equal(parseMultipartBoundary("application/json"), null);
  assert.equal(parseMultipartBoundary(null), null);
  assert.equal(parseMultipartBoundary("multipart/form-data"), null);
  assert.equal(parseMultipartBoundary(`multipart/form-data; boundary=${"x".repeat(300)}`), null);
});

test("streams a single file part with incremental hash, size, and magic bytes", async () => {
  const fileBytes = pngBytes(300 * 1024);
  const body = buildBody([{ name: "file", fileName: "a.png", contentType: "image/png", bytes: fileBytes }]);
  for (const chunkSize of [7, 1024, 64 * 1024, body.length]) {
    const scan = await parseSingleFileMultipart(chunked(body, chunkSize), contentType, policyWithMaxBytes(1024 * 1024));
    assert.equal(scan.sizeBytes, fileBytes.length);
    assert.equal(scan.detectedMimeType, "image/png");
    assert.equal(scan.originalName, "a.png");
    assert.equal(scan.declaredMimeType, "image/png");
    assert.equal(scan.bytes.length, fileBytes.length);
    assert.deepEqual([...scan.bytes.subarray(0, 8)], pngMagic);
  }
});

test("accepts a file at exactly the policy limit and aborts at limit + 1", async () => {
  const limit = 64 * 1024 + 123;
  const exact = buildBody([{ name: "file", fileName: "a.png", bytes: pngBytes(limit) }]);
  const scan = await parseSingleFileMultipart(chunked(exact, 8 * 1024), contentType, policyWithMaxBytes(limit));
  assert.equal(scan.sizeBytes, limit);

  const oversize = buildBody([{ name: "file", fileName: "a.png", bytes: pngBytes(limit + 1) }]);
  await assert.rejects(
    parseSingleFileMultipart(chunked(oversize, 8 * 1024), contentType, policyWithMaxBytes(limit)),
    (error: unknown) => error instanceof BoundedMultipartError && error.reason === "too_large",
  );
});

test("does not trust a misleading Content-Length style truncation and fails closed", async () => {
  const complete = buildBody([{ name: "file", fileName: "a.png", bytes: pngBytes(2048) }]);
  const truncated = complete.subarray(0, complete.length - 40);
  await assert.rejects(
    parseSingleFileMultipart(chunked(truncated, 512), contentType, policyWithMaxBytes(1024 * 1024)),
    (error: unknown) => error instanceof BoundedMultipartError && error.reason === "bad_multipart",
  );
});

test("rejects a second file part and unexpected fields without buffering them", async () => {
  const twoFiles = buildBody([
    { name: "file", fileName: "a.png", bytes: pngBytes(64) },
    { name: "file", fileName: "b.png", bytes: pngBytes(64) },
  ]);
  await assert.rejects(
    parseSingleFileMultipart(chunked(twoFiles, 64), contentType, policyWithMaxBytes(1024 * 1024)),
    (error: unknown) => error instanceof BoundedMultipartError && error.reason === "multiple_files",
  );

  const unexpectedField = buildBody([
    { name: "comment", bytes: new TextEncoder().encode("hello") },
    { name: "file", fileName: "a.png", bytes: pngBytes(64) },
  ]);
  await assert.rejects(
    parseSingleFileMultipart(chunked(unexpectedField, 64), contentType, policyWithMaxBytes(1024 * 1024)),
    (error: unknown) => error instanceof BoundedMultipartError && error.reason === "unexpected_part",
  );
});

test("accepts at most five files in one bounded batch", async () => {
  const fiveFiles = Array.from({ length: 5 }, (_, index) => ({
    name: "file",
    fileName: `${index + 1}.png`,
    contentType: "image/png",
    bytes: pngBytes(64 + index),
  }));
  const accepted = await parseMultipleFilesMultipart(
    chunked(buildBody(fiveFiles), 47),
    contentType,
    policyWithMaxBytes(1024),
    5,
  );
  assert.equal(accepted.length, 5);
  assert.deepEqual(accepted.map((scan) => scan.originalName), fiveFiles.map((file) => file.fileName));

  await assert.rejects(
    parseMultipleFilesMultipart(
      chunked(buildBody([...fiveFiles, { ...fiveFiles[0]!, fileName: "6.png" }]), 71),
      contentType,
      policyWithMaxBytes(1024),
      5,
    ),
    (error: unknown) => error instanceof BoundedMultipartError && error.reason === "too_many_files",
  );
});

test("returns an oversized batch item while preserving later file order", async () => {
  const accepted = await parseMultipleFilesMultipart(
    chunked(buildBody([
      { name: "file", fileName: "large.png", bytes: pngBytes(1025) },
      { name: "file", fileName: "small.png", bytes: pngBytes(64) },
    ]), 53),
    contentType,
    policyWithMaxBytes(1024),
    5,
  );
  assert.equal(accepted.length, 2);
  assert.equal(accepted[0]?.businessError, "too_large");
  assert.equal(accepted[0]?.originalName, "large.png");
  assert.equal(accepted[0]?.sizeBytes, 1025);
  assert.equal(accepted[0]?.bytes.length, 0);
  assert.equal(accepted[0]?.sha256Hex, "");
  assert.equal(accepted[0]?.detectedMimeType, null);
  assert.equal(accepted[1]?.businessError, undefined);
  assert.equal(accepted[1]?.originalName, "small.png");
});

test("keeps an untrusted oversized batch part bounded at limit plus one", async () => {
  const limit = 1024;
  const accepted = await parseMultipleFilesMultipart(
    chunked(buildBody([
      { name: "file", fileName: "untrusted-length.png", bytes: pngBytes(4 * 1024 * 1024) },
      { name: "file", fileName: "after.png", bytes: pngBytes(64) },
    ]), 64 * 1024),
    contentType,
    policyWithMaxBytes(limit),
    5,
  );

  assert.equal(accepted[0]?.businessError, "too_large");
  assert.equal(accepted[0]?.sizeBytes, limit + 1);
  assert.equal(accepted[0]?.bytes.length, 0);
  assert.equal(accepted[1]?.originalName, "after.png");
  assert.equal(accepted[1]?.bytes.length, 64);
});

test("rejects oversized part headers and missing terminal boundary", async () => {
  const encoder = new TextEncoder();
  const hugeHeader = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${"a".repeat(9000)}"\r\n\r\n`,
  );
  await assert.rejects(
    parseSingleFileMultipart(chunked(hugeHeader, 1024), contentType, policyWithMaxBytes(1024)),
    (error: unknown) => error instanceof BoundedMultipartError,
  );

  const missingFile = encoder.encode(`--${boundary}--\r\n`);
  await assert.rejects(
    parseSingleFileMultipart(chunked(missingFile, 16), contentType, policyWithMaxBytes(1024)),
    (error: unknown) => error instanceof BoundedMultipartError,
  );
});

test("bounds framing overhead independently of the file limit", async () => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [buildBody([{ name: "file", fileName: "a.png", bytes: pngBytes(16) }])];
  chunks.push(encoder.encode("x".repeat(multipartFramingOverheadBytes + 1024)));
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  await assert.rejects(
    parseSingleFileMultipart(chunked(merged, 64 * 1024), contentType, policyWithMaxBytes(1024 * 1024)),
    (error: unknown) => error instanceof BoundedMultipartError && error.reason === "framing_overhead_exceeded",
  );
});

test("parser abort propagates without leaving state behind", async () => {
  async function* failing(): AsyncIterable<Uint8Array> {
    yield new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\n`);
    throw new Error("SOCKET_RESET");
  }
  await assert.rejects(parseSingleFileMultipart(failing(), contentType, policyWithMaxBytes(1024)), /SOCKET_RESET/);
});
