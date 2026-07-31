export type ActionCenterPriority =
  | "continue_activity"
  | "recovery_candidate"
  | "overdue_task"
  | "today_high_priority_task"
  | "due_mistake_review"
  | "due_other_review"
  | "today_normal_task";

export type ActionCenterQueueKind = "formal_tasks" | "note_resource_syllabus_reviews" | "mistake_reviews";

export type ActionCenterItemKind = "task" | "review" | "activity" | "recovery";

export type ActionCenterReviewObjectKind = "NOTE" | "MISTAKE" | "STUDY_RESOURCE" | "SYLLABUS_NODE";

export type ActionCenterTaskPriority = "low" | "medium" | "high" | "critical";

export interface ActionCenterCandidate {
  id: string;
  kind: ActionCenterItemKind;
  title: string;
  reason: string;
  priorityBand: ActionCenterPriority;
  riskScore: number;
  overdueDays: number;
  estimatedMinutes: number;
  createdAtMs: number;
  hardBlocked: boolean;
  softDependencyHint: string | null;
  /** When a formal task bridges this review schedule, hide the review entry. */
  bridgedReviewScheduleId: string | null;
  reviewObjectKind: ActionCenterReviewObjectKind | null;
  taskPriority: ActionCenterTaskPriority | null;
  href: string;
}

export interface ActionCenterRecommendation {
  id: string;
  kind: ActionCenterItemKind;
  title: string;
  reason: string;
  priorityBand: ActionCenterPriority;
  softDependencyHint: string | null;
  href: string;
}

export interface ActionCenterQueueItem {
  id: string;
  kind: ActionCenterItemKind;
  title: string;
  reason: string;
  href: string;
  softDependencyHint: string | null;
}

export interface ActionCenterQueues {
  formalTasks: ActionCenterQueueItem[];
  noteResourceSyllabusReviews: ActionCenterQueueItem[];
  mistakeReviews: ActionCenterQueueItem[];
}

export interface SubjectTimerSubjectInput {
  subjectId: string;
  title: string;
  groupId: string | null;
  groupTitle: string | null;
  archived: boolean;
  todayEffectiveMinutes: number;
  last7EffectiveMinutes: number;
  contextSummary: string | null;
  canStart: boolean;
}

export interface SubjectTimerGroupInput {
  groupId: string;
  title: string;
  todayEffectiveMinutes: number;
  last7EffectiveMinutes: number;
}

export interface SubjectTimerSummary {
  subjects: Array<{
    subjectId: string;
    title: string;
    groupId: string | null;
    groupTitle: string | null;
    todayEffectiveMinutes: number;
    last7EffectiveMinutes: number;
    contextSummary: string | null;
    canStart: boolean;
  }>;
  groups: Array<{
    groupId: string;
    title: string;
    todayEffectiveMinutes: number;
    last7EffectiveMinutes: number;
    canStart: false;
  }>;
}

const PRIORITY_ORDER: ActionCenterPriority[] = [
  "continue_activity",
  "recovery_candidate",
  "overdue_task",
  "today_high_priority_task",
  "due_mistake_review",
  "due_other_review",
  "today_normal_task",
];

function priorityRank(band: ActionCenterPriority): number {
  return PRIORITY_ORDER.indexOf(band);
}

function compareCandidates(a: ActionCenterCandidate, b: ActionCenterCandidate): number {
  const bandDiff = priorityRank(a.priorityBand) - priorityRank(b.priorityBand);
  if (bandDiff !== 0) return bandDiff;
  if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
  if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
  if (a.estimatedMinutes !== b.estimatedMinutes) return a.estimatedMinutes - b.estimatedMinutes;
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
  return a.id.localeCompare(b.id);
}

function toQueueItem(candidate: ActionCenterCandidate): ActionCenterQueueItem {
  return {
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    reason: candidate.reason,
    href: candidate.href,
    softDependencyHint: candidate.softDependencyHint,
  };
}

