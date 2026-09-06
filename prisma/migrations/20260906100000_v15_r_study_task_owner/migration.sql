-- v1.5-R: establish a stable StudyTask owner for member-scoped task writes.
--
-- The column is intentionally nullable for this additive compatibility
-- migration. Existing task writers outside the v1.5-R surface still create
-- legacy rows without an actor; those rows remain readable only through the
-- legacy workspace path until their writer is upgraded. Every v1.5-R write
-- must provide ownerUserId explicitly.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "StudyTask" AS task
        LEFT JOIN "Subject" AS subject ON subject."id" = task."subjectId"
        LEFT JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
        WHERE workspace."userId" IS NULL
    ) THEN
        RAISE EXCEPTION 'v1.5-R StudyTask owner preimage is ambiguous';
    END IF;
END $$;

ALTER TABLE "StudyTask" ADD COLUMN "ownerUserId" TEXT;

UPDATE "StudyTask" AS task
SET "ownerUserId" = workspace."userId"
FROM "Subject" AS subject
JOIN "ExamWorkspace" AS workspace ON workspace."id" = subject."workspaceId"
WHERE subject."id" = task."subjectId"
  AND task."ownerUserId" IS NULL;

ALTER TABLE "StudyTask"
    ADD CONSTRAINT "StudyTask_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "StudyTask_ownerUserId_plannedDate_idx"
    ON "StudyTask"("ownerUserId", "plannedDate");
