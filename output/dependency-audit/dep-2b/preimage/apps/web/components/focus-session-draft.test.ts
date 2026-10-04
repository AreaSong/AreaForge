import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFocusCloseoutSubmission,
  defaultFocusCloseoutDraft,
} from "./focus-session-draft";

test("focus closeout submission rejects incomplete evidence", () => {
  const base = defaultFocusCloseoutDraft();
  assert.deepEqual(buildFocusCloseoutSubmission(base), {
    ok: false,
    error: "请填写至少 4 个字符的真实最小产出，系统不会代填学习事实。",
  });
  assert.deepEqual(buildFocusCloseoutSubmission({
    ...base,
    minimalOutput: "完成例题",
    nextAction: "",
    taskDisposition: "blocked",
  }), {
    ok: false,
    error: "请写明阻塞原因和恢复位置。",
  });
  assert.deepEqual(buildFocusCloseoutSubmission({
    ...base,
    minimalOutput: "完成例题",
    isEffective: "false",
    nextAction: "补做基础题",
    lowReasons: [],
  }), {
    ok: false,
    error: "低效学习必须至少选择一个原因，方便后续补充和复盘。",
  });
});

test("focus closeout submission freezes normalized values", () => {
  const result = buildFocusCloseoutSubmission({
    ...defaultFocusCloseoutDraft(),
    qualityScore: "4",
    focusLevel: "5",
    energyLevel: "2",
    minimalOutput: "  完成两道例题  ",
    nextAction: "  复盘错因  ",
    nextDisposition: " ",
    taskDisposition: "complete",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.body, {
    mode: "complete",
    qualityScore: 4,
    isEffective: true,
    lowReasons: [],
    focusLevel: 5,
    energyLevel: 2,
    minimalOutput: "完成两道例题",
    nextAction: "复盘错因",
    nextDisposition: "复盘错因",
    producedNote: false,
    producedMistake: false,
    note: "",
    completeTask: true,
  });
});

test("focus closeout submission does not invent optional self-ratings", () => {
  const result = buildFocusCloseoutSubmission({
    ...defaultFocusCloseoutDraft(),
    minimalOutput: "完成两道例题",
    nextAction: "复盘错因",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("understandingLevel" in result.body, false);
  assert.equal("focusLevel" in result.body, false);
  assert.equal("energyLevel" in result.body, false);
});
