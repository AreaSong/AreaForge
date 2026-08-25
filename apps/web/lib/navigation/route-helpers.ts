export const WORKBENCH_ROOT_ROUTES = {
  focus: "/focus",
  today: "/today",
  knowledge: "/knowledge",
  test: "/test/retests",
  roadmap: "/roadmap",
  confirmations: "/confirmations",
  settings: "/settings",
} as const;

export type AppWorkbenchId = keyof typeof WORKBENCH_ROOT_ROUTES;

export const ROOT_ROUTES = {
  public: "/",
  login: "/login",
  app: WORKBENCH_ROOT_ROUTES.focus,
} as const;

export const DYNAMIC_ROUTE_PATTERNS = {
  planInboxItem: "/roadmap/allocation/drafts/[itemId]",
  studyTaskDetail: "/roadmap/allocation/tasks/[taskId]",
  periodicReportHistory: "/roadmap/reviews/history/[decisionId]",
  knowledgeRetestDetail: "/test/retests/[retestId]",
  simulationExamDetail: "/test/simulations/[examId]",
  confirmationDetail: "/confirmations/[confirmationId]",
  quickReviewRun: "/knowledge/reviews/[scheduleId]/run",
  knowledgePointDetail: "/knowledge/points/[pointId]",
  learningTreeImportDetail: "/knowledge/imports/[importId]",
  syllabusNodeDetail: "/knowledge/syllabi/[nodeId]",
  knowledgeCardDetail: "/knowledge/cards/[noteId]",
  mistakeDetail: "/knowledge/mistakes/[mistakeId]",
  studyResourceDetail: "/knowledge/resources/[resourceId]",
  studyResourcePreview: "/knowledge/resources/[resourceId]/preview",
  reviewScheduleDetail: "/knowledge/reviews/[scheduleId]",
} as const;

export type WorkbenchRootRoute = (typeof WORKBENCH_ROOT_ROUTES)[AppWorkbenchId];

export type PlanInboxItemRoute = `/roadmap/allocation/drafts/${string}`;
export type StudyTaskDetailRoute = `/roadmap/allocation/tasks/${string}`;
export type PeriodicReportHistoryRoute = `/roadmap/reviews/history/${string}`;
export type KnowledgeRetestDetailRoute = `/test/retests/${string}`;
export type SimulationExamDetailRoute = `/test/simulations/${string}`;
export type ConfirmationDetailRoute = `/confirmations/${string}`;
export type QuickReviewRunRoute = `/knowledge/reviews/${string}/run`;
export type KnowledgePointDetailRoute = `/knowledge/points/${string}`;
export type LearningTreeImportDetailRoute = `/knowledge/imports/${string}`;
export type SyllabusNodeDetailRoute = `/knowledge/syllabi/${string}`;
export type KnowledgeCardDetailRoute = `/knowledge/cards/${string}`;
export type MistakeDetailRoute = `/knowledge/mistakes/${string}`;
export type StudyResourceDetailRoute = `/knowledge/resources/${string}`;
export type StudyResourcePreviewRoute = `/knowledge/resources/${string}/preview`;
export type ReviewScheduleDetailRoute = `/knowledge/reviews/${string}`;

export type DynamicDetailRoute =
  | PlanInboxItemRoute
  | StudyTaskDetailRoute
  | PeriodicReportHistoryRoute
  | KnowledgeRetestDetailRoute
  | SimulationExamDetailRoute
  | ConfirmationDetailRoute
  | QuickReviewRunRoute
  | KnowledgePointDetailRoute
  | LearningTreeImportDetailRoute
  | SyllabusNodeDetailRoute
  | KnowledgeCardDetailRoute
  | MistakeDetailRoute
  | StudyResourceDetailRoute
  | StudyResourcePreviewRoute
  | ReviewScheduleDetailRoute;

export function getWorkbenchRootRoute(workbench: AppWorkbenchId): WorkbenchRootRoute {
  return WORKBENCH_ROOT_ROUTES[workbench];
}

export function planInboxItemRoute(itemId: string): PlanInboxItemRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.planInboxItem, "[itemId]", itemId) as PlanInboxItemRoute;
}

export function studyTaskDetailRoute(taskId: string): StudyTaskDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.studyTaskDetail, "[taskId]", taskId) as StudyTaskDetailRoute;
}

export function periodicReportHistoryRoute(decisionId: string): PeriodicReportHistoryRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.periodicReportHistory, "[decisionId]", decisionId) as PeriodicReportHistoryRoute;
}

export function knowledgeRetestDetailRoute(retestId: string): KnowledgeRetestDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.knowledgeRetestDetail, "[retestId]", retestId) as KnowledgeRetestDetailRoute;
}

export function simulationExamDetailRoute(examId: string): SimulationExamDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.simulationExamDetail, "[examId]", examId) as SimulationExamDetailRoute;
}

export function confirmationDetailRoute(confirmationId: string): ConfirmationDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.confirmationDetail, "[confirmationId]", confirmationId) as ConfirmationDetailRoute;
}

export function quickReviewRunRoute(scheduleId: string): QuickReviewRunRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.quickReviewRun, "[scheduleId]", scheduleId) as QuickReviewRunRoute;
}

export function knowledgePointDetailRoute(pointId: string): KnowledgePointDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.knowledgePointDetail, "[pointId]", pointId) as KnowledgePointDetailRoute;
}

export function learningTreeImportDetailRoute(importId: string): LearningTreeImportDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.learningTreeImportDetail, "[importId]", importId) as LearningTreeImportDetailRoute;
}

export function syllabusNodeDetailRoute(nodeId: string): SyllabusNodeDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.syllabusNodeDetail, "[nodeId]", nodeId) as SyllabusNodeDetailRoute;
}

export function knowledgeCardDetailRoute(noteId: string): KnowledgeCardDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.knowledgeCardDetail, "[noteId]", noteId) as KnowledgeCardDetailRoute;
}

export function mistakeDetailRoute(mistakeId: string): MistakeDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.mistakeDetail, "[mistakeId]", mistakeId) as MistakeDetailRoute;
}

export function studyResourceDetailRoute(resourceId: string): StudyResourceDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.studyResourceDetail, "[resourceId]", resourceId) as StudyResourceDetailRoute;
}

export function studyResourcePreviewRoute(resourceId: string): StudyResourcePreviewRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.studyResourcePreview, "[resourceId]", resourceId) as StudyResourcePreviewRoute;
}

export function reviewScheduleDetailRoute(scheduleId: string): ReviewScheduleDetailRoute {
  return buildRoute(DYNAMIC_ROUTE_PATTERNS.reviewScheduleDetail, "[scheduleId]", scheduleId) as ReviewScheduleDetailRoute;
}

function buildRoute(pattern: string, placeholder: string, value: string): string {
  return pattern.replace(placeholder, encodeURIComponent(value));
}
