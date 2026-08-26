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

test("Knowledge Cards Architecture: NoteCard uses Master Dark Glass Card and responsive layout", () => {
  const source = loadSource("components/note-card.tsx");

  // 1. Master Dark Glass Card container
  assert.match(source, /<Card[\s\S]*variant="master"/);
  assert.match(source, /hover:border-white\/20/);

  // 2. Subject, mastery status, and review due badges
  assert.match(source, /labelMastery\(note\.masteryStatus\)/);
  assert.match(source, /note\.subjectName/);
  assert.match(source, /note\.nextReviewAt/);
  assert.match(source, /formatDate\(note\.nextReviewAt\)/);

  // 3. Attachments rendering
  assert.match(source, /formatBytes\(attachment\.sizeBytes\)/);
  assert.match(source, /note\.attachments/);
});

test("Knowledge Notes Architecture: NoteLibraryView uses 3-column responsive grid and NoteCard", () => {
  const source = loadSource("components/note-library-view.tsx");

  // 1. Responsive multi-column grid
  assert.match(source, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);

  // 2. Uses NoteLibraryItem wrapping NoteCard
  assert.match(source, /<NoteLibraryItem key=\{note\.id\} note=\{note\}/);
});

test("Knowledge Mistakes Architecture: MistakeCard & MistakeLibrary use Master Cards and 3-column grid", () => {
  const cardSource = loadSource("components/mistake-card.tsx");
  const librarySource = loadSource("components/mistake-library.tsx");

  // 1. MistakeCard uses Card variant master and cause badges
  assert.match(cardSource, /<Card[\s\S]*variant="master"/);
  assert.match(cardSource, /labelCause\(mistake\.cause\)/);
  assert.match(cardSource, /待补全错因和正确思路后才能进入快速复习/);

  // 2. MistakeLibrary uses 4 subtle metric cards in summary grid
  assert.match(librarySource, /<Card[\s\S]*variant="subtle"/);
  assert.match(librarySource, /错题总数/);
  assert.match(librarySource, /今日到期/);
  assert.match(librarySource, /最近通过/);
  assert.match(librarySource, /最近失败/);

  // 3. MistakeLibrary uses 3-column grid with MistakeCard
  assert.match(librarySource, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(librarySource, /<MistakeCard key=\{mistake\.id\} mistake=\{mistake\} \/>/);
});

test("Knowledge Syllabi Architecture: Tree nodes & Workbench use Master Dark Glass Cards", () => {
  const treeNodeSource = loadSource("components/syllabus-manager-tree-node.tsx");
  const workbenchSource = loadSource("components/syllabus-manager-view.tsx");

  // 1. Tree node uses Card variant master with glowing teal progress
  assert.match(treeNodeSource, /<Card[\s\S]*variant="master"/);
  assert.match(treeNodeSource, /bg-teal-400/);

  // 2. Workbench uses Card variant master for container and Card subtle for metrics
  assert.match(workbenchSource, /<Card[\s\S]*variant="master"/);
  assert.match(workbenchSource, /<Card[\s\S]*variant="subtle"/);
});

test("Knowledge Points & Resources Architecture: Points & Resources use Master Cards and 3-column grids", () => {
  const pointCardSource = loadSource("components/knowledge-point-card.tsx");
  const pointWorkbenchSource = loadSource("components/knowledge-points-workbench.tsx");
  const resourceCardSource = loadSource("components/study-resource-card.tsx");
  const resourceListSource = loadSource("components/study-resource-list.tsx");

  // 1. KnowledgePointCard uses Card variant master with metrics and badges
  assert.match(pointCardSource, /<Card[\s\S]*variant="master"/);
  assert.match(pointCardSource, /point\.masteryConfidence/);
  assert.match(pointCardSource, /条证据/);

  // 2. Points workbench uses 3-column grid
  assert.match(pointWorkbenchSource, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(pointWorkbenchSource, /<KnowledgePointCard/);

  // 3. StudyResourceCard uses Card variant master and source type badge
  assert.match(resourceCardSource, /<Card[\s\S]*variant="master"/);
  assert.match(resourceCardSource, /sourceTypeLabel\(resource\.sourceType\)/);

  // 4. Resources list uses 3-column grid
  assert.match(resourceListSource, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(resourceListSource, /<StudyResourceCard/);
});

test("Knowledge Reviews & Imports Architecture: Queue & Import Workbench use Card layout hierarchy", () => {
  const reviewQueueSource = loadSource("components/review-schedule-queue.tsx");
  const importWorkbenchSource = loadSource("components/learning-tree-import-workbench-view.tsx");

  // 1. ReviewScheduleQueue uses Subtle metrics grid, Accent Hero, and Master Queue cards
  assert.match(reviewQueueSource, /<Card[\s\S]*variant="subtle"/);
  assert.match(reviewQueueSource, /<Card[\s\S]*variant="accent"/);
  assert.match(reviewQueueSource, /grid grid-cols-1 gap-4 md:grid-cols-2/);
  assert.match(reviewQueueSource, /<Card[\s\S]*variant="master"/);

  // 2. ImportWorkbench uses Subtle Card for templates and Master Card for import/export editors
  assert.match(importWorkbenchSource, /<Card[\s\S]*variant="subtle"/);
  assert.match(importWorkbenchSource, /<Card[\s\S]*variant="master"/);
});

test("Milestone M3: Micro-Badge Clusters & Tightened Padding on NoteCard, MistakeCard, and KnowledgePointCard", () => {
  const noteCardSource = loadSource("components/note-card.tsx");
  const mistakeCardSource = loadSource("components/mistake-card.tsx");
  const pointCardSource = loadSource("components/knowledge-point-card.tsx");
  const badgeSource = loadSource("components/knowledge-micro-badges.tsx");

  // 1. Tightened padding p-3.5 sm:p-4
  assert.match(noteCardSource, /p-3\.5 sm:p-4/);
  assert.match(mistakeCardSource, /p-3\.5 sm:p-4/);
  assert.match(pointCardSource, /p-3\.5 sm:p-4/);

  // 2. Micro-badge components integrated
  assert.match(noteCardSource, /<NoteMicroBadgeCluster/);
  assert.match(mistakeCardSource, /<MistakeMicroBadgeCluster/);
  assert.match(pointCardSource, /可信度/);

  // 3. Badge cluster contains required metric badges
  assert.match(badgeSource, /作答:\s*\{attemptCount\}次/);
  assert.match(badgeSource, /正答:\s*\{passRate\}%/);
  assert.match(badgeSource, /均耗:\s*\{avgDurationSeconds\}s/);
  assert.match(badgeSource, /★\s*\{starRating\}星/);
  assert.match(badgeSource, /天前复习/);
});

test("Milestone M3: Ebbinghaus Review Retention Distribution Bar Component", () => {
  const distributionSource = loadSource("components/knowledge-ebbinghaus-distribution.tsx");

  // 1. Master card with interval distribution
  assert.match(distributionSource, /<Card[\s\S]*variant="master"/);
  assert.match(distributionSource, /艾宾浩斯复习留存曲线与周期分布/);

  // 2. Contains 6 interval segments
  assert.match(distributionSource, /逾期待复习/);
  assert.match(distributionSource, /1-2 天内到期/);
  assert.match(distributionSource, /3-7 天内到期/);
  assert.match(distributionSource, /8-14 天内到期/);
  assert.match(distributionSource, /15-30 天内到期/);
  assert.match(distributionSource, />30 天 \/ 稳固掌握/);

  // 3. Contains 7-day retention metric and review queue action
  assert.match(distributionSource, /7日留存/);
  assert.match(distributionSource, /\/knowledge\/reviews/);
});

test("Milestone M3: Subject Mastery Panel with Stacked Bars and Pure SVG MiniRadar", () => {
  const masteryPanelSource = loadSource("components/knowledge-subject-mastery-panel.tsx");

  // 1. Stacked bars for multi-state mastery
  assert.match(masteryPanelSource, /科目掌握度全景分布/);
  assert.match(masteryPanelSource, /bg-emerald-500/); // Stable
  assert.match(masteryPanelSource, /bg-sky-500/);     // Learning
  assert.match(masteryPanelSource, /bg-amber-500/);   // Needs Retest
  assert.match(masteryPanelSource, /bg-zinc-700\/60/); // Untouched

  // 2. Pure SVG MiniRadar with polygon and axes
  assert.match(masteryPanelSource, /<svg[\s\S]*viewBox="0 0 200 200"/);
  assert.match(masteryPanelSource, /<polygon/);
  assert.match(masteryPanelSource, /radarGradient/);
  assert.match(masteryPanelSource, /覆盖率/);
  assert.match(masteryPanelSource, /熟练度/);
  assert.match(masteryPanelSource, /留存率/);
  assert.match(masteryPanelSource, /复测率/);
  assert.match(masteryPanelSource, /深度/);
});

test("Milestone M3: Top 5 High-Frequency Weak Points Ranking with 1-Click Retest Trigger", () => {
  const weakRankingSource = loadSource("components/knowledge-weak-points-ranking.tsx");

  // 1. High-frequency weak points header and ranking
  assert.match(weakRankingSource, /高频薄弱考点 Top 5/);
  assert.match(weakRankingSource, /rank === 1/);

  // 2. 1-Click Retest trigger CTA
  assert.match(weakRankingSource, /安排复测/);
  assert.match(weakRankingSource, /\/test\/retests\/new/);
});

test("Milestone M3: Knowledge Overview Page Integrates Complete Analytics Deck", () => {
  const overviewSource = loadSource("lib/routes/knowledge-overview-page.tsx");

  // 1. Integrates all 3 analytics components
  assert.match(overviewSource, /<KnowledgeEbbinghausDistribution/);
  assert.match(overviewSource, /<KnowledgeSubjectMasteryPanel/);
  assert.match(overviewSource, /<KnowledgeWeakPointsRanking/);

  // 2. 5-KPI Tiles and quick gateways
  assert.match(overviewSource, /知识资产/);
  assert.match(overviewSource, /今日待复习/);
  assert.match(overviewSource, /综合掌握率/);
  assert.match(overviewSource, /薄弱节点/);
  assert.match(overviewSource, /7日留存率/);
});

