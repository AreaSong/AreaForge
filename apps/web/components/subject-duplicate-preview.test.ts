import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubjectDuplicatePreview } from "./subject-duplicate-preview";
import type { SubjectDuplicateSetDto } from "@/lib/contracts";

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
      relatedKnowledgePoints: 3,
    },
    requiredReassignments: { primaryKnowledgePoints: 4 },
    totalReferenceCount: 54,
    canAutoApply: false,
    requiresUserConfirmation: true,
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
  assert.match(html, /考纲键冲突 2 处、模拟成绩冲突 1 处、知识点关联冲突 3 处/);
  assert.match(html, /来源科目作为主科目的知识点 4 个/);
  assert.match(html, /自动应用已关闭/);
  assert.match(html, /迁移全部引用并软归档来源科目/);
  assert.match(html, /不做物理删除/);
});
