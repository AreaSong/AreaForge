import { z } from "zod";

export const idempotencyKeySchema = z.string().trim().min(8).max(200);

export const createTaskSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  subjectId: z.string().min(1),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  relatedSyllabusNodeIds: z.array(z.string().min(1)).max(20).optional(),
  planMilestoneId: z.string().min(1).nullable().optional(),
  stagePlanIds: z.array(z.string().min(1)).max(20).optional(),
  knowledgePointIds: z.array(z.string().min(1)).max(50).optional(),
  sourceResourceId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40).default("study"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  plannedDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(5).max(720).default(45),
});

export const createSyllabusNodeSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  subjectId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["subject", "chapter", "topic", "problem_type"]).default("topic"),
  status: z
    .enum(["not_started", "learning", "covered", "needs_review", "mastered", "weak", "deferred"])
    .default("not_started"),
  masteryLevel: z
    .enum(["seen", "learned", "basic_exercises", "can_explain", "retest_passed", "exam_stable"])
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  targetMinutes: z.number().int().min(0).max(100000).default(0),
});

export const createKnowledgePointSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  subjectId: z.string().min(1),
  primaryGroupId: z.string().min(1).nullable().optional(),
  stableKey: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(180),
  boundary: z.string().trim().max(3000).nullable().optional(),
  relatedSubjectIds: z.array(z.string().min(1)).max(20).default([]),
});

export const updateKnowledgePointSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(180).optional(),
  boundary: z.string().trim().max(3000).nullable().optional(),
  primaryGroupId: z.string().min(1).nullable().optional(),
  masteryState: z.enum(["UNTOUCHED", "LEARNING", "INITIAL_MASTERY", "STABLE_MASTERY", "NEEDS_RETEST"]).optional(),
  nextRetestAt: z.string().datetime().nullable().optional(),
}).refine(
  (value) => Object.entries(value).some(([key, item]) => key !== "expectedRevision" && item !== undefined),
  { message: "至少提供一个要更新的知识点字段" },
);

export const importSyllabusMarkdownSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  subjectId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  markdown: z.string().trim().min(1).max(20000),
});

export const updateSyllabusNodeSchema = z.object({
  expectedRevision: z.number().int().positive(),
  parentId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(["subject", "chapter", "topic", "problem_type"]).optional(),
  status: z.enum(["not_started", "learning", "covered", "needs_review", "mastered", "weak", "deferred"]).optional(),
  masteryLevel: z
    .enum(["seen", "learned", "basic_exercises", "can_explain", "retest_passed", "exam_stable"])
    .nullable()
    .optional(),
  masteryConditions: z
    .array(
      z.enum([
        "course_or_textbook",
        "own_explanation",
        "basic_exercise",
        "comprehensive_exercise",
        "mistake_reviewed",
        "delayed_retest",
      ]),
    )
    .max(6)
    .optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  targetMinutes: z.number().int().min(0).max(100000).optional(),
});

const masteryEvidenceTypeSchema = z.enum(["task", "session", "note", "mistake", "retest"]);
const masteryRetestResultSchema = z.enum(["passed", "failed", "partial"]);

export const createMasteryEvidenceSchema = z
  .object({
    evidenceType: masteryEvidenceTypeSchema,
    taskId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    noteId: z.string().min(1).optional(),
    mistakeId: z.string().min(1).optional(),
    retestId: z.string().min(1).optional(),
    summary: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, context) => {
    const requiredKey = `${value.evidenceType}Id` as "taskId" | "sessionId" | "noteId" | "mistakeId" | "retestId";
    const evidenceIds = [value.taskId, value.sessionId, value.noteId, value.mistakeId, value.retestId].filter(Boolean);
    if (!value[requiredKey]) {
      context.addIssue({
        code: "custom",
        message: `${requiredKey} is required for ${value.evidenceType} evidence`,
        path: [requiredKey],
      });
    }
    if (evidenceIds.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "exactly one evidence reference is required",
      });
    }
  });

export const createMasteryRetestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  testedAt: z.string().datetime().optional(),
  result: masteryRetestResultSchema,
  score: z.string().trim().max(80).optional(),
  summary: z.string().trim().max(2000).optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

