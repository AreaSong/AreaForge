-- Reconcile a local database that recorded the device-presence migration before
-- the table statement was present in the working migration file.
CREATE TABLE IF NOT EXISTS "StudySessionDevicePresence" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "deviceId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySessionDevicePresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudySessionDevicePresence_sessionId_deviceId_key"
ON "StudySessionDevicePresence" ("sessionId", "deviceId");
CREATE INDEX IF NOT EXISTS "StudySessionDevicePresence_sessionId_lastSeenAt_idx"
ON "StudySessionDevicePresence" ("sessionId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "StudySessionDevicePresence_userId_lastSeenAt_idx"
ON "StudySessionDevicePresence" ("userId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "StudySessionDevicePresence_workspaceId_lastSeenAt_idx"
ON "StudySessionDevicePresence" ("workspaceId", "lastSeenAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'StudySessionDevicePresence_sessionId_fkey'
    ) THEN
        ALTER TABLE "StudySessionDevicePresence"
          ADD CONSTRAINT "StudySessionDevicePresence_sessionId_fkey"
          FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'StudySessionDevicePresence_userId_fkey'
    ) THEN
        ALTER TABLE "StudySessionDevicePresence"
          ADD CONSTRAINT "StudySessionDevicePresence_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'StudySessionDevicePresence_workspaceId_fkey'
    ) THEN
        ALTER TABLE "StudySessionDevicePresence"
          ADD CONSTRAINT "StudySessionDevicePresence_workspaceId_fkey"
          FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
