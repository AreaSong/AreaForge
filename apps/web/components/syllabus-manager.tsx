"use client";

import { ArrowRight, ChevronRight, ClipboardCheck, Plus, RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ConflictResolutionModal, type ConflictComparison } from "@/components/conflict-resolution-modal";
import { ListDetailLink } from "@/components/list-return-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import { Toolbar } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import { withReturnTo } from "@/lib/navigation/batch7";
import {
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
  SHORT_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import type {
  MasteryEvidenceTypeDto,
  MasteryLevelDto,
  MasteryRetestResultDto,
  SubjectDto,
  SyllabusMapOverviewDto,
  SyllabusNodeDto,
  SyllabusNodeKindDto,
  SyllabusNodeStatusDto,
} from "@/lib/study/types";

interface SyllabusManagerProps {
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

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

type StatusFilter = "all" | SyllabusNodeStatusDto;
type MapStatusFilter = "all" | SyllabusNodeDto["mapSignal"]["cellStatus"];
type ActionFilter = "all" | "risk" | "evidence" | "review" | "start" | "deferred";
type MasteryCondition = SyllabusNodeDto["masteryConditions"][number];
type MasteryEvidenceType = MasteryEvidenceTypeDto;
type MasteryRetestResult = MasteryRetestResultDto;
type UpdateNodeBody = Partial<{
  status: SyllabusNodeStatusDto;
  masteryLevel: MasteryLevelDto | null;
  masteryConditions: MasteryCondition[];
  targetMinutes: number;
}>;
type SyllabusUpdateBaseline = Pick<
  SyllabusNodeDto,
  "id" | "revision" | "parentId" | "title" | "kind" | "status" | "masteryLevel" | "masteryConditions" | "sortOrder" | "targetMinutes"
>;
type SyllabusUpdateSubmission = {
  nodeId: string;
  expectedRevision: number;
  baseline: SyllabusUpdateBaseline;
  body: UpdateNodeBody;
};
type SyllabusConflict = {
  baseline: SyllabusUpdateBaseline;
  submission: SyllabusUpdateSubmission;
  latest: SyllabusNodeDto;
  conflictFields: string[];
};
type ApiFailure = {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
};
type AddMasteryEvidenceBody = {
  evidenceType: MasteryEvidenceType;
  taskId?: string;
  sessionId?: string;
  noteId?: string;
  mistakeId?: string;
  retestId?: string;
  summary?: string;
};
type AddMasteryRetestBody = {
  testedAt?: string;
  result: MasteryRetestResult;
  score?: string;
  summary?: string;
  nextReviewAt?: string | null;
};
type MasteryEvidenceFormDraft = {
  evidenceType: MasteryEvidenceType;
  evidenceReferenceId: string;
  evidenceSummary: string;
};
type MasteryRetestFormDraft = {
  result: MasteryRetestResult;
  testedAt: string;
  score: string;
  summary: string;
  nextReviewDate: string;
};

export function SyllabusManager({ subjects, nodes, summary, summaryBySubject, initialSubjectId, initialQuery, initialStatusFilter, initialMapStatusFilter, initialActionFilter, initialCreate }: SyllabusManagerProps) {
  const router = useRouter();
  const [createdNodes, setCreatedNodes] = useState<SyllabusNodeDto[]>([]);
  const displayNodes = useMemo(
    () => createdNodes.reduce(insertSyllabusNode, nodes),
    [createdNodes, nodes],
  );
  const [subjectId, setSubjectId] = useState(subjects.some((subject) => subject.id === initialSubjectId) ? initialSubjectId as string : subjects[0]?.id ?? "");
  const [parentId, setParentId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SyllabusNodeKindDto>("topic");
  const [status, setStatus] = useState<SyllabusNodeStatusDto>("not_started");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => isStatusFilter(initialStatusFilter) ? initialStatusFilter : "all");
  const [mapStatusFilter, setMapStatusFilter] = useState<MapStatusFilter>(() => isMapStatusFilter(initialMapStatusFilter) ? initialMapStatusFilter : "all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>(() => isActionFilter(initialActionFilter) ? initialActionFilter : "all");
  const [targetMinutes, setTargetMinutes] = useState(45);
  const [importMarkdown, setImportMarkdown] = useState("");
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SyllabusConflict | null>(null);
  const [revisionOverrides, setRevisionOverrides] = useState<Record<string, number>>({});
  const [restoredSubmission, setRestoredSubmission] = useState<SyllabusUpdateSubmission | null>(null);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(Boolean(initialCreate));
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const createDraft = loadPrivateBusinessDraft(
        syllabusCreateDraftKey,
        SHORT_PRIVATE_DRAFT_TTL_MS,
        isSyllabusCreateDraft,
      );
      if (createDraft) {
        setSubjectId(subjects.some((subject) => subject.id === createDraft.subjectId) ? createDraft.subjectId : subjects[0]?.id ?? "");
        setParentId(createDraft.parentId ?? "");
        setTitle(createDraft.title);
        setKind(createDraft.kind);
        setStatus(createDraft.status);
        setTargetMinutes(createDraft.targetMinutes);
      }
      const importDraft = loadPrivateBusinessDraft(
        syllabusImportDraftKey,
        SHORT_PRIVATE_DRAFT_TTL_MS,
        isSyllabusImportDraft,
      );
      if (importDraft) {
        setSubjectId(subjects.some((subject) => subject.id === importDraft.subjectId) ? importDraft.subjectId : subjects[0]?.id ?? "");
        setParentId(importDraft.parentId ?? "");
        setImportMarkdown(importDraft.markdown);
      }
      for (const node of flattenTree(displayNodes)) {
        const updateDraft = loadPrivateBusinessDraft(
          syllabusUpdateDraftKey(node.id),
          SHORT_PRIVATE_DRAFT_TTL_MS,
          isSyllabusUpdateSubmission,
        );
        if (updateDraft) {
          setRestoredSubmission(updateDraft);
          break;
        }
      }
      setDraftsLoaded(true);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [displayNodes, subjects]);

  useEffect(() => {
    if (!draftsLoaded) return;
    if (!title.trim() && !parentId && kind === "topic" && status === "not_started" && targetMinutes === 45) {
      removePrivateBusinessDraft(syllabusCreateDraftKey);
      return;
    }
    savePrivateBusinessDraft(syllabusCreateDraftKey, {
      subjectId,
      parentId: parentId || null,
      title,
      kind,
      status,
      targetMinutes,
    });
  }, [draftsLoaded, subjectId, parentId, title, kind, status, targetMinutes]);

  useEffect(() => {
    if (!draftsLoaded) return;
    if (!importMarkdown.trim()) {
      removePrivateBusinessDraft(syllabusImportDraftKey);
      return;
    }
    savePrivateBusinessDraft(syllabusImportDraftKey, {
      subjectId,
      parentId: parentId || null,
      markdown: importMarkdown,
    });
  }, [draftsLoaded, subjectId, parentId, importMarkdown]);

  const subjectNodes = useMemo(() => displayNodes.filter((node) => node.subjectId === subjectId), [displayNodes, subjectId]);
  const subjectFlatNodeCount = useMemo(() => flattenTree(subjectNodes).length, [subjectNodes]);
  const flatNodes = useMemo(() => flattenNodes(displayNodes), [displayNodes]);
  const parentOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const statusCounts = useMemo(() => countStatuses(subjectNodes), [subjectNodes]);
  const mapStatusCounts = useMemo(() => countMapStatuses(subjectNodes), [subjectNodes]);
  const actionCounts = useMemo(() => countActions(subjectNodes), [subjectNodes]);
  const selectedSummary = summaryBySubject[subjectId] ?? summary;
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
  const filteredNodeCount = useMemo(() => flattenTree(filteredSubjectNodes).length, [filteredSubjectNodes]);
  const hasWorkbenchFilters = statusFilter !== "all" || mapStatusFilter !== "all" || actionFilter !== "all";
  const currentWorkbenchHref = buildSyllabusWorkbenchHref({ query: initialQuery, subject: subjectId, status: statusFilter, map: mapStatusFilter, action: actionFilter });

  function applyWorkbenchFilters(next: Partial<{
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
    startTransition(() => router.replace(buildSyllabusWorkbenchHref({ query: initialQuery, subject: nextSubject, status: nextStatus, map: nextMap, action: nextAction })));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setImportNotice(null);
    const payload = {
      subjectId,
      parentId: parentId || null,
      title,
      kind,
      status,
      targetMinutes,
    };
    const commandScope = `syllabus-node:${subjectId}:create`;
    savePrivateBusinessDraft(syllabusCreateDraftKey, payload);
    setPendingCommand("create");
    try {
      const response = await fetch("/api/syllabus/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "syllabus-node", payload),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiFailure | null;
        if (response.status === 401) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && body?.workbench === "/knowledge/syllabus") router.replace(body.workbench);
        setError(body?.error ?? "创建考纲节点失败，草稿与重试标识已保留");
        return;
      }

      const responseBody = (await response.json().catch(() => null)) as { node?: SyllabusNodeDto } | null;
      if (!responseBody?.node) {
        setError("服务端未返回已创建节点，当前输入与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(syllabusCreateDraftKey);
      setCreatedNodes((current) => current.some((node) => node.id === responseBody.node?.id)
        ? current
        : [...current, responseBody.node as SyllabusNodeDto]);
      setTitle("");
      setParentId("");
      setCreateOpen(false);
      router.push(withReturnTo(`/knowledge/syllabus/${responseBody.node.id}`, currentWorkbenchHref));
    } catch {
      setError("网络中断，创建草稿与同一重试标识已保留，请明确重试");
    } finally {
      setPendingCommand(null);
    }
  }

  async function submitImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setImportNotice(null);
    const payload = {
      subjectId,
      parentId: parentId || null,
      markdown: importMarkdown,
    };
    const commandScope = `syllabus-markdown-import:${subjectId}`;

    savePrivateBusinessDraft(syllabusImportDraftKey, payload);
    setPendingCommand("import");
    try {
      const response = await fetch("/api/syllabus/import-markdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "syllabus-import", payload),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiFailure | null;
        if (response.status === 401) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && body?.workbench === "/knowledge/syllabus") router.replace(body.workbench);
        setError(body?.error ?? "导入考纲失败，Markdown 与重试标识已保留");
        return;
      }

      const body = (await response.json()) as { import?: { importedCount: number; ignoredLines: number[] } };
      if (!body.import) {
        setError("服务端未返回导入结果，当前 Markdown 与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(syllabusImportDraftKey);
      const importedCount = body.import.importedCount;
      const ignoredCount = body.import.ignoredLines.length;
      setImportMarkdown("");
      setImportNotice(`已导入 ${importedCount} 个节点${ignoredCount > 0 ? `，忽略 ${ignoredCount} 行` : ""}。`);
      startTransition(() => router.refresh());
    } catch {
      setError("网络中断，导入草稿与同一重试标识已保留，请明确重试");
    } finally {
      setPendingCommand(null);
    }
  }

  async function updateNode(id: string, body: UpdateNodeBody): Promise<boolean> {
    setError(null);
    const baseline = findNodeById(displayNodes, id);
    if (!baseline) {
      setError("考纲节点已不在当前树中，请返回考纲工作台刷新");
      return false;
    }
    const submission: SyllabusUpdateSubmission = {
      nodeId: id,
      expectedRevision: revisionOverrides[id] ?? baseline.revision,
      baseline: createSyllabusUpdateBaseline(baseline),
      body: structuredClone(body),
    };
    savePrivateBusinessDraft(syllabusUpdateDraftKey(id), submission);
    setPendingCommand(`${id}:update`);
    try {
      const response = await fetch(`/api/syllabus/nodes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...submission.body, expectedRevision: submission.expectedRevision }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiFailure | null;
        if (response.status === 401) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && data?.workbench === "/knowledge/syllabus") router.replace(data.workbench);
        else if (response.status === 409 && isSyllabusNodeDto(data?.latest)) {
          setConflict({
            baseline,
            submission,
            latest: data.latest,
            conflictFields: data.conflictFields ?? ["revision"],
          });
        }
        setError(data?.error ?? "更新考纲节点失败，首次提交快照已保留");
        return false;
      }

      const responseBody = (await response.json().catch(() => null)) as { node?: SyllabusNodeDto } | null;
      if (!responseBody?.node) {
        setError("服务端未返回更新后的节点，首次提交快照仍保留");
        return false;
      }
      removePrivateBusinessDraft(syllabusUpdateDraftKey(id));
      setRestoredSubmission((current) => current?.nodeId === id ? null : current);
      setRevisionOverrides((current) => omitRecordKey(current, id));
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("网络中断，节点更新快照已保留，请先确认服务端状态再明确重试");
      return false;
    } finally {
      setPendingCommand(null);
    }
  }

  function retryRestoredUpdate() {
    if (!restoredSubmission) return;
    const latest = findNodeById(displayNodes, restoredSubmission.nodeId);
    if (!latest) {
      setError("草稿对应节点已不存在，请返回考纲工作台处理");
      return;
    }
    if (latest.revision !== restoredSubmission.expectedRevision) {
      setConflict({
        baseline: restoredSubmission.baseline,
        submission: restoredSubmission,
        latest,
        conflictFields: collectClientConflictFields(restoredSubmission.body, latest),
      });
      return;
    }
    void updateNode(restoredSubmission.nodeId, restoredSubmission.body);
  }

  async function addMasteryEvidence(id: string, body: AddMasteryEvidenceBody): Promise<boolean> {
    setError(null);
    setPendingCommand(`${id}:evidence`);
    try {
      const response = await fetch(`/api/syllabus/nodes/${id}/mastery-evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiFailure | null;
        if (response.status === 401) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && data?.workbench === "/knowledge/syllabus") router.replace(data.workbench);
        setError(data?.error ?? "新增掌握证据失败，输入草稿已保留");
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("网络中断，证据输入已保留，请明确重试");
      return false;
    } finally {
      setPendingCommand(null);
    }
  }

  async function addMasteryRetest(id: string, body: AddMasteryRetestBody): Promise<boolean> {
    setError(null);
    const commandScope = `mastery-retest:${id}`;
    setPendingCommand(`${id}:retest`);
    try {
      const response = await fetch(`/api/syllabus/nodes/${id}/mastery-retests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mastery-retest", body),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiFailure | null;
        if (response.status === 401) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && data?.workbench === "/knowledge/syllabus") router.replace(data.workbench);
        setError(data?.error ?? "新增复测记录失败，输入草稿与重试标识已保留");
        return false;
      }
      const responseBody = (await response.json().catch(() => null)) as { node?: SyllabusNodeDto } | null;
      if (!responseBody?.node) {
        setError("服务端未返回复测后的节点，当前输入与重试标识仍保留");
        return false;
      }
      completeIdempotentCommand(commandScope);
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError("网络中断，复测输入与同一重试标识已保留，请明确重试");
      return false;
    } finally {
      setPendingCommand(null);
    }
  }

  return (
    <>
      <Drawer open={createOpen} title="新增考纲节点" onClose={() => setCreateOpen(false)}>
        <form className="grid min-w-0 gap-3" onSubmit={submit}>
          <label className="grid min-w-0 gap-2 text-sm text-zinc-300">
            科目
            <select
              className="h-11 min-w-0 w-full rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100"
              value={subjectId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setParentId("");
                updateKnowledgeContext({ subjectId: event.target.value, syllabusNodeId: null });
              }}
              required
              disabled={pendingCommand !== null}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid min-w-0 gap-2 text-sm text-zinc-300">
            父节点
            <select
              className="h-11 min-w-0 w-full rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              disabled={pendingCommand !== null}
            >
              <option value="">作为根节点</option>
              {parentOptions.map((node) => (
                <option key={node.id} value={node.id}>
                  {"  ".repeat(node.depth)}
                  {node.title}
                </option>
              ))}
            </select>
          </label>

          <input
            className="h-11 min-w-0 w-full rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="章节、知识点或题型名称"
            required
            disabled={pendingCommand !== null}
          />

          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <select
              className="h-11 min-w-0 w-full rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={kind}
              onChange={(event) => setKind(event.target.value as SyllabusNodeKindDto)}
              disabled={pendingCommand !== null}
            >
              <option value="subject">科目</option>
              <option value="chapter">章节</option>
              <option value="topic">知识点</option>
              <option value="problem_type">题型专题</option>
            </select>
            <select
              className="h-11 min-w-0 w-full rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={status}
              onChange={(event) => setStatus(event.target.value as SyllabusNodeStatusDto)}
              disabled={pendingCommand !== null}
            >
              <StatusOptions />
            </select>
            <input
              className="h-11 min-w-0 w-full rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="number"
              min={0}
              max={100000}
              value={targetMinutes}
              onChange={(event) => setTargetMinutes(Number(event.target.value))}
              aria-label="目标分钟"
              disabled={pendingCommand !== null}
            />
          </div>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || pendingCommand !== null || !subjectId}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            写入考纲
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}

        <div className="mt-6 border-t border-white/10 pt-5">
          <h3 className="text-sm font-medium text-zinc-100">Markdown 导入</h3>
          <form className="mt-3 grid min-w-0 gap-3" onSubmit={submitImport}>
            <textarea
              className="min-h-36 min-w-0 w-full rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={importMarkdown}
              onChange={(event) => setImportMarkdown(event.target.value)}
              placeholder={"# 第一章\n## 极限\n- 极限定义\n  - 夹逼准则"}
              required
              disabled={pendingCommand !== null}
            />
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-teal-300/25 px-4 font-medium text-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isPending || pendingCommand !== null || !subjectId || importMarkdown.trim().length === 0}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              导入节点
            </button>
          </form>
          {importNotice ? <p className="mt-3 text-sm text-teal-200">{importNotice}</p> : null}
        </div>
      </Drawer>

      {!createOpen && error ? <p className="text-sm text-red-200">{error}</p> : null}
      <Toolbar label="考纲筛选">
        <select aria-label="筛选考纲科目" className="h-10 min-w-0 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-zinc-200" value={subjectId} onChange={(event) => applyWorkbenchFilters({ subject: event.target.value })}>
          {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
        {initialQuery ? <Badge tone="info">搜索：{initialQuery}</Badge> : null}
        {hasWorkbenchFilters ? <Button type="button" size="sm" variant="ghost" onClick={() => applyWorkbenchFilters({ status: "all", map: "all", action: "all" })}>清除筛选</Button> : null}
      </Toolbar>
      <section className="min-w-0 rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-zinc-400">作战地图</p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {subjects.find((subject) => subject.id === subjectId)?.name ?? "未选择科目"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
              {filteredNodeCount} / {subjectFlatNodeCount} 个节点
            </span>
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              新增节点
            </Button>
          </div>
        </div>

        <div className="mt-5 border-y border-white/10 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryMetric label="覆盖率" value={`${selectedSummary.coverageRate}%`} />
            <SummaryMetric label="验证率" value={`${selectedSummary.verificationRate}%`} />
            <SummaryMetric label="风险等级" value={labelMapRisk(selectedSummary.riskLevel)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {selectedSummary.recommendedFilters.length > 0 ? (
              selectedSummary.recommendedFilters.map((filter) => (
                <button
                  key={filter}
                  className={`rounded-md border px-2.5 py-1 text-xs transition ${
                    mapStatusFilter === filter
                      ? "border-teal-300/50 bg-teal-300/15 text-teal-50"
                      : "border-teal-300/20 text-teal-100 hover:bg-teal-400/10"
                  }`}
                  type="button"
                  onClick={() => applyWorkbenchFilters({ map: mapStatusFilter === filter ? "all" : filter })}
                >
                  {labelMapCell(filter)} {mapStatusCounts[filter] ?? 0}
                </button>
              ))
            ) : (
              <span className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-400">
                暂无推荐筛选
              </span>
            )}
            {mapStatusFilter !== "all" ? (
              <button
                className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
                type="button"
                onClick={() => applyWorkbenchFilters({ map: "all" })}
              >
                清除地图筛选
              </button>
            ) : null}
          </div>
          <div className="mt-4 grid gap-2 text-sm text-zinc-300">
            {selectedSummary.nextActions.slice(0, 3).map((action) => (
              <p key={action}>{action}</p>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {mapStatusOptions.map((option) => (
              <MapStatusButton
                key={option}
                active={mapStatusFilter === option}
                count={mapStatusCounts[option]}
                label={labelMapCell(option)}
                onClick={() => applyWorkbenchFilters({ map: mapStatusFilter === option ? "all" : option })}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {actionFilterOptions.map((option) => (
              <ActionFilterButton
                key={option.value}
                active={actionFilter === option.value}
                count={actionCounts[option.value]}
                label={option.label}
                onClick={() => applyWorkbenchFilters({ action: actionFilter === option.value ? "all" : option.value })}
              />
            ))}
          </div>
          {actionFilter !== "all" ? (
            <button
              className="mt-3 rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
              type="button"
              onClick={() => applyWorkbenchFilters({ action: "all" })}
            >
              清除行动筛选
            </button>
          ) : null}
          {focusNodes.length > 0 ? (
            <div className="mt-4 grid gap-2">
              <p className="text-xs text-zinc-500">优先处理节点</p>
              {focusNodes.slice(0, 3).map((node) => (
                <button
                  key={node.id}
                  className="rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-left hover:bg-white/10"
                  type="button"
                  onClick={() => applyWorkbenchFilters({ map: node.mapSignal.cellStatus })}
                >
                  <span className="block text-sm text-zinc-100">{node.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-400">
                    {labelMapCell(node.mapSignal.cellStatus)} / {node.mapSignal.nextAction}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusFilterButton
            active={statusFilter === "all"}
            count={subjectFlatNodeCount}
            label="全部"
            onClick={() => applyWorkbenchFilters({ status: "all" })}
          />
          {statusFilterOptions.map((option) => (
            <StatusFilterButton
              key={option}
              active={statusFilter === option}
              count={statusCounts[option]}
              label={labelStatus(option)}
              onClick={() => applyWorkbenchFilters({ status: option })}
            />
          ))}
        </div>

        <div className="mt-5 grid gap-3">
          {restoredSubmission ? (
            <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-50">
              <p>检测到上次未确认终态的节点更新。系统不会自动重放。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-9 rounded-md bg-amber-200 px-3 font-medium text-black"
                  onClick={retryRestoredUpdate}
                  disabled={pendingCommand !== null}
                >
                  检查并再次提交
                </button>
                <button
                  type="button"
                  className="h-9 rounded-md border border-white/10 px-3"
                  onClick={() => {
                    removePrivateBusinessDraft(syllabusUpdateDraftKey(restoredSubmission.nodeId));
                    setRestoredSubmission(null);
                  }}
                  disabled={pendingCommand !== null}
                >
                  放弃这份草稿
                </button>
              </div>
            </div>
          ) : null}
          {subjectNodes.length === 0 ? (
            <EmptyState title={initialQuery ? "没有匹配的考纲节点" : "这个科目还没有考纲节点"} description={initialQuery ? "尝试修改搜索词或切换科目。" : "先建立第一个章节或知识点。"} />
          ) : null}
          {subjectNodes.length > 0 && filteredSubjectNodes.length === 0 ? (
            <EmptyState title="当前筛选没有结果" description="调整状态、地图或行动筛选，或清除筛选查看全部节点。" action={<Button type="button" size="sm" onClick={() => applyWorkbenchFilters({ status: "all", map: "all", action: "all" })}>清除筛选</Button>} />
          ) : null}
          {filteredSubjectNodes.map((node) => (
            <SyllabusTreeNode
              key={`${node.id}:${node.masteryLevel ?? "none"}:${node.masteryConditions.join("|")}`}
              node={node}
              onUpdate={updateNode}
              onAddMasteryEvidence={addMasteryEvidence}
              onAddMasteryRetest={addMasteryRetest}
              pendingCommand={pendingCommand}
            />
          ))}
        </div>
      </section>
    <ConflictResolutionModal
      open={conflict !== null}
      title="考纲节点已被其他页面更新"
      description="旧 revision 已失效。系统不会自动覆盖任何一方；请选择采用服务端，或保留本地输入并在检查差异后再次明确提交。"
      conflictFields={conflict?.conflictFields ?? []}
      comparisons={conflict ? buildSyllabusConflictComparisons(conflict) : []}
      onAdoptServer={() => {
        if (!conflict) return;
        removePrivateBusinessDraft(syllabusUpdateDraftKey(conflict.submission.nodeId));
        setRestoredSubmission((current) => current?.nodeId === conflict.submission.nodeId ? null : current);
        setRevisionOverrides((current) => omitRecordKey(current, conflict.submission.nodeId));
        setConflict(null);
        setError("已采用服务端版本");
        startTransition(() => router.refresh());
      }}
      onManualMerge={() => {
        if (!conflict) return;
        setRevisionOverrides((current) => ({
          ...current,
          [conflict.submission.nodeId]: conflict.latest.revision,
        }));
        setConflict(null);
        setError("已载入服务端最新 revision，本地输入仍保留；检查后请再次点击保存，不会自动重放");
      }}
    />
    </>
  );
}

const syllabusCreateDraftKey = "areaforge.syllabus.draft.create";
const syllabusImportDraftKey = "areaforge.syllabus.draft.import";

function syllabusUpdateDraftKey(nodeId: string): string {
  return `areaforge.syllabus.draft.node.${nodeId}.update`;
}

function syllabusEvidenceDraftKey(nodeId: string): string {
  return `areaforge.syllabus.draft.node.${nodeId}.evidence`;
}

function syllabusRetestDraftKey(nodeId: string): string {
  return `areaforge.syllabus.draft.node.${nodeId}.retest`;
}

function createSyllabusUpdateBaseline(node: SyllabusNodeDto): SyllabusUpdateBaseline {
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

function buildSyllabusConflictComparisons(conflict: SyllabusConflict): ConflictComparison[] {
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

function collectClientConflictFields(body: UpdateNodeBody, latest: SyllabusNodeDto): string[] {
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
    masteryLevel: "掌握等级",
    masteryConditions: "掌握条件",
    sortOrder: "排序",
    targetMinutes: "目标分钟",
  };
  return labels[field] ?? field;
}

function omitRecordKey(record: Record<string, number>, key: string): Record<string, number> {
  const next = { ...record };
  delete next[key];
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSyllabusCreateDraft(value: unknown): value is {
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

function isSyllabusImportDraft(value: unknown): value is {
  subjectId: string;
  parentId: string | null;
  markdown: string;
} {
  return isRecord(value)
    && typeof value.subjectId === "string"
    && (value.parentId === null || typeof value.parentId === "string")
    && typeof value.markdown === "string";
}

function isSyllabusUpdateSubmission(value: unknown): value is SyllabusUpdateSubmission {
  if (!isRecord(value) || !isRecord(value.body) || !isRecord(value.baseline)) return false;
  return typeof value.nodeId === "string"
    && Number.isInteger(value.expectedRevision)
    && value.expectedRevision as number > 0
    && typeof value.baseline.id === "string"
    && Number.isInteger(value.baseline.revision);
}

function isSyllabusNodeDto(value: unknown): value is SyllabusNodeDto {
  return isRecord(value)
    && typeof value.id === "string"
    && Number.isInteger(value.revision)
    && typeof value.title === "string"
    && syllabusNodeStatuses.includes(value.status as SyllabusNodeStatusDto)
    && Array.isArray(value.masteryConditions);
}

function isMasteryEvidenceFormDraft(value: unknown): value is MasteryEvidenceFormDraft {
  return isRecord(value)
    && masteryEvidenceTypes.includes(value.evidenceType as MasteryEvidenceType)
    && typeof value.evidenceReferenceId === "string"
    && typeof value.evidenceSummary === "string";
}

function isMasteryRetestFormDraft(value: unknown): value is MasteryRetestFormDraft {
  return isRecord(value)
    && masteryRetestResults.includes(value.result as MasteryRetestResult)
    && typeof value.testedAt === "string"
    && typeof value.score === "string"
    && typeof value.summary === "string"
    && typeof value.nextReviewDate === "string";
}

const syllabusNodeKinds: SyllabusNodeKindDto[] = ["subject", "chapter", "topic", "problem_type"];
const syllabusNodeStatuses: SyllabusNodeStatusDto[] = [
  "not_started",
  "learning",
  "covered",
  "needs_review",
  "mastered",
  "weak",
  "deferred",
];
const masteryEvidenceTypes: MasteryEvidenceType[] = ["task", "session", "note", "mistake", "retest"];
const masteryRetestResults: MasteryRetestResult[] = ["passed", "partial", "failed"];

const statusFilterOptions: SyllabusNodeStatusDto[] = [
  "not_started",
  "learning",
  "covered",
  "needs_review",
  "mastered",
  "weak",
  "deferred",
];

const mapStatusOptions: SyllabusNodeDto["mapSignal"]["cellStatus"][] = [
  "mistake_hotspot",
  "weak",
  "forgetting_risk",
  "covered",
  "verified",
  "learning",
  "not_started",
  "deferred",
];

const actionFilterOptions: Array<{ value: Exclude<ActionFilter, "all">; label: string }> = [
  { value: "risk", label: "风险压制" },
  { value: "evidence", label: "补证据" },
  { value: "review", label: "复习复测" },
  { value: "start", label: "启动推进" },
  { value: "deferred", label: "暂缓确认" },
];

function isStatusFilter(value: string | undefined): value is StatusFilter {
  return value === "all" || syllabusNodeStatuses.includes(value as SyllabusNodeStatusDto);
}

function isMapStatusFilter(value: string | undefined): value is MapStatusFilter {
  return value === "all" || mapStatusOptions.includes(value as SyllabusNodeDto["mapSignal"]["cellStatus"]);
}

function isActionFilter(value: string | undefined): value is ActionFilter {
  return value === "all" || actionFilterOptions.some((option) => option.value === value);
}

function buildSyllabusWorkbenchHref(input: {
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
  return `/knowledge/syllabus${params.size ? `?${params}` : ""}`;
}

const masteryLevelOptions: MasteryLevelDto[] = [
  "seen",
  "learned",
  "basic_exercises",
  "can_explain",
  "retest_passed",
  "exam_stable",
];

const masteryConditionOptions: MasteryCondition[] = [
  "course_or_textbook",
  "own_explanation",
  "basic_exercise",
  "comprehensive_exercise",
  "mistake_reviewed",
  "delayed_retest",
];

const masteryEvidenceTypeOptions: Array<{ value: MasteryEvidenceType; label: string }> = [
  { value: "task", label: "任务" },
  { value: "session", label: "计时" },
  { value: "note", label: "笔记" },
  { value: "mistake", label: "错题" },
  { value: "retest", label: "复测" },
];

const masteryRetestResultOptions: Array<{ value: MasteryRetestResult; label: string }> = [
  { value: "passed", label: "通过" },
  { value: "partial", label: "部分通过" },
  { value: "failed", label: "未通过" },
];

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function MapStatusButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-amber-300/45 bg-amber-300/15 text-amber-50"
          : "border-white/10 bg-[#151a20] text-zinc-300 hover:bg-white/10"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block text-xs opacity-70">{label}</span>
      <span className="mt-1 block text-lg font-semibold">{count}</span>
    </button>
  );
}

function StatusFilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-teal-300/40 bg-teal-300/15 text-teal-50"
          : "border-white/10 bg-[#151a20] text-zinc-300 hover:bg-white/10"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block text-xs opacity-70">{label}</span>
      <span className="mt-1 block text-lg font-semibold">{count}</span>
    </button>
  );
}

function ActionFilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-sky-300/45 bg-sky-300/15 text-sky-50"
          : "border-white/10 bg-[#151a20] text-zinc-300 hover:bg-white/10"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block text-xs opacity-70">{label}</span>
      <span className="mt-1 block text-lg font-semibold">{count}</span>
    </button>
  );
}

function SyllabusTreeNode({
  node,
  onUpdate,
  onAddMasteryEvidence,
  onAddMasteryRetest,
  pendingCommand,
}: {
  node: SyllabusNodeDto;
  onUpdate: (id: string, body: UpdateNodeBody) => Promise<boolean>;
  onAddMasteryEvidence: (id: string, body: AddMasteryEvidenceBody) => Promise<boolean>;
  onAddMasteryRetest: (id: string, body: AddMasteryRetestBody) => Promise<boolean>;
  pendingCommand: string | null;
}) {
  const progress = node.targetMinutes === 0 ? 0 : Math.min(100, Math.round((node.actualMinutes / node.targetMinutes) * 100));
  const evidenceCount = node.masteryProof.evidenceCount;
  const canSubmitProof = evidenceCount > 0;
  const [targetMasteryLevel, setTargetMasteryLevel] = useState<MasteryLevelDto>(node.masteryLevel ?? "learned");
  const [selectedConditions, setSelectedConditions] = useState<MasteryCondition[]>(node.masteryConditions);
  const [evidenceType, setEvidenceType] = useState<MasteryEvidenceType>("task");
  const [evidenceReferenceId, setEvidenceReferenceId] = useState(node.masteryEvidenceCandidates.task[0]?.id ?? "");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [retestResult, setRetestResult] = useState<MasteryRetestResult>("passed");
  const [retestTestedAt, setRetestTestedAt] = useState("");
  const [retestScore, setRetestScore] = useState("");
  const [retestSummary, setRetestSummary] = useState("");
  const [retestNextReviewDate, setRetestNextReviewDate] = useState("");
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const pending = pendingCommand?.startsWith(`${node.id}:`) ?? false;
  const evidenceDraftKey = syllabusEvidenceDraftKey(node.id);
  const retestDraftKey = syllabusRetestDraftKey(node.id);
  const selectedConditionSet = new Set(selectedConditions);
  const evidenceCandidates = node.masteryEvidenceCandidates[evidenceType];
  const selectedEvidenceReferenceId = evidenceCandidates.some((candidate) => candidate.id === evidenceReferenceId)
    ? evidenceReferenceId
    : evidenceCandidates[0]?.id ?? "";
  const explicitConditionCount = node.masteryConditionRecords.filter((record) => record.checked).length;

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const evidenceDraft = loadPrivateBusinessDraft(
        evidenceDraftKey,
        SHORT_PRIVATE_DRAFT_TTL_MS,
        isMasteryEvidenceFormDraft,
      );
      if (evidenceDraft) {
        setEvidenceType(evidenceDraft.evidenceType);
        setEvidenceReferenceId(evidenceDraft.evidenceReferenceId);
        setEvidenceSummary(evidenceDraft.evidenceSummary);
      }
      const retestDraft = loadPrivateBusinessDraft(
        retestDraftKey,
        SHORT_PRIVATE_DRAFT_TTL_MS,
        isMasteryRetestFormDraft,
      );
      if (retestDraft) {
        setRetestResult(retestDraft.result);
        setRetestTestedAt(retestDraft.testedAt);
        setRetestScore(retestDraft.score);
        setRetestSummary(retestDraft.summary);
        setRetestNextReviewDate(retestDraft.nextReviewDate);
      }
      setDraftsLoaded(true);
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [evidenceDraftKey, retestDraftKey]);

  useEffect(() => {
    if (!draftsLoaded) return;
    const defaultReferenceId = node.masteryEvidenceCandidates.task[0]?.id ?? "";
    const dirty = evidenceType !== "task"
      || evidenceReferenceId !== defaultReferenceId
      || evidenceSummary.trim().length > 0;
    if (!dirty) {
      removePrivateBusinessDraft(evidenceDraftKey);
      return;
    }
    savePrivateBusinessDraft<MasteryEvidenceFormDraft>(evidenceDraftKey, {
      evidenceType,
      evidenceReferenceId,
      evidenceSummary,
    });
  }, [draftsLoaded, evidenceDraftKey, evidenceType, evidenceReferenceId, evidenceSummary, node.masteryEvidenceCandidates.task]);

  useEffect(() => {
    if (!draftsLoaded) return;
    const dirty = retestResult !== "passed"
      || Boolean(retestTestedAt || retestScore.trim() || retestSummary.trim() || retestNextReviewDate);
    if (!dirty) {
      removePrivateBusinessDraft(retestDraftKey);
      return;
    }
    savePrivateBusinessDraft<MasteryRetestFormDraft>(retestDraftKey, {
      result: retestResult,
      testedAt: retestTestedAt,
      score: retestScore,
      summary: retestSummary,
      nextReviewDate: retestNextReviewDate,
    });
  }, [draftsLoaded, retestDraftKey, retestResult, retestTestedAt, retestScore, retestSummary, retestNextReviewDate]);

  function toggleCondition(condition: MasteryCondition) {
    setSelectedConditions((current) =>
      current.includes(condition)
        ? current.filter((item) => item !== condition)
        : [...current, condition],
    );
  }

  function saveConditions() {
    void onUpdate(node.id, { masteryConditions: selectedConditions });
  }

  function proveMastery() {
    void onUpdate(node.id, {
      status: "mastered",
      masteryLevel: targetMasteryLevel,
      masteryConditions: selectedConditions,
    });
  }

  function changeEvidenceType(nextType: MasteryEvidenceType) {
    setEvidenceType(nextType);
    setEvidenceReferenceId(node.masteryEvidenceCandidates[nextType][0]?.id ?? "");
  }

  async function submitEvidence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvidenceReferenceId) return;

    const body: AddMasteryEvidenceBody = {
      evidenceType,
      summary: evidenceSummary.trim() || undefined,
    };
    body[getMasteryEvidenceReferenceKey(evidenceType)] = selectedEvidenceReferenceId;

    savePrivateBusinessDraft<MasteryEvidenceFormDraft>(evidenceDraftKey, {
      evidenceType,
      evidenceReferenceId: selectedEvidenceReferenceId,
      evidenceSummary,
    });
    if (await onAddMasteryEvidence(node.id, body)) {
      removePrivateBusinessDraft(evidenceDraftKey);
      setEvidenceSummary("");
    }
  }

  async function submitRetest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const testedAt = retestTestedAt ? localDateTimeToIso(retestTestedAt) : undefined;
    const nextReviewAt = retestNextReviewDate ? dateInputToIso(retestNextReviewDate) : null;

    const body: AddMasteryRetestBody = {
      testedAt,
      result: retestResult,
      score: retestScore.trim() || undefined,
      summary: retestSummary.trim() || undefined,
      nextReviewAt,
    };
    savePrivateBusinessDraft<MasteryRetestFormDraft>(retestDraftKey, {
      result: retestResult,
      testedAt: retestTestedAt,
      score: retestScore,
      summary: retestSummary,
      nextReviewDate: retestNextReviewDate,
    });
    if (await onAddMasteryRetest(node.id, body)) {
      removePrivateBusinessDraft(retestDraftKey);
      setRetestScore("");
      setRetestSummary("");
    }
  }

  return (
    <article className="min-w-0 rounded-md border border-white/10 bg-[#151a20] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ChevronRight className="h-4 w-4 text-teal-300" aria-hidden="true" />
            <Badge tone="info">{labelKind(node.kind)}</Badge>
            <Badge tone={node.status === "weak" || node.status === "needs_review" ? "warning" : node.status === "mastered" ? "success" : "neutral"}>{labelStatus(node.status)}</Badge>
            {labelMapCell(node.mapSignal.cellStatus) !== labelStatus(node.status) ? <Badge>{labelMapCell(node.mapSignal.cellStatus)}</Badge> : null}
          </div>
          <h3 className="mt-2 min-w-0 break-words font-medium text-white">{node.title}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            进度 {node.actualMinutes} / {node.targetMinutes} 分钟 · 证据 {evidenceCount} 条 · 最近证据 {labelEvidenceFreshness(node.evidence.daysSinceLastEvidence)}
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{node.mapSignal.nextAction}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={`更新 ${node.title} 状态`}
            className="h-9 max-w-full rounded-md border border-white/10 bg-[#0d1117] px-2 text-sm text-zinc-100"
            value={node.status}
            onChange={(event) => {
              const nextStatus = event.target.value as SyllabusNodeStatusDto;
              if (nextStatus === "mastered") {
                void onUpdate(node.id, {
                  status: nextStatus,
                  masteryLevel: targetMasteryLevel,
                  masteryConditions: selectedConditions,
                });
                return;
              }
              void onUpdate(node.id, { status: nextStatus });
            }}
            disabled={pending}
          >
            <StatusOptions />
          </select>
          <ListDetailLink
            href={`/knowledge/syllabus/${node.id}`}
            focusId={`syllabus-${node.id}`}
            className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-teal-300 hover:bg-white/[0.05]"
          >
            打开详情
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ListDetailLink>
        </div>
      </div>
      <details className="mt-3 border-t border-white/10 pt-3">
        <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">
          管理掌握证明与复测
        </summary>
        <div className="mt-3 rounded-md border border-white/10 bg-[#0d1117] p-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <label className="grid min-w-0 gap-2 text-xs text-zinc-400">
            目标等级
            <select
              className="h-9 min-w-0 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
              value={targetMasteryLevel}
              onChange={(event) => setTargetMasteryLevel(event.target.value as MasteryLevelDto)}
              disabled={pending}
            >
              {masteryLevelOptions.map((level) => (
                <option key={level} value={level}>
                  {labelMastery(level)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid min-w-0 gap-2">
            <p className="text-xs text-zinc-400">本次证明条件</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {masteryConditionOptions.map((condition) => (
                <label
                  key={condition}
                  className="flex min-h-9 items-center gap-2 rounded-md border border-white/10 px-2 py-1.5 text-xs text-zinc-300"
                >
                  <input
                    className="h-4 w-4 accent-teal-400"
                    type="checkbox"
                    checked={selectedConditionSet.has(condition)}
                    onChange={() => toggleCondition(condition)}
                    disabled={pending}
                  />
                  <span>{labelMasteryCondition(condition)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200 hover:bg-white/10"
            type="button"
            onClick={saveConditions}
            disabled={pending}
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            保存条件
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={proveMastery}
            disabled={pending || !canSubmitProof}
            title={canSubmitProof ? node.masteryProof.nextAction : "还没有任务、计时、笔记、错题或复测证据"}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            保存证明
          </button>
        </div>
        </div>
        <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        <form className="min-w-0 rounded-md border border-white/10 bg-[#0d1117] p-3" onSubmit={submitEvidence}>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-teal-300" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-100">证据引用</p>
          </div>
          <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.62fr)_minmax(0,1.38fr)]">
            <select
              className="h-9 min-w-0 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
              value={evidenceType}
              onChange={(event) => changeEvidenceType(event.target.value as MasteryEvidenceType)}
              disabled={pending}
            >
              {masteryEvidenceTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 min-w-0 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
              value={selectedEvidenceReferenceId}
              onChange={(event) => setEvidenceReferenceId(event.target.value)}
              disabled={pending || evidenceCandidates.length === 0}
            >
              {evidenceCandidates.length === 0 ? (
                <option value="">暂无可引用记录</option>
              ) : (
                evidenceCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))
              )}
            </select>
          </div>
          <input
            className="mt-2 h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
            value={evidenceSummary}
            onChange={(event) => setEvidenceSummary(event.target.value)}
            placeholder="证据备注"
            maxLength={1000}
            disabled={pending}
          />
          <button
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={pending || !selectedEvidenceReferenceId}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            写入证据
          </button>
        </form>

        <form className="min-w-0 rounded-md border border-white/10 bg-[#0d1117] p-3" onSubmit={submitRetest}>
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-sky-300" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-100">复测记录</p>
          </div>
          <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
            <select
              className="h-9 min-w-0 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
              value={retestResult}
              onChange={(event) => setRetestResult(event.target.value as MasteryRetestResult)}
              disabled={pending}
            >
              {masteryRetestResultOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              className="h-9 min-w-0 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
              type="datetime-local"
              value={retestTestedAt}
              onChange={(event) => setRetestTestedAt(event.target.value)}
              aria-label="复测时间"
              disabled={pending}
            />
            <input
              className="h-9 min-w-0 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
              value={retestScore}
              onChange={(event) => setRetestScore(event.target.value)}
              placeholder="分数或结果"
              maxLength={80}
              disabled={pending}
            />
            <input
              className="h-9 min-w-0 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
              type="date"
              value={retestNextReviewDate}
              onChange={(event) => setRetestNextReviewDate(event.target.value)}
              aria-label="下次复习日期"
              disabled={pending}
            />
          </div>
          <input
            className="mt-2 h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100"
            value={retestSummary}
            onChange={(event) => setRetestSummary(event.target.value)}
            placeholder="复测摘要"
            maxLength={2000}
            disabled={pending}
          />
          <button
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-sky-300/25 px-3 text-sm text-sky-100 hover:bg-sky-400/10"
            type="submit"
            disabled={pending}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            写入复测
          </button>
        </form>
      </div>
        {node.masteryEvidence.length > 0 || node.masteryRetests.length > 0 ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <MasteryEvidenceList items={node.masteryEvidence} />
          <MasteryRetestList items={node.masteryRetests} />
        </div>
      ) : null}
        {evidenceCount === 0 ? (
        <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          还没有掌握证据，不能直接标记掌握。
        </p>
      ) : null}
        {evidenceCount > 0 && !node.masteryProof.canMarkRequestedLevel ? (
        <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          当前已记录证明还缺：{[
            ...node.masteryProof.missingConditions.map(labelMasteryCondition),
            ...node.masteryProof.missingEvidence,
          ].join("、")}
        </p>
      ) : null}
        <div className="mt-3 grid gap-1 text-xs text-zinc-500">
        {node.mapSignal.reasons.slice(0, 2).map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        </div>
        <div className="mt-3 h-2 rounded-md bg-white/10">
          <div className="h-2 rounded-md bg-teal-400" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          显式条件 {explicitConditionCount} / {masteryConditionOptions.length} · 显式证据 {node.masteryEvidence.length} · 复测 {node.masteryRetests.length} · {labelEvidenceSource(node.evidence.source)}
        </p>
      </details>
      {node.children.length > 0 ? (
        <div className="mt-3 grid gap-3 border-l border-white/10 pl-3">
          {node.children.map((child) => (
            <SyllabusTreeNode
              key={`${child.id}:${child.masteryLevel ?? "none"}:${child.masteryConditions.join("|")}`}
              node={child}
              onUpdate={onUpdate}
              onAddMasteryEvidence={onAddMasteryEvidence}
              onAddMasteryRetest={onAddMasteryRetest}
              pendingCommand={pendingCommand}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function MasteryEvidenceList({ items }: { items: SyllabusNodeDto["masteryEvidence"] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
        <p className="text-sm font-medium text-zinc-100">显式证据</p>
        <p className="mt-2 text-xs text-zinc-500">暂无</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
      <p className="text-sm font-medium text-zinc-100">显式证据</p>
      <div className="mt-2 grid gap-2">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="rounded-md border border-white/10 bg-[#151a20] px-2 py-2">
            <p className="text-xs text-zinc-100">
              {labelMasteryEvidenceType(item.evidenceType)} / {item.sourceLabel}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{formatIsoDateLabel(item.createdAt)}</p>
            {item.summary ? <p className="mt-1 text-xs text-zinc-400">{item.summary}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function MasteryRetestList({ items }: { items: SyllabusNodeDto["masteryRetests"] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
        <p className="text-sm font-medium text-zinc-100">复测历史</p>
        <p className="mt-2 text-xs text-zinc-500">暂无</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
      <p className="text-sm font-medium text-zinc-100">复测历史</p>
      <div className="mt-2 grid gap-2">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="rounded-md border border-white/10 bg-[#151a20] px-2 py-2">
            <p className="text-xs text-zinc-100">
              {labelMasteryRetestResult(item.result)} / {formatIsoDateLabel(item.testedAt)}
              {item.score ? ` / ${item.score}` : ""}
            </p>
            {item.nextReviewAt ? (
              <p className="mt-1 text-xs text-zinc-500">下次：{formatIsoDateLabel(item.nextReviewAt)}</p>
            ) : null}
            {item.summary ? <p className="mt-1 text-xs text-zinc-400">{item.summary}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusOptions() {
  return (
    <>
      <option value="not_started">未开始</option>
      <option value="learning">学习中</option>
      <option value="covered">已覆盖</option>
      <option value="needs_review">需要复习</option>
      <option value="mastered">掌握</option>
      <option value="weak">薄弱</option>
      <option value="deferred">暂缓</option>
    </>
  );
}

function countStatuses(nodes: SyllabusNodeDto[]): Record<SyllabusNodeStatusDto, number> {
  const counts: Record<SyllabusNodeStatusDto, number> = {
    not_started: 0,
    learning: 0,
    covered: 0,
    needs_review: 0,
    mastered: 0,
    weak: 0,
    deferred: 0,
  };

  for (const node of flattenTree(nodes)) {
    counts[node.status] += 1;
  }

  return counts;
}

function countMapStatuses(nodes: SyllabusNodeDto[]): Record<SyllabusNodeDto["mapSignal"]["cellStatus"], number> {
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

  for (const node of flattenTree(nodes)) {
    counts[node.mapSignal.cellStatus] += 1;
  }

  return counts;
}

function countActions(nodes: SyllabusNodeDto[]): Record<Exclude<ActionFilter, "all">, number> {
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

function labelEvidenceFreshness(days: number | null): string {
  if (days == null) return "暂无";
  if (days === 0) return "今天";
  return `${days} 天前`;
}

function labelEvidenceSource(source: SyllabusNodeDto["evidence"]["source"]): string {
  switch (source) {
    case "explicit":
      return "显式记录";
    case "fallback_count":
      return "_count fallback";
  }
}

function getMasteryEvidenceReferenceKey(
  evidenceType: MasteryEvidenceType,
): Exclude<keyof AddMasteryEvidenceBody, "evidenceType" | "summary"> {
  switch (evidenceType) {
    case "task":
      return "taskId";
    case "session":
      return "sessionId";
    case "note":
      return "noteId";
    case "mistake":
      return "mistakeId";
    case "retest":
      return "retestId";
  }
}

function localDateTimeToIso(value: string): string {
  return new Date(value).toISOString();
}

function dateInputToIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function formatIsoDateLabel(value: string): string {
  return value.slice(0, 10);
}

function filterNodesByStatusMapAndAction(
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

    if ((statusMatches && mapStatusMatches && actionMatches) || children.length > 0) {
      return [{ ...node, children }];
    }

    return [];
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

function flattenTree(nodes: SyllabusNodeDto[]): SyllabusNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function insertSyllabusNode(nodes: SyllabusNodeDto[], created: SyllabusNodeDto): SyllabusNodeDto[] {
  if (flattenTree(nodes).some((node) => node.id === created.id)) return nodes;
  if (!created.parentId) return sortSyllabusNodes([...nodes, created]);
  return nodes.map((node) => node.id === created.parentId
    ? { ...node, children: sortSyllabusNodes([...node.children, created]) }
    : { ...node, children: insertSyllabusNode(node.children, created) });
}

function sortSyllabusNodes(nodes: SyllabusNodeDto[]): SyllabusNodeDto[] {
  return nodes.sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "zh-CN"));
}

function flattenNodes(nodes: SyllabusNodeDto[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      subjectId: node.subjectId,
      title: node.title,
      depth,
    },
    ...flattenNodes(node.children, depth + 1),
  ]);
}

function findNodeById(nodes: SyllabusNodeDto[], id: string): SyllabusNodeDto | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children, id);
    if (child) return child;
  }

  return null;
}

function labelKind(kind: SyllabusNodeKindDto): string {
  switch (kind) {
    case "subject":
      return "科目";
    case "chapter":
      return "章节";
    case "topic":
      return "知识点";
    case "problem_type":
      return "题型专题";
  }
}

function labelMastery(level: MasteryLevelDto): string {
  switch (level) {
    case "seen":
      return "见过";
    case "learned":
      return "学过";
    case "basic_exercises":
      return "会做基础题";
    case "can_explain":
      return "能独立讲清";
    case "retest_passed":
      return "复测通过";
    case "exam_stable":
      return "考前稳定";
  }
}

function labelStatus(status: SyllabusNodeStatusDto): string {
  switch (status) {
    case "not_started":
      return "未开始";
    case "learning":
      return "学习中";
    case "covered":
      return "已覆盖";
    case "needs_review":
      return "需要复习";
    case "mastered":
      return "掌握";
    case "weak":
      return "薄弱";
    case "deferred":
      return "暂缓";
  }
}

function labelMapCell(status: SyllabusNodeDto["mapSignal"]["cellStatus"]): string {
  switch (status) {
    case "not_started":
      return "未开始";
    case "learning":
      return "学习中";
    case "covered":
      return "已覆盖";
    case "verified":
      return "已验证";
    case "weak":
      return "薄弱";
    case "forgetting_risk":
      return "遗忘风险";
    case "mistake_hotspot":
      return "错题高发";
    case "deferred":
      return "暂缓";
  }
}

function labelMapRisk(risk: SyllabusMapOverviewDto["summary"]["riskLevel"]): string {
  switch (risk) {
    case "clear":
      return "清晰";
    case "attention":
      return "需关注";
    case "high":
      return "高风险";
    case "critical":
      return "紧急";
  }
}

function labelMasteryCondition(condition: SyllabusNodeDto["masteryProof"]["missingConditions"][number]): string {
  switch (condition) {
    case "course_or_textbook":
      return "看完课程或教材";
    case "own_explanation":
      return "自己的理解";
    case "basic_exercise":
      return "基础题";
    case "comprehensive_exercise":
      return "综合题";
    case "mistake_reviewed":
      return "错题复盘";
    case "delayed_retest":
      return "7 天后复测";
  }
}

function labelMasteryEvidenceType(type: MasteryEvidenceType): string {
  switch (type) {
    case "task":
      return "任务";
    case "session":
      return "计时";
    case "note":
      return "笔记";
    case "mistake":
      return "错题";
    case "retest":
      return "复测";
  }
}

function labelMasteryRetestResult(result: MasteryRetestResult): string {
  switch (result) {
    case "passed":
      return "通过";
    case "partial":
      return "部分通过";
    case "failed":
      return "未通过";
  }
}
