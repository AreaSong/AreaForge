export interface WeeklyBudgetSubjectDto {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  targetMinutes: number | null;
  actualMinutes: number;
  effectiveMinutes: number;
  revision: number;
}

export interface WeeklyBudgetDto {
  workspaceId: string;
  weekStart: string;
  weekEnd: string;
  configuredSubjectCount: number;
  totalTargetMinutes: number;
  totalActualMinutes: number;
  totalEffectiveMinutes: number;
  subjects: WeeklyBudgetSubjectDto[];
}
