-- v1.5-R: close the additive owner lineage compatibility window.
-- Fail closed before changing the constraint if any task is still ownerless.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "StudyTask" WHERE "ownerUserId" IS NULL) THEN
        RAISE EXCEPTION 'v1.5-R StudyTask owner cleanup found ownerless rows';
    END IF;
END $$;

ALTER TABLE "StudyTask" ALTER COLUMN "ownerUserId" SET NOT NULL;
