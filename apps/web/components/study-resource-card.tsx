import { ArrowRight, FileText, Globe } from "lucide-react";
import { ListDetailLink } from "@/components/list-return-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { resourceCategories } from "@/components/study-resource-workbench-support";
import type { StudyResourceDto } from "@/lib/contracts";

export function StudyResourceCard({
  resource,
  subjectName,
}: {
  resource: StudyResourceDto;
  subjectName: string;
}) {
  return (
    <Card variant="master" className="flex flex-col justify-between p-5 transition-all hover:border-white/20">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-zinc-400">{subjectName}</span>
          <Badge tone="info">
            <span className="flex items-center gap-1">
              {resource.sourceType === "FILE" ? (
                <FileText className="h-3 w-3" aria-hidden />
              ) : (
                <Globe className="h-3 w-3" aria-hidden />
              )}
              {sourceTypeLabel(resource.sourceType)}
            </span>
          </Badge>
          <Badge tone={resource.organizeStatus === "READY_FOR_USE" ? "success" : resource.organizeStatus === "ARCHIVED" ? "neutral" : "warning"}>
            {organizeStatusLabel(resource.organizeStatus)}
          </Badge>
        </div>

        <h3 className="mt-2.5 break-words text-base font-semibold text-white">
          {resource.title}
        </h3>

        <p className="mt-1 break-words text-xs text-zinc-400">
          {categoryLabel(resource.category)}
          {resource.displayHost ? ` · ${resource.displayHost}` : ""}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-end border-t border-white/5 pt-3">
        <ListDetailLink
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-teal-300 transition-colors hover:bg-white/[0.05] hover:text-teal-200"
          href={`/knowledge/resources/${resource.id}`}
          focusId={`resource-${resource.id}`}
        >
          打开详情
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </ListDetailLink>
      </div>
    </Card>
  );
}

function sourceTypeLabel(value: StudyResourceDto["sourceType"]) {
  return value === "FILE" ? "文件" : "外链";
}

function organizeStatusLabel(value: StudyResourceDto["organizeStatus"]) {
  if (value === "READY_FOR_USE") return "可使用";
  if (value === "ARCHIVED") return "已归档";
  return "待整理";
}

function categoryLabel(value: string) {
  return resourceCategories.find(([key]) => key === value)?.[1] ?? value;
}
