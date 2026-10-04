-- A new retest must not silently treat an unanswered knowledge point as partial.
-- Historical rows keep their existing result; only new submissions require an explicit value.
ALTER TABLE "KnowledgeRetestPoint"
  ALTER COLUMN "result" DROP NOT NULL;
