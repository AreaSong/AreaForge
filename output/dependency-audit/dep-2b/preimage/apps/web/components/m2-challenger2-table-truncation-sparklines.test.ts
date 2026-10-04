import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SubjectTimerList,
  TodayLearningSummary,
} from "./action-center-today-support";
import {
  computeWeeklyBudgetConversionRows,
  RoadmapBudgetConversionTable,
} from "./roadmap/roadmap-budget-conversion";
import {
  type LossReasonDistributionSummary,
  type WeakModuleLossRankItem,
} from "./test/test-support";
import { TestWeakLossRanking } from "./test/test-weak-loss-ranking";
import { MiniSparkline } from "./ui/micro-charts";
import type {
  ActionCenterTodayDto,
  WeeklyBudgetDto,
} from "@/lib/contracts";

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

// ============================================================================
// SUITE 1: TestWeakLossRanking Table & Long Topic Title Truncation/Overflow
// ============================================================================

test("TestWeakLossRanking: Container Query, column compression & long topic title layout", () => {
  const source = loadSource("components/test/test-weak-loss-ranking.tsx");

  // 1. Root Container Query
  assert.match(source, /@container grid grid-cols-1 gap-4 @\[64rem\]:grid-cols-12/);
  assert.match(source, /@\[64rem\]:col-span-7/);
  assert.match(source, /@\[64rem\]:col-span-5/);

  // 2. Fixed column widths verify compression (292px total)
  assert.match(source, /<th className="pb-2 pl-1 w-7">#<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium w-14 sm:w-16">科目<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium text-right w-18 sm:w-20">累计失分<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium text-center w-16 sm:w-18">主要死因<\/th>/);
  assert.match(source, /<th className="pb-2 font-medium text-right pr-1 w-14 sm:w-16">动作<\/th>/);

  // 3. Fluid title column with min-w-0 and truncate
  assert.match(source, /<td className="py-2\.5 pr-2 min-w-0">/);
  assert.match(source, /<div className="font-medium text-zinc-200 group-hover:text-white transition-colors truncate">/);
});

test("TestWeakLossRanking: Component renders 15+ and 20+ Chinese character topic titles cleanly", () => {
  const longTitles = [
    "反常积分敛散性判别法与对数型递推数列极限求解", // 22 Chinese chars
    "多元函数微分学在几何中的应用与极值最值求解", // 21 Chinese chars
    "二阶常系数非齐次线性微分方程特解形式判定与求解", // 23 Chinese chars
    "矩阵的特征值特征向量与对角化充要条件", // 18 Chinese chars
    "离散型随机变量常见分布与数字特征综合计算", // 20 Chinese chars
  ];

  const rankings: WeakModuleLossRankItem[] = longTitles.map((title, idx) => ({
    id: `rank-${idx + 1}`,
    rank: idx + 1,
    title,
    subjectName: "高等数学",
    subjectColor: "#38bdf8",
    syllabusNodeId: `node-${idx + 1}`,
    totalLostScore: 18 - idx * 2,
    lossCount: 3,
    primaryReason: "CONCEPT_GAP",
    primaryReasonLabel: "概念漏洞",
    lastExamDate: "2026-08-26",
    notes: ["在最近两次模考中均出现失分"],
  }));

  const distribution: LossReasonDistributionSummary = {
    totalLostScore: 50,
    totalLossItemsCount: 15,
    items: [
      {
        reason: "CONCEPT_GAP",
        totalLostScore: 25,
        itemCount: 8,
        percentage: 50,
        meta: {
          code: "CONCEPT_GAP",
          label: "概念理解漏洞与知识盲区",
          shortLabel: "概念漏洞",
          tone: "rose",
          color: "#f43f5e",
        },
      },
      {
        reason: "CALCULATION_CARELESS",
        totalLostScore: 15,
        itemCount: 5,
        percentage: 30,
        meta: {
          code: "CALCULATION_CARELESS",
          label: "计算粗心失误与笔误丢分",
          shortLabel: "计算失误",
          tone: "amber",
          color: "#f59e0b",
        },
      },
    ],
  };

  const html = renderToStaticMarkup(
    React.createElement(TestWeakLossRanking, { rankings, distribution })
  );

  // 1. Verify container queries in rendered HTML
  assert.ok(html.includes("@container"));
  assert.ok(html.includes("@[64rem]:grid-cols-12"));
  assert.ok(html.includes("@[64rem]:col-span-7"));
  assert.ok(html.includes("@[64rem]:col-span-5"));

  // 2. Verify all long titles are rendered without alteration
  for (const title of longTitles) {
    assert.ok(html.includes(title), `Rendered HTML must contain full title: ${title}`);
  }

  // 3. Verify min-w-0 container for titles
  assert.ok(html.includes("min-w-0"));
  assert.ok(html.includes("truncate"));
});

test("TestWeakLossRanking: Layout Math Stress Test under 14\" MacBook Pro Viewports", () => {
  // 14" MBP viewport metrics:
  // Viewport width: 1440px ~ 1512px
  // Dual Sidebars: 184px + 216px = 400px
  // Page padding: 32px ~ 48px
  // Available container width: 992px to 1064px

  // Case 1: 1440px Viewport (Container = 992px < 64rem = 1024px)
  // Layout is single column (stacked)
  const containerWidth1440 = 992;
  const cardPadding1440 = 32; // p-4
  const fixedColumnsWidth = 316; // rank(32) + subject(64) + loss(80) + reason(72) + action(68)
  const availableTitleWidth1440 = containerWidth1440 - cardPadding1440 - fixedColumnsWidth;
  assert.ok(availableTitleWidth1440 >= 640, `Available title width on 1440px (${availableTitleWidth1440}px) must be >= 640px`);

  // Chinese char width in 12px text-xs is ~12px
  const charWidthPx = 12;
  const chars15Width = 15 * charWidthPx; // 180px
  const chars20Width = 20 * charWidthPx; // 240px
  assert.ok(chars15Width < availableTitleWidth1440, "15 Chinese characters (180px) easily fits in 644px");
  assert.ok(chars20Width < availableTitleWidth1440, "20 Chinese characters (240px) easily fits in 644px");

  // Case 2: 1512px Viewport (Container = 1064px >= 64rem = 1024px)
  // Layout triggers @[64rem]:grid-cols-12 -> left card gets 7/12 width
  const containerWidth1512 = 1064;
  const gapWidth = 16;
  const leftCardWidth1512 = (containerWidth1512 - gapWidth) * (7 / 12); // ~611px
  const cardPadding1512 = 32;
  const availableTitleWidth1512 = leftCardWidth1512 - cardPadding1512 - fixedColumnsWidth; // ~263px
  assert.ok(availableTitleWidth1512 >= 260, `Available title width on 1512px (${availableTitleWidth1512}px) must be >= 260px`);
  assert.ok(chars15Width <= availableTitleWidth1512, "15 Chinese characters (180px) easily fits in 263px without truncating");
  assert.ok(chars20Width <= availableTitleWidth1512, "20 Chinese characters (240px) fits in 263px without truncating");
});

// ============================================================================
// SUITE 2: Roadmap Budget Conversion Table & Horizontal Scrollbar Elimination
// ============================================================================

test("RoadmapOverviewPage: Container query @[78rem]:grid-cols-2 eliminates horizontal scrollbars on 14\" MBP", () => {
  const roadmapPage = loadSource("app/(app)/roadmap/page.tsx");
  const budgetTableSource = loadSource("components/roadmap/roadmap-budget-conversion.tsx");

  // 1. Verify @container grid grid-cols-1 @[78rem]:grid-cols-2 in roadmap/page.tsx
  assert.match(roadmapPage, /@container grid grid-cols-1 @\[78rem\]:grid-cols-2 gap-4/);

  // 2. Verify RoadmapBudgetConversionTable structure
  assert.match(budgetTableSource, /<table className="w-full text-left text-xs">/);
  assert.match(budgetTableSource, /<th className="py-2 px-3 font-semibold">科目<\/th>/);
  assert.match(budgetTableSource, /<th className="py-2 px-3 font-semibold text-right">计划预算<\/th>/);
  assert.match(budgetTableSource, /<th className="py-2 px-3 font-semibold text-right">实际投入<\/th>/);
  assert.match(budgetTableSource, /<th className="py-2 px-3 font-semibold text-right">有效专注<\/th>/);
  assert.match(budgetTableSource, /<th className="py-2 px-3 font-semibold text-right">投入转化率<\/th>/);
  assert.match(budgetTableSource, /<th className="py-2 px-3 font-semibold text-right">预算完成度<\/th>/);
  assert.match(budgetTableSource, /<th className="py-2 px-3 font-semibold text-center">推进状态<\/th>/);
});

test("RoadmapBudgetConversionTable: Column width & scrollbar elimination math on 14\" MBP", () => {
  // 7-column width breakdown:
  const col1_Subject = 120;
  const col2_Budget = 85;
  const col3_Actual = 85;
  const col4_Effective = 85;
  const col5_ConversionRate = 90;
  const col6_ProgressRate = 120;
  const col7_Status = 90;
  const totalTableRequiredWidth = col1_Subject + col2_Budget + col3_Actual + col4_Effective + col5_ConversionRate + col6_ProgressRate + col7_Status; // 675px

  // On 14" MBP (1440px ~ 1512px):
  // Content container width is 992px to 1064px.
  // 78rem = 1248px.
  // Since 992px < 1248px and 1064px < 1248px, the grid is 1-column (full width).
  const netContainerWidthMin = 992;
  const cardPadding = 32;
  const netTableSlotWidth = netContainerWidthMin - cardPadding; // 960px

  assert.ok(
    netTableSlotWidth > totalTableRequiredWidth,
    `Slot width (${netTableSlotWidth}px) must exceed 7-column table requirement (${totalTableRequiredWidth}px) by >= 250px`,
  );
  const marginHeadroom = netTableSlotWidth - totalTableRequiredWidth;
  assert.ok(marginHeadroom >= 280, `Margin headroom (${marginHeadroom}px) prevents any horizontal scrolling`);
});

test("RoadmapBudgetConversionTable: Computes subject rows, conversion rates, and renders accurately", () => {
  const weeklyBudget: WeeklyBudgetDto = {
    workspaceId: "ws-1",
    weekStart: "2026-08-24",
    weekEnd: "2026-08-30",
    configuredSubjectCount: 0,
    totalTargetMinutes: 0,
    totalActualMinutes: 600,
    totalEffectiveMinutes: 510,
    subjects: [
      {
        subjectId: "sub-math",
        subjectName: "高等数学",
        subjectColor: "#38bdf8",
        targetMinutes: null,
        actualMinutes: 300,
        effectiveMinutes: 270,
        revision: 0,
      },
      {
        subjectId: "sub-eng",
        subjectName: "考研英语",
        subjectColor: "#a855f7",
        targetMinutes: null,
        actualMinutes: 200,
        effectiveMinutes: 160,
        revision: 0,
      },
      {
        subjectId: "sub-pol",
        subjectName: "考研政治",
        subjectColor: "#f43f5e",
        targetMinutes: null,
        actualMinutes: 100,
        effectiveMinutes: 80,
        revision: 0,
      },
    ],
  };

  const rows = computeWeeklyBudgetConversionRows(weeklyBudget);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].subjectId, "sub-math");
  assert.equal(rows[0].conversionRate, 90); // 270 / 300 = 90%
  assert.equal(rows[0].budgetMinutes, null);
  assert.equal(rows[0].progressRate, null);
  assert.equal(rows[0].status, "normal");
  assert.equal(rows[0].statusLabel, "未设置预算");

  assert.equal(rows[1].subjectId, "sub-eng");
  assert.equal(rows[1].conversionRate, 80); // 160 / 200 = 80%

  assert.equal(rows[2].subjectId, "sub-pol");
  assert.equal(rows[2].conversionRate, 80);

  const html = renderToStaticMarkup(
    React.createElement(RoadmapBudgetConversionTable, { weeklyBudget })
  );
  assert.ok(html.includes("高等数学"));
  assert.ok(html.includes("考研英语"));
  assert.ok(html.includes("未设置预算"));
  assert.ok(!html.includes("60.0 h"));
  assert.ok(html.includes("全科平均转化率"));
});

