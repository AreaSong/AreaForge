-- v1.5-R: separate shared workspace structure from member-owned learning state.
-- This migration is additive-first. Legacy SyllabusNode progress columns remain
-- available for application rollback; ambiguous ownership fails closed.

ALTER TABLE "ReviewSchedule" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "MasteryConditionRecord" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "MasteryEvidence" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "MasteryRetest" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "SimulationExam" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "StagePlan" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "StageAdjustmentDraft" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "PeriodicReportDecision" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "PlanMilestone" ADD COLUMN "ownerUserId" TEXT;

-- A schedule for an owned target belongs to that target owner. Syllabus-node
-- schedules use the recorded actor, falling back to the legacy workspace owner.
UPDATE "ReviewSchedule" AS schedule
SET "ownerUserId" = note."ownerUserId"
FROM "Note" AS note
WHERE schedule."targetType" = 'NOTE'
  AND note."id" = schedule."noteId";

UPDATE "ReviewSchedule" AS schedule
SET "ownerUserId" = mistake."ownerUserId"
FROM "Mistake" AS mistake
WHERE schedule."targetType" = 'MISTAKE'
  AND mistake."id" = schedule."mistakeId";

UPDATE "ReviewSchedule" AS schedule
SET "ownerUserId" = resource."ownerUserId"
FROM "StudyResource" AS resource
WHERE schedule."targetType" = 'STUDY_RESOURCE'
  AND resource."id" = schedule."studyResourceId";

UPDATE "ReviewSchedule" AS schedule
SET "ownerUserId" = COALESCE(schedule."actorId", workspace."userId")
FROM "ExamWorkspace" AS workspace
WHERE schedule."targetType" = 'SYLLABUS_NODE'
  AND workspace."id" = schedule."workspaceId";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "ReviewSchedule" WHERE "ownerUserId" IS NULL) THEN
        RAISE EXCEPTION 'v1.5-R review schedule owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "ReviewSchedule"
        WHERE "actorId" IS NOT NULL
          AND "actorId" IS DISTINCT FROM "ownerUserId"
    ) THEN
        RAISE EXCEPTION 'v1.5-R review schedule actor conflicts with target owner';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "ReviewEvent" AS event
        JOIN "ReviewSchedule" AS schedule ON schedule."id" = event."reviewScheduleId"
        WHERE event."actorId" IS NULL
           OR event."actorId" IS DISTINCT FROM schedule."ownerUserId"
    ) THEN
        RAISE EXCEPTION 'v1.5-R review event owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "StudyTask" AS task
        JOIN "ReviewSchedule" AS schedule ON schedule."id" = task."reviewScheduleId"
        WHERE task."ownerUserId" IS NULL
           OR task."ownerUserId" IS DISTINCT FROM schedule."ownerUserId"
    ) THEN
        RAISE EXCEPTION 'v1.5-R review bridge task owner conflicts with schedule owner';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "StudySession" AS session
        JOIN "ReviewSchedule" AS schedule ON schedule."id" = session."reviewScheduleId"
        WHERE session."userId" IS DISTINCT FROM schedule."ownerUserId"
    ) THEN
        RAISE EXCEPTION 'v1.5-R review session owner conflicts with schedule owner';
    END IF;
END $$;

-- Mastery rows are personal. Historical actorId is the strongest owner signal;
-- null legacy actors fall back only through the node's workspace owner.
UPDATE "MasteryConditionRecord" AS record
SET "ownerUserId" = COALESCE(record."actorId", workspace."userId")
FROM "SyllabusNode" AS node
JOIN "Subject" AS subject ON subject."id" = node."subjectId"
JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
WHERE node."id" = record."syllabusNodeId";

