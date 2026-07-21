import { createHash } from "node:crypto";
import {
  detectUploadMimeType,
  type AllowedUploadMimeType,
  type UploadPolicy,
} from "./index";

/**
 * OPS-007 有界流式 multipart 读取。
 *
 * 单文件上传协议约束：只接受恰好一个 `file` part，按固定块增量计数、增量哈希并
 * 嗅探 magic bytes；实际读取字节数在业务上限 +1 时立即中止，不信任 Content-Length。
 * 解析框架（boundary、part 头、尾部）使用有界滚动缓冲，非文件开销单独设上限。
 */

export const multipartReadChunkBytes = 64 * 1024;
export const multipartHeaderLimitBytes = 8 * 1024;
export const multipartFramingOverheadBytes = 64 * 1024;

export type BoundedMultipartFailure =
  | "missing_boundary"
  | "bad_multipart"
  | "headers_too_large"
  | "unexpected_part"
  | "multiple_files"
  | "file_part_missing"
  | "too_large"
  | "framing_overhead_exceeded";

export class BoundedMultipartError extends Error {
  readonly reason: BoundedMultipartFailure;

  constructor(reason: BoundedMultipartFailure) {
    super(`BOUNDED_MULTIPART_${reason.toUpperCase()}`);
    this.reason = reason;
  }
}

export interface BoundedFileScan {
  originalName: string;
  declaredMimeType: string | null;
  sizeBytes: number;
  sha256Hex: string;
  detectedMimeType: AllowedUploadMimeType | null;
  bytes: Uint8Array;
}

export function parseMultipartBoundary(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const match = /^multipart\/form-data\s*(?:;.*)?$/i.test(contentType.trim())
    ? contentType.match(/boundary=(?:"([^"]+)"|([^;,\s]+))/i)
    : null;
  const boundary = match?.[1] ?? match?.[2] ?? null;
  if (!boundary || boundary.length > 200 || !/^[0-9A-Za-z'()+_,\-./:=? ]+$/.test(boundary)) return null;
  return boundary;
}

interface ScanState {
  hash: ReturnType<typeof createHash>;
  chunks: Uint8Array[];
  sizeBytes: number;
  sniffBuffer: Uint8Array;
}

/**
 * 解析单文件 multipart body。
 *
 * - `maxFileBytes`：业务上限；实际文件字节达到 limit+1 立即抛 too_large。
 * - 框架字节（boundary、headers、CRLF）总量超过固定 overhead 时抛 framing_overhead_exceeded。
 * - 只允许一个 name="file" 的 part；出现其他 part 或第二个文件 part 直接失败。
 * - 文件内容按到达块增量处理，框架滚动缓冲不超过 boundary 标记 + 一个读块。
 */
export async function parseSingleFileMultipart(
  body: AsyncIterable<Uint8Array>,
  contentType: string | null | undefined,
  policy: UploadPolicy,
): Promise<BoundedFileScan> {
  const boundary = parseMultipartBoundary(contentType);
  if (!boundary) throw new BoundedMultipartError("missing_boundary");

  const encoder = new TextEncoder();
  const delimiter = encoder.encode(`\r\n--${boundary}`);
  const firstDelimiter = encoder.encode(`--${boundary}`);

  const reader = createRollingReader(body);

  let framingBytes = 0;
  const consumeFraming = (count: number): void => {
    framingBytes += count;
    if (framingBytes > multipartFramingOverheadBytes) {
      throw new BoundedMultipartError("framing_overhead_exceeded");
    }
  };

  // 首个 boundary 行（不允许任意 preamble：浏览器与既有客户端不会发送）。
  const firstLine = await reader.readLine(multipartHeaderLimitBytes);
  if (!firstLine || !bytesEqual(firstLine, firstDelimiter)) {
    throw new BoundedMultipartError("bad_multipart");
  }
  consumeFraming(firstLine.length + 2);

  let scan: BoundedFileScan | null = null;

  for (;;) {
    const headers = await readPartHeaders(reader);
    consumeFraming(headers.rawBytes);
    const disposition = parseContentDisposition(headers.contentDisposition);
    if (!disposition || disposition.fieldName !== "file") {
      throw new BoundedMultipartError("unexpected_part");
    }
    if (scan) throw new BoundedMultipartError("multiple_files");

    const state: ScanState = {
      hash: createHash("sha256"),
      chunks: [],
      sizeBytes: 0,
      sniffBuffer: new Uint8Array(0),
    };

    const partEnd = await reader.readUntilDelimiter(delimiter, (chunk) => {
      state.sizeBytes += chunk.length;
      if (state.sizeBytes > policy.maxBytes) {
        throw new BoundedMultipartError("too_large");
      }
      state.hash.update(chunk);
      state.chunks.push(chunk);
      if (state.sniffBuffer.length < 16) {
        const merged = new Uint8Array(Math.min(16, state.sniffBuffer.length + chunk.length));
        merged.set(state.sniffBuffer.subarray(0, Math.min(state.sniffBuffer.length, merged.length)));
        if (merged.length > state.sniffBuffer.length) {
          merged.set(chunk.subarray(0, merged.length - state.sniffBuffer.length), state.sniffBuffer.length);
        }
        state.sniffBuffer = merged;
      }
    });
    if (!partEnd) throw new BoundedMultipartError("bad_multipart");
    consumeFraming(delimiter.length);

    const bytes = concatChunks(state.chunks, state.sizeBytes);
    scan = {
      originalName: disposition.fileName ?? "attachment",
      declaredMimeType: headers.contentType,
      sizeBytes: state.sizeBytes,
      sha256Hex: state.hash.digest("hex"),
      detectedMimeType: detectUploadMimeType(state.sniffBuffer),
      bytes,
    };

    const trailer = await reader.readExact(2);
    if (!trailer) throw new BoundedMultipartError("bad_multipart");
    consumeFraming(2);
    if (trailer[0] === 0x2d && trailer[1] === 0x2d) {
      break;
    }
    if (!bytesEqual(trailer, CRLF)) throw new BoundedMultipartError("bad_multipart");
  }

  if (!scan) throw new BoundedMultipartError("file_part_missing");
  await reader.drainRemainder(multipartFramingOverheadBytes);
  return scan;
}

interface PartHeaders {
  contentDisposition: string | null;
  contentType: string | null;
  rawBytes: number;
}

async function readPartHeaders(reader: RollingReader): Promise<PartHeaders> {
  let contentDisposition: string | null = null;
  let contentType: string | null = null;
  let rawBytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: false });

  for (;;) {
    const line = await reader.readLine(multipartHeaderLimitBytes);
    if (line === null) throw new BoundedMultipartError("bad_multipart");
    rawBytes += line.length + 2;
    if (rawBytes > multipartHeaderLimitBytes) throw new BoundedMultipartError("headers_too_large");
    if (line.length === 0) return { contentDisposition, contentType, rawBytes };
    const text = decoder.decode(line);
    const separator = text.indexOf(":");
    if (separator <= 0) throw new BoundedMultipartError("bad_multipart");
    const name = text.slice(0, separator).trim().toLowerCase();
    const value = text.slice(separator + 1).trim();
    if (name === "content-disposition") contentDisposition = value;
    if (name === "content-type") contentType = value;
  }
}

