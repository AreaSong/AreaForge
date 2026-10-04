import type {
  StudySessionEvidenceReceiptDto,
  StudySessionEvidenceTypeDto,
} from "./study-session";

export interface DailyReviewDto {
  id: string;
  revision: number;
  reviewDate: string;
  totalMinutes: number;
  effectiveMinutes: number;
  summary: string | null;
  lostControl: string | null;
  keepAction: string | null;
  tomorrowMinimum: string | null;
  mood: string | null;
  aiSuggestion: string | null;
}

export interface DailyReviewFactsDto {
  studyDayKey: string;
  totalMinutes: number;
  effectiveMinutes: number;
  effectiveSessionCount: number;
  lowConversionCount: number;
  plannedTaskCount: number;
  completedTaskCount: number;
  confirmedReviewCount: number;
  evidenceCounts: Record<StudySessionEvidenceTypeDto, number>;
  evidence: StudySessionEvidenceReceiptDto[];
  subjects: Array<{
    id: string;
    name: string;
    color: string;
    effectiveMinutes: number;
    sessionCount: number;
  }>;
}
