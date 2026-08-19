"use client";

import { AlertCircle, ArrowRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import { Toolbar } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { MistakeCauseDto, MistakeDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";
import type { MistakeCreatePrefillDto } from "@/lib/study/mistakes-service";

interface MistakeLibraryProps {
  userId: string;
  subjects: SubjectDto[];
  nodes: SyllabusOptionNodeDto[];
  mistakes: MistakeDto[];
  initialSubjectId?: string;
  initialSyllabusNodeId?: string;
  initialCauseFilter?: string;
  initialReviewFilter?: string;
  initialQuery?: string;
  initialCreate?: boolean;
  createPrefill?: MistakeCreatePrefillDto | null;
}

interface MistakeFormDraft {
  subjectId: string;
  syllabusNodeId: string;
  title: string;
  questionText: string;
  source: string;
  cause: MistakeCauseDto;
  causeNote: string;
  correctAnswer: string;
  correctIdea: string;
  nextReviewAt: string;
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function MistakeLibrary({ userId, subjects, nodes, mistakes, initialSubjectId, initialSyllabusNodeId, initialCauseFilter, initialReviewFilter, initialQuery, initialCreate, createPrefill }: MistakeLibraryProps) {
  const router = useRouter();
  const createTitleRef = useRef<HTMLInputElement>(null);
  const formDraftKey = `areaforge.mistake.draft.${userId}.create.${createPrefill?.simulationLossItemId ?? "manual"}`;
  useRestoreListReturn();
  const initialSubject = subjects.some((subject) => subject.id === initialSubjectId) ? initialSubjectId as string : subjects[0]?.id ?? "";
  const initialNode = flattenNodes(nodes).some((node) => node.id === initialSyllabusNodeId && node.subjectId === initialSubject) ? initialSyllabusNodeId as string : "";
  const [subjectId, setSubjectId] = useState(createPrefill?.subjectId ?? initialSubject);
  const [syllabusNodeId, setSyllabusNodeId] = useState(createPrefill?.syllabusNodeId ?? initialNode);
  const [title, setTitle] = useState(createPrefill?.title ?? "");
  const [questionText, setQuestionText] = useState(createPrefill?.questionText ?? "");
  const [source, setSource] = useState(createPrefill?.source ?? "");
  const [cause, setCause] = useState<MistakeCauseDto>(createPrefill?.cause ?? "unknown");
  const [causeNote, setCauseNote] = useState(createPrefill?.causeNote ?? "");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [correctIdea, setCorrectIdea] = useState("");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [mistakeSubjectFilter, setMistakeSubjectFilter] = useState(initialSubjectId && subjects.some((subject) => subject.id === initialSubjectId) ? initialSubjectId : "all");
  const [mistakeNodeFilter, setMistakeNodeFilter] = useState(initialNode || "all");
  const [mistakeCauseFilter, setMistakeCauseFilter] = useState<"all" | MistakeCauseDto>(() => isMistakeCauseFilter(initialCauseFilter) ? initialCauseFilter : "all");
  const [mistakeReviewFilter, setMistakeReviewFilter] = useState<"all" | "due" | "scheduled" | "none">(() => isMistakeReviewFilter(initialReviewFilter) ? initialReviewFilter : "all");
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(Boolean(initialCreate));
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(() => {
      createTitleRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [createOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isMistakeFormDraft);
      if (draft) {
        setSubjectId(draft.subjectId);
        setSyllabusNodeId(draft.syllabusNodeId);
        setTitle(draft.title);
        setQuestionText(draft.questionText);
        setSource(draft.source);
        setCause(draft.cause);
        setCauseNote(draft.causeNote);
        setCorrectAnswer(draft.correctAnswer);
        setCorrectIdea(draft.correctIdea);
        setNextReviewAt(draft.nextReviewAt);
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (!title && !questionText && !source && !correctAnswer && !correctIdea) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<MistakeFormDraft>(formDraftKey, {
      subjectId,
      syllabusNodeId,
      title,
      questionText,
      source,
      cause,
      causeNote,
      correctAnswer,
      correctIdea,
      nextReviewAt,
    });
  }, [cause, causeNote, correctAnswer, correctIdea, draftReady, formDraftKey, nextReviewAt, questionText, source, subjectId, syllabusNodeId, title]);

  const flatNodes = useMemo(() => flattenNodes(nodes), [nodes]);
  const nodeOptions = flatNodes.filter((node) => node.subjectId === subjectId);
  const filterNodeOptions = useMemo(
    () => flatNodes.filter((node) => mistakeSubjectFilter === "all" || node.subjectId === mistakeSubjectFilter),
    [flatNodes, mistakeSubjectFilter],
  );
  const filteredMistakes = useMemo(
    () => mistakes.filter((mistake) =>
      (mistakeSubjectFilter === "all" || mistake.subjectId === mistakeSubjectFilter)
      && (mistakeNodeFilter === "all" || (mistakeNodeFilter === "none" ? mistake.syllabusNodeId === null : mistake.syllabusNodeId === mistakeNodeFilter))
      && (mistakeCauseFilter === "all" || mistake.cause === mistakeCauseFilter)
      && matchesMistakeReview(mistake, mistakeReviewFilter)),
    [mistakeCauseFilter, mistakeNodeFilter, mistakeReviewFilter, mistakeSubjectFilter, mistakes],
  );
  const hasListFilters = mistakeSubjectFilter !== "all" || mistakeNodeFilter !== "all" || mistakeCauseFilter !== "all" || mistakeReviewFilter !== "all";
  const currentListHref = buildMistakeListHref({
    query: initialQuery,
    subject: mistakeSubjectFilter,
    node: mistakeNodeFilter,
    cause: mistakeCauseFilter,
    review: mistakeReviewFilter,
  });

  function applyListFilters(next: Partial<{
    subject: string;
    node: string;
    cause: "all" | MistakeCauseDto;
    review: "all" | "due" | "scheduled" | "none";
  }>) {
    const subject = next.subject ?? mistakeSubjectFilter;
    const node = next.node ?? mistakeNodeFilter;
    const nextCause = next.cause ?? mistakeCauseFilter;
    const review = next.review ?? mistakeReviewFilter;
    setMistakeSubjectFilter(subject);
    setMistakeNodeFilter(node);
    setMistakeCauseFilter(nextCause);
    setMistakeReviewFilter(review);
    updateKnowledgeContext({
      subjectId: subject === "all" ? null : subject,
      syllabusNodeId: node === "all" || node === "none" ? null : node,
    });
    startTransition(() => router.replace(buildMistakeListHref({ query: initialQuery, subject, node, cause: nextCause, review })));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const payload = {
      subjectId,
      syllabusNodeId: syllabusNodeId || null,
      title,
      questionText,
      source: source || null,
      cause,
      causeNote: causeNote || null,
      correctAnswer: correctAnswer || null,
      correctIdea: correctIdea || null,
      nextReviewAt: nextReviewAt ? new Date(nextReviewAt).toISOString() : null,
      simulationLossItemId: createPrefill?.simulationLossItemId ?? null,
    };
    const commandScope = `mistake:create:${userId}:${createPrefill?.simulationLossItemId ?? "manual"}`;
    let createdMistake: MistakeDto | null = null;
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
      const body = (await response.json().catch(() => null)) as { mistake?: MistakeDto } | null;
      if (!body?.mistake) {
        setError("服务端未返回已创建错题，当前草稿与重试标识仍保留");
        return;
      }
      createdMistake = body.mistake;
    } catch {
      setError("网络不可用，错题草稿已保留；恢复网络后请显式重试。");
      return;
    } finally {
      setSaving(false);
    }

    if (!createdMistake) return;
    completeIdempotentCommand(commandScope);
    setTitle("");
    setQuestionText("");
    setSource("");
    setCauseNote("");
    setCorrectAnswer("");
    setCorrectIdea("");
    setNextReviewAt("");
    setSyllabusNodeId("");
    removePrivateBusinessDraft(formDraftKey);
    setCreateOpen(false);
    startTransition(() => router.push(withReturnTo(`/knowledge/mistakes/${createdMistake.id}`, currentListHref)));
  }

  return (
    <>
      <Drawer open={createOpen} title="新增错题" onClose={() => setCreateOpen(false)}>
        <form className="grid gap-3" onSubmit={submit}>
          {createPrefill ? <p className="rounded-md border border-teal-300/20 bg-teal-300/10 px-3 py-2 text-sm text-teal-100">已从模拟失分带入科目、来源和错因。补齐题面与正确思路后再创建。</p> : null}
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
            aria-label="错题标题"
            required
          />
          <textarea
            className="min-h-36 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            placeholder="完整题面、条件和问题"
            aria-label="题目正文"
            maxLength={10000}
            required
          />
          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="来源：真题、练习册、课程、页码"
            aria-label="错题来源"
          />
          <textarea
            className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
            value={causeNote}
            onChange={(event) => setCauseNote(event.target.value)}
            placeholder="错因补充：具体错在哪一步"
            aria-label="错因补充"
            maxLength={2000}
          />
          <textarea
            className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
            value={correctAnswer}
            onChange={(event) => setCorrectAnswer(event.target.value)}
            placeholder="标准答案（可选）"
            aria-label="标准答案"
            maxLength={5000}
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
            disabled={isPending || saving || !subjectId || !title.trim() || !questionText.trim() || cause === "unknown" || !correctIdea.trim()}
          >
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            保存错题
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      </Drawer>

      {!createOpen && error ? <p className="text-sm text-red-200">{error}</p> : null}
      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-400">掌握证据</p>
            <h2 className="mt-1 text-xl font-semibold text-white">错题与薄弱点</h2>
          </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="错题掌握概览">
          <OverviewMetric label="错题总数" value={`${mistakes.length}`} />
          <OverviewMetric label="今日到期" value={`${mistakes.filter((mistake) => matchesMistakeReview(mistake, "due")).length}`} />
          <OverviewMetric label="最近通过" value={`${recentPassRate(mistakes)}%`} />
          <OverviewMetric label="最近失败" value={`${recentFailures(mistakes)}`} />
        </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">{filteredMistakes.length} / {mistakes.length} 条</span>
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              新增错题
            </Button>
          </div>
        </div>

        <Toolbar className="mt-5" label="错题筛选">
          <select aria-label="筛选错题科目" className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100" value={mistakeSubjectFilter} onChange={(event) => applyListFilters({ subject: event.target.value, node: "all" })}>
            <option value="all">全部科目</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
          <select aria-label="筛选错题考纲节点" className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100" value={mistakeNodeFilter} onChange={(event) => applyListFilters({ node: event.target.value })}>
            <option value="all">全部节点</option>
            <option value="none">未关联节点</option>
            {filterNodeOptions.map((node) => <option key={node.id} value={node.id}>{"  ".repeat(node.depth)}{node.title}</option>)}
          </select>
          <select aria-label="筛选错题错因" className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100" value={mistakeCauseFilter} onChange={(event) => applyListFilters({ cause: event.target.value as "all" | MistakeCauseDto })}>
            <option value="all">全部错因</option>
            <CauseOptions />
          </select>
          <select aria-label="筛选错题复习状态" className="h-10 min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100" value={mistakeReviewFilter} onChange={(event) => applyListFilters({ review: event.target.value as "all" | "due" | "scheduled" | "none" })}>
            <option value="all">全部复习状态</option>
            <option value="due">已到期</option>
            <option value="scheduled">已设置</option>
            <option value="none">未设置</option>
          </select>
          {initialQuery ? <Badge tone="info">搜索：{initialQuery}</Badge> : null}
          {hasListFilters ? <Button type="button" size="sm" variant="ghost" onClick={() => applyListFilters({ subject: "all", node: "all", cause: "all", review: "all" })}>清除筛选</Button> : null}
        </Toolbar>

        <div className="mt-5">
          {mistakes.length === 0 ? (
            <EmptyState title={initialQuery ? "没有匹配的错题" : "还没有错题"} description={initialQuery ? "尝试修改搜索词或清除筛选。" : "这里会成为考纲节点“薄弱”和“掌握证明”的证据来源。"} />
          ) : null}
          {mistakes.length > 0 && filteredMistakes.length === 0 ? <EmptyState title="当前筛选没有结果" description="调整筛选条件，或清除筛选查看全部错题。" action={<Button type="button" size="sm" onClick={() => applyListFilters({ subject: "all", node: "all", cause: "all", review: "all" })}>清除筛选</Button>} /> : null}
          {filteredMistakes.length > 0 ? <div className="divide-y divide-white/10 border-y border-white/10">{filteredMistakes.map((mistake) => (
            <article key={mistake.id} className="min-w-0 py-4">
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-zinc-500">{mistake.subjectName}</p>
                    <Badge tone={mistake.cause === "unknown" ? "warning" : "info"}>{labelCause(mistake.cause)}</Badge>
                    {reviewSummary(mistake) ? <Badge tone="warning">复习 {reviewSummary(mistake)}</Badge> : null}
                    {mistake.archivedAt ? <Badge>已归档</Badge> : null}
                  </div>
                  <h3 className="mt-2 break-words font-medium text-white">{mistake.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">{mistake.syllabusNodeTitle ?? "未关联考纲"}</p>
                </div>
                <ListDetailLink
                  href={`/knowledge/mistakes/${mistake.id}`}
                  focusId={`mistake-${mistake.id}`}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-teal-300 hover:bg-white/[0.05]"
                >
                  打开详情
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ListDetailLink>
              </div>
              <p className="mt-3 max-h-12 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                {mistake.questionText || "这条历史错题还没有完整题面。"}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                {mistake.source ? <span>来源：{mistake.source}</span> : null}
                <span>作答 {mistake.attemptCount} 次{mistake.attempts[0] ? ` · 最近${labelResult(mistake.attempts[0].result)}` : ""}</span>
                <span>更新：{new Date(mistake.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</span>
              </div>
              {mistake.cause === "unknown" || !mistake.correctIdea?.trim() ? <p className="mt-3 text-xs text-amber-200">待补全错因和正确思路后才能进入快速复习。</p> : null}
            </article>
          ))}</div> : null}
        </div>
      </section>
    </>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return <div className="border-l border-white/10 pl-3"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-lg font-semibold text-white">{value}</p></div>;
}

function recentPassRate(mistakes: MistakeDto[]) {
  const attempts = mistakes.flatMap((mistake) => mistake.attempts.slice(0, 5));
  if (attempts.length === 0) return 0;
  return Math.round((attempts.filter((attempt) => attempt.result === "PASSED").length / attempts.length) * 100);
}

function recentFailures(mistakes: MistakeDto[]) {
  return mistakes.reduce((total, mistake) => total + mistake.attempts.slice(0, 5).filter((attempt) => attempt.result === "FAILED").length, 0);
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
  return [draft.subjectId, draft.syllabusNodeId, draft.title, draft.questionText, draft.source, draft.causeNote, draft.correctAnswer, draft.correctIdea, draft.nextReviewAt]
    .every((field) => typeof field === "string")
    && ["unknown", "concept_confusion", "formula_unfamiliar", "wrong_approach", "careless", "time_pressure", "unfamiliar_pattern"]
      .includes(String(draft.cause));
}

function labelResult(result: "PASSED" | "PARTIAL" | "FAILED"): string {
  return result === "PASSED" ? "通过" : result === "PARTIAL" ? "部分掌握" : "未通过";
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

function matchesMistakeReview(mistake: MistakeDto, filter: "all" | "due" | "scheduled" | "none"): boolean {
  if (filter === "all") return true;
  const dueAt = mistake.reviewSchedule?.dueDate ?? mistake.nextReviewAt;
  if (filter === "none") return !dueAt;
  if (!dueAt) return false;
  if (filter === "scheduled") return true;
  return new Date(dueAt).getTime() <= Date.now();
}

function isMistakeCauseFilter(value: string | undefined): value is "all" | MistakeCauseDto {
  return value === "all" || value === "unknown" || value === "concept_confusion" || value === "formula_unfamiliar" || value === "wrong_approach" || value === "careless" || value === "time_pressure" || value === "unfamiliar_pattern";
}

function isMistakeReviewFilter(value: string | undefined): value is "all" | "due" | "scheduled" | "none" {
  return value === "all" || value === "due" || value === "scheduled" || value === "none";
}

function buildMistakeListHref(input: {
  query?: string;
  subject: string;
  node: string;
  cause: "all" | MistakeCauseDto;
  review: "all" | "due" | "scheduled" | "none";
}): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.subject !== "all") params.set("subjectId", input.subject);
  if (input.node !== "all") params.set("syllabusNodeId", input.node);
  if (input.cause !== "all") params.set("cause", input.cause);
  if (input.review !== "all") params.set("review", input.review);
  return `/knowledge/mistakes${params.size ? `?${params}` : ""}`;
}
