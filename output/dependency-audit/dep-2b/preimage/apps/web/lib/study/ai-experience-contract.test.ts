import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import {
  getAiAssistantContextStorageKey,
  isPersistedAiAssistantContext,
  normalizeAiAssistantContext,
} from "@/lib/client/ai-assistant-context";
import { getAiDraftFormStorageKey } from "@/lib/client/ai-draft-form-key";

function readComponent(name: string): string {
  return readFileSync(path.join(process.cwd(), "components", name), "utf8");
}

test("global AI keeps a dirty draft bound to its opening route", () => {
  const source = readComponent("global-ai-assistant.tsx");
  assert.match(source, /usePathname, useSearchParams/);
  assert.match(source, /const pageContextKey = `\$\{pathname\}\?\$\{searchParams\.toString\(\)\}`/);
  assert.match(source, /const \[assistantContextKey, setAssistantContextKey\] = useState\(pageContextKey\)/);
  assert.match(source, /const workState = assistantWindow\?\.workState \?\? assistantWorkState/);
  assert.match(source, /const preserveDraft = \(assistantWindow \|\| isQuickOpen\)[\s\S]*workState !== "clean"[\s\S]*workState !== "completed"/);
  assert.match(source, /if \(preserveDraft\) \{[\s\S]*minimizeWindow\("ai-assistant"\)/);
  assert.match(source, /draftContextKey=\{draftContextKey\}/);
  assert.match(source, /onDiscard: \(\) => discardWindowRef\.current\(\)/);
  assert.match(source, /loadAiAssistantContext\(userId\)/);
  assert.match(source, /saveAiAssistantContext\(userId/);
  assert.match(source, /if \(!assistantContextReady \|\| \(!assistantWindow && !isQuickOpen\)\) return/);
  assert.match(source, /removeAiAssistantContext\(userId\)/);
  assert.match(source, /function isAiAssistantUiTarget/);
});

test("opening global AI never collects page context automatically", () => {
  const source = readComponent("global-ai-assistant.tsx");
  const openStart = source.indexOf("function openAssistant(trigger");
  const openEnd = source.indexOf("const beginSelecting", openStart);
  const openAssistant = source.slice(openStart, openEnd);

  assert.ok(openStart >= 0 && openEnd > openStart);
  assert.match(openAssistant, /toggleTool\("ai-assistant", trigger\)/);
  assert.doesNotMatch(openAssistant, /addCurrentObject/);
  assert.match(source, /onClick=\{addCurrentObject\}>/);
  assert.match(source, /closeTool\(false\)/);
  assert.match(source, /minimizeWindow\("ai-assistant"\)/);
  assert.match(source, /if \(target === "window"\) focusWindow\("ai-assistant"\)/);
  assert.match(source, /if \(target === "tool"\) openTool\("ai-assistant"\)/);
});

test("global AI persists only bounded route and selection context", () => {
  assert.equal(getAiAssistantContextStorageKey("user-1"), "areaforge.ai-draft.assistant.user-1");
  assert.equal(isPersistedAiAssistantContext({
    contextKey: "/knowledge?",
    endpoint: "knowledge-card",
    items: [{ id: "selection-1", label: "选中文本", text: "操作系统调度" }],
  }), true);
  assert.equal(isPersistedAiAssistantContext({
    schemaVersion: 2,
    contextKey: "/knowledge?",
    endpoint: "knowledge-card",
    items: [{ identity: "selection-1", fingerprint: "element:one", label: "选中文本", text: "操作系统调度" }],
  }), true);
  assert.equal(isPersistedAiAssistantContext({
    contextKey: "/focus?",
    endpoint: "knowledge-card",
    items: [],
  }), true);
  assert.equal(isPersistedAiAssistantContext({
    contextKey: "/knowledge?",
    endpoint: "unknown",
    items: [],
  }), false);
  assert.equal(isPersistedAiAssistantContext({
    contextKey: "/knowledge?",
    endpoint: "knowledge-card",
    items: [{ id: "selection-1", label: "选中文本", text: "" }],
  }), false);
  const migrated = normalizeAiAssistantContext({
    contextKey: "/knowledge?",
    endpoint: "knowledge-card",
    items: [
      { id: "collision", label: "标题", text: "Aa" },
      { id: "collision", label: "标题", text: "BB" },
    ],
  });
  assert.equal(migrated?.schemaVersion, 2);
  assert.equal(migrated?.items.length, 2);
  assert.notEqual(migrated?.items[0]?.identity, migrated?.items[1]?.identity);
  assert.notEqual(migrated?.items[0]?.fingerprint, migrated?.items[1]?.fingerprint);
});

test("closeout auto-open only records an entry after its timer runs", () => {
  const source = readComponent("global-session-closeout.tsx");
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*autoOpenTimerRef\.current = null;\s*autoOpenedRef\.current = entryKey;\s*openWindow\("session-closeout"\)/);
  assert.doesNotMatch(source, /autoOpenedRef\.current = entryKey;\s*\/\/ Window persistence/);
});

test("AI draft persistence keys include an optional page context scope", () => {
  const panel = readComponent("ai-draft-panel.tsx");
  const workflow = readComponent("use-ai-draft-workflow.ts");
  assert.match(panel, /draftContextKey\?: string/);
  assert.match(panel, /const routeContextKey = `\$\{pathname\}\?\$\{searchParams\.toString\(\)\}`/);
  assert.match(panel, /useAiDraftWorkflow\(\{ \.\.\.props, routeContextKey \}\)/);
  assert.match(workflow, /const contextKey = options\.draftContextKey \?\? options\.routeContextKey/);
  assert.match(workflow, /getAiDraftFormStorageKey\(options\.endpoint, options\.userId, contextKey\)/);
  assert.match(workflow, /loadedDraftKeyRef\.current !== formDraftKey/);
  assert.equal(
    getAiDraftFormStorageKey("knowledge-card", "user-1", "/knowledge?:selection"),
    getAiDraftFormStorageKey("knowledge-card", "user-1", "/knowledge?:selection"),
  );
  assert.notEqual(
    getAiDraftFormStorageKey("knowledge-card", "user-1", "/knowledge?:selection"),
    getAiDraftFormStorageKey("knowledge-card", "user-1", "/today?:selection"),
  );
});

test("window content refresh does not steal focus from its active control", () => {
  const layer = readComponent("window-layer.tsx");
  const focusScope = readComponent("ui/focus-scope.ts");
  const system = readComponent("window-system.tsx");
  assert.match(layer, /const hasDefinition = definition !== null/);
  assert.match(layer, /const active = foregroundWindowKey !== null && hasDefinition && portalReady/);
  assert.match(layer, /useFocusScope\(\{[\s\S]*active,[\s\S]*panelRef,[\s\S]*onEscape: foregroundWindowKey \? \(\) => minimizeWindow\(foregroundWindowKey\)/);
  assert.match(focusScope, /\[\s*input\.active,[\s\S]*input\.panelRef,[\s\S]*input\.returnFocusRef/);
  assert.doesNotMatch(layer, /definitionVersion/);
  assert.match(system, /definitionsRef\.current\.get\(key\)\?\.onDiscard\?\.\(\)/);
});

test("window registry reconciles rendered state without rebroadcasting unchanged data", () => {
  const system = readComponent("window-system.tsx");
  const branch = system.slice(
    system.indexOf("const changedFromLocal"),
    system.indexOf("return { state: next, changedByUpdater };"),
  );

  assert.match(branch, /if \(changedFromLocal\) \{\s*installRegistry\(next, true\);/);
  assert.match(branch, /\} else \{[\s\S]*setRegistry\(next\);/);
  assert.doesNotMatch(branch.slice(branch.indexOf("} else {")), /broadcastRegistry|installRegistry/);
});

test("confirmation center keeps AI actions source-proof-only", () => {
  const source = readComponent("confirmation-detail-actions.tsx");
  assert.match(source, /action\.kind === "ai_draft"/);
  assert.match(source, /原始 <code>resultProof<\/code>/);
  assert.match(source, /打开来源页面/);
});
