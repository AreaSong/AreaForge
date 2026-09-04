import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function loadSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function sourceRange(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0 && end > start, `无法定位 ${startMarker} 源码范围`);
  return source.slice(start, end);
}

test("runtime facts: countdowns and stage windows use workspace data instead of fixed exam dates", () => {
  const dashboard = loadSource("lib/study/dashboard-query-service.ts");
  const stage = loadSource("lib/study/stage-service.ts");
  const risk = loadSource("lib/study/long-term-risk-service.ts");
  const simulation = loadSource("lib/study/simulation-service.ts");
  const schemas = loadSource("lib/study/schemas.ts");
  const combined = `${dashboard}\n${stage}\n${risk}\n${simulation}`;

  assert.doesNotMatch(combined, /2026-12-20|2027-12-20|exam-dates/);
  assert.match(dashboard, /targetExamDate: workspace\.targetExamDate/);
  assert.match(dashboard, /simulationDate: nextSimulationExam\?\.examDate \?\? null/);
  assert.match(stage, /optionalDaysUntil\(workspace\.targetExamDate, now\)/);
  assert.match(risk, /where: \{ workspaceId, status: \{ not: "CONFIRMED" \}/);
  assert.match(risk, /examDate: \{ gte: getStudyDayRange\(now\)\.start \}/);
  assert.match(schemas, /examDate: z\.string\(\)\.datetime\(\)/);
});

test("runtime facts: business services do not embed author subjects or legacy 408 branches", () => {
  const services = [
    "lib/study/action-center-service.ts",
    "lib/study/analytics-service.ts",
    "lib/study/dashboard-query-service.ts",
    "lib/study/exam-workspace-service.ts",
    "lib/study/long-term-risk-service.ts",
    "lib/study/reports-service.ts",
    "lib/study/simulation-service.ts",
    "lib/study/stage-service.ts",
    "lib/study/study-query-service.ts",
    "lib/study/weekly-budget-service.ts",
  ].map(loadSource).join("\n");

  assert.doesNotMatch(
    services,
    /computer-science-408|include408|408-data-structure|408-operating-system|408-computer-network/,
  );
  assert.doesNotMatch(services, /"数据结构"|"计算机组成原理"|"操作系统"|"计算机网络"|"高等数学"/);
});

test("runtime facts: templates are isolated seed material instead of hidden runtime defaults", () => {
  const templates = loadSource("../../packages/core/src/exam-templates.ts");
  const firstUse = loadSource("lib/workspace/first-use.ts");

  assert.match(templates, /seed material only/);
  assert.match(templates, /computer-science-408/);
  assert.match(firstUse, /getExamTemplate|materializeExamTemplate/);
});

test("subject lifecycle: archive pauses schedules and restore makes them due today", () => {
  const source = loadSource("lib/study/exam-workspace-service.ts");
  const updateSubject = sourceRange(
    source,
    "export async function updateWorkspaceSubject",
    "export async function createSubjectGroup",
  );

  const archiveBlock = updateSubject.slice(
    updateSubject.indexOf("if (isArchiving)"),
    updateSubject.indexOf("if (isRestoring)"),
  );
  assert.match(archiveBlock, /status: "PAUSED"/);
  assert.match(archiveBlock, /dueDate: null/);
  assert.match(archiveBlock, /pausedReason: "SUBJECT_ARCHIVED"/);
  assert.match(updateSubject, /status: "ACTIVE"/);
  assert.match(updateSubject, /dueDate: getStudyDayRange\(\)\.start/);
  assert.match(updateSubject, /pausedReason: null/);
  assert.match(updateSubject, /resumedReviewScheduleCount = resumed\.count/);
  assert.match(updateSubject, /remainingPausedReviewScheduleCount = await tx\.reviewSchedule\.count\(\{ where: pausedWhere \}\)/);
});

test("subject group lifecycle: archive atomically detaches members and exposes the affected count", () => {
  const source = loadSource("lib/study/exam-workspace-service.ts");
  const updateGroup = sourceRange(
    source,
    "export async function updateSubjectGroup",
    "async function lockOwnedWorkspaceRevision",
  );

  assert.match(updateGroup, /return prisma\.\$transaction/);
  assert.match(updateGroup, /subject\.updateMany\(\{ where: \{ workspaceId, groupId: group\.id \}, data: \{ groupId: null \} \}\)/);
  assert.match(updateGroup, /metadata: isArchiving \? \{ ungroupedSubjectCount: ungrouped\.count \}/);
  assert.match(updateGroup, /lifecycle: \{ ungroupedSubjectCount: ungrouped\.count \}/);
});

test("empty analytics remain unknown instead of becoming fabricated performance", () => {
  const knowledge = loadSource("lib/study/knowledge-canvas-service.ts");
  const shellService = loadSource("lib/study/app-shell-service.ts");
  const shell = loadSource("components/app-shell.tsx");

  assert.match(knowledge, /completedReviews > 0[\s\S]*: null/);
  assert.match(knowledge, /const retestRate = totalAllPoints > 0[\s\S]*: null/);
  assert.match(knowledge, /const avgDepth = totalAllPoints > 0[\s\S]*: null/);
  assert.match(shellService, /select: \{ id: true, currentStage: true, targetMinutes: true, reason: true \}/);
  assert.match(shell, /stage: activeRecovery\?\.currentStage \?\? 1/);
  assert.match(shell, /targetMinutes: activeRecovery\?\.targetMinutes \?\? 0/);
});

test("empty simulation analytics remain unknown instead of rendering synthetic zero scores", () => {
  const service = loadSource("lib/study/simulation-service.ts");
  const card = loadSource("components/simulation-exam-card.tsx");
  const kpis = loadSource("components/test/test-kpi-strip.tsx");

  assert.match(service, /const subjectTargetScore = sumComplete\(exam\.subjectResults, "targetScore"\)/);
  assert.match(service, /const subjectActualScore = sumComplete\(exam\.subjectResults, "actualScore"\)/);
  assert.match(card, /尚未录分/);
  assert.doesNotMatch(card, /exam\.actualScore \?\? 0/);
  assert.match(kpis, /暂无成绩样本/);
  assert.match(kpis, /暂无失分样本/);
  assert.doesNotMatch(kpis, /scoreTrajectory\.length > 0 \? kpis\.scoreTrajectory : \[0\]/);
});
