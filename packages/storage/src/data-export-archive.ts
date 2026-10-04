import type { FileHandle } from "node:fs/promises";
import { createExportFile, exportFileChunks, openExportSpool, publishExportFile, removeRegisteredExportFiles, storageError, writeExportBytes, DataExportStorageError, type DataExportStorageRoots } from "./data-export-files";
import { DataExportZipWriter, type ExportZipEntry } from "./data-export-zip";

export interface ExportEntryMetadata { kind: string; id: string; omittedFieldCount?: number; mimeType?: string }
export interface PrivateExportWriter {
  add(name: string, source: AsyncIterable<Uint8Array>, metadata: ExportEntryMetadata): Promise<ExportZipEntry>;
  finish(header: Record<string, unknown>): Promise<{ sizeBytes: number; sha256: string; entries: number; manifestSha256: string }>;
  close(): Promise<void>;
}

export async function createPrivateExportWriter(roots: DataExportStorageRoots, key: string, options: { signal?: AbortSignal; maxBytes?: number; maxEntries?: number } = {}): Promise<PrivateExportWriter> {
  const handles: FileHandle[] = [];
  const close = async () => { await Promise.all(handles.map(handle => handle.close().catch(() => undefined))); };
  try {
    const output = await createExportFile(roots.exportRoot, key, ".zip.part"); handles.push(output);
    const directory = await createExportFile(roots.exportRoot, key, ".central"); handles.push(directory);
    const manifest = await createExportFile(roots.exportRoot, key, ".manifest"); handles.push(manifest);
    const zip = new DataExportZipWriter(chunk => writeExportBytes(output, chunk), chunk => writeExportBytes(directory, chunk), options);
    let manifestEntries = 0; let manifestBytes = 0; let failed = false;
    return {
      add: async (name, source, metadata) => {
        try {
          if (failed) throw new DataExportStorageError("DATA_EXPORT_WRITER_STATE_INVALID");
          options.signal?.throwIfAborted();
          const entry = await zip.add(name, source);
          const record = manifestRecord(entry, metadata);
          const bytes = Buffer.from(`${manifestEntries ? "," : ""}${JSON.stringify(record)}`);
          manifestBytes += bytes.length;
          if (manifestBytes > 64 * 1024 * 1024) throw new DataExportStorageError("DATA_EXPORT_LIMIT_EXCEEDED");
          await writeExportBytes(manifest, bytes); manifestEntries += 1;
          return entry;
        } catch (error) { failed = true; throw storageError(error); }
      },
      finish: async header => {
        try {
          if (failed) throw new DataExportStorageError("DATA_EXPORT_WRITER_STATE_INVALID");
          await manifest.sync();
          const source = await openExportSpool(roots.exportRoot, key, ".manifest"); handles.push(source);
          const metadata = JSON.parse(JSON.stringify(header)) as Record<string, unknown>;
          if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new DataExportStorageError("DATA_EXPORT_MANIFEST_INVALID");
          delete metadata.entries;
          const prefix = JSON.stringify({ ...metadata, entries: [] }).slice(0, -3) + "[";
          const manifestEntry = await zip.add("manifest.json", manifestChunks(prefix, source, options.signal));
          await directory.sync();
          const central = await openExportSpool(roots.exportRoot, key, ".central"); handles.push(central);
          const receipt = await zip.finish(exportFileChunks(central, options.signal));
          await output.sync(); await close();
          await publishExportFile(roots.exportRoot, key, options.signal);
          await removeRegisteredExportFiles(roots, key, [".central", ".manifest"]);
          return { ...receipt, manifestSha256: manifestEntry.sha256 };
        // 文件就位后仍可能失败；上层须保留 STAGING 意图并回收，不能凭文件存在发放下载。
        } catch (error) { await close(); throw storageError(error); }
      },
      close,
    };
  } catch (error) { await close(); throw storageError(error); }
}

export async function* exportJsonBytes(value: unknown): AsyncGenerator<Uint8Array> {
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json) > 8 * 1024 * 1024) throw new DataExportStorageError("DATA_EXPORT_LIMIT_EXCEEDED");
  const bytes = Buffer.from(json);
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) yield bytes.subarray(offset, offset + 64 * 1024);
}

async function* manifestChunks(prefix: string, handle: FileHandle, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  yield Buffer.from(prefix);
  yield* exportFileChunks(handle, signal);
  yield Buffer.from("]}");
}

function manifestRecord(entry: ExportZipEntry, metadata: ExportEntryMetadata) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(metadata.kind) || !/^[A-Za-z0-9_-]{1,128}$/.test(metadata.id)
    || (metadata.omittedFieldCount !== undefined && (!Number.isSafeInteger(metadata.omittedFieldCount) || metadata.omittedFieldCount < 0))) {
    throw new DataExportStorageError("DATA_EXPORT_MANIFEST_INVALID");
  }
  return { kind: metadata.kind, id: metadata.id, entryName: entry.name, sha256: entry.sha256, sizeBytes: entry.sizeBytes,
    ...(metadata.omittedFieldCount === undefined ? {} : { omittedFieldCount: metadata.omittedFieldCount }),
    ...(metadata.mimeType === undefined ? {} : { mimeType: metadata.mimeType }),
  };
}
