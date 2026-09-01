import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { retestStatusLabel } from "./retest-card";

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

test("Testing Center Overview Architecture: TestEntry uses Master Card with glowing teal hover effects and subtle rules card", () => {
  const source = loadSource("app/(app)/test/page.tsx");

  // 1. TestEntry uses Card variant master with glowing teal hover
  assert.match(source, /<Card[\s\S]*variant="master"/);
  assert.match(source, /hover:border-teal-400\/40/);
  assert.match(source, /hover:shadow-\[0_0_20px_rgba\(45,212,191,0\.15\)\]/);

  // 2. Rules section wrapped in subtle card
  assert.match(source, /<Card[\s\S]*variant="subtle"/);
  assert.match(source, /检验规则/);
  assert.match(source, /复测结果会更新知识点的掌握状态/);
});

test("Specialized Retests Architecture: RetestCard uses Master Card, status badge and responsive 2-column grid", () => {
  const cardSource = loadSource("components/retest-card.tsx");
  const pageSource = loadSource("app/(app)/test/retests/page.tsx");

  // 1. RetestCard container & badges
  assert.match(cardSource, /<Card[\s\S]*variant="master"/);
  assert.match(cardSource, /retestStatusLabel\(item\.status, item\.result\)/);
  assert.match(cardSource, /formatDateMonthDayPadded\(item\.nextDueAt\)/);
  assert.match(cardSource, /item\.pointTitles/);

  // 2. Pure logic test of retestStatusLabel
  assert.equal(retestStatusLabel("CLOSED", "PASSED"), "通过");
  assert.equal(retestStatusLabel("CLOSED", "PARTIAL"), "部分掌握");
  assert.equal(retestStatusLabel("CLOSED", "FAILED"), "未通过");
  assert.equal(retestStatusLabel("PENDING_REVIEW", null), "待确认");
  assert.equal(retestStatusLabel("IN_PROGRESS", null), "进行中");
  assert.equal(retestStatusLabel("DRAFT", null), "待开始");

  // 3. Retests Page multi-column grid
  assert.match(pageSource, /grid grid-cols-1 gap-4 md:grid-cols-2/);
  assert.match(pageSource, /<RetestCard key=\{item\.id\} item=\{item\} \/>/);
  assert.match(pageSource, /安排专项复测/);
});

test("Specialized Retests Create & Detail: Master Workstation & sticky PinnedActionBar", () => {
  const createFormSource = loadSource("components/knowledge-retest-create-form.tsx");
  const detailClientSource = loadSource("components/knowledge-retest-detail-client.tsx");

  // 1. Create Form uses Master Card workstation and sticky PinnedActionBar
  assert.match(createFormSource, /<Card[\s\S]*variant="master"/);
  assert.match(createFormSource, /<PinnedActionBar[\s\S]*mode="sticky"/);
  assert.match(createFormSource, /安排并开始复测/);

  // 2. Detail Client uses Master Card header, Subtle Card per point, and sticky PinnedActionBar
  assert.match(detailClientSource, /<Card[\s\S]*variant="master"/);
  assert.match(detailClientSource, /<Card[\s\S]*variant="subtle"/);
  assert.match(detailClientSource, /<PinnedActionBar[\s\S]*mode="sticky"/);
  assert.match(detailClientSource, /提交复测，进入确认/);
});

test("Simulation Exams Architecture: SimulationExamCard & Page multi-column battle report grid", () => {
  const cardSource = loadSource("components/simulation-exam-card.tsx");
  const pageSource = loadSource("lib/routes/test-simulations-page.tsx");

  // 1. SimulationExamCard variant and indicators
  assert.match(cardSource, /<Card[\s\S]*variant=\{primary \? "accent" : "master"\}/);
  assert.match(cardSource, /exam\.subjectResults/);
  assert.match(cardSource, /exam\.targetScore/);
  assert.match(cardSource, /exam\.actualScore/);

  // 2. Page multi-column battle report grid
  assert.match(pageSource, /grid grid-cols-1 gap-4 md:grid-cols-2/);
  assert.match(pageSource, /<SimulationExamCard exam=\{latestDraft\} primary \/>/);
  assert.match(pageSource, /<SimulationExamCard key=\{exam\.id\} exam=\{exam\} \/>/);
});

test("Simulation Detail Workspace & Editors: Step progress, Master Cards, loss items and PinnedActionBar", () => {
  const workspaceSource = loadSource("components/simulation-detail-workspace.tsx");
  const editorSource = loadSource("components/simulation-detail-subject-editor.tsx");
  const remediationSource = loadSource("components/simulation-detail-remediation.tsx");

  // 1. Workspace uses subtle progress card, subtle subject selection card, and sticky PinnedActionBar
  assert.match(workspaceSource, /<SimulationProgress/);
  assert.match(workspaceSource, /<Card[\s\S]*variant="subtle"/);
  assert.match(workspaceSource, /<PinnedActionBar[\s\S]*mode="sticky"/);
  assert.match(workspaceSource, /保存模拟结果/);

  // 2. Subject Editor uses Master Cards for 5 score/timing fields and loss items
  assert.match(editorSource, /<Card[\s\S]*variant="master"/);
  assert.match(editorSource, /grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5/);
  assert.match(editorSource, /结构化失分/);

  // 3. Remediation section uses Master Card workstation
  assert.match(remediationSource, /<Card[\s\S]*variant="master"/);
  assert.match(remediationSource, /选择补救动作/);
  assert.match(remediationSource, /将选中补救送入收件箱/);
});
