-- v1.1 Migration 5: SyllabusNode stableKey/revision + LearningTreeImportBatch/Item

ALTER TABLE "SyllabusNode" ADD COLUMN "stableKey" TEXT;
ALTER TABLE "SyllabusNode" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SyllabusNode" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "SyllabusNode_subjectId_stableKey_key" ON "SyllabusNode"("subjectId", "stableKey");
CREATE INDEX "SyllabusNode_archivedAt_idx" ON "SyllabusNode"("archivedAt");

CREATE TABLE "LearningTreeImportBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "canonicalMarkdown" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "canonicalPlanHash" TEXT NOT NULL,
    "rootRevision" INTEGER NOT NULL,
    "statsJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "previewNonce" TEXT NOT NULL,
    "previewOperationId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "actorId" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningTreeImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningTreeImportBatch_workspaceId_idempotencyKey_key" ON "LearningTreeImportBatch"("workspaceId", "idempotencyKey");
CREATE INDEX "LearningTreeImportBatch_workspaceId_confirmedAt_idx" ON "LearningTreeImportBatch"("workspaceId", "confirmedAt");
CREATE INDEX "LearningTreeImportBatch_actorId_idx" ON "LearningTreeImportBatch"("actorId");
CREATE INDEX "LearningTreeImportBatch_archivedAt_idx" ON "LearningTreeImportBatch"("archivedAt");
CREATE INDEX "LearningTreeImportBatch_previewNonce_idx" ON "LearningTreeImportBatch"("previewNonce");

ALTER TABLE "LearningTreeImportBatch" ADD CONSTRAINT "LearningTreeImportBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningTreeImportBatch" ADD CONSTRAINT "LearningTreeImportBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LearningTreeImportItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "stableRef" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "diffType" TEXT NOT NULL,
    "sourceLine" INTEGER,
    "sourceTargetKey" TEXT,
    "mappedTargetId" TEXT,
    "mappedTargetKey" TEXT,
    "userChoice" TEXT NOT NULL,
    "applyResult" TEXT NOT NULL,
    "redactedErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningTreeImportItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningTreeImportItem_batchId_idx" ON "LearningTreeImportItem"("batchId");
CREATE INDEX "LearningTreeImportItem_stableRef_idx" ON "LearningTreeImportItem"("stableRef");
CREATE INDEX "LearningTreeImportItem_objectType_idx" ON "LearningTreeImportItem"("objectType");

ALTER TABLE "LearningTreeImportItem" ADD CONSTRAINT "LearningTreeImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LearningTreeImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
