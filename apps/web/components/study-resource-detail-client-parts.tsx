import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import type { StudyResourceDto, StudyResourceEditorOptionsDto } from "@/lib/contracts";
import { formatBytes } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { ResourceDetailValues } from "@/components/study-resource-detail-draft";
import { getStudyResourceCategoryLabel, STUDY_RESOURCE_CATEGORY_OPTIONS } from "@areaforge/core";

export const categories = STUDY_RESOURCE_CATEGORY_OPTIONS.map(
  ({ value, label }) => [value, label] as const,
);

export function ResourceFacts(props: {
  resource: StudyResourceDto;
  options: StudyResourceEditorOptionsDto;
  objectHref: string;
}) {
  const subject = props.options.subjects.find((option) => option.id === props.resource.subjectId)?.name ?? "未分科";
  return (
    <>
      <Card variant="master" className="space-y-4 p-5 sm:p-6" aria-labelledby="resource-facts-heading">
        <h2 id="resource-facts-heading" className="text-lg font-semibold text-white">资料事实</h2>
        <dl className="af-detail-facts-grid grid min-w-0 gap-x-6 gap-y-4 text-sm">
          <Fact label="来源" value={sourceTypeLabel(props.resource.sourceType)} />
          <Fact label="整理状态" value={organizeStatusLabel(props.resource.organizeStatus)} />
          <Fact label="资料类型" value={categoryLabel(props.resource.category)} />
          <Fact label="主科目" value={subject} />
          <Fact
            label={props.resource.sourceType === "FILE" ? "文件名" : "来源站点"}
            value={props.resource.sourceType === "FILE" ? props.resource.originalName ?? "未记录" : props.resource.displayHost ?? "未记录"}
          />
          {props.resource.sourceType === "FILE" ? <Fact label="文件大小" value={formatBytes(props.resource.sizeBytes)} /> : null}
          <Fact label="标签" value={props.resource.tags.join("、") || "无标签"} />
        </dl>
      </Card>
      <Card variant="subtle" className="space-y-4 p-5 sm:p-6" aria-labelledby="resource-associations-heading">
        <h2 id="resource-associations-heading" className="text-lg font-semibold text-white">学习关联</h2>
        <div className="af-content-grid-two grid gap-4">
          <AssociationLinks label="任务" ids={props.resource.taskIds} options={props.options.tasks} hrefFor={(id) => withReturnTo(`/roadmap/allocation/tasks/${id}`, props.objectHref)} />
          <AssociationLinks label="知识卡片" ids={props.resource.noteIds} options={props.options.notes} hrefFor={(id) => withReturnTo(`/knowledge/cards/${id}`, props.objectHref)} />
          <AssociationLinks label="错题" ids={props.resource.mistakeIds} options={props.options.mistakes} hrefFor={(id) => withReturnTo(`/knowledge/mistakes/${id}`, props.objectHref)} />
          <AssociationLinks label="考纲节点" ids={props.resource.syllabusNodeIds} options={props.options.syllabusNodes} hrefFor={(id) => withReturnTo(`/knowledge/syllabi/${id}`, props.objectHref)} />
        </div>
      </Card>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-zinc-500">{label}</dt><dd className="mt-1 break-words text-zinc-200">{value}</dd></div>;
}

function AssociationLinks(props: {
  label: string;
  ids: string[];
  options: Array<{ id: string; title: string }>;
  hrefFor: (id: string) => string;
}) {
  const optionById = new Map(props.options.map((option) => [option.id, option.title]));
  return (
    <div>
      <p className="text-sm text-zinc-500">{props.label}</p>
      {props.ids.length ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {props.ids.map((id) => <Link key={id} href={props.hrefFor(id)} className="break-words text-sm text-teal-300 hover:underline">{optionById.get(id) ?? "查看关联对象"}</Link>)}
        </div>
      ) : <p className="mt-1 text-sm text-zinc-300">未关联</p>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm text-zinc-400"><span>{label}</span><span className="mt-1 block">{children}</span></label>;
}

export function MultiSelect(props: {
  label: string;
  values: string[];
  options: Array<{ id: string; title: string }>;
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  return (
    <label className="text-sm text-zinc-400">
      <span>{props.label}</span>
      <Select
        multiple
        disabled={props.disabled}
        className="mt-1 min-h-24 bg-[#151a20] p-2 text-zinc-200"
        value={props.values}
        onChange={(event) => props.onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
      >
        {props.options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
      </Select>
    </label>
  );
}

export function splitTags(value: string) {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
}

export function sourceTypeLabel(value: StudyResourceDto["sourceType"]) {
  return value === "FILE" ? "文件资料" : "链接资料";
}

export function organizeStatusLabel(value: StudyResourceDto["organizeStatus"]) {
  if (value === "READY_FOR_USE") return "可使用";
  if (value === "ARCHIVED") return "已归档";
  return "待整理";
}

function categoryLabel(value: string) {
  return getStudyResourceCategoryLabel(value);
}

export function isStudyResourceDto(value: unknown): value is StudyResourceDto {
  if (!value || typeof value !== "object") return false;
  const resource = value as Partial<StudyResourceDto>;
  return typeof resource.id === "string" && typeof resource.revision === "number" && typeof resource.title === "string"
    && Array.isArray(resource.tags) && Array.isArray(resource.taskIds) && Array.isArray(resource.noteIds)
    && Array.isArray(resource.mistakeIds) && Array.isArray(resource.syllabusNodeIds);
}

export function resourceConflictComparisons(local: ResourceDetailValues, latest?: StudyResourceDto) {
  return [
    { field: "revision", label: "revision", local: "本地基线", server: latest?.revision },
    { field: "title", label: "标题", local: local.title, server: latest?.title },
    { field: "category", label: "资料类型", local: local.category, server: latest?.category },
    { field: "subjectId", label: "主科目", local: local.subjectId || null, server: latest?.subjectId },
    { field: "tags", label: "标签", local: splitTags(local.tags), server: latest?.tags },
    { field: "taskIds", label: "关联任务", local: local.taskIds, server: latest?.taskIds },
    { field: "noteIds", label: "关联卡片", local: local.noteIds, server: latest?.noteIds },
    { field: "mistakeIds", label: "关联错题", local: local.mistakeIds, server: latest?.mistakeIds },
    { field: "syllabusNodeIds", label: "关联考纲", local: local.syllabusNodeIds, server: latest?.syllabusNodeIds },
  ];
}
