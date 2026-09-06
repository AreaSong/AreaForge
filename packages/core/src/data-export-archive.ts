import {
  createDataExportManifest,
  hashDataExportBytes,
  hashDataExportManifest,
  hashDataExportValue,
  type CreateDataExportManifestInput,
  type DataExportManifest,
  type DataExportRecordInput,
} from "./data-lifecycle";

export interface DataExportArchive {
  protocol: "areaforge-data-export-archive";
  schemaVersion: 1;
  manifest: DataExportManifest;
  manifestSha256: string;
  archiveSha256: string;
  contentType: "application/zip";
  fileName: string;
  bytes: Uint8Array;
  entries: readonly string[];
}

export interface DataExportArchiveSink {
  put(input: { fileName: string; contentType: "application/zip"; bytes: Uint8Array; manifestSha256: string; archiveSha256: string }): Promise<void>;
}

/** Build a deterministic, uncompressed ZIP entirely from already-redacted memory records. */
export function createDataExportArchive(input: CreateDataExportManifestInput): DataExportArchive {
  const manifest = createDataExportManifest(input);
  const manifestSha256 = hashDataExportManifest(manifest);
  const files = [
    { name: "manifest.json", value: manifest },
    ...manifest.entries.map((entry) => ({ name: `entries/${safePathPart(entry.kind)}/${safePathPart(entry.id)}.json`, value: entry.data })),
  ];
  const bytes = buildStoredZip(files.map((file) => ({ name: file.name, bytes: utf8(JSON.stringify(file.value)) })));
  return {
    protocol: "areaforge-data-export-archive",
    schemaVersion: 1,
    manifest,
    manifestSha256,
    archiveSha256: hashDataExportBytes(bytes),
    contentType: "application/zip",
    fileName: `areaforge-${input.scope}-${safePathPart(input.generatedAt)}.zip`,
    bytes,
    entries: files.map((file) => file.name),
  };
}

export const buildDataExportArchive = createDataExportArchive;

/** Write only through an injected sink; this function has no filesystem or network capability. */
export async function writeDataExportArchive(archive: DataExportArchive, sink: DataExportArchiveSink): Promise<void> {
  await sink.put({
    fileName: archive.fileName,
    contentType: archive.contentType,
    bytes: new Uint8Array(archive.bytes),
    manifestSha256: archive.manifestSha256,
    archiveSha256: archive.archiveSha256,
  });
}

function safePathPart(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || /[^A-Za-z0-9._:-]/.test(normalized)) {
    return hashDataExportValue(normalized).slice(7, 23);
  }
  return normalized;
}

function utf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return Uint8Array.from(bytes);
}

function buildStoredZip(files: readonly { name: string; bytes: Uint8Array }[]): Uint8Array {
  if (new Set(files.map((file) => file.name)).size !== files.length) {
    throw new TypeError("Export archive entry names must be unique.");
  }
  const locals: number[][] = [];
  const centrals: number[][] = [];
  let offset = 0;
  for (const file of files) {
    const name = utf8(file.name);
    const crc = crc32(file.bytes);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(file.bytes.length), ...u32(file.bytes.length), ...u16(name.length), ...u16(0), ...name, ...file.bytes];
    const central = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(file.bytes.length), ...u32(file.bytes.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name];
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBytes = centrals.flat();
  const localBytes = locals.flat();
  return Uint8Array.from([...localBytes, ...centralBytes, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralBytes.length), ...u32(localBytes.length), ...u16(0)]);
}

function u16(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff]; }
function u32(value: number): number[] { return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]; }

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type { DataExportRecordInput };
