import test from "node:test";
import assert from "node:assert/strict";
import { clampCommandIndex, composeGlobalCommands, filterGlobalCommands, getGlobalCommandHref, GLOBAL_COMMANDS, normalizeCommandText, resolveGlobalCommand, tokenizeCommandArguments } from "./command-palette";

test("command palette normalizes aliases and whitespace", () => {
  assert.equal(normalizeCommandText("  $TODAY   "), "$today");
  assert.deepEqual(filterGlobalCommands("$today")[0]?.id, "today");
  assert.deepEqual(filterGlobalCommands("/start_to_learn now")[0]?.id, "start-learning");
});

test("command palette exposes a small extensible initial registry", () => {
  const ids = GLOBAL_COMMANDS.map((command) => command.id);
  assert.deepEqual(ids, [
    "today",
    "start-learning",
    "knowledge",
    "test",
    "roadmap",
    "settings",
    "settings-ai",
    "confirmations",
    "ai-assistant",
    "recovery-help",
    "quick-create",
  ]);
  assert.equal(GLOBAL_COMMANDS.find((command) => command.id === "settings")?.href, "/settings");
  assert.equal(filterGlobalCommands("不存在").length, 0);
});

test("command palette clamps a stale keyboard selection after filtering", () => {
  assert.equal(clampCommandIndex(4, 2), 1);
  assert.equal(clampCommandIndex(-1, 2), 0);
  assert.equal(clampCommandIndex(Number.NaN, 2), 0);
  assert.equal(clampCommandIndex(4, 0), 0);
});

test("command palette preserves command arguments and exposes a safe execution href", () => {
  assert.deepEqual(tokenizeCommandArguments(`now --subject="操作系统"`), ["now", "--subject=操作系统"]);
  const resolved = resolveGlobalCommand("/start_to_learn now --subject=操作系统");
  assert.equal(resolved?.definition.id, "start-learning");
  assert.deepEqual(resolved?.execution.args, ["now", "--subject=操作系统"]);
  assert.equal(resolved?.execution.namedArgs.subject, "操作系统");
  assert.equal(getGlobalCommandHref(resolved!.definition, resolved!.execution), "/focus?mode=now");
});

test("command palette resolves the longest explicit alias before fuzzy matching", () => {
  const resolved = resolveGlobalCommand("settings ai");
  assert.equal(resolved?.definition.id, "settings-ai");
  assert.equal(resolveGlobalCommand("  "), null);
});

test("command registry keeps module extensions isolated and deduplicated", () => {
  const extended = composeGlobalCommands(GLOBAL_COMMANDS, [
    { id: "knowledge-search", label: "搜索知识", description: "搜索当前知识库", aliases: ["$k"] },
    { id: "today", label: "重复今日", description: "不能覆盖基础命令", aliases: ["duplicate"] },
  ]);
  assert.equal(extended.find((command) => command.id === "knowledge-search")?.label, "搜索知识");
  assert.equal(extended.filter((command) => command.id === "today").length, 1);
});
