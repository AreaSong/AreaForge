-- Freeze the timer at the moment the user enters closeout. A CLOSING session
-- remains the user's single active session until the closeout is submitted.
ALTER TYPE "StudySessionStatus" ADD VALUE 'CLOSING';

DROP INDEX IF EXISTS "StudySession_one_active_per_user_idx";
DROP INDEX IF EXISTS "StudySession_one_legacy_active_idx";

CREATE UNIQUE INDEX "StudySession_one_active_per_user_idx"
ON "StudySession" ("userId")
WHERE "status" IN ('RUNNING', 'PAUSED', 'CLOSING') AND "userId" IS NOT NULL;

CREATE UNIQUE INDEX "StudySession_one_legacy_active_idx"
ON "StudySession" ((1))
WHERE "status" IN ('RUNNING', 'PAUSED', 'CLOSING') AND "userId" IS NULL;
