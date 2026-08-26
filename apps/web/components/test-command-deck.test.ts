import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateTestKpis,
  calculateMockExamTrends,
  calculateLossReasonDistribution,
  calculateWeakModuleLossRankings,
  buildPendingTestQueue,
  getLossReasonMeta,
} from "./test/test-support";
import type { KnowledgeRetestListItemDto } from "@/lib/contracts/knowledge-retest";
import type { SimulationExamDto } from "@/lib/contracts/simulation";

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

test("M4 Exam Command Deck: calculateTestKpis computes accurate metrics from genuine DB records", () => {
  // Empty edge case
  const emptyKpis = calculateTestKpis([], []);
  assert.equal(emptyKpis.totalSimulations, 0);
  assert.equal(emptyKpis.confirmedSimulationsCount, 0);
  assert.equal(emptyKpis.retestPassRate, null);
  assert.equal(emptyKpis.avgActualScore, null);
  assert.equal(emptyKpis.cumulativeLostScore, 0);
  assert.deepEqual(emptyKpis.scoreTrajectory, []);

  // Populated mock data
  const mockRetests: KnowledgeRetestListItemDto[] = [
    {
      id: "r1",
      revision: 1,
      title: "二叉树遍历性质复测",
      method: "BLIND_PROVE",
      status: "CLOSED",
      result: "PASSED",
      scheduledAt: "2026-08-10T08:00:00Z",
      testedAt: "2026-08-10T08:30:00Z",
      nextDueAt: "2026-08-24T08:00:00Z",
      summary: "全部掌握",
      pointCount: 2,
      pointTitles: ["前序遍历", "中序遍历"],
      timerSessionId: null,
    },
    {
      id: "r2",
      revision: 1,
      title: "泰勒公式展开复测",
      method: "PROBLEM_SOLVE",
      status: "CLOSED",
      result: "FAILED",
      scheduledAt: "2026-08-12T08:00:00Z",
      testedAt: "2026-08-12T08:30:00Z",
      nextDueAt: "2026-08-15T08:00:00Z",
      summary: "阶数漏记",
      pointCount: 1,
      pointTitles: ["泰勒展开"],
      timerSessionId: null,
    },
    {
      id: "r3",
      revision: 1,
      title: "虚拟内存页式置换",
      method: "CORE_CONCEPT",
      status: "DRAFT",
      result: null,
      scheduledAt: "2026-08-20T08:00:00Z",
      testedAt: null,
      nextDueAt: "2026-08-20T08:00:00Z",
      summary: null,
      pointCount: 1,
      pointTitles: ["FIFO置换"],
      timerSessionId: null,
    },
  ];

  const mockSimulations: SimulationExamDto[] = [
    {
      id: "s1",
      name: "2026七月全真模拟",
      examDate: "2026-07-15",
      isFirstSynchronized: false,
      targetDurationMinutes: 180,
      actualDurationMinutes: 175,
      targetScore: 350,
      actualScore: 360,
      blankQuestionCount: 0,
      lossReasons: ["CALCULATION_CARELESS"],
      mindset: "良好",
      summary: "总体平稳",
      reviewText: "注意计算",
      status: "CONFIRMED",
      timerSessionId: null,
      timerSessionStatus: null,
      confirmedAt: "2026-07-16T10:00:00Z",
      createdAt: "2026-07-15T00:00:00Z",
      updatedAt: "2026-07-16T10:00:00Z",
      revision: 2,
      totalsSource: "subject_sum",
      legacyDisplayTotals: null,
      warnings: [],
      subjectResults: [
        {
          id: "sub1",
          simulationExamId: "s1",
          subjectId: "math",
          subjectName: "数学",
          subjectColor: "#2dd4bf",
          paperFullScore: 150,
          targetScore: 120,
          actualScore: 125,
          durationMinutes: 60,
          blankQuestionCount: 0,
          lossReasons: ["CALCULATION_CARELESS"],
          summary: "计算小错",
          revision: 1,
          lossItems: [
            {
              id: "l1",
              reason: "CALCULATION_CARELESS",
              syllabusNodeId: "node-taylor",
              syllabusNodeTitle: "泰勒公式展开",
              lostScore: 10,
              note: "漏乘系数",
              mistakeId: null,
              revision: 1,
              archivedAt: null,
            },
          ],
        },
        {
          id: "sub2",
          simulationExamId: "s1",
          subjectId: "cs408",
          subjectName: "408专业课",
          subjectColor: "#38bdf8",
          paperFullScore: 150,
          targetScore: 110,
          actualScore: 115,
          durationMinutes: 60,
          blankQuestionCount: 0,
          lossReasons: ["CONCEPT_GAP"],
          summary: "概念混淆",
          revision: 1,
          lossItems: [
            {
              id: "l2",
              reason: "CONCEPT_GAP",
              syllabusNodeId: "node-tree",
              syllabusNodeTitle: "二叉树遍历性质",
              lostScore: 15,
              note: "线索树构造不清",
              mistakeId: null,
              revision: 1,
              archivedAt: null,
            },
          ],
        },
      ],
    },
    {
      id: "s2",
      name: "2026八月全真模拟",
      examDate: "2026-08-15",
      isFirstSynchronized: false,
      targetDurationMinutes: 180,
      actualDurationMinutes: 185,
      targetScore: 360,
      actualScore: 375,
      blankQuestionCount: 1,
      lossReasons: ["TIME_ALLOCATION"],
      mindset: "紧张",
      summary: "大题超时",
      reviewText: "把控时间",
      status: "CONFIRMED",
      timerSessionId: null,
      timerSessionStatus: null,
      confirmedAt: "2026-08-16T10:00:00Z",
      createdAt: "2026-08-15T00:00:00Z",
      updatedAt: "2026-08-16T10:00:00Z",
      revision: 2,
      totalsSource: "subject_sum",
      legacyDisplayTotals: null,
      warnings: [],
      subjectResults: [
        {
          id: "sub3",
          simulationExamId: "s2",
          subjectId: "math",
          subjectName: "数学",
          subjectColor: "#2dd4bf",
          paperFullScore: 150,
          targetScore: 125,
          actualScore: 130,
          durationMinutes: 65,
          blankQuestionCount: 0,
          lossReasons: ["TIME_ALLOCATION"],
          summary: "选做题纠结",
          revision: 1,
          lossItems: [
            {
              id: "l3",
              reason: "TIME_ALLOCATION",
              syllabusNodeId: "node-taylor",
              syllabusNodeTitle: "泰勒公式展开",
              lostScore: 8,
              note: "耗时过长未写完",
              mistakeId: null,
              revision: 1,
              archivedAt: null,
            },
          ],
        },
      ],
    },
  ];

  const kpis = calculateTestKpis(mockRetests, mockSimulations);

  // Retests: 2 closed (1 passed, 1 failed) -> 50%
  assert.equal(kpis.totalRetests, 3);
  assert.equal(kpis.openRetestsCount, 1);
  assert.equal(kpis.closedRetestsCount, 2);
  assert.equal(kpis.retestPassRate, 50);

  // Simulations: 2 confirmed, scores 360 and 375 -> avg 367.5, target 355 -> delta +12.5
  assert.equal(kpis.totalSimulations, 2);
  assert.equal(kpis.confirmedSimulationsCount, 2);
  assert.equal(kpis.avgActualScore, 367.5);
  assert.equal(kpis.avgTargetScore, 355);
  assert.equal(kpis.avgScoreDelta, 12.5);
  assert.deepEqual(kpis.scoreTrajectory, [360, 375]);
});

