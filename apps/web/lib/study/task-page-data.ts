import "server-only";

import { listPlanMilestones } from "./plan-milestone-service";
import { listStagePlans } from "./stage-service";
import { listSubjects } from "./service";
import { listSyllabusOptionsShared } from "./syllabus-service";
import { listKnowledgePoints } from "./knowledge-point-service";
import { listOwnedTaskDependencies } from "./task-dependency-service";
import { getStudyTaskDetail, listTaskDependencyCandidates } from "./task-detail-service";

export async function loadTaskPageData(actorId: string, taskId: string) {
  const [detail, dependencies] = await Promise.all([
    getStudyTaskDetail(actorId, taskId),
    listOwnedTaskDependencies(actorId, taskId),
  ]);
  if (detail.readOnly) {
    return {
      detail,
      dependencies,
      subjects: [],
      syllabusNodes: [],
      milestones: [],
      stagePlans: [],
      dependencyCandidates: [],
      knowledgePoints: [],
    };
  }
  const [subjects, syllabusNodes, milestones, stagePlans, dependencyCandidates, knowledgePoints] = await Promise.all([
    listSubjects(actorId),
    listSyllabusOptionsShared(actorId),
    listPlanMilestones(actorId),
    listStagePlans(actorId),
    listTaskDependencyCandidates(actorId, taskId),
    listKnowledgePoints(actorId),
  ]);
  return { detail, dependencies, subjects, syllabusNodes, milestones, stagePlans, dependencyCandidates, knowledgePoints };
}
