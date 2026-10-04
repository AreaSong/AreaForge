-- v1.8 RANKING local candidate.
-- Additive only: no production migration/apply is authorized by this task.
-- Ranking is fail-closed at the Web gate (RANKING_ENABLED must be true).

CREATE TYPE "RankingChallengeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CLOSED', 'DISSOLVED');
CREATE TYPE "RankingParticipantStatus" AS ENUM ('INVITED', 'ACTIVE', 'LEFT', 'REMOVED');

CREATE TABLE "RankingPreference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "authorizedFields" TEXT[] NOT NULL DEFAULT ARRAY['score']::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "optedInAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingPreference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RankingPreference_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "RankingPreference_timezone_check" CHECK (length(btrim("timezone")) BETWEEN 1 AND 80),
    CONSTRAINT "RankingPreference_fields_check" CHECK (
      "authorizedFields" <@ ARRAY['score', 'effective_minutes', 'active_days', 'minimum_action_days', 'anomaly_count']::TEXT[]
    )
);

CREATE TABLE "PrivateChallenge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "RankingChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "targetEffectiveMinutesPerDay" INTEGER NOT NULL,
    "scoreVersion" TEXT NOT NULL DEFAULT 'private-challenge-v1',
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedFields" TEXT[] NOT NULL DEFAULT ARRAY['score']::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "dissolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateChallenge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivateChallenge_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "PrivateChallenge_timezone_check" CHECK (length(btrim("timezone")) BETWEEN 1 AND 80),
    CONSTRAINT "PrivateChallenge_date_shape_check" CHECK (
      "startDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND "endDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND "startDate" < "endDate"
    ),
    CONSTRAINT "PrivateChallenge_target_check" CHECK ("targetEffectiveMinutesPerDay" BETWEEN 1 AND 1440),
    CONSTRAINT "PrivateChallenge_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "PrivateChallenge_rules_version_check" CHECK ("rulesVersion" >= 1),
    CONSTRAINT "PrivateChallenge_fields_check" CHECK (
      "publishedFields" <@ ARRAY['score', 'effective_minutes', 'active_days', 'minimum_action_days', 'anomaly_count']::TEXT[]
      AND 'score' = ANY("publishedFields")
    )
);

CREATE TABLE "PrivateChallengeParticipant" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "status" "RankingParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "nickname" TEXT,
    "authorizedFields" TEXT[] NOT NULL DEFAULT ARRAY['score']::TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateChallengeParticipant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivateChallengeParticipant_nickname_check" CHECK ("nickname" IS NULL OR length("nickname") <= 80),
    CONSTRAINT "PrivateChallengeParticipant_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "PrivateChallengeParticipant_fields_check" CHECK (
      "authorizedFields" <@ ARRAY['score', 'effective_minutes', 'active_days', 'minimum_action_days', 'anomaly_count']::TEXT[]
      AND 'score' = ANY("authorizedFields")
    )
);

CREATE TABLE "RankingProjection" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "scoreVersion" TEXT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "effectiveMinutes" INTEGER NOT NULL,
    "activeDays" INTEGER NOT NULL,
    "minimumActionDays" INTEGER NOT NULL,
    "anomalyCount" INTEGER NOT NULL DEFAULT 0,
    "anomalies" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingProjection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RankingProjection_score_check" CHECK ("score" BETWEEN 0 AND 100),
    CONSTRAINT "RankingProjection_nonnegative_check" CHECK (
      "effectiveMinutes" >= 0 AND "activeDays" >= 0 AND "minimumActionDays" >= 0 AND "anomalyCount" >= 0
    ),
    CONSTRAINT "RankingProjection_version_check" CHECK ("rulesVersion" >= 1)
);

CREATE UNIQUE INDEX "RankingPreference_workspaceId_userId_key" ON "RankingPreference"("workspaceId", "userId");
CREATE INDEX "RankingPreference_userId_enabled_idx" ON "RankingPreference"("userId", "enabled");
CREATE INDEX "RankingPreference_workspaceId_enabled_idx" ON "RankingPreference"("workspaceId", "enabled");
CREATE INDEX "PrivateChallenge_workspaceId_status_createdAt_idx" ON "PrivateChallenge"("workspaceId", "status", "createdAt");
CREATE INDEX "PrivateChallenge_ownerUserId_status_idx" ON "PrivateChallenge"("ownerUserId", "status");
CREATE UNIQUE INDEX "PrivateChallengeParticipant_challengeId_userId_key" ON "PrivateChallengeParticipant"("challengeId", "userId");
CREATE INDEX "PrivateChallengeParticipant_challengeId_status_idx" ON "PrivateChallengeParticipant"("challengeId", "status");
CREATE INDEX "PrivateChallengeParticipant_userId_status_idx" ON "PrivateChallengeParticipant"("userId", "status");
CREATE UNIQUE INDEX "RankingProjection_participantId_key" ON "RankingProjection"("participantId");
CREATE UNIQUE INDEX "RankingProjection_challengeId_participantId_key" ON "RankingProjection"("challengeId", "participantId");
CREATE INDEX "RankingProjection_challengeId_score_idx" ON "RankingProjection"("challengeId", "score");
CREATE INDEX "RankingProjection_participantId_generatedAt_idx" ON "RankingProjection"("participantId", "generatedAt");

ALTER TABLE "RankingPreference"
  ADD CONSTRAINT "RankingPreference_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingPreference"
  ADD CONSTRAINT "RankingPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateChallenge"
  ADD CONSTRAINT "PrivateChallenge_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "ExamWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateChallenge"
  ADD CONSTRAINT "PrivateChallenge_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivateChallengeParticipant"
  ADD CONSTRAINT "PrivateChallengeParticipant_challengeId_fkey"
  FOREIGN KEY ("challengeId") REFERENCES "PrivateChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateChallengeParticipant"
  ADD CONSTRAINT "PrivateChallengeParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateChallengeParticipant"
  ADD CONSTRAINT "PrivateChallengeParticipant_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RankingProjection"
  ADD CONSTRAINT "RankingProjection_challengeId_fkey"
  FOREIGN KEY ("challengeId") REFERENCES "PrivateChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingProjection"
  ADD CONSTRAINT "RankingProjection_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "PrivateChallengeParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
