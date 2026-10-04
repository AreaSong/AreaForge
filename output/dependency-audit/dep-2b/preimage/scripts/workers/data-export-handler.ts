import { DATA_EXPORT_ARCHIVE_PROTOCOL, DATA_EXPORT_ARCHIVE_VERSION, DATA_EXPORT_POLICY_VERSION, DataExportError, portableDataExportRecord } from "../../packages/core/src/index";
import { assertDataExportAuthorization, beginDataExportArtifact, dataExportAttachmentSource, publishDataExportPackage, requireDataExportEnabled, streamDataExportRecords, type DataExportArchiveReceipt, type DataQueueClient } from "../../packages/db/src/index";
import { attachmentExportChunks, createPrivateExportWriter, dataExportStorageRoots, detectUploadMimeType, exportJsonBytes, parseAttachmentUri, DataExportStorageError, type DataExportStorageRoots, type PrivateExportWriter } from "../../packages/storage/src/index";
import { DataJobHandlerError, type DataJobHandler, type DataJobHandlerContext } from "./data-job-handler";

type Environment = Readonly<Record<string, string | undefined>>;

export function createDataExportHandler(client: DataQueueClient, env: Environment = process.env, limits: { maxBytes?: number; maxEntries?: number } = {}): DataJobHandler {
  if (!env.EXPORT_DIR || !env.UPLOAD_DIR) throw new DataJobHandlerError("DATA_EXPORT_STORAGE_CONFIG_REQUIRED", false);
  return { kind: "EXPORT", prepare: async context => {
    let writer: PrivateExportWriter | undefined;
    try {
      requireDataExportEnabled(env);
      const roots = await dataExportStorageRoots(env.EXPORT_DIR!, env.UPLOAD_DIR!);
      const prepared = await beginDataExportArtifact(client, context.lease, env);
      await context.heartbeat(0.1); context.signal.throwIfAborted(); requireDataExportEnabled(env);
      writer = await createPrivateExportWriter(roots, prepared.artifact.objectKey, { ...limits, signal: context.signal });
      const receipt = await writeSnapshot(client, { prepared, roots, writer, context, env });
      await context.heartbeat(0.8); context.signal.throwIfAborted(); requireDataExportEnabled(env);
      return async (tx, lockedJob) => {
        try {
          requireDataExportEnabled(env);
          await publishDataExportPackage(tx, lockedJob, { artifactId: prepared.artifact.id, leaseVersion: context.lease.leaseVersion, receipt }, env);
          requireDataExportEnabled(env);
        } catch (error) { throw handlerError(error); }
      };
    } catch (error) { await writer?.close(); throw handlerError(error); }
  } };
}

async function writeSnapshot(client: DataQueueClient, input: { prepared: Awaited<ReturnType<typeof beginDataExportArtifact>>; roots: DataExportStorageRoots; writer: PrivateExportWriter; context: DataJobHandlerContext; env: Environment }): Promise<DataExportArchiveReceipt> {
  const { prepared, roots, writer, context, env } = input;
  return client.$transaction(async tx => {
    const { payload, email } = await assertDataExportAuthorization(tx, prepared.job);
    const [clock] = await tx.$queryRaw<Array<{ at: Date }>>`SELECT transaction_timestamp() AS at`;
    const snapshotAt = clock!.at.toISOString();
    let recordCount = 0; let attachmentCount = 0; let omittedFieldCount = 0;
    await streamDataExportRecords(tx, { actor: { id: payload.requesterId, email }, workspaceIds: payload.authorization.workspaces.map(row => row.id),
      scope: payload.scope, includeData: true, signal: context.signal }, { emit: async source => {
      context.signal.throwIfAborted(); requireDataExportEnabled(env);
      const record = portableDataExportRecord(source);
      await writer.add(`entries/${record.kind}/${record.id}.json`, exportJsonBytes(record.data), { kind: record.kind, id: record.id, omittedFieldCount: record.omittedFieldCount });
      recordCount += 1; omittedFieldCount += record.omittedFieldCount;
      if (record.kind === "attachment" && (record.data as { status?: string }).status === "READY") {
        const file = await dataExportAttachmentSource(tx, payload, record.id);
        const storedName = parseAttachmentUri(file.uri); if (!storedName) throw new DataExportError("DATA_EXPORT_ATTACHMENT_MISMATCH");
        const extension = attachmentExtension(file.mimeType);
        if (!storedName.endsWith(`.${extension}`)) throw new DataExportError("DATA_EXPORT_ATTACHMENT_MISMATCH");
        const chunks = attachmentExportChunks(roots, { storedName, sizeBytes: file.sizeBytes, sha256: file.hash }, context.signal);
        await writer.add(`attachments/${record.id}.${extension}`, checkedAttachmentMime(chunks, file.mimeType, env), { kind: "attachmentFile", id: record.id, mimeType: file.mimeType });
        attachmentCount += 1;
      }
      if (recordCount === 1 || recordCount % 256 === 0) await context.heartbeat(0.25);
    } });
    const result = await writer.finish({ protocol: DATA_EXPORT_ARCHIVE_PROTOCOL, schemaVersion: DATA_EXPORT_ARCHIVE_VERSION, policyVersion: DATA_EXPORT_POLICY_VERSION,
      scope: payload.scope, snapshotAt, recordCount, attachmentCount, omittedFieldCount,
      consistency: "repeatable-read-records-and-verified-file-handles",
      exclusions: ["credentials-and-internal-storage", "other-users-private-content", "unscoped-workspace-audits", "non-ready-attachment-bodies", "foreign-context-is-metadata-only"] });
    return { sizeBytes: result.sizeBytes, sha256: result.sha256, manifestSha256: result.manifestSha256, recordCount, attachmentCount, omittedFieldCount, snapshotAt };
  }, { isolationLevel: "RepeatableRead", timeout: Math.max(1_000, Math.min(3_600_000, prepared.job.expiresAt.getTime() - Date.now())) });
}

async function* checkedAttachmentMime(source: AsyncIterable<Uint8Array>, mimeType: string, env: Environment) {
  let checked = false;
  const text = mimeType === "text/markdown" ? new TextDecoder("utf-8", { fatal: true }) : null;
  for await (const chunk of source) {
    requireDataExportEnabled(env);
    if (!checked && !text && detectUploadMimeType(chunk) !== mimeType) throw new DataExportError("DATA_EXPORT_ATTACHMENT_MISMATCH");
    if (text) { if (chunk.includes(0)) throw new DataExportError("DATA_EXPORT_ATTACHMENT_MISMATCH"); text.decode(chunk, { stream: true }); }
    checked = true; yield chunk;
  }
  if (text) text.decode();
  else if (!checked) throw new DataExportError("DATA_EXPORT_ATTACHMENT_MISMATCH");
}
function attachmentExtension(mimeType: string): string {
  const value = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf", "application/zip": "zip", "text/markdown": "md" } as Record<string, string>)[mimeType];
  if (!value) throw new DataExportError("DATA_EXPORT_ATTACHMENT_MISMATCH"); return value;
}
function handlerError(error: unknown): DataJobHandlerError {
  if (error instanceof DataExportError || error instanceof DataExportStorageError) return new DataJobHandlerError(error.code, error.retryable);
  if (error instanceof DataJobHandlerError) return error;
  return new DataJobHandlerError("DATA_EXPORT_PREPARE_FAILED", true);
}
