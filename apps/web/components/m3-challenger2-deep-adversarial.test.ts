import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { retestStatusLabel } from "./retest-card";
import {
  isReadyForConfirmation,
  hasPersistedSubjectResults,
  buildSubjectDrafts,
  toSimulationEditorDraft,
  remediationInboxStatusLabel,
  lossMutationNotice,
  labelSaveError,
  labelLossItemError,
  hasPendingPersistedLossEdits,
  replaceLossConflictItem,
  sameStringSet,
  type SubjectDraft,
  type LossItemConflict,
  type SimulationLossItemDraft,
} from "./simulation-detail-drafts";
import type { SimulationExamDto, SimulationLossItemDto } from "../lib/contracts";

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
// 1. Retest Card & Status Matrix Stress Tests
// --------------------------------------------------------------------------
test("M3 CHALLENGER 2: Retest Status Matrix & Boundary Conditions", () => {
  // Closed status matrix
  assert.equal(retestStatusLabel("CLOSED", "PASSED"), "通过");
  assert.equal(retestStatusLabel("CLOSED", "PARTIAL"), "部分掌握");
  assert.equal(retestStatusLabel("CLOSED", "FAILED"), "未通过");
  assert.equal(retestStatusLabel("CLOSED", null), "未通过");
  assert.equal(retestStatusLabel("CLOSED", "CORRUPTED_VALUE"), "未通过");

  // Active status matrix
  assert.equal(retestStatusLabel("PENDING_REVIEW", null), "待确认");
  assert.equal(retestStatusLabel("PENDING_REVIEW", "PASSED"), "待确认");
  assert.equal(retestStatusLabel("IN_PROGRESS", null), "进行中");
  assert.equal(retestStatusLabel("IN_PROGRESS", "PARTIAL"), "进行中");
  assert.equal(retestStatusLabel("DRAFT", null), "待开始");
  assert.equal(retestStatusLabel("ANY_UNKNOWN_STATUS", null), "待开始");
});

test("M3 CHALLENGER 2: Retest Card Code Inspections & Primitives", () => {
  const source = loadSource("components/retest-card.tsx");

  // Master Card token & glass elevation
  assert.match(source, /variant="master"/);
  assert.match(source, /hover:border-teal-400\/30/);
  assert.match(source, /hover:shadow-\[0_0_16px_rgba\(45,212,191,0\.1\)\]/);

  // Point badge truncation (up to 4, then +N counter)
  assert.match(source, /item\.pointTitles\.slice\(0,\s*4\)/);
  assert.match(source, /item\.pointTitles\.length\s*>\s*4/);
  assert.match(source, /\+\{item\.pointTitles\.length\s*-\s*4\}/);

  // Accessible navigation link
  assert.match(source, /aria-label=\{`打开复测 \$\{item\.title\}`\}/);
});

// --------------------------------------------------------------------------
// 2. Simulation Exam Card Logic & Fallbacks
// --------------------------------------------------------------------------
test("M3 CHALLENGER 2: Simulation Exam Card State Derivations", () => {
  const source = loadSource("components/simulation-exam-card.tsx");

  // Variant switching: primary ? "accent" : "master"
  assert.match(source, /variant=\{primary \? "accent" : "master"\}/);

  // Next action determination: DRAFT with/without subjects, CONFIRMED with/without loss
  assert.match(source, /exam\.status === "DRAFT"/);
  assert.match(source, /exam\.subjectResults\.length > 0/);
  assert.match(source, /"核对并确认"/);
  assert.match(source, /"录入分科成绩"/);
  assert.match(source, /lossCount > 0/);
  assert.match(source, /"选择补救"/);
  assert.match(source, /"查看考试事实"/);

  // Legacy fallback support vs subject sum score badge
  assert.match(source, /totalsSource === "legacy_fallback"/);
  assert.match(source, /旧版总分记录/);

  // Warning banner handling
  assert.match(source, /exam\.warnings\[0\]/);

  // Accessibility aria-label
  assert.match(source, /aria-label=\{`\$\{nextAction\} \$\{exam\.name\}`\}/);
});

