"use client";

import { ListDetailLink } from "@/components/list-return-context";
import { MasteryEvidenceList, MasteryRetestList } from "@/components/syllabus-manager-history";
import {
  labelEvidenceFreshness,
  labelEvidenceSource,
  labelKind,
  labelMapCell,
  labelMasteryCondition,
  labelStatus,
  masteryConditionOptions,
  StatusOptions,
} from "@/components/syllabus-manager-labels";
import {
  MasteryControls,
  MasteryEvidenceForm,
  MasteryRetestForm,
} from "@/components/syllabus-manager-tree-forms";
import {
  useSyllabusEvidenceForm,
  useSyllabusMasteryControls,
  useSyllabusRetestForm,
} from "@/components/syllabus-manager-tree-node-hooks";
import type { SyllabusTreeNodeProps } from "@/components/syllabus-manager-types";
import { Badge } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import type { SyllabusNodeStatusDto } from "@/lib/contracts";
import { ArrowRight, ChevronRight } from "lucide-react";

export function SyllabusTreeNode({
  node,
  onUpdate,
  onAddMasteryEvidence,
  onAddMasteryRetest,
  pendingCommand,
}: SyllabusTreeNodeProps) {
  const pending = pendingCommand?.startsWith(`${node.id}:`) ?? false;
  const mastery = useSyllabusMasteryControls(node, onUpdate);
  const evidence = useSyllabusEvidenceForm(node, onAddMasteryEvidence);
  const retest = useSyllabusRetestForm(node, onAddMasteryRetest);
  const progress = node.targetMinutes === 0
    ? 0
    : Math.min(100, Math.round((node.actualMinutes / node.targetMinutes) * 100));
  const explicitConditionCount = node.masteryConditionRecords.filter((record) => record.checked).length;

  function updateStatus(nextStatus: SyllabusNodeStatusDto) {
    if (nextStatus === "mastered") {
      void onUpdate(node.id, {
        status: nextStatus,
        masteryLevel: mastery.state.targetMasteryLevel,
        masteryConditions: mastery.state.selectedConditions,
      });
      return;
    }
    void onUpdate(node.id, { status: nextStatus });
  }

  return (
    <article className="min-w-0 rounded-md border border-white/10 bg-[#151a20] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ChevronRight className="h-4 w-4 text-teal-300" aria-hidden="true" />
            <Badge tone="info">{labelKind(node.kind)}</Badge>
            <Badge tone={getStatusTone(node.status)}>{labelStatus(node.status)}</Badge>
            {labelMapCell(node.mapSignal.cellStatus) !== labelStatus(node.status) ? <Badge>{labelMapCell(node.mapSignal.cellStatus)}</Badge> : null}
          </div>
          <h3 className="mt-2 min-w-0 break-words font-medium text-white">{node.title}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            进度 {node.actualMinutes} / {node.targetMinutes} 分钟 · 证据 {node.masteryProof.evidenceCount} 条 · 最近证据 {labelEvidenceFreshness(node.evidence.daysSinceLastEvidence)}
          </p>
          <p className="mt-2 break-words text-sm leading-6 text-zinc-300">{node.mapSignal.nextAction}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label={`更新 ${node.title} 状态`} className="max-w-full" value={node.status} onChange={(event) => updateStatus(event.target.value as SyllabusNodeStatusDto)} disabled={pending}>
            <StatusOptions />
          </Select>
          <ListDetailLink href={`/knowledge/syllabi/${node.id}`} focusId={`syllabus-${node.id}`} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-teal-300 hover:bg-white/[0.05]">
            打开详情
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ListDetailLink>
        </div>
      </div>

      <details className="mt-3 border-t border-white/10 pt-3">
        <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200">管理掌握证明与复测</summary>
        <div className="mt-3">
          <MasteryControls node={node} controller={mastery} pending={pending} />
        </div>
        <div className="af-content-grid-two mt-3 grid min-w-0 gap-3">
          <MasteryEvidenceForm controller={evidence} pending={pending} />
          <MasteryRetestForm controller={retest} pending={pending} />
        </div>
        {node.masteryEvidence.length > 0 || node.masteryRetests.length > 0 ? (
          <div className="af-content-grid-two mt-3 grid min-w-0 gap-3">
            <MasteryEvidenceList items={node.masteryEvidence} />
            <MasteryRetestList items={node.masteryRetests} />
          </div>
        ) : null}
        <MasteryWarnings node={node} />
        <div className="mt-3 grid gap-1 text-xs text-zinc-500">
          {node.mapSignal.reasons.slice(0, 2).map((reason) => <p key={reason}>{reason}</p>)}
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

function MasteryWarnings({ node }: { node: SyllabusTreeNodeProps["node"] }) {
  if (node.masteryProof.evidenceCount === 0) {
    return <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">还没有掌握证据，不能直接标记掌握。</p>;
  }
  if (!node.masteryProof.canMarkRequestedLevel) {
    const missing = [
      ...node.masteryProof.missingConditions.map(labelMasteryCondition),
      ...node.masteryProof.missingEvidence,
    ];
    return <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">当前已记录证明还缺：{missing.join("、")}</p>;
  }
  return null;
}

function getStatusTone(status: SyllabusNodeStatusDto): "warning" | "success" | "neutral" {
  if (status === "weak" || status === "needs_review") return "warning";
  return status === "mastered" ? "success" : "neutral";
}