test("M4 Exam Command Deck: calculateMockExamTrends creates chronological trajectory with delta and pass-rate", () => {
  const mockSimulations: SimulationExamDto[] = [
    {
      id: "s1",
      name: "首场摸底模考",
      examDate: "2026-06-01",
      isFirstSynchronized: true,
      targetDurationMinutes: 180,
      actualDurationMinutes: 170,
      targetScore: 340,
      actualScore: 330,
      blankQuestionCount: 2,
      lossReasons: ["CONCEPT_GAP"],
      mindset: null,
      summary: null,
      reviewText: null,
      status: "CONFIRMED",
      timerSessionId: null,
      timerSessionStatus: null,
      confirmedAt: "2026-06-02T10:00:00Z",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-02T10:00:00Z",
      revision: 1,
      totalsSource: "subject_sum",
      legacyDisplayTotals: null,
      warnings: [],
      subjectResults: [],
    },
    {
      id: "s2",
      name: "中期提升模考",
      examDate: "2026-07-01",
      isFirstSynchronized: false,
      targetDurationMinutes: 180,
      actualDurationMinutes: 175,
      targetScore: 350,
      actualScore: 365,
      blankQuestionCount: 0,
      lossReasons: [],
      mindset: null,
      summary: null,
      reviewText: null,
      status: "CONFIRMED",
      timerSessionId: null,
      timerSessionStatus: null,
      confirmedAt: "2026-07-02T10:00:00Z",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-02T10:00:00Z",
      revision: 1,
      totalsSource: "subject_sum",
      legacyDisplayTotals: null,
      warnings: [],
      subjectResults: [],
    },
  ];

  const trend = calculateMockExamTrends(mockSimulations);
  assert.equal(trend.points.length, 2);
  assert.equal(trend.points[0].delta, -10);
  assert.equal(trend.points[0].isAboveTarget, false);
  assert.equal(trend.points[1].delta, 15);
  assert.equal(trend.points[1].isAboveTarget, true);
  assert.equal(trend.latestDelta, 15);
  assert.equal(trend.avgDelta, 2.5);
  assert.equal(trend.targetPassRate, 50);
});

