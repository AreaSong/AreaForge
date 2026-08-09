-- Track the coarse client that owns an active timer and its last heartbeat.
-- All fields are nullable so historical sessions remain readable unchanged.
ALTER TABLE "StudySession" ADD COLUMN "clientDeviceId" TEXT;
ALTER TABLE "StudySession" ADD COLUMN "clientDeviceLabel" TEXT;
ALTER TABLE "StudySession" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "StudySession_userId_clientDeviceId_lastHeartbeatAt_idx"
ON "StudySession" ("userId", "clientDeviceId", "lastHeartbeatAt");

CREATE TABLE "StudySessionDevicePresence" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "deviceId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySessionDevicePresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudySessionDevicePresence_sessionId_deviceId_key"
ON "StudySessionDevicePresence" ("sessionId", "deviceId");
CREATE INDEX "StudySessionDevicePresence_sessionId_lastSeenAt_idx"
ON "StudySessionDevicePresence" ("sessionId", "lastSeenAt");
CREATE INDEX "StudySessionDevicePresence_userId_lastSeenAt_idx"
ON "StudySessionDevicePresence" ("userId", "lastSeenAt");
CREATE INDEX "StudySessionDevicePresence_workspaceId_lastSeenAt_idx"
ON "StudySessionDevicePresence" ("workspaceId", "lastSeenAt");

ALTER TABLE "StudySessionDevicePresence"
ADD CONSTRAINT "StudySessionDevicePresence_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySessionDevicePresence"
ADD CONSTRAINT "StudySessionDevicePresence_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySessionDevicePresence"
ADD CONSTRAINT "StudySessionDevicePresence_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
