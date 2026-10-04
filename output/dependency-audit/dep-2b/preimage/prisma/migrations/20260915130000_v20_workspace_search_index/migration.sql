ALTER TYPE "DataJobKind" ADD VALUE 'SEARCH_INDEX_REBUILD';

CREATE TABLE "WorkspaceSearchPartition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "publishedGeneration" INTEGER,
    "sourceFingerprint" TEXT,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceSearchPartition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceSearchPartition_generation_check" CHECK (
      "generation" >= 0 AND "documentCount" BETWEEN 0 AND 10000
      AND (("publishedGeneration" IS NULL AND "sourceFingerprint" IS NULL AND "indexedAt" IS NULL AND "documentCount"=0)
        OR ("publishedGeneration" IS NOT NULL AND "sourceFingerprint" IS NOT NULL
          AND "publishedGeneration" BETWEEN 1 AND "generation" AND "sourceFingerprint" ~ '^sha256:[a-f0-9]{64}$' AND "indexedAt" IS NOT NULL))
    )
);

CREATE TABLE "WorkspaceSearchDocument" (
    "id" TEXT NOT NULL,
    "partitionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceRevision" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "subjectId" TEXT,
    "taskId" TEXT,
    "knowledgePointId" TEXT,
    "noteId" TEXT,
    "mistakeId" TEXT,
    "resourceId" TEXT,
    CONSTRAINT "WorkspaceSearchDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceSearchDocument_source_check" CHECK (
      "generation" > 0 AND octet_length("title") <= 8192
      AND num_nonnulls("subjectId", "taskId", "knowledgePointId", "noteId", "mistakeId", "resourceId")=1
      AND "kind" IN ('SUBJECT','TASK','KNOWLEDGE_POINT','NOTE','MISTAKE','RESOURCE')
      AND "sourceId" = CASE "kind"
        WHEN 'SUBJECT' THEN "subjectId" WHEN 'TASK' THEN "taskId" WHEN 'KNOWLEDGE_POINT' THEN "knowledgePointId"
        WHEN 'NOTE' THEN "noteId" WHEN 'MISTAKE' THEN "mistakeId" WHEN 'RESOURCE' THEN "resourceId" END
      AND CASE "kind"
        WHEN 'SUBJECT' THEN "subjectId" WHEN 'TASK' THEN "taskId" WHEN 'KNOWLEDGE_POINT' THEN "knowledgePointId"
        WHEN 'NOTE' THEN "noteId" WHEN 'MISTAKE' THEN "mistakeId" WHEN 'RESOURCE' THEN "resourceId" END IS NOT NULL
    )
);

CREATE UNIQUE INDEX "WorkspaceSearchPartition_userId_workspaceId_key" ON "WorkspaceSearchPartition"("userId", "workspaceId");
CREATE UNIQUE INDEX "WorkspaceSearchPartition_id_workspaceId_key" ON "WorkspaceSearchPartition"("id", "workspaceId");
CREATE INDEX "WorkspaceSearchPartition_workspaceId_idx" ON "WorkspaceSearchPartition"("workspaceId");
CREATE UNIQUE INDEX "WorkspaceSearchDocument_scope_source_key" ON "WorkspaceSearchDocument"("partitionId", "generation", "kind", "sourceId");
CREATE INDEX "WorkspaceSearchDocument_partitionId_generation_kind_idx" ON "WorkspaceSearchDocument"("partitionId", "generation", "kind");
CREATE INDEX "WorkspaceSearchDocument_subjectId_idx" ON "WorkspaceSearchDocument"("subjectId");
CREATE INDEX "WorkspaceSearchDocument_taskId_idx" ON "WorkspaceSearchDocument"("taskId");
CREATE INDEX "WorkspaceSearchDocument_knowledgePointId_idx" ON "WorkspaceSearchDocument"("knowledgePointId");
CREATE INDEX "WorkspaceSearchDocument_noteId_idx" ON "WorkspaceSearchDocument"("noteId");
CREATE INDEX "WorkspaceSearchDocument_mistakeId_idx" ON "WorkspaceSearchDocument"("mistakeId");
CREATE INDEX "WorkspaceSearchDocument_resourceId_idx" ON "WorkspaceSearchDocument"("resourceId");

ALTER TABLE "WorkspaceSearchPartition" ADD CONSTRAINT "WorkspaceSearchPartition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchPartition" ADD CONSTRAINT "WorkspaceSearchPartition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchDocument" ADD CONSTRAINT "WorkspaceSearchDocument_partitionId_workspaceId_fkey" FOREIGN KEY ("partitionId", "workspaceId") REFERENCES "WorkspaceSearchPartition"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchDocument" ADD CONSTRAINT "WorkspaceSearchDocument_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchDocument" ADD CONSTRAINT "WorkspaceSearchDocument_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchDocument" ADD CONSTRAINT "WorkspaceSearchDocument_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchDocument" ADD CONSTRAINT "WorkspaceSearchDocument_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchDocument" ADD CONSTRAINT "WorkspaceSearchDocument_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "Mistake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSearchDocument" ADD CONSTRAINT "WorkspaceSearchDocument_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既有 migration 只为当时的表安装过 guard，新派生表也必须受同一冻结协议保护。
CREATE TRIGGER areaforge_delete_fence BEFORE INSERT OR UPDATE OR DELETE ON "WorkspaceSearchPartition"
FOR EACH ROW EXECUTE FUNCTION areaforge_delete_fence_guard();
CREATE TRIGGER areaforge_delete_fence BEFORE INSERT OR UPDATE OR DELETE ON "WorkspaceSearchDocument"
FOR EACH ROW EXECUTE FUNCTION areaforge_delete_fence_guard();

-- 分区 FK 引用了复合 unique，而 fence 只保存主键 id；不放宽全局 guard，补新表的精确父分区检查。
CREATE FUNCTION areaforge_search_partition_fence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(718420260913);
  IF EXISTS (SELECT 1 FROM "DataDeletionFence" f WHERE f.model='WorkspaceSearchPartition' AND f."keyJson"->>'id'=NEW."partitionId") THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='SEARCH_INDEX_PARTITION_FROZEN';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF EXISTS (SELECT 1 FROM "DataDeletionFence" f WHERE f.model='WorkspaceSearchPartition' AND f."keyJson"->>'id'=OLD."partitionId") THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='SEARCH_INDEX_PARTITION_FROZEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER areaforge_search_partition_fence BEFORE INSERT OR UPDATE ON "WorkspaceSearchDocument"
FOR EACH ROW EXECUTE FUNCTION areaforge_search_partition_fence_guard();
