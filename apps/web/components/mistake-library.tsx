"use client";

import { AlertCircle, CheckCircle2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { MistakeCauseDto, MistakeDto, SubjectDto, SyllabusNodeDto } from "@/lib/study/types";

interface MistakeLibraryProps {
  subjects: SubjectDto[];
  nodes: SyllabusNodeDto[];
  mistakes: MistakeDto[];
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function MistakeLibrary({ subjects, nodes, mistakes }: MistakeLibraryProps) {
  const router = useRouter();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [syllabusNodeId, setSyllabusNodeId] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [cause, setCause] = useState<MistakeCauseDto>("unknown");
  const [correctIdea, setCorrectIdea] = useState("");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCorrectIdea, setEditCorrectIdea] = useState("");
  const [editNextReviewAt, setEditNextReviewAt] = useState("");
  const [editCause, setEditCause] = useState<MistakeCauseDto>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/mistakes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        syllabusNodeId: syllabusNodeId || null,
        title,
        source: source || null,
        cause,
        correctIdea: correctIdea || null,
        nextReviewAt: nextReviewAt ? new Date(nextReviewAt).toISOString() : null,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "保存错题失败");
      return;
    }

    setTitle("");
    setSource("");
    setCorrectIdea("");
    setNextReviewAt("");
    setSyllabusNodeId("");
    startTransition(() => router.refresh());
  }

  function startEdit(mistake: MistakeDto) {
    setEditingId(mistake.id);
    setEditCorrectIdea(mistake.correctIdea ?? "");
    setEditCause(mistake.cause);
    setEditNextReviewAt(toDatetimeLocalValue(mistake.nextReviewAt));
  }

  async function saveEdit(id: string) {
    setError(null);
    const response = await fetch(`/api/mistakes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cause: editCause,
        correctIdea: editCorrectIdea || null,
        nextReviewAt: editNextReviewAt ? new Date(editNextReviewAt).toISOString() : null,
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "更新错题失败");
      return;
    }

    setEditingId(null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-white">新增错题</h2>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={submit}>
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
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={cause}
              onChange={(event) => setCause(event.target.value as MistakeCauseDto)}
            >
              <CauseOptions />
            </select>
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

          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="错题标题或最短题干"
            required
          />
          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="来源：真题、练习册、课程、页码"
          />
          <textarea
            className="min-h-32 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
            value={correctIdea}
            onChange={(event) => setCorrectIdea(event.target.value)}
            placeholder="正确思路、错因和下次避免方式"
          />
          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            type="datetime-local"
            value={nextReviewAt}
            onChange={(event) => setNextReviewAt(event.target.value)}
            aria-label="下次复习时间"
          />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || !subjectId}
          >
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            保存错题
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      </section>

      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-400">掌握证据</p>
            <h2 className="mt-1 text-xl font-semibold text-white">错题与薄弱点</h2>
          </div>
          <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">{mistakes.length} 条</span>
        </div>

        <div className="mt-5 grid gap-3">
          {mistakes.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
              还没有错题。这里会成为考纲节点“薄弱”和“掌握证明”的证据来源。
            </p>
          ) : null}
          {mistakes.map((mistake) => (
            <article key={mistake.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm text-zinc-400">{mistake.subjectName}</p>
                  <h3 className="mt-1 font-medium text-white">{mistake.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    {mistake.syllabusNodeTitle ?? "未关联考纲"} / {labelCause(mistake.cause)}
                  </p>
                </div>
                {mistake.nextReviewAt ? (
                  <span className="rounded-md border border-amber-300/25 px-2 py-1 text-xs text-amber-100">
                    {new Date(mistake.nextReviewAt).toLocaleDateString("zh-CN")}
                  </span>
                ) : null}
              </div>

              {editingId === mistake.id ? (
                <div className="mt-4 grid gap-3">
                  <select
                    className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                    value={editCause}
                    onChange={(event) => setEditCause(event.target.value as MistakeCauseDto)}
                  >
                    <CauseOptions />
                  </select>
                  <textarea
                    className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
                    value={editCorrectIdea}
                    onChange={(event) => setEditCorrectIdea(event.target.value)}
                  />
                  <input
                    className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                    type="datetime-local"
                    value={editNextReviewAt}
                    onChange={(event) => setEditNextReviewAt(event.target.value)}
                    aria-label="编辑下次复习时间"
                  />
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011]"
                    type="button"
                    onClick={() => saveEdit(mistake.id)}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    保存更新
                  </button>
                </div>
              ) : (
                <>
                  {mistake.source ? <p className="mt-3 text-sm text-zinc-400">来源：{mistake.source}</p> : null}
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                    {mistake.correctIdea || "还没有写正确思路。"}
                  </p>
                  <button
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10"
                    type="button"
                    onClick={() => startEdit(mistake)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    更新复盘
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CauseOptions() {
  return (
    <>
      <option value="unknown">未分类</option>
      <option value="concept_confusion">概念混淆</option>
      <option value="formula_unfamiliar">公式不熟</option>
      <option value="wrong_approach">方法错误</option>
      <option value="careless">粗心</option>
      <option value="time_pressure">时间压力</option>
      <option value="unfamiliar_pattern">题型陌生</option>
    </>
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

function labelCause(cause: MistakeCauseDto): string {
  switch (cause) {
    case "concept_confusion":
      return "概念混淆";
    case "formula_unfamiliar":
      return "公式不熟";
    case "wrong_approach":
      return "方法错误";
    case "careless":
      return "粗心";
    case "time_pressure":
      return "时间压力";
    case "unfamiliar_pattern":
      return "题型陌生";
    case "unknown":
      return "未分类";
  }
}

function toDatetimeLocalValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
