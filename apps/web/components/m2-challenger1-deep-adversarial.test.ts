import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  selectMistakePracticeCandidates,
  isPracticeReady,
  normalizePracticeCount,
} from "../lib/knowledge/mistake-practice.js";
import {
  masteryStatusLabel,
  masteryStatusTone,
  calculateMasteryConfidence,
} from "../lib/knowledge/mastery-status.js";
import type { MistakeDto } from "../lib/contracts/index.js";

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

// --------------------------------------------------------------------------
// 1. Note Card Grid and Detail View Tests
// --------------------------------------------------------------------------
test("NoteCard: Renders Dark Glass Master container, handles empty and populated attachments", () => {
  const noteCardSource = loadSource("components/note-card.tsx");

  // Master card variant and hover highlight
  assert.match(noteCardSource, /<Card[\s\S]*variant="master"/);
  assert.match(noteCardSource, /hover:border-white\/20/);

  // Attachment handling: formatBytes, download link, upload handler
  assert.match(noteCardSource, /formatBytes\(attachment\.sizeBytes\)/);
  assert.match(noteCardSource, /attachment\.downloadApiPath/);
  assert.match(noteCardSource, /还没有附件/);

  // Subject and mastery labeling
  assert.match(noteCardSource, /labelMastery\(note\.masteryStatus\)/);
  assert.match(noteCardSource, /note\.syllabusNodeTitle \?\? "未关联考纲"/);
});

test("NoteDetailClient & Sections: Structural integrity, draft persistence and conflict handling", () => {
  const detailClientSource = loadSource("components/note-detail-client.tsx");
  const detailSectionsSource = loadSource("components/note-detail-sections.tsx");

  // Master card wrappers for reading view and editor
  assert.match(detailClientSource, /<Card variant="master"[\s\S]*aria-labelledby="note-content-heading"/);
  assert.match(detailSectionsSource, /<Card variant="master"[\s\S]*aria-labelledby="note-editor-heading"/);
  assert.match(detailSectionsSource, /<Card variant="subtle"[\s\S]*id="note-review-section"/);
  assert.match(detailSectionsSource, /<Card variant="subtle"[\s\S]*aria-labelledby="note-relations-heading"/);

  // CAS Revision and Conflict resolution
  assert.match(detailClientSource, /expectedRevision:\s*draft\.baseRevision/);
  assert.match(detailClientSource, /adoptServerVersion/);
  assert.match(detailClientSource, /mergeOntoLatest/);
});