UPDATE "MasteryRetest" AS retest
SET "ownerUserId" = COALESCE(
    retest."actorId",
    (
        SELECT event."actorId"
        FROM "ReviewEvent" AS event
        WHERE event."id" = retest."reviewEventId"
    ),
    (
        SELECT schedule."ownerUserId"
        FROM "ReviewEvent" AS event
        JOIN "ReviewSchedule" AS schedule ON schedule."id" = event."reviewScheduleId"
        WHERE event."id" = retest."reviewEventId"
    ),
    workspace."userId"
)
FROM "SyllabusNode" AS node
JOIN "Subject" AS subject ON subject."id" = node."subjectId"
JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
WHERE node."id" = retest."syllabusNodeId";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "MasteryRetest" AS retest
        LEFT JOIN "ReviewEvent" AS event ON event."id" = retest."reviewEventId"
        LEFT JOIN "ReviewSchedule" AS schedule ON schedule."id" = event."reviewScheduleId"
        WHERE retest."ownerUserId" IS NULL
           OR (retest."actorId" IS NOT NULL AND retest."actorId" IS DISTINCT FROM retest."ownerUserId")
           OR (event."actorId" IS NOT NULL AND event."actorId" IS DISTINCT FROM retest."ownerUserId")
           OR (schedule."ownerUserId" IS NOT NULL AND schedule."ownerUserId" IS DISTINCT FROM retest."ownerUserId")
    ) THEN
        RAISE EXCEPTION 'v1.5-R mastery retest owner preimage is ambiguous';
    END IF;
END $$;

UPDATE "MasteryEvidence" AS evidence
SET "ownerUserId" = COALESCE(
    evidence."actorId",
    (SELECT task."ownerUserId" FROM "StudyTask" AS task WHERE task."id" = evidence."taskId"),
    (SELECT session."userId" FROM "StudySession" AS session WHERE session."id" = evidence."sessionId"),
    (SELECT note."ownerUserId" FROM "Note" AS note WHERE note."id" = evidence."noteId"),
    (SELECT mistake."ownerUserId" FROM "Mistake" AS mistake WHERE mistake."id" = evidence."mistakeId"),
    (SELECT retest."ownerUserId" FROM "MasteryRetest" AS retest WHERE retest."id" = evidence."retestId"),
    workspace."userId"
)
FROM "SyllabusNode" AS node
JOIN "Subject" AS subject ON subject."id" = node."subjectId"
JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
WHERE node."id" = evidence."syllabusNodeId";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "MasteryConditionRecord"
        WHERE "ownerUserId" IS NULL
           OR ("actorId" IS NOT NULL AND "actorId" IS DISTINCT FROM "ownerUserId")
    ) THEN
        RAISE EXCEPTION 'v1.5-R mastery condition owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "MasteryEvidence" AS evidence
        LEFT JOIN "StudyTask" AS task ON task."id" = evidence."taskId"
        LEFT JOIN "StudySession" AS session ON session."id" = evidence."sessionId"
        LEFT JOIN "Note" AS note ON note."id" = evidence."noteId"
        LEFT JOIN "Mistake" AS mistake ON mistake."id" = evidence."mistakeId"
        LEFT JOIN "MasteryRetest" AS retest ON retest."id" = evidence."retestId"
        WHERE evidence."ownerUserId" IS NULL
           OR (evidence."actorId" IS NOT NULL AND evidence."actorId" IS DISTINCT FROM evidence."ownerUserId")
           OR (task."ownerUserId" IS NOT NULL AND task."ownerUserId" IS DISTINCT FROM evidence."ownerUserId")
           OR (session."userId" IS NOT NULL AND session."userId" IS DISTINCT FROM evidence."ownerUserId")
           OR (note."ownerUserId" IS NOT NULL AND note."ownerUserId" IS DISTINCT FROM evidence."ownerUserId")
           OR (mistake."ownerUserId" IS NOT NULL AND mistake."ownerUserId" IS DISTINCT FROM evidence."ownerUserId")
           OR (retest."ownerUserId" IS NOT NULL AND retest."ownerUserId" IS DISTINCT FROM evidence."ownerUserId")
    ) THEN
        RAISE EXCEPTION 'v1.5-R mastery evidence owner preimage is ambiguous';
    END IF;
END $$;

-- Legacy stage/simulation rows were owner-only. Global rows can only be
-- assigned when exactly one user exists; multi-user global preimages fail.
UPDATE "StagePlan" AS plan
SET "ownerUserId" = workspace."userId"
FROM "ExamWorkspace" AS workspace
WHERE workspace."id" = plan."workspaceId";

