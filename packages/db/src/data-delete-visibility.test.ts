import assert from "node:assert/strict";
import test from "node:test";
import { deletionReadArgs, queryDeletionVisibleRows } from "./data-delete-visibility";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
const snapshot = { revision: 1n, fences: new Map([["Note", [{ id: "private-note" }]]]) };

test("回收站过滤保留原 owner/tenant AND、OR 和唯一键，不修改调用方输入", () => {
  const args = { where: { id: "private-note", AND: [{ ownerUserId: "owner" }, { subject: { workspaceId: "workspace" } }], OR: [{ title: "allowed" }] } };
  const before = JSON.stringify(args);
  const rewritten = deletionReadArgs("Note", args, snapshot) as { where: typeof args.where & { AND: unknown[] } };
  assert.equal(rewritten.where.id, "private-note");
  assert.deepEqual(rewritten.where.AND[0], args.where.AND[0]);
  assert.match(JSON.stringify(rewritten.where.AND[1]), /"workspaceId":"workspace"/);
  assert.deepEqual(rewritten.where.OR, args.where.OR);
  assert.equal(rewritten.where.AND.length, 3);
  assert.equal(JSON.stringify(args), before);
});

test("嵌套列表与关系计数排除回收站，但保留原过滤条件", () => {
  const where = { ownerUserId: "owner" };
  const args = { include: { notes: { where }, _count: { select: { notes: { where } } } } };
  const rewritten = deletionReadArgs("Subject", args, snapshot) as typeof args;
  assert.equal(rewritten.include.notes.where.ownerUserId, "owner");
  assert.match(JSON.stringify(rewritten.include._count), /private-note/);
  assert.match(JSON.stringify(rewritten.include._count), /ownerUserId/);
});

test("不可见条件不抹除 to-one 既有条件，身份读取仍支持取消和重新验证", () => {
  const source = { include: { note: { where: { ownerUserId: "owner" } } } };
  const rewritten = deletionReadArgs("Attachment", source, snapshot) as typeof source;
  assert.equal(rewritten.include.note.where.ownerUserId, "owner");
  assert.match(JSON.stringify(rewritten), /private-note/);
  const identity = { where: { id: "actor" } };
  assert.deepEqual(deletionReadArgs("User", identity, { revision: 1n, fences: new Map([["User", [{ id: "actor" }]]]) }), identity);
});

test("关系量词只针对可见子集，身份 mutation 的关联返回也过滤", () => {
  const args = { where: { notes: { some: { content: { contains: "private" } } } } };
  assert.match(JSON.stringify(deletionReadArgs("Subject", args, snapshot)), /private-note/);
  const every = deletionReadArgs("Subject", { where: { notes: { every: { title: "required" } } } }, snapshot);
  assert.match(JSON.stringify(every), /"OR"/);
  const mutation = deletionReadArgs("User", { where: { id: "owner" }, data: { authRevision: { increment: 1 } }, include: { ownedNotes: true } }, snapshot, false);
  assert.match(JSON.stringify(mutation), /private-note/);
});

test("空栅栏不改查询，其他模型的 null/undefined 条件仍完整保留", () => {
  const empty = { revision: 0n, fences: new Map() };
  const input = { where: { AND: undefined, workspace: { isNot: null } } };
  assert.deepEqual(deletionReadArgs("Subject", input, empty), input);
  assert.match(JSON.stringify(deletionReadArgs("Subject", input, snapshot)), /"isNot":null/);
  const combined = deletionReadArgs("Attachment", { where: { note: { isNot: null, is: { ownerUserId: "owner" } } } }, snapshot);
  assert.match(JSON.stringify(combined), /ownerUserId/);
});

function rawClient(revisions: bigint[], available = true) {
  let queries = 0; let reads = 0; const statements: Prisma.Sql[] = [];
  const client = { dataDeletionVisibility: { findUnique: async () => ({ revision: revisions[Math.min(reads++, revisions.length - 1)] }) },
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray) => {
      if (Array.isArray(query)) return [{ fence: available, visibility: available }];
      statements.push(query as Prisma.Sql); queries++;
      return queries === 1 ? [{ id: "stale-row" }] : [];
    } } as unknown as PrismaClient;
  return { client, statements, queries: () => queries };
}
const rawQuery = (visible: (model: Prisma.Sql, id: Prisma.Sql) => Prisma.Sql) => Prisma.sql`SELECT id FROM "Note" n WHERE ${visible(Prisma.sql`${"Note"}`, Prisma.sql`n.id`)}`;

test("原生查询在计数/分页前添加 SQL 栅栏，代次变化时丢弃旧结果并重新读取", async () => {
  const fixture = rawClient([1n, 2n, 2n, 2n]);
  assert.deepEqual(await queryDeletionVisibleRows(fixture.client, rawQuery), []);
  assert.equal(fixture.queries(), 2); assert.match(fixture.statements[0]!.sql, /NOT EXISTS[\s\S]*DataDeletionFence/);
  assert.match(fixture.statements[0]!.sql, /IS NOT NULL/); assert.ok(fixture.statements[0]!.values.includes("Note"));
});
test("原生查询兼容未迁移库但不缓存缺表，持续代次变化会拒绝返回", async () => {
  const old = rawClient([0n], false);
  assert.deepEqual(await queryDeletionVisibleRows(old.client, rawQuery), [{ id: "stale-row" }]);
  assert.doesNotMatch(old.statements[0]!.sql, /DataDeletionFence/);
  const changing = rawClient([1n, 2n, 3n, 4n, 5n, 6n]);
  await assert.rejects(() => queryDeletionVisibleRows(changing.client, rawQuery), /DATA_DELETE_READ_BUSY/);
  assert.equal(changing.queries(), 3);
});

test("必选关联将冻结过滤提升至父列表，不能注入不支持的 where", () => {
  const frozen = { revision: 1n, fences: new Map([["StudyResource", [{ id: "frozen-resource" }]]]) };
  const input = { where: { id: "note", ownerUserId: "owner" }, include: { studyResourceLinks: {
    where: { resourceId: "allowed" }, take: 1, include: { resource: { select: { title: true } } },
  } } };
  const result = deletionReadArgs("Note", input, frozen) as typeof input;
  assert.equal(result.where.ownerUserId, "owner");
  assert.equal(result.include.studyResourceLinks.take, 1);
  assert.match(JSON.stringify(result.include.studyResourceLinks.where), /frozen-resource/);
  assert.equal("where" in result.include.studyResourceLinks.include.resource, false);
});

import { checkedDeletionResult, deletionIdentitySelection } from "./data-delete-result-visibility";
test("omit 身份补投影保留业务省略、false 和合法嵌套选择且不修改输入", () => {
  const args = { omit: { id: true, content: true }, include: { subject: { omit: { id: true, name: false } }, owner: { select: { displayName: true } } } };
  const before = structuredClone(args);
  const selected = deletionIdentitySelection("Note", args);
  assert.deepEqual(args, before);
  assert.deepEqual(selected.omit, { id: false, content: true });
  const value = { id: "note", title: "visible", subject: { id: "subject", name: "visible" }, owner: { id: "user", displayName: "visible" } };
  assert.deepEqual(checkedDeletionResult("Note", value, args, new Map()), { title: "visible", subject: { name: "visible" }, owner: { displayName: "visible" } });
  assert.deepEqual(checkedDeletionResult("Note", { id: "note", title: "visible" }, { omit: { id: false } }, new Map()), { id: "note", title: "visible" });
  assert.deepEqual(deletionReadArgs("Note", args, { revision: 0n, fences: new Map() }), args);
});