test("M4 Exam Command Deck: calculateLossReasonDistribution and calculateWeakModuleLossRankings aggregate structured loss data", () => {
  const mockSimulations: SimulationExamDto[] = [
    {
      id: "s1",
      name: "模考1",
      examDate: "2026-08-01",
      isFirstSynchronized: false,
      targetDurationMinutes: 180,
      actualDurationMinutes: 180,
      targetScore: 350,
      actualScore: 340,
      blankQuestionCount: 0,
      lossReasons: [],
      mindset: null,
      summary: null,
      reviewText: null,
      status: "CONFIRMED",
      timerSessionId: null,
      timerSessionStatus: null,
      confirmedAt: "2026-08-02T10:00:00Z",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-02T10:00:00Z",
      revision: 1,
      totalsSource: "subject_sum",
      legacyDisplayTotals: null,
      warnings: [],
      subjectResults: [
        {
          id: "sub1",
          simulationExamId: "s1",
          subjectId: "math",
          subjectName: "数学",
          subjectColor: "#2dd4bf",
          paperFullScore: 150,
          targetScore: 120,
          actualScore: 110,
          durationMinutes: 60,
          blankQuestionCount: 0,
          lossReasons: ["CONCEPT_GAP", "CALCULATION_CARELESS"],
          summary: null,
          revision: 1,
          lossItems: [
            {
              id: "l1",
              reason: "CONCEPT_GAP",
              syllabusNodeId: "node-limit",
              syllabusNodeTitle: "洛必达法则与未定式极限",
              lostScore: 12,
              note: "未验证条件",
              mistakeId: null,
              revision: 1,
              archivedAt: null,
            },
            {
              id: "l2",
              reason: "CALCULATION_CARELESS",
              syllabusNodeId: "node-taylor",
              syllabusNodeTitle: "泰勒公式展开",
              lostScore: 8,
              note: "计算符号弄反",
              mistakeId: null,
              revision: 1,
              archivedAt: null,
            },
          ],
        },
      ],
    },
  ];

  const distribution = calculateLossReasonDistribution(mockSimulations);
  assert.equal(distribution.totalLostScore, 20);
  assert.equal(distribution.totalLossItemsCount, 2);
  assert.equal(distribution.items[0].reason, "CONCEPT_GAP");
  assert.equal(distribution.items[0].totalLostScore, 12);
  assert.equal(distribution.items[0].percentage, 60);

  const rankings = calculateWeakModuleLossRankings(mockSimulations, 5);
  assert.equal(rankings.length, 2);
  assert.equal(rankings[0].rank, 1);
  assert.equal(rankings[0].title, "洛必达法则与未定式极限");
  assert.equal(rankings[0].totalLostScore, 12);
  assert.equal(rankings[0].primaryReason, "CONCEPT_GAP");
});

