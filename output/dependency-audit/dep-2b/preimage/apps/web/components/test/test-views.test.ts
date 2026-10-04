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

test("Milestone 2 - TestKpiStrip: Container Query Architecture & Adaptive Columns", () => {
  const source = loadSource("components/test/test-kpi-strip.tsx");

  // 1. Root container wrapper with @container
  assert.match(source, /@container/);

  // 2. Adaptive grid: 2 cols on mobile, 3 cols at 36rem, 5 cols at 58rem
  assert.match(source, /grid grid-cols-2 gap-2\.5 @\[36rem\]:grid-cols-3 @\[58rem\]:grid-cols-5/);

  // 3. Card 5 responsive column span (col-span-2 on mobile, col-span-1 at 36rem+)
  assert.match(source, /col-span-2 @\[36rem\]:col-span-1/);
});

test("Milestone 2 - TestWeakLossRanking: Container Query & Fixed Column Compression", () => {
  const source = loadSource("components/test/test-weak-loss-ranking.tsx");

  // 1. Root container grid with @container and @[64rem] 12-column split
  assert.match(source, /@container grid grid-cols-1 gap-4 @\[64rem\]:grid-cols-12/);

  // 2. Left and Right panel container query column spans
  assert.match(source, /@\[64rem\]:col-span-7/);
  assert.match(source, /@\[64rem\]:col-span-5/);

  // 3. Compressed fixed column headers preventing title truncation
  assert.match(source, /<th className="pb-2 pl-1 w-7">#<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium w-14 sm:w-16">科目<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium text-right w-18 sm:w-20">累计失分<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium text-center w-16 sm:w-18">主要死因<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium text-right pr-1 w-14 sm:w-16">动作<\/th>/);

  // 4. Fluid title cell with min-w-0 flex-1 truncate (no restrictive max-w-200px)
  assert.match(source, /<td className="py-2\.5 pr-2 min-w-0">/);
});

test("Milestone 2 - KnowledgeOverviewPage: Container Query Multi-Breakpoint Progressions", () => {
  const source = loadSource("lib/routes/knowledge-overview-page.tsx");

  // 1. High-density KPI tiles container query
  assert.match(source, /grid grid-cols-2 gap-3 @\[36rem\]:grid-cols-3 @\[60rem\]:grid-cols-4 @\[78rem\]:grid-cols-5/);

  // 2. Quick gateways container query
  assert.match(source, /grid grid-cols-2 gap-3 @\[36rem\]:grid-cols-3 @\[60rem\]:grid-cols-4 @\[78rem\]:grid-cols-5/);
});

test("Milestone 2 - Roadmap Overview & Timeline Gantt & Syllabus Matrix: Container Query Adaptation", () => {
  const roadmapPage = loadSource("app/(app)/roadmap/page.tsx");
  const ganttSource = loadSource("components/roadmap/roadmap-timeline-gantt.tsx");
  const syllabusSource = loadSource("components/roadmap/roadmap-syllabus-matrix.tsx");

  // 1. Roadmap page container query 2-column split (1 col on 14" MBP, 2 cols on ultrawide >= 78rem)
  assert.match(roadmapPage, /@container grid grid-cols-1 @\[78rem\]:grid-cols-2 gap-4/);

  // 2. Gantt timeline root container and responsive header/milestones
  assert.match(ganttSource, /@container rounded-2xl/);
  assert.match(ganttSource, /flex flex-col @\[34rem\]:flex-row @\[34rem\]:items-center/);
  assert.match(ganttSource, /flex flex-col @\[28rem\]:flex-row @\[28rem\]:items-center/);

  // 3. Syllabus matrix root container, header, and sub-subject grid
  assert.match(syllabusSource, /@container rounded-2xl/);
  assert.match(syllabusSource, /flex flex-col @\[36rem\]:flex-row @\[36rem\]:items-center/);
  assert.match(syllabusSource, /grid grid-cols-1 @\[30rem\]:grid-cols-2 @\[52rem\]:grid-cols-3 gap-2\.5/);
});