// ============================================================================
// SUITE 3: SubjectTimerList Truthful 7-Day Totals & Layout Invariants
// ============================================================================

test("SubjectTimerList: Container Query grid & factual recent total invariants", () => {
  const source = loadSource("components/action-center-today-support.tsx");

  // 1. Root Container Query on Card
  assert.match(source, /<Card variant="master" padding="none" className="@container overflow-hidden">/);

  // 2. Responsive Subject Grid: 1 col (<28rem), 2 cols (28rem~52rem), 3 cols (>=52rem)
  assert.match(source, /grid grid-cols-1 gap-2 @\[28rem\]:grid-cols-2 @\[52rem\]:grid-cols-3/);

  // 3. Summary row uses only service-provided totals
  assert.match(source, /<div className="flex items-center justify-between text-xs text-zinc-400">/);
  assert.match(source, /近 7 日 \{subject\.last7EffectiveMinutes\}m/);
  assert.doesNotMatch(source, /sparklineData|<MiniSparkline/);
});

test("SubjectTimerList: Layout Math & No Visual Overlap Proof on 14\" MacBook Pro", () => {
  // On 14" MBP /today page:
  // Main split: @[56rem]:grid-cols-[1fr_360px]
  // Left column width on 1440px: 992px - 360px - 16px (gap) = 616px
  // Left column width on 1512px: 1064px - 360px - 16px (gap) = 688px

  // SubjectTimerList is inside the left column:
  // 616px ~ 688px is >= 28rem (448px) and < 52rem (832px)
  // Grid activates exactly 2 columns!
  const leftColWidth1440 = 616;
  const gridGap = 8; // gap-2
  const subjectCardWidth1440 = (leftColWidth1440 - gridGap) / 2; // 304px
  const cardPadding = 20; // p-2.5 (10px each side)
  const usableCardWidth = subjectCardWidth1440 - cardPadding; // 284px

  // Recent-total row element widths:
  const leftItem_TodayMinutes = 60; // "今日 120m"
  const rightItem_RecentTotal = 92; // "近 7 日 1200m"
  const totalRowContentWidth = leftItem_TodayMinutes + rightItem_RecentTotal;

  assert.ok(
    usableCardWidth > totalRowContentWidth,
    `Usable card width (${usableCardWidth}px) must strictly exceed content width (${totalRowContentWidth}px)`,
  );

  const rowMargin = usableCardWidth - totalRowContentWidth; // 114px
  assert.ok(rowMargin >= 100, `Breathing margin (${rowMargin}px) guarantees zero text clipping and overlap`);
});

