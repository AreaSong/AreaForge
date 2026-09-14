import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("删除控制路由坚持会话、近期重新验证、严格字段及 revision，Web 不运行删除器", async () => {
  for (const route of ["route.ts", "preview/route.ts", "[intentId]/route.ts"]) {
    const source = await readFile(path.join(root, "app/api/system/deletions", route), "utf8");
    assert.match(source, /requireApiUser/); assert.match(source, /requireRecentReauthentication/);
    assert.doesNotMatch(source, /child_process|unlink|rmSync|executeDatabaseDeletion|runDatabaseDeleteWorker/);
  }
  const control = await readFile(path.join(root, "app/api/system/deletions/[intentId]/route.ts"), "utf8");
  assert.match(control, /expectedRevision/); assert.match(control, /\.strict\(\)/);
});
test("账户退出后的回执仅为 POST 最小状态读取，token 不在 URL", async () => {
  const route = await readFile(path.join(root, "app/api/system/deletions/receipt/route.ts"), "utf8");
  assert.match(route, /requireSameOrigin/); assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET|controlUserDeletion|createUserDeletion|searchParams/);
  const adapter = await readFile(path.join(root, "lib/api/data-deletion.ts"), "utf8");
  assert.match(adapter, /createJsonRequest\("POST", \{ id, token \}\)/);
});
test("删除界面范围切换清空目标，普通刷新失败不冒充会话失效", async () => {
  const source = await readFile(path.join(root, "components/data-deletion-center.tsx"), "utf8");
  assert.match(source, /candidates\.some\(row => row\.id === resourceId\)/);
  assert.match(source, /setScope\(event\.target\.value as DeletionScope\); setCandidates\(\[\]\); setResourceId\(""\)/);
  assert.match(source, /if \(!isUnauthorized\(result\)\)/);
  assert.match(source, /preview\.targetLabel/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|clipboard|receiptToken\}<|JSON\.stringify\(identity\)/);
});
