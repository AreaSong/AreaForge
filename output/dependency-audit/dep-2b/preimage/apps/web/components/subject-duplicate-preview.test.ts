import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubjectDuplicatePreview } from "./subject-duplicate-preview";
import type { SubjectDuplicateSetDto, SubjectMergeOperationDto } from "@/lib/contracts";

function subjectSet(overrides: Partial<SubjectDuplicateSetDto> = {}): SubjectDuplicateSetDto {
  const subject = {
    id: "subject-a",
    workspaceId: "workspace-1",
    groupId: null,
    stableKey: "math",
    legacyCode: null,
    name: "数学",
    color: "#38bdf8",
    sortOrder: 10,
    archivedAt: null,
    legacyScope: false,
  };
  const references = {
    tasks: 12,
    sessions: 9,
    activeSessions: 1,
    syllabusNodes: 7,
    notes: 4,
    mistakes: 3,
    simulationSubjectResults: 2,
    planMilestones: 1,
    planInboxItems: 2,
    studyResources: 1,
    primaryKnowledgePoints: 5,
    relatedKnowledgePoints: 3,
    knowledgeGroups: 1,
    learningArrangements: 2,
    total: 52,
  };
  return {
    id: "duplicate-set-1-subject-a-subject-b",
    workspaceRevision: 3,
    snapshotHash: "sha256:" + "a".repeat(64),
    reasons: [{
      code: "NORMALIZED_NAME",
      normalizedValue: "数学",
      subjectIds: ["subject-a", "subject-b"],
    }],
    recommendedTargetId: "subject-a",
    subjects: [
      { subject, references },
      {
        subject: { ...subject, id: "subject-b", stableKey: "MATH-ALT", name: "数学" },
        references: {
          ...references,
          tasks: 1,
          sessions: 1,
          activeSessions: 0,
          syllabusNodes: 0,
          notes: 0,
          mistakes: 0,
          simulationSubjectResults: 0,
          planMilestones: 0,
          planInboxItems: 0,
          studyResources: 0,
          primaryKnowledgePoints: 0,
          relatedKnowledgePoints: 0,
          knowledgeGroups: 0,
          learningArrangements: 0,
          total: 2,
        },
      },
    ],
    conflictCounts: {
      syllabusStableKeys: 2,
      simulationExams: 1,
      simulationInboxOrigins: 1,
      invalidSimulationInboxOrigins: 0,
      relatedKnowledgePoints: 3,
    },
    requiredReassignments: { primaryKnowledgePoints: 4, simulationOriginInboxItems: 2 },
    totalReferenceCount: 54,
    canAutoApply: false,
    requiresUserConfirmation: true,
    ...overrides,
  };
}

function mergeOperation(overrides: Partial<SubjectMergeOperationDto> = {}): SubjectMergeOperationDto {
  return {
    id: "merge-operation-1",
    targetSubjectId: "subject-a",
    targetSubjectName: "数学",
    sourceSubjects: [{ id: "subject-b", name: "高等数学" }],
    mergedAt: "2026-09-04T01:02:03.000Z",
    undoUntil: "2026-09-05T01:02:03.000Z",
    status: "AVAILABLE",
    workspaceRevision: 4,
    undoSnapshotHash: "sha256:" + "b".repeat(64),
    blockingFields: [],
    ...overrides,
  };
}

test("SubjectDuplicatePreview renders a safe empty state", () => {
  const html = renderToStaticMarkup(React.createElement(SubjectDuplicatePreview, { sets: [] }));

  assert.match(html, /重复科目检查/);
  assert.match(html, /未发现重复/);
  assert.match(html, /没有形成重复集合/);
  assert.doesNotMatch(html, /自动应用/);
});

test("SubjectDuplicatePreview renders dense references and keeps conversion confirmation explicit", () => {
  const html = renderToStaticMarkup(React.createElement(SubjectDuplicatePreview, { sets: [subjectSet()] }));

  assert.match(html, /1 组待检查/);
  assert.match(html, /数学 \/ 数学/);
  assert.match(html, /规范化名称相同/);
  assert.match(html, /建议保留“数学”/);
  assert.match(html, /任务 12/);
  assert.match(html, /有 1 个进行中活动/);
  assert.match(html, /阻断冲突：考纲键 2 处、同场模拟成绩 1 处、\s*模拟补救来源键 1 处、无效来源快照 0 项/);
  assert.match(html, /知识点重复关联 3 处会确定性去重/);
  assert.match(html, /来源科目作为主科目的知识点 4 个/);
  assert.match(html, /模拟补救来源 2 项会同步重建来源键和快照/);
  assert.match(html, /自动应用已关闭/);
  assert.match(html, /迁移全部引用并软归档来源科目/);
  assert.match(html, /不做物理删除/);
});

test("SubjectDuplicatePreview renders recent merge operations and only offers available undo", () => {
  const html = renderToStaticMarkup(React.createElement(SubjectDuplicatePreview, {
    sets: [],
    mergeOperations: [
      mergeOperation(),
      mergeOperation({ id: "expired", status: "EXPIRED" }),
      mergeOperation({ id: "undone", status: "UNDONE" }),
      mergeOperation({ id: "blocked", status: "BLOCKED", blockingFields: ["planInboxItems"] }),
    ],
    onUndo: async () => true,
  }));

  assert.match(html, /最近合并记录/);
  assert.match(html, /高等数学 → 数学/);
  assert.match(html, /可撤销/);
  assert.match(html, /已过期/);
  assert.match(html, /已撤销/);
  assert.match(html, /不可自动撤销/);
  assert.match(html, /模拟补救或计划收件箱关联已经变化/);
  assert.equal((html.match(/撤销合并/g) ?? []).length, 1);
});
