import { DataDeleteError } from "@areaforge/core";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { deleteModel, deletePrimaryKey, deletionProtocolModels } from "./data-delete-models";
import { deletionRelationWhere } from "./data-delete-visibility-where";

type Args = Record<string, unknown>;
export type DeletionVisibilitySnapshot = { revision: bigint; fences: Map<string, Record<string, string>[]> };
const reads = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const identityModels = new Set(["User", "AuthSession", "AuthActionToken"]);

/** Web 查询统一排除冻结对象；独立执行器和控制面使用同一连接池的显式 raw client。 */
export function withDeletionVisibility(base: PrismaClient): PrismaClient {
  type Context = { client?: Prisma.TransactionClient; cached?: DeletionVisibilitySnapshot; batch?: boolean; fixed?: DeletionVisibilitySnapshot | null };
  const context = new AsyncLocalStorage<Context>();
  let cached: DeletionVisibilitySnapshot = { revision: BigInt(-1), fences: new Map() };
  async function snapshot(): Promise<DeletionVisibilitySnapshot | null> {
    const current = context.getStore();
    if (current?.batch) return current.fixed ?? null;
    const client = current?.client ?? base;
    // 不缓存“表不存在”，同一进程遇到 additive migration 后必须立即启用过滤。
    if (!await deletionVisibilityAvailable(client)) return null;
    const epoch = await client.dataDeletionVisibility.findUnique({ where: { id: 1 } });
    if (!epoch) throw new DataDeleteError("DATA_DELETE_VISIBILITY_UNAVAILABLE");
    let value = current?.client ? current.cached : cached;
    if (epoch.revision !== value?.revision) {
      const rows = await client.dataDeletionFence.findMany({ select: { model: true, keyJson: true } });
      const fences = new Map<string, Record<string, string>[]>();
      for (const row of rows) {
        const key = validFenceKey(row.model, row.keyJson);
        const keys = fences.get(row.model) ?? []; keys.push(key); fences.set(row.model, keys);
      }
      value = { revision: epoch.revision, fences };
      if (current?.client) current.cached = value; else cached = value;
    }
    return value!;
  }
  const extended = base.$extends({ name: "data-deletion-visibility", query: { $allModels: {
    async $allOperations({ model, operation, args, query }) {
      if (deletionProtocolModels.includes(model as never)) return query(args);
      let before = await snapshot();
      if (!before) return query(args);
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await query(deletionReadArgs(model, args as Args, before, reads.has(operation)) as typeof args);
        const after = await snapshot();
        if (after?.revision === before.revision) return result;
        // mutation 只执行一次；并发隐藏变化时丢弃响应，不把旧正文交付，也不重放写入。
        if (!reads.has(operation)) throw new DataDeleteError("DATA_DELETE_READ_BUSY", true);
        if (!after) throw new DataDeleteError("DATA_DELETE_VISIBILITY_UNAVAILABLE");
        before = after;
      }
      throw new DataDeleteError("DATA_DELETE_READ_BUSY", true);
    },
  } } });
  type Transaction = (input: ((tx: Prisma.TransactionClient) => Promise<unknown>) | unknown[], options?: unknown) => Promise<unknown>;
  const transaction = extended.$transaction.bind(extended) as unknown as Transaction;
  return new Proxy(extended, { get(target, key, receiver) {
    if (key === "$transaction") return async (input: Parameters<Transaction>[0], options?: unknown) => {
      if (typeof input === "function") return transaction(tx => context.run({ client: tx }, () => input(tx)), options);
      const before = await snapshot();
      const result = await context.run({ batch: true, fixed: before }, () => transaction(input, options));
      const after = await snapshot();
      if (before?.revision !== after?.revision) throw new DataDeleteError("DATA_DELETE_READ_BUSY", true);
      return result;
    };
    const value = Reflect.get(target, key, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as unknown as PrismaClient;
}

async function deletionVisibilityAvailable(base: Prisma.TransactionClient): Promise<boolean> {
  const [row] = await base.$queryRaw<Array<{ fence: boolean; visibility: boolean }>>`SELECT
    to_regclass('"DataDeletionFence"') IS NOT NULL AS fence, to_regclass('"DataDeletionVisibility"') IS NOT NULL AS visibility`;
  if (!row || (row.fence && !row.visibility)) throw new DataDeleteError("DATA_DELETE_VISIBILITY_MIGRATION_REQUIRED");
  return row.visibility;
}

/** 原生聚合查询必须在分页/计数之前过滤，并在查询后重验代次，不能只删 DTO 标签。 */
export async function queryDeletionVisibleRows<Row>(client: Prisma.TransactionClient,
  build: (visible: (model: Prisma.Sql, id: Prisma.Sql) => Prisma.Sql) => Prisma.Sql): Promise<Row[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await rawVisibilityRevision(client);
    const visible = (model: Prisma.Sql, id: Prisma.Sql) => before === null ? Prisma.sql`TRUE`
      : Prisma.sql`(${model}) IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "DataDeletionFence" deletion_fence
          WHERE deletion_fence.model = (${model}) AND deletion_fence."keyJson"->>'id' = (${id})
        )`;
    const rows = await client.$queryRaw<Row[]>(build(visible));
    if (await rawVisibilityRevision(client) === before) return rows;
  }
  throw new DataDeleteError("DATA_DELETE_READ_BUSY", true);
}

async function rawVisibilityRevision(client: Prisma.TransactionClient): Promise<bigint | null> {
  if (!await deletionVisibilityAvailable(client)) return null;
  const row = await client.dataDeletionVisibility.findUnique({ where: { id: 1 } });
  if (!row) throw new DataDeleteError("DATA_DELETE_VISIBILITY_UNAVAILABLE");
  return row.revision;
}

export function deletionReadArgs(model: string, args: Args, snapshot: DeletionVisibilitySnapshot, filterRoot = true): Args {
  if (snapshot.fences.size === 0) return args;
  const result = { ...args };
  if (args.where) result.where = deletionRelationWhere(model, args.where as Args, child => hiddenPredicate(child, snapshot));
  const predicate = hiddenPredicate(model, snapshot);
  // 保留顶层唯一键及原有 AND/OR（尤其 owner/tenant 条件），仅追加不可见条件。
  if (predicate && filterRoot) {
    const original = result.where as Args | undefined;
    const previous = original?.AND === undefined ? [] : Array.isArray(original.AND) ? original.AND : [original.AND];
    result.where = { ...original, AND: [...previous, predicate] };
  }
  for (const mode of ["include", "select"]) {
    if (result[mode] && typeof result[mode] === "object") result[mode] = nestedSelection(model, result[mode] as Args, snapshot);
  }
  return result;
}

function nestedSelection(model: string, selection: Args, snapshot: DeletionVisibilitySnapshot): Args {
  const result = { ...selection }; const fields = deleteModel(model).fields;
  for (const [name, value] of Object.entries(selection)) {
    if (!value) continue;
    if (name === "_count") { result[name] = countSelection(model, value, snapshot); continue; }
    const field = fields.find(candidate => candidate.name === name && candidate.kind === "object");
    if (!field) continue;
    const child = deletionReadArgs(field.type, value === true ? {} : value as Args, snapshot);
    result[name] = Object.keys(child).length ? child : true;
  }
  return result;
}

function countSelection(model: string, selection: unknown, snapshot: DeletionVisibilitySnapshot): unknown {
  const fields = deleteModel(model).fields.filter(field => field.kind === "object" && field.isList);
  const selected = selection === true ? Object.fromEntries(fields.map(field => [field.name, true])) : (selection as Args)?.select as Args | undefined;
  if (!selected) return selection;
  const result = { ...selected };
  for (const field of fields) {
    const value = selected[field.name]; const predicate = hiddenPredicate(field.type, snapshot);
    if (!value || !predicate) continue;
    const original = value === true ? {} : value as Args;
    result[field.name] = { ...original, where: { AND: [...(original.where ? [original.where] : []), predicate] } };
  }
  return { select: result };
}

function hiddenPredicate(model: string, snapshot: DeletionVisibilitySnapshot): Args | null {
  const keys = snapshot.fences.get(model);
  if (!keys?.length || identityModels.has(model)) return null;
  const primary = deletePrimaryKey(model);
  if (primary.length === 1) return { [primary[0]!]: { notIn: keys.map(key => key[primary[0]!]!) } };
  return { NOT: keys };
}

function validFenceKey(model: string, value: unknown): Record<string, string> {
  const fields = deletePrimaryKey(model);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DataDeleteError("DATA_DELETE_FENCE_CHANGED");
  const key = value as Record<string, string>;
  if (Object.keys(key).length !== fields.length || fields.some(field => typeof key[field] !== "string")) throw new DataDeleteError("DATA_DELETE_FENCE_CHANGED");
  return key;
}