test("M4 Exam Command Deck: buildPendingTestQueue prioritizes overdue retests and simulation drafts", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  const mockRetests: KnowledgeRetestListItemDto[] = [
    {
      id: "r-overdue",
      revision: 1,
      title: "已逾期复测考点",
      method: "BLIND_PROVE",
      status: "DRAFT",
      result: null,
      scheduledAt: "2026-08-20T08:00:00Z",
      testedAt: null,
      nextDueAt: "2026-08-20T08:00:00Z",
      summary: null,
      pointCount: 1,
      pointTitles: ["考点A"],
      timerSessionId: null,
    },
    {
      id: "r-today",
      revision: 1,
      title: "今日到期考点",
      method: "BLIND_PROVE",
      status: "DRAFT",
      result: null,
      scheduledAt: "2026-08-25T08:00:00Z",
      testedAt: null,
      nextDueAt: "2026-08-25T08:00:00Z",
      summary: null,
      pointCount: 1,
      pointTitles: ["考点B"],
      timerSessionId: null,
    },
  ];

  const mockSimulations: SimulationExamDto[] = [
    {
      id: "sim-draft",
      name: "未完成收口的模考草稿",
      examDate: "2026-08-25",
      isFirstSynchronized: false,
      targetDurationMinutes: 180,
      actualDurationMinutes: 180,
      targetScore: 350,
      actualScore: null,
      blankQuestionCount: 0,
      lossReasons: [],
      mindset: null,
      summary: null,
      reviewText: null,
      status: "DRAFT",
      timerSessionId: null,
      timerSessionStatus: null,
      confirmedAt: null,
      createdAt: "2026-08-25T00:00:00Z",
      updatedAt: "2026-08-25T00:00:00Z",
      revision: 1,
      totalsSource: "subject_sum",
      legacyDisplayTotals: null,
      warnings: [],
      subjectResults: [],
    },
  ];

  const queue = buildPendingTestQueue(mockRetests, mockSimulations, now);
  assert.equal(queue.length, 3);
  assert.equal(queue[0].dueStatus, "overdue");
  assert.equal(queue[0].id, "r-overdue");
  assert.equal(queue[1].dueStatus, "due_today");
  assert.equal(queue[1].id, "r-today");
  assert.equal(queue[2].dueStatus, "draft_pending");
  assert.equal(queue[2].id, "sim-draft");
});

test("M4 Exam Command Deck: Page and Component Architecture assertions", () => {
  const pageSource = loadSource("app/(app)/test/page.tsx");
  const commandDeckSource = loadSource("components/test/test-command-deck.tsx");
  const kpiStripSource = loadSource("components/test/test-kpi-strip.tsx");
  const trendSource = loadSource("components/test/test-mock-exam-trend.tsx");
  const rankingSource = loadSource("components/test/test-weak-loss-ranking.tsx");
  const queueSource = loadSource("components/test/test-pending-queue.tsx");

  // 1. /test page matches required test assertions
  assert.match(pageSource, /<Card[\s\S]*variant="master"/);
  assert.match(pageSource, /hover:border-teal-400\/40/);
  assert.match(pageSource, /hover:shadow-\[0_0_20px_rgba\(45,212,191,0\.15\)\]/);
  assert.match(pageSource, /<Card[\s\S]*variant="subtle"/);
  assert.match(pageSource, /检验规则/);
  assert.match(pageSource, /复测结果会更新知识点的掌握状态/);
  assert.match(pageSource, /className="af-content-grid-two grid gap-4 border-b border-white\/10 pb-7"/);
  assert.match(pageSource, /<TestCommandDeck/);

  // 2. Command Deck contains all sub-sections
  assert.match(commandDeckSource, /<TestKpiStrip/);
  assert.match(commandDeckSource, /<TestMockExamTrend/);
  assert.match(commandDeckSource, /<TestPendingQueue/);
  assert.match(commandDeckSource, /<TestWeakLossRanking/);

  // 3. Dark glassmorphism and padding contracts
  assert.match(kpiStripSource, /bg-\[#0e1619\]\/90 border border-white\/10/);
  assert.match(trendSource, /bg-\[#0e1619\]\/90 border border-white\/10/);
  assert.match(rankingSource, /bg-\[#0e1619\]\/90 border border-white\/10/);
  assert.match(queueSource, /bg-\[#0e1619\]\/90 border border-white\/10/);
});
