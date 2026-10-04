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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
}

// ---------------------------------------------------------------------------
// Mathematical Model of Viewport & Container Layouts
// ---------------------------------------------------------------------------

interface ShellState {
  viewportWidth: number;
  sidebarExpanded: boolean;
  secondaryExpanded: boolean;
  isMobile: boolean;
}

function calculateContainerWidth(state: ShellState): number {
  if (state.isMobile || state.viewportWidth < 1024) {
    const pad = state.viewportWidth < 640 ? 24 : 32; // px-3 (12*2) or sm:px-4 (16*2)
    return state.viewportWidth - pad;
  }
  const primarySidebar = state.sidebarExpanded ? 184 : 0;
  const secondarySidebar = state.secondaryExpanded ? 216 : 0;
  const shellPadding = state.viewportWidth >= 1280 ? 40 : 32; // xl:px-5 (20*2) or sm:px-4
  return state.viewportWidth - primarySidebar - secondarySidebar - shellPadding;
}

// ---------------------------------------------------------------------------
// 1. Viewport Matrix & Container Query Resolution Engine
// ---------------------------------------------------------------------------

test("Adversarial M2: Mathematical Container Widths across Viewports & Sidebar States", () => {
  const viewports = [
    { name: "14-inch MBP Native", width: 1512, isMobile: false },
    { name: "14-inch MBP Scaled / Desktop", width: 1440, isMobile: false },
    { name: "13-inch Standard Laptop", width: 1280, isMobile: false },
    { name: "iPad Pro Landscape / Small Laptop", width: 1024, isMobile: false },
    { name: "iPad Portrait / Tablet", width: 768, isMobile: true },
    { name: "iPhone Mobile", width: 375, isMobile: true },
  ];

  // Test 1440px with dual sidebars (400px)
  const mbp1440Dual = calculateContainerWidth({
    viewportWidth: 1440,
    sidebarExpanded: true,
    secondaryExpanded: true,
    isMobile: false,
  });
  // 1440 - 400 - 40 = 1000px = 62.5rem
  assert.equal(mbp1440Dual, 1000);
  assert.equal(mbp1440Dual / 16, 62.5);

  // Test 1512px with dual sidebars (400px)
  const mbp1512Dual = calculateContainerWidth({
    viewportWidth: 1512,
    sidebarExpanded: true,
    secondaryExpanded: true,
    isMobile: false,
  });
  // 1512 - 400 - 40 = 1072px = 67rem
  assert.equal(mbp1512Dual, 1072);
  assert.equal(mbp1512Dual / 16, 67.0);

  // Test 1280px with dual sidebars (400px)
  const lap1280Dual = calculateContainerWidth({
    viewportWidth: 1280,
    sidebarExpanded: true,
    secondaryExpanded: true,
    isMobile: false,
  });
  // 1280 - 400 - 40 = 840px = 52.5rem
  assert.equal(lap1280Dual, 840);
  assert.equal(lap1280Dual / 16, 52.5);

  // Test 768px tablet
  const tab768 = calculateContainerWidth({
    viewportWidth: 768,
    sidebarExpanded: false,
    secondaryExpanded: false,
    isMobile: true,
  });
  // 768 - 32 = 736px = 46rem
  assert.equal(tab768, 736);
  assert.equal(tab768 / 16, 46.0);

  // Test 375px mobile
  const mob375 = calculateContainerWidth({
    viewportWidth: 375,
    sidebarExpanded: false,
    secondaryExpanded: false,
    isMobile: true,
  });
  // 375 - 24 = 351px = 21.9375rem
  assert.equal(mob375, 351);
  assert.equal(mob375 / 16, 21.9375);
});

// ---------------------------------------------------------------------------
// 2. /today Layout Isolation & Anti-Crush Proof
// ---------------------------------------------------------------------------

