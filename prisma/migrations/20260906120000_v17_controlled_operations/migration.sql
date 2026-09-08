-- v1.7 OPS candidate: durable typed operation requests and lifecycle metadata.
-- Additive only. This migration is intentionally not applied to production.

CREATE TYPE "ControlledOperationRequestRisk" AS ENUM ('READ_ONLY', 'HIGH_RISK');
CREATE TYPE "ControlledOperationRequestStatus" AS ENUM (
    'PREVIEWED',
    'CONFIRMATION_REQUIRED',
    'APPROVAL_REQUIRED',
    'QUEUED',
    'RUNNING',
    'PAUSED',
    'HELD',
    'CANCEL_REQUESTED',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
);

CREATE TABLE "ControlledOperationRequest" (
    "id" TEXT NOT NULL,
    "operationCode" TEXT NOT NULL,
    "operation" JSONB NOT NULL,
    "risk" "ControlledOperationRequestRisk" NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "requestedReason" TEXT NOT NULL,
    "expectedBeforeHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "intentHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "status" "ControlledOperationRequestStatus" NOT NULL DEFAULT 'PREVIEWED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "holdReasonCode" TEXT,
    "resultCode" TEXT,
    "evidenceHash" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledOperationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ControlledOperationRequest_requestHash_key" ON "ControlledOperationRequest"("requestHash");
CREATE UNIQUE INDEX "ControlledOperationRequest_nonce_key" ON "ControlledOperationRequest"("nonce");
CREATE UNIQUE INDEX "ControlledOperationRequest_requestedByUserId_idempotencyKey_key" ON "ControlledOperationRequest"("requestedByUserId", "idempotencyKey");
CREATE INDEX "ControlledOperationRequest_status_createdAt_idx" ON "ControlledOperationRequest"("status", "createdAt");
CREATE INDEX "ControlledOperationRequest_expiresAt_status_idx" ON "ControlledOperationRequest"("expiresAt", "status");
CREATE INDEX "ControlledOperationRequest_workerId_leaseExpiresAt_idx" ON "ControlledOperationRequest"("workerId", "leaseExpiresAt");
CREATE INDEX "ControlledOperationRequest_requestedByUserId_createdAt_idx" ON "ControlledOperationRequest"("requestedByUserId", "createdAt");

ALTER TABLE "ControlledOperationRequest"
    ADD CONSTRAINT "ControlledOperationRequest_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlledOperationRequest"
    ADD CONSTRAINT "ControlledOperationRequest_confirmedByUserId_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ControlledOperationRequest"
    ADD CONSTRAINT "ControlledOperationRequest_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