export const createNoteSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  subjectId: z.string().min(1),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  relatedSyllabusNodeIds: z.array(z.string().min(1)).max(20).optional(),
  taskId: z.string().min(1).nullable().optional(),
  kind: z.enum(["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"]).optional(),
  studyDate: z.string().datetime().nullable().optional(),
  stableKey: z.string().trim().min(1).max(120).nullable().optional(),
  expectedRevision: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(10000),
  masteryStatus: z.enum(["understood", "partial", "unknown", "relearn", "before_exam"]).nullable().optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

export const updateNoteSchema = z.object({
  expectedRevision: z.number().int().positive(),
  subjectId: z.string().min(1).optional(),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  relatedSyllabusNodeIds: z.array(z.string().min(1)).max(20).optional(),
  taskId: z.string().min(1).nullable().optional(),
  resourceIds: z.array(z.string().min(1)).max(100).optional(),
  kind: z.enum(["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"]).optional(),
  studyDate: z.string().datetime().nullable().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  content: z.string().max(10000).refine((value) => value.trim().length > 0).optional(),
  masteryStatus: z.enum(["understood", "partial", "unknown", "relearn", "before_exam"]).nullable().optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

export const noteRevisionCommandSchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export const createMistakeSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  subjectId: z.string().min(1),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(180),
  questionText: z.string().trim().min(1).max(10000),
  source: z.string().trim().max(500).nullable().optional(),
  cause: z
    .enum([
      "unknown",
      "concept_confusion",
      "formula_unfamiliar",
      "wrong_approach",
      "careless",
      "time_pressure",
      "unfamiliar_pattern",
    ])
    .refine((value) => value !== "unknown", { message: "新错题必须选择明确错因" }),
  causeNote: z.string().trim().max(2000).nullable().optional(),
  correctAnswer: z.string().trim().max(5000).nullable().optional(),
  correctIdea: z.string().trim().min(1).max(3000),
  nextReviewAt: z.string().datetime().nullable().optional(),
  simulationLossItemId: z.string().min(1).nullable().optional(),
});

export const updateMistakeSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  subjectId: z.string().min(1).optional(),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(180).optional(),
  questionText: z.string().trim().min(1).max(10000).optional(),
  source: z.string().trim().max(500).nullable().optional(),
  cause: z
    .enum([
      "unknown",
      "concept_confusion",
      "formula_unfamiliar",
      "wrong_approach",
      "careless",
      "time_pressure",
      "unfamiliar_pattern",
    ])
    .optional(),
  causeNote: z.string().trim().max(2000).nullable().optional(),
  correctAnswer: z.string().trim().max(5000).nullable().optional(),
  correctIdea: z.string().trim().max(3000).nullable().optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
}).refine(
  (value) => Object.entries(value).some(([field, fieldValue]) => field !== "expectedUpdatedAt" && fieldValue !== undefined),
  { message: "至少提供一个要更新的错题字段" },
);

export const mistakeArchiveCommandSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
});

export const mistakeAttemptSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  answerMode: z.enum(["TEXT", "PAPER_OR_ORAL"]),
  answerText: z.string().trim().max(10000).nullable().optional(),
  result: z.enum(["PASSED", "PARTIAL", "FAILED"]),
  durationSeconds: z.number().int().min(1).max(14400).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.answerMode === "TEXT" && !value.answerText?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["answerText"], message: "文字作答需要填写答案" });
  }
});

export const mistakeLinksSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  noteIds: z.array(z.string().min(1)).max(100),
  resourceIds: z.array(z.string().min(1)).max(100),
});

const motivationTextSchema = z.string().trim().max(3000).optional();

export const saveMotivationVaultSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    expectedUpdatedAt: z.string().datetime().nullable(),
    whyStarted: motivationTextSchema,
    neverReturnTo: motivationTextSchema,
    futureSelf: motivationTextSchema,
    messageToFuture: motivationTextSchema,
    firstSimulationDiary: motivationTextSchema,
  })
  .refine(
    (value) =>
      [
        value.whyStarted,
        value.neverReturnTo,
        value.futureSelf,
        value.messageToFuture,
        value.firstSimulationDiary,
      ].some((item) => item && item.length > 0),
    {
      message: "At least one motivation field is required",
    },
  );

export const saveFirstSimulationDiarySchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  firstSimulationDiary: z.string().trim().min(1).max(5000),
});

const simulationLossReasonsSchema = z.array(z.string().trim().min(1).max(120)).max(20).default([]);
const stagePlanModeSchema = z.enum(["recovery", "strengthen", "sprint", "maintain"]);
const stagePlanStatusSchema = z.enum(["draft", "active", "completed", "archived"]);

const simulationSubjectResultSchema = z.object({
  subjectId: z.string().min(1),
  expectedRevision: z.number().int().min(1).optional(),
  paperFullScore: z.number().positive().max(1000).multipleOf(0.5),
  targetScore: z.number().min(0).max(1000).multipleOf(0.5),
  actualScore: z.number().min(0).max(1000).multipleOf(0.5),
  durationMinutes: z.number().int().min(0).max(720).optional(),
  blankQuestionCount: z.number().int().min(0).max(300).default(0),
  lossReasons: simulationLossReasonsSchema,
  summary: z.string().trim().max(2000).optional(),
  lossItems: z.array(z.object({
    reason: z.enum(["CONCEPT_GAP", "MEMORY_FORMULA", "METHOD_ERROR", "CALCULATION_CARELESS", "TIME_ALLOCATION", "READING_COMPREHENSION", "UNFAMILIAR_PATTERN", "MINDSET", "UNANSWERED", "OTHER"]),
    syllabusNodeId: z.string().min(1).nullable().optional(),
    lostScore: z.number().positive().max(1000).multipleOf(0.5),
    note: z.string().trim().max(500).nullable().optional(),
  })).max(100).optional(),
}).superRefine((value, context) => {
  if (value.targetScore > value.paperFullScore) context.addIssue({ code: "custom", path: ["targetScore"], message: "targetScore must not exceed paperFullScore" });
  if (value.actualScore > value.paperFullScore) context.addIssue({ code: "custom", path: ["actualScore"], message: "actualScore must not exceed paperFullScore" });
});

const simulationExamSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  name: z.string().trim().min(1).max(160),
  examDate: z.string().datetime().optional(),
  isFirstSynchronized: z.boolean().optional(),
  targetDurationMinutes: z.number().int().min(30).max(720).optional(),
  targetScore: z.number().min(0).max(1000).optional(),
});

export const createSimulationExamSchema = simulationExamSchema;
export const simulationExamCommandSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedRevision: z.number().int().min(1),
});

export const saveSimulationExamResultsSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    targetDurationMinutes: z.number().int().min(30).max(720).optional(),
    actualDurationMinutes: z.number().int().min(0).max(720).optional(),
    targetScore: z.number().min(0).max(1000).optional(),
    actualScore: z.number().min(0).max(1000).optional(),
    blankQuestionCount: z.number().int().min(0).max(300).optional(),
    lossReasons: simulationLossReasonsSchema,
    mindset: z.string().trim().max(2000).optional(),
    // A DRAFT simulation may be saved only to persist its selected subjects;
    // the full summary and review are required after the timer before confirmation.
    summary: z.string().trim().max(4000),
    reviewText: z.string().trim().max(4000),
    subjectResults: z.array(simulationSubjectResultSchema).min(1).max(8),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.subjectResults.forEach((result, index) => {
      if (seen.has(result.subjectId)) {
        context.addIssue({
          code: "custom",
          path: ["subjectResults", index, "subjectId"],
          message: "subjectId must be unique per simulation exam",
        });
      }
      seen.add(result.subjectId);
    });
  });

const stagePlanBaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  goal: z.string().trim().min(1).max(2000),
});

const createStagePlanSchema = stagePlanBaseSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  baseRevision: z.number().int().positive().nullable(),
  mode: stagePlanModeSchema.default("maintain"),
  status: stagePlanStatusSchema.default("draft"),
});