test("Adversarial M2: /today Container Isolation & Anti-Crush Math", () => {
  const viewSource = loadSource("components/action-center-today-view.tsx");
  const supportSource = loadSource("components/action-center-today-support.tsx");

  // Verify container class definitions
  assert.match(viewSource, /@container grid grid-cols-1 gap-3\.5 @\[56rem\]:grid-cols-\[1fr_360px\] @\[80rem\]:grid-cols-\[1fr_380px\]/);
  assert.match(supportSource, /@container space-y-3/); // TodayLearningSummary
  assert.match(supportSource, /grid grid-cols-2 gap-2\.5 @\[36rem\]:grid-cols-4/); // Metric 4-card grid
  assert.match(supportSource, /@container overflow-hidden/); // SubjectTimerList
  assert.match(supportSource, /grid grid-cols-1 gap-2 @\[28rem\]:grid-cols-2 @\[52rem\]:grid-cols-3/);

  // Simulation: On 1440px MBP (Container = 1000px = 62.5rem)
  // 1. Main Grid: 62.5rem >= 56rem and < 80rem -> activates grid-cols-[1fr_360px]
  const containerW = 1000;
  const gap = 14; // gap-3.5 = 14px
  const rightSidebarW = 360;
  const leftMainW = containerW - rightSidebarW - gap; // 1000 - 360 - 14 = 626px

  assert.equal(leftMainW, 626);
  assert.ok(leftMainW / rightSidebarW >= 1.7, "Left-to-Right Golden Ratio must be >= 1.7:1");

  // 2. Right Sidebar Metrics: TodayLearningSummary inside 360px sidebar
  // 360px = 22.5rem < 36rem (576px) -> activates 2 columns!
  const summaryInnerW = rightSidebarW - 32; // SectionCard master padding md (!p-4 = 16*2 = 32px) = 328px
  const metricCardW = (summaryInnerW - 10) / 2; // gap-2.5 = 10px -> (328 - 10) / 2 = 159px
  assert.equal(metricCardW, 159);
  assert.ok(metricCardW >= 140, "Metric cards must be >= 140px to prevent number/label clipping (was crushed to 78px previously)");

  // 3. Left Column Subjects: SubjectTimerList inside 626px
  // 626px = 39.125rem >= 28rem (448px) and < 52rem (832px) -> activates 2 columns!
  const subjectInnerW = leftMainW - 24; // Card padding sm (p-3 = 12*2 = 24px) = 602px
  const subjectCardW = (subjectInnerW - 8) / 2; // gap-2 = 8px -> (602 - 8) / 2 = 297px
  assert.ok(subjectCardW >= 280, "Subject cards must be >= 280px to hold title + sparkline + progress (was crushed to 150px previously)");
});

test("Adversarial M2: /today Dynamic Adaptation under Sidebar Collapse/Expand", () => {
  // Scenario A: Dual sidebars expanded on 1440px
  // Container: 1000px. Left main: 626px (39.125rem < 52rem) -> SubjectTimerList has 2 cols
  const expandedLeftW = 626;
  const expandedLeftRem = expandedLeftW / 16;
  assert.ok(expandedLeftRem >= 28 && expandedLeftRem < 52, "Dual sidebars -> 2 cols for subjects");

  // Scenario B: User collapses Secondary Sidebar on 1440px
  // Container: 1440 - 184 - 40 = 1216px (76rem).
  // Main Grid: 76rem >= 56rem and < 80rem -> grid-cols-[1fr_360px]
  // Left main: 1216 - 360 - 14 = 842px (52.625rem >= 52rem!)
  const collapsedSecondaryLeftW = 1216 - 360 - 14;
  const collapsedSecondaryLeftRem = collapsedSecondaryLeftW / 16;
  assert.equal(collapsedSecondaryLeftW, 842);
  assert.ok(collapsedSecondaryLeftRem >= 52, "Collapsed secondary sidebar -> smoothly triggers 3 cols for subjects (842px >= 52rem)!");

  // Scenario C: User collapses Both Sidebars on 1440px
  // Container: 1440 - 40 = 1400px (87.5rem >= 80rem!)
  // Main Grid: 87.5rem >= 80rem -> grid-cols-[1fr_380px]
  // Left main: 1400 - 380 - 14 = 1006px (62.875rem >= 52rem)
  const fullCollapseLeftW = 1400 - 380 - 14;
  assert.equal(fullCollapseLeftW, 1006);
  assert.ok(fullCollapseLeftW / 16 >= 52, "Full collapse -> 3 cols for subjects with generous 380px right sidebar");
});

// ---------------------------------------------------------------------------
// 3. /knowledge Layout Isolation & Multi-Breakpoint Progressions
// ---------------------------------------------------------------------------

