import { z } from "zod";

export const createTaskSchema = z.object({
  subjectId: z.string().min(1),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40).default("study"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  plannedDate: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(5).max(720).default(45),
});

export const createSyllabusNodeSchema = z.object({
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

export const importSyllabusMarkdownSchema = z.object({
  subjectId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  markdown: z.string().trim().min(1).max(20000),
});

export const updateSyllabusNodeSchema = z.object({
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

export const createNoteSchema = z.object({
  subjectId: z.string().min(1),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(10000),
  masteryStatus: z.enum(["understood", "partial", "unknown", "relearn", "before_exam"]).nullable().optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

export const createMistakeSchema = z.object({
  subjectId: z.string().min(1),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(180),
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
    .default("unknown"),
  correctIdea: z.string().trim().max(3000).nullable().optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

export const updateMistakeSchema = z.object({
  subjectId: z.string().min(1).optional(),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(180).optional(),
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
  correctIdea: z.string().trim().max(3000).nullable().optional(),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

const motivationTextSchema = z.string().trim().max(3000).optional();

export const saveMotivationVaultSchema = z
  .object({
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
  firstSimulationDiary: z.string().trim().min(1).max(5000),
});

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
  subjectId: z.string().min(1).optional(),
  syllabusNodeId: z.string().min(1).nullable().optional(),
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
    subjectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    syllabusNodeId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => value.subjectId || value.taskId, {
    message: "subjectId or taskId is required",
  });

export const endSessionSchema = z.object({
  qualityScore: z.number().int().min(1).max(5),
  isEffective: z.boolean(),
  understandingLevel: z.string().trim().min(1).max(80),
  minimalOutput: z.string().trim().min(1).max(1000),
  nextAction: z.string().trim().min(1).max(500),
  producedNote: z.boolean().default(false),
  producedMistake: z.boolean().default(false),
  note: z.string().trim().max(2000).optional(),
  completeTask: z.boolean().default(false),
});

export const saveReviewSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  lostControl: z.string().trim().max(2000).optional(),
  keepAction: z.string().trim().min(1).max(1000),
  tomorrowMinimum: z.string().trim().min(1).max(1000),
  mood: z.string().trim().max(120).optional(),
});
