import "server-only";

import { findActiveWorkspaceOrNull, listWorkspaceSubjects } from "./exam-workspace-service";
import { listKnowledgePoints } from "./knowledge-point-service";
import { listPlanMilestones } from "./plan-milestone-service";
import { getPlanRolling } from "./plan-rolling-service";
import { listStagePlans } from "./stage-service";
import { getStudyResource } from "./study-resource-service";
import { listSyllabusOptionsShared } from "./syllabus-service";
import { loadTaskPageData } from "./task-page-data";
import type { SyllabusOptionNodeDto } from "@/lib/contracts/syllabus";

export interface PlanPageSearchParams {
  date?: string;
  subjectId?: string;
  status?: string;
  q?: string;
  createMinimum?: string;
  resourceId?: string;
  syllabusNodeId?: string;
  taskId?: string;
}

export async function loadPlanPageData(
  actorId: string,
  params: PlanPageSearchParams,
) {
  const plan = await getPlanRolling(actorId, {
    date: params.date,
    subjectId: params.subjectId,
    status: params.status,
    q: params.q,
  });
  if (plan.setupRequired) {
    return {
      plan,
      setupRequired: true as const,
      subjects: [],
      syllabusNodes: [],
      milestones: [],
      stagePlans: [],
      knowledgePoints: [],
      sourceResource: null,
      selectedTaskData: null,
    };
  }

  const workspace = await findActiveWorkspaceOrNull(actorId);
  const [subjects, syllabusNodes, milestones, stagePlans, knowledgePoints] = workspace
    ? await Promise.all([
      listWorkspaceSubjects(actorId, workspace.id),
      listSyllabusOptionsShared(actorId),
      listPlanMilestones(actorId),
      listStagePlans(actorId),
      listKnowledgePoints(actorId),
    ])
    : [[], [], [], [], []];
  const [resource, selectedTaskData] = await Promise.all([
    params.resourceId ? getStudyResource(actorId, params.resourceId) : null,
    params.taskId ? loadTaskPageData(actorId, params.taskId) : null,
  ]);
  const syllabusById = new Map(flattenSyllabusOptions(syllabusNodes).map((node) => [node.id, node]));
  const sourceNodeIds = resource?.syllabusNodeIds.filter((nodeId) =>
    syllabusById.get(nodeId)?.subjectId === resource.subjectId,
  ) ?? [];

  return {
    plan,
    setupRequired: false as const,
    subjects: subjects
      .filter((subject) => !subject.archivedAt)
      .map((subject) => ({ id: subject.id, name: subject.name })),
    syllabusNodes,
    milestones,
    stagePlans,
    knowledgePoints,
    sourceResource: resource ? {
      id: resource.id,
      title: resource.title,
      subjectId: resource.subjectId,
      syllabusNodeId: sourceNodeIds.length === 1 ? sourceNodeIds[0] ?? null : null,
      archived: Boolean(resource.archivedAt),
    } : null,
    selectedTaskData,
  };
}

function flattenSyllabusOptions(nodes: SyllabusOptionNodeDto[]): SyllabusOptionNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenSyllabusOptions(node.children)]);
}