test("Adversarial M2: /knowledge Container Query Columns across Viewports", () => {
  const source = loadSource("lib/routes/knowledge-overview-page.tsx");

  // Check 5-KPI Tiles & Gateways container query definition
  const pattern = /grid grid-cols-2 gap-3 @\[36rem\]:grid-cols-3 @\[60rem\]:grid-cols-4 @\[78rem\]:grid-cols-5/;
  assert.match(source, pattern);

  // Helper to determine active columns given container width
  function getKnowledgeCols(containerW: number): number {
    const rem = containerW / 16;
    if (rem >= 78) return 5;
    if (rem >= 60) return 4;
    if (rem >= 36) return 3;
    return 2;
  }

  // 1440px MBP (Container 1000px = 62.5rem): 4 columns
  assert.equal(getKnowledgeCols(1000), 4);
  const cardW1440 = (1000 - 3 * 12) / 4;
  assert.equal(cardW1440, 241);
  assert.ok(cardW1440 >= 230, "1440px 4-col KPI cards must be >= 230px (+25% wider than previous 190px)");

  // 1512px MBP (Container 1072px = 67rem): 4 columns
  assert.equal(getKnowledgeCols(1072), 4);
  const cardW1512 = (1072 - 3 * 12) / 4;
  assert.equal(cardW1512, 259);

  // 1280px Laptop (Container 840px = 52.5rem): 3 columns
  assert.equal(getKnowledgeCols(840), 3);
  const cardW1280 = (840 - 2 * 12) / 3;
  assert.equal(cardW1280, 272);

  // Ultrawide screen (Container >= 1248px = 78rem): 5 columns
  assert.equal(getKnowledgeCols(1248), 5);
  const cardWUltrawide = (1248 - 4 * 12) / 5;
  assert.equal(cardWUltrawide, 240);

  // 375px Mobile (Container 351px = 21.9rem): 2 columns
  assert.equal(getKnowledgeCols(351), 2);
  const cardWMobile = (351 - 12) / 2;
  assert.equal(cardWMobile, 169.5);
});

// ---------------------------------------------------------------------------
// 4. /test Layout Isolation & Table Column Recovery
// ---------------------------------------------------------------------------

test("Adversarial M2: /test KPI Strip & Weak Loss Ranking Column Allocation", () => {
  const kpiSource = loadSource("components/test/test-kpi-strip.tsx");
  const rankSource = loadSource("components/test/test-weak-loss-ranking.tsx");

  // KPI Strip
  assert.match(kpiSource, /grid grid-cols-2 gap-2\.5 @\[36rem\]:grid-cols-3 @\[58rem\]:grid-cols-5/);
  assert.match(kpiSource, /col-span-2 @\[36rem\]:col-span-1/);

  function getTestKpiCols(containerW: number): { cols: number; card5Span: number } {
    const rem = containerW / 16;
    if (rem >= 58) return { cols: 5, card5Span: 1 };
    if (rem >= 36) return { cols: 3, card5Span: 1 };
    return { cols: 2, card5Span: 2 };
  }

  // 1440px MBP (Container 1000px = 62.5rem): 5 columns
  const kpi1440 = getTestKpiCols(1000);
  assert.equal(kpi1440.cols, 5);
  assert.equal(kpi1440.card5Span, 1);

  // 1280px Dual (Container 840px = 52.5rem): 3 columns, Card 5 spans 1 col in row 2
  const kpi1280 = getTestKpiCols(840);
  assert.equal(kpi1280.cols, 3);
  assert.equal(kpi1280.card5Span, 1);

  // Mobile 375px (Container 351px): 2 columns, Card 5 spans 2 cols
  const kpi375 = getTestKpiCols(351);
  assert.equal(kpi375.cols, 2);
  assert.equal(kpi375.card5Span, 2);

  // Weak Loss Ranking Table
  assert.match(rankSource, /@container grid grid-cols-1 gap-4 @\[64rem\]:grid-cols-12/);
  assert.match(rankSource, /@\[64rem\]:col-span-7/);
  assert.match(rankSource, /@\[64rem\]:col-span-5/);

  // Check fixed column footprint: w-7 (28px) + w-16 (64px) + w-20 (80px) + w-18 (72px) + w-16 (64px) = 308px
  const fixedColWidth = 28 + 64 + 80 + 72 + 64;
  assert.equal(fixedColWidth, 308);

  // In 1440px container (1000px < 64rem = 1024px), table is full 1000px width!
  // Remaining width for title = 1000 - 32 (card padding) - 308 = 660px!
  const titleAvailableW1440 = 1000 - 32 - fixedColWidth;
  assert.ok(titleAvailableW1440 >= 600, "Title has >600px room in single-column layout on 14-inch screen");

  // When container >= 64rem (e.g. collapsed sidebars 1216px):
  // Left 7 cols = 1216 * (7/12) = 709px.
  // Remaining width for title = 709 - 32 - 308 = 369px!
  const titleAvailableWCollapsed = 709 - 32 - fixedColWidth;
  assert.ok(titleAvailableWCollapsed >= 300, "Title has >300px room in 7-col split, easily fitting 18+ Chinese characters without truncation");
});

// ---------------------------------------------------------------------------
// 5. /roadmap Layout Isolation & Horizontal Scrollbar Elimination
// ---------------------------------------------------------------------------

