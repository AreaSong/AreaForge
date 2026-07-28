"use client";

import { AlertCircle, CheckCircle2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { MistakeCauseDto, MistakeDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";

interface MistakeLibraryProps {
  userId: string;
  subjects: SubjectDto[];
  nodes: SyllabusOptionNodeDto[];
  mistakes: MistakeDto[];
  initialSubjectId?: string;
  initialSyllabusNodeId?: string;
  initialCreate?: boolean;
}

interface MistakeFormDraft {
  subjectId: string;
  syllabusNodeId: string;
  title: string;
  source: string;
  cause: MistakeCauseDto;
  correctIdea: string;
  nextReviewAt: string;
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function MistakeLibrary({ userId, subjects, nodes, mistakes, initialSubjectId, initialSyllabusNodeId, initialCreate }: MistakeLibraryProps) {
  const router = useRouter();
  const createTitleRef = useRef<HTMLInputElement>(null);
  const formDraftKey = `areaforge.mistake.draft.${userId}.create`;
  useRestoreListReturn();
  const initialSubject = subjects.some((subject) => subject.id === initialSubjectId) ? initialSubjectId as string : subjects[0]?.id ?? "";
  const initialNode = flattenNodes(nodes).some((node) => node.id === initialSyllabusNodeId && node.subjectId === initialSubject) ? initialSyllabusNodeId as string : "";
  const [subjectId, setSubjectId] = useState(initialSubject);
  const [syllabusNodeId, setSyllabusNodeId] = useState(initialNode);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [cause, setCause] = useState<MistakeCauseDto>("unknown");
  const [correctIdea, setCorrectIdea] = useState("");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCorrectIdea, setEditCorrectIdea] = useState("");
  const [editNextReviewAt, setEditNextReviewAt] = useState("");
  const [editCause, setEditCause] = useState<MistakeCauseDto>("unknown");
  const [editRecoveryId, setEditRecoveryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!initialCreate) return;
    const timer = window.setTimeout(() => {
      createTitleRef.current?.scrollIntoView({ block: "center" });
      createTitleRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialCreate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isMistakeFormDraft);
      if (draft) {
        setSubjectId(draft.subjectId);
        setSyllabusNodeId(draft.syllabusNodeId);
        setTitle(draft.title);
        setSource(draft.source);
        setCause(draft.cause);
        setCorrectIdea(draft.correctIdea);
        setNextReviewAt(draft.nextReviewAt);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (!title && !source && !correctIdea) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<MistakeFormDraft>(formDraftKey, {
      subjectId,
      syllabusNodeId,
      title,
      source,
      cause,
      correctIdea,
      nextReviewAt,
    });
  }, [cause, correctIdea, draftReady, formDraftKey, nextReviewAt, source, subjectId, syllabusNodeId, title]);

  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const payload = {
      subjectId,
      syllabusNodeId: syllabusNodeId || null,
      title,
      source: source || null,
      cause,
      correctIdea: correctIdea || null,
      nextReviewAt: nextReviewAt ? new Date(nextReviewAt).toISOString() : null,
    };
    const commandScope = `mistake:create:${userId}`;
    setSaving(true);

    try {
      const response = await fetch("/api/mistakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mistake-create", payload),
          ...payload,
        }),
      });
      if (response.status === 401) {
        setError("登录已过期，错题草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "保存错题失败，草稿已保留");
        return;
      }
    } catch {
      setError("网络不可用，错题草稿已保留；恢复网络后请显式重试。");
      return;
    } finally {
      setSaving(false);
    }

    completeIdempotentCommand(commandScope);
    setTitle("");
    setSource("");
    setCorrectIdea("");
    setNextReviewAt("");
    setSyllabusNodeId("");
    removePrivateBusinessDraft(formDraftKey);
    startTransition(() => router.refresh());
  }

  function startEdit(mistake: MistakeDto) {
    setEditingId(mistake.id);
    setEditRecoveryId(null);
    setEditCorrectIdea(mistake.correctIdea ?? "");
    setEditCause(mistake.cause);
    setEditNextReviewAt(toDatetimeLocalValue(mistake.reviewSchedule?.dueDate ?? mistake.nextReviewAt));
  }

  async function saveEdit(id: string) {
    if (saving) return;
    const mistake = mistakes.find((item) => item.id === id);
    if (!mistake) return;
    const detailEditDraftKey = `areaforge.mistake.draft.detail.edit.${userId}.${id}`;
    const detailScheduleDraftKey = `areaforge.mistake.draft.detail.schedule.${userId}.${id}`;
    const wasComplete = isCompleteMistake(mistake);
    savePrivateBusinessDraft(detailEditDraftKey, {
      baseUpdatedAt: mistake.updatedAt,
      title: mistake.title,
      source: mistake.source ?? "",
      cause: editCause,
      correctIdea: editCorrectIdea,
    });
    if (wasComplete && !mistake.reviewSchedule) {
      savePrivateBusinessDraft(detailScheduleDraftKey, { reviewDate: editNextReviewAt.slice(0, 10) });
    } else {
      removePrivateBusinessDraft(detailScheduleDraftKey);
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/mistakes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: mistake.updatedAt,
          cause: editCause,
          correctIdea: editCorrectIdea || null,
          ...(wasComplete && !mistake.reviewSchedule
            ? { nextReviewAt: editNextReviewAt ? new Date(editNextReviewAt).toISOString() : null }
            : {}),
        }),
      });
      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(`/knowledge/mistakes/${id}`)}`);
        return;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 409) {
          setEditRecoveryId(id);
          setError("错题已在其他页面或设备变化，本地输入仍保留。请转到详情页检查差异后再显式保存。");
        } else {
          setError(data?.error ?? "更新错题失败，本地输入仍保留");
        }
        return;
      }
    } catch {
      setEditRecoveryId(id);
      setError("网络不可用，本地编辑仍保留；恢复网络后请显式重试。");
      return;
    } finally {
      setSaving(false);
    }

    setEditingId(null);
    setEditRecoveryId(null);
    removePrivateBusinessDraft(detailEditDraftKey);
    removePrivateBusinessDraft(detailScheduleDraftKey);
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
                updateKnowledgeContext({ subjectId: event.target.value, syllabusNodeId: null });
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
            ref={createTitleRef}
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
            placeholder="正确思路和下次避免方式"
            required
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
            disabled={isPending || saving || !subjectId || cause === "unknown" || !correctIdea.trim()}
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
                  {mistake.archivedAt ? <p className="mt-2 text-xs text-zinc-400">已归档 · 只读</p> : null}
                  {mistake.cause === "unknown" || !mistake.correctIdea?.trim() ? <p className="mt-2 text-xs text-amber-200">待补全：选择明确错因并填写正确思路后，才能加入新的快速复习或确认复习。</p> : null}
                </div>
                {reviewSummary(mistake) ? (
                  <span className="rounded-md border border-amber-300/25 px-2 py-1 text-xs text-amber-100">
                    {reviewSummary(mistake)}
                  </span>
                ) : null}
              </div>
              <ListDetailLink href={`/knowledge/mistakes/${mistake.id}`} focusId={`mistake-${mistake.id}`} className="mt-3 inline-flex text-sm text-teal-300 hover:underline">
                打开错题详情
              </ListDetailLink>

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
                  {!mistake.reviewSchedule && isCompleteMistake(mistake) ? <input
                    className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                    type="datetime-local"
                    value={editNextReviewAt}
                    onChange={(event) => setEditNextReviewAt(event.target.value)}
                    aria-label="编辑下次复习时间"
                  /> : <p className="text-xs text-zinc-400">{mistake.reviewSchedule ? "已使用统一复习排期；日期调整请在详情页完成。" : "先补全错因和正确思路；保存后再到详情页设置复习日期。"}</p>}
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={saving || isPending || editCause === "unknown" || !editCorrectIdea.trim()}
                    onClick={() => saveEdit(mistake.id)}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    保存更新
                  </button>
                  {editRecoveryId === mistake.id ? (
                    <ListDetailLink href={`/knowledge/mistakes/${mistake.id}`} focusId={`mistake-${mistake.id}`} className="text-sm text-amber-200 underline">
                      转到详情页恢复草稿并检查状态
                    </ListDetailLink>
                  ) : null}
                </div>
              ) : (
                <>
                  {mistake.source ? <p className="mt-3 text-sm text-zinc-400">来源：{mistake.source}</p> : null}
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                    {mistake.correctIdea || "还没有写正确思路。"}
                  </p>
                  {!mistake.archivedAt ? <button
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-400/10"
                    type="button"
                    onClick={() => startEdit(mistake)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    更新复盘
                  </button> : null}
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

function isMistakeFormDraft(value: unknown): value is MistakeFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MistakeFormDraft>;
  return [draft.subjectId, draft.syllabusNodeId, draft.title, draft.source, draft.correctIdea, draft.nextReviewAt]
    .every((field) => typeof field === "string")
    && ["unknown", "concept_confusion", "formula_unfamiliar", "wrong_approach", "careless", "time_pressure", "unfamiliar_pattern"]
      .includes(String(draft.cause));
}

function flattenNodes(nodes: SyllabusOptionNodeDto[], depth = 0): FlatNode[] {
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

function reviewSummary(mistake: MistakeDto): string | null {
  if (mistake.reviewSchedule) {
    if (mistake.reviewSchedule.status === "PAUSED") return "排期已暂停";
    return mistake.reviewSchedule.dueDate
      ? new Date(mistake.reviewSchedule.dueDate).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
      : "排期待定";
  }
  return mistake.nextReviewAt
    ? new Date(mistake.nextReviewAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
    : null;
}

function isCompleteMistake(mistake: Pick<MistakeDto, "cause" | "correctIdea">): boolean {
  return mistake.cause !== "unknown" && Boolean(mistake.correctIdea?.trim());
}

function toDatetimeLocalValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
