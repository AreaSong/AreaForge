import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { NoteCard } from "./note-card";
import { MistakeCard } from "./mistake-card";
import { KnowledgePointCard } from "./knowledge-point-card";
import { StudyResourceCard } from "./study-resource-card";
import {
  isPracticeReady,
  selectMistakePracticeCandidates,
} from "@/lib/knowledge/mistake-practice";
import {
  masteryStatusLabel,
  masteryStatusTone,
} from "@/lib/knowledge/mastery-status";
import type {
  NoteDto,
  MistakeDto,
  KnowledgePointDto,
  StudyResourceDto,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inspectElement(element: any): { type: any; props: any } {
  assert.ok(element != null, "Element must not be null or undefined");
  return {
    type: element.type,
    props: element.props ?? {},
  };
}

// ============================================================================
// SUITE 1: Note Card Grid and Detail View Adversarial Tests
// ============================================================================

test("NoteCard: Renders cleanly with full data and attachments", () => {
  const note: NoteDto = {
    id: "note-1",
    subjectId: "sub-math",
    subjectName: "高等数学",
    subjectColor: "#38bdf8",
    syllabusNodeId: "node-1",
    syllabusNodeTitle: "微积分基本定理",
    relatedSyllabusNodeIds: ["node-1"],
    taskId: "task-101",
    taskTitle: "高数定理强化练习",
    kind: "concept",
    studyDate: "2026-08-20",
    stableKey: "note-calc-1",
    revision: 1,
    archivedAt: null,
    title: "微积分第一基本定理与原函数存在性",
    content: "若 f 在 [a,b] 上连续，则变上限积分函数可导，且其导数等于被积函数。\n证明要点：利用积分中值定理推导差商极限。",
    masteryStatus: "understood",
    nextReviewAt: "2026-08-30T10:00:00.000Z",
    attachments: [
      {
        id: "att-1",
        noteId: "note-1",
        originalName: "calculus_theorem_proof.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1048576, // 1 MB
        downloadApiPath: "/api/attachments/att-1",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        id: "att-2",
        noteId: "note-1",
        originalName: "geom_graph.png",
        mimeType: "image/png",
        sizeBytes: 20480, // 20 KB
        downloadApiPath: "/api/attachments/att-2",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
    ],
    relatedSyllabusNodes: [],
    linkedResources: [],
    reviewSchedule: null,
    updatedAt: "2026-08-26T00:00:00.000Z",
    createdAt: "2026-08-20T00:00:00.000Z",
  };

  const element = NoteCard({
    note,
    uploading: false,
    uploadError: null,
    onUpload: () => {},
  });

  const { props } = inspectElement(element);
  assert.equal(props.variant, "master");
  assert.ok(props.className.includes("p-3.5") || props.className.includes("p-4") || props.className.includes("p-5"));

  // Check details & attachments rendering
  const source = loadSource("components/note-card.tsx");
  assert.match(source, /formatBytes\(attachment\.sizeBytes\)/);
  assert.match(source, /note\.attachments\.length/);
});

test("NoteCard: Resilient to missing optional fields, zero attachments, and upload errors", () => {
  const noteMinimal: NoteDto = {
    id: "note-min",
    subjectId: "sub-eng",
    subjectName: "考研英语",
    subjectColor: "#a855f7",
    syllabusNodeId: null,
    syllabusNodeTitle: null,
    relatedSyllabusNodeIds: [],
    taskId: null,
    taskTitle: null,
    kind: "reading",
    studyDate: null,
    stableKey: "note-min-1",
    revision: 1,
    archivedAt: null,
    title: "极简笔记标题",
    content: "无考纲、无关联任务的单行内容",
    masteryStatus: null,
    nextReviewAt: null,
    attachments: [],
    relatedSyllabusNodes: [],
    linkedResources: [],
    reviewSchedule: null,
    updatedAt: "2026-08-26T08:00:00.000Z",
    createdAt: "2026-08-26T08:00:00.000Z",
  };

  const element = NoteCard({
    note: noteMinimal,
    uploading: true,
    uploadError: "文件超出最大限制 (10MB)",
    onUpload: () => {},
  });

  const { props } = inspectElement(element);
  assert.equal(props.variant, "master");

  const [topSection, bottomSection] = props.children;
  // Check top section: syllabusNodeTitle fallback
  const topChildren = topSection.props.children;
  assert.equal(topChildren[3].props.children, "未关联考纲");

  // Check bottom section: upload error role="alert"
  const details = bottomSection.props.children[1];
  const detailsBox = details.props.children[1];
  const alertP = detailsBox.props.children[2];
  assert.ok(alertP != null);
  assert.equal(alertP.props.children, "文件超出最大限制 (10MB)");
  assert.equal(alertP.props.role, "alert");
});

test("NoteLibraryView: 3-column responsive grid architecture", () => {
  const source = loadSource("components/note-library-view.tsx");
  assert.match(source, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(source, /<NoteLibraryItem/);
  assert.match(source, /<EmptyState/);
});

// ============================================================================
// SUITE 2: Mistake Practice Client Workflows and Contrastive View
// ============================================================================

test("Mistake Practice Logic: selectMistakePracticeCandidates pool filtering and sorting invariants", () => {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const mistakes: MistakeDto[] = [
    {
      id: "m-1",
      subjectId: "sub-math",
      subjectName: "高等数学",
      subjectColor: "#38bdf8",
      syllabusNodeId: "node-1",
      syllabusNodeTitle: "积分中值定理",
      title: "积分中值定理反例构造错误",
      questionText: "构造闭区间上不满足积分第一中值定理的非连续函数",
      cause: "concept_confusion",
      causeNote: null,
      correctAnswer: "f(x) = sign(x) 在 [-1, 1]",
      correctIdea: "必须明确被积函数必须连续或满足保号性",
      source: "张宇 1000 题",
      attemptCount: 2,
      lastAttemptAt: "2026-08-25T12:00:00.000Z",
      attempts: [
        {
          id: "att-1",
          reviewEventId: null,
          answerMode: "TEXT",
          answerText: "误写为狄利克雷函数",
          result: "FAILED",
          durationSeconds: 120,
          note: "混淆了可积极性与介值性",
          attemptedAt: "2026-08-25T12:00:00.000Z",
        },
      ],
      nextReviewAt: "2026-08-20T00:00:00.000Z",
      archivedAt: null,
      noteLinks: [],
      resourceLinks: [],
      reviewSchedule: {
        id: "rs-1",
        status: "ACTIVE",
        dueDate: "2026-08-20T00:00:00.000Z", // overdue
        pausedReason: null,
        consecutivePassCount: 0,
        revision: 1,
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
      reviewHistory: [],
      updatedAt: "2026-08-25T12:00:00.000Z",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: "m-2",
      subjectId: "sub-math",
      subjectName: "高等数学",
      subjectColor: "#38bdf8",
      syllabusNodeId: "node-2",
      syllabusNodeTitle: "微分方程",
      title: "二阶常系数非齐次线性微分方程特解形式",
      questionText: "求 y'' - 2y' + y = e^x 的特解形式",
      cause: "formula_unfamiliar",
      causeNote: null,
      correctAnswer: "y* = A x^2 e^x",
      correctIdea: "特征根为 1 (二重根)，故待定多项式需乘 x^2",
      source: "汤家凤 1800",
      attemptCount: 1,
      lastAttemptAt: "2026-08-26T00:00:00.000Z",
      attempts: [
        {
          id: "att-2",
          reviewEventId: null,
          answerMode: "TEXT",
          answerText: "正确作答",
          result: "PASSED",
          durationSeconds: 90,
          note: null,
          attemptedAt: "2026-08-26T00:00:00.000Z",
        },
      ],
      nextReviewAt: "2026-08-26T00:00:00.000Z",
      archivedAt: null,
      noteLinks: [],
      resourceLinks: [],
      reviewSchedule: {
        id: "rs-2",
        status: "ACTIVE",
        dueDate: "2026-08-26T00:00:00.000Z", // due today (later than m-1)
        pausedReason: null,
        consecutivePassCount: 1,
        revision: 2,
        updatedAt: "2026-08-26T00:00:00.000Z",
      },
      reviewHistory: [],
      updatedAt: "2026-08-26T00:00:00.000Z",
      createdAt: "2026-08-22T00:00:00.000Z",
    },
    {
      id: "m-unready",
      subjectId: "sub-math",
      subjectName: "高等数学",
      subjectColor: "#38bdf8",
      syllabusNodeId: "node-2",
      syllabusNodeTitle: "微分方程",
      title: "待补全错题（未填正确思路）",
      questionText: "题面...",
      cause: "unknown",
      causeNote: null,
      correctAnswer: "",
      correctIdea: "", // Missing correctIdea
      source: null,
      attemptCount: 0,
      lastAttemptAt: null,
      attempts: [],
      nextReviewAt: null,
      archivedAt: null,
      noteLinks: [],
      resourceLinks: [],
      reviewSchedule: null,
      reviewHistory: [],
      updatedAt: "2026-08-26T00:00:00.000Z",
      createdAt: "2026-08-26T00:00:00.000Z",
    },
    {
      id: "m-archived",
      subjectId: "sub-math",
      subjectName: "高等数学",
      subjectColor: "#38bdf8",
      syllabusNodeId: "node-2",
      syllabusNodeTitle: "微分方程",
      title: "已归档错题",
      questionText: "题面...",
      cause: "careless",
      causeNote: null,
      correctAnswer: "42",
      correctIdea: "仔细验算",
      source: null,
      attemptCount: 3,
      lastAttemptAt: null,
      attempts: [],
      nextReviewAt: "2026-08-20T00:00:00.000Z",
      archivedAt: "2026-08-26T00:00:00.000Z",
      noteLinks: [],
      resourceLinks: [],
      reviewSchedule: {
        id: "rs-arch",
        status: "ACTIVE",
        dueDate: "2026-08-20T00:00:00.000Z",
        pausedReason: null,
        consecutivePassCount: 3,
        revision: 3,
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
      reviewHistory: [],
      updatedAt: "2026-08-26T00:00:00.000Z",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
  ];

  // 1. isPracticeReady checks
  assert.equal(isPracticeReady(mistakes[0]), true);
  assert.equal(isPracticeReady(mistakes[1]), true);
  assert.equal(isPracticeReady(mistakes[2]), false); // Unready
  assert.equal(isPracticeReady(mistakes[3]), true); // Valid data, but archived

  // 2. selectMistakePracticeCandidates excludes unready and archived items, sorts earlier due date first
  const poolMixed = selectMistakePracticeCandidates(mistakes, { pool: "mixed", count: 10, now });
  assert.equal(poolMixed.length, 2);
  assert.equal(poolMixed[0].id, "m-1"); // earlier due date (2026-08-20 vs 2026-08-26)
  assert.equal(poolMixed[1].id, "m-2");

  // 3. Pool = "failed"
  const poolFailed = selectMistakePracticeCandidates(mistakes, { pool: "failed", count: 10, now });
  assert.equal(poolFailed.length, 1);
  assert.equal(poolFailed[0].id, "m-1");

  // 4. Pool = "due"
  const poolDue = selectMistakePracticeCandidates(mistakes, { pool: "due", count: 10, now });
  assert.equal(poolDue.length, 2);

  // 5. Subject filtering
  const poolEnglish = selectMistakePracticeCandidates(mistakes, { subjectId: "sub-eng", pool: "mixed", count: 10, now });
  assert.equal(poolEnglish.length, 0);
});

test("MistakeCard: Renders cause badge, attempt count, and completion warning", () => {
  const mistakeReady: MistakeDto = {
    id: "m-ready",
    subjectId: "sub-math",
    subjectName: "高等数学",
    subjectColor: "#38bdf8",
    syllabusNodeId: "node-1",
    syllabusNodeTitle: "极限定义",
    title: "ε-δ 语言证明极限题目符号颠倒",
    questionText: "用 ε-δ 语言证明 lim(x->2) (3x - 1) = 5",
    cause: "concept_confusion",
    causeNote: null,
    correctAnswer: "取 δ = ε / 3",
    correctIdea: "恒等变形 |3x - 1 - 5| = 3|x - 2| < ε",
    source: "高等数学第七版例题",
    attemptCount: 3,
    lastAttemptAt: "2026-08-25T00:00:00.000Z",
    attempts: [
      {
        id: "att-1",
        reviewEventId: null,
        answerMode: "TEXT",
        answerText: "误写为 δ = 3ε",
        result: "PASSED",
        durationSeconds: 60,
        note: null,
        attemptedAt: "2026-08-25T00:00:00.000Z",
      },
    ],
    nextReviewAt: "2026-08-27T00:00:00.000Z",
    archivedAt: null,
    noteLinks: [],
    resourceLinks: [],
    reviewSchedule: null,
    reviewHistory: [],
    updatedAt: "2026-08-25T00:00:00.000Z",
    createdAt: "2026-08-20T00:00:00.000Z",
  };

  const elementReady = MistakeCard({ mistake: mistakeReady });
  const inspectReady = inspectElement(elementReady);
  assert.equal(inspectReady.props.variant, "master");

  // Ready mistake has no warning
  const bottomReady = inspectReady.props.children[1];
  assert.equal(bottomReady.props.children[1], null);

  // Unready mistake displays completion warning
  const mistakeUnready: MistakeDto = {
    ...mistakeReady,
    id: "m-unready",
    cause: "unknown",
    correctIdea: "",
  };
  const elementUnready = MistakeCard({ mistake: mistakeUnready });
  const inspectUnready = inspectElement(elementUnready);
  const bottomUnready = inspectUnready.props.children[1];
  const warningDiv = bottomUnready.props.children[1];
  assert.ok(warningDiv != null);
  assert.ok(warningDiv.props.className.includes("bg-amber-500/10"));
  assert.equal(warningDiv.props.children[1].props.children, "待补全错因和正确思路后才能进入快速复习");
});

test("MistakePracticeClient: Workflow architecture and contrastive view validation", () => {
  const source = loadSource("components/mistake-practice-client.tsx");

  // 1. Three distinct phases: setup -> active -> done
  assert.match(source, /type PracticePhase = "setup" \| "active" \| "done"/);

  // 2. Zero unstyled inputs / select primitive compliance
  assert.match(source, /<Select[\s\S]*aria-label="练习科目"/);
  assert.match(source, /<Select[\s\S]*aria-label="抽题范围"/);
  assert.match(source, /<Button[\s\S]*variant="primary"[\s\S]*开始本轮练习/);

  // 3. Contrastive view cards: Standard answer + Correct idea
  assert.match(source, /<Card variant="subtle" className="p-4">[\s\S]*标准答案/);
  assert.match(source, /<Card variant="subtle" className="p-4">[\s\S]*正确思路/);

  // 4. Conflict resolution integration
  assert.match(source, /<ConflictResolutionModal/);
  assert.match(source, /title="处理错题作答冲突"/);
});

// ============================================================================
// SUITE 3: Syllabus Tree Hierarchy and Progress Bar Math
// ============================================================================

test("SyllabusTreeNode Math: Division by zero safety and percentage clamping", () => {
  const source = loadSource("components/syllabus-manager-tree-node.tsx");

  // Verify division-by-zero check and Math.min(100, Math.round((actual / target) * 100))
  assert.match(source, /const progress = node\.targetMinutes === 0/);
  assert.match(source, /\? 0/);
  assert.match(source, /: Math\.min\(100, Math\.round\(\(node\.actualMinutes \/ node\.targetMinutes\) \* 100\)\)/);

  // Test the math logic directly
  function calcProgress(actual: number, target: number): number {
    return target === 0 ? 0 : Math.min(100, Math.round((actual / target) * 100));
  }

  assert.equal(calcProgress(0, 0), 0); // 0/0 -> 0 (no NaN)
  assert.equal(calcProgress(50, 0), 0); // 50/0 -> 0 (no Infinity)
  assert.equal(calcProgress(0, 120), 0); // 0/120 -> 0%
  assert.equal(calcProgress(60, 120), 50); // 60/120 -> 50%
  assert.equal(calcProgress(120, 120), 100); // 120/120 -> 100%
  assert.equal(calcProgress(180, 120), 100); // 180/120 -> clamped to 100%
  assert.equal(calcProgress(33, 100), 33);
});

test("SyllabusTreeNode: Hierarchy, glowing teal progress, and status tones", () => {
  const source = loadSource("components/syllabus-manager-tree-node.tsx");

  // 1. Glowing teal progress bar
  assert.match(source, /bg-teal-400 shadow-\[0_0_8px_rgba\(45,212,191,0\.5\)\]/);
  assert.match(source, /style=\{\{ width: `\$\{progress\}%` \}\}/);

  // 2. Status tone mapping helper
  assert.match(source, /function getStatusTone\(status: SyllabusNodeStatusDto\)/);
  assert.match(source, /if \(status === "weak" \|\| status === "needs_review"\) return "warning"/);
  assert.match(source, /return status === "mastered" \? "success" : "neutral"/);

  // 3. Recursive children container
  assert.match(source, /node\.children\.length > 0/);
  assert.match(source, /border-l border-white\/10 pl-3/);
});

// ============================================================================
// SUITE 4: Knowledge Point Card Mastery Statuses and Boundaries
// ============================================================================

test("KnowledgePointCard: Mastery status tone & label mappings", () => {
  const statuses = [
    { status: "UNTOUCHED", label: "未接触", tone: "neutral" },
    { status: "LEARNING", label: "学习中", tone: "info" },
    { status: "INDEPENDENT", label: "可独立应用", tone: "warning" },
    { status: "STABLE", label: "稳定掌握", tone: "success" },
  ] as const;

  for (const item of statuses) {
    assert.equal(masteryStatusLabel(item.status), item.label);
    assert.equal(masteryStatusTone(item.status), item.tone);
  }
});

test("KnowledgePointCard: Renders card variant master, confidence, and boundary fallback", () => {
  const pointFull: KnowledgePointDto = {
    id: "kp-1",
    stableKey: "kp-taylor-1",
    title: "泰勒公式与麦克劳林展开",
    boundary: "掌握常见 8 种初等函数的展开式与皮亚诺余项应用",
    masteryState: "STABLE_MASTERY",
    masteryStatus: "STABLE",
    needsRetest: false,
    masteryConfidence: 95,
    nextRetestAt: null,
    revision: 1,
    subject: { id: "sub-math", name: "高等数学", color: "#38bdf8", stableKey: "math" },
    primaryGroup: { id: "grp-1", title: "高等数学第一章", stableKey: "math-ch1" },
    relatedSubjects: [],
    counts: {
      syllabusLinks: 2,
      stageTargets: 1,
      arrangements: 1,
      sessions: 5,
      retests: 3,
      evidence: 8,
    },
    updatedAt: "2026-08-26T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  };

  const elementFull = KnowledgePointCard({
    point: pointFull,
    detailHref: "/knowledge/points/kp-1",
  });
  const inspectFull = inspectElement(elementFull);
  assert.equal(inspectFull.props.variant, "master");

  // Minimal boundary fallback test
  const pointMinimal: KnowledgePointDto = {
    ...pointFull,
    id: "kp-min",
    primaryGroup: null,
    boundary: null,
    needsRetest: true,
    masteryConfidence: 40,
    masteryState: "NEEDS_RETEST",
    masteryStatus: "LEARNING",
  };

  const elementMinimal = KnowledgePointCard({
    point: pointMinimal,
    detailHref: "/knowledge/points/kp-min",
  });
  const inspectMinimal = inspectElement(elementMinimal);
  const [topSection, bottomSection] = inspectMinimal.props.children;

  // Check top badges & boundary fallback
  const topChildren = topSection.props.children;
  const badgesRow = topChildren[0].props.children;
  assert.equal(badgesRow[1].props.children, "待复测"); // needsRetest badge
  assert.equal(topChildren[2].props.children[1], "未设置边界说明");

  // Check bottom stats
  const statsText = bottomSection.props.children[0].props.children;
  assert.equal(statsText[4], 40); // 40% confidence
});

// ============================================================================
// SUITE 5: Study Resource Asset Card Grid
// ============================================================================

test("StudyResourceCard: Renders FILE vs LINK icons, organize statuses, and categories", () => {
  const resourceFile: StudyResourceDto = {
    id: "res-file",
    workspaceId: "ws-1",
    stableKey: "res-pol-1",
    title: "考研政治 1000 题高清 PDF",
    category: "EXERCISE",
    sourceType: "FILE",
    subjectId: "sub-pol",
    attachmentId: "att-1",
    externalUrl: null,
    displayHost: null,
    duplicateOfResourceId: null,
    revision: 1,
    archivedAt: null,
    organizeStatus: "READY_FOR_USE",
    tags: ["政治", "刷题"],
    taskIds: [],
    noteIds: [],
    mistakeIds: [],
    syllabusNodeIds: [],
    mimeType: "application/pdf",
    originalName: "pol1000.pdf",
    sizeBytes: 52428800,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };

  const elementFile = StudyResourceCard({
    resource: resourceFile,
    subjectName: "考研政治",
  });
  const inspectFile = inspectElement(elementFile);
  assert.equal(inspectFile.props.variant, "master");

  const resourceLink: StudyResourceDto = {
    id: "res-link",
    workspaceId: "ws-1",
    stableKey: "res-csapp-1",
    title: "CSAPP 在线交互式仿真平台",
    category: "SIMULATION",
    sourceType: "LINK",
    subjectId: "sub-cs",
    attachmentId: null,
    externalUrl: "https://csapp.cs.cmu.edu/3e/labs.html",
    displayHost: "csapp.cs.cmu.edu",
    duplicateOfResourceId: null,
    revision: 1,
    archivedAt: null,
    organizeStatus: "UNSORTED",
    tags: ["408", "实验"],
    taskIds: [],
    noteIds: [],
    mistakeIds: [],
    syllabusNodeIds: [],
    mimeType: null,
    originalName: null,
    sizeBytes: null,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };

  const elementLink = StudyResourceCard({
    resource: resourceLink,
    subjectName: "408 计算机基础",
  });
  const inspectLink = inspectElement(elementLink);
  assert.equal(inspectLink.props.variant, "master");

  const source = loadSource("components/study-resource-card.tsx");
  assert.match(source, /sourceType === "FILE"/);
  assert.match(source, /sourceTypeLabel\(resource\.sourceType\)/);
  assert.match(source, /organizeStatusLabel\(resource\.organizeStatus\)/);
});

test("StudyResourceList: Responsive 3-column grid architecture", () => {
  const source = loadSource("components/study-resource-list.tsx");
  assert.match(source, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(source, /<StudyResourceCard/);
});

// ============================================================================
// SUITE 6: Review Schedule Queue Ordering and Hero Card
// ============================================================================

test("ReviewScheduleQueue: Progress math, Accent Hero, and 2-column queue cards", () => {
  const source = loadSource("components/review-schedule-queue.tsx");

  // 1. Progress math division by zero safety
  assert.match(source, /const totalToday = props\.summary\.completedTodayCount \+ props\.dueItems\.length/);
  assert.match(source, /const progress = totalToday > 0 \? Math\.round\(\(props\.summary\.completedTodayCount \/ totalToday\) \* 100\) : 0/);

  // Test math invariants
  function calcReviewProgress(completed: number, due: number): number {
    const total = completed + due;
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  }
  assert.equal(calcReviewProgress(0, 0), 0); // no schedule is not fabricated as completion
  assert.equal(calcReviewProgress(5, 5), 50);
  assert.equal(calcReviewProgress(10, 0), 100);
  assert.equal(calcReviewProgress(0, 10), 0);

  // 2. Next item in Accent Card vs Subsequent items in Master Cards
  assert.match(source, /const next = filteredDueItems\[0\] \?\? null/);
  assert.match(source, /const subsequentDueItems = filteredDueItems\.slice\(1\)/);
  assert.match(source, /<Card variant="accent" className="p-5 sm:p-6">/);
  assert.match(source, /<Card variant="master"/);

  // 3. 2-column queue grid layout
  assert.match(source, /grid grid-cols-1 gap-4 md:grid-cols-2/);

  // 4. Date formatting and overdue/today checks
  assert.match(source, /function isOverdue\(value: string \| null\)/);
  assert.match(source, /function isToday\(value: string \| null\)/);
});
