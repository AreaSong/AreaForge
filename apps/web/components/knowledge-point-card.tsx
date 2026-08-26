import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
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
  return (
    <Card variant="master" className="flex flex-col justify-between p-5 transition-all hover:border-white/20">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={masteryStatusTone(point.masteryStatus)}>
            {masteryStatusLabel(point.masteryStatus)}
          </Badge>
          {point.needsRetest ? <Badge tone="warning">待复测</Badge> : null}
          <span className="text-xs font-medium text-zinc-400">{point.subject.name}</span>
        </div>

        <h3 className="mt-2.5 break-words text-base font-semibold text-white">
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
