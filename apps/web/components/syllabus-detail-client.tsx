"use client";

import { Archive, ArrowRight, BookOpenCheck, CalendarCheck, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { KnowledgeObjectDetailHeader } from "@/components/knowledge-object-detail-header";
import { SyllabusDetailEditor } from "@/components/syllabus-detail-editor";
import { SyllabusRetestForm } from "@/components/syllabus-retest-form";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { withReturnTo } from "@/lib/navigation/batch7";
import type { ReviewScheduleDto } from "@/lib/study/review-schedule-service";
import type { SyllabusNodeDto, SyllabusOptionNodeDto } from "@/lib/study/types";

type DetailView = "overview" | "evidence" | "retests";
type ArchiveIntent = "archive" | "restore";

interface ArchiveConflict {
  intent: ArchiveIntent;
  latest: SyllabusNodeDto;
  conflictFields: string[];
}

export function SyllabusDetailClient(props: {
  node: SyllabusNodeDto;
  parentOptions: SyllabusOptionNodeDto[];
  schedule: ReviewScheduleDto | null;
  renderedAt: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<DetailView>("overview");
  const [editing, setEditing] = useState(false);
  const [retesting, setRetesting] = useState(false);
  const [pending, setPending] = useState<ArchiveIntent | "schedule" | null>(null);
  const [reviewDate, setReviewDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ArchiveConflict | null>(null);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const restoreEditFocusRef = useRef(false);
  const archived = Boolean(props.node.archivedAt);
  const reviewDue = props.schedule?.status === "ACTIVE"
    && Boolean(props.schedule.dueDate)
    && Date.parse(props.schedule.dueDate as string) <= Date.parse(props.renderedAt);
  const objectHref = props.returnTo
    ? withReturnTo(`/knowledge/syllabus/${props.node.id}`, props.returnTo)
    : `/knowledge/syllabus/${props.node.id}`;

  useEffect(() => {
    if (editing || !restoreEditFocusRef.current) return;
    restoreEditFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      (editButtonRef.current ?? messageRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing, message]);

  async function changeArchiveState(intent: ArchiveIntent) {
    if (pending) return;
    setPending(intent);
    setMessage(null);
    try {
      const response = await fetch(`/api/syllabus/nodes/${props.node.id}/${intent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: props.node.revision }),
      });
      const body = await readNodeResponse(response);
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        router.replace("/knowledge/syllabus");
        return;
      }
      if (!response.ok) {
        if (response.status === 409 && isSyllabusNodeDto(body?.latest)) {
          setConflict({ intent, latest: body.latest, conflictFields: body.conflictFields ?? ["revision"] });
        }
        setMessage(body?.error ?? `${intent === "archive" ? "归档" : "恢复"}失败，当前状态没有改变。`);
        return;
      }
      setEditing(false);
      setRetesting(false);
      setMessage(intent === "archive"
        ? "节点已归档，活动复习排期已暂停。"
        : "节点已恢复；原复习排期仍保持暂停。");
      router.refresh();
    } catch {
      setMessage(`网络不可用，节点${intent === "archive" ? "归档" : "恢复"}状态没有改变；请显式重试。`);
    } finally {
      setPending(null);
    }
  }

  async function scheduleReview() {
    if (pending || archived || !reviewDate) return;
    setPending("schedule");
    setMessage(null);
    try {
      const response = await fetch("/api/review-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "SYLLABUS_NODE",
          syllabusNodeId: props.node.id,
          dueDate: shanghaiDateToIso(reviewDate),
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setMessage(body?.error ?? "复习排期保存失败，当前排期没有改变。");
        return;
      }
      setReviewDate("");
      setMessage("复习排期已保存。");
      router.refresh();
    } catch {
      setMessage("网络不可用，复习排期没有改变；恢复网络后请显式重试。");
    } finally {
      setPending(null);
    }
  }

  function refreshAfterEdit(message: string) {
    restoreEditFocusRef.current = true;
    setEditing(false);
    setRetesting(false);
    setMessage(message);
    router.refresh();
  }

  return (
    <article className="space-y-6" aria-busy={Boolean(pending)}>
      <KnowledgeObjectDetailHeader
        fallbackHref="/knowledge/syllabus"
        fallbackLabel="返回考纲树"
        returnTo={props.returnTo}
        eyebrow={`${props.node.subjectName} · ${kindLabel(props.node.kind)} · r${props.node.revision}`}
        title={props.node.title}
        description={<>
            {statusLabel(props.node.status)} · 掌握等级 {masteryLabel(props.node.masteryLevel)}
            {archived ? " · 已归档" : ""}
          </>}
        actions={<>
          {archived ? (
            <button type="button" disabled={Boolean(pending)} onClick={() => void changeArchiveState("restore")} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black disabled:opacity-50">
              <RotateCcw size={16} aria-hidden />{pending === "restore" ? "恢复中" : "恢复节点"}
            </button>
          ) : editing || retesting ? null : reviewDue && props.schedule ? (
            <Link href={`/quick-review/${props.schedule.id}?returnTo=${encodeURIComponent(objectHref)}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black">
              <BookOpenCheck size={16} aria-hidden />开始复测
            </Link>
          ) : (
            <button ref={editButtonRef} type="button" disabled={Boolean(pending)} onClick={() => { setEditing(true); setRetesting(false); }} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black disabled:opacity-50">
              <Pencil size={16} aria-hidden />编辑节点
            </button>
          )}
          {!archived && !reviewDue && !editing && !retesting ? (
            <button type="button" title="记录复测" aria-label="记录复测" onClick={() => { setView("retests"); setRetesting(true); setEditing(false); }} className="grid size-10 place-items-center rounded-md border border-white/10 text-zinc-200">
              <BookOpenCheck size={16} aria-hidden />
            </button>
          ) : null}
          {!archived && !editing && !retesting ? (
            <button type="button" title="归档节点" aria-label="归档节点" disabled={Boolean(pending)} onClick={() => setArchiveConfirmationOpen(true)} className="grid size-10 place-items-center rounded-md border border-white/10 text-zinc-300 disabled:opacity-50">
              <Archive size={16} aria-hidden />
            </button>
          ) : null}
        </>}
      />

      {message ? <p ref={messageRef} role="status" tabIndex={-1} className="rounded-md border border-white/10 bg-[#101419] px-3 py-2 text-sm text-zinc-300">{message}</p> : null}

      {!editing && !retesting ? (
        <NextAction
          node={props.node}
          schedule={props.schedule}
          archived={archived}
          reviewDue={reviewDue}
          returnHref={objectHref}
        />
      ) : null}

      {editing && !archived ? (
        <SyllabusDetailEditor
          node={props.node}
          parentOptions={props.parentOptions.filter((node) => node.subjectId === props.node.subjectId)}
          onCancel={() => setEditing(false)}
          onSaved={() => refreshAfterEdit("考纲节点已保存。")}
        />
      ) : null}

      <nav className="inline-flex max-w-full rounded-md border border-white/10 p-1" aria-label="考纲详情视图">
        {(["overview", "evidence", "retests"] as DetailView[]).map((item) => (
          <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)} className={`h-9 rounded px-3 text-sm ${view === item ? "bg-white/10 text-white" : "text-zinc-400"}`}>
            {item === "overview" ? "概览" : item === "evidence" ? "证据" : "复测"}
          </button>
        ))}
      </nav>

      {view === "overview" ? <Overview node={props.node} schedule={props.schedule} archived={archived} reviewDate={reviewDate} pending={Boolean(pending)} returnHref={objectHref} onReviewDateChange={setReviewDate} onSchedule={() => void scheduleReview()} /> : null}
      {view === "evidence" ? <EvidenceView node={props.node} /> : null}
      {view === "retests" ? (
        <section className="space-y-4">
          {retesting && !archived ? <SyllabusRetestForm nodeId={props.node.id} onCancel={() => setRetesting(false)} onSaved={() => refreshAfterEdit("复测记录已保存。")}/> : null}
          {!retesting && !archived ? <button type="button" onClick={() => setRetesting(true)} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200"><BookOpenCheck size={16} aria-hidden />记录复测</button> : null}
          <RetestHistory items={props.node.masteryRetests} />
        </section>
      ) : null}

      <ConfirmationDialog
        open={archiveConfirmationOpen}
        title="归档这个考纲节点？"
        description="归档后节点变为只读，活动复习排期会暂停。恢复节点不会自动恢复排期。"
        confirmLabel="确认归档"
        pending={pending === "archive"}
        pendingLabel="正在归档"
        onClose={() => setArchiveConfirmationOpen(false)}
        onConfirm={() => {
          setArchiveConfirmationOpen(false);
          void changeArchiveState("archive");
        }}
      />

      <ConflictResolutionModal
        open={Boolean(conflict)}
        title="考纲节点状态已变化"
        description="节点已在其他页面或设备更新。系统不会用旧 revision 强制覆盖。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? [
          { field: "revision", local: props.node.revision, server: conflict.latest.revision },
          { field: "archivedAt", local: props.node.archivedAt, server: conflict.latest.archivedAt },
        ] : []}
        onClose={() => setConflict(null)}
        onAdoptServer={() => { setConflict(null); setMessage("正在读取服务端最新状态。"); router.refresh(); }}
        onManualMerge={() => { const intent = conflict?.intent; setConflict(null); setMessage(`已请求最新状态；请核对后再次显式执行${intent === "archive" ? "归档" : "恢复"}。`); router.refresh(); }}
      />
    </article>
  );
}

