import { DataDeleteError, type DataDeleteItem, type DataDeleteTarget } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { deleteModel, deleteOwnerFields, deleteParentFields, deletePrimaryKey, deleteWorkspacePath } from "./data-delete-models";

export type DeleteTx = Prisma.TransactionClient;
export interface DeleteRecord extends DataDeleteItem { metadata: Record<string, unknown> }
export const quotedDeleteName = (name: string) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new DataDeleteError("DATA_DELETE_IDENTIFIER_INVALID");
  return Prisma.raw('"' + name + '"');
};

export function deleteKeyPredicate(key: Readonly<Record<string, string>>, alias = "s"): Prisma.Sql {
  if (!Object.keys(key).length) throw new DataDeleteError("DATA_DELETE_ITEM_INVALID");
  return Prisma.join(Object.entries(key).map(([field, value]) => Prisma.sql`${quotedDeleteName(alias)}.${quotedDeleteName(field)} = ${value}`), " AND ");
}

export function deletePathPredicate(model: string, path: string, value: string, alias = "s", depth = 0): Prisma.Sql {
  if (depth > 8) throw new DataDeleteError("DATA_DELETE_RELATION_DEPTH");
  const [head, ...rest] = path.split(".");
  const field = deleteModel(model).fields.find(candidate => candidate.name === head);
  if (!field) throw new DataDeleteError("DATA_DELETE_PARENT_INVALID");
  if (!rest.length) return Prisma.sql`${quotedDeleteName(alias)}.${quotedDeleteName(head!)} = ${value}`;
  if (!field.relationFromFields?.length) throw new DataDeleteError("DATA_DELETE_PARENT_INVALID");
  const next = "p" + depth;
  const joins = field.relationFromFields.map((child, index) => Prisma.sql`${quotedDeleteName(alias)}.${quotedDeleteName(child)} = ${quotedDeleteName(next)}.${quotedDeleteName(field.relationToFields![index]!)}`);
  return Prisma.sql`EXISTS (SELECT 1 FROM ${quotedDeleteName(field.type)} ${quotedDeleteName(next)} WHERE ${Prisma.join(joins, " AND ")} AND ${deletePathPredicate(field.type, rest.join("."), value, next, depth + 1)})`;
}

export function deleteOwnerPredicate(model: string, userId: string, alias = "s", depth = 0): Prisma.Sql {
  if (depth > 8) throw new DataDeleteError("DATA_DELETE_RELATION_DEPTH");
  const owner = deleteOwnerFields[model];
  if (owner) return deletePathPredicate(model, owner, userId, alias);
  const parent = deleteParentFields[model];
  if (!parent) return Prisma.sql`FALSE`;
  const field = deleteModel(model).fields.find(candidate => candidate.name === parent)!;
  if (!field?.relationFromFields?.length) throw new DataDeleteError("DATA_DELETE_PARENT_INVALID");
  const next = "o" + depth;
  const joins = field.relationFromFields.map((child, index) => Prisma.sql`${quotedDeleteName(alias)}.${quotedDeleteName(child)} = ${quotedDeleteName(next)}.${quotedDeleteName(field.relationToFields![index]!)}`);
  return Prisma.sql`EXISTS (SELECT 1 FROM ${quotedDeleteName(field.type)} ${quotedDeleteName(next)} WHERE ${Prisma.join(joins, " AND ")} AND ${deleteOwnerPredicate(field.type, userId, next, depth + 1)})`;
}

export function deleteScopePredicate(model: string, target: DataDeleteTarget): Prisma.Sql {
  const owner = deleteOwnerPredicate(model, target.requesterId);
  if (target.scope === "ACCOUNT") return owner;
  const workspace = deleteWorkspacePath(model);
  if (model === "Attachment") return Prisma.sql`(${owner}) AND ((${deletePathPredicate(model, "note.subject.workspaceId", target.workspaceId!)})
    OR EXISTS (SELECT 1 FROM "StudyResource" r WHERE r."attachmentId"=s.id AND r."ownerUserId"=${target.requesterId} AND r."workspaceId"=${target.workspaceId}))`;
  return workspace ? Prisma.sql`(${owner}) AND (${deletePathPredicate(model, workspace, target.workspaceId!)})` : Prisma.sql`FALSE`;
}

/** 哈希在数据库内计算；正文、密码、token 和密文不离开这条查询。 */
export async function readDeleteRecords(tx: DeleteTx, modelName: string, where: Prisma.Sql): Promise<DeleteRecord[]> {
  const model = deleteModel(modelName);
  const primary = deletePrimaryKey(modelName);
  const key = Prisma.sql`jsonb_build_object(${Prisma.join(primary.flatMap(field => [Prisma.sql`${field}::text`, Prisma.sql`s.${quotedDeleteName(field)}`]))})`;
  const metadataFields = model.fields.filter(field => field.kind !== "object" && (field.name.endsWith("Id") || field.name.endsWith("Ids")
    || ["id", "action", "state", "status", "queueVersion", "kind", "resourceType", "entityType", "sourceEntityType", "objectType", "sourceResourceType"].includes(field.name)));
  const metadata = metadataFields.length ? Prisma.sql`jsonb_build_object(${Prisma.join(metadataFields.flatMap(field => [Prisma.sql`${field.name}::text`, Prisma.sql`s.${quotedDeleteName(field.name)}`]))})` : Prisma.sql`'{}'::jsonb`;
  const volatileFields: Record<string, string[]> = {
    AuthSession: ["lastSeenAt", "reauthenticatedAt"],
    User: ["status", "authRevision", "passwordHash", "passwordChangedAt", "emailVerifiedAt", "updatedAt"],
    WorkspaceMembership: ["status", "role", "revision", "joinedAt", "leftAt", "removedAt", "updatedAt"],
  };
  const row = volatileFields[modelName] ? Prisma.sql`to_jsonb(s) - ARRAY[${Prisma.join(volatileFields[modelName]!)}]::text[]` : Prisma.sql`to_jsonb(s)`;
  return tx.$queryRaw<DeleteRecord[]>(Prisma.sql`SELECT ${modelName}::text AS model, ${key} AS key,
    'sha256:' || encode(sha256(convert_to(${modelName}::text || ':' || (${key})::text, 'UTF8')), 'hex') AS "identityHash",
    'sha256:' || encode(sha256(convert_to((${row})::text, 'UTF8')), 'hex') AS "rowHash", ${metadata} AS metadata
    FROM ${quotedDeleteName(modelName)} s WHERE ${where} LIMIT 100001`);
}
