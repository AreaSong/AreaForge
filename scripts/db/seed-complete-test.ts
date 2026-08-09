import "dotenv/config";
import { createHash } from "node:crypto";
import { hashPassword } from "../../packages/auth/src/index";
import { getPrismaClient } from "../../packages/db/src/index";

const EXPECTED_URL = "postgresql://areaforge:areaforge@127.0.0.1:54329/areaforge";
const ADMIN_EMAIL = "admin@areasong.local";
const ADMIN_PASSWORD = "admin@areasong.local";
const prisma = getPrismaClient();

const now = new Date();
const day = (offset: number, hour = 9) => {
  const value = new Date(now);
  value.setDate(value.getDate() + offset);
  value.setHours(hour, 0, 0, 0);
  return value;
};
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function assertLocalTarget(): Promise<void> {
  if (process.env.AREAFORGE_CONFIRM_FULL_TEST_RESET !== "true") {
    throw new Error("AREAFORGE_CONFIRM_FULL_TEST_RESET=true is required.");
  }
  if (process.env.DATABASE_URL !== EXPECTED_URL) {
    throw new Error(`DATABASE_URL must exactly match ${EXPECTED_URL}`);
  }
  const rows = await prisma.$queryRaw<Array<{ database: string; user_name: string; port: number }>>`
    SELECT current_database() AS database,
           current_user AS user_name,
           inet_server_port() AS port
  `;
  const identity = rows[0];
  if (identity?.database !== "areaforge" || identity.user_name !== "areaforge" || Number(identity.port) !== 5432) {
    throw new Error("Connected PostgreSQL identity does not match the approved local AreaForge database.");
  }
}