function Overview(props: {
  node: SyllabusNodeDto;
  schedule: ReviewScheduleDto | null;
  archived: boolean;
  reviewDate: string;
  pending: boolean;
  returnHref: string;
  onReviewDateChange: (value: string) => void;
  onSchedule: () => void;
}) {
  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="目标投入" value={`${props.node.targetMinutes} 分钟`} />
        <Metric label="实际投入" value={`${props.node.actualMinutes} 分钟`} />
        <Metric label="风险" value={riskLabel(props.node.masteryProof.risk)} />
      </section>
      <section className="space-y-3 border-t border-white/10 pt-5">
        <h2 className="font-medium text-white">统一复习</h2>
        {props.schedule ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
            <span>{props.schedule.status === "ACTIVE" ? "活动排期" : "已暂停"} · {props.schedule.dueDate ? new Date(props.schedule.dueDate).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未设置日期"}</span>
            <Link className="text-teal-300 hover:underline" href={`/knowledge/reviews/${props.schedule.id}?returnTo=${encodeURIComponent(props.returnHref)}`}>管理排期</Link>
            {props.schedule.status === "PAUSED" && props.schedule.pausedReason === "TARGET_ARCHIVED" ? <span className="text-amber-200">恢复节点不会自动恢复排期，请在排期页重新选择日期。</span> : null}
          </div>
        ) : props.archived ? (
          <p className="text-sm text-zinc-500">归档节点不能创建新排期。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input aria-label="首次复习日期" type="date" value={props.reviewDate} onChange={(event) => props.onReviewDateChange(event.target.value)} className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" />
            <button type="button" disabled={props.pending || !props.reviewDate} onClick={props.onSchedule} className="h-10 rounded-md border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-50">设置首次复习日期</button>
          </div>
        )}
      </section>
    </div>
  );
}

