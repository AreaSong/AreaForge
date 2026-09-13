import { createHash } from "node:crypto";
import { DataExportStorageError, EXPORT_STORAGE_MAX_BYTES } from "./data-export-files";

export interface ExportZipEntry { name: string; sizeBytes: number; sha256: string }
export interface ExportZipReceipt { sizeBytes: number; sha256: string; entries: number }
type Sink = (chunk: Uint8Array) => Promise<void>;

/** STORE + data descriptor；目录单独落盘，文件和 manifest 的正文都不累计在内存中。 */
export class DataExportZipWriter {
  private offset = 0;
  private count = 0;
  private directorySize = 0;
  private busy = false;
  private finished = false;
  private failed = false;
  private readonly names = new Set<string>();
  private readonly hash = createHash("sha256");
  private readonly directoryHash = createHash("sha256");

  constructor(private readonly output: Sink, private readonly directory: Sink, private readonly options: { maxBytes?: number; maxEntries?: number; signal?: AbortSignal } = {}) {
    const bytes = options.maxBytes ?? EXPORT_STORAGE_MAX_BYTES;
    const entries = options.maxEntries ?? 100_000;
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > EXPORT_STORAGE_MAX_BYTES || !Number.isSafeInteger(entries) || entries < 1 || entries > 100_000) limit();
  }

  async add(name: string, source: AsyncIterable<Uint8Array>): Promise<ExportZipEntry> {
    this.checkAvailable(); this.busy = true;
    try {
      const fileName = safeName(name);
      if (this.names.has(name) || this.count >= (this.options.maxEntries ?? 100_000)) limit();
      this.names.add(name);
      const start = this.offset;
      await this.write(localHeader(fileName));
      const hash = createHash("sha256"); let crc = 0xffffffff; let size = 0;
      for await (const chunk of source) {
        this.options.signal?.throwIfAborted();
        size += chunk.length;
        if (size > EXPORT_STORAGE_MAX_BYTES) limit();
        crc = crc32(chunk, crc); hash.update(chunk);
        await this.write(chunk);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      await this.write(descriptor(crc, size));
      const central = centralHeader(fileName, crc, size, start);
      await this.directory(central);
      this.directoryHash.update(central);
      this.directorySize += central.length; this.count += 1;
      return { name, sizeBytes: size, sha256: `sha256:${hash.digest("hex")}` };
    } catch (error) { this.failed = true; throw error; }
    finally { this.busy = false; }
  }

  async finish(directorySource: AsyncIterable<Uint8Array>): Promise<ExportZipReceipt> {
    this.checkAvailable(); this.busy = true;
    try {
      const directoryOffset = this.offset; let copied = 0; const readHash = createHash("sha256");
      for await (const chunk of directorySource) { copied += chunk.length; readHash.update(chunk); await this.write(chunk); }
      if (copied !== this.directorySize || readHash.digest("hex") !== this.directoryHash.digest("hex")) throw new DataExportStorageError("DATA_EXPORT_DIRECTORY_MISMATCH");
      if (this.count >= 0xffff) await this.write(zip64End(this.count, copied, directoryOffset, this.offset));
      await this.write(zipEnd(this.count, copied, directoryOffset));
      this.finished = true;
      return { sizeBytes: this.offset, sha256: `sha256:${this.hash.digest("hex")}`, entries: this.count };
    } catch (error) { this.failed = true; throw error; }
    finally { this.busy = false; }
  }

  private checkAvailable() {
    if (this.busy || this.finished || this.failed) throw new DataExportStorageError("DATA_EXPORT_WRITER_STATE_INVALID");
    this.options.signal?.throwIfAborted();
  }
  private async write(chunk: Uint8Array) {
    this.options.signal?.throwIfAborted();
    if (this.offset + chunk.length > (this.options.maxBytes ?? EXPORT_STORAGE_MAX_BYTES)) limit();
    await this.output(chunk); this.hash.update(chunk); this.offset += chunk.length;
  }
}

function safeName(value: string): Buffer {
  if (!/^[A-Za-z0-9_./-]+$/.test(value) || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new DataExportStorageError("DATA_EXPORT_ENTRY_NAME_INVALID");
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 512) limit();
  return bytes;
}
function localHeader(name: Buffer): Buffer {
  const out = Buffer.alloc(30 + name.length);
  out.writeUInt32LE(0x04034b50, 0); out.writeUInt16LE(20, 4); out.writeUInt16LE(0x808, 6);
  out.writeUInt16LE(0x21, 12); out.writeUInt16LE(name.length, 26); name.copy(out, 30);
  return out;
}
function descriptor(crc: number, size: number): Buffer {
  const out = Buffer.alloc(16); out.writeUInt32LE(0x08074b50, 0); out.writeUInt32LE(crc, 4);
  out.writeUInt32LE(size, 8); out.writeUInt32LE(size, 12); return out;
}
function centralHeader(name: Buffer, crc: number, size: number, offset: number): Buffer {
  const out = Buffer.alloc(46 + name.length);
  out.writeUInt32LE(0x02014b50, 0); out.writeUInt16LE((3 << 8) | 20, 4); out.writeUInt16LE(20, 6);
  out.writeUInt16LE(0x808, 8); out.writeUInt16LE(0x21, 14); out.writeUInt32LE(crc, 16);
  out.writeUInt32LE(size, 20); out.writeUInt32LE(size, 24); out.writeUInt16LE(name.length, 28);
  out.writeUInt32LE((0o100600 << 16) >>> 0, 38); out.writeUInt32LE(offset, 42); name.copy(out, 46);
  return out;
}
function zipEnd(entries: number, size: number, offset: number): Buffer {
  const out = Buffer.alloc(22); const large = entries >= 0xffff;
  out.writeUInt32LE(0x06054b50, 0); out.writeUInt16LE(large ? 0xffff : entries, 8); out.writeUInt16LE(large ? 0xffff : entries, 10);
  out.writeUInt32LE(large ? 0xffffffff : size, 12); out.writeUInt32LE(large ? 0xffffffff : offset, 16); return out;
}
function zip64End(entries: number, size: number, offset: number, endOffset: number): Buffer {
  const out = Buffer.alloc(76);
  out.writeUInt32LE(0x06064b50, 0); out.writeBigUInt64LE(BigInt(44), 4); out.writeUInt16LE(45, 12); out.writeUInt16LE(45, 14);
  out.writeBigUInt64LE(BigInt(entries), 24); out.writeBigUInt64LE(BigInt(entries), 32);
  out.writeBigUInt64LE(BigInt(size), 40); out.writeBigUInt64LE(BigInt(offset), 48);
  out.writeUInt32LE(0x07064b50, 56); out.writeBigUInt64LE(BigInt(endOffset), 64); out.writeUInt32LE(1, 72);
  return out;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array, initial: number): number {
  let crc = initial;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return crc >>> 0;
}
function limit(): never { throw new DataExportStorageError("DATA_EXPORT_LIMIT_EXCEEDED"); }
