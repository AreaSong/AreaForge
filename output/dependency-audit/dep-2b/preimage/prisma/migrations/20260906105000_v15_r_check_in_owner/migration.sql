-- v1.5-R: make CheckIn a per-user, per-workspace, per-learning-day projection.
-- Existing snapshots are only assigned when their owner can be inferred without
-- mixing another member's source facts. Ambiguous preimages fail closed.

ALTER TABLE "CheckIn" ADD COLUMN "ownerUserId" TEXT;

DO $$
DECLARE
    existing_user_count INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "CheckIn"
        WHERE "workspaceId" IS NULL
    ) THEN
        SELECT COUNT(*) INTO existing_user_count FROM "User";
        IF existing_user_count <> 1 THEN
            RAISE EXCEPTION 'v1.5-R cannot infer global CheckIn owner unless exactly one User exists';
        END IF;

        UPDATE "CheckIn"
        SET "ownerUserId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1)
        WHERE "workspaceId" IS NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "CheckIn" AS check_in
        JOIN "ExamWorkspace" AS workspace ON workspace."id" = check_in."workspaceId"
        WHERE EXISTS (
            SELECT 1
            FROM "StudySession" AS session
            JOIN "Subject" AS subject ON subject."id" = session."subjectId"
            WHERE subject."workspaceId" = check_in."workspaceId"
              AND session."startedAt" >= check_in."studyDate"
              AND session."startedAt" < check_in."studyDate" + INTERVAL '1 day'
              AND session."status" = 'COMPLETED'
              AND session."userId" IS DISTINCT FROM workspace."userId"
        ) OR EXISTS (
            SELECT 1
            FROM "StudyTask" AS task
            JOIN "Subject" AS subject ON subject."id" = task."subjectId"
            WHERE subject."workspaceId" = check_in."workspaceId"
              AND task."plannedDate" >= check_in."studyDate"
              AND task."plannedDate" < check_in."studyDate" + INTERVAL '1 day'
              AND task."ownerUserId" IS DISTINCT FROM workspace."userId"
        ) OR EXISTS (
            SELECT 1
            FROM "DailyReview" AS review
            WHERE review."workspaceId" = check_in."workspaceId"
              AND review."reviewDate" = check_in."studyDate"
              AND review."ownerUserId" IS DISTINCT FROM workspace."userId"
        ) OR EXISTS (
            SELECT 1
            FROM "ReviewEvent" AS event
            JOIN "ReviewSchedule" AS schedule ON schedule."id" = event."reviewScheduleId"
            WHERE schedule."workspaceId" = check_in."workspaceId"
              AND event."learningDate" = check_in."studyDate"
              AND event."actorId" IS DISTINCT FROM workspace."userId"
        )
    ) THEN
        RAISE EXCEPTION 'v1.5-R CheckIn preimage contains mixed or unknown member source facts';
    END IF;

    UPDATE "CheckIn" AS check_in
    SET "ownerUserId" = workspace."userId"
    FROM "ExamWorkspace" AS workspace
    WHERE workspace."id" = check_in."workspaceId"
      AND check_in."ownerUserId" IS NULL;

    IF EXISTS (SELECT 1 FROM "CheckIn" WHERE "ownerUserId" IS NULL) THEN
        RAISE EXCEPTION 'v1.5-R CheckIn owner preimage is ambiguous';
    END IF;
END $$;

DROP INDEX IF EXISTS "CheckIn_legacy_studyDate_uidx";
DROP INDEX IF EXISTS "CheckIn_workspace_studyDate_uidx";

ALTER TABLE "CheckIn" ALTER COLUMN "ownerUserId" SET NOT NULL;
ALTER TABLE "CheckIn"
    ADD CONSTRAINT "CheckIn_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CheckIn_owner_legacy_studyDate_uidx"
    ON "CheckIn"("ownerUserId", "studyDate")
    WHERE "workspaceId" IS NULL;

CREATE UNIQUE INDEX "CheckIn_owner_workspace_studyDate_uidx"
    ON "CheckIn"("ownerUserId", "workspaceId", "studyDate")
    WHERE "workspaceId" IS NOT NULL;

CREATE INDEX "CheckIn_ownerUserId_workspaceId_studyDate_idx"
    ON "CheckIn"("ownerUserId", "workspaceId", "studyDate");
