import type { ConflictComparison } from "@/components/conflict-resolution-modal";
import { actionFilterOptions, mapStatusOptions, statusFilterOptions } from "@/components/syllabus-manager-labels";
import type {
  ActionFilter,
  FlatNode,
  MapStatusFilter,
  MasteryEvidenceFormDraft,
  MasteryEvidenceType,
  MasteryRetestFormDraft,
  MasteryRetestResult,
  StatusFilter,
  SyllabusConflict,
  SyllabusUpdateBaseline,
  SyllabusUpdateSubmission,
  UpdateNodeBody,
} from "@/components/syllabus-manager-types";
import type { SyllabusNodeDto, SyllabusNodeKindDto, SyllabusNodeStatusDto } from "@/lib/contracts";

export const syllabusCreateDraftKey = "areaforge.syllabus.draft.create";
export const syllabusImportDraftKey = "areaforge.syllabus.draft.import";

export function syllabusUpdateDraftKey(nodeId: string): string {
  return `areaforge.syllabus.draft.node.${nodeId}.update`;
}

export function syllabusEvidenceDraftKey(nodeId: string): string {
  return `areaforge.syllabus.draft.node.${nodeId}.evidence`;
}

export function syllabusRetestDraftKey(nodeId: string): string {
  return `areaforge.syllabus.draft.node.${nodeId}.retest`;
}

export function createSyllabusUpdateBaseline(node: SyllabusNodeDto): SyllabusUpdateBaseline {
  return {
    id: node.id,
    revision: node.revision,
    parentId: node.parentId,
    title: node.title,
    kind: node.kind,
    status: node.status,
    masteryLevel: node.masteryLevel,
    masteryConditions: [...node.masteryConditions],
    sortOrder: node.sortOrder,
    targetMinutes: node.targetMinutes,
  };
}

export function buildSyllabusConflictComparisons(conflict: SyllabusConflict): ConflictComparison[] {
  const fields = Array.from(new Set([
    "revision",
    ...conflict.conflictFields,
    ...Object.keys(conflict.submission.body),
  ]));
  return fields.map((field) => ({
    field,
    label: labelSyllabusConflictField(field),
    baseline: readSyllabusConflictValue(conflict.baseline, field),
    local: field === "revision"
      ? conflict.submission.expectedRevision
      : conflict.submission.body[field as keyof UpdateNodeBody]
        ?? readSyllabusConflictValue(conflict.baseline, field),
    server: readSyllabusConflictValue(conflict.latest, field),
  }));
}

export function collectClientConflictFields(body: UpdateNodeBody, latest: SyllabusNodeDto): string[] {
  const fields = ["revision"];
  for (const [field, value] of Object.entries(body)) {
    const latestValue = readSyllabusConflictValue(latest, field);
    if (JSON.stringify(value) !== JSON.stringify(latestValue)) fields.push(field);
  }
  return fields;
}

function readSyllabusConflictValue(
  source: SyllabusUpdateBaseline | SyllabusNodeDto,
  field: string,
): unknown {
  return field in source ? source[field as keyof typeof source] : undefined;
}

function labelSyllabusConflictField(field: string): string {
  const labels: Record<string, string> = {
    revision: "版本",
    parentId: "父节点",
    title: "标题",
    kind: "类型",
    status: "状态",
    masteryLevel: "掌握状态",
    masteryConditions: "掌握条件",
    sortOrder: "排序",
    targetMinutes: "目标分钟",
  };
  return labels[field] ?? field;
}

export function omitRecordKey(record: Record<string, number>, key: string): Record<string, number> {
  const next = { ...record };
  delete next[key];
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const syllabusNodeKinds: SyllabusNodeKindDto[] = ["subject", "chapter", "topic", "problem_type"];
const syllabusNodeStatuses: SyllabusNodeStatusDto[] = statusFilterOptions;
const masteryEvidenceTypes: MasteryEvidenceType[] = ["task", "session", "note", "mistake", "retest"];
const masteryRetestResults: MasteryRetestResult[] = ["passed", "partial", "failed"];

export function isSyllabusCreateDraft(value: unknown): value is {
  subjectId: string;
  parentId: string | null;
  title: string;
  kind: SyllabusNodeKindDto;
  status: SyllabusNodeStatusDto;
  targetMinutes: number;
} {
  if (!isRecord(value)) return false;
  return typeof value.subjectId === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.title === "string"
    && syllabusNodeKinds.includes(value.kind as SyllabusNodeKindDto)
    && syllabusNodeStatuses.includes(value.status as SyllabusNodeStatusDto)
    && typeof value.targetMinutes === "number";
}

export function isSyllabusImportDraft(value: unknown): value is {
  subjectId: string;
  parentId: string | null;
  markdown: string;
} {
  return isRecord(value)
    && typeof value.subjectId === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.markdown === "string";
}

export function isSyllabusUpdateSubmission(value: unknown): value is SyllabusUpdateSubmission {
  if (!isRecord(value) || !isRecord(value.body) || !isRecord(value.baseline)) return false;
  return typeof value.nodeId === "string"
    && Number.isInteger(value.expectedRevision)
    && value.expectedRevision as number > 0
    && typeof value.baseline.id === "string"
    && Number.isInteger(value.baseline.revision);
}

export function isSyllabusNodeDto(value: unknown): value is SyllabusNodeDto {
  return isRecord(value)
    && typeof value.id === "string"
    && Number.isInteger(value.revision)
    && typeof value.title === "string"
    && syllabusNodeStatuses.includes(value.status as SyllabusNodeStatusDto)
    && Array.isArray(value.masteryConditions);
}

export function isMasteryEvidenceFormDraft(value: unknown): value is MasteryEvidenceFormDraft {
  return isRecord(value)
    && masteryEvidenceTypes.includes(value.evidenceType as MasteryEvidenceType)
    && typeof value.evidenceReferenceId === "string"
    && typeof value.evidenceSummary === "string";
}

export function isMasteryRetestFormDraft(value: unknown): value is MasteryRetestFormDraft {
  return isRecord(value)
    && masteryRetestResults.includes(value.result as MasteryRetestResult)
    && typeof value.testedAt === "string"
    && typeof value.score === "string"
    && typeof value.summary === "string"
    && typeof value.nextReviewDate === "string";
}

export function isStatusFilter(value: string | undefined): value is StatusFilter {
  return value === "all" || syllabusNodeStatuses.includes(value as SyllabusNodeStatusDto);
}

export function isMapStatusFilter(value: string | undefined): value is MapStatusFilter {
  return value === "all" || mapStatusOptions.includes(value as SyllabusNodeDto["mapSignal"]["cellStatus"]);
}

export function isActionFilter(value: string | undefined): value is ActionFilter {
  return value === "all" || actionFilterOptions.some((option) => option.value === value);
}

export function buildSyllabusWorkbenchHref(input: {
  query?: string;
  subject: string;
  status: StatusFilter;
  map: MapStatusFilter;
  action: ActionFilter;
}): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.subject) params.set("subjectId", input.subject);
  if (input.status !== "all") params.set("status", input.status);
  if (input.map !== "all") params.set("map", input.map);
  if (input.action !== "all") params.set("action", input.action);
  return `/knowledge/syllabi${params.size ? `?${params}` : ""}`;
}

