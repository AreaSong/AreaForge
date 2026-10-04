-- v1.8 RANKING appeal persistence local candidate.
-- Additive only: no shared-test or production migration/apply is authorized.

CREATE TYPE "RankingAppealStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "RankingAppeal" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "status" "RankingAppealStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "projectionFingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingAppeal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RankingAppeal_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
    CONSTRAINT "RankingAppeal_fingerprint_check" CHECK ("projectionFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "RankingAppeal_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "RankingAppeal_review_check" CHECK (
      ("status" IN ('OPEN', 'WITHDRAWN') AND "reviewedByUserId" IS NULL AND "reviewedAt" IS NULL)
      OR ("status" = 'UNDER_REVIEW' AND "reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
      OR ("status" IN ('ACCEPTED', 'REJECTED') AND "reviewedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "RankingAppeal_participantId_active_uidx"
    ON "RankingAppeal"("participantId")
    WHERE "status" IN ('OPEN', 'UNDER_REVIEW');
CREATE UNIQUE INDEX "PrivateChallengeParticipant_challengeId_id_key"
    ON "PrivateChallengeParticipant"("challengeId", "id");
CREATE UNIQUE INDEX "PrivateChallengeParticipant_id_userId_key"
    ON "PrivateChallengeParticipant"("id", "userId");
CREATE INDEX "RankingAppeal_challengeId_status_createdAt_idx" ON "RankingAppeal"("challengeId", "status", "createdAt");
CREATE INDEX "RankingAppeal_participantId_status_idx" ON "RankingAppeal"("participantId", "status");
CREATE INDEX "RankingAppeal_submittedByUserId_createdAt_idx" ON "RankingAppeal"("submittedByUserId", "createdAt");
CREATE INDEX "RankingAppeal_reviewedByUserId_reviewedAt_idx" ON "RankingAppeal"("reviewedByUserId", "reviewedAt");

ALTER TABLE "RankingAppeal"
  ADD CONSTRAINT "RankingAppeal_challengeId_fkey"
  FOREIGN KEY ("challengeId") REFERENCES "PrivateChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingAppeal"
  ADD CONSTRAINT "RankingAppeal_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "PrivateChallengeParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingAppeal"
  ADD CONSTRAINT "RankingAppeal_submittedByUserId_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingAppeal"
  ADD CONSTRAINT "RankingAppeal_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RankingAppeal"
  ADD CONSTRAINT "RankingAppeal_challengeId_participantId_fkey"
  FOREIGN KEY ("challengeId", "participantId")
  REFERENCES "PrivateChallengeParticipant"("challengeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingAppeal"
  ADD CONSTRAINT "RankingAppeal_participantId_submittedByUserId_fkey"
  FOREIGN KEY ("participantId", "submittedByUserId")
  REFERENCES "PrivateChallengeParticipant"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
