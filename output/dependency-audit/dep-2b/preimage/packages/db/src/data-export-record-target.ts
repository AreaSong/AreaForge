import { DataExportError, type DataExportRecordInput } from "@areaforge/core";

export type ExportRecordDelegate = { findMany(args: unknown): Promise<unknown[]> };
export interface DataExportRecordConsumer { emit(record: DataExportRecordInput): Promise<void>; signal?: AbortSignal; batchSize?: number }
export type DataExportRecordTarget = DataExportRecordInput[] | DataExportRecordConsumer;

export async function appendRows(db: Record<string, ExportRecordDelegate>, records: DataExportRecordTarget, kind: string, delegateName: string, where: unknown, select: Record<string, unknown>, keyField = "id"): Promise<void> {
  const delegate = db[delegateName];
  if (!delegate) throw new DataExportError("DATA_EXPORT_MODEL_UNAVAILABLE");
  const batchSize = Array.isArray(records) ? 256 : records.batchSize ?? 1;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new DataExportError("DATA_EXPORT_LIMIT_EXCEEDED");
  let cursor: string | undefined;
  while (true) {
    if (!Array.isArray(records)) records.signal?.throwIfAborted();
    const rows = await delegate.findMany({ where, select, orderBy: { [keyField]: "asc" }, take: batchSize,
      ...(cursor ? { cursor: { [keyField]: cursor }, skip: 1 } : {}) });
    for (const row of rows) {
      const value = row as Record<string, unknown>;
      const id = typeof value[keyField] === "string" ? value[keyField] as string : null;
      if (!id || id === cursor) throw new DataExportError("DATA_EXPORT_RECORD_ID_INVALID");
      const record = { kind, id, data: toJsonSafe(value) };
      if (Array.isArray(records)) records.push(record);
      else { records.signal?.throwIfAborted(); await records.emit(record); }
      cursor = id;
    }
    if (rows.length < batchSize) break;
  }
}

export function metadataOnlyTarget(target: DataExportRecordTarget): DataExportRecordConsumer {
  return { signal: Array.isArray(target) ? undefined : target.signal, batchSize: Array.isArray(target) ? 256 : target.batchSize,
    emit: async record => {
      const value = { ...record, data: { ...(record.data as Record<string, unknown>), metadataOnly: true } };
      if (Array.isArray(target)) target.push(value); else await target.emit(value);
    } };
}

function toJsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    if ("toJSON" in value && typeof value.toJSON === "function") return toJsonSafe(value.toJSON());
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return value;
}