export const stagePlanSchema = createStagePlanSchema
  .refine((value) => new Date(value.endDate).getTime() >= new Date(value.startDate).getTime(), {
    message: "endDate must be after startDate",
    path: ["endDate"],
  });

export const updateStagePlanSchema = stagePlanBaseSchema
  .extend({
    expectedRevision: z.number().int().min(1),
    mode: stagePlanModeSchema,
    status: stagePlanStatusSchema,
  })
  .partial()
  .required({ expectedRevision: true })
  .refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), {
    message: "at least one field is required",
  })
  .refine(
    (value) => {
      if (!value.startDate || !value.endDate) return true;
      return new Date(value.endDate).getTime() >= new Date(value.startDate).getTime();
    },
    {
      message: "endDate must be after startDate",
      path: ["endDate"],
    },
  );

export const stageAdjustmentDraftSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  stagePlanId: z.string().min(1).nullable().optional(),
});

export const aiStageAdjustmentDraftSchema = stageAdjustmentDraftSchema;

export const periodicReportDecisionSchema = z.object({
  kind: z.enum(["week", "month"]),
  action: z.enum(["confirm", "reject"]),
  expectedRevision: z.number().int().positive(),
  rangeStart: z.string().datetime(),
  rangeEnd: z.string().datetime(),
});

const taskDebtReorderSelectedTaskIdsSchema = z.array(z.string().min(1)).min(1).max(5);

const taskDebtReorderSelectionSchema = z
  .object({
    selectedTaskIds: taskDebtReorderSelectedTaskIdsSchema.optional(),
    suggestionIds: taskDebtReorderSelectedTaskIdsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!value.selectedTaskIds && !value.suggestionIds) {
      context.addIssue({
        code: "custom",
        message: "selectedTaskIds is required",
        path: ["selectedTaskIds"],
      });
    }
  })
  .transform((value) => ({
    selectedTaskIds: value.selectedTaskIds ?? value.suggestionIds ?? [],
  }));

export const taskDebtReorderDecisionSchema = z
  .object({
    action: z.enum(["confirm", "reject"]),
  })
  .and(taskDebtReorderSelectionSchema);

export const taskDebtReorderApplicationSchema = taskDebtReorderSelectionSchema;

export const createSimulationTaskSchema = z.object({
  subjectId: z.string().min(1),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(160),
  plannedDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(30).max(720).default(180),
});

export const completeSimulationTaskSchema = z.object({
  targetScore: z.string().trim().max(80).optional(),
  actualScore: z.string().trim().max(80).optional(),
  durationMinutes: z.number().int().min(30).max(720).optional(),
  blankCount: z.number().int().min(0).max(300).optional(),
  lossReason: z.string().trim().max(2000).optional(),
  mindset: z.string().trim().max(2000).optional(),
  summary: z.string().trim().min(1).max(4000),
});

export const updateTaskSchema = z.object({
  expectedStatus: z.enum(["todo", "in_progress", "done", "skipped", "deferred"]),
  expectedUpdatedAt: z.string().datetime(),
  subjectId: z.string().min(1).optional(),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  relatedSyllabusNodeIds: z.array(z.string().min(1)).max(20).optional(),
  planMilestoneId: z.string().min(1).nullable().optional(),
  stagePlanIds: z.array(z.string().min(1)).max(20).optional(),
  knowledgePointIds: z.array(z.string().min(1)).max(50).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  type: z.string().trim().min(1).max(40).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  plannedDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(5).max(720).optional(),
  reviewText: z.string().trim().max(2000).nullable().optional(),
});

export const completeTaskSchema = z.object({
  reviewText: z.string().trim().max(2000).optional(),
});

export const deferTaskSchema = z.object({
  plannedDate: z.string().datetime().optional(),
  reviewText: z.string().trim().max(2000).optional(),
});

export const recoverTaskSchema = z.object({
  plannedDate: z.string().datetime().optional(),
  reviewText: z.string().trim().max(2000).optional(),
});

export const startManualRecoveryStateSchema = z.object({
  reason: z.string().trim().min(1).max(1000).optional(),
  targetMinutes: z.number().int().min(5).max(240).optional(),
  visibleTaskLimit: z.number().int().min(1).max(8).optional(),
});