function parseContentDisposition(value: string | null): { fieldName: string; fileName: string | null } | null {
  if (!value || !/^form-data(;|$)/i.test(value.trim())) return null;
  const fieldMatch = value.match(/;\s*name=(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i);
  if (!fieldMatch) return null;
  const fileMatch = value.match(/;\s*filename=(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i);
  return {
    fieldName: unescapeQuoted(fieldMatch[1] ?? fieldMatch[2] ?? ""),
    fileName: fileMatch ? unescapeQuoted(fileMatch[1] ?? fileMatch[2] ?? "") : null,
  };
}

function unescapeQuoted(value: string): string {
  return value.replaceAll(/\\(.)/g, "$1");
}

interface RollingReader {
  readLine(limit: number): Promise<Uint8Array | null>;
  readExact(count: number): Promise<Uint8Array | null>;
  readUntilDelimiter(delimiter: Uint8Array, onChunk: (chunk: Uint8Array) => void): Promise<boolean>;
  drainRemainder(limit: number): Promise<void>;
}

function createRollingReader(body: AsyncIterable<Uint8Array>): RollingReader {
  const iterator = body[Symbol.asyncIterator]();
  let buffer: Uint8Array = new Uint8Array(0);
  let done = false;

  const pull = async (): Promise<boolean> => {
    if (done) return false;
    const next = await iterator.next();
    if (next.done || !next.value) {
      done = true;
      return false;
    }
    if (next.value.length === 0) return pull();
    buffer = appendBytes(buffer, next.value);
    return true;
  };

  return {
    async readLine(limit: number): Promise<Uint8Array | null> {
      for (;;) {
        const newline = indexOfSequence(buffer, CRLF, 0);
        if (newline >= 0) {
          const line = buffer.subarray(0, newline);
          buffer = buffer.subarray(newline + 2);
          return line;
        }
        if (buffer.length > limit) return null;
        if (!(await pull())) return null;
      }
    },

    async readExact(count: number): Promise<Uint8Array | null> {
      while (buffer.length < count) {
        if (!(await pull())) return null;
      }
      const bytes = buffer.subarray(0, count);
      buffer = buffer.subarray(count);
      return bytes;
    },

    async readUntilDelimiter(delimiter: Uint8Array, onChunk: (chunk: Uint8Array) => void): Promise<boolean> {
      for (;;) {
        const found = indexOfSequence(buffer, delimiter, 0);
        if (found >= 0) {
          if (found > 0) onChunk(buffer.subarray(0, found));
          buffer = buffer.subarray(found + delimiter.length);
          return true;
        }
        // 只把肯定不属于 delimiter 前缀的字节交给消费者，滚动缓冲保持有界。
        const safeLength = buffer.length - (delimiter.length - 1);
        if (safeLength > 0) {
          onChunk(buffer.subarray(0, safeLength));
          buffer = buffer.subarray(safeLength);
        }
        if (!(await pull())) return false;
      }
    },

    async drainRemainder(limit: number): Promise<void> {
      let drained = buffer.length;
      buffer = new Uint8Array(0);
      for (;;) {
        if (drained > limit) throw new BoundedMultipartError("framing_overhead_exceeded");
        if (!(await pull())) return;
        drained += buffer.length;
        buffer = new Uint8Array(0);
      }
    },
  };
}

const CRLF = new Uint8Array([0x0d, 0x0a]);

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left);
  merged.set(right, left.length);
  return merged;
}

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  const lastStart = haystack.length - needle.length;
  outer: for (let index = Math.max(0, from); index <= lastStart; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return indexOfSequence(left, right, 0) === 0 || (left.length === 0 && right.length === 0);
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