export function countStatuses(nodes: SyllabusNodeDto[]): Record<SyllabusNodeStatusDto, number> {
  const counts: Record<SyllabusNodeStatusDto, number> = {
    not_started: 0,
    learning: 0,
    covered: 0,
    needs_review: 0,
    mastered: 0,
    weak: 0,
    deferred: 0,
  };
  for (const node of flattenTree(nodes)) counts[node.status] += 1;
  return counts;
}

export function countMapStatuses(
  nodes: SyllabusNodeDto[],
): Record<SyllabusNodeDto["mapSignal"]["cellStatus"], number> {
  const counts: Record<SyllabusNodeDto["mapSignal"]["cellStatus"], number> = {
    not_started: 0,
    learning: 0,
    covered: 0,
    verified: 0,
    weak: 0,
    forgetting_risk: 0,
    mistake_hotspot: 0,
    deferred: 0,
  };
  for (const node of flattenTree(nodes)) counts[node.mapSignal.cellStatus] += 1;
  return counts;
}

export function countActions(nodes: SyllabusNodeDto[]): Record<Exclude<ActionFilter, "all">, number> {
  const counts: Record<Exclude<ActionFilter, "all">, number> = {
    risk: 0,
    evidence: 0,
    review: 0,
    start: 0,
    deferred: 0,
  };
  for (const node of flattenTree(nodes)) {
    for (const option of actionFilterOptions) {
      if (nodeMatchesAction(node, option.value)) counts[option.value] += 1;
    }
  }
  return counts;
}

export function filterNodesByStatusMapAndAction(
  nodes: SyllabusNodeDto[],
  statusFilter: StatusFilter,
  mapStatusFilter: MapStatusFilter,
  actionFilter: ActionFilter,
): SyllabusNodeDto[] {
  return nodes.flatMap((node) => {
    const children = filterNodesByStatusMapAndAction(node.children, statusFilter, mapStatusFilter, actionFilter);
    const statusMatches = statusFilter === "all" || node.status === statusFilter;
    const mapStatusMatches = mapStatusFilter === "all" || node.mapSignal.cellStatus === mapStatusFilter;
    const actionMatches = actionFilter === "all" || nodeMatchesAction(node, actionFilter);
    return (statusMatches && mapStatusMatches && actionMatches) || children.length > 0
      ? [{ ...node, children }]
      : [];
  });
}

function nodeMatchesAction(node: SyllabusNodeDto, actionFilter: Exclude<ActionFilter, "all">): boolean {
  switch (actionFilter) {
    case "risk":
      return node.mapSignal.markers.includes("warning");
    case "evidence":
      return node.masteryProof.evidenceCount === 0 || node.masteryProof.risk === "thin_evidence";
    case "review":
      return node.mapSignal.cellStatus === "forgetting_risk" || node.masteryProof.risk === "stale_evidence";
    case "start":
      return node.mapSignal.cellStatus === "not_started" || node.mapSignal.cellStatus === "learning";
    case "deferred":
      return node.mapSignal.cellStatus === "deferred";
  }
}

export function flattenTree(nodes: SyllabusNodeDto[]): SyllabusNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

export function insertSyllabusNode(nodes: SyllabusNodeDto[], created: SyllabusNodeDto): SyllabusNodeDto[] {
  if (flattenTree(nodes).some((node) => node.id === created.id)) return nodes;
  if (!created.parentId) return sortSyllabusNodes([...nodes, created]);
  return nodes.map((node) => node.id === created.parentId
    ? { ...node, children: sortSyllabusNodes([...node.children, created]) }
    : { ...node, children: insertSyllabusNode(node.children, created) });
}

function sortSyllabusNodes(nodes: SyllabusNodeDto[]): SyllabusNodeDto[] {
  return nodes.sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "zh-CN"));
}

export function flattenNodes(nodes: SyllabusNodeDto[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [
    { id: node.id, subjectId: node.subjectId, title: node.title, depth },
    ...flattenNodes(node.children, depth + 1),
  ]);
}

export function findNodeById(nodes: SyllabusNodeDto[], id: string): SyllabusNodeDto | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children, id);
    if (child) return child;
  }
  return null;
}
