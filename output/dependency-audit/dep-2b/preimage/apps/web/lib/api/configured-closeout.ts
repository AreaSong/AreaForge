import { requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  KnowledgeRetestDetailDto,
  SimulationExamDto,
  SimulationRemediationDto,
  SubjectDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";

interface ConfiguredRetestResponse {
  retest?: KnowledgeRetestDetailDto;
  error?: string;
  workbench?: string;
}

interface ConfiguredSimulationExamResponse {
  exam?: SimulationExamDto;
  error?: string;
  workbench?: string;
}

interface ConfiguredSubjectsResponse {
  subjects?: SubjectDto[];
  error?: string;
  workbench?: string;
}

interface ConfiguredSyllabusResponse {
  nodes?: SyllabusNodeLike[];
  error?: string;
  workbench?: string;
}

interface ConfiguredSimulationRemediationsResponse {
  remediations?: SimulationRemediationDto[];
  error?: string;
  workbench?: string;
}

interface SyllabusNodeLike {
  id: string;
  subjectId: string;
  title: string;
  children?: SyllabusNodeLike[];
}

const noStore = { cache: "no-store" } as const;

function getConfiguredRetest(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ConfiguredRetestResponse>> {
  return requestApiResult(
    `/api/knowledge-retests/${encodeURIComponent(id)}`,
    { ...noStore, signal },
  );
}

function getConfiguredSimulationExam(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ConfiguredSimulationExamResponse>> {
  return requestApiResult(
    `/api/simulation-exams/${encodeURIComponent(id)}`,
    { ...noStore, signal },
  );
}

function listConfiguredSubjects(
  signal?: AbortSignal,
): Promise<ApiResult<ConfiguredSubjectsResponse>> {
  return requestApiResult("/api/subjects", { ...noStore, signal });
}

function getConfiguredSyllabus(
  signal?: AbortSignal,
): Promise<ApiResult<ConfiguredSyllabusResponse>> {
  return requestApiResult("/api/syllabus", { ...noStore, signal });
}

function listConfiguredSimulationRemediations(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ConfiguredSimulationRemediationsResponse>> {
  return requestApiResult(
    `/api/simulation-exams/${encodeURIComponent(id)}/remediations`,
    { ...noStore, signal },
  );
}

export async function loadConfiguredRetest(
  id: string,
  signal?: AbortSignal,
): Promise<ApiResult<ConfiguredRetestResponse>> {
  return getConfiguredRetest(id, signal);
}

export async function loadConfiguredSimulation(
  id: string,
  signal?: AbortSignal,
): Promise<ConfiguredSimulationResult> {
  const [exam, subjects, syllabus, remediations] = await Promise.all([
    getConfiguredSimulationExam(id, signal),
    listConfiguredSubjects(signal),
    getConfiguredSyllabus(signal),
    listConfiguredSimulationRemediations(id, signal),
  ]);
  return { exam, subjects, syllabus, remediations };
}

interface ConfiguredSimulationResult {
  exam: ApiResult<ConfiguredSimulationExamResponse>;
  subjects: ApiResult<ConfiguredSubjectsResponse>;
  syllabus: ApiResult<ConfiguredSyllabusResponse>;
  remediations: ApiResult<ConfiguredSimulationRemediationsResponse>;
}

export function toConfiguredSyllabusOptions(
  nodes: SyllabusNodeLike[],
): SyllabusOptionNodeDto[] {
  return nodes.map((node) => ({
    id: node.id,
    subjectId: node.subjectId,
    title: node.title,
    children: toConfiguredSyllabusOptions(node.children ?? []),
  }));
}
