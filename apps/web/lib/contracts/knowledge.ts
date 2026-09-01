import type { MasteryStatus } from "@/lib/knowledge/mastery-status";

export type KnowledgeMasteryStateDto = "UNTOUCHED" | "LEARNING" | "INITIAL_MASTERY" | "STABLE_MASTERY" | "NEEDS_RETEST";

export interface KnowledgePointDto {
  id: string;
  stableKey: string;
  title: string;
  boundary: string | null;
  masteryState: KnowledgeMasteryStateDto;
  masteryStatus: MasteryStatus;
  needsRetest: boolean;
  masteryConfidence: number;
  nextRetestAt: string | null;
  revision: number;
  subject: { id: string; name: string; color: string; stableKey: string };
  primaryGroup: { id: string; title: string; stableKey: string } | null;
  relatedSubjects: Array<{ id: string; name: string; color: string; stableKey: string }>;
  counts: {
    syllabusLinks: number;
    stageTargets: number;
    arrangements: number;
    sessions: number;
    retests: number;
    evidence: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgePointDetailDto extends KnowledgePointDto {
  syllabusLinks: Array<{ id: string; role: string; node: { id: string; title: string; kind: string; status: string } }>;
  stageTargets: Array<{ id: string; targetState: KnowledgeMasteryStateDto; importance: number; stage: { id: string; name: string; status: string } | null }>;
  arrangements: Array<{ id: string; title: string; startDate: string; endDate: string; status: string }>;
  recentSessions: Array<{ id: string; status: string; startedAt: string; endedAt: string | null; effectiveMinutes: number; understanding: string | null }>;
  evidence: Array<{ id: string; sourceType: string; summary: string | null; confidence: number | null; occurredAt: string }>;
}