/**
 * Hide review schedules that already have a bridged formal task for today.
 */
export function filterBridgedReviews(candidates: ActionCenterCandidate[]): ActionCenterCandidate[] {
  const bridgedScheduleIds = new Set(
    candidates
      .filter((item) => item.kind === "task" && item.bridgedReviewScheduleId)
      .map((item) => item.bridgedReviewScheduleId as string),
  );
  return candidates.filter((item) => {
    if (item.kind !== "review") return true;
    return !bridgedScheduleIds.has(item.id);
  });
}

export function selectActionCenterRecommendation(
  candidates: ActionCenterCandidate[],
): ActionCenterRecommendation | null {
  const visible = filterBridgedReviews(candidates)
    .filter((item) => !item.hardBlocked)
    .sort(compareCandidates);
  const top = visible[0];
  if (!top) return null;
  return {
    id: top.id,
    kind: top.kind,
    title: top.title,
    reason: top.reason,
    priorityBand: top.priorityBand,
    softDependencyHint: top.softDependencyHint,
    href: top.href,
  };
}

export function partitionActionCenterQueues(
  candidates: ActionCenterCandidate[],
  limitPerQueue = 3,
): ActionCenterQueues {
  const visible = filterBridgedReviews(candidates).sort(compareCandidates);

  const formalTasks = visible
    .filter((item) => item.kind === "task" || item.kind === "activity" || item.kind === "recovery")
    .slice(0, limitPerQueue)
    .map(toQueueItem);

  const mistakeReviews = visible
    .filter((item) => item.kind === "review" && item.reviewObjectKind === "MISTAKE")
    .slice(0, limitPerQueue)
    .map(toQueueItem);

  const noteResourceSyllabusReviews = visible
    .filter(
      (item) =>
        item.kind === "review" &&
        item.reviewObjectKind !== null &&
        item.reviewObjectKind !== "MISTAKE",
    )
    .slice(0, limitPerQueue)
    .map(toQueueItem);

  return { formalTasks, noteResourceSyllabusReviews, mistakeReviews };
}

export function queuesAreEmpty(queues: ActionCenterQueues): boolean {
  return (
    queues.formalTasks.length === 0 &&
    queues.noteResourceSyllabusReviews.length === 0 &&
    queues.mistakeReviews.length === 0
  );
}

export function classifyTaskPriorityBand(input: {
  overdueDays: number;
  taskPriority: ActionCenterTaskPriority;
  plannedForToday: boolean;
}): ActionCenterPriority {
  if (input.overdueDays > 0) return "overdue_task";
  if (input.plannedForToday && (input.taskPriority === "high" || input.taskPriority === "critical")) {
    return "today_high_priority_task";
  }
  return "today_normal_task";
}

export function classifyReviewPriorityBand(
  objectKind: ActionCenterReviewObjectKind,
): ActionCenterPriority {
  return objectKind === "MISTAKE" ? "due_mistake_review" : "due_other_review";
}

export function buildSubjectTimerSummaries(input: {
  subjects: SubjectTimerSubjectInput[];
  groups: SubjectTimerGroupInput[];
}): SubjectTimerSummary {
  return {
    subjects: input.subjects
      .filter((subject) => !subject.archived)
      .map((subject) => ({
        subjectId: subject.subjectId,
        title: subject.title,
        groupId: subject.groupId,
        groupTitle: subject.groupTitle,
        todayEffectiveMinutes: subject.todayEffectiveMinutes,
        last7EffectiveMinutes: subject.last7EffectiveMinutes,
        contextSummary: subject.contextSummary,
        canStart: subject.canStart,
      })),
    groups: input.groups.map((group) => ({
      groupId: group.groupId,
      title: group.title,
      todayEffectiveMinutes: group.todayEffectiveMinutes,
      last7EffectiveMinutes: group.last7EffectiveMinutes,
      canStart: false as const,
    })),
  };
}
