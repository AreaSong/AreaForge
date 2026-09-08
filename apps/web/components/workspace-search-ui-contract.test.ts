import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(componentsRoot, "..");

test("global shell wires the selected workspace into latest-wins search", async () => {
  const [shell, topBar, island, hook, adapter] = await Promise.all([
    readFile(path.join(componentsRoot, "app-shell.tsx"), "utf8"),
    readFile(path.join(componentsRoot, "global-top-bar.tsx"), "utf8"),
    readFile(path.join(componentsRoot, "dynamic-island.tsx"), "utf8"),
    readFile(path.join(componentsRoot, "use-workspace-search-commands.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/api/search.ts"), "utf8"),
  ]);
  assert.match(shell, /workspaceId=\{status\.workspaceId\}/);
  assert.match(topBar, /workspaceId=\{props\.workspaceId\}/);
  assert.match(island, /useWorkspaceSearchCommands\(props\.workspaceId, query, resetSearchSelection\)/);
  assert.match(hook, /createLatestOperationGate/);
  assert.match(hook, /setTimeout/);
  assert.match(adapter, /requestApiResult/);
  assert.doesNotMatch(hook, /fetch\(/);
});

test("global search exposes loading and recovery copy without persisting query", async () => {
  const [hook, list] = await Promise.all([
    readFile(path.join(componentsRoot, "use-workspace-search-commands.ts"), "utf8"),
    readFile(path.join(componentsRoot, "dynamic-island-hub-nav.tsx"), "utf8"),
  ]);
  assert.match(list, /正在搜索当前工作区/);
  assert.match(list, /工作区搜索暂时不可用，命令仍可使用/);
  assert.match(list, /aria-live="polite"/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage|indexedDB/);
});