function NextAction(props: {
  node: SyllabusNodeDto;
  schedule: ReviewScheduleDto | null;
  archived: boolean;
  reviewDue: boolean;
  returnHref: string;
}) {
  const taskHref = `/plan?createMinimum=1&subjectId=${encodeURIComponent(props.node.subjectId)}&syllabusNodeId=${encodeURIComponent(props.node.id)}`;
  const scheduleHref = props.schedule
    ? `/knowledge/reviews/${props.schedule.id}?returnTo=${encodeURIComponent(props.returnHref)}`
    : null;

  return (
    <section className="rounded-lg border border-teal-300/20 bg-teal-300/5 p-4 sm:p-5" aria-labelledby="syllabus-next-action-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-200">下一行动</p>
          <h2 id="syllabus-next-action-heading" className="mt-1 text-lg font-semibold text-white">{props.node.mapSignal.nextAction}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{props.node.masteryProof.nextAction}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {props.archived ? (
            <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-400">已归档 · 只读</span>
          ) : props.reviewDue ? (
            <span className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">已到期 · 待复测</span>
          ) : scheduleHref ? (
            <Link href={scheduleHref} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 hover:bg-teal-300/10">
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              查看复习排期
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <Link href={taskHref} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] hover:bg-teal-300">
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              安排最小学习任务
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function EvidenceView({ node }: { node: SyllabusNodeDto }) {
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="任务" value={`${node.evidence.taskCount}`} />
        <Metric label="计时" value={`${node.evidence.sessionCount}`} />
        <Metric label="卡片" value={`${node.evidence.noteCount}`} />
        <Metric label="错题" value={`${node.evidence.mistakeCount}`} />
      </div>
      <div className="border-t border-white/10 pt-5">
        <h2 className="font-medium text-white">显式掌握证据</h2>
        <ul className="mt-3 space-y-3">
          {node.masteryEvidence.map((evidence) => <li key={evidence.id} className="text-sm text-zinc-300"><span className="text-white">{evidence.sourceLabel}</span>{evidence.summary ? ` · ${evidence.summary}` : ""} · {new Date(evidence.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</li>)}
          {node.masteryEvidence.length === 0 ? <li className="text-sm text-zinc-500">尚无显式证据。</li> : null}
        </ul>
      </div>
    </section>
  );
}

function RetestHistory({ items }: { items: SyllabusNodeDto["masteryRetests"] }) {
  return (
    <section className="border-t border-white/10 pt-5">
      <h2 className="font-medium text-white">复测历史</h2>
      <ul className="mt-3 space-y-3">
        {items.map((retest) => <li key={retest.id} className="text-sm text-zinc-300"><span className="text-white">{retestLabel(retest.result)}</span> · {new Date(retest.testedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}{retest.score ? ` · ${retest.score}` : ""}{retest.summary ? <p className="mt-1 text-zinc-500">{retest.summary}</p> : null}</li>)}
        {items.length === 0 ? <li className="text-sm text-zinc-500">尚无复测记录。</li> : null}
      </ul>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-l border-white/10 pl-3"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-lg text-white">{value}</p></div>; }
function shanghaiDateToIso(value: string): string { return new Date(`${value}T00:00:00+08:00`).toISOString(); }
function kindLabel(value: SyllabusNodeDto["kind"]): string { return ({ subject: "科目", chapter: "章节", topic: "知识点", problem_type: "题型专题" })[value]; }
function statusLabel(value: SyllabusNodeDto["status"]): string { return ({ not_started: "未开始", learning: "学习中", covered: "已覆盖", needs_review: "待复习", mastered: "已掌握", weak: "薄弱", deferred: "延期" })[value]; }
function masteryLabel(value: SyllabusNodeDto["masteryLevel"]): string { return value ? ({ seen: "见过", learned: "已学习", basic_exercises: "基础题", can_explain: "能讲解", retest_passed: "复测通过", exam_stable: "考试稳定" })[value] : "未记录"; }
function riskLabel(value: SyllabusNodeDto["masteryProof"]["risk"]): string { return ({ no_evidence: "无证据", thin_evidence: "证据偏少", stale_evidence: "证据过旧", ready: "证据就绪" })[value]; }
function retestLabel(value: SyllabusNodeDto["masteryRetests"][number]["result"]): string { return ({ passed: "通过", partial: "部分通过", failed: "未通过" })[value]; }

async function readNodeResponse(response: Response): Promise<{ error?: string; latest?: unknown; conflictFields?: string[] } | null> {
  return response.json().catch(() => null) as Promise<{ error?: string; latest?: unknown; conflictFields?: string[] } | null>;
}

function isSyllabusNodeDto(value: unknown): value is SyllabusNodeDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Partial<SyllabusNodeDto>;
  return typeof node.id === "string" && typeof node.revision === "number" && typeof node.title === "string" && Array.isArray(node.masteryRetests);
}
