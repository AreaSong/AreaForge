import {
  DEFAULT_RANKING_SHARE_FIELDS,
  RANKING_SHARE_FIELDS,
  type PrivateChallengeParticipantStatus,
  type PrivateChallengeStatus,
  type RankingAppealStatus,
  type RankingShareField,
} from "@areaforge/core";
import { z } from "zod";

export const rankingShareFieldSchema = z.enum(RANKING_SHARE_FIELDS);
export const rankingShareFieldsSchema = z.array(rankingShareFieldSchema).max(RANKING_SHARE_FIELDS.length).default([...DEFAULT_RANKING_SHARE_FIELDS]);

export const rankingDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
export const rankingTimezoneSchema = z.string().trim().min(1).max(80);

export const rankingPreferenceInputSchema = z.object({
  enabled: z.boolean(),
  timezone: rankingTimezoneSchema,
  authorizedFields: rankingShareFieldsSchema,
  expectedRevision: z.number().int().positive().optional(),
}).strict();

export const createChallengeInputSchema = z.object({
  workspaceId: z.string().trim().min(1).max(191),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  timezone: rankingTimezoneSchema,
  startDate: rankingDateSchema,
  endDate: rankingDateSchema,
  targetEffectiveMinutesPerDay: z.number().int().min(1).max(1440),
  publishedFields: rankingShareFieldsSchema,
}).strict();

export const updateChallengeInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  timezone: rankingTimezoneSchema.optional(),
  startDate: rankingDateSchema.optional(),
  endDate: rankingDateSchema.optional(),
  targetEffectiveMinutesPerDay: z.number().int().min(1).max(1440).optional(),
  publishedFields: rankingShareFieldsSchema.optional(),
}).strict();

export const participantInviteInputSchema = z.object({
  userId: z.string().trim().min(1).max(191),
  nickname: z.string().trim().max(80).nullable().optional(),
  authorizedFields: rankingShareFieldsSchema.optional(),
}).strict();

export const participantUpdateInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  nickname: z.string().trim().max(80).nullable().optional(),
  authorizedFields: rankingShareFieldsSchema.optional(),
}).strict();

export const actionInputSchema = z.object({ expectedRevision: z.number().int().positive().optional() }).strict();
export const transferOwnershipInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  targetParticipantId: z.string().trim().min(1).max(191),
}).strict();

export const rankingAppealSubmitInputSchema = z.object({
  participantId: z.string().trim().min(1).max(191),
  reason: z.string().trim().min(1).max(500),
  projectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export const rankingAppealActionInputSchema = z.object({
  action: z.enum(["review", "accept", "reject", "withdraw"]),
  expectedRevision: z.number().int().positive(),
}).strict();

export interface RankingPreferenceDto {
  id: string | null;
  workspaceId: string;
  userId: string;
  enabled: boolean;
  timezone: string;
  authorizedFields: RankingShareField[];
  revision: number;
  optedInAt: string | null;
  optedOutAt: string | null;
  updatedAt: string;
}

export interface RankingParticipantDto {
  id: string;
  userId: string | null;
  nickname: string | null;
  status: PrivateChallengeParticipantStatus;
  authorizedFields: RankingShareField[];
  revision: number;
  joinedAt: string | null;
  leftAt: string | null;
  removedAt: string | null;
}

export interface PrivateChallengeDto {
  id: string;
  workspaceId: string;
  ownerUserId: string | null;
  name: string;
  description: string | null;
  status: PrivateChallengeStatus;
  timezone: string;
  startDate: string;
  endDate: string;
  targetEffectiveMinutesPerDay: number;
  scoreVersion: string;
  rulesVersion: number;
  publishedFields: RankingShareField[];
  revision: number;
  startedAt: string | null;
  endedAt: string | null;
  closedAt: string | null;
  dissolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants?: RankingParticipantDto[];
}

export interface RankingProjectionDto {
  participantId: string;
  displayName: string;
  rank: number;
  tieGroup: number;
  tied: boolean;
  scoreVersion: string;
  generatedAt: string;
  fields: Partial<Record<RankingShareField, number>>;
}

export interface RankingProjectionViewDto {
  challengeId: string;
  scoreVersion: string;
  rulesVersion: number;
  stale: boolean;
  entries: RankingProjectionDto[];
}

export interface RankingAppealDto {
  appealId: string;
  challengeId: string;
  participantId: string;
  status: RankingAppealStatus;
  reason: string | null;
  projectionFingerprint: string | null;
  revision: number;
  submittedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RankingDeletionPreviewDto {
  contractVersion: "ranking-delete-preview-v1";
  scope: "ACCOUNT" | "WORKSPACE";
  workspaceId: string | null;
  blocked: boolean;
  canProceed: boolean;
  reason: "ready" | "owned_challenges_require_transfer_or_dissolve" | "ranking_projection_cleanup_required";
  blockers: Array<{ challengeId: string; status: PrivateChallengeStatus }>;
  ownedDissolvedChallengeCount: number;
  participationCount: number;
  projectionCount: number;
  preferenceCount: number;
  cleanupRequired: boolean;
  consistency: "CLEAN" | "CLEANUP_REQUIRED";
  preimageFingerprint: string;
  action: "preview_only";
}
