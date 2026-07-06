"use client";

import { ChevronRight, Plus, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type {
  MasteryLevelDto,
  SubjectDto,
  SyllabusNodeDto,
  SyllabusNodeKindDto,
  SyllabusNodeStatusDto,
} from "@/lib/study/types";

interface SyllabusManagerProps {
  subjects: SubjectDto[];
  nodes: SyllabusNodeDto[];
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

type StatusFilter = "all" | SyllabusNodeStatusDto;

export function SyllabusManager({ subjects, nodes }: SyllabusManagerProps) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [parentId, setParentId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SyllabusNodeKindDto>("topic");
  const [status, setStatus] = useState<SyllabusNodeStatusDto>("not_started");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [targetMinutes, setTargetMinutes] = useState(45);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const subjectNodes = nodes.filter((node) => node.subjectId === subjectId);
  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const parentOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const statusCounts = useMemo(() => countStatuses(subjectNodes), [subjectNodes]);
  const filteredSubjectNodes = useMemo(
    () => filterNodesByStatus(subjectNodes, statusFilter),
    [subjectNodes, statusFilter],
  );
  const filteredNodeCount = statusFilter === "all" ? parentOptions.length : statusCounts[statusFilter];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/syllabus/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        parentId: parentId || null,
        title,
        kind,
        status,
        targetMinutes,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "创建考纲节点失败");
      return;
    }

    setTitle("");
    setParentId("");
    startTransition(() => router.refresh());
  }

  async function updateNode(id: string, body: Partial<{ status: SyllabusNodeStatusDto; masteryLevel: MasteryLevelDto | null; targetMinutes: number }>) {
    setError(null);
    const response = await fetch(`/api/syllabus/nodes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "更新考纲节点失败");
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-white">新增考纲节点</h2>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={submit}>
          <label className="grid gap-2 text-sm text-zinc-300">
            科目
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100"
              value={subjectId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setParentId("");
              }}
              required
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm text-zinc-300">
            父节点
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
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
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="章节、知识点或题型名称"
            required
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={kind}
              onChange={(event) => setKind(event.target.value as SyllabusNodeKindDto)}
            >
              <option value="subject">科目</option>
              <option value="chapter">章节</option>
              <option value="topic">知识点</option>
              <option value="problem_type">题型专题</option>
            </select>
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={status}
              onChange={(event) => setStatus(event.target.value as SyllabusNodeStatusDto)}
            >
              <StatusOptions />
            </select>
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="number"
              min={0}
              max={100000}
              value={targetMinutes}
              onChange={(event) => setTargetMinutes(Number(event.target.value))}
              aria-label="目标分钟"
            />
          </div>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || !subjectId}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            写入考纲
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      </section>

      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-zinc-400">作战地图</p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {subjects.find((subject) => subject.id === subjectId)?.name ?? "未选择科目"}
            </h2>
          </div>
          <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
            {filteredNodeCount} / {parentOptions.length} 个节点
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusFilterButton
            active={statusFilter === "all"}
            count={subjectNodes.length}
            label="全部"
            onClick={() => setStatusFilter("all")}
          />
          {statusFilterOptions.map((option) => (
            <StatusFilterButton
              key={option}
              active={statusFilter === option}
              count={statusCounts[option]}
              label={labelStatus(option)}
              onClick={() => setStatusFilter(option)}
            />
          ))}
        </div>

        <div className="mt-5 grid gap-3">
          {subjectNodes.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
              这个科目还没有考纲节点，先建立第一个章节或知识点。
            </p>
          ) : null}
          {subjectNodes.length > 0 && filteredSubjectNodes.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
              当前筛选下没有节点。
            </p>
          ) : null}
          {filteredSubjectNodes.map((node) => (
            <SyllabusTreeNode key={node.id} node={node} onUpdate={updateNode} />
          ))}
        </div>
      </section>
    </div>
  );
}

const statusFilterOptions: SyllabusNodeStatusDto[] = [
  "not_started",
  "learning",
  "covered",
  "needs_review",
  "mastered",
  "weak",
  "deferred",
];

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

function SyllabusTreeNode({
  node,
  onUpdate,
}: {
  node: SyllabusNodeDto;
  onUpdate: (id: string, body: Partial<{ status: SyllabusNodeStatusDto; masteryLevel: MasteryLevelDto | null; targetMinutes: number }>) => Promise<void>;
}) {
  const progress = node.targetMinutes === 0 ? 0 : Math.min(100, Math.round((node.actualMinutes / node.targetMinutes) * 100));
  const evidenceCount =
    node.evidence.taskCount + node.evidence.sessionCount + node.evidence.noteCount + node.evidence.mistakeCount;

  return (
    <article className="rounded-md border border-white/10 bg-[#151a20] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4 text-teal-300" aria-hidden="true" />
            <h3 className="font-medium text-white">{node.title}</h3>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {labelKind(node.kind)} / {node.actualMinutes} of {node.targetMinutes} 分钟
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            证据：任务 {node.evidence.taskCount} / 计时 {node.evidence.sessionCount} / 笔记 {node.evidence.noteCount} / 错题 {node.evidence.mistakeCount}
          </p>
          {node.masteryLevel ? <p className="mt-1 text-xs text-teal-200">掌握等级：{labelMastery(node.masteryLevel)}</p> : null}
          <p className="mt-2 text-xs text-zinc-400">{nodeActionHint(node, evidenceCount)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-md border border-white/10 bg-[#0d1117] px-2 text-sm text-zinc-100"
            value={node.status}
            onChange={(event) => onUpdate(node.id, { status: event.target.value as SyllabusNodeStatusDto })}
          >
            <StatusOptions />
          </select>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10"
            type="button"
            onClick={() => onUpdate(node.id, { status: "mastered", masteryLevel: "learned" })}
            disabled={evidenceCount === 0}
            title={evidenceCount === 0 ? "需要至少一条任务、计时、笔记或错题证据" : "标记为掌握"}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            掌握
          </button>
        </div>
      </div>
      {evidenceCount === 0 ? (
        <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          还没有掌握证据，不能直接标记掌握。
        </p>
      ) : null}
      <div className="mt-3 h-2 rounded-md bg-white/10">
        <div className="h-2 rounded-md bg-teal-400" style={{ width: `${progress}%` }} />
      </div>
      {node.children.length > 0 ? (
        <div className="mt-3 grid gap-3 border-l border-white/10 pl-3">
          {node.children.map((child) => (
            <SyllabusTreeNode key={child.id} node={child} onUpdate={onUpdate} />
          ))}
        </div>
      ) : null}
    </article>
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

function filterNodesByStatus(nodes: SyllabusNodeDto[], statusFilter: StatusFilter): SyllabusNodeDto[] {
  if (statusFilter === "all") return nodes;

  return nodes.flatMap((node) => {
    const children = filterNodesByStatus(node.children, statusFilter);
    if (node.status === statusFilter || children.length > 0) {
      return [{ ...node, children }];
    }

    return [];
  });
}

function flattenTree(nodes: SyllabusNodeDto[]): SyllabusNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
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

function nodeActionHint(node: SyllabusNodeDto, evidenceCount: number): string {
  switch (node.status) {
    case "not_started":
      return "下一步：为这个节点创建任务，完成一次计时或笔记后再推进状态。";
    case "learning":
      return "下一步：继续计时，并留下一个可检查产出。";
    case "covered":
      return evidenceCount > 0 ? "下一步：安排复测，确认是否能标记掌握。" : "下一步：补一条任务、计时、笔记或错题证据。";
    case "needs_review":
      return "下一步：查看到期笔记或错题，完成一次复习后更新状态。";
    case "mastered":
      return "下一步：保持复测节奏，避免只凭印象掌握。";
    case "weak":
      return "下一步：先复盘错题，再补一条能讲清楚的笔记。";
    case "deferred":
      return "下一步：确认是否继续暂缓，或重新排入明日最小任务。";
  }
}