async function truncateBusinessTables(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> '_prisma_migrations'
     ORDER BY tablename
  `;
  if (tables.length < 40) throw new Error(`Refusing to truncate an unexpected schema with only ${tables.length} tables.`);
  const identifiers = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
}

async function seed(): Promise<void> {
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const user = await prisma.user.create({ data: { id: "test-user-admin", email: ADMIN_EMAIL, passwordHash } });
  const workspace = await prisma.examWorkspace.create({
    data: {
      id: "test-workspace-2027",
      userId: user.id,
      stableKey: "postgraduate-2027",
      name: "2027 考研全流程测试空间",
      targetExamDate: day(132),
      stageSummary: "强化阶段：稳定推进、专项复测、按周调整。",
      status: "ACTIVE",
    },
  });
  const foundation = await prisma.subjectGroup.create({
    data: { id: "test-group-foundation", workspaceId: workspace.id, stableKey: "foundation", name: "公共基础课", sortOrder: 10 },
  });
  const major = await prisma.subjectGroup.create({
    data: { id: "test-group-408", workspaceId: workspace.id, stableKey: "408", name: "408 专业课", sortOrder: 20 },
  });
  await prisma.subject.createMany({ data: [
    { id: "test-subject-math", workspaceId: workspace.id, groupId: foundation.id, stableKey: "math", name: "数学", color: "#2563eb", sortOrder: 10 },
    { id: "test-subject-english", workspaceId: workspace.id, groupId: foundation.id, stableKey: "english", name: "英语", color: "#0f766e", sortOrder: 20 },
    { id: "test-subject-politics", workspaceId: workspace.id, groupId: foundation.id, stableKey: "politics", name: "政治", color: "#be123c", sortOrder: 30 },
    { id: "test-subject-ds", workspaceId: workspace.id, groupId: major.id, stableKey: "data-structure", name: "数据结构", color: "#d97706", sortOrder: 40 },
    { id: "test-subject-co", workspaceId: workspace.id, groupId: major.id, stableKey: "computer-organization", name: "计算机组成原理", color: "#7c3aed", sortOrder: 50 },
    { id: "test-subject-os", workspaceId: workspace.id, groupId: major.id, stableKey: "operating-system", name: "操作系统", color: "#15803d", sortOrder: 60 },
    { id: "test-subject-network", workspaceId: workspace.id, groupId: major.id, stableKey: "computer-network", name: "计算机网络", color: "#c2410c", sortOrder: 70 },
  ] });
  await prisma.syllabusNode.createMany({ data: [
    { id: "test-node-math-root", subjectId: "test-subject-math", stableKey: "calculus", title: "高等数学", kind: "CHAPTER", status: "LEARNING", targetMinutes: 2400, actualMinutes: 720, sortOrder: 10 },
    { id: "test-node-limit", subjectId: "test-subject-math", parentId: "test-node-math-root", stableKey: "limit", title: "极限与连续", kind: "TOPIC", status: "MASTERED", masteryLevel: "RETEST_PASSED", targetMinutes: 420, actualMinutes: 480, sortOrder: 10 },
    { id: "test-node-derivative", subjectId: "test-subject-math", parentId: "test-node-math-root", stableKey: "derivative", title: "导数与微分", kind: "TOPIC", status: "NEEDS_REVIEW", masteryLevel: "BASIC_EXERCISES", targetMinutes: 480, actualMinutes: 260, sortOrder: 20 },
    { id: "test-node-english", subjectId: "test-subject-english", stableKey: "reading", title: "阅读理解", kind: "CHAPTER", status: "WEAK", masteryLevel: "SEEN", targetMinutes: 1200, actualMinutes: 300, sortOrder: 10 },
    { id: "test-node-ds", subjectId: "test-subject-ds", stableKey: "graph", title: "图与图算法", kind: "CHAPTER", status: "COVERED", masteryLevel: "CAN_EXPLAIN", targetMinutes: 900, actualMinutes: 680, sortOrder: 10 },
    { id: "test-node-os", subjectId: "test-subject-os", stableKey: "memory", title: "内存管理", kind: "CHAPTER", status: "NOT_STARTED", targetMinutes: 720, sortOrder: 10 },
  ] });

  const stage = await prisma.stagePlan.create({ data: {
    id: "test-stage-active", workspaceId: workspace.id, stableKey: "intensive-2026-08", name: "强化阶段",
    startDate: day(-20), endDate: day(40), goal: "建立稳定掌握证据并完成一轮 408 专项复测。", mode: "maintain", status: "active",
  } });
  const milestone = await prisma.planMilestone.create({ data: {
    id: "test-milestone-week", workspaceId: workspace.id, stagePlanId: stage.id, subjectId: "test-subject-math",
    stableKey: "week-limit-review", title: "完成极限专题复测", targetDate: day(5), sortOrder: 10, status: "OPEN",
  } });
  const terminalGoal = await prisma.terminalGoal.create({ data: {
    id: "test-terminal-goal", userId: user.id, workspaceId: workspace.id, stableKey: "exam-2027",
    title: "2027 考研上岸", outcome: "数学与 408 建立可复测的稳定掌握，按计划完成模拟考试。", targetDate: workspace.targetExamDate,
  } });
  await prisma.stageGoalLink.create({ data: { stagePlanId: stage.id, terminalGoalId: terminalGoal.id, role: "PRIMARY" } });

  await prisma.studyTask.createMany({ data: [
    { id: "test-task-today", subjectId: "test-subject-math", syllabusNodeId: "test-node-derivative", planMilestoneId: milestone.id, title: "完成导数综合题 10 道", type: "study", status: "TODO", priority: "CRITICAL", debtStatus: "NONE", plannedDate: day(0), estimatedMinutes: 90 },
    { id: "test-task-progress", subjectId: "test-subject-ds", syllabusNodeId: "test-node-ds", title: "复盘 Dijkstra 与最短路径", type: "review", status: "IN_PROGRESS", priority: "HIGH", debtStatus: "ACCEPTABLE", plannedDate: day(0), estimatedMinutes: 60, actualMinutes: 20 },
    { id: "test-task-done", subjectId: "test-subject-math", syllabusNodeId: "test-node-limit", title: "极限错题二刷", type: "review", status: "DONE", priority: "HIGH", debtStatus: "NONE", plannedDate: day(-1), estimatedMinutes: 45, actualMinutes: 52, completedAt: day(-1, 20) },
    { id: "test-task-deferred", subjectId: "test-subject-english", syllabusNodeId: "test-node-english", title: "英语阅读精读两篇", type: "study", status: "DEFERRED", priority: "MEDIUM", debtStatus: "NEEDS_RECOVERY", plannedDate: day(-2), estimatedMinutes: 70, reviewText: "因数学专项超时，延期到本周补做。" },
    { id: "test-task-skipped", subjectId: "test-subject-politics", title: "政治时政整理", type: "study", status: "SKIPPED", priority: "LOW", debtStatus: "STAGE_IMPACT", plannedDate: day(-3), estimatedMinutes: 30, reviewText: "本阶段主动降优先级。" },
    { id: "test-task-child", subjectId: "test-subject-english", syllabusNodeId: "test-node-english", parentTaskId: "test-task-deferred", title: "只精读第一篇阅读", type: "study", status: "TODO", priority: "HIGH", debtStatus: "NONE", plannedDate: day(1), estimatedMinutes: 35 },
  ] });
  await Promise.all([
    prisma.studyTaskStageLink.create({ data: { taskId: "test-task-today", stagePlanId: stage.id } }),
    prisma.studyTaskRelatedSyllabusNode.create({ data: { taskId: "test-task-today", syllabusNodeId: "test-node-limit" } }),
    prisma.taskDependency.create({ data: { predecessorId: "test-task-today", successorId: "test-task-child", type: "SOFT", actorId: user.id } }),
    prisma.taskDebtEvent.create({ data: { taskId: "test-task-deferred", actorId: user.id, action: "defer", fromStatus: "TODO", toStatus: "DEFERRED", fromDebtStatus: "NONE", toDebtStatus: "NEEDS_RECOVERY", reason: "高优先级专项占用时间" } }),
  ]);

  const knowledgeGroup = await prisma.knowledgeGroup.create({ data: {
    id: "test-knowledge-group", userId: user.id, workspaceId: workspace.id, subjectId: "test-subject-math",
    stableKey: "calculus-core", title: "微积分核心链路", sortOrder: 10,
  } });
  await prisma.knowledgePoint.createMany({ data: [
    { id: "test-kp-limit", userId: user.id, workspaceId: workspace.id, primarySubjectId: "test-subject-math", primaryGroupId: knowledgeGroup.id, stableKey: "limit-definition", title: "极限定义与判定", boundary: "能解释定义并选择等价无穷小或洛必达法则。", masteryState: "STABLE_MASTERY", nextRetestAt: day(14) },
    { id: "test-kp-derivative", userId: user.id, workspaceId: workspace.id, primarySubjectId: "test-subject-math", primaryGroupId: knowledgeGroup.id, stableKey: "derivative-application", title: "导数应用", boundary: "单调性、极值、最值与证明题。", masteryState: "NEEDS_RETEST", nextRetestAt: day(1) },
    { id: "test-kp-graph", userId: user.id, workspaceId: workspace.id, primarySubjectId: "test-subject-ds", stableKey: "shortest-path", title: "最短路径算法", boundary: "区分 Dijkstra、Floyd 与 Bellman-Ford 的适用条件。", masteryState: "LEARNING", nextRetestAt: day(3) },
  ] });
  await Promise.all([
    prisma.knowledgePointSubject.create({ data: { knowledgePointId: "test-kp-graph", subjectId: "test-subject-math", role: "TRANSFER" } }),
    prisma.knowledgePointRelation.create({ data: { fromPointId: "test-kp-limit", toPointId: "test-kp-derivative", type: "PREREQUISITE", actorId: user.id } }),
    prisma.knowledgeSyllabusLink.create({ data: { knowledgePointId: "test-kp-derivative", syllabusNodeId: "test-node-derivative", role: "REQUIRED" } }),
    prisma.studyTaskKnowledgePoint.create({ data: { taskId: "test-task-today", knowledgePointId: "test-kp-derivative" } }),
    prisma.stageKnowledgeTarget.create({ data: { stagePlanId: stage.id, knowledgePointId: "test-kp-derivative", targetState: "STABLE_MASTERY", importance: 5, feedback: "本阶段必须通过专项复测。" } }),
  ]);
  const arrangement = await prisma.learningArrangement.create({ data: {
    id: "test-arrangement", userId: user.id, workspaceId: workspace.id, stagePlanId: stage.id, subjectId: "test-subject-math",
    title: "导数专项三日安排", intent: "从定义、例题到计时复测形成闭环。", startDate: day(0), endDate: day(2), status: "PLANNED", estimatedMin: 120, estimatedMax: 180,
  } });
  await prisma.learningArrangementKnowledgePoint.create({ data: { arrangementId: arrangement.id, knowledgePointId: "test-kp-derivative" } });

  await prisma.studySession.createMany({ data: [
    { id: "test-session-effective", userId: user.id, workspaceId: workspace.id, subjectId: "test-subject-math", taskId: "test-task-done", syllabusNodeId: "test-node-limit", status: "COMPLETED", startedAt: day(-1, 19), endedAt: day(-1, 20), effectiveMinutes: 52, qualityScore: 5, isEffective: true, understandingLevel: "可以独立讲清", minimalOutput: "整理极限判定清单", nextAction: "两周后复测", producedNote: true, isLowConversion: false, goalMinutes: 45, startSource: "TASK", closeoutVersion: 1 },
    { id: "test-session-low", userId: user.id, workspaceId: workspace.id, subjectId: "test-subject-english", taskId: "test-task-deferred", syllabusNodeId: "test-node-english", status: "COMPLETED", startedAt: day(-2, 21), endedAt: day(-2, 22), effectiveMinutes: 36, qualityScore: 2, isEffective: false, understandingLevel: "定位仍慢", minimalOutput: "记录三处长难句", nextAction: "拆小后重做", producedMistake: true, isLowConversion: true, antiFakeReason: "产出不足", requiredOutput: "完成一篇精读卡片", goalMinutes: 60, startSource: "TASK", closeoutVersion: 1 },
    { id: "test-session-canceled", userId: user.id, workspaceId: workspace.id, subjectId: "test-subject-ds", taskId: "test-task-progress", syllabusNodeId: "test-node-ds", status: "CANCELED", startedAt: day(-3, 10), endedAt: day(-3, 10), effectiveMinutes: 5, note: "临时中断", goalMinutes: 60, startSource: "TASK" },
  ] });
  await Promise.all([
    prisma.studySessionCloseout.create({ data: { sessionId: "test-session-effective", understanding: "CAN_APPLY", efficiency: "HIGH", focusLevel: 5, energyLevel: 4, summary: "完整完成目标并形成复测线索。", nextDisposition: "SCHEDULE_RETEST", actorId: user.id } }),
    prisma.studySessionKnowledgePoint.create({ data: { sessionId: "test-session-effective", knowledgePointId: "test-kp-limit", understanding: "CAN_APPLY", note: "能够处理典型变式。" } }),
    prisma.studySessionDevicePresence.create({ data: { sessionId: "test-session-canceled", userId: user.id, workspaceId: workspace.id, deviceId: "test-device-desktop", deviceLabel: "本地桌面浏览器", lastSeenAt: day(-3, 10) } }),
  ]);

  for (let offset = -6; offset <= 0; offset += 1) {
    await prisma.checkIn.create({ data: {
      workspaceId: workspace.id, studyDate: day(offset, 0), completedMinimumAction: offset !== -4,
      totalMinutes: offset === -4 ? 15 : 70 + (offset + 6) * 8, effectiveMinutes: offset === -4 ? 5 : 55 + (offset + 6) * 6,
      effectiveSessionCount: offset === -4 ? 0 : 2, taskCompletionRate: offset === -4 ? 0.2 : 0.7,
      reviewSubmitted: offset < 0, lowEfficiency: offset === -4, lowConversionCount: offset === -2 ? 1 : 0,
      reviewCount: offset < 0 ? 1 : 0, reviewSeconds: offset < 0 ? 600 : 0, passedCount: offset < -2 ? 1 : 0,
      partialCount: offset === -2 ? 1 : 0, minimumActionSource: offset === -4 ? "NONE" : "STUDY_SESSION",
    } });
  }
  await prisma.dailyReview.createMany({ data: [
    { workspaceId: workspace.id, reviewDate: day(-1, 22), totalMinutes: 112, effectiveMinutes: 87, summary: "数学复测完成，408 推进稳定。", lostControl: "英语精读被压缩。", keepAction: "保持先做高价值输出。", tomorrowMinimum: "完成导数综合题 5 道。", mood: "steady" },
    { workspaceId: workspace.id, reviewDate: day(-2, 22), totalMinutes: 76, effectiveMinutes: 41, summary: "完成基础投入但转化偏低。", lostControl: "长难句停留过久。", keepAction: "及时拆小。", tomorrowMinimum: "精读一篇并形成卡片。", mood: "tired" },
  ] });
  await prisma.recoveryState.create({ data: {
    workspaceId: workspace.id, userId: user.id, status: "COMPLETED", triggerType: "RULE", startedAt: day(-5), endedAt: day(-4),
    targetMinutes: 25, visibleTaskLimit: 3, reason: "连续低效后进入最小行动恢复。", exitCondition: "完成一次有效学习并提交复盘", actorId: user.id, currentStage: 2,
    windowStartDate: day(-5, 0), windowEndDate: day(-3, 0), lastProgressDate: day(-4, 0), metadata: { source: "complete-test-seed" },
  } });

  const note = await prisma.note.create({ data: {
    id: "test-note-limit", subjectId: "test-subject-math", syllabusNodeId: "test-node-limit", taskId: "test-task-done",
    kind: "CONCEPT", studyDate: day(-1), stableKey: "limit-checklist", title: "极限判定方法清单",
    content: "先看结构，再判断等价替换、洛必达或夹逼；最后检查适用条件。", masteryStatus: "mastered", nextReviewAt: day(14),
  } });
  const mistake = await prisma.mistake.create({ data: {
    id: "test-mistake-english", subjectId: "test-subject-english", syllabusNodeId: "test-node-english", title: "长难句主干判断错误",
    source: "英语阅读训练", cause: "WRONG_APPROACH", correctIdea: "先识别谓语，再排除插入与修饰成分。", nextReviewAt: day(1),
  } });
  await prisma.noteRelatedSyllabusNode.create({ data: { noteId: note.id, syllabusNodeId: "test-node-derivative" } });
  const resource = await prisma.studyResource.create({ data: {
    id: "test-resource-link", workspaceId: workspace.id, stableKey: "mit-calculus", title: "微积分公开课参考",
    category: "COURSE", sourceType: "LINK", subjectId: "test-subject-math", externalUrl: "https://ocw.mit.edu/", displayHost: "ocw.mit.edu", actorId: user.id,
  } });
  await Promise.all([
    prisma.studyResourceTag.create({ data: { resourceId: resource.id, tagNorm: "calculus", tagDisplay: "微积分" } }),
    prisma.studyResourceTaskLink.create({ data: { resourceId: resource.id, taskId: "test-task-today" } }),
    prisma.studyResourceNoteLink.create({ data: { resourceId: resource.id, noteId: note.id } }),
    prisma.studyResourceMistakeLink.create({ data: { resourceId: resource.id, mistakeId: mistake.id } }),
    prisma.studyResourceSyllabusNodeLink.create({ data: { resourceId: resource.id, syllabusNodeId: "test-node-derivative" } }),
  ]);

  const reviewSchedule = await prisma.reviewSchedule.create({ data: {
    id: "test-review-schedule", workspaceId: workspace.id, targetType: "NOTE", noteId: note.id, status: "ACTIVE", dueDate: day(1), consecutivePassCount: 1, actorId: user.id,
  } });
  const reviewEvent = await prisma.reviewEvent.create({ data: {
    id: "test-review-event", reviewScheduleId: reviewSchedule.id, idempotencyKey: "complete-test-review-1",
    requestFingerprint: sha256("complete-test-review-1"), expectedRevision: 1, appliedRevision: 2, result: "PASSED", durationSeconds: 480,
    learningDate: day(-1), nextDueDate: day(14), consecutivePassDelta: 1, note: "能够独立复述并完成变式。", actorId: user.id,
  } });
  const masteryRetest = await prisma.masteryRetest.create({ data: {
    id: "test-mastery-retest", syllabusNodeId: "test-node-limit", testedAt: day(-1), result: "passed", score: "9/10",
    summary: "极限专题复测通过。", nextReviewAt: day(14), reviewEventId: reviewEvent.id, actorId: user.id,
  } });
  await Promise.all([
    prisma.masteryConditionRecord.create({ data: { syllabusNodeId: "test-node-limit", condition: "能独立解释核心定义", checked: true, checkedAt: day(-1), actorId: user.id } }),
    prisma.masteryConditionRecord.create({ data: { syllabusNodeId: "test-node-derivative", condition: "完成两次间隔复测", checked: false, actorId: user.id } }),
    prisma.masteryEvidence.create({ data: { syllabusNodeId: "test-node-limit", evidenceType: "SESSION", taskId: "test-task-done", sessionId: "test-session-effective", noteId: note.id, retestId: masteryRetest.id, summary: "学习、笔记与复测证据齐全。", actorId: user.id } }),
  ]);

  const exam = await prisma.simulationExam.create({ data: {
    id: "test-simulation", workspaceId: workspace.id, name: "强化阶段综合模拟一", examDate: day(-7), isFirstSynchronized: true,
    targetDurationMinutes: 180, actualDurationMinutes: 172, targetScore: 300, actualScore: 248, blankQuestionCount: 2,
    lossReasons: ["概念边界", "时间分配"], mindset: "前紧后稳", summary: "数学稳定，408 图算法仍需专项复测。", reviewText: "下一周期优先补图算法。", status: "CONFIRMED", confirmedAt: day(-7, 18),
  } });
  const examResult = await prisma.simulationSubjectResult.create({ data: {
    id: "test-simulation-result", simulationExamId: exam.id, subjectId: "test-subject-ds", paperFullScore: 100, targetScore: 85,
    actualScore: 72, durationMinutes: 55, blankQuestionCount: 1, lossReasons: ["最短路径边界"], summary: "算法选择条件混淆。",
  } });
  await prisma.simulationLossItem.create({ data: { simulationSubjectResultId: examResult.id, reason: "CONCEPT_GAP", syllabusNodeId: "test-node-ds", lostScore: 13, note: "Dijkstra 负权边界记忆错误。" } });

  const knowledgeRetest = await prisma.knowledgeRetest.create({ data: {
    id: "test-knowledge-retest", userId: user.id, workspaceId: workspace.id, title: "导数应用专项复测", method: "计时完成 6 道综合题",
    status: "PENDING_REVIEW", result: "PARTIAL", scheduledAt: day(-1), testedAt: day(-1, 16), nextDueAt: day(3), summary: "基础题通过，证明题仍需补强。", reviewText: "安排一轮证明题小测。",
  } });
  const retestPoint = await prisma.knowledgeRetestPoint.create({ data: {
    id: "test-retest-point", retestId: knowledgeRetest.id, knowledgePointId: "test-kp-derivative", result: "PARTIAL", score: 0.72, understanding: 3, note: "单调性稳定，构造辅助函数仍慢。",
  } });
  await prisma.knowledgeEvidence.createMany({ data: [
    { userId: user.id, workspaceId: workspace.id, knowledgePointId: "test-kp-limit", sourceType: "SESSION", sessionId: "test-session-effective", summary: "完成高质量学习收口。", dimensions: { understanding: 5, transfer: 4 }, confidence: 0.9, occurredAt: day(-1) },
    { userId: user.id, workspaceId: workspace.id, knowledgePointId: "test-kp-derivative", sourceType: "RETEST", retestPointId: retestPoint.id, summary: "专项复测部分通过。", dimensions: { accuracy: 0.72, speed: 0.65 }, confidence: 0.8, occurredAt: day(-1) },
  ] });

  const report = await prisma.periodicReportDecision.create({ data: {
    id: "test-report-decision", workspaceId: workspace.id, kind: "week", rangeStart: day(-7, 0), rangeEnd: day(-1, 23), status: "confirmed",
    reportSnapshot: { totalMinutes: 486, effectiveMinutes: 351, completionRate: 0.71, lowConversionCount: 1 },
    nextCycleDraft: { focus: ["导数应用", "最短路径"], taskIntensity: "maintain" }, actorId: user.id,
  } });
  await prisma.stageAdjustmentDraft.createMany({ data: [
    { id: "test-stage-draft-pending", workspaceId: workspace.id, stagePlanId: stage.id, sourceReportDecisionId: report.id, sourceReportRevision: 1, originVersion: 1, source: "LOCAL_RULE", mode: "maintain", risk: "medium", riskConclusion: "保持总量，调整内部重点。", focusSubjects: ["数学", "数据结构"], taskIntensity: "maintain", taskAdjustmentActions: ["增加导数证明题", "安排最短路径复测"], nextStageEmphasis: "以复测结果驱动任务。", status: "pending", actorId: user.id },
    { id: "test-stage-draft-rejected", workspaceId: workspace.id, stagePlanId: stage.id, source: "LOCAL_RULE", mode: "reduce", risk: "low", riskConclusion: "历史拒绝样例。", focusSubjects: ["英语"], taskIntensity: "reduce", taskAdjustmentActions: ["减少阅读量"], nextStageEmphasis: "保持最小行动。", status: "rejected", actorId: user.id },
  ] });

  await prisma.planInboxItem.createMany({ data: [
    { id: "test-inbox-open", workspaceId: workspace.id, stableKey: "next-graph-retest", originKey: "weekly-report", originVersion: 1, originType: "REPORT", originSnapshot: { reportDecisionId: report.id }, status: "OPEN", title: "安排最短路径专项复测", subjectId: "test-subject-ds", plannedDate: day(2), estimatedMinutes: 50, priority: "HIGH", type: "review", planMilestoneId: milestone.id, primaryNodeId: "test-node-ds", relatedNodeIds: [], actorId: user.id },
    { id: "test-inbox-converted", workspaceId: workspace.id, stableKey: "split-english-reading", originKey: "recovery", originVersion: 1, originType: "RECOVERY", originSnapshot: { recoveryState: "completed" }, status: "CONVERTED", title: "拆小英语阅读任务", subjectId: "test-subject-english", plannedDate: day(1), estimatedMinutes: 35, priority: "HIGH", type: "study", convertedTaskId: "test-task-child", convertedAt: now, actorId: user.id },
  ] });
  await prisma.planInboxDependencyRef.create({ data: { inboxItemId: "test-inbox-open", targetType: "TASK", dependencyType: "SOFT", taskId: "test-task-progress" } });

  const canvas = await prisma.knowledgeCanvasLayout.create({ data: { userId: user.id, workspaceId: workspace.id, viewportX: 120, viewportY: 80, viewportZoom: 0.9 } });
  await prisma.knowledgeCanvasNodeLayout.createMany({ data: [
    { layoutId: canvas.id, entityType: "SUBJECT", entityId: "test-subject-math", x: 80, y: 100, pinned: true },
    { layoutId: canvas.id, entityType: "SYLLABUS_NODE", entityId: "test-node-derivative", x: 320, y: 160 },
    { layoutId: canvas.id, entityType: "NOTE", entityId: note.id, x: 560, y: 220 },
    { layoutId: canvas.id, entityType: "MISTAKE", entityId: mistake.id, x: 560, y: 360, collapsed: true },
  ] });
  const motivation = await prisma.motivationItem.create({ data: { id: "test-motivation", userId: user.id, type: "QUOTE", title: "稳定推进比短期爆发更重要", body: "把今天的最小行动做实。", tags: ["恢复", "长期主义"], sortOrder: 10, actorId: user.id } });
  await Promise.all([
    prisma.motivationVault.create({ data: { whyStarted: "为了获得更扎实的专业能力与选择空间。", neverReturnTo: "不再回到只收藏资料、不做输出的状态。", futureSelf: "能够稳定学习、清楚判断掌握边界的人。", messageToFuture: "先完成今天的最小行动。", firstSimulationDiary: "第一次模拟暴露问题，但也给出了清晰路线。" } }),
    prisma.motivationReminderState.create({ data: { userId: user.id, lastAutoShowAt: day(-1), learningDay: day(0, 0), dailyCount: 1, recentItemIds: [motivation.id] } }),
    prisma.notificationPreference.create({ data: { userId: user.id, quietHoursStart: 23, quietHoursEnd: 7 } }),
    prisma.aiDraftOperation.create({ data: { operationId: "test-ai-stage-draft", actorId: user.id, workspaceId: workspace.id, endpoint: "/api/ai/stage-adjustment", purpose: "TEST_FIXTURE", requestFingerprint: sha256("test-ai-stage-draft"), nonce: "test-ai-nonce", projectionVersion: "v1", status: "SUCCEEDED", resultReference: "test-stage-draft-pending", expiresAt: day(1), consumedAt: now } }),
    prisma.aiRuntimeSetting.create({ data: { id: "global", enabled: false } }),
  ]);

  const importBatch = await prisma.learningTreeImportBatch.create({ data: {
    id: "test-import-batch", workspaceId: workspace.id, protocolVersion: "AREAFORGE_LEARNING_TREE_V1", parserVersion: "1",
    scope: "workspace", canonicalMarkdown: "# 测试导入：概率论", sourceSha256: sha256("# 测试导入：概率论"), canonicalPlanHash: sha256("test-import-plan"),
    rootRevision: 1, statsJson: { created: 1, updated: 0 }, resultJson: { status: "applied" }, idempotencyKey: "test-import-1",
    requestFingerprint: sha256("test-import-request"), previewNonce: "test-preview-nonce", previewOperationId: "test-preview-operation", actorId: user.id,
  } });
  await Promise.all([
    prisma.learningTreeImportItem.create({ data: { batchId: importBatch.id, stableRef: "probability", objectType: "subject", diffType: "create", sourceLine: 1, mappedTargetKey: "probability", userChoice: "apply", applyResult: "created" } }),
    prisma.learningTreeExportGrant.create({ data: { nonce: "test-export-nonce", actorId: user.id, workspaceId: workspace.id, scope: "workspace", sourceSha256: sha256("test-export"), rootRevision: 1, expiresAt: day(1) } }),
  ]);

  await prisma.auditEvent.createMany({ data: [
    { actorId: user.id, action: "FULL_TEST_DATA_SEEDED", entityType: "ExamWorkspace", entityId: workspace.id, metadata: { source: "db:seed:complete-test", synthetic: true } },
    { actorId: user.id, action: "AUTH_ADMIN_SEEDED", entityType: "User", entityId: user.id, metadata: { source: "db:seed:complete-test" } },
  ] });
}

async function reportCounts(): Promise<void> {
  const [users, workspaces, subjects, syllabusNodes, tasks, sessions, checkIns, notes, mistakes, knowledgePoints, simulationExams, stagePlans] = await Promise.all([
    prisma.user.count(), prisma.examWorkspace.count(), prisma.subject.count(), prisma.syllabusNode.count(),
    prisma.studyTask.count(), prisma.studySession.count(), prisma.checkIn.count(), prisma.note.count(),
    prisma.mistake.count(), prisma.knowledgePoint.count(), prisma.simulationExam.count(), prisma.stagePlan.count(),
  ]);
  console.log(JSON.stringify({
    database: "areaforge",
    adminEmail: ADMIN_EMAIL,
    counts: { users, workspaces, subjects, syllabusNodes, tasks, sessions, checkIns, notes, mistakes, knowledgePoints, simulationExams, stagePlans },
  }, null, 2));
}

try {
  await assertLocalTarget();
  await truncateBusinessTables();
  await seed();
  await reportCounts();
} finally {
  await prisma.$disconnect();
}
