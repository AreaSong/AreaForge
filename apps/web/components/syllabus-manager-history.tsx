import { labelMasteryEvidenceType, labelMasteryRetestResult } from "@/components/syllabus-manager-labels";
import type { SyllabusNodeDto } from "@/lib/contracts";
import { isoToShanghaiDateInput } from "@/lib/formatters";

export function MasteryEvidenceList({ items }: { items: SyllabusNodeDto["masteryEvidence"] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
        <p className="text-sm font-medium text-zinc-100">显式证据</p>
        <p className="mt-2 text-xs text-zinc-500">暂无</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
      <p className="text-sm font-medium text-zinc-100">显式证据</p>
      <div className="mt-2 grid gap-2">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="rounded-md border border-white/10 bg-[#151a20] px-2 py-2">
            <p className="text-xs text-zinc-100">
              {labelMasteryEvidenceType(item.evidenceType)} / {item.sourceLabel}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{isoToShanghaiDateInput(item.createdAt)}</p>
            {item.summary ? <p className="mt-1 text-xs text-zinc-400">{item.summary}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MasteryRetestList({ items }: { items: SyllabusNodeDto["masteryRetests"] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
        <p className="text-sm font-medium text-zinc-100">复测历史</p>
        <p className="mt-2 text-xs text-zinc-500">暂无</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
      <p className="text-sm font-medium text-zinc-100">复测历史</p>
      <div className="mt-2 grid gap-2">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="rounded-md border border-white/10 bg-[#151a20] px-2 py-2">
            <p className="text-xs text-zinc-100">
              {labelMasteryRetestResult(item.result)} / {isoToShanghaiDateInput(item.testedAt)}
              {item.score ? ` / ${item.score}` : ""}
            </p>
            {item.nextReviewAt ? <p className="mt-1 text-xs text-zinc-500">下次：{isoToShanghaiDateInput(item.nextReviewAt)}</p> : null}
            {item.summary ? <p className="mt-1 text-xs text-zinc-400">{item.summary}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
