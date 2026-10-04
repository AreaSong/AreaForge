import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiDraftGenerateRequest,
  buildAiDraftPreviewRequest,
  checkedProjectionIsComplete,
  emptyProjectionValues,
  isAiFormDraft,
  isAiFormDraftForContext,
  isKnowledgeCardDraft,
  isLearningTreeDraft,
  isMotivationDraft,
  isPlanDraft,
  resolveAiDraftAdoption,
  type AiDraftRequestInput,
  type AiFormDraft,
} from "./ai-draft-panel-model";

const baseInput = {
  selectedText: "极限与连续",
  tone: "CALM",
  scope: "branch",
  kind: "CONCEPT",
  checked: {},
  values: emptyProjectionValues,
} as const satisfies Omit<AiDraftRequestInput, "endpoint">;

test("AI request builders project only fields owned by each endpoint", () => {
  assert.deepEqual(buildAiDraftPreviewRequest({
    ...baseInput,
    endpoint: "learning-tree",
    checked: { subjectLabel: true, rootNodeLabel: true, nodeLabel: true },
    values: { ...emptyProjectionValues, subjectLabel: " 数学 ", rootNodeLabel: " 极限 ", nodeLabel: "不应发送" },
  }), {
    phase: "preview",
    selectedText: "极限与连续",
    scope: "branch",
    checkedProjection: { subjectLabel: "数学", rootNodeLabel: "极限" },
  });

  assert.deepEqual(buildAiDraftPreviewRequest({
    ...baseInput,
    endpoint: "knowledge-card",
    checked: { subjectLabel: true, nodeLabel: true, milestoneLabel: true },
    values: { ...emptyProjectionValues, subjectLabel: "数学", nodeLabel: "函数", milestoneLabel: "不应发送" },
  }), {
    phase: "preview",
    selectedText: "极限与连续",
    kind: "CONCEPT",
    checkedProjection: { subjectLabel: "数学", nodeLabel: "函数" },
  });

  assert.deepEqual(buildAiDraftGenerateRequest({
    ...baseInput,
    endpoint: "plan",
    checked: { dateWindow: true, defaultDurationMinutes: true },
    values: {
      ...emptyProjectionValues,
      dateStart: "2026-08-21",
      dateEnd: "2026-08-28",
      defaultDurationMinutes: "45",
    },
  }, "preview-token"), {
    phase: "generate",
    previewToken: "preview-token",
    selectedText: "极限与连续",
    checkedProjection: {
      dateWindow: { start: "2026-08-21", end: "2026-08-28" },
      defaultDurationMinutes: 45,
    },
  });

  assert.deepEqual(buildAiDraftPreviewRequest({ ...baseInput, endpoint: "motivation" }), {
    phase: "preview",
    selectedText: "极限与连续",
    tone: "CALM",
  });
});

test("AI plan projection rejects invalid and reversed Shanghai dates", () => {
  const checked = { dateWindow: true };
  assert.equal(checkedProjectionIsComplete("plan", checked, {
    ...emptyProjectionValues,
    dateStart: "2026-08-22",
    dateEnd: "2026-08-21",
  }), false);
  assert.throws(() => buildAiDraftPreviewRequest({
    ...baseInput,
    endpoint: "plan",
    checked,
    values: { ...emptyProjectionValues, dateStart: "2026-02-30", dateEnd: "2026-03-01" },
  }), /INVALID_SHANGHAI_DATE_RANGE/);
});

test("AI advice parsers validate every required field and bounded collection", () => {
  const learningTree = {
    status: "ai_generated",
    schemaVersion: "learning-tree-draft-v1",
    markdownDraft: "# 高等数学",
    notes: ["先核对章节"],
    reason: "根据选中文本生成",
  };
  const knowledgeCard = {
    status: "local_rule_fallback",
    schemaVersion: "knowledge-card-draft-v1",
    title: "极限定义",
    body: "正文",
    kindHint: "CONCEPT",
    reason: "本地规则",
  };
  const plan = {
    status: "ai_invalid_fallback",
    schemaVersion: "plan-draft-v1",
    title: "一周计划",
    tasks: [{ title: "复习极限", estimatedMinutes: 45 }],
    reason: "结构化拆分",
  };
  const motivation = {
    status: "ai_error_fallback",
    schemaVersion: "motivation-draft-v1",
    line: "先完成下一步",
    recoveryHint: "从五分钟开始",
    reason: "服务降级",
  };

  assert.equal(isLearningTreeDraft(learningTree), true);
  assert.equal(isKnowledgeCardDraft(knowledgeCard), true);
  assert.equal(isPlanDraft(plan), true);
  assert.equal(isMotivationDraft(motivation), true);
  assert.equal(isLearningTreeDraft({ ...learningTree, status: "unknown" }), false);
  assert.equal(isLearningTreeDraft({ ...learningTree, notes: [""] }), false);
  assert.equal(isKnowledgeCardDraft({ ...knowledgeCard, kindHint: "UNKNOWN" }), false);
  assert.equal(isKnowledgeCardDraft({ ...knowledgeCard, reason: "" }), false);
  assert.equal(isPlanDraft({ ...plan, title: undefined }), false);
  assert.equal(isPlanDraft({ ...plan, tasks: [] }), false);
  assert.equal(isPlanDraft({ ...plan, tasks: [{ title: "任务", estimatedMinutes: 4 }] }), false);
  assert.equal(isMotivationDraft({ ...motivation, recoveryHint: undefined }), false);

  assert.deepEqual(resolveAiDraftAdoption("learning-tree", learningTree), {
    kind: "learning-tree",
    draft: learningTree,
  });
  assert.deepEqual(resolveAiDraftAdoption("knowledge-card", knowledgeCard), {
    kind: "knowledge-card",
    draft: knowledgeCard,
  });
  assert.deepEqual(resolveAiDraftAdoption("plan", plan), { kind: "plan", draft: plan });
  assert.deepEqual(resolveAiDraftAdoption("motivation", motivation), {
    kind: "motivation",
    draft: motivation,
  });
  assert.equal(resolveAiDraftAdoption("plan", knowledgeCard), null);
});

test("persisted AI form parser rejects unknown flags and damaged generated drafts", () => {
  const generatedDraft = {
    status: "ai_generated",
    schemaVersion: "knowledge-card-draft-v1",
    title: "极限定义",
    body: "正文",
    kindHint: "CONCEPT",
    reason: "生成原因",
  };
  const valid: AiFormDraft = {
    contextKey: "/knowledge?:selection",
    selectedText: "极限",
    tone: "CALM",
    scope: "global",
    kind: "CONCEPT",
    checked: { subjectLabel: true },
    values: { ...emptyProjectionValues, subjectLabel: "数学" },
    generatedDraft,
    operation: { id: "op-1", projectionVersion: "knowledge-card-input-v1", resultProof: "proof" },
  };
  assert.equal(isAiFormDraft(valid), true);
  assert.equal(isAiFormDraftForContext(valid, "/knowledge?:selection"), true);
  assert.equal(isAiFormDraftForContext(valid, "/today?:selection"), false);
  assert.equal(isAiFormDraft({ ...valid, contextKey: "" }), false);
  assert.equal(isAiFormDraft({ ...valid, checked: { unknown: true } }), false);
  assert.equal(isAiFormDraft({ ...valid, checked: { subjectLabel: "yes" } }), false);
  assert.equal(isAiFormDraft({ ...valid, generatedDraft: { ...generatedDraft, reason: "" } }), false);
  assert.equal(isAiFormDraft({ ...valid, operation: null }), false);
  assert.equal(isAiFormDraft({ ...valid, generatedDraft: null }), false);
});
