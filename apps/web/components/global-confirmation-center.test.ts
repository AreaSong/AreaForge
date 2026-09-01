import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadSource(relPath: string): string {
  const normalized = relPath.replace(/^apps\/web\//, "");
  const candidates = [
    resolve(process.cwd(), relPath),
    resolve(process.cwd(), normalized),
    resolve(process.cwd(), "apps/web", normalized),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  throw new Error(`Could not find source file for ${relPath}`);
}

test("GlobalConfirmationCenter: Decision List renders structured subtle cards with glowing icon containers", () => {
  const source = loadSource("components/global-confirmation-center.tsx");

  // 1. Grid of decision cards replacing raw divide-y
  assert.match(source, /<div className="grid grid-cols-1 gap-3">/);
  assert.match(source, /<Card[\s\S]*variant="subtle"[\s\S]*padding="md"/);

  // 2. Glowing icon container
  assert.match(source, /shadow-\[0_0_12px_rgba\(45,212,191,0\.15\)\]/);
  assert.match(source, /text-teal-300/);

  // 3. Status and revision badges
  assert.match(source, /<Badge tone=\{statusTone\}>\{statusLabel\}<\/Badge>/);
  assert.match(source, /<Badge tone="neutral">v\{props\.item\.revision\}<\/Badge>/);
});

test("GlobalConfirmationCenter: Detail view renders Master Card, metadata chips, and comparison guide", () => {
  const source = loadSource("components/global-confirmation-center.tsx");

  // 1. Master Card wrapper
  assert.match(source, /<Card variant="master" padding="lg" className="space-y-4">/);

  // 2. 3-card metadata grid
  assert.match(source, /grid grid-cols-2 gap-3 sm:grid-cols-3/);
  assert.match(source, /事项类型/);
  assert.match(source, /版本标识/);
  assert.match(source, /当前状态/);

  // 3. AI / Decision comparison guideline card
  assert.match(source, /决策比对与事实核验指引/);
  assert.match(source, /border-teal-500\/20 bg-teal-950\/10/);
});

test("ConfirmationDetailActions: Sticky PinnedActionBar docks safety notice and action buttons", () => {
  const source = loadSource("components/confirmation-detail-actions.tsx");

  // 1. Sticky PinnedActionBar integration
  assert.match(source, /<PinnedActionBar[\s\S]*mode="sticky"/);

  // 2. Safety notice on left
  assert.match(source, /确认将冻结当前事实/);
  assert.match(source, /驳回或作废不会静默删除来源记录/);

  // 3. Primary action with teal glow
  assert.match(source, /shadow-\[0_0_16px_rgba\(45,212,191,0\.35\)\]/);
  assert.match(source, /确认并冻结/);
});

test("ConfirmationCenter: Standalone fallback renders responsive multi-column Master Cards", () => {
  const source = loadSource("components/confirmation-center.tsx");

  // 1. Responsive 2-column grid
  assert.match(source, /grid grid-cols-1 gap-4 md:grid-cols-2/);

  // 2. Master Card texture
  assert.match(source, /<Card[\s\S]*variant="master"[\s\S]*padding="md"/);
  assert.match(source, /hover:border-teal-500\/30 hover:shadow-\[0_0_20px_rgba\(45,212,191,0\.15\)\]/);
});