export const finishRecoveryStateSchema = z.object({
  exitCondition: z.string().trim().max(1000).optional(),
});

export const splitTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  plannedDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(5).max(240).default(30),
  reviewText: z.string().trim().max(2000).optional(),
});

export const convertTaskToReviewSchema = z.object({
  plannedDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(5).max(240).optional(),
  reviewText: z.string().trim().max(2000).optional(),
});

export const startSessionSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    startedAt: z.string().datetime().optional(),
    subjectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    syllabusNodeId: z.string().min(1).nullable().optional(),
    goalMinutes: z.number().int().min(5).max(720).nullable().optional(),
    startSource: z.enum(["TASK", "SUBJECT_SHORTCUT", "RECOVERY", "KNOWLEDGE_REVIEW", "KNOWLEDGE_RETEST", "SIMULATION_EXAM"]).optional(),
    activityKind: z.enum(["STUDY", "REVIEW", "TEST"]).optional(),
    activityMode: z.enum(["FREE_STUDY", "KNOWLEDGE_REVIEW", "RETEST", "SIMULATION"]).optional(),
    reviewScheduleId: z.string().min(1).nullable().optional(),
    knowledgeRetestId: z.string().min(1).nullable().optional(),
    simulationExamId: z.string().min(1).nullable().optional(),
    clientDeviceId: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/).optional(),
    clientDeviceLabel: z.string().trim().min(1).max(80).optional(),
  })
  .refine((value) => value.subjectId || value.taskId, {
    message: "subjectId or taskId is required",
  });

export const sessionCommandSchema = z.object({
  expectedStatus: z.enum(["running", "paused", "closing"]),
  expectedUpdatedAt: z.string().datetime(),
  idempotencyKey: z.string().min(8).max(200),
});

const sessionLowReasonSchema = z.enum([
  "NOT_UNDERSTOOD",
  "DISTRACTED",
  "MATERIAL_BLOCKED",
  "FATIGUE",
  "METHOD_MISMATCH",
  "TIME_FRAGMENTED",
  "OTHER",
]);

export const updateSessionContextSchema = sessionCommandSchema.extend({
  taskId: z.string().min(1).nullable().optional(),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  knowledgePointIds: z.array(z.string().min(1)).max(50).optional(),
}).refine((value) => value.taskId !== undefined || value.syllabusNodeId !== undefined || value.knowledgePointIds !== undefined, {
  message: "taskId, syllabusNodeId or knowledgePointIds is required",
});

export const studySessionHeartbeatSchema = z.object({
  clientDeviceId: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/).optional(),
  clientDeviceLabel: z.string().trim().min(1).max(80).optional(),
});

export const endSessionSchema = sessionCommandSchema.extend({
  mode: z.enum(["prepare", "complete"]).default("complete"),
  qualityScore: z.number().int().min(1).max(5).optional(),
  isEffective: z.boolean().optional(),
  understandingLevel: z.string().trim().min(1).max(80).optional(),
  minimalOutput: z.string().trim().min(1).max(1000).optional(),
  nextAction: z.string().trim().min(1).max(500).optional(),
  producedNote: z.boolean().default(false),
  producedMistake: z.boolean().default(false),
  note: z.string().trim().max(2000).optional(),
  completeTask: z.boolean().default(false),
  lowReasons: z.array(sessionLowReasonSchema).max(7).default([]),
  focusLevel: z.number().int().min(1).max(5).optional(),
  energyLevel: z.number().int().min(1).max(5).optional(),
  nextDisposition: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.mode === "complete") {
    for (const field of ["qualityScore", "isEffective", "understandingLevel", "minimalOutput", "nextAction"] as const) {
      if (value[field] === undefined) context.addIssue({ code: "custom", path: [field], message: `${field} is required when completing a closeout` });
    }
    if (value.isEffective === false && value.lowReasons.length === 0) {
      context.addIssue({ code: "custom", path: ["lowReasons"], message: "lowReasons is required for low-conversion closeout" });
    }
  }
});

export const linkSessionEvidenceSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedCloseoutVersion: z.number().int().positive(),
  evidenceType: z.enum(["note", "mistake", "retest"]),
  evidenceId: z.string().min(1),
});

