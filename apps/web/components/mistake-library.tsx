"use client";

import { isUnauthorized } from "@/lib/client/api-errors";
import { mutationFeedback } from "@/lib/client/mutation-feedback";

import { createMistake } from "@/lib/api/mistakes";
import { AlertCircle, Play, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRestoreListReturn } from "@/components/list-return-context";
import { MistakeCard } from "@/components/mistake-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import { Toolbar } from "@/components/ui/page";
import { SectionSurface } from "@/components/ui/surface";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import { useUrlSyncedFilters } from "@/lib/client/use-url-synced-filters";
import { useKeyedDraftHydration } from "@/lib/client/use-keyed-draft-hydration";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import {
  loadPrivateBusinessDraftEnvelope,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { MistakeCauseDto, MistakeDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/contracts";
import type { MistakeCreatePrefillDto } from "@/lib/contracts";
import { isShanghaiDateInputError, shanghaiDateTimeInputToIso } from "@/lib/formatters";
import {
  buildMistakeListHref,
  CauseOptions,
  createMistakeFormDefaults,
  flattenNodes,
  isMistakeCauseFilter,
  isMistakeFormDraft,
  isMistakeReviewFilter,
  matchesMistakeReview,
  OverviewMetric,
  recentFailures,
  recentPassRate,
  type MistakeFormDraft,
  type MistakeListFilters,
} from "@/components/mistake-library-support";

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

export function MistakeLibrary({ userId, subjects, nodes, mistakes, initialSubjectId, initialSyllabusNodeId, initialCauseFilter, initialReviewFilter, initialQuery, initialCreate, createPrefill }: MistakeLibraryProps) {
  const router = useRouter();
  const createTitleRef = useRef<HTMLInputElement>(null);
  const formDraftKey = `areaforge.mistake.draft.${userId}.create.${createPrefill?.simulationLossItemId ?? "manual"}`;
  const {
    ready: draftReady,
    begin: beginDraftHydration,
    isCurrent: isDraftHydrationCurrent,
    complete: completeDraftHydration,
    cancel: cancelDraftHydration,
  } = useKeyedDraftHydration(formDraftKey);
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(Boolean(initialCreate));
  const [observedInitialCreate, setObservedInitialCreate] = useState(Boolean(initialCreate));
  if (observedInitialCreate !== Boolean(initialCreate)) {
    setObservedInitialCreate(Boolean(initialCreate));
    if (initialCreate) setCreateOpen(true);
  }
  const [isPending, startTransition] = useTransition();
  const filterSource = {
    subject: initialSubjectId && subjects.some((subject) => subject.id === initialSubjectId) ? initialSubjectId : "all",
    node: initialNode || "all",
    cause: isMistakeCauseFilter(initialCauseFilter) ? initialCauseFilter : "all",
    review: isMistakeReviewFilter(initialReviewFilter) ? initialReviewFilter : "all",
  } satisfies MistakeListFilters;
  const { filters: listFilters, commit: commitListFilters } = useUrlSyncedFilters({
    source: filterSource,
    sourceKey: [filterSource.subject, filterSource.node, filterSource.cause, filterSource.review].join("\u0000"),
    onCommit: (filters) => {
      updateKnowledgeContext({
        subjectId: filters.subject === "all" ? null : filters.subject,
        syllabusNodeId: filters.node === "all" || filters.node === "none" ? null : filters.node,
      });
      router.replace(buildMistakeListHref({ query: initialQuery, ...filters }));
    },
  });
  const {
    subject: mistakeSubjectFilter,
    node: mistakeNodeFilter,
    cause: mistakeCauseFilter,
    review: mistakeReviewFilter,
  } = listFilters;

  useEffect(() => {
    if (!createOpen) return;
    const timer = window.setTimeout(() => {
      createTitleRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [createOpen]);

  useEffect(() => {
    const token = beginDraftHydration();
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraftEnvelope(
        formDraftKey,
        LONG_PRIVATE_DRAFT_TTL_MS,
        isMistakeFormDraft,
      );
      if (!isDraftHydrationCurrent(token)) return;
      const next = draft?.value ?? createMistakeFormDefaults(createPrefill, initialSubject, initialNode);
      setSubjectId(next.subjectId);
      setSyllabusNodeId(next.syllabusNodeId);
      setTitle(next.title);
      setQuestionText(next.questionText);
      setSource(next.source);
      setCause(next.cause);
      setCauseNote(next.causeNote);
      setCorrectAnswer(next.correctAnswer);
      setCorrectIdea(next.correctIdea);
      setNextReviewAt(next.nextReviewAt);
      completeDraftHydration(token);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cancelDraftHydration(token);
    };
  }, [beginDraftHydration, cancelDraftHydration, completeDraftHydration, createPrefill, formDraftKey, initialNode, initialSubject, isDraftHydrationCurrent]);

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
    commitListFilters(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const commandScope = `mistake:create:${userId}:${createPrefill?.simulationLossItemId ?? "manual"}`;
    let createdMistake: MistakeDto | null = null;
    setSaving(true);

    try {
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
        nextReviewAt: nextReviewAt ? shanghaiDateTimeInputToIso(nextReviewAt) : null,
        simulationLossItemId: createPrefill?.simulationLossItemId ?? null,
      };
      const response = await createMistake({
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mistake-create", payload),
        ...payload,
      });
      if (isUnauthorized(response)) {
        setError("登录已过期，错题草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const feedback = mutationFeedback(response, "保存错题失败，草稿已保留");
        if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
        setError(feedback.message);
        return;
      }
      if (!response.body?.mistake) {
        setError("服务端未返回已创建错题，当前草稿与重试标识仍保留");
        return;
      }
      createdMistake = response.body.mistake;
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "下次复习时间无效，错题草稿已保留；请重新选择日期和时间。"
        : "网络不可用，错题草稿已保留；恢复网络后请显式重试。");
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
          <div className="af-content-grid-two grid gap-3">
            <Select
              className="h-11"
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
            </Select>
            <Select
              className="h-11"
              value={cause}
              onChange={(event) => setCause(event.target.value as MistakeCauseDto)}
            >
              <CauseOptions />
            </Select>
          </div>

          <Select
            className="h-11"
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
          </Select>

          <Input
            ref={createTitleRef}
            className="h-11"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="错题标题或最短题干"
            aria-label="错题标题"
            required
          />
          <Textarea
            controlHeight="lg"
            className="min-h-36 leading-6"
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            placeholder="完整题面、条件和问题"
            aria-label="题目正文"
            maxLength={10000}
            required
          />
          <Input
            className="h-11"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="来源：真题、练习册、课程、页码"
            aria-label="错题来源"
          />
          <Textarea
            controlHeight="md"
            className="leading-6"
            value={causeNote}
            onChange={(event) => setCauseNote(event.target.value)}
            placeholder="错因补充：具体错在哪一步"
            aria-label="错因补充"
            maxLength={2000}
          />
          <Textarea
            controlHeight="md"
            className="leading-6"
            value={correctAnswer}
            onChange={(event) => setCorrectAnswer(event.target.value)}
            placeholder="标准答案（可选）"
            aria-label="标准答案"
            maxLength={5000}
          />
          <Textarea
            controlHeight="lg"
            className="leading-6"
            value={correctIdea}
            onChange={(event) => setCorrectIdea(event.target.value)}
            placeholder="正确思路和下次避免方式"
            required
          />
          <Input
            className="h-11"
            type="datetime-local"
            value={nextReviewAt}
            onChange={(event) => setNextReviewAt(event.target.value)}
            aria-label="下次复习时间"
          />
          <Button
            variant="primary"
            size="lg"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending || saving || !subjectId || !title.trim() || !questionText.trim() || cause === "unknown" || !correctIdea.trim()}
          >
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            保存错题
          </Button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
      </Drawer>

      {!createOpen && error ? <p className="text-sm text-red-200">{error}</p> : null}
      <SectionSurface>
        <div className="af-toolbar-split flex gap-4">
          <div className="min-w-0">
            <p className="text-sm text-zinc-400">掌握证据</p>
            <h2 className="mt-1 text-xl font-semibold text-white">错题与薄弱点</h2>
          </div>
          <div className="af-page-header-action flex w-full flex-wrap items-center gap-2">
            <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">{filteredMistakes.length} / {mistakes.length} 条</span>
            <ButtonLink href="/knowledge/mistakes/practice" variant="secondary"><Play className="h-4 w-4" aria-hidden="true" />开始练习</ButtonLink>
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              新增错题
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="错题掌握概览">
          <Card variant="subtle" className="p-3.5">
            <OverviewMetric label="错题总数" value={`${mistakes.length}`} />
          </Card>
          <Card variant="subtle" className="p-3.5">
            <OverviewMetric label="今日到期" value={`${mistakes.filter((mistake) => matchesMistakeReview(mistake, "due")).length}`} />
          </Card>
          <Card variant="subtle" className="p-3.5">
            <OverviewMetric label="最近通过" value={`${recentPassRate(mistakes)}%`} />
          </Card>
          <Card variant="subtle" className="p-3.5">
            <OverviewMetric label="最近失败" value={`${recentFailures(mistakes)}`} />
          </Card>
        </div>

        <Toolbar className="mt-5" label="错题筛选">
          <Select aria-label="筛选错题科目" className="!w-auto" value={mistakeSubjectFilter} onChange={(event) => applyListFilters({ subject: event.target.value, node: "all" })}>
            <option value="all">全部科目</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </Select>
          <Select aria-label="筛选错题考纲节点" className="!w-auto" value={mistakeNodeFilter} onChange={(event) => applyListFilters({ node: event.target.value })}>
            <option value="all">全部节点</option>
            <option value="none">未关联节点</option>
            {filterNodeOptions.map((node) => <option key={node.id} value={node.id}>{"  ".repeat(node.depth)}{node.title}</option>)}
          </Select>
          <Select aria-label="筛选错题错因" className="!w-auto" value={mistakeCauseFilter} onChange={(event) => applyListFilters({ cause: event.target.value as "all" | MistakeCauseDto })}>
            <option value="all">全部错因</option>
            <CauseOptions />
          </Select>
          <Select aria-label="筛选错题复习状态" className="!w-auto" value={mistakeReviewFilter} onChange={(event) => applyListFilters({ review: event.target.value as "all" | "due" | "scheduled" | "none" })}>
            <option value="all">全部复习状态</option>
            <option value="due">已到期</option>
            <option value="scheduled">已设置</option>
            <option value="none">未设置</option>
          </Select>
          {initialQuery ? <Badge tone="info">搜索：{initialQuery}</Badge> : null}
          {hasListFilters ? <Button type="button" size="sm" variant="ghost" onClick={() => applyListFilters({ subject: "all", node: "all", cause: "all", review: "all" })}>清除筛选</Button> : null}
        </Toolbar>

        <div className="mt-5">
          {mistakes.length === 0 ? (
            <EmptyState title={initialQuery ? "没有匹配的错题" : "还没有错题"} description={initialQuery ? "尝试修改搜索词或清除筛选。" : "这里会成为考纲节点“薄弱”和“掌握证明”的证据来源。"} />
          ) : null}
          {mistakes.length > 0 && filteredMistakes.length === 0 ? <EmptyState title="当前筛选没有结果" description="调整筛选条件，或清除筛选查看全部错题。" action={<Button type="button" size="sm" onClick={() => applyListFilters({ subject: "all", node: "all", cause: "all", review: "all" })}>清除筛选</Button>} /> : null}
          {filteredMistakes.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredMistakes.map((mistake) => (
                <MistakeCard key={mistake.id} mistake={mistake} />
              ))}
            </div>
          ) : null}
        </div>
      </SectionSurface>
    </>
  );
}
