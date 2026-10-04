import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { retestStatusLabel } from "./retest-card";
import {
  simulationLossReasons,
  isReadyForConfirmation,
  hasPendingPersistedLossEdits,
  replaceLossConflictItem,
  labelSaveError,
  labelLossItemError,
  remediationInboxStatusLabel,
  lossMutationNotice,
  sameStringSet,
  type SubjectDraft,
  type LossItemConflict,
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
// 1. Specialized Retest Card, Badges, and Grid Responsiveness
// --------------------------------------------------------------------------
test("RetestCard: Dark Glass Master container, status mapping, point chips, and responsive layout", () => {
  const cardSource = loadSource("components/retest-card.tsx");
  const listPageSource = loadSource("app/(app)/test/retests/page.tsx");

  // Master Card texture and hover styling
  assert.match(cardSource, /<Card[\s\S]*variant="master"/);
  assert.match(cardSource, /hover:border-teal-400\/30/);
  assert.match(cardSource, /hover:shadow-\[0_0_16px_rgba\(45,212,191,0\.1\)\]/);

  // Status mapping oracle tests
  assert.equal(retestStatusLabel("CLOSED", "PASSED"), "通过");
  assert.equal(retestStatusLabel("CLOSED", "PARTIAL"), "部分掌握");
  assert.equal(retestStatusLabel("CLOSED", "FAILED"), "未通过");
  assert.equal(retestStatusLabel("PENDING_REVIEW", null), "待确认");
  assert.equal(retestStatusLabel("IN_PROGRESS", null), "进行中");
  assert.equal(retestStatusLabel("DRAFT", null), "待开始");

  // Point badge chips truncation and overflow
  assert.match(cardSource, /item\.pointTitles\.slice\(0, 4\)/);
  assert.match(cardSource, /item\.pointTitles\.length > 4/);
  assert.match(cardSource, /max-w-\[12rem\] truncate/);

  // Responsiveness: 2-column grid eliminating 1500px single-row stretches
  assert.match(listPageSource, /grid grid-cols-1 gap-4 md:grid-cols-2/);
  assert.match(listPageSource, /<RetestCard key=\{item\.id\} item=\{item\} \/>/);
});

// --------------------------------------------------------------------------
// 2. Retest Create Form & Detail Client Workflows
// --------------------------------------------------------------------------
test("KnowledgeRetestCreateForm & Detail: Workstation wrappers, validation, CAS safety, and PinnedActionBar", () => {
  const createFormSource = loadSource("components/knowledge-retest-create-form.tsx");
  const detailClientSource = loadSource("components/knowledge-retest-detail-client.tsx");

  // Create form: Master Card workstation & sticky action bar
  assert.match(createFormSource, /<Card variant="master" className="p-5 sm:p-6 space-y-6">/);
  assert.match(createFormSource, /<PinnedActionBar[\s\S]*mode="sticky"/);
  assert.match(createFormSource, /至少选择一个知识点/);

  // Idempotency and CAS conflict resolution in creation
  assert.match(createFormSource, /getOrCreateIdempotencyKey\("knowledge-retest:create"/);
  assert.match(createFormSource, /<ConflictResolutionModal/);

  // Detail Client: 3 distinct state views & per-point scoring cards
  assert.match(detailClientSource, /<Card variant="master" className="p-5 sm:p-6 space-y-4">/);
  assert.match(detailClientSource, /points\.map[\s\S]*<Card[\s\S]*variant="subtle"/);
  assert.match(detailClientSource, /<PinnedActionBar[\s\S]*mode="sticky"/);

  // Submission validation rule: score, note and result required per point + summary & reviewText
  assert.match(detailClientSource, /完成每个知识点结果后，还必须写复测总结和复盘/);
  assert.match(detailClientSource, /每个知识点都必须填写通过情况、量化分数和个人反馈后才能提交/);

  // Payload freezing against in-flight mutation
  assert.match(detailClientSource, /function freezeRetestCommand/);
});

// --------------------------------------------------------------------------
// 3. Simulation Exam Card, Next Action State Machine & Overview Grid
// --------------------------------------------------------------------------
test("SimulationExamCard: Battle report card, loss count reduction, totalsSource, and nextAction mapping", () => {
  const cardSource = loadSource("components/simulation-exam-card.tsx");
  const pageSource = loadSource("lib/routes/test-simulations-page.tsx");

  // Primary accent card vs regular master card
  assert.match(cardSource, /variant=\{primary \? "accent" : "master"\}/);

  // Loss count calculation ignores archived loss items
  assert.match(cardSource, /result\.lossItems\.filter\(\(item\) => !item\.archivedAt\)\.length/);

  // totalsSource fallback detection
  assert.match(cardSource, /exam\.totalsSource === "legacy_fallback"/);
  assert.match(cardSource, /旧版总分记录/);
  assert.match(cardSource, /尚未录分/);
  assert.doesNotMatch(cardSource, /exam\.actualScore \?\? 0/);

  // nextAction state mapping check in source
  assert.match(cardSource, /exam\.status === "DRAFT"/);
  assert.match(cardSource, /核对并确认/);
  assert.match(cardSource, /录入分科成绩/);
  assert.match(cardSource, /选择补救/);
  assert.match(cardSource, /查看考试事实/);

  // Simulations page multi-column grid & primary hero card
  assert.match(pageSource, /grid grid-cols-1 gap-4 md:grid-cols-2/);
  assert.match(pageSource, /exam\.status === "DRAFT" \|\| exam\.status === "IN_PROGRESS"/);
  assert.match(pageSource, /<SimulationExamCard exam=\{latestUnfinished\} primary \/>/);
});

// --------------------------------------------------------------------------
// 4. 5-Field Numeric Scoreboard & Loss Attribution Editor
// --------------------------------------------------------------------------
test("SimulationSubjectEditor: 5-field numeric scoreboard grid, loss item operations, and reason mapping", () => {
  const editorSource = loadSource("components/simulation-detail-subject-editor.tsx");

  // 5-field scoreboard layout: 2-col on mobile, 3-col on sm, 5-col on lg (no wide stretching)
  assert.match(editorSource, /grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5/);
  assert.match(editorSource, /"paperFullScore", "卷面满分", 1, 1/);
  assert.match(editorSource, /"targetScore", "目标分", 0.5, 0/);
  assert.match(editorSource, /"actualScore", "实际分", 0.5, 0/);
  assert.match(editorSource, /"durationMinutes", "用时（分）", 1, 0/);
  assert.match(editorSource, /"blankQuestionCount", "未作答数", 1, 0/);

  // Loss attribution panel & actions
  assert.match(editorSource, /<Card variant="master" className="p-5 sm:p-6 space-y-4">/);
  assert.match(editorSource, /结构化失分/);
  assert.match(editorSource, /新增失分/);
  assert.match(editorSource, /已归档失分/);

  // Loss reason enumeration completeness
  assert.equal(simulationLossReasons.length, 10);
  assert.ok(simulationLossReasons.some((r) => r.value === "CONCEPT_GAP" && r.label === "概念缺口"));
  assert.ok(simulationLossReasons.some((r) => r.value === "CALCULATION_CARELESS" && r.label === "计算/粗心"));
  assert.ok(simulationLossReasons.some((r) => r.value === "TIME_ALLOCATION" && r.label === "时间分配"));
  assert.ok(simulationLossReasons.some((r) => r.value === "UNANSWERED" && r.label === "未作答"));
});

// --------------------------------------------------------------------------
// 5. Remediation Selection & Workspace Workflow State Machine
// --------------------------------------------------------------------------
test("SimulationRemediation & Workspace: Confirmation boundaries, 3-step progress, and sticky action docking", () => {
  const remediationSource = loadSource("components/simulation-detail-remediation.tsx");
  const workspaceSource = loadSource("components/simulation-detail-workspace.tsx");

  // Remediation section: unconfirmed warning vs confirmed selection
  assert.match(remediationSource, /props\.examStatus !== "CONFIRMED"/);
  assert.match(remediationSource, /选择补救动作/);
  assert.match(remediationSource, /将选中补救送入收件箱/);
  assert.match(remediationSource, /补救已送入投入草稿/);

  // 3-step progress indicator
  assert.match(workspaceSource, /\[1, "录入成绩", "记录分科事实"\]/);
  assert.match(workspaceSource, /\[2, "分析失分", "核对并确认考试"\]/);
  assert.match(workspaceSource, /\[3, "安排补救", "送入投入草稿"\]/);

  // Sticky action bar with padding safe area
  assert.match(workspaceSource, /isConfirmed \? "" : "pb-24"/);
  assert.match(workspaceSource, /<PinnedActionBar[\s\S]*mode="sticky"/);
});

// --------------------------------------------------------------------------
// 6. Simulation Domain Rules & Conflict Resolution Math Oracles
// --------------------------------------------------------------------------
test("Simulation Draft Logic: isReadyForConfirmation, pending loss edits, conflict resolution, and error labels", () => {
  const baseExam: SimulationExamDto = {
    id: "exam-1",
    revision: 2,
    name: "2026 Math Mock 1",
    examDate: "2026-08-26",
    status: "DRAFT",
    isFirstSynchronized: true,
    targetDurationMinutes: 180,
    actualDurationMinutes: 180,
    blankQuestionCount: 0,
    lossReasons: ["CALCULATION_CARELESS"],
    timerSessionId: null,
    timerSessionStatus: null,
    confirmedAt: null,
    legacyDisplayTotals: null,
    targetScore: 120,
    actualScore: 115,
    summary: "Good progress on calculus",
    mindset: "Calm and focused",
    reviewText: "Need to review integration formulas",
    totalsSource: "subject_sum",
    subjectResults: [
      {
        id: "sr-1",
        simulationExamId: "sim-1",
        revision: 1,
        subjectId: "sub-1",
        subjectName: "Math",
        subjectColor: "#0ea5e9",
        paperFullScore: 150,
        targetScore: 120,
        actualScore: 115,
        durationMinutes: 180,
        blankQuestionCount: 0,
        lossReasons: ["CALCULATION_CARELESS"],
        summary: "One careless mistake in algebra",
        lossItems: [],
      },
    ],
    warnings: [],
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
  };

  // isReadyForConfirmation oracle
  assert.equal(isReadyForConfirmation(baseExam), true);
  assert.equal(isReadyForConfirmation({ ...baseExam, summary: "" }), false);
  assert.equal(isReadyForConfirmation({ ...baseExam, reviewText: "   " }), false);
  assert.equal(isReadyForConfirmation({ ...baseExam, mindset: "" }), false);
  assert.equal(isReadyForConfirmation({ ...baseExam, totalsSource: "legacy_fallback" }), false);
  assert.equal(isReadyForConfirmation({ ...baseExam, status: "CONFIRMED" }), false);

  // String set equality helper
  assert.equal(sameStringSet(["a", "b"], ["b", "a"]), true);
  assert.equal(sameStringSet(["a"], ["a", "b"]), false);

  // Status labels
  assert.equal(remediationInboxStatusLabel("CONVERTED"), "已转任务");
  assert.equal(remediationInboxStatusLabel("DISMISSED"), "已忽略");
  assert.equal(lossMutationNotice("create"), "失分条目已创建，稳定 ID 与父版本已更新。");
  assert.equal(lossMutationNotice("archive"), "失分条目已归档，可在当前分科中恢复。");

  // Error label mappings
  assert.match(labelSaveError("SIMULATION_EXAM_REVISION_CONFLICT", "保存失败"), /其他页面已更新这场模拟/);
  assert.match(labelSaveError("SIMULATION_EXAM_CONFIRMED", "保存失败"), /这场模拟已在服务端确认/);
  assert.match(labelLossItemError("SIMULATION_LOSS_ITEM_REVISION_CONFLICT"), /失分条目已在其他页面更新/);

  // Pending loss edits detection
  const cleanDraft: SubjectDraft = {
    subjectId: "sub-1",
    subjectResultId: "sr-1",
    paperFullScore: 100,
    targetScore: 90,
    actualScore: 85,
    durationMinutes: 60,
    blankQuestionCount: 0,
    summary: "",
    lossItems: [
      {
        clientKey: "loss-1",
        id: "loss-1",
        revision: 1,
        archivedAt: null,
        mistakeId: null,
        dirty: false,
        reason: "CONCEPT_GAP",
        syllabusNodeId: null,
        lostScore: 5,
        note: "Forgot theorem",
      },
    ],
  };
  assert.equal(hasPendingPersistedLossEdits([cleanDraft]), false);

  const dirtyDraft: SubjectDraft = {
    ...cleanDraft,
    lossItems: [{ ...cleanDraft.lossItems[0], dirty: true }],
  };
  assert.equal(hasPendingPersistedLossEdits([dirtyDraft]), true);

  // Conflict item replacement
  const latestServerLoss: SimulationLossItemDto = {
    id: "loss-1",
    revision: 2,
    reason: "CONCEPT_GAP",
    syllabusNodeId: null,
    syllabusNodeTitle: null,
    lostScore: 6,
    note: "Updated by other tab",
    archivedAt: null,
    mistakeId: null,
  };
  const conflict: LossItemConflict = {
    subjectId: "sub-1",
    clientKey: "loss-1",
    action: "save",
    latest: latestServerLoss,
    conflictFields: ["revision", "lostScore"],
  };

  const adopted = replaceLossConflictItem([dirtyDraft], conflict, false);
  assert.equal(adopted[0].lossItems[0].lostScore, 6);
  assert.equal(adopted[0].lossItems[0].dirty, false);

  const preserved = replaceLossConflictItem([dirtyDraft], conflict, true);
  assert.equal(preserved[0].lossItems[0].revision, 2);
  assert.equal(preserved[0].lossItems[0].dirty, true);
});
