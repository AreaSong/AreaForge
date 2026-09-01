import type {
  MasteryEvidenceTypeDto,
  MasteryRetestResultDto,
  SubjectDto,
  SyllabusMapOverviewDto,
  SyllabusNodeDto,
  SyllabusNodeStatusDto,
} from "@/lib/contracts";

export interface SyllabusManagerProps {
  subjects: SubjectDto[];
  nodes: SyllabusNodeDto[];
  summary: SyllabusMapOverviewDto["summary"];
  summaryBySubject: SyllabusMapOverviewDto["summaryBySubject"];
  initialSubjectId?: string;
  initialQuery?: string;
  initialStatusFilter?: string;
  initialMapStatusFilter?: string;
  initialActionFilter?: string;
  initialCreate?: boolean;
}

export interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export type StatusFilter = "all" | SyllabusNodeStatusDto;
export type MapStatusFilter = "all" | SyllabusNodeDto["mapSignal"]["cellStatus"];
export type ActionFilter = "all" | "risk" | "evidence" | "review" | "start" | "deferred";
export type MasteryCondition = SyllabusNodeDto["masteryConditions"][number];
export type MasteryEvidenceType = MasteryEvidenceTypeDto;
export type MasteryRetestResult = MasteryRetestResultDto;
export type UpdateNodeBody = Partial<{
  status: SyllabusNodeStatusDto;
  masteryLevel: SyllabusNodeDto["masteryLevel"];
  masteryConditions: MasteryCondition[];
  targetMinutes: number;
}>;
export type SyllabusUpdateBaseline = Pick<
  SyllabusNodeDto,
  "id" | "revision" | "parentId" | "title" | "kind" | "status" | "masteryLevel" | "masteryConditions" | "sortOrder" | "targetMinutes"
>;
export type SyllabusUpdateSubmission = {
  nodeId: string;
  expectedRevision: number;
  baseline: SyllabusUpdateBaseline;
  body: UpdateNodeBody;
};
export type SyllabusConflict = {
  baseline: SyllabusUpdateBaseline;
  submission: SyllabusUpdateSubmission;
  latest: SyllabusNodeDto;
  conflictFields: string[];
};
export type ApiFailure = {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
};
export type AddMasteryEvidenceBody = {
  evidenceType: MasteryEvidenceType;
  taskId?: string;
  sessionId?: string;
  noteId?: string;
  mistakeId?: string;
  retestId?: string;
  summary?: string;
};
export type AddMasteryRetestBody = {
  testedAt?: string;
  result: MasteryRetestResult;
  score?: string;
  summary?: string;
  nextReviewAt?: string | null;
};
export type MasteryEvidenceFormDraft = {
  evidenceType: MasteryEvidenceType;
  evidenceReferenceId: string;
  evidenceSummary: string;
};
export type MasteryRetestFormDraft = {
  result: MasteryRetestResult;
  testedAt: string;
  score: string;
  summary: string;
  nextReviewDate: string;
};

export interface SyllabusTreeNodeProps {
  node: SyllabusNodeDto;
  onUpdate: (id: string, body: UpdateNodeBody) => Promise<boolean>;
  onAddMasteryEvidence: (id: string, body: AddMasteryEvidenceBody) => Promise<boolean>;
  onAddMasteryRetest: (id: string, body: AddMasteryRetestBody) => Promise<boolean>;
  pendingCommand: string | null;
  depth?: number;
}
