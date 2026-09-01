export type KnowledgeRetestStatusDto = "DRAFT" | "IN_PROGRESS" | "PENDING_REVIEW" | "CLOSED" | "VOIDED";
export type KnowledgeRetestResultDto = "PASSED" | "PARTIAL" | "FAILED";

export interface KnowledgeRetestPointDto {
  id: string;
  knowledgePointId: string;
  title: string;
  result: KnowledgeRetestResultDto | null;
  score: number | null;
  understanding: number | null;
  note: string | null;
}

export interface KnowledgeRetestListItemDto {
  id: string;
  revision: number;
  title: string;
  method: string;
  status: KnowledgeRetestStatusDto;
  result: KnowledgeRetestResultDto | null;
  scheduledAt: string | null;
  testedAt: string | null;
  nextDueAt: string | null;
  summary: string | null;
  pointCount: number;
  pointTitles: string[];
  timerSessionId: string | null;
}

export interface KnowledgeRetestDetailDto extends KnowledgeRetestListItemDto {
  reviewText: string | null;
  points: KnowledgeRetestPointDto[];
}