// --------------------------------------------------------------------------
// 2. Mistake Practice Client Workflows & Contrastive View Tests
// --------------------------------------------------------------------------
test("MistakePractice: Candidate selection algorithm enforces readiness, pool filtering, and deterministic sorting", () => {
  const baseMistake = (id: string, overrides: Partial<MistakeDto> = {}): MistakeDto => ({
    id,
    subjectId: "sub1",
    subjectName: "Math",
    subjectColor: "#0ea5e9",
    syllabusNodeId: "node1",
    syllabusNodeTitle: "Calculus",
    title: `Mistake ${id}`,
    questionText: "What is 2+2?",
    source: "2024 Exam",
    cause: "formula_unfamiliar",
    causeNote: "Forgot addition",
    correctAnswer: "4",
    correctIdea: "Add integers directly",
    nextReviewAt: null,
    attempts: [],
    attemptCount: 0,
    lastAttemptAt: null,
    noteLinks: [],
    resourceLinks: [],
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    reviewSchedule: null,
    reviewHistory: [],
    ...overrides,
  });

  // Ready mistake check
  assert.equal(isPracticeReady(baseMistake("1")), true);
  assert.equal(isPracticeReady(baseMistake("2", { cause: "unknown" })), false);
  assert.equal(isPracticeReady(baseMistake("3", { questionText: "" })), false);
  assert.equal(isPracticeReady(baseMistake("4", { correctIdea: "   " })), false);

  const now = new Date("2026-08-26T12:00:00.000Z");

  const unready = baseMistake("unready", { cause: "unknown" });
  const archived = baseMistake("archived", { archivedAt: "2026-08-10T00:00:00.000Z" });
  const regular = baseMistake("regular", { updatedAt: "2026-08-20T00:00:00.000Z" });
  const due = baseMistake("due", {
    reviewSchedule: {
      id: "sch1",
      status: "ACTIVE",
      dueDate: "2026-08-25T00:00:00.000Z",
      consecutivePassCount: 1,
      pausedReason: null,
      revision: 1,
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  });
  const failed = baseMistake("failed", {
    attempts: [{
      id: "att1",
      reviewEventId: null,
      attemptedAt: "2026-08-24T00:00:00.000Z",
      answerMode: "TEXT",
      answerText: "5",
      result: "FAILED",
      durationSeconds: 30,
      note: "Wrong sum",
    }],
    attemptCount: 1,
  });

  const all = [unready, archived, regular, due, failed];

  // Mixed pool should prioritize Due first, then Failed, then Regular, and ignore unready/archived
  const mixedCandidates = selectMistakePracticeCandidates(all, { pool: "mixed", count: 10, now });
  assert.equal(mixedCandidates.length, 3);
  assert.equal(mixedCandidates[0].id, "due");
  assert.equal(mixedCandidates[1].id, "failed");
  assert.equal(mixedCandidates[2].id, "regular");

  // Due pool only selects due
  const dueCandidates = selectMistakePracticeCandidates(all, { pool: "due", count: 10, now });
  assert.equal(dueCandidates.length, 1);
  assert.equal(dueCandidates[0].id, "due");

  // Failed pool only selects failed
  const failedCandidates = selectMistakePracticeCandidates(all, { pool: "failed", count: 10, now });
  assert.equal(failedCandidates.length, 1);
  assert.equal(failedCandidates[0].id, "failed");

  // Count normalization
  assert.equal(normalizePracticeCount(0), 5);
  assert.equal(normalizePracticeCount(-10), 5);
  assert.equal(normalizePracticeCount(100), 50);
  assert.equal(normalizePracticeCount(7.8), 7);
});

test("MistakePracticeClient: Workflow structure, contrastive view, and progress bar calculations", () => {
  const practiceClientSource = loadSource("components/mistake-practice-client.tsx");

  // Question phase progress bar math
  assert.match(practiceClientSource, /role="progressbar"/);
  assert.match(practiceClientSource, /aria-valuemax=\{props\.total\}/);
  assert.match(practiceClientSource, /style=\{\{\s*width:\s*`\$\{[\s\S]*\(props\.index \+ 1\)\s*\/\s*props\.total[\s\S]*\* 100\}%`\s*\}\}/);

  // Contrastive view cards
  assert.match(practiceClientSource, /标准答案/);
  assert.match(practiceClientSource, /正确思路/);
  assert.match(practiceClientSource, /<Card variant="subtle" className="p-4"/);

  // Answer mode switching (TEXT vs PAPER_OR_ORAL)
  assert.match(practiceClientSource, /'TEXT',\s*'文字作答'/);
  assert.match(practiceClientSource, /'PAPER_OR_ORAL',\s*'纸上 \/ 口头'/);

  // Result metrics summary
  assert.match(practiceClientSource, /通过.*题/);
  assert.match(practiceClientSource, /部分掌握.*题/);
  assert.match(practiceClientSource, /未通过.*题/);
});

// --------------------------------------------------------------------------
// 3. Syllabus Tree Hierarchy & Progress Bar Math Tests
// --------------------------------------------------------------------------
test("SyllabusTreeNode: Progress bar calculation, zero division safety, and tree recursion", () => {
  const treeNodeSource = loadSource("components/syllabus-manager-tree-node.tsx");

  // Progress math: node.targetMinutes === 0 ? 0 : Math.min(100, Math.round((node.actualMinutes / node.targetMinutes) * 100))
  assert.match(treeNodeSource, /node\.targetMinutes === 0\s*\?\s*0\s*:\s*Math\.min\(100,\s*Math\.round\(\(node\.actualMinutes\s*\/\s*node\.targetMinutes\)\s*\* 100\)\)/);

  // Glowing teal progress bar
  assert.match(treeNodeSource, /bg-teal-400/);
  assert.match(treeNodeSource, /shadow-\[0_0_8px_rgba\(45,212,191,0\.5\)\]/);

  // Tree recursion
  assert.match(treeNodeSource, /node\.children\.map\(\(child\)\s*=>/);
  assert.match(treeNodeSource, /<SyllabusTreeNode/);

  // Mastery warnings
  assert.match(treeNodeSource, /还没有掌握证据，不能直接标记掌握/);
  assert.match(treeNodeSource, /当前已记录证明还缺/);
});

// --------------------------------------------------------------------------
// 4. Knowledge Point Card Mastery Statuses & Confidence Math Tests
// --------------------------------------------------------------------------
test("KnowledgePoint & MasteryStatus: Quantitative confidence calculation and status labels", () => {
  // Test quantitative confidence math
  const perfectConfidence = calculateMasteryConfidence({
    evidenceCount: 5, // 5 * 8 = 40
    sessionCount: 5,  // 5 * 4 = 20
    noteCount: 3,     // 3 * 8 = 24
    mistakeCount: 2,  // 2 * 5 = 10
    passedRetestCount: 2, // 2 * 18 = 36
    daysSinceLastEvidence: 0, // penalty = 0
  }); // raw = 40 + 20 + 24 + 10 + 36 = 130 -> clamped to 100
  assert.equal(perfectConfidence, 100);

  const staleConfidence = calculateMasteryConfidence({
    evidenceCount: 2, // 16
    sessionCount: 1,  // 4
    noteCount: 1,     // 8
    mistakeCount: 0,  // 0
    passedRetestCount: 0, // 0 -> raw = 28
    daysSinceLastEvidence: 30, // penalty = (30 - 7) * 0.8 = 18.4 -> 28 - 18.4 = 9.6 -> 10
  });
  assert.equal(staleConfidence, 10);

  // Negative robustness
  const zeroConfidence = calculateMasteryConfidence({
    evidenceCount: -5,
    sessionCount: -2,
    noteCount: -1,
  });
  assert.equal(zeroConfidence, 0);

  // Mastery status views
  assert.equal(masteryStatusLabel("UNTOUCHED"), "未接触");
  assert.equal(masteryStatusLabel("LEARNING"), "学习中");
  assert.equal(masteryStatusLabel("INDEPENDENT"), "可独立应用");
  assert.equal(masteryStatusLabel("STABLE"), "稳定掌握");

  assert.equal(masteryStatusTone("UNTOUCHED"), "neutral");
  assert.equal(masteryStatusTone("LEARNING"), "info");
  assert.equal(masteryStatusTone("INDEPENDENT"), "warning");
  assert.equal(masteryStatusTone("STABLE"), "success");

  // Knowledge point card source check
  const pointCardSource = loadSource("components/knowledge-point-card.tsx");
  assert.match(pointCardSource, /<Card[\s\S]*variant="master"/);
  assert.match(pointCardSource, /masteryStatusTone\(point\.masteryStatus\)/);
  assert.match(pointCardSource, /masteryStatusLabel\(point\.masteryStatus\)/);
  assert.match(pointCardSource, /point\.needsRetest \? <Badge tone="warning">待复测<\/Badge> : null/);
  assert.match(pointCardSource, /可信度 \{point\.masteryConfidence\}%/);
});

// --------------------------------------------------------------------------
// 5. Study Resource Asset Card Grid Tests
// --------------------------------------------------------------------------
test("StudyResourceCard: Source type icons, organize status tones, and 3-column responsive layout", () => {
  const resourceCardSource = loadSource("components/study-resource-card.tsx");
  const resourceListSource = loadSource("components/study-resource-list.tsx");

  // Icons and source types
  assert.match(resourceCardSource, /resource\.sourceType === "FILE"/);
  assert.match(resourceCardSource, /<FileText/);
  assert.match(resourceCardSource, /<Globe/);

  // Organize status badge tones
  assert.match(resourceCardSource, /resource\.organizeStatus === "READY_FOR_USE" \? "success" : resource\.organizeStatus === "ARCHIVED" \? "neutral" : "warning"/);

  // List 3-column grid
  assert.match(resourceListSource, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(resourceListSource, /<StudyResourceCard/);
});

// --------------------------------------------------------------------------
// 6. Review Schedule Queue Ordering & Hero Card Tests
// --------------------------------------------------------------------------
test("ReviewScheduleQueue: Progress percentage math, Next Action Hero Card, and Queue segregation", () => {
  const reviewQueueSource = loadSource("components/review-schedule-queue.tsx");

  // Summary progress math: totalToday > 0 ? Math.round((completedTodayCount / totalToday) * 100) : 100
  assert.match(reviewQueueSource, /totalToday > 0 \? Math\.round\(\(props\.summary\.completedTodayCount \/ totalToday\) \* 100\) : 100/);

  // Hero Card variant accent
  assert.match(reviewQueueSource, /<Card variant="accent" className="p-5 sm:p-6"/);
  assert.match(reviewQueueSource, /下一项/);

  // Queue segregation: Next item is filteredDueItems[0], subsequent items is slice(1)
  assert.match(reviewQueueSource, /const next = filteredDueItems\[0\] \?\? null;/);
  assert.match(reviewQueueSource, /const subsequentDueItems = filteredDueItems\.slice\(1\);/);

  // Queue cards in 2-column grid
  assert.match(reviewQueueSource, /<div className="grid grid-cols-1 gap-4 md:grid-cols-2">/);

  // Quick defer actions (1 day / 3 days)
  assert.match(reviewQueueSource, /days: 1 \| 3/);
  assert.match(reviewQueueSource, /shiftShanghaiDateInput/);
});
