-- Additive relation: a task may cover multiple independent knowledge points.
CREATE TABLE "StudyTaskKnowledgePoint" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyTaskKnowledgePoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyTaskKnowledgePoint_taskId_knowledgePointId_key"
ON "StudyTaskKnowledgePoint"("taskId", "knowledgePointId");

CREATE INDEX "StudyTaskKnowledgePoint_knowledgePointId_idx"
ON "StudyTaskKnowledgePoint"("knowledgePointId");

CREATE INDEX "StudyTaskKnowledgePoint_taskId_idx"
ON "StudyTaskKnowledgePoint"("taskId");

ALTER TABLE "StudyTaskKnowledgePoint"
ADD CONSTRAINT "StudyTaskKnowledgePoint_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyTaskKnowledgePoint"
ADD CONSTRAINT "StudyTaskKnowledgePoint_knowledgePointId_fkey"
FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
