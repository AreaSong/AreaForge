import type {
  MasteryProofCondition,
  MasteryProofSummary,
  SyllabusMapSignal,
  SyllabusMapSummary,
} from "@areaforge/core";
import type { MasteryStatus } from "@/lib/knowledge/mastery-status";

export type SyllabusNodeKindDto = "subject" | "chapter" | "topic" | "problem_type";
export type SyllabusNodeStatusDto =
  | "not_started"
  | "learning"
  | "covered"
  | "needs_review"
  | "mastered"
  | "weak"
  | "deferred";
export type MasteryLevelDto =
  | "seen"
  | "learned"
  | "basic_exercises"
  | "can_explain"
  | "retest_passed"
  | "exam_stable";
export type MasteryStatusDto = MasteryStatus;
export type MasteryEvidenceTypeDto = "task" | "session" | "note" | "mistake" | "retest";
export type MasteryRetestResultDto = "passed" | "failed" | "partial";

export interface MasteryConditionRecordDto {
  condition: MasteryProofCondition;
  checked: boolean;
  checkedAt: string | null;
  actorId: string | null;
}

export interface MasteryEvidenceDto {
  id: string;
  evidenceType: MasteryEvidenceTypeDto;
  taskId: string | null;
  sessionId: string | null;
  noteId: string | null;
  mistakeId: string | null;
  retestId: string | null;
  summary: string | null;
  sourceLabel: string;
  createdAt: string;
  actorId: string | null;
}

export interface MasteryRetestDto {
  id: string;
  testedAt: string;
  result: MasteryRetestResultDto;
  score: string | null;
  summary: string | null;
  nextReviewAt: string | null;
  actorId: string | null;
}

export interface MasteryEvidenceCandidateDto {
  id: string;
  label: string;
}

export interface SyllabusNodeDto {
  id: string;
  revision: number;
  stableKey: string | null;
  archivedAt: string | null;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  parentId: string | null;
  title: string;
  kind: SyllabusNodeKindDto;
  status: SyllabusNodeStatusDto;
  masteryLevel: MasteryLevelDto | null;
  masteryStatus: MasteryStatusDto;
  needsRetest: boolean;
  masteryConfidence: number;
  sortOrder: number;
  targetMinutes: number;
  actualMinutes: number;
  evidence: {
    taskCount: number;
    sessionCount: number;
    noteCount: number;
    mistakeCount: number;
    lastEvidenceAt: string | null;
    daysSinceLastEvidence: number | null;
    source: "explicit" | "fallback_count";
  };
  masteryConditions: MasteryProofCondition[];
  masteryConditionRecords: MasteryConditionRecordDto[];
  masteryEvidence: MasteryEvidenceDto[];
  masteryRetests: MasteryRetestDto[];
  masteryEvidenceCandidates: Record<MasteryEvidenceTypeDto, MasteryEvidenceCandidateDto[]>;
  masteryProof: MasteryProofSummary;
  mapSignal: SyllabusMapSignal;
  children: SyllabusNodeDto[];
}

export interface SyllabusMapOverviewDto {
  nodes: SyllabusNodeDto[];
  summary: SyllabusMapSummary;
  summaryBySubject: Record<string, SyllabusMapSummary>;
}

/** 考纲节点选择器的轻量树：只含选项渲染所需字段，不携带证据与掌握证明明细。 */
export interface SyllabusOptionNodeDto {
  id: string;
  subjectId: string;
  title: string;
  children: SyllabusOptionNodeDto[];
}