// --------------------------------------------------------------------------
// 3. Widescreen 1500px Anti-Stretching & Responsive Layouts
// --------------------------------------------------------------------------
test("M3 CHALLENGER 2: Responsive Multi-Column Grid Layouts (Anti-Stretching)", () => {
  const testOverview = loadSource("app/(app)/test/page.tsx");
  const retestsPage = loadSource("app/(app)/test/retests/page.tsx");
  const simulationsPage = loadSource("lib/routes/test-simulations-page.tsx");
  const retestCreate = loadSource("components/knowledge-retest-create-form.tsx");
  const remediationSection = loadSource("components/simulation-detail-remediation.tsx");

  // /test overview uses af-content-grid-two
  assert.match(testOverview, /className="af-content-grid-two grid gap-4 border-b border-white\/10 pb-7"/);

  // /test/retests uses 2-column grid for open and closed sections
  assert.match(retestsPage, /<div className="grid grid-cols-1 gap-4 md:grid-cols-2">/);

  // /test/simulations uses 2-column grid for active and confirmed sections
  assert.match(simulationsPage, /<div className="grid grid-cols-1 gap-4 md:grid-cols-2">/);

  // Retest create form uses 2-column checkbox grid for knowledge points
  assert.match(retestCreate, /className="grid grid-cols-1 gap-2\.5 sm:grid-cols-2"/);

  // Remediation section uses 2-column checkbox grid for loss items
  assert.match(remediationSection, /className="af-content-grid-two grid grid-cols-1 gap-3 sm:grid-cols-2"/);
});

// --------------------------------------------------------------------------
// 4. Ergonomics: Sticky PinnedActionBar & Viewport Safe Padding
// --------------------------------------------------------------------------
test("M3 CHALLENGER 2: Sticky PinnedActionBar & Viewport Safe Padding", () => {
  const retestCreate = loadSource("components/knowledge-retest-create-form.tsx");
  const retestDetail = loadSource("components/knowledge-retest-detail-client.tsx");
  const simulationWorkspace = loadSource("components/simulation-detail-workspace.tsx");

  // Retest Create: sticky action bar with pb-24 bottom padding
  assert.match(retestCreate, /className="space-y-6 pb-24"/);
  assert.match(retestCreate, /<PinnedActionBar[\s\S]*mode="sticky"/);

  // Retest Detail: sticky action bar with pb-24 bottom padding
  assert.match(retestDetail, /className="space-y-6 pb-24"/);
  assert.match(retestDetail, /<PinnedActionBar[\s\S]*mode="sticky"/);

  // Simulation Workspace: sticky action bar with conditional pb-24 bottom padding when active
  assert.match(simulationWorkspace, /className=\{`space-y-6 \$\{isConfirmed \? "" : "pb-24"\}`\}/);
  assert.match(simulationWorkspace, /<PinnedActionBar[\s\S]*mode="sticky"/);
});

// --------------------------------------------------------------------------
// 5. 5-Field Scoreboard Editor & Loss Attribution Controls
// --------------------------------------------------------------------------
test("M3 CHALLENGER 2: 5-Field Scoreboard Editor & Step/Min Attributes", () => {
  const editor = loadSource("components/simulation-detail-subject-editor.tsx");

  // Grid layout across breakpoints
  assert.match(editor, /className="af-five-field-grid mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"/);

  // Field configurations: paperFullScore, targetScore, actualScore, durationMinutes, blankQuestionCount
  assert.match(editor, /\["paperFullScore", "卷面满分", 1, 0\]/);
  assert.match(editor, /\["targetScore", "目标分", 0\.5, 0\]/);
  assert.match(editor, /\["actualScore", "实际分", 0\.5, 0\]/);
  assert.match(editor, /\["durationMinutes", "用时（分）", 1, 0\]/);
  assert.match(editor, /\["blankQuestionCount", "未作答数", 1, 0\]/);
});

// --------------------------------------------------------------------------
// 6. Accessibility & Keyboard Navigation Contracts
// --------------------------------------------------------------------------
test("M3 CHALLENGER 2: Tablist & Accessible Roles in Simulation Workspace", () => {
  const workspace = loadSource("components/simulation-detail-workspace.tsx");

  // SubjectTabs must implement complete WAI-ARIA tablist contract
  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /aria-label="模拟科目，可横向滚动"/);
  assert.match(workspace, /role="tab"/);
  assert.match(workspace, /aria-selected=\{isActive\}/);
  assert.match(workspace, /aria-controls=\{`\$\{props\.subjectTabsId\}-panel-\$\{subject\.id\}`\}/);
  assert.match(workspace, /onKeyDown=\{props\.onSubjectTabKeyDown\}/);

  // Tabpanel container
  assert.match(workspace, /role="tabpanel"/);
  assert.match(workspace, /aria-labelledby=\{`\$\{props\.subjectTabsId\}-tab-\$\{props\.active\.subjectId\}`\}/);
});

