-- v1.1 Migration 4: StudyResource with FILE/LINK exactly-one constraints

CREATE TYPE "StudyResourceSourceType" AS ENUM ('FILE', 'LINK');
CREATE TYPE "StudyResourceCategory" AS ENUM (
  'TEXTBOOK',
  'COURSE',
  'EXERCISE',
  'PAST_PAPER',
  'SOLUTION',
  'SUMMARY',
  'IMAGE',
  'OTHER'
);

CREATE TABLE "StudyResource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "StudyResourceCategory" NOT NULL DEFAULT 'OTHER',
    "sourceType" "StudyResourceSourceType" NOT NULL,
    "subjectId" TEXT,
    "attachmentId" TEXT,
    "externalUrl" TEXT,
    "displayHost" TEXT,
    "duplicateOfResourceId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyResource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudyResource_source_exactly_one_check" CHECK (
      (
        "sourceType" = 'FILE'
        AND "attachmentId" IS NOT NULL
        AND "externalUrl" IS NULL
        AND "displayHost" IS NULL
      )
      OR (
        "sourceType" = 'LINK'
        AND "externalUrl" IS NOT NULL
        AND "attachmentId" IS NULL
        AND "duplicateOfResourceId" IS NULL
      )
    ),
    CONSTRAINT "StudyResource_no_self_duplicate_check" CHECK (
      "duplicateOfResourceId" IS NULL OR "duplicateOfResourceId" <> "id"
    )
);

CREATE UNIQUE INDEX "StudyResource_workspaceId_stableKey_key" ON "StudyResource"("workspaceId", "stableKey");
CREATE UNIQUE INDEX "StudyResource_attachmentId_key" ON "StudyResource"("attachmentId");
CREATE INDEX "StudyResource_workspaceId_idx" ON "StudyResource"("workspaceId");
CREATE INDEX "StudyResource_subjectId_idx" ON "StudyResource"("subjectId");
CREATE INDEX "StudyResource_sourceType_idx" ON "StudyResource"("sourceType");
CREATE INDEX "StudyResource_archivedAt_idx" ON "StudyResource"("archivedAt");
CREATE INDEX "StudyResource_duplicateOfResourceId_idx" ON "StudyResource"("duplicateOfResourceId");

ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_duplicateOfResourceId_fkey" FOREIGN KEY ("duplicateOfResourceId") REFERENCES "StudyResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StudyResourceTag" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "tagNorm" TEXT NOT NULL,
    "tagDisplay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyResourceTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyResourceTag_resourceId_tagNorm_key" ON "StudyResourceTag"("resourceId", "tagNorm");
CREATE INDEX "StudyResourceTag_resourceId_idx" ON "StudyResourceTag"("resourceId");
ALTER TABLE "StudyResourceTag" ADD CONSTRAINT "StudyResourceTag_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudyResourceTaskLink" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyResourceTaskLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyResourceTaskLink_resourceId_taskId_key" ON "StudyResourceTaskLink"("resourceId", "taskId");
CREATE INDEX "StudyResourceTaskLink_taskId_idx" ON "StudyResourceTaskLink"("taskId");
ALTER TABLE "StudyResourceTaskLink" ADD CONSTRAINT "StudyResourceTaskLink_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyResourceTaskLink" ADD CONSTRAINT "StudyResourceTaskLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudyResourceNoteLink" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyResourceNoteLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyResourceNoteLink_resourceId_noteId_key" ON "StudyResourceNoteLink"("resourceId", "noteId");
CREATE INDEX "StudyResourceNoteLink_noteId_idx" ON "StudyResourceNoteLink"("noteId");
ALTER TABLE "StudyResourceNoteLink" ADD CONSTRAINT "StudyResourceNoteLink_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyResourceNoteLink" ADD CONSTRAINT "StudyResourceNoteLink_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudyResourceMistakeLink" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "mistakeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyResourceMistakeLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyResourceMistakeLink_resourceId_mistakeId_key" ON "StudyResourceMistakeLink"("resourceId", "mistakeId");
CREATE INDEX "StudyResourceMistakeLink_mistakeId_idx" ON "StudyResourceMistakeLink"("mistakeId");
ALTER TABLE "StudyResourceMistakeLink" ADD CONSTRAINT "StudyResourceMistakeLink_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyResourceMistakeLink" ADD CONSTRAINT "StudyResourceMistakeLink_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "Mistake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudyResourceSyllabusNodeLink" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "syllabusNodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyResourceSyllabusNodeLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyResourceSyllabusNodeLink_resourceId_syllabusNodeId_key" ON "StudyResourceSyllabusNodeLink"("resourceId", "syllabusNodeId");
CREATE INDEX "StudyResourceSyllabusNodeLink_syllabusNodeId_idx" ON "StudyResourceSyllabusNodeLink"("syllabusNodeId");
ALTER TABLE "StudyResourceSyllabusNodeLink" ADD CONSTRAINT "StudyResourceSyllabusNodeLink_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "StudyResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyResourceSyllabusNodeLink" ADD CONSTRAINT "StudyResourceSyllabusNodeLink_syllabusNodeId_fkey" FOREIGN KEY ("syllabusNodeId") REFERENCES "SyllabusNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
