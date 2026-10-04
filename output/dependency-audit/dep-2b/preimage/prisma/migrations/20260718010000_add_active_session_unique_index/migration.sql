CREATE UNIQUE INDEX "StudySession_one_active_idx"
ON "StudySession" ((1))
WHERE "status" IN ('RUNNING', 'PAUSED');
