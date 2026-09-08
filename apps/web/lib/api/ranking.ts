import type {
  RankingAppealDto,
  PrivateChallengeDto,
  RankingParticipantDto,
  RankingPreferenceDto,
  RankingProjectionViewDto,
} from "@/lib/ranking/contracts";
import { createJsonRequest, requestApiResult, type ApiResult } from "./client";

interface PreferenceResponse { preference?: RankingPreferenceDto; error?: string }
interface ChallengeResponse { challenge?: PrivateChallengeDto; error?: string }
interface ChallengesResponse { challenges?: PrivateChallengeDto[]; error?: string }
interface ParticipantResponse { participant?: RankingParticipantDto; error?: string }
interface ParticipantsResponse { participants?: RankingParticipantDto[]; error?: string }
interface ProjectionResponse { projection?: RankingProjectionViewDto; error?: string }
interface PreviewResponse { preview?: unknown; error?: string }
interface AppealsResponse { appeals?: RankingAppealDto[]; error?: string }
interface AppealResponse { appeal?: RankingAppealDto; error?: string }

export function getRankingPreference(workspaceId: string): Promise<ApiResult<PreferenceResponse>> {
  return requestApiResult(`/api/ranking/preferences?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function updateRankingPreference(workspaceId: string, input: { enabled: boolean; timezone: string; authorizedFields: string[]; expectedRevision?: number }): Promise<ApiResult<PreferenceResponse>> {
  return requestApiResult("/api/ranking/preferences", createJsonRequest("PATCH", { workspaceId, ...input }));
}

export function listPrivateChallenges(workspaceId: string): Promise<ApiResult<ChallengesResponse>> {
  return requestApiResult(`/api/ranking/challenges?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createPrivateChallenge(input: {
  workspaceId: string;
  name: string;
  description?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  targetEffectiveMinutesPerDay: number;
  publishedFields: string[];
}): Promise<ApiResult<ChallengeResponse>> {
  return requestApiResult("/api/ranking/challenges", createJsonRequest("POST", input));
}

export function transitionPrivateChallenge(challengeId: string, action: "start" | "end" | "close" | "dissolve", expectedRevision: number): Promise<ApiResult<ChallengeResponse>> {
  const method = action === "dissolve" ? "DELETE" : "POST";
  const path = action === "dissolve" ? `/api/ranking/challenges/${encodeURIComponent(challengeId)}` : `/api/ranking/challenges/${encodeURIComponent(challengeId)}/${action}`;
  return requestApiResult(path, createJsonRequest(method, { expectedRevision }));
}

export function getChallengeParticipants(challengeId: string): Promise<ApiResult<ParticipantsResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/participants`);
}

export function inviteChallengeParticipant(challengeId: string, input: { userId: string; nickname?: string | null; authorizedFields?: string[] }): Promise<ApiResult<ParticipantResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/participants`, createJsonRequest("POST", input));
}

export function joinOrLeaveChallenge(challengeId: string, action: "join" | "leave"): Promise<ApiResult<ParticipantResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/participants/me`, createJsonRequest("POST", { action }));
}

export function getChallengeProjection(challengeId: string): Promise<ApiResult<ProjectionResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/projection`);
}

export function rebuildChallengeProjection(challengeId: string, expectedRevision: number): Promise<ApiResult<ProjectionResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/projection`, createJsonRequest("POST", { expectedRevision }));
}

export function previewRankingDeletion(workspaceId?: string): Promise<ApiResult<PreviewResponse>> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  return requestApiResult(`/api/ranking/deletion-preview${query}`);
}

export function listRankingAppeals(challengeId: string): Promise<ApiResult<AppealsResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/appeals`);
}

export function submitRankingAppeal(
  challengeId: string,
  input: { participantId: string; reason: string; projectionFingerprint?: string },
): Promise<ApiResult<AppealResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/appeals`, createJsonRequest("POST", input));
}

export function getRankingAppeal(challengeId: string, appealId: string): Promise<ApiResult<AppealResponse>> {
  return requestApiResult(`/api/ranking/challenges/${encodeURIComponent(challengeId)}/appeals/${encodeURIComponent(appealId)}`);
}

export function transitionRankingAppeal(
  challengeId: string,
  appealId: string,
  action: "review" | "accept" | "reject" | "withdraw",
  expectedRevision: number,
): Promise<ApiResult<AppealResponse>> {
  return requestApiResult(
    `/api/ranking/challenges/${encodeURIComponent(challengeId)}/appeals/${encodeURIComponent(appealId)}`,
    createJsonRequest("POST", { action, expectedRevision }),
  );
}
