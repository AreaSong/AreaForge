import { DataExportError, type DataExportJobPayload } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";

/** 私有句柄读取的最小服务端描述；此类型不得送入通用 record/DTO/manifest 序列化。 */
export async function dataExportAttachmentSource(tx: Prisma.TransactionClient, payload: DataExportJobPayload, attachmentId: string) {
  const row = await tx.attachment.findFirst({ where: { id: attachmentId, ownerUserId: payload.requesterId, status: "READY",
    ...(payload.scope === "WORKSPACE" ? { OR: [{ note: { subject: { workspaceId: payload.workspaceId! } } }, { studyResource: { workspaceId: payload.workspaceId! } }] } : {}),
  }, select: { id: true, uri: true, sizeBytes: true, hash: true, mimeType: true } });
  if (!row) throw new DataExportError("DATA_EXPORT_ATTACHMENT_NOT_READY");
  return row;
}
