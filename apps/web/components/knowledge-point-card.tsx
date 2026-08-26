import { ArrowRight, Star } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { calculateStarRating } from "@/components/knowledge-micro-badges";
import type { KnowledgePointDto } from "@/lib/contracts";
import {
  masteryStatusLabel,
  masteryStatusTone,
} from "@/lib/knowledge/mastery-status";

export function KnowledgePointCard({
  point,
  detailHref,
}: {
  point: KnowledgePointDto;
  detailHref: string;
}) {
  const starRating = calculateStarRating(point.masteryState, point.counts.retests);

  return (
    <Card variant="master" className="flex flex-col justify-between p-3.5 sm:p-4 transition-all hover:border-white/20">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={masteryStatusTone(point.masteryStatus)}>
            {masteryStatusLabel(point.masteryStatus)}
          </Badge>
          {point.needsRetest ? <Badge tone="warning">待复测</Badge> : null}
          <span className="text-xs font-medium text-zinc-400">{point.subject.name}</span>
        </div>

        <h3 className="mt-2.5 break-words text-sm font-semibold text-white sm:text-base">
          <span className="mb-1.5 flex flex-wrap items-center gap-1 text-[10.5px] font-normal">
            <span
              title={`证据: ${point.counts.evidence}条`}
              className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-300"
            >
              <span>证据: {point.counts.evidence}条</span>
            </span>
            <span
              title={`复测: ${point.counts.retests}次`}
              className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-300"
            >
              <span>复测: {point.counts.retests}次</span>
            </span>
            <span
              title={`掌握可信度 ${point.masteryConfidence}%`}
              className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono ${
                point.masteryConfidence >= 75
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : point.masteryConfidence >= 50
                    ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
              }`}
            >
              <span>可信度: {point.masteryConfidence}%</span>
            </span>
            <span
              title={`重要度 ★${starRating}`}
              className="inline-flex items-center gap-0.5 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-300"
            >
              <Star size={10} className="fill-amber-400 text-amber-400" aria-hidden />
              <span>★ {starRating}星</span>
            </span>
          </span>
          <Link href={detailHref} className="hover:text-teal-200 transition-colors">
            {point.title}
          </Link>
        </h3>

        <p className="mt-1 break-words text-xs text-zinc-400">
          {point.primaryGroup ? `${point.primaryGroup.title} · ` : ""}
          {point.boundary ? point.boundary : "未设置边界说明"}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
        <p className="text-xs text-zinc-500">
          {point.counts.evidence} 条证据 · {point.counts.retests} 次复测 · 可信度 {point.masteryConfidence}%
        </p>
        <Link
          href={detailHref}
          aria-label={`打开 ${point.title}`}
          title="打开知识点"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-teal-300 transition-colors hover:bg-white/[0.05] hover:text-teal-200"
        >
          详情
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </Card>
  );
}
