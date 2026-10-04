import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditorDraft,
  buildSubjectDrafts,
  editorDraftsEqual,
  isSimulationEditorDraft,
  labelSaveError,
  simulationLossReasons,
} from "./simulation-detail-drafts";
import type { SimulationExamDto } from "@/lib/contracts";

test("simulation draft validator keeps schema v2/v3 compatibility", () => {
  const draft = buildEditorDraft(4, "summary", "mindset", "review", []);
  assert.equal(isSimulationEditorDraft(draft), true);
  assert.equal(isSimulationEditorDraft({ ...draft, schemaVersion: 2 }), true);
  assert.equal(isSimulationEditorDraft({ ...draft, schemaVersion: 1 }), false);
});

test("simulation draft equality is structural and stable", () => {
  const left = buildEditorDraft(1, "a", "b", "c", []);
  const right = buildEditorDraft(1, "a", "b", "c", []);
  assert.equal(editorDraftsEqual(left, right), true);
  assert.equal(editorDraftsEqual(left, { ...right, summary: "changed" }), false);
});

test("simulation validation errors include field and form messages", () => {
  const message = labelSaveError("INVALID_REQUEST", "保存失败", {
    fieldErrors: { actualScore: ["必须是数字"] },
    formErrors: ["至少选择一个科目"],
  });
  assert.equal(message, "输入校验未通过：actualScore: 必须是数字；至少选择一个科目");
});

test("simulation loss reason labels remain ordered and complete", () => {
  assert.equal(simulationLossReasons.length, 10);
  assert.equal(simulationLossReasons[0]?.label, "概念缺口");
  assert.equal(simulationLossReasons.at(-1)?.label, "其他");
});

test("new simulation subjects keep unknown numeric facts empty until the user enters them", () => {
  const exam = {
    id: "exam-1",
    name: "未录满分的模拟考试",
    examDate: "2026-09-03T08:00:00.000Z",
    isFirstSynchronized: false,
    targetDurationMinutes: null,
    actualDurationMinutes: null,
    targetScore: null,
    actualScore: null,
    blankQuestionCount: 0,
    lossReasons: [],
    revision: 1,
    summary: null,
    mindset: null,
    reviewText: null,
    status: "DRAFT",
    timerSessionId: null,
    timerSessionStatus: null,
    confirmedAt: null,
    createdAt: "2026-09-03T08:00:00.000Z",
    updatedAt: "2026-09-03T08:00:00.000Z",
    totalsSource: "subject_sum",
    legacyDisplayTotals: null,
    warnings: [],
    subjectResults: [],
  } satisfies SimulationExamDto;

  const [draft] = buildSubjectDrafts(exam, [{ id: "subject-1" }]);
  assert.equal(draft?.paperFullScore, null);
  assert.equal(draft?.targetScore, null);
  assert.equal(draft?.actualScore, null);
  assert.equal(draft?.durationMinutes, null);
  assert.equal(draft?.blankQuestionCount, 0);
});
