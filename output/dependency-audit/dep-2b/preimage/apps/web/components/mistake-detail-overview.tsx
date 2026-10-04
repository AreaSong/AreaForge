import { KnowledgeObjectDetailHeader } from "@/components/knowledge-object-detail-header";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { Button, IconButton } from "@/components/ui/button";
import type { MistakeDto } from "@/lib/contracts";
import { formatDate } from "@/lib/formatters";
import { Archive, ArrowRight, CalendarCheck, Pencil, Play, RotateCcw } from "lucide-react";
import Link from "next/link";

interface MistakeDetailOverviewProps {
  context: {
    mistake: MistakeDto;
    readOnly: boolean;
    subjectArchived: boolean;
    workspaceName: string;
    returnTo: string | undefined;
    objectHref: string;
  };
  state: {
    archived: boolean;
    editing: boolean;
    reviewDue: boolean;
    complete: boolean;
    pending: boolean;
    revealed: boolean;
  };
  actions: {
    restore: () => void;
    startEditing: () => void;
    requestArchive: () => void;
  };
}

export function MistakeDetailOverview({ context, state, actions }: MistakeDetailOverviewProps) {
  const { mistake, readOnly, subjectArchived, workspaceName, returnTo, objectHref } = context;
  const { archived, editing, reviewDue, complete, pending, revealed } = state;
  const schedule = mistake.reviewSchedule;

  return (
    <>
      <KnowledgeObjectDetailHeader
        fallbackHref="/knowledge/mistakes"
        fallbackLabel="返回错题列表"
        returnTo={returnTo}
        eyebrow={`${mistake.subjectName} · ${mistake.syllabusNodeTitle ?? "未关联考纲"}`}
        title={mistake.title}
        description={mistake.source ? `来源：${mistake.source}` : "来源尚未记录"}
        actions={!readOnly ? <>
          {archived ? (
            <Button type="button" variant="primary" disabled={pending} onClick={actions.restore} className="h-10 px-3"><RotateCcw size={16} aria-hidden />恢复错题</Button>
          ) : editing ? null : reviewDue && schedule && complete ? (
            <Link href={`/knowledge/reviews/${schedule.id}/run?returnTo=${encodeURIComponent(objectHref)}`} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-3 text-sm font-medium text-black"><Play size={16} aria-hidden />开始复习</Link>
          ) : complete ? (
            <Button type="button" variant="primary" onClick={actions.startEditing} className="h-10 px-3"><Pencil size={16} aria-hidden />编辑错题</Button>
          ) : null}
          {!archived && reviewDue && complete ? <IconButton label="编辑错题" title="编辑错题" onClick={actions.startEditing} className="size-10 text-zinc-200"><Pencil size={16} aria-hidden /></IconButton> : null}
          {!archived && !editing ? <IconButton label="归档错题" title="归档错题" disabled={pending} onClick={actions.requestArchive} className="size-10 text-zinc-300"><Archive size={16} aria-hidden /></IconButton> : null}
        </> : null}
      />

      {readOnly ? <p role="status" className="border-l-2 border-zinc-500 pl-3 text-sm leading-6 text-zinc-300">{subjectArchived ? `“${mistake.subjectName}”科目已归档` : `“${workspaceName}”工作区已归档`}，本页只读保留错题与复习历史；不会进入当前排期或写事务。</p> : archived ? <p role="status" className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">错题已归档，当前只读；相关复习排期已暂停。恢复错题后仍需重新选择复习日期。</p> : !complete ? <p role="status" className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">待补全：这条旧错题缺少明确错因或正确思路。补全前不能新增或开始复习。</p> : null}

      <KnowledgeNextAction
        title={readOnly || archived ? "保留错题内容与复习历史" : !complete ? "先补全错因与正确思路" : !revealed ? "先独立重做这道错题" : reviewDue ? "完成这道错题的到期复习" : schedule?.status === "ACTIVE" ? "按排期继续复习这道错题" : "安排这道错题的首次复习"}
        description={readOnly || archived
          ? "当前对象只读，仍可查看题面、正确思路和历史。"
          : !complete
            ? "补全后才能建立或开始统一复习排期。"
            : !revealed
              ? "先选择作答方式并完成答案，再揭示标准答案和正确思路。"
              : reviewDue
                ? "到期复习由页头主操作承接，确认结果后会写入复习历史。"
                : schedule?.status === "ACTIVE"
                  ? `下一次复习：${schedule.dueDate ? formatDate(schedule.dueDate) : "未设置日期"}。`
                  : "先选择一个日期建立统一复习排期，之后会出现在复习队列中。"}
        status={readOnly ? <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-400">只读</span> : archived ? <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-400">已归档</span> : reviewDue ? <span className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">已到期 · 从页头开始</span> : null}
        action={!readOnly && !archived && !complete ? (
          <Button type="button" variant="primary" onClick={actions.startEditing} className="h-10 px-3"><Pencil size={16} aria-hidden />补全错题<ArrowRight size={16} aria-hidden /></Button>
        ) : !readOnly && !archived && complete && revealed && !reviewDue && schedule?.status === "ACTIVE" ? (
          <Link href={`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(objectHref)}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 hover:bg-teal-300/10"><CalendarCheck size={16} aria-hidden />查看复习排期<ArrowRight size={16} aria-hidden /></Link>
        ) : !readOnly && !archived && complete && revealed && !reviewDue ? (
          <a href="#mistake-schedule-section" className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] hover:bg-teal-300"><CalendarCheck size={16} aria-hidden />设置首次复习<ArrowRight size={16} aria-hidden /></a>
        ) : null}
      />
    </>
  );
}
