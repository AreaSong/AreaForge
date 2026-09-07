import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(webRoot, "../..");

test("v1.5-R keeps StudyTask owner lineage additive and fail-closed", async () => {
  const [schema, migration, inbox, route, taskCommands, taskSupport, simulation, review, debt, notes, syllabus, sessions, sessionSupport, sessionLifecycle, attachments, learningTree, bulkApply, bulkMutate, motivation, capacity, mistakes, duplicateQuery, recoveryState, recoveryCompleteRoute, recoveryCancelRoute, dashboard, actionCenter, longTermRisk, appShell, dailyReviewFacts] = await Promise.all([
    readFile(path.join(repoRoot, "prisma/schema.prisma"), "utf8"),
    readFile(path.join(repoRoot, "prisma/migrations/20260906100000_v15_r_study_task_owner/migration.sql"), "utf8"),
    readFile(path.join(webRoot, "lib/study/plan-inbox-service.ts"), "utf8"),
    readFile(path.join(webRoot, "app/api/plan-inbox/[id]/convert/route.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/task-command-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/task-command-support.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/simulation-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/review-schedule-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/task-debt-reorder-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/notes-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/syllabus-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/session-command-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/session-command-support.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/session-lifecycle-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/attachments-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/learning-tree-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/learning-tree-bulk-apply.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/learning-tree-bulk-mutate.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/motivation-library-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/settings-capacity-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/mistakes-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/subject-duplicate-query-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/recovery-state-service.ts"), "utf8"),
    readFile(path.join(webRoot, "app/api/recovery-states/[id]/complete/route.ts"), "utf8"),
    readFile(path.join(webRoot, "app/api/recovery-states/[id]/cancel/route.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/dashboard-query-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/action-center-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/long-term-risk-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/app-shell-service.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/study/daily-review-facts-service.ts"), "utf8"),
  ]);

  assert.match(schema, /model StudyTask \{[\s\S]*?ownerUserId\s+String\s/);
  assert.doesNotMatch(schema, /model StudyTask \{[\s\S]*?ownerUserId\s+String\?/);
  assert.match(schema, /owner\s+User\s+@relation\("StudyTaskOwner"/);
  assert.match(migration, /ALTER TABLE "StudyTask" ADD COLUMN "ownerUserId" TEXT;/);
  assert.match(migration, /SET "ownerUserId" = workspace\."userId"/);
  assert.match(migration, /StudyTask_ownerUserId_fkey/);
  assert.match(migration, /StudyTask_ownerUserId_plannedDate_idx/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  const ownerRequiredMigration = await readFile(path.join(repoRoot, "prisma/migrations/20260907100000_v15_r_study_task_owner_required/migration.sql"), "utf8");
  assert.match(ownerRequiredMigration, /owner cleanup found ownerless rows/);
  assert.match(ownerRequiredMigration, /ALTER COLUMN "ownerUserId" SET NOT NULL/);

  assert.match(inbox, /ownerUserId: actorId,[\s\S]*?subjectId,/);
  assert.match(inbox, /resolveDependencyRefs\(tx, workspace\.id, existing, actorId\)/);
  assert.match(inbox, /predecessor: \{ ownerUserId: actorId,[\s\S]*?successor: \{ ownerUserId: actorId/);
  assert.doesNotMatch(inbox, /PLAN_INBOX_CONVERSION_REQUIRES_OWNER/);
  assert.match(route, /requireApiUser\(request\)/);
  assert.match(route, /expectedRevision/);
  assert.match(taskCommands, /ownerUserId: actorId/);
  assert.doesNotMatch(taskCommands, /existing\.ownerUserId \?\? actorId/);
  assert.match(taskCommands, /replay\.resultId, ownerUserId: actorId, subject:/);
  assert.match(taskCommands, /sourceResourceId, workspaceId: workspace\.id, ownerUserId: actorId/);
  assert.match(taskSupport, /planMilestone\.findFirst\(\{[\s\S]*?workspaceId, ownerUserId/);
  assert.match(taskSupport, /stagePlan\.findMany\(\{[\s\S]*?workspaceId, ownerUserId/);
  assert.match(taskSupport, /workspaceId,[\s\S]*?userId: ownerUserId/);
  assert.match(simulation, /ownerUserId: actorId/);
  assert.match(review, /ownerUserId: actorId/);
  assert.match(debt, /ownerUserId: task\.ownerUserId/);
  assert.match(notes, /listNotes[\s\S]*?resolveSelectedMemberWorkspace\(actorId\)/);
  assert.match(notes, /assertTaskBelongsToSubject\([\s\S]*?ownerUserId: string,[\s\S]*?where: \{ id: taskId, ownerUserId,/);
  assert.match(syllabus, /syllabusNodeEvidenceInclude\(ownerUserId: string\)/);
  assert.match(syllabus, /tasks: \{ where: taskWhere \}/);
  assert.match(syllabus, /masteryEvidence: \{[\s\S]*?where: evidenceWhere/);
  assert.match(sessions, /where: \{ id: linkedTask\.id, ownerUserId: actorId \}/);
  assert.match(sessionSupport, /evidenceId, ownerUserId: actorId, subject:/);
  assert.match(sessionSupport, /id: input\.evidenceId, ownerUserId: actorId, syllabusNode:/);
  assert.match(sessionLifecycle, /workspaceId:[\s\S]*?userId: actorId,[\s\S]*?archivedAt: null/);
  assert.match(sessions, /sessionId, userId: actorId, workspaceId: workspace\.id/);
  assert.match(attachments, /context\.noteId, ownerUserId: context\.actorId, subject:/);
  assert.match(attachments, /id: noteId, ownerUserId: actorId, subject:/);
  assert.match(learningTree, /notes: \{[\s\S]*?where: \{ ownerUserId \}/);
  assert.match(learningTree, /studyResource\.findMany\(\{[\s\S]*?workspaceId, ownerUserId/);
  assert.match(learningTree, /planInboxItem\.findMany\(\{[\s\S]*?workspaceId, ownerUserId/);
  assert.match(bulkApply, /planMilestone\.findMany\(\{[\s\S]*?ownerUserId: context\.actorId/);
  assert.match(bulkMutate, /target\."ownerUserId" = \$\$\{args\.length \+ 1\}/);
  assert.match(motivation, /userId, workspaceId: workspace\.id, subject:/);
  assert.match(motivation, /workspaceId: workspace\.id,[\s\S]*?ownerUserId: userId,[\s\S]*?originType: \"LOW_CONVERSION\"/);
  assert.match(capacity, /workspaceOwnerWhere\(actorId\)/);
  assert.match(mistakes, /simulationExam: \{ workspaceId: workspace\.id, ownerUserId: actorId \}/);
  assert.match(duplicateQuery, /tasks: \{ where: \{ ownerUserId: actorId \} \}/);
  assert.match(duplicateQuery, /ownerUserId: actorId, subjectId/);
  assert.match(recoveryState, /findActiveRecoveryState\(actorId, workspace\.id, tx\)/);
  assert.match(recoveryState, /userId: actorId,[\s\S]*?workspaceId: workspace\.id/);
  assert.match(recoveryState, /OR: workspaceId[\s\S]*?userId: actorId[\s\S]*?actorId, userId: null/);
  assert.match(recoveryCompleteRoute, /const user = await requireApiUser\(request\)/);
  assert.match(recoveryCompleteRoute, /completeRecoveryState\(id, user\.id, parsed\.data\)/);
  assert.match(recoveryCancelRoute, /const user = await requireApiUser\(request\)/);
  assert.match(recoveryCancelRoute, /cancelRecoveryState\(id, user\.id, parsed\.data\)/);
  assert.match(dashboard, /findActiveRecoveryState\(actorId, workspace\.id\)/);
  assert.match(dashboard, /workspaceId: workspace\.id,[\s\S]*?ownerUserId: actorId,[\s\S]*?status: \{ not: "CONFIRMED" \}/);
  assert.match(actionCenter, /workspaceId: workspace\.id,[\s\S]*?ownerUserId: actorId,[\s\S]*?status: "ACTIVE"/);
  assert.match(actionCenter, /task: \{ select: \{ id: true, title: true, status: true, subjectId: true, ownerUserId: true \} \}/);
  assert.match(actionCenter, /latestContinuationSession\.task\.ownerUserId === actorId/);
  assert.match(inbox, /planMilestone\.findMany\(\{ where: \{ workspaceId: workspace\.id, ownerUserId: actorId/);
  assert.match(inbox, /stagePlan\.findMany\(\{ where: \{ workspaceId: workspace\.id, ownerUserId: actorId/);
  assert.match(inbox, /simulationExam\.findFirst\(\{ where: \{ id: snapshot\.examId, workspaceId, ownerUserId: item\.ownerUserId/);
  assert.match(inbox, /periodicReportDecision\.findFirst\(\{ where: \{ id: snapshot\.decisionId, workspaceId, ownerUserId: item\.ownerUserId/);
  assert.match(inbox, /stageAdjustmentDraft\.findFirst\(\{ where: \{ id: snapshot\.draftId, workspaceId, ownerUserId: item\.ownerUserId/);
  assert.match(longTermRisk, /resolveSelectedMemberWorkspace\(actorId\)/);
  assert.match(longTermRisk, /getLatestSimulationInput\(workspace\.id, actorId, now\)/);
  assert.match(longTermRisk, /getStageInput\(workspace\.id, actorId, workspace\.targetExamDate, now\)/);
  assert.match(longTermRisk, /workspaceId,[\s\S]*?ownerUserId,[\s\S]*?actualScore: \{ not: null \}/);
  assert.match(longTermRisk, /where: \{ workspaceId, ownerUserId, status: "active" \}/);
  assert.match(appShell, /reviewSchedule\.findMany\(\{[\s\S]*?workspaceId: workspace\.id,[\s\S]*?ownerUserId: actorId,[\s\S]*?status: "ACTIVE"/);
  assert.match(appShell, /stagePlan\.findFirst\(\{[\s\S]*?workspaceId: workspace\.id,[\s\S]*?ownerUserId: actorId,[\s\S]*?status: \{ in:/);
  assert.match(dailyReviewFacts, /reviewSchedule: \{ workspaceId: workspace\.id, ownerUserId: actorId \}/);
});
