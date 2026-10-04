CREATE TABLE "LearningTreeExportGrant" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectKey" TEXT,
    "rootNodeKey" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "rootRevision" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningTreeExportGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningTreeExportGrant_nonce_key" ON "LearningTreeExportGrant"("nonce");
CREATE INDEX "LearningTreeExportGrant_actorId_expiresAt_idx" ON "LearningTreeExportGrant"("actorId", "expiresAt");
CREATE INDEX "LearningTreeExportGrant_workspaceId_expiresAt_idx" ON "LearningTreeExportGrant"("workspaceId", "expiresAt");
CREATE INDEX "LearningTreeExportGrant_consumedAt_idx" ON "LearningTreeExportGrant"("consumedAt");

ALTER TABLE "LearningTreeExportGrant" ADD CONSTRAINT "LearningTreeExportGrant_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningTreeExportGrant" ADD CONSTRAINT "LearningTreeExportGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
