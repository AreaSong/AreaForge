import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

function readComponent(name: string): string {
  return readFileSync(path.join(process.cwd(), "components", name), "utf8");
}

test("global AI context is isolated by the current route", () => {
  const source = readComponent("global-ai-assistant.tsx");
  assert.match(source, /usePathname, useSearchParams/);
  assert.match(source, /const pageContextKey = `\$\{pathname\}\?\$\{searchParams\.toString\(\)\}`/);
  assert.match(source, /setItems\(\[\]\)/);
  assert.match(source, /draftContextKey=\{`\$\{pageContextKey\}:\$\{selectedText\}`\}/);
  assert.match(source, /function isAiAssistantUiTarget/);
});

test("AI draft persistence keys include an optional page context scope", () => {
  const source = readComponent("ai-draft-panel.tsx");
  assert.match(source, /draftContextKey\?: string/);
  assert.match(source, /const draftScope = hashDraftContext\(props\.draftContextKey \?\? routeContextKey\)/);
  assert.match(source, /areaforge\.ai-draft\.form\.\$\{props\.endpoint\}\.\$\{props\.userId\}\.\$\{draftScope\}/);
  assert.match(source, /loadedDraftKeyRef\.current !== formDraftKey/);
});

test("confirmation center keeps AI actions source-proof-only", () => {
  const source = readComponent("confirmation-detail-actions.tsx");
  assert.match(source, /action\.kind === "ai_draft"/);
  assert.match(source, /原始 <code>resultProof<\/code>/);
  assert.match(source, /打开来源页面/);
});
