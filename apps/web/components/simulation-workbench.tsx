"use client";

import { CheckCircle2, Plus, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { SimulationStageDraftDto } from "@/lib/study/simulation-service";
import type { MotivationVaultDto, StudyTaskDto, SubjectDto, SyllabusNodeDto } from "@/lib/study/types";

interface SimulationWorkbenchProps {
  subjects: SubjectDto[];
  nodes: SyllabusNodeDto[];
  tasks: StudyTaskDto[];
  stage: SimulationStageDraftDto;
  motivationVault: MotivationVaultDto | null;
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function SimulationWorkbench({
  subjects,
  nodes,
  tasks,
  stage,
  motivationVault,
}: SimulationWorkbenchProps) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [syllabusNodeId, setSyllabusNodeId] = useState("");
  const [title, setTitle] = useState("2026 同步全真自测");
  const [plannedDate, setPlannedDate] = useState(toDatetimeLocal(stage.simulationNode.date));
  const [estimatedMinutes, setEstimatedMinutes] = useState(180);
  const [selectedTaskId, setSelectedTaskId] = useState(tasks.find((task) => task.status !== "done")?.id ?? tasks[0]?.id ?? "");
  const [targetScore, setTargetScore] = useState("");
  const [actualScore, setActualScore] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(180);
  const [blankCount, setBlankCount] = useState(0);
  const [lossReason, setLossReason] = useState("");
  const [mindset, setMindset] = useState("");
  const [summary, setSummary] = useState("");
  const [firstSimulationDiary, setFirstSimulationDiary] = useState(motivationVault?.firstSimulationDiary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const resolvedSelectedTaskId = selectedTaskId || tasks.find((task) => task.status !== "done")?.id || tasks[0]?.id || "";

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/simulation/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        syllabusNodeId: syllabusNodeId || null,
        title,
        plannedDate: new Date(plannedDate).toISOString(),
        estimatedMinutes,
      }),
    });

    if (!response.ok) {
      await showError(response, "创建模拟考试失败");
      return;
    }

    setSyllabusNodeId("");
    startTransition(() => router.refresh());
  }

  async function completeTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!resolvedSelectedTaskId) {
      setError("请先选择一条模拟考试记录");
      return;
    }

    const response = await fetch(`/api/simulation/tasks/${resolvedSelectedTaskId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetScore,
        actualScore,
        durationMinutes,
        blankCount,
        lossReason,
        mindset,
        summary,
      }),
    });

    if (!response.ok) {
      await showError(response, "保存模拟结果失败");
      return;
    }

    setSummary("");
    startTransition(() => router.refresh());
  }

  async function saveDiary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/simulation/first-diary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstSimulationDiary }),
    });

    if (!response.ok) {
      await showError(response, "保存阶段日记失败");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function showError(response: Response, fallback: string) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? fallback);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-white">创建模拟考试</h2>
        </div>
        <form className="mt-5 grid gap-3" onSubmit={submitTask}>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={subjectId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setSyllabusNodeId("");
              }}
              required
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="考试名称"
              required
            />
          </div>
          <select
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={syllabusNodeId}
            onChange={(event) => setSyllabusNodeId(event.target.value)}
          >
            <option value="">不关联考纲节点</option>
            {nodeOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {"  ".repeat(node.depth)}
                {node.title}
              </option>
            ))}
          </select>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="datetime-local"
              value={plannedDate}
              onChange={(event) => setPlannedDate(event.target.value)}
              required
            />
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="number"
              min={30}
              max={720}
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(Number(event.target.value))}
            />
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isPending || !subjectId}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              新建
            </button>
          </div>
        </form>

        <div className="mt-6 grid gap-3">
          <h3 className="font-medium text-white">模拟考试记录</h3>
          {tasks.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
              还没有模拟考试记录。
            </p>
          ) : null}
          {tasks.map((task) => (
            <article key={task.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm text-zinc-400">{task.subjectName}</p>
                  <h3 className="mt-1 font-medium text-white">{task.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    {new Date(task.plannedDate).toLocaleString("zh-CN")} / {labelStatus(task.status)}
                  </p>
                  {task.syllabusNodeTitle ? <p className="mt-1 text-xs text-teal-200">节点：{task.syllabusNodeTitle}</p> : null}
                </div>
                <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
                  {task.actualMinutes || task.estimatedMinutes} 分
                </span>
              </div>
              {task.reviewText ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{task.reviewText}</p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-5">
        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-amber-300" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-white">保存模拟结果</h2>
          </div>
          <form className="mt-5 grid gap-3" onSubmit={completeTask}>
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={resolvedSelectedTaskId}
              onChange={(event) => setSelectedTaskId(event.target.value)}
              required
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title} / {task.subjectName}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                value={targetScore}
                onChange={(event) => setTargetScore(event.target.value)}
                placeholder="目标分"
              />
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                value={actualScore}
                onChange={(event) => setActualScore(event.target.value)}
                placeholder="实际分"
              />
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                type="number"
                min={0}
                max={300}
                value={blankCount}
                onChange={(event) => setBlankCount(Number(event.target.value))}
                aria-label="空题数量"
              />
            </div>
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="number"
              min={30}
              max={720}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
              aria-label="实际用时"
            />
            <textarea
              className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={lossReason}
              onChange={(event) => setLossReason(event.target.value)}
              placeholder="失分原因"
            />
            <textarea
              className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={mindset}
              onChange={(event) => setMindset(event.target.value)}
              placeholder="心态记录"
            />
            <textarea
              className="min-h-28 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="考后总结"
              required
            />
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-amber-300 px-4 font-medium text-[#17110a] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isPending || tasks.length === 0}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              保存结果
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <h2 className="text-lg font-semibold text-white">第一次全真自测阶段日记</h2>
          <form className="mt-5 grid gap-3" onSubmit={saveDiary}>
            <textarea
              className="min-h-32 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={firstSimulationDiary}
              onChange={(event) => setFirstSimulationDiary(event.target.value)}
              placeholder="自测后写下分数、心态、暴露问题和下一阶段判断"
              required
            />
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isPending}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              保存阶段日记
            </button>
          </form>
        </section>

        {error ? <p className="rounded-md border border-red-300/25 bg-red-300/10 px-4 py-3 text-sm text-red-100">{error}</p> : null}
      </div>
    </div>
  );
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

function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => `${part}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function labelStatus(status: StudyTaskDto["status"]): string {
  switch (status) {
    case "todo":
      return "待开始";
    case "in_progress":
      return "进行中";
    case "done":
      return "已完成";
    case "skipped":
      return "已放弃";
    case "deferred":
      return "已延期";
  }
}
