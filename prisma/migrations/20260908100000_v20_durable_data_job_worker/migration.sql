-- 旧任务保持手工 preview 协议，不因部署 migration 自动进入独立 worker。
ALTER TABLE "DataJob"
  ADD COLUMN "queueVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deadLetteredAt" TIMESTAMP(3);

ALTER TABLE "DataJob" ADD CONSTRAINT "DataJob_queue_bounds_check"
  CHECK ("queueVersion" IN (0, 1) AND "maxAttempts" BETWEEN 1 AND 100
    AND "leaseVersion" >= 0);
ALTER TABLE "DataJob" ADD CONSTRAINT "DataJob_queue_scope_check"
  CHECK ("queueVersion" = 0 OR
    (("scope" = 'ACCOUNT' AND "workspaceId" IS NULL)
    OR ("scope" = 'WORKSPACE' AND "workspaceId" IS NOT NULL)));

CREATE INDEX "DataJob_queueVersion_status_nextAttemptAt_idx"
  ON "DataJob"("queueVersion", "status", "nextAttemptAt");
