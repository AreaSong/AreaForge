import type { DeleteRecord, DeleteTx } from "./data-delete-query";

const sourceReferences = {
  SUBJECT: ["Subject", "subjectId"], TASK: ["StudyTask", "taskId"], KNOWLEDGE_POINT: ["KnowledgePoint", "knowledgePointId"],
  NOTE: ["Note", "noteId"], MISTAKE: ["Mistake", "mistakeId"], RESOURCE: ["StudyResource", "resourceId"],
} as const;

/** 只顺着已授权源的精确 FK 删除派生副本，绝不从查看者分区反向扩到他人源。 */
export async function isAuthorizedSearchCopy(tx: DeleteTx, row: DeleteRecord, authorized: Iterable<DeleteRecord>): Promise<boolean> {
  if (row.model !== "WorkspaceSearchDocument") return false;
  const reference = sourceReferences[row.metadata.kind as keyof typeof sourceReferences];
  if (!reference || typeof row.metadata.sourceId !== "string" || row.metadata[reference[1]] !== row.metadata.sourceId
    || Object.values(sourceReferences).filter(([, key]) => row.metadata[key] !== null && row.metadata[key] !== undefined).length !== 1) return false;
  const source = [...authorized].find(item => item.model === reference[0] && item.key.id === row.metadata.sourceId);
  if (!source || typeof row.metadata.partitionId !== "string" || typeof row.metadata.workspaceId !== "string") return false;
  const partition = await tx.workspaceSearchPartition.findUnique({ where: { id: row.metadata.partitionId }, select: { workspaceId: true } });
  // 源可能已移到另一工作区；旧副本仍应被源删除权清除，但分区绑定不能伪造。
  return partition?.workspaceId === row.metadata.workspaceId;
}
