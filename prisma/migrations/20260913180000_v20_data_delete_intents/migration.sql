CREATE TABLE "DataDeletionIntent" (
  "id" TEXT NOT NULL PRIMARY KEY, "requesterId" TEXT NOT NULL, "scope" TEXT NOT NULL,
  "workspaceId" TEXT, "resourceType" TEXT, "resourceId" TEXT, "state" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL, "authorizationHash" TEXT NOT NULL, "schemaHash" TEXT NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL, "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "irreversibleAt" TIMESTAMP(3), "leaseOwner" TEXT, "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3), "attempt" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3), "executionPid" INTEGER, "errorCode" TEXT, "completedAt" TIMESTAMP(3),
  "receiptTokenHash" TEXT NOT NULL, "receiptExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataDeletionIntent_scope_check" CHECK (
    ("scope" = 'ACCOUNT' AND "workspaceId" IS NULL AND "resourceType" IS NULL AND "resourceId" IS NULL) OR
    ("scope" = 'WORKSPACE' AND "workspaceId" IS NOT NULL AND "resourceType" IS NULL AND "resourceId" IS NULL) OR
    ("scope" = 'RESOURCE' AND "workspaceId" IS NOT NULL AND "resourceType" IN ('Note','Mistake','StudyTask','StudyResource','KnowledgePoint') AND "resourceId" IS NOT NULL)),
  CONSTRAINT "DataDeletionIntent_state_check" CHECK ("state" IN ('COOLDOWN','TRASHED','RUNNING','RETRY_WAIT','FAILED','SUCCEEDED','CANCELLED','RESTORED')),
  CONSTRAINT "DataDeletionIntent_retention_check" CHECK ("availableAt" >= "frozenAt" + CASE WHEN "scope" = 'RESOURCE' THEN INTERVAL '30 days' ELSE INTERVAL '24 hours' END),
  CONSTRAINT "DataDeletionIntent_counters_check" CHECK ("revision" > 0 AND "leaseVersion" >= 0 AND "attempt" >= 0 AND "maxAttempts" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "DataDeletionIntent_requesterId_idempotencyKey_key" ON "DataDeletionIntent"("requesterId", "idempotencyKey");
CREATE INDEX "DataDeletionIntent_state_availableAt_nextAttemptAt_idx" ON "DataDeletionIntent"("state", "availableAt", "nextAttemptAt");
CREATE INDEX "DataDeletionIntent_requesterId_createdAt_idx" ON "DataDeletionIntent"("requesterId", "createdAt");

CREATE TABLE "DataDeletionItem" (
  "id" TEXT NOT NULL PRIMARY KEY, "intentId" TEXT NOT NULL, "model" TEXT NOT NULL,
  "keyJson" JSONB NOT NULL, "identityHash" TEXT NOT NULL, "rowHash" TEXT NOT NULL,
  CONSTRAINT "DataDeletionItem_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "DataDeletionIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DataDeletionItem_intentId_identityHash_key" ON "DataDeletionItem"("intentId", "identityHash");

CREATE TABLE "DataDeletionFence" (
  "id" TEXT NOT NULL PRIMARY KEY, "intentId" TEXT NOT NULL, "model" TEXT NOT NULL, "keyJson" JSONB NOT NULL, "identityHash" TEXT NOT NULL,
  CONSTRAINT "DataDeletionFence_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "DataDeletionIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DataDeletionFence_model_identityHash_key" ON "DataDeletionFence"("model", "identityHash");
CREATE INDEX "DataDeletionFence_intentId_idx" ON "DataDeletionFence"("intentId");

CREATE TABLE "DataDeletionFile" (
  "id" TEXT NOT NULL PRIMARY KEY, "intentId" TEXT NOT NULL, "identityHash" TEXT NOT NULL, "storageKind" TEXT NOT NULL,
  "storageKey" TEXT, "expectedHash" TEXT, "expectedSize" BIGINT, "phase" TEXT NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "DataDeletionFile_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "DataDeletionIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DataDeletionFile_phase_check" CHECK ("phase" IN ('PENDING','INTENT','REMOVED'))
);
CREATE UNIQUE INDEX "DataDeletionFile_intentId_identityHash_key" ON "DataDeletionFile"("intentId", "identityHash");

CREATE TABLE "DataDeletionLedger" (
  "sequence" BIGSERIAL NOT NULL PRIMARY KEY, "intentId" TEXT NOT NULL, "scope" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL, "previousHash" TEXT, "entryHash" TEXT NOT NULL, "manifest" JSONB NOT NULL, "completedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataDeletionLedger_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "DataDeletionIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DataDeletionLedger_intentId_key" ON "DataDeletionLedger"("intentId");
CREATE UNIQUE INDEX "DataDeletionLedger_entryHash_key" ON "DataDeletionLedger"("entryHash");

-- 普通写事务与建立冻结栅栏共用锁；栅栏建立之后不持有全局独占锁。
CREATE FUNCTION areaforge_delete_fence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate JSONB; blocked_intent TEXT; relation RECORD; parent_key JSONB; allowed_intent TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(718420260913::bigint);
  IF NOT EXISTS (SELECT 1 FROM "DataDeletionFence") THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'AuthSession' AND TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - ARRAY['lastSeenAt','reauthenticatedAt']) = (to_jsonb(OLD) - ARRAY['lastSeenAt','reauthenticatedAt'])
    THEN RETURN NEW; END IF;
  allowed_intent := current_setting('areaforge.delete_intent', true);
  FOREACH candidate IN ARRAY CASE WHEN TG_OP = 'UPDATE' THEN ARRAY[to_jsonb(OLD),to_jsonb(NEW)]
    ELSE ARRAY[to_jsonb(COALESCE(NEW,OLD))] END LOOP
    SELECT f."intentId" INTO blocked_intent FROM "DataDeletionFence" f
      WHERE f."model" = TG_TABLE_NAME AND candidate @> f."keyJson" LIMIT 1;
    IF blocked_intent IS NULL THEN
      FOR relation IN SELECT c.confrelid::regclass::text AS parent_name,
        array_agg(a.attname ORDER BY k.ordinality) AS child_columns,
        array_agg(b.attname ORDER BY k.ordinality) AS parent_columns
        FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY k(child_num,parent_num,ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.child_num
        JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.parent_num
        WHERE c.contype='f' AND c.conrelid=TG_RELID GROUP BY c.oid LOOP
        SELECT jsonb_object_agg(relation.parent_columns[n], candidate->relation.child_columns[n]) INTO parent_key
          FROM generate_subscripts(relation.child_columns,1) n;
        SELECT f."intentId" INTO blocked_intent FROM "DataDeletionFence" f
          WHERE f."model"=replace(relation.parent_name,'"','') AND f."keyJson" @> parent_key LIMIT 1;
        EXIT WHEN blocked_intent IS NOT NULL;
      END LOOP;
    END IF;
    IF blocked_intent IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "DataDeletionIntent" i WHERE i.id=blocked_intent AND i.id=allowed_intent
      AND i.state='RUNNING' AND i."executionPid"=pg_backend_pid() AND i."leaseExpiresAt">clock_timestamp()
    ) THEN RAISE EXCEPTION 'DATA_DELETE_SCOPE_FROZEN' USING ERRCODE='55000'; END IF;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END $$;

DO $$ DECLARE source_table RECORD; BEGIN
  FOR source_table IN SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
    AND tablename NOT LIKE 'DataDeletion%' AND tablename <> '_prisma_migrations' LOOP
    EXECUTE format('CREATE TRIGGER areaforge_delete_fence BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION areaforge_delete_fence_guard()', source_table.tablename);
  END LOOP;
END $$;

CREATE FUNCTION areaforge_delete_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DATA_DELETE_LEDGER_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER areaforge_delete_ledger_immutable BEFORE UPDATE OR DELETE ON "DataDeletionLedger"
  FOR EACH ROW EXECUTE FUNCTION areaforge_delete_ledger_immutable();
