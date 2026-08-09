import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import {
  getAiAssistantContextStorageKey,
  isPersistedAiAssistantContext,
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
  assert.match(source, /const preserveDraft = assistantWindow[\s\S]*assistantWindow\.workState !== "clean"[\s\S]*assistantWindow\.workState !== "completed"/);
  assert.match(source, /if \(preserveDraft\) \{[\s\S]*minimizeWindow\("ai-assistant"\)/);
  assert.match(source, /draftContextKey=\{draftContextKey\}/);
  assert.match(source, /onDiscard: \(\) => discardWindowRef\.current\(\)/);
  assert.match(source, /loadAiAssistantContext\(userId\)/);
  assert.match(source, /saveAiAssistantContext\(userId/);
  assert.match(source, /if \(!assistantContextReady \|\| !assistantWindow\) return/);
  assert.match(source, /removeAiAssistantContext\(userId\)/);
  assert.match(source, /function isAiAssistantUiTarget/);
});

test("opening global AI never collects page context automatically", () => {
  const source = readComponent("global-ai-assistant.tsx");
  const openStart = source.indexOf("function openAssistant()");
  const openEnd = source.indexOf("useEffect(() => {", openStart);
  const openAssistant = source.slice(openStart, openEnd);

  assert.ok(openStart >= 0 && openEnd > openStart);
  assert.match(openAssistant, /openWindow\("ai-assistant"\)/);
  assert.doesNotMatch(openAssistant, /addCurrentObject/);
  assert.match(source, /onClick=\{addCurrentObject\}>/);
});

test("global AI persists only bounded route and selection context", () => {
  assert.equal(getAiAssistantContextStorageKey("user-1"), "areaforge.ai-draft.assistant.user-1");
  assert.equal(isPersistedAiAssistantContext({
    contextKey: "/knowledge?",
    endpoint: "knowledge-card",
    items: [{ id: "selection-1", label: "选中文本", text: "操作系统调度" }],
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
});

test("closeout auto-open only records an entry after its timer runs", () => {
  const source = readComponent("global-session-closeout.tsx");
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*autoOpenTimerRef\.current = null;\s*autoOpenedRef\.current = entryKey;\s*openWindow\("session-closeout"\)/);
  assert.doesNotMatch(source, /autoOpenedRef\.current = entryKey;\s*\/\/ Window persistence/);
});

test("AI draft persistence keys include an optional page context scope", () => {
  const source = readComponent("ai-draft-panel.tsx");
  assert.match(source, /draftContextKey\?: string/);
  assert.match(source, /getAiDraftFormStorageKey\([\s\S]*props\.draftContextKey \?\? routeContextKey/);
  assert.match(source, /loadedDraftKeyRef\.current !== formDraftKey/);
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
  const system = readComponent("window-system.tsx");
  assert.match(layer, /const hasDefinition = definition !== null/);
  assert.match(layer, /\}, \[foregroundWindowKey, hasDefinition\]\)/);
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
