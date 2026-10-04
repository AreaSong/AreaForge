export type RecoveryTaskStatus = "todo" | "in_progress" | "done" | "skipped" | "deferred";

export type RecoveryTaskPriority = "low" | "medium" | "high" | "critical";

export interface RecoveryTaskCandidateInput {
  id: string;
  title: string;
  subject: string;
  status: RecoveryTaskStatus;
  priority: RecoveryTaskPriority;
  estimatedMinutes: number;
  actualMinutes?: number;
}

export interface RankRecoveryTaskCandidatesInput {
  todayTasks: RecoveryTaskCandidateInput[];
  debtTasks: RecoveryTaskCandidateInput[];
  limit?: number;
}

export interface RankedRecoveryTaskCandidate extends RecoveryTaskCandidateInput {
  source: "debt" | "today";
  rank: number;
  reason: string;
}

export function rankRecoveryTaskCandidates(
  input: RankRecoveryTaskCandidatesInput,
): RankedRecoveryTaskCandidate[] {
  const seen = new Set<string>();
  const candidates = [
    ...input.debtTasks.map((task) => ({ task, source: "debt" as const })),
    ...input.todayTasks.map((task) => ({ task, source: "today" as const })),
  ]
    .filter(({ task }) => task.status !== "done" && task.status !== "skipped")
    .filter(({ task }) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    })
    .sort(compareRecoveryCandidates);

  return candidates.slice(0, input.limit ?? candidates.length).map(({ task, source }, index) => ({
    ...task,
    source,
    rank: index + 1,
    reason: createRecoveryCandidateReason(task, source),
  }));
}

export function selectRecoveryTaskCandidate(
  input: RankRecoveryTaskCandidatesInput,
): RankedRecoveryTaskCandidate | null {
  return rankRecoveryTaskCandidates({ ...input, limit: 1 })[0] ?? null;
}

function compareRecoveryCandidates(
  left: { task: RecoveryTaskCandidateInput; source: "debt" | "today" },
  right: { task: RecoveryTaskCandidateInput; source: "debt" | "today" },
): number {
  const sourceDiff = sourceRank(right.source) - sourceRank(left.source);
  if (sourceDiff !== 0) return sourceDiff;

  const priorityDiff = priorityRank(right.task.priority) - priorityRank(left.task.priority);
  if (priorityDiff !== 0) return priorityDiff;

  const minuteDiff = left.task.estimatedMinutes - right.task.estimatedMinutes;
  if (minuteDiff !== 0) return minuteDiff;

  const actualDiff = (left.task.actualMinutes ?? 0) - (right.task.actualMinutes ?? 0);
  if (actualDiff !== 0) return actualDiff;

  return left.task.title.localeCompare(right.task.title, "zh-Hans-CN");
}

function createRecoveryCandidateReason(
  task: RecoveryTaskCandidateInput,
  source: "debt" | "today",
): string {
  if (source === "debt") {
    return `恢复模式优先处理欠账：「${task.title}」仍未完成，且预计 ${task.estimatedMinutes} 分钟。`;
  }

  return `当前没有更靠前的欠账候选，可用今日任务「${task.title}」作为最小恢复动作。`;
}

function sourceRank(source: "debt" | "today"): number {
  return source === "debt" ? 2 : 1;
}

function priorityRank(priority: RecoveryTaskPriority): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}