export const createKnowledgeRetestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  title: z.string().trim().min(1).max(160),
  method: z.string().trim().min(1).max(120),
  scheduledAt: z.string().datetime().nullable().optional(),
  knowledgePointIds: z.array(z.string().min(1)).min(1).max(100),
});

const knowledgeRetestCommandSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedRevision: z.number().int().positive(),
});

export const startKnowledgeRetestSchema = knowledgeRetestCommandSchema;

export const submitKnowledgeRetestSchema = knowledgeRetestCommandSchema.extend({
  points: z.array(z.object({
    pointId: z.string().min(1),
    result: z.enum(["PASSED", "PARTIAL", "FAILED"]),
    score: z.number().min(0).max(100).nullable().optional(),
    understanding: z.number().int().min(1).max(4).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })).min(1).max(100),
  summary: z.string().trim().min(1).max(4000),
  reviewText: z.string().trim().min(1).max(4000),
});

export const confirmKnowledgeRetestSchema = knowledgeRetestCommandSchema;

const reviewContentSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  lostControl: z.string().trim().max(2000).optional(),
  keepAction: z.string().trim().min(1).max(1000),
  tomorrowMinimum: z.string().trim().min(1).max(1000),
  mood: z.string().trim().max(120).optional(),
});

export const saveTodayReviewSchema = reviewContentSchema.extend({
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const saveReviewSchema = reviewContentSchema.extend({
  idempotencyKey: idempotencyKeySchema,
});

export const updateReviewSchema = reviewContentSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  expectedRevision: z.number().int().min(1),
});

export const createMotivationItemSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  type: z.enum(["QUOTE", "VIDEO_LINK", "VAULT_EXCERPT"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(4000).nullable().optional(),
  externalUrl: z.string().trim().url().nullable().optional(),
  vaultSourceId: z.string().min(1).nullable().optional(),
  vaultField: z.enum(["whyStarted", "neverReturnTo", "futureSelf", "messageToFuture", "firstSimulationDiary"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export const updateMotivationItemSchema = z.object({
  expectedRevision: z.number().int().min(1),
  title: z.string().trim().min(1).max(160).optional(),
  body: z.string().trim().max(4000).nullable().optional(),
  externalUrl: z.string().trim().url().nullable().optional(),
  vaultSourceId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export const archiveMotivationItemSchema = z.object({
  expectedRevision: z.number().int().min(1),
});

export const studyResourceRevisionCommandSchema = z.object({
  expectedRevision: z.number().int().min(1),
});

export const reorderMotivationItemsSchema = z.object({
  order: z.array(z.object({
    id: z.string().min(1),
    expectedRevision: z.number().int().min(1),
  })).max(500),
});

export const motivationReminderStateSchema = z.object({
  expectedRevision: z.number().int().min(0),
  shownItemId: z.string().min(1),
});

export const patchNotificationPreferencesSchema = z.object({
  expectedRevision: z.number().int().min(0),
  reviewDueEnabled: z.boolean().optional(),
  planStartEnabled: z.boolean().optional(),
  eveningReviewEnabled: z.boolean().optional(),
  reviewDueWindowStart: z.number().int().min(0).max(23).optional(),
  reviewDueWindowEnd: z.number().int().min(0).max(23).optional(),
  planStartWindowStart: z.number().int().min(0).max(23).optional(),
  planStartWindowEnd: z.number().int().min(0).max(23).optional(),
  eveningReviewWindowStart: z.number().int().min(0).max(23).optional(),
  eveningReviewWindowEnd: z.number().int().min(0).max(23).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
});

export const patchAiProviderPreferenceSchema = z.object({
  externalProviderEnabled: z.boolean(),
}).strict();

export const patchAiProviderCredentialSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(4096).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict();

export const patchAiRuntimeSettingSchema = z.object({
  enabled: z.boolean(),
  expectedRevision: z.number().int().min(0).optional(),
}).strict();

export const testAiProviderSchema = z.object({}).strict();

export const testNotificationSchema = z.object({
  category: z.enum(["review", "plan", "evening"]).default("review"),
});