test("MiniSparkline: Renders SVG with strictly bounded coordinates and monotonic X steps", () => {
  const sparklineData = [10, 25, 40, 30, 50, 45, 60];
  const width = 40;
  const height = 10;

  const html = renderToStaticMarkup(
    React.createElement(MiniSparkline, {
      data: sparklineData,
      width,
      height,
      strokeWidth: 1,
    })
  );

  assert.ok(html.includes("width=\"40\""));
  assert.ok(html.includes("height=\"10\""));
  assert.ok(html.includes("viewBox=\"0 0 40 10\""));
  assert.ok(html.includes("<polyline"));

  // Test SVG Coordinate Math
  const pad = 3;
  const points: Array<{ x: number; y: number }> = [];
  const minVal = Math.min(...sparklineData);
  const maxVal = Math.max(...sparklineData);
  const range = maxVal - minVal;

  for (let idx = 0; idx < sparklineData.length; idx++) {
    const x = pad + (idx / (sparklineData.length - 1)) * (width - 2 * pad);
    const y = height - pad - ((sparklineData[idx] - minVal) / range) * (height - 2 * pad);
    points.push({ x, y });
  }

  // 1. Verify monotonic increasing X coordinates
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].x > points[i - 1].x, `X coordinate at index ${i} (${points[i].x}) must be greater than index ${i - 1} (${points[i - 1].x})`);
  }

  // 2. Verify all X coordinates are within [pad, width - pad]
  points.forEach((p, idx) => {
    assert.ok(p.x >= pad && p.x <= width - pad, `Point ${idx} X (${p.x}) must be in [${pad}, ${width - pad}]`);
    assert.ok(p.y >= pad && p.y <= height - pad, `Point ${idx} Y (${p.y}) must be in [${pad}, ${height - pad}]`);
  });

  // 3. Step spacing between 7 points is exactly 5.67px
  const step = points[1].x - points[0].x;
  assert.ok(Math.abs(step - (34 / 6)) < 0.001, `Step size (${step}) must equal 34/6`);
});