UPDATE "PeriodicReportDecision" AS decision
SET "ownerUserId" = COALESCE(decision."actorId", workspace."userId")
FROM "ExamWorkspace" AS workspace
WHERE workspace."id" = decision."workspaceId";

UPDATE "SimulationExam" AS exam
SET "ownerUserId" = workspace."userId"
FROM "ExamWorkspace" AS workspace
WHERE workspace."id" = exam."workspaceId";

DO $$
DECLARE
    only_user_id TEXT;
    user_count INTEGER;
BEGIN
    SELECT COUNT(*), MIN("id") INTO user_count, only_user_id FROM "User";
    IF user_count = 1 THEN
        UPDATE "StagePlan" SET "ownerUserId" = only_user_id WHERE "ownerUserId" IS NULL;
        UPDATE "PeriodicReportDecision"
        SET "ownerUserId" = COALESCE("actorId", only_user_id)
        WHERE "ownerUserId" IS NULL;
        UPDATE "SimulationExam" SET "ownerUserId" = only_user_id WHERE "ownerUserId" IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM "StagePlan" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "PeriodicReportDecision" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "SimulationExam" WHERE "ownerUserId" IS NULL) THEN
        RAISE EXCEPTION 'v1.5-R cannot infer owner for global learning state in a multi-user preimage';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PeriodicReportDecision"
        WHERE "actorId" IS NOT NULL
          AND "actorId" IS DISTINCT FROM "ownerUserId"
    ) THEN
        RAISE EXCEPTION 'v1.5-R report decision actor conflicts with owner';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "StudySession" AS session
        JOIN "SimulationExam" AS exam ON exam."id" = session."simulationExamId"
        WHERE session."userId" IS DISTINCT FROM exam."ownerUserId"
    ) THEN
        RAISE EXCEPTION 'v1.5-R simulation session owner conflicts with exam owner';
    END IF;
END $$;

UPDATE "PlanMilestone" AS milestone
SET "ownerUserId" = plan."ownerUserId"
FROM "StagePlan" AS plan
WHERE plan."id" = milestone."stagePlanId";

UPDATE "StageAdjustmentDraft" AS draft
SET "ownerUserId" = COALESCE(
    draft."actorId",
    (SELECT plan."ownerUserId" FROM "StagePlan" AS plan WHERE plan."id" = draft."stagePlanId"),
    (SELECT decision."ownerUserId" FROM "PeriodicReportDecision" AS decision WHERE decision."id" = draft."sourceReportDecisionId"),
    workspace."userId"
)
FROM "ExamWorkspace" AS workspace
WHERE workspace."id" = draft."workspaceId";

UPDATE "StageAdjustmentDraft" AS draft
SET "ownerUserId" = COALESCE(
    draft."actorId",
    plan."ownerUserId",
    (SELECT decision."ownerUserId" FROM "PeriodicReportDecision" AS decision WHERE decision."id" = draft."sourceReportDecisionId")
)
FROM "StagePlan" AS plan
WHERE draft."ownerUserId" IS NULL
  AND plan."id" = draft."stagePlanId";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "PlanMilestone" WHERE "ownerUserId" IS NULL)
       OR EXISTS (SELECT 1 FROM "StageAdjustmentDraft" WHERE "ownerUserId" IS NULL) THEN
        RAISE EXCEPTION 'v1.5-R stage state owner preimage is ambiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PlanMilestone" AS milestone
        JOIN "StagePlan" AS plan ON plan."id" = milestone."stagePlanId"
        WHERE milestone."workspaceId" IS DISTINCT FROM plan."workspaceId"
           OR milestone."ownerUserId" IS DISTINCT FROM plan."ownerUserId"
    ) THEN
        RAISE EXCEPTION 'v1.5-R milestone owner conflicts with stage plan owner';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "StageAdjustmentDraft" AS draft
        LEFT JOIN "StagePlan" AS plan ON plan."id" = draft."stagePlanId"
        LEFT JOIN "PeriodicReportDecision" AS decision ON decision."id" = draft."sourceReportDecisionId"
        WHERE (draft."actorId" IS NOT NULL AND draft."actorId" IS DISTINCT FROM draft."ownerUserId")
           OR (plan."ownerUserId" IS NOT NULL AND plan."ownerUserId" IS DISTINCT FROM draft."ownerUserId")
           OR (decision."ownerUserId" IS NOT NULL AND decision."ownerUserId" IS DISTINCT FROM draft."ownerUserId")
    ) THEN
        RAISE EXCEPTION 'v1.5-R stage adjustment owner preimage is ambiguous';
    END IF;
