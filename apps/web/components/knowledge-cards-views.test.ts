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
