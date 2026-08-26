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

test("ActionCenterTodayView Architecture: Recommendation Hero uses Accent Dark Card and Teal Glow CTA", () => {
  const viewSource = loadSource("components/action-center-today-view.tsx");

  // 1. Accent card wrapper with glowing hero banner
  assert.match(viewSource, /<Card[\s\S]*variant="accent"[\s\S]*padding="lg"/);
  assert.match(viewSource, /border-teal-500\/30/);
  assert.match(viewSource, /bg-teal-400\/10/);
  assert.match(viewSource, /text-teal-300/);

  // 2. Primary CTA button with 20px teal outer glow
  assert.match(viewSource, /shadow-\[0_0_20px_rgba\(45,212,191,0\.35\)\]/);
  assert.match(viewSource, /active:scale-\[0\.98\]/);
});

test("ActionCenterTodayView Architecture: Learning Loop Data Board uses Master SectionCard and 4-card subtle grid", () => {
  const supportSource = loadSource("components/action-center-today-support.tsx");

  // 1. Master SectionCard container
  assert.match(supportSource, /<SectionCard[\s\S]*variant="master"[\s\S]*padding="md"/);

  // 2. 4-card subtle grid tokens
  assert.match(supportSource, /grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4/);
  assert.match(supportSource, /<Card[\s\S]*variant="subtle"[\s\S]*padding="sm"/);

  // 3. Metric dimensions
  assert.match(supportSource, /实际投入/);
  assert.match(supportSource, /有效学习/);
  assert.match(supportSource, /有效段数/);
  assert.match(supportSource, /低效补充/);
});

test("ActionCenterTodayView Architecture: QueueList uses 2-column responsive task cards and empty state", () => {
  const supportSource = loadSource("components/action-center-today-support.tsx");

  // 1. 2-column responsive grid replacing flat divide-y
  assert.match(supportSource, /grid grid-cols-1 gap-3\.5 md:grid-cols-2/);
  assert.match(supportSource, /<Card[\s\S]*variant="subtle"[\s\S]*padding="md"/);
  assert.match(supportSource, /hover:border-white\/10 hover:bg-white\/\[0\.04\]/);

  // 2. Soft dependency alert callout
  assert.match(supportSource, /border-amber-400\/20 bg-amber-400\/5/);
  assert.match(supportSource, /item\.softDependencyHint/);

  // 3. Subtle Card empty state
  assert.match(supportSource, /<Card variant="subtle" padding="lg"/);
  assert.match(supportSource, /当前推荐之外没有待办/);
});

test("ActionCenterTodayView Architecture: SubjectTimerList uses Master Card and 7-day progress bar", () => {
  const supportSource = loadSource("components/action-center-today-support.tsx");

  // 1. Master Card disclosure container
  assert.match(supportSource, /<Card variant="master" padding="none"/);
  assert.match(supportSource, /临时专注计时/);

  // 2. 7-day momentum progress bar
  assert.match(supportSource, /7日投入热度/);
  assert.match(supportSource, /bg-gradient-to-r from-teal-500\/60 to-teal-300/);
});

test("ActionCenterTodayView Architecture: Sticky PinnedActionBar docks at viewport bottom with quick actions", () => {
  const viewSource = loadSource("components/action-center-today-view.tsx");

  // 1. Sticky PinnedActionBar
  assert.match(viewSource, /<PinnedActionBar[\s\S]*mode="sticky"/);

  // 2. Summary stats on left slot
  assert.match(viewSource, /今日投入/);
  assert.match(viewSource, /有效学习/);
  assert.match(viewSource, /计划/);

  // 3. Action buttons on right slot
  assert.match(viewSource, /创建最小任务/);
  assert.match(viewSource, /快速复盘/);
  assert.match(viewSource, /开始今日推荐/);
});