END $$;

-- Shared syllabus structure keeps its existing fields for rollback. The
-- workspace owner's legacy values seed the new personal progress projection.
CREATE TABLE "SyllabusNodeProgress" (
    "id" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" "SyllabusNodeStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "masteryLevel" "MasteryLevel",
    "targetMinutes" INTEGER NOT NULL DEFAULT 0,
    "actualMinutes" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusNodeProgress_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SyllabusNodeProgress" (
    "id", "syllabusNodeId", "ownerUserId", "status", "masteryLevel",
    "targetMinutes", "actualMinutes", "revision", "createdAt", "updatedAt"
)
SELECT
    'v15r-' || md5(node."id" || ':' || workspace."userId"),
    node."id",
    workspace."userId",
    node."status",
    node."masteryLevel",
    node."targetMinutes",
    node."actualMinutes",
    node."revision",
    node."createdAt",
    node."updatedAt"
FROM "SyllabusNode" AS node
JOIN "Subject" AS subject ON subject."id" = node."subjectId"
JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId";

INSERT INTO "SyllabusNodeProgress" (
    "id", "syllabusNodeId", "ownerUserId", "status", "masteryLevel",
    "targetMinutes", "actualMinutes", "revision", "createdAt", "updatedAt"
)
SELECT DISTINCT
    'v15r-' || md5(owner_rows."syllabusNodeId" || ':' || owner_rows."ownerUserId"),
    owner_rows."syllabusNodeId",
    owner_rows."ownerUserId",
    'NOT_STARTED'::"SyllabusNodeStatus",
    NULL::"MasteryLevel",
    0,
    0,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT "syllabusNodeId", "ownerUserId" FROM "MasteryConditionRecord"
    UNION
    SELECT "syllabusNodeId", "ownerUserId" FROM "MasteryEvidence"
    UNION
    SELECT "syllabusNodeId", "ownerUserId" FROM "MasteryRetest"
    UNION
    SELECT "syllabusNodeId", "ownerUserId" FROM "ReviewSchedule" WHERE "syllabusNodeId" IS NOT NULL
) AS owner_rows
WHERE NOT EXISTS (
    SELECT 1
    FROM "SyllabusNodeProgress" AS progress
    WHERE progress."syllabusNodeId" = owner_rows."syllabusNodeId"
      AND progress."ownerUserId" = owner_rows."ownerUserId"
);

-- Replace workspace-global uniqueness with member-scoped uniqueness.
DROP INDEX "ReviewSchedule_noteId_uidx";
DROP INDEX "ReviewSchedule_mistakeId_uidx";
DROP INDEX "ReviewSchedule_studyResourceId_uidx";
DROP INDEX "ReviewSchedule_syllabusNodeId_uidx";
CREATE UNIQUE INDEX "ReviewSchedule_owner_noteId_uidx"
    ON "ReviewSchedule"("ownerUserId", "noteId") WHERE "noteId" IS NOT NULL;
CREATE UNIQUE INDEX "ReviewSchedule_owner_mistakeId_uidx"
    ON "ReviewSchedule"("ownerUserId", "mistakeId") WHERE "mistakeId" IS NOT NULL;
CREATE UNIQUE INDEX "ReviewSchedule_owner_studyResourceId_uidx"
    ON "ReviewSchedule"("ownerUserId", "studyResourceId") WHERE "studyResourceId" IS NOT NULL;
CREATE UNIQUE INDEX "ReviewSchedule_owner_syllabusNodeId_uidx"
    ON "ReviewSchedule"("ownerUserId", "syllabusNodeId") WHERE "syllabusNodeId" IS NOT NULL;

DROP INDEX "MasteryConditionRecord_syllabusNodeId_condition_key";
CREATE UNIQUE INDEX "MasteryConditionRecord_syllabusNodeId_ownerUserId_condition_key"
    ON "MasteryConditionRecord"("syllabusNodeId", "ownerUserId", "condition");

