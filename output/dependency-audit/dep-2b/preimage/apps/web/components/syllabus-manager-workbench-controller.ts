"use client";

import {
  buildSyllabusWorkbenchHref,
  countActions,
  countMapStatuses,
  countStatuses,
  filterNodesByStatusMapAndAction,
  findNodeById,
  flattenNodes,
  flattenTree,
  insertSyllabusNode,
  isActionFilter,
  isMapStatusFilter,
  isStatusFilter,
} from "@/components/syllabus-manager-support";
import type {
  ActionFilter,
  MapStatusFilter,
  StatusFilter,
  SyllabusManagerProps,
} from "@/components/syllabus-manager-types";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import type { SyllabusNodeDto } from "@/lib/contracts";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

export function useSyllabusWorkbenchController(props: SyllabusManagerProps) {
  const router = useRouter();
  const [createdNodes, setCreatedNodes] = useState<SyllabusNodeDto[]>([]);
  const [subjectId, setSubjectId] = useState(() => getInitialSubjectId(props));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    isStatusFilter(props.initialStatusFilter) ? props.initialStatusFilter : "all",
  );
  const [mapStatusFilter, setMapStatusFilter] = useState<MapStatusFilter>(() =>
    isMapStatusFilter(props.initialMapStatusFilter) ? props.initialMapStatusFilter : "all",
  );
  const [actionFilter, setActionFilter] = useState<ActionFilter>(() =>
    isActionFilter(props.initialActionFilter) ? props.initialActionFilter : "all",
  );
  const [isFiltering, startFilterTransition] = useTransition();

  const displayNodes = useMemo(
    () => createdNodes.reduce(insertSyllabusNode, props.nodes),
    [createdNodes, props.nodes],
  );
  const subjectNodes = useMemo(
    () => displayNodes.filter((node) => node.subjectId === subjectId),
    [displayNodes, subjectId],
  );
  const subjectFlatNodeCount = useMemo(() => flattenTree(subjectNodes).length, [subjectNodes]);
  const parentOptions = useMemo(
    () => flattenNodes(displayNodes).filter((node) => node.subjectId === subjectId),
    [displayNodes, subjectId],
  );
  const statusCounts = useMemo(() => countStatuses(subjectNodes), [subjectNodes]);
  const mapStatusCounts = useMemo(() => countMapStatuses(subjectNodes), [subjectNodes]);
  const actionCounts = useMemo(() => countActions(subjectNodes), [subjectNodes]);
  const selectedSummary = props.summaryBySubject[subjectId] ?? props.summary;
  const focusNodes = useMemo(
    () => selectedSummary.focusNodeIds
      .map((id) => findNodeById(subjectNodes, id))
      .filter((node): node is SyllabusNodeDto => Boolean(node)),
    [selectedSummary.focusNodeIds, subjectNodes],
  );
  const filteredSubjectNodes = useMemo(
    () => filterNodesByStatusMapAndAction(subjectNodes, statusFilter, mapStatusFilter, actionFilter),
    [subjectNodes, statusFilter, mapStatusFilter, actionFilter],
  );
  const filteredNodeCount = useMemo(
    () => flattenTree(filteredSubjectNodes).length,
    [filteredSubjectNodes],
  );
  const hasWorkbenchFilters = statusFilter !== "all"
    || mapStatusFilter !== "all"
    || actionFilter !== "all";
  const currentWorkbenchHref = buildSyllabusWorkbenchHref({
    query: props.initialQuery,
    subject: subjectId,
    status: statusFilter,
    map: mapStatusFilter,
    action: actionFilter,
  });

  function applyFilters(next: Partial<{
    subject: string;
    status: StatusFilter;
    map: MapStatusFilter;
    action: ActionFilter;
  }>) {
    const nextSubject = next.subject ?? subjectId;
    const nextStatus = next.status ?? statusFilter;
    const nextMap = next.map ?? mapStatusFilter;
    const nextAction = next.action ?? actionFilter;
    setSubjectId(nextSubject);
    setStatusFilter(nextStatus);
    setMapStatusFilter(nextMap);
    setActionFilter(nextAction);
    updateKnowledgeContext({ subjectId: nextSubject || null, syllabusNodeId: null });
    startFilterTransition(() => router.replace(buildSyllabusWorkbenchHref({
      query: props.initialQuery,
      subject: nextSubject,
      status: nextStatus,
      map: nextMap,
      action: nextAction,
    })));
  }

  function addCreatedNode(node: SyllabusNodeDto) {
    setCreatedNodes((current) => current.some((item) => item.id === node.id)
      ? current
      : [...current, node]);
  }

  return {
    subjects: props.subjects,
    initialQuery: props.initialQuery,
    subjectId,
    setSubjectId,
    displayNodes,
    subjectNodes,
    subjectFlatNodeCount,
    parentOptions,
    statusFilter,
    mapStatusFilter,
    actionFilter,
    statusCounts,
    mapStatusCounts,
    actionCounts,
    selectedSummary,
    focusNodes,
    filteredSubjectNodes,
    filteredNodeCount,
    hasWorkbenchFilters,
    currentWorkbenchHref,
    isFiltering,
    applyFilters,
    addCreatedNode,
  };
}

export type SyllabusWorkbenchController = ReturnType<typeof useSyllabusWorkbenchController>;

function getInitialSubjectId(props: SyllabusManagerProps): string {
  if (props.initialSubjectId && props.subjects.some((subject) => subject.id === props.initialSubjectId)) {
    return props.initialSubjectId;
  }
  return props.subjects[0]?.id ?? "";
}