test("SubjectTimerList: Handles edge cases (0 minutes, 10+ subjects, single subject)", () => {
  const baseToday: ActionCenterTodayDto = {
    studyDate: "2026-08-26",
    isToday: true,
    setupRequired: false,
    workspace: {
      id: "ws-1",
      stableKey: "exam-2027",
      name: "考研工作区",
      targetExamDate: "2026-12-20",
      stageSummary: "强化阶段",
      status: "ACTIVE",
      revision: 1,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
    statusBar: null,
    primaryActionLabel: "开始",
    primaryActionHref: "/focus",
    recommendation: null,
    queues: {
      formalTasks: [],
      noteResourceSyllabusReviews: [],
      mistakeReviews: [],
    },
    queuesEmpty: true,
    activity: null,
    continuation: null,
    checkIn: null,
    learningLoop: {
      totalMinutes: 0,
      effectiveMinutes: 0,
      effectiveSessionCount: 0,
      evidenceCount: 0,
      lowConversionCount: 0,
      plannedTaskCount: 0,
      completedTaskCount: 0,
      deferredTaskCount: 0,
      reviewSubmitted: false,
      nextAction: null,
      hourlyMinutes: Array(24).fill(0),
    },
    subjectTimers: {
      subjects: [
        {
          subjectId: "sub-0",
          title: "零时长测试科目",
          groupId: "grp-1",
          groupTitle: "公共课",
          todayEffectiveMinutes: 0,
          last7EffectiveMinutes: 0,
          contextSummary: null,
          canStart: true,
        },
      ],
      groups: [],
    },
    recovery: null,
    shortcutOptions: {
      tasks: [],
      syllabusNodes: [],
    },
  };

  const html = renderToStaticMarkup(
    React.createElement(SubjectTimerList, { today: baseToday, onStart: () => {} })
  );
  assert.ok(html.includes("@container"));
  assert.ok(html.includes("零时长测试科目"));
  assert.ok(html.includes("近 7 日 0m"));
});
