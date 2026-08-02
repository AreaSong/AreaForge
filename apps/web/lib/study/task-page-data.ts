import "server-only";

import { listPlanMilestones } from "./plan-milestone-service";
import { listSubjects } from "./service";
import { listSyllabusOptionsShared } from "./syllabus-service";
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
      dependencyCandidates: [],
    };
  }
  const [subjects, syllabusNodes, milestones, dependencyCandidates] = await Promise.all([
    listSubjects(actorId),
    listSyllabusOptionsShared(actorId),
    listPlanMilestones(actorId),
    listTaskDependencyCandidates(actorId, taskId),
  ]);
  return { detail, dependencies, subjects, syllabusNodes, milestones, dependencyCandidates };
}