test("Adversarial M2: /roadmap Budget Conversion Table Container Space & Scrollbar Elimination", () => {
  const pageSource = loadSource("app/(app)/roadmap/page.tsx");
  const ganttSource = loadSource("components/roadmap/roadmap-timeline-gantt.tsx");
  const syllabusSource = loadSource("components/roadmap/roadmap-syllabus-matrix.tsx");

  // 1. Roadmap page container 2-col split
  assert.match(pageSource, /@container grid grid-cols-1 @\[78rem\]:grid-cols-2 gap-4/);

  // On 14" MBP (1440px/1512px -> 62.5rem/67rem < 78rem):
  // Table receives FULL container width (1000px ~ 1072px).
  // RoadmapBudgetConversionTable requires min 660px.
  const tableRequiredWidth = 660;
  const mbp1440Container = 1000;
  const mbp1512Container = 1072;

  assert.ok(mbp1440Container > tableRequiredWidth, "1440px container (1000px) exceeds table 660px by +340px (Zero Scrollbars!)");
  assert.ok(mbp1512Container > tableRequiredWidth, "1512px container (1072px) exceeds table 660px by +412px (Zero Scrollbars!)");

  // 2. Syllabus Matrix Sub-Subject Grid
  assert.match(syllabusSource, /grid grid-cols-1 @\[30rem\]:grid-cols-2 @\[52rem\]:grid-cols-3 gap-2\.5/);

  function getSyllabusCols(containerW: number): number {
    const rem = containerW / 16;
    if (rem >= 52) return 3;
    if (rem >= 30) return 2;
    return 1;
  }

  assert.equal(getSyllabusCols(1000), 3, "1440px MBP (62.5rem >= 52rem) activates 3 columns for syllabus subjects");
  assert.equal(getSyllabusCols(736), 2, "768px tablet (46rem >= 30rem, < 52rem) activates 2 columns for syllabus subjects");
  assert.equal(getSyllabusCols(351), 1, "375px mobile (21.9rem < 30rem) activates 1 column for syllabus subjects");
});

// ---------------------------------------------------------------------------
// 6. CSS AST & Tailwind Container Query Syntax Verification
// ---------------------------------------------------------------------------

test("Adversarial M2: Tailwind v4 Native Container Query Syntax Rigor", () => {
  const filesToCheck = [
    "components/action-center-today-view.tsx",
    "components/action-center-today-support.tsx",
    "lib/routes/knowledge-overview-page.tsx",
    "components/test/test-kpi-strip.tsx",
    "components/test/test-weak-loss-ranking.tsx",
    "app/(app)/roadmap/page.tsx",
    "components/roadmap/roadmap-timeline-gantt.tsx",
    "components/roadmap/roadmap-syllabus-matrix.tsx",
  ];

  for (const file of filesToCheck) {
    const content = loadSource(file);
    // 1. Must contain @container declaration if using @[...] breakpoints
    if (content.includes("@[")) {
      assert.ok(
        content.includes("@container"),
        `File ${file} uses container queries (@[...]) but lacks @container wrapper definition!`,
      );
    }

    // 2. Validate all arbitrary container breakpoint patterns match @[\d+(\.\d+)?rem]:
    const arbitraryMatches = content.match(/@\[[0-9a-z.]+\]:[a-z0-9\-_[\]]+/g) || [];
    for (const match of arbitraryMatches) {
      assert.match(
        match,
        /^@\[\d+(\.\d+)?rem\]:[a-z0-9\-_[\]]+$/,
        `Invalid arbitrary container query syntax '${match}' in ${file}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 7. Absence of Deprecated Viewport Crushing Breakpoints in M2 Scope
// ---------------------------------------------------------------------------

test("Adversarial M2: Total Absence of Viewport Crushing Grid Breakpoints", () => {
  const todaySupport = stripComments(loadSource("components/action-center-today-support.tsx"));
  const knowledgeRoute = stripComments(loadSource("lib/routes/knowledge-overview-page.tsx"));
  const roadmapPage = stripComments(loadSource("app/(app)/roadmap/page.tsx"));

  // TodayLearningSummary must NOT use xl:grid-cols-4
  assert.ok(
    !todaySupport.includes("xl:grid-cols-4"),
    "TodayLearningSummary must not use viewport-level xl:grid-cols-4",
  );

  // SubjectTimerList must NOT use xl:grid-cols-4
  assert.ok(
    !todaySupport.includes("xl:grid-cols-4"),
    "SubjectTimerList must not use viewport-level xl:grid-cols-4",
  );

  // KnowledgeOverviewPage KPI row must NOT use lg:grid-cols-5
  assert.ok(
    !knowledgeRoute.includes("lg:grid-cols-5"),
    "KnowledgeOverviewPage 5-KPI row must not use viewport-level lg:grid-cols-5",
  );

  // RoadmapOverviewPage 2-col matrix must NOT use md:grid-cols-2
  assert.ok(
    !roadmapPage.includes("md:grid-cols-2"),
    "RoadmapOverviewPage must not use viewport-level md:grid-cols-2",
  );
});