// --------------------------------------------------------------------------
// 7. Simulation Draft Logic & Mathematical Oracles
// --------------------------------------------------------------------------
test("M3 CHALLENGER 2: Simulation Draft Domain Rules & Invariant Oracles", () => {
  const mockExam: SimulationExamDto = {
    id: "sim-oracle-1",
    revision: 3,
    name: "2026 CS 408 Mock 1",
    examDate: "2026-08-26",
    isFirstSynchronized: true,
    targetDurationMinutes: 180,
    actualDurationMinutes: 175,
    targetScore: 120,
    actualScore: 110,
    blankQuestionCount: 1,
    lossReasons: ["CONCEPT_GAP", "CALCULATION_CARELESS"],
    mindset: "Steady and focused",
    summary: "Solid performance in Data Structures",
    reviewText: "Need to review Graph Algorithms and Cache mapping",
    status: "DRAFT",
    timerSessionId: null,
    timerSessionStatus: null,
    confirmedAt: null,
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
    totalsSource: "subject_sum",
    legacyDisplayTotals: null,
    warnings: [],
    subjectResults: [
      {
        id: "sr-1",
        simulationExamId: "sim-oracle-1",
        revision: 1,
        subjectId: "sub-cs",
        subjectName: "Computer Science 408",
        subjectColor: "#0ea5e9",
        paperFullScore: 150,
        targetScore: 120,
        actualScore: 110,
        durationMinutes: 175,
        blankQuestionCount: 1,
        lossReasons: ["CONCEPT_GAP"],
        summary: "One blank question on OS paging",
        lossItems: [
          {
            id: "loss-1",
            revision: 1,
            reason: "CONCEPT_GAP",
            syllabusNodeId: null,
            syllabusNodeTitle: null,
            lostScore: 10,
            note: "Forgot page table inversion formula",
            archivedAt: null,
            mistakeId: null,
          },
        ],
      },
    ],
  };

  // 1. Ready for confirmation oracle
  assert.equal(isReadyForConfirmation(mockExam), true);
  assert.equal(isReadyForConfirmation({ ...mockExam, summary: null }), false);
  assert.equal(isReadyForConfirmation({ ...mockExam, summary: "  " }), false);
  assert.equal(isReadyForConfirmation({ ...mockExam, reviewText: "" }), false);
  assert.equal(isReadyForConfirmation({ ...mockExam, mindset: "" }), false);
  assert.equal(isReadyForConfirmation({ ...mockExam, totalsSource: "legacy_fallback" }), false);
  assert.equal(isReadyForConfirmation({ ...mockExam, status: "CONFIRMED" }), false);

  // 2. Persisted results detection oracle
  assert.equal(hasPersistedSubjectResults(mockExam), true);
  assert.equal(hasPersistedSubjectResults({ ...mockExam, subjectResults: [] }), false);

  // 3. Subject draft builder oracle
  const subjects = [{ id: "sub-cs", name: "Computer Science 408" }, { id: "sub-math", name: "Math" }];
  const drafts = buildSubjectDrafts(mockExam, subjects);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].subjectId, "sub-cs");
  assert.equal(drafts[0].actualScore, 110);
  assert.equal(drafts[0].lossItems.length, 1);
  assert.equal(drafts[0].lossItems[0].lostScore, 10);
  assert.equal(drafts[1].subjectId, "sub-math");
  assert.equal(drafts[1].actualScore, 0);

  // 4. Editor draft conversion oracle
  const editorDraft = toSimulationEditorDraft(mockExam, subjects);
  assert.equal(editorDraft.summary, "Solid performance in Data Structures");
  assert.equal(editorDraft.mindset, "Steady and focused");
  assert.equal(editorDraft.reviewText, "Need to review Graph Algorithms and Cache mapping");
  assert.equal(editorDraft.subjectDrafts.length, 2);

  // 5. Pending loss edits oracle
  assert.equal(hasPendingPersistedLossEdits(drafts), false);
  const modifiedDrafts: SubjectDraft[] = [
    {
      ...drafts[0],
      lossItems: [{ ...drafts[0].lossItems[0], dirty: true }],
    },
    drafts[1],
  ];
  assert.equal(hasPendingPersistedLossEdits(modifiedDrafts), true);

  // 6. Conflict replacement oracle
  const serverUpdatedLoss: SimulationLossItemDto = {
    id: "loss-1",
    revision: 2,
    reason: "CONCEPT_GAP",
    syllabusNodeId: null,
    syllabusNodeTitle: null,
    lostScore: 12,
    note: "Updated note from server",
    archivedAt: null,
    mistakeId: null,
  };
  const lossConflict: LossItemConflict = {
    subjectId: "sub-cs",
    clientKey: drafts[0].lossItems[0].clientKey,
    action: "save",
    latest: serverUpdatedLoss,
    conflictFields: ["lostScore", "revision"],
  };

  // Adopt server version
  const adopted = replaceLossConflictItem(modifiedDrafts, lossConflict, false);
  assert.equal(adopted[0].lossItems[0].lostScore, 12);
  assert.equal(adopted[0].lossItems[0].dirty, false);
  assert.equal(adopted[0].lossItems[0].revision, 2);

  // Keep local intent with newer revision
  const preserved = replaceLossConflictItem(modifiedDrafts, lossConflict, true);
  assert.equal(preserved[0].lossItems[0].lostScore, 10);
  assert.equal(preserved[0].lossItems[0].dirty, true);
  assert.equal(preserved[0].lossItems[0].revision, 2);
});
