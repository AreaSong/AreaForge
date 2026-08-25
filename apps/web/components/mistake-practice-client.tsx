"use client";

import { createMistakeAttempt, type MistakeAttemptInput, type MistakeAttemptResponse } from "@/lib/api/mistakes";
import { ArrowLeft, ArrowRight, Eye, Play, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Radio, Select, Textarea } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { PageHeader, SectionHeader } from "@/components/ui/page";
import { Metric } from "@/components/ui/metric";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import {
  hasRecentFailure,
  isDue,
  isPracticeReady,
  selectMistakePracticeCandidates,
  type MistakePracticePool,
} from "@/lib/knowledge/mistake-practice";
import type { MistakeCauseDto, MistakeDto, MistakeAttemptDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/contracts";

type PracticePhase = "setup" | "active" | "done";
type AnswerMode = "TEXT" | "PAPER_OR_ORAL";
type Result = "PASSED" | "PARTIAL" | "FAILED";

interface PracticeResult {
  mistake: MistakeDto;
  attempt: MistakeAttemptDto;
}

interface MistakeAttemptCommand {
  mistakeId: string;
  index: number;
  payload: MistakeAttemptInput;
}

interface MistakeAttemptConflict {
  command: MistakeAttemptCommand;
  latest: MistakeDto | null;
  conflictFields: string[];
}

export function MistakePracticeClient(props: {
  userId: string;
  mistakes: MistakeDto[];
  subjects: SubjectDto[];
  nodes: SyllabusOptionNodeDto[];
}) {
  const [phase, setPhase] = useState<PracticePhase>("setup");
  const [subjectId, setSubjectId] = useState("");
  const [syllabusNodeId, setSyllabusNodeId] = useState("");
  const [cause, setCause] = useState<"" | MistakeCauseDto>("");
  const [pool, setPool] = useState<MistakePracticePool>("mixed");
  const [count, setCount] = useState("5");
  const [sessionId, setSessionId] = useState(() => createSessionId());
  const [queue, setQueue] = useState<MistakeDto[]>([]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<PracticeResult[]>([]);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("TEXT");
  const [answerText, setAnswerText] = useState("");
  const [paperCompleted, setPaperCompleted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<Result>("PARTIAL");
  const [note, setNote] = useState("");
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MistakeAttemptConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  useEffect(() => {
    // The question and summary states share the shell scroll container. Reset it
    // when the state changes so the next heading is not left behind the top bar.
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.scrollTo({ top: 0 });
      document.querySelector<HTMLElement>('[data-layout-region="page-frame"]')?.scrollTo({ top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  const flatNodes = useMemo(() => flattenNodes(props.nodes), [props.nodes]);
  const nodeOptions = flatNodes.filter((node) => !subjectId || node.subjectId === subjectId);
  const candidates = useMemo(() => selectMistakePracticeCandidates(props.mistakes, {
    subjectId: subjectId || undefined,
    syllabusNodeId: syllabusNodeId || undefined,
    cause: cause || undefined,
    pool,
    count: 50,
  }), [cause, pool, props.mistakes, subjectId, syllabusNodeId]);
  const current = queue[index] ?? null;
  const readyCount = props.mistakes.filter((mistake) => !mistake.archivedAt && isPracticeReady(mistake)).length;

  function startPractice() {
    const selected = selectMistakePracticeCandidates(props.mistakes, {
      subjectId: subjectId || undefined,
      syllabusNodeId: syllabusNodeId || undefined,
      cause: cause || undefined,
      pool,
      count: Number(count),
    });
    if (selected.length === 0) {
      setError("当前筛选没有可练习的完整错题。");
      return;
    }
    setQueue(selected);
    setSessionId(createSessionId());
    setResults([]);
    setIndex(0);
    resetQuestion();
    setPhase("active");
    setError(null);
    setNotice(null);
    setConflict(null);
    setConflictOpen(false);
  }

  function resetQuestion() {
    setAnswerMode("TEXT");
    setAnswerText("");
    setPaperCompleted(false);
    setRevealed(false);
    setResult("PARTIAL");
    setNote("");
    setStartedAt(Date.now());
  }

  async function saveCurrent() {
    if (!current || pending || !revealed) return;
    if (answerMode === "TEXT" && !answerText.trim()) {
      setError("请先填写本次答案或关键步骤。");
      return;
    }
    if (answerMode === "PAPER_OR_ORAL" && !paperCompleted) {
      setError("请先确认已完成纸上或口头作答。");
      return;
    }
    const attemptFields = {
      answerMode,
      answerText: answerMode === "TEXT" ? answerText.trim() : null,
      result,
      durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      note: note.trim() || null,
    } satisfies Omit<MistakeAttemptInput, "idempotencyKey">;
    const payload: MistakeAttemptInput = {
      idempotencyKey: getOrCreateIdempotencyKey(
        `mistake-practice:${props.userId}:${sessionId}:${current.id}:${index}`,
        "mistake-practice-attempt",
        attemptFields,
      ),
      ...attemptFields,
    };
    void submitAttempt({ mistakeId: current.id, index, payload });
  }

  async function submitAttempt(command: MistakeAttemptCommand) {
    const snapshot = freezeAttemptCommand(command);
    const scope = `mistake-practice:${props.userId}:${sessionId}:${snapshot.mistakeId}:${snapshot.index}`;
    setPending(true);
    setError(null);
    try {
      const response = await createMistakeAttempt(snapshot.mistakeId, snapshot.payload);
      const body = response.body as (MistakeAttemptResponse & {
        latest?: MistakeDto;
        conflictFields?: string[];
      }) | null;
      if (isUnauthorized(response)) {
        setError("登录已过期，本题输入仍保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !body?.attempt) {
        if (isConflict(response)) {
          setConflict({
            command: snapshot,
            latest: isMistakeDtoSnapshot(body?.latest) ? body.latest : null,
            conflictFields: body?.conflictFields ?? ["attempt", "updatedAt"],
          });
          setConflictOpen(true);
        }
        setError(body?.error ?? "保存练习结果失败，本题输入仍保留；请处理冲突后显式重试。");
        return;
      }
      completeIdempotentCommand(scope);
      const savedMistake = queue[snapshot.index] ?? current;
      if (!savedMistake) return;
      setResults((previous) => [...previous, { mistake: savedMistake, attempt: body.attempt! }]);
      setConflict(null);
      setConflictOpen(false);
      if (snapshot.index >= queue.length - 1) {
        setPhase("done");
      } else {
        setIndex(snapshot.index + 1);
        resetQuestion();
      }
    } catch {
      setError("网络不可用，本题输入仍保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  function adoptServerVersion() {
    if (!conflict) return;
    if (conflict.latest) {
      setQueue((previous) => previous.map((mistake, itemIndex) => itemIndex === conflict.command.index ? conflict.latest! : mistake));
      setError("已采用服务端最新错题状态，本次作答没有自动重放。");
    } else {
      setError("服务端没有可采用的错题版本，请刷新后确认当前状态。");
    }
    setConflict(null);
    setConflictOpen(false);
  }

  function prepareRetry() {
    setConflictOpen(false);
    if (conflict) setError("本题输入已保留，请检查后点击“保留输入并重试”；系统不会自动重放。");
  }

  function retryConflict() {
    if (!conflict || pending) return;
    const command = conflict.command;
    setConflict(null);
    setConflictOpen(false);
    void submitAttempt(command);
  }

  if (phase === "active" && current) {
    return <>
      <PracticeQuestion
        current={current}
        index={index}
        total={queue.length}
        answerMode={answerMode}
        answerText={answerText}
        paperCompleted={paperCompleted}
        revealed={revealed}
        result={result}
        note={note}
        pending={pending}
        error={error}
        onAnswerModeChange={setAnswerMode}
        onAnswerTextChange={setAnswerText}
        onPaperCompletedChange={setPaperCompleted}
        onReveal={() => { setRevealed(true); setError(null); }}
        onResultChange={setResult}
        onNoteChange={setNote}
        onSave={() => void saveCurrent()}
        onBackToAnswer={() => { setRevealed(false); setError(null); }}
        onBack={() => { setPhase("setup"); setError(null); }}
      />
      {conflict && !conflictOpen ? <div className="mx-auto flex w-full max-w-4xl flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setConflictOpen(true)}>处理作答冲突</Button>
        <Button type="button" variant="ghost" size="sm" onClick={retryConflict}>保留输入并重试</Button>
      </div> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理错题作答冲突"
        description="服务端错题状态已变化。本题作答、结果和备注仍保留，系统不会自动覆盖或重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? attemptConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={prepareRetry}
        mergeLabel="保留输入并重试"
      />
    </>;
  }

  if (phase === "done") {
    return <PracticeSummary results={results} onAgain={() => { setSessionId(createSessionId()); setPhase("setup"); setError(null); setNotice(null); }} />;
  }

  return <div className="mx-auto w-full max-w-5xl space-y-6">
    <PageHeader
      eyebrow="知识证据"
      title="错题练习"
      description="到期错题优先，再用最近失败题填满本轮。练习结果会写入作答历史，但不会自动改动复习排期。"
      back={<Link href="/knowledge/mistakes" className="inline-flex items-center gap-1 text-sm text-teal-300 hover:underline"><ArrowLeft size={15} aria-hidden />返回错题</Link>}
    />
    <section className="af-metric-grid-three grid gap-4 border-b border-white/10 pb-6">
      <Stat label="可练习错题" value={`${readyCount} 题`} />
      <Stat label="当前筛选" value={`${candidates.length} 题`} />
      <Stat label="排序规则" value="到期 → 失败 → 其他" />
    </section>
    <section className="af-content-grid-sidebar grid min-w-0 gap-6">
      <div className="space-y-4">
        <SectionHeader title="设置本轮练习" description="范围只影响本轮抽题，不会改变错题本或排期。" />
        <div className="af-content-grid-two grid gap-3">
          <label className="text-sm text-zinc-400">科目<Select aria-label="练习科目" className={inputClass} value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setSyllabusNodeId(""); }}><option value="">全部科目</option>{props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</Select></label>
          <label className="text-sm text-zinc-400">考纲节点<Select aria-label="练习考纲节点" className={inputClass} value={syllabusNodeId} onChange={(event) => setSyllabusNodeId(event.target.value)}><option value="">全部节点</option>{nodeOptions.map((node) => <option key={node.id} value={node.id}>{"  ".repeat(node.depth)}{node.title}</option>)}</Select></label>
          <label className="text-sm text-zinc-400">错因<Select aria-label="练习错因" className={inputClass} value={cause} onChange={(event) => setCause(event.target.value as "" | MistakeCauseDto)}><option value="">全部错因</option><CauseOptions /></Select></label>
          <label className="text-sm text-zinc-400">抽题范围<Select aria-label="抽题范围" className={inputClass} value={pool} onChange={(event) => setPool(event.target.value as MistakePracticePool)}><option value="mixed">混合优先</option><option value="failed">最近失败</option><option value="due">已到期</option><option value="unscheduled">未设置复习</option></Select></label>
          <label className="text-sm text-zinc-400">本轮题量<Select aria-label="本轮题量" className={inputClass} value={count} onChange={(event) => setCount(event.target.value)}><option value="5">5 题</option><option value="10">10 题</option><option value="50">全部（最多 50 题）</option></Select></label>
        </div>
        {candidates.length === 0 ? <EmptyState title="当前没有可练习错题" description="请补全历史错题，或调整练习范围。" /> : <div className="rounded-md border border-white/10 bg-[#101419] p-4"><p className="text-sm text-zinc-300">本轮将练习 {Math.min(candidates.length, Number(count))} 题。</p><div className="mt-3 flex flex-wrap gap-2">{candidates.slice(0, 5).map((mistake) => <Badge key={mistake.id} tone={isDue(mistake) ? "warning" : hasRecentFailure(mistake) ? "danger" : "info"}>{mistake.title}</Badge>)}{candidates.length > 5 ? <Badge>还有 {candidates.length - 5} 题</Badge> : null}</div></div>}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        <Button type="button" variant="primary" size="lg" disabled={candidates.length === 0} onClick={startPractice}><Play size={16} aria-hidden />开始本轮练习</Button>
      </div>
      <aside className="af-responsive-aside space-y-3 text-sm text-zinc-400">
        <p className="text-xs font-medium text-teal-300">本轮规则</p>
        <ul className="space-y-2 leading-6"><li>先完成独立作答，再揭示答案。</li><li>每题结果单独保存，可中途关闭后从错题详情继续。</li><li>练习不会自动调整排期。</li><li>结束后可打开失败题详情，确认下一次复习日期。</li></ul>
      </aside>
    </section>
  </div>;
}

function PracticeQuestion(props: {
  current: MistakeDto;
  index: number;
  total: number;
  answerMode: AnswerMode;
  answerText: string;
  paperCompleted: boolean;
  revealed: boolean;
  result: Result;
  note: string;
  pending: boolean;
  error: string | null;
  onAnswerModeChange: (value: AnswerMode) => void;
  onAnswerTextChange: (value: string) => void;
  onPaperCompletedChange: (value: boolean) => void;
  onReveal: () => void;
  onResultChange: (value: Result) => void;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onBackToAnswer: () => void;
  onBack: () => void;
}) {
  const { current } = props;
  return <div className="mx-auto w-full max-w-4xl space-y-6">
    <PageHeader eyebrow={`错题练习 · ${props.index + 1} / ${props.total}`} title={current.title} description={`${current.subjectName} · ${current.syllabusNodeTitle ?? "未关联考纲"}`} back={<Button type="button" variant="ghost" size="sm" onClick={props.onBack} className="inline-flex !h-auto items-center gap-1 !border-0 !p-0 text-sm text-teal-300 hover:underline"><ArrowLeft size={15} aria-hidden />退出本轮</Button>} />
    <div className="h-2 overflow-hidden rounded bg-white/10" role="progressbar" aria-label="练习进度" aria-valuemin={0} aria-valuemax={props.total} aria-valuenow={props.index + 1}><div className="h-full bg-teal-400" style={{ width: `${((props.index + 1) / props.total) * 100}%` }} /></div>
    <section className="space-y-4 rounded-lg border border-white/10 bg-[#101419] p-5 sm:p-7">
      <div><p className="text-xs text-zinc-500">题面</p><div className="mt-2 whitespace-pre-wrap text-base leading-8 text-zinc-100">{current.questionText}</div></div>
      {!props.revealed ? <>
        <fieldset className="flex flex-wrap gap-2 border-t border-white/10 pt-4"><legend className="mb-2 text-sm text-zinc-400">作答方式</legend>{([['TEXT', '文字作答'], ['PAPER_OR_ORAL', '纸上 / 口头']] as const).map(([value, label]) => <label key={value} className={`flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${props.answerMode === value ? "border-teal-300/50 bg-teal-300/10 text-teal-100" : "border-white/10 text-zinc-300"}`}><Radio name="practice-answer-mode" value={value} checked={props.answerMode === value} onChange={() => props.onAnswerModeChange(value)} />{label}</label>)}</fieldset>
        {props.answerMode === "TEXT" ? <Textarea aria-label="练习作答" controlHeight="lg" className="leading-6" value={props.answerText} onChange={(event) => props.onAnswerTextChange(event.target.value)} placeholder="写下答案或关键步骤" /> : <label className="flex items-center gap-3 rounded-md border border-white/10 p-4 text-sm text-zinc-200"><Checkbox checked={props.paperCompleted} onChange={(event) => props.onPaperCompletedChange(event.target.checked)} />我已在纸上或口头完成独立作答</label>}
        <Button type="button" variant="primary" disabled={props.answerMode === "TEXT" ? !props.answerText.trim() : !props.paperCompleted} onClick={props.onReveal}><Eye size={16} aria-hidden />查看答案与思路</Button>
      </> : <div className="space-y-4 border-t border-white/10 pt-4"><div className="af-content-grid-two grid gap-4"><div><p className="text-xs text-zinc-500">标准答案</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{current.correctAnswer || "未记录标准答案"}</p></div><div><p className="text-xs text-zinc-500">正确思路</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-200">{current.correctIdea}</p></div></div><fieldset className="flex flex-wrap gap-2"><legend className="mb-2 w-full text-sm text-zinc-400">本次结果</legend>{([['PASSED', '通过'], ['PARTIAL', '部分掌握'], ['FAILED', '未通过']] as const).map(([value, label]) => <label key={value} className={`flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${props.result === value ? "border-teal-300/50 bg-teal-300/10 text-teal-100" : "border-white/10 text-zinc-300"}`}><Radio name="practice-result" value={value} checked={props.result === value} onChange={() => props.onResultChange(value)} />{label}</label>)}</fieldset><Textarea aria-label="练习复盘备注" controlHeight="md" className="leading-6" value={props.note} onChange={(event) => props.onNoteChange(event.target.value)} placeholder="记录卡点、遗漏或下次注意事项" /><div className="flex flex-wrap gap-2"><Button type="button" variant="primary" disabled={props.pending} onClick={props.onSave}><Save size={16} aria-hidden />{props.pending ? "保存中" : props.index + 1 === props.total ? "保存并完成练习" : "保存并进入下一题"}</Button><Button type="button" variant="ghost" onClick={props.onBackToAnswer}><RotateCcw size={15} aria-hidden />重新核对作答</Button></div></div>}
      {props.error ? <Alert tone="danger">{props.error}</Alert> : null}
    </section>
  </div>;
}

function PracticeSummary({ results, onAgain }: { results: PracticeResult[]; onAgain: () => void }) {
  const passed = results.filter((item) => item.attempt.result === "PASSED").length;
  const partial = results.filter((item) => item.attempt.result === "PARTIAL").length;
  const failed = results.filter((item) => item.attempt.result === "FAILED").length;
  return <div className="mx-auto w-full max-w-4xl space-y-6"><PageHeader eyebrow="练习完成" title="本轮结果" description="作答历史已经保存。排期没有自动改变，失败或部分掌握的题目可进入详情后确认下一次复习。" /><section className="af-metric-grid-three grid gap-3"><Stat label="通过" value={`${passed} 题`} /><Stat label="部分掌握" value={`${partial} 题`} /><Stat label="未通过" value={`${failed} 题`} /></section><section className="space-y-3"><SectionHeader title="本轮明细" description="优先处理未通过和部分掌握的题目。" /><ul className="divide-y divide-white/10 border-y border-white/10">{results.map((item) => <li key={item.attempt.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="break-words font-medium text-zinc-100">{item.mistake.title}</p><Badge tone={item.attempt.result === "PASSED" ? "success" : item.attempt.result === "PARTIAL" ? "warning" : "danger"}>{resultLabel(item.attempt.result)}</Badge></div><p className="mt-1 text-xs text-zinc-500">{item.mistake.subjectName} · {item.attempt.answerMode === "TEXT" ? "文字作答" : "纸上 / 口头"}</p></div><ButtonLink href={`${withReturnTo(`/knowledge/mistakes/${item.mistake.id}`, "/knowledge/mistakes/practice")}#mistake-schedule-section`} variant="ghost" size="sm">打开详情<ArrowRight size={14} aria-hidden /></ButtonLink></li>)}</ul></section><div className="flex flex-wrap gap-2"><Button type="button" variant="primary" onClick={onAgain}><RotateCcw size={15} aria-hidden />再来一轮</Button><ButtonLink href="/knowledge/mistakes" variant="secondary"><ArrowLeft size={15} aria-hidden />返回错题本</ButtonLink></div></div>;
}

function Stat({ label, value }: { label: string; value: string }) { return <Metric label={label} value={value} valueSize="lg" className="border-l border-white/10 !p-0 !pl-3" />; }
function CauseOptions() { return <><option value="unknown">未分类</option><option value="concept_confusion">概念混淆</option><option value="formula_unfamiliar">公式不熟</option><option value="wrong_approach">方法错误</option><option value="careless">粗心</option><option value="time_pressure">时间压力</option><option value="unfamiliar_pattern">题型陌生</option></>; }
function resultLabel(value: Result) { return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过"; }
function createSessionId() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

function freezeAttemptCommand(command: MistakeAttemptCommand): MistakeAttemptCommand {
  return {
    mistakeId: command.mistakeId,
    index: command.index,
    payload: { ...command.payload },
  };
}

function attemptConflictComparisons(conflict: MistakeAttemptConflict) {
  return [
    { field: "answerMode", label: "作答方式", local: conflict.command.payload.answerMode, server: conflict.latest?.attempts[0]?.answerMode ?? "服务端未返回本题作答" },
    { field: "result", label: "本次结果", local: conflict.command.payload.result, server: conflict.latest?.attempts[0]?.result ?? "服务端未返回本题结果" },
    { field: "updatedAt", label: "错题更新时间", local: "本次提交前", server: conflict.latest?.updatedAt ?? "未知" },
  ];
}

function isMistakeDtoSnapshot(value: unknown): value is MistakeDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mistake = value as Partial<MistakeDto>;
  return typeof mistake.id === "string"
    && typeof mistake.updatedAt === "string"
    && typeof mistake.title === "string"
    && Array.isArray(mistake.attempts);
}
function flattenNodes(nodes: SyllabusOptionNodeDto[]) { const result: Array<SyllabusOptionNodeDto & { depth: number }> = []; function visit(items: SyllabusOptionNodeDto[], depth: number) { for (const node of items) { result.push({ ...node, depth }); if (node.children?.length) visit(node.children, depth + 1); } } visit(nodes, 0); return result; }
const inputClass = "mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-zinc-100";
