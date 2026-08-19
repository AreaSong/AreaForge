"use client";

import { ArrowRight } from "lucide-react";
import { ListDetailLink } from "@/components/list-return-context";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import { resourceCategories } from "@/components/study-resource-workbench-support";
import type { StudyResourceDto } from "@/lib/study/study-resource-service";

export function StudyResourceList(props: {
  title: string;
  resources: StudyResourceDto[];
  subjects: Array<{ id: string; name: string }>;
}) {
  const subjectById = new Map(props.subjects.map((subject) => [subject.id, subject.name]));
  return (
    <section className="space-y-3">
      <SectionHeader title={props.title} meta={<Badge>{props.resources.length}</Badge>} />
      {props.resources.length ? (
        <ul className="divide-y divide-white/10 border-y border-white/10">
          {props.resources.map((resource) => (
            <li key={resource.id} className="flex min-w-0 flex-col gap-3 py-4 text-sm sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-zinc-500">{subjectById.get(resource.subjectId ?? "") ?? "未分科"}</span>
                  <Badge tone="info">{sourceTypeLabel(resource.sourceType)}</Badge>
                  <Badge tone={resource.organizeStatus === "READY_FOR_USE" ? "success" : resource.organizeStatus === "ARCHIVED" ? "neutral" : "warning"}>{organizeStatusLabel(resource.organizeStatus)}</Badge>
                </div>
                <p className="mt-2 break-words font-medium text-zinc-100">{resource.title}</p>
                <p className="mt-1 break-words text-xs text-zinc-500">
                  {categoryLabel(resource.category)}
                  {resource.displayHost ? ` · ${resource.displayHost}` : ""}
                </p>
              </div>
              <ListDetailLink className="inline-flex h-10 shrink-0 items-center gap-1 self-end rounded-md px-2 text-teal-300 hover:bg-white/[0.05] sm:self-auto" href={`/knowledge/resources/${resource.id}`} focusId={`resource-${resource.id}`}>打开详情<ArrowRight size={15} aria-hidden /></ListDetailLink>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="暂无资料" description="当前筛选下没有资料。" />}
    </section>
  );
}

function sourceTypeLabel(value: StudyResourceDto["sourceType"]) { return value === "FILE" ? "文件" : "外链"; }
function organizeStatusLabel(value: StudyResourceDto["organizeStatus"]) { if (value === "READY_FOR_USE") return "可使用"; if (value === "ARCHIVED") return "已归档"; return "待整理"; }
function categoryLabel(value: string) { return resourceCategories.find(([key]) => key === value)?.[1] ?? value; }