DROP INDEX "StagePlan_one_current_per_workspace_idx";
CREATE UNIQUE INDEX "StagePlan_one_current_per_owner_workspace_idx"
    ON "StagePlan"("ownerUserId", "workspaceId")
    WHERE "workspaceId" IS NOT NULL AND "status" IN ('active', 'draft');

DROP INDEX "PlanMilestone_workspaceId_stableKey_key";
CREATE UNIQUE INDEX "PlanMilestone_workspaceId_ownerUserId_stableKey_key"
    ON "PlanMilestone"("workspaceId", "ownerUserId", "stableKey");

DROP INDEX "KnowledgeGroup_workspaceId_stableKey_key";
CREATE UNIQUE INDEX "KnowledgeGroup_workspaceId_userId_stableKey_key"
    ON "KnowledgeGroup"("workspaceId", "userId", "stableKey");

DROP INDEX "KnowledgePoint_workspaceId_stableKey_key";
CREATE UNIQUE INDEX "KnowledgePoint_workspaceId_userId_stableKey_key"
    ON "KnowledgePoint"("workspaceId", "userId", "stableKey");

ALTER TABLE "ReviewSchedule" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "MasteryConditionRecord" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "MasteryEvidence" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "MasteryRetest" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "SimulationExam" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "StagePlan" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "StageAdjustmentDraft" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "PeriodicReportDecision" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "PlanMilestone" ALTER COLUMN "ownerUserId" SET NOT NULL;

ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MasteryConditionRecord" ADD CONSTRAINT "MasteryConditionRecord_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MasteryEvidence" ADD CONSTRAINT "MasteryEvidence_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MasteryRetest" ADD CONSTRAINT "MasteryRetest_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SimulationExam" ADD CONSTRAINT "SimulationExam_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StagePlan" ADD CONSTRAINT "StagePlan_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StageAdjustmentDraft" ADD CONSTRAINT "StageAdjustmentDraft_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PeriodicReportDecision" ADD CONSTRAINT "PeriodicReportDecision_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanMilestone" ADD CONSTRAINT "PlanMilestone_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SyllabusNodeProgress" ADD CONSTRAINT "SyllabusNodeProgress_syllabusNodeId_fkey"
    FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyllabusNodeProgress" ADD CONSTRAINT "SyllabusNodeProgress_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SyllabusNodeProgress_syllabusNodeId_ownerUserId_key"
    ON "SyllabusNodeProgress"("syllabusNodeId", "ownerUserId");
CREATE INDEX "SyllabusNodeProgress_ownerUserId_status_idx"
    ON "SyllabusNodeProgress"("ownerUserId", "status");
CREATE INDEX "SyllabusNodeProgress_ownerUserId_masteryLevel_idx"
    ON "SyllabusNodeProgress"("ownerUserId", "masteryLevel");
CREATE INDEX "ReviewSchedule_ownerUserId_status_dueDate_idx"
    ON "ReviewSchedule"("ownerUserId", "status", "dueDate");
CREATE INDEX "MasteryConditionRecord_ownerUserId_idx"
    ON "MasteryConditionRecord"("ownerUserId");
CREATE INDEX "MasteryEvidence_ownerUserId_createdAt_idx"
    ON "MasteryEvidence"("ownerUserId", "createdAt");
CREATE INDEX "MasteryRetest_ownerUserId_testedAt_idx"
    ON "MasteryRetest"("ownerUserId", "testedAt");
CREATE INDEX "SimulationExam_ownerUserId_examDate_idx"
    ON "SimulationExam"("ownerUserId", "examDate");
CREATE INDEX "StagePlan_ownerUserId_status_idx"
    ON "StagePlan"("ownerUserId", "status");
CREATE INDEX "StageAdjustmentDraft_ownerUserId_status_idx"
    ON "StageAdjustmentDraft"("ownerUserId", "status");
CREATE INDEX "PeriodicReportDecision_ownerUserId_kind_rangeEnd_idx"
    ON "PeriodicReportDecision"("ownerUserId", "kind", "rangeEnd");
CREATE INDEX "PlanMilestone_ownerUserId_status_idx"
    ON "PlanMilestone"("ownerUserId", "status");
