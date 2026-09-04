"use client";

import { BookOpen, Layers3, Plus, Trash2 } from "lucide-react";
import { listExamTemplates } from "@areaforge/core";
import { Button, ButtonLink } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import { PinnedActionBar } from "@/components/ui/pinned-action-bar";
import type { TakeoverPreviewDto } from "@/lib/contracts";
import {
  canUseTakeoverPreview,
  materializeFirstUseTemplateSelection,
  nextAvailableGeneratedKey,
  validateFirstUseRows,
  type FirstUseGroupDraft,
  type FirstUseSubjectDraft,
} from "@/lib/workspace/first-use";

const subjectColors = ["#35d7c5", "#3b82f6", "#a78bfa", "#f59e0b", "#ef4444", "#22c55e"];

interface WorkspaceSetupSectionProps {
  step: "goal" | "takeover";
  setStep: (step: "goal" | "takeover") => void;
  name: string;
  setName: (name: string) => void;
  stableKey: string;
  setStableKey: (key: string) => void;
  targetExamDate: string;
  setTargetExamDate: (date: string) => void;
  subjects: FirstUseSubjectDraft[];
  setSubjects: (subjects: FirstUseSubjectDraft[]) => void;
  groups: FirstUseGroupDraft[];
  setGroups: (groups: FirstUseGroupDraft[]) => void;
  templateIds: string[];
  setTemplateIds: (templateIds: string[]) => void;
  takeover: TakeoverPreviewDto | null;
  canProceed: boolean;
  canCreateWithoutTakeover: boolean;
  pending: boolean;
  onComplete: (takeover: boolean) => void;
}

function TemplateLibrary(props: {
  selectedIds: string[];
  onToggle: (templateId: string, selected: boolean) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="workspace-template-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="workspace-template-title" className="text-sm font-semibold text-white">从模板起步</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">可跳过。选中后会复制为普通科目和分组，随后可以任意修改。</p>
        </div>
        <Badge>{listExamTemplates().length} 套模板</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {listExamTemplates().map((template) => {
          const selected = props.selectedIds.includes(template.id);
          const subjectCount = template.groups.reduce((count, group) => count + group.subjects.length, 0);
          return (
            <label
              key={template.id}
              className={`group flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${selected ? "border-teal-400/40 bg-teal-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"}`}
            >
              <Checkbox
                className="mt-0.5"
                checked={selected}
                onChange={(event) => props.onToggle(template.id, event.target.checked)}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="font-medium text-white">{template.name}</strong>
                  <span className="text-[11px] text-zinc-500">v{template.version}</span>
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-400">{template.description}</span>
                <span className="mt-2 block text-[11px] text-zinc-500">{template.groups.length} 个分组 · {subjectCount} 个科目</span>
              </span>
            </label>
          );
        })}
      </div>
      {props.selectedIds.length > 0 ? (
        <p className="text-xs text-teal-200">模板内容已复制到下方。取消选择只取消模板标记，不会删除或覆盖已经编辑的行。</p>
      ) : null}
    </section>
  );
}

function GroupEditor(props: {
  groups: FirstUseGroupDraft[];
  onAdd: () => void;
  onChange: (id: string, field: "name" | "stableKey", value: string) => void;
  onRemove: (group: FirstUseGroupDraft) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="workspace-group-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="workspace-group-title" className="flex items-center gap-2 text-sm font-semibold text-white"><Layers3 className="size-4 text-teal-300" />科目分组</h3>
          <p className="mt-1 text-xs text-zinc-500">分组用于整理科目，不会改变学习记录。</p>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={props.groups.length >= 20} onClick={props.onAdd}>
          <Plus className="size-4" />添加分组
        </Button>
      </div>
      {props.groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">暂不分组也可以，科目仍可独立使用。</div>
      ) : (
        <div className="space-y-2">
          {props.groups.map((group, index) => (
            <div key={group.id} className="grid gap-3 rounded-xl border border-white/10 bg-black/10 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-xs font-medium text-zinc-400">
                分组名称
                <Input className="mt-1" placeholder={`分组 ${index + 1}`} value={group.name} onChange={(event) => props.onChange(group.id, "name", event.target.value)} />
              </label>
              <label className="text-xs font-medium text-zinc-400">
                内部标识
                <Input className="mt-1" value={group.stableKey} onChange={(event) => props.onChange(group.id, "stableKey", event.target.value)} />
              </label>
              <Button type="button" variant="ghost" size="sm" aria-label={`删除分组 ${group.name || index + 1}`} onClick={() => props.onRemove(group)}>
                <Trash2 className="size-4" />删除
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SubjectEditor(props: {
  subjects: FirstUseSubjectDraft[];
  groups: FirstUseGroupDraft[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<FirstUseSubjectDraft>) => void;
  onRemove: (subject: FirstUseSubjectDraft) => void;
}) {
  const availableGroups = props.groups.filter((group) => group.name.trim() && group.stableKey.trim());
  return (
    <section className="space-y-3" aria-labelledby="workspace-subject-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="workspace-subject-title" className="flex items-center gap-2 text-sm font-semibold text-white"><BookOpen className="size-4 text-teal-300" />首批科目</h3>
          <p className="mt-1 text-xs text-zinc-500">这些科目会进入计时、任务、知识和复盘。</p>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={props.subjects.length >= 12} onClick={props.onAdd}>
          <Plus className="size-4" />添加科目
        </Button>
      </div>
      {props.subjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">还没有科目。添加自定义科目，或从上方选择模板。</div>
      ) : (
        <div className="space-y-3">
          {props.subjects.map((subject, index) => (
            <article key={subject.id} className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-r from-white/[0.035] to-transparent p-4">
              <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: subject.color }} aria-hidden="true" />
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-end">
                <label className="text-xs font-medium text-zinc-400">
                  科目名称
                  <Input className="mt-1" placeholder={`科目 ${index + 1}`} value={subject.name} onChange={(event) => props.onChange(subject.id, { name: event.target.value })} />
                </label>
                <label className="text-xs font-medium text-zinc-400">
                  所属分组
                  <Select className="mt-1" value={subject.groupStableKey ?? ""} onChange={(event) => props.onChange(subject.id, { groupStableKey: event.target.value || null })}>
                    <option value="">不分组</option>
                    {availableGroups.map((group) => <option key={group.id} value={group.stableKey}>{group.name}</option>)}
                  </Select>
                </label>
                <Button type="button" variant="ghost" size="sm" aria-label={`删除科目 ${subject.name || index + 1}`} onClick={() => props.onRemove(subject)}>
                  <Trash2 className="size-4" />删除
                </Button>
              </div>
              <details className="mt-3 border-t border-white/5 pt-3 text-xs text-zinc-500">
                <summary className="cursor-pointer transition-colors hover:text-zinc-300">科目标识与颜色</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_112px]">
                  <label className="font-medium text-zinc-400">
                    内部标识
                    <Input className="mt-1" value={subject.stableKey} onChange={(event) => props.onChange(subject.id, { stableKey: event.target.value })} />
                  </label>
                  <label className="font-medium text-zinc-400">
                    识别颜色
                    <Input type="color" className="mt-1 px-2" value={subject.color} onChange={(event) => props.onChange(subject.id, { color: event.target.value })} />
                  </label>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TakeoverStep(props: WorkspaceSetupSectionProps) {
  return (
    <SectionCard variant="master" className="space-y-5">
      <SectionHeader title="确认已有数据处理方式" description="沿用只会接管预览中允许的科目；归属冲突项不会移动。" />
      {props.takeover ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-300">
          <p>可沿用 <strong className="text-teal-300">{props.takeover.eligibleCount}</strong> 个已有科目：{props.takeover.eligibleSubjects.map((subject) => subject.name).join("、") || "无"}。</p>
          {props.takeover.unresolvedCount > 0 || props.takeover.crossOwnerBlockedCount > 0 ? (
            <p className="text-amber-300">另有 {props.takeover.unresolvedCount} 个待确认，{props.takeover.crossOwnerBlockedCount} 个因归属冲突被阻止，本次不会移动。</p>
          ) : null}
          <p className="text-xs text-zinc-500">选择沿用时，已有科目会直接归入新工作区；只有上一步填写或从模板复制的科目才会新增。</p>
        </div>
      ) : (
        <Alert tone="warning">旧数据预览暂时不可用。刷新后再沿用，或明确选择新建工作区且不移动旧数据。</Alert>
      )}
      <PinnedActionBar
        mode="sticky"
        status={<span className="text-xs text-zinc-400">确认沿用模式</span>}
        right={(
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="md" disabled={props.pending} onClick={() => props.setStep("goal")}>返回修改</Button>
            <ButtonLink href="/today" variant="ghost" size="md">取消</ButtonLink>
            <Button type="button" variant="secondary" size="md" disabled={props.pending || !props.canCreateWithoutTakeover || !props.canProceed} onClick={() => void props.onComplete(false)}>全新建立，不沿用</Button>
            <Button type="button" variant="primary" size="md" loading={props.pending} loadingLabel="创建中..." disabled={!canUseTakeoverPreview(props.takeover) || !props.canProceed} onClick={() => void props.onComplete(true)}>
              沿用已有数据并完成
            </Button>
          </div>
        )}
      />
    </SectionCard>
  );
}

export function WorkspaceSetupSection(props: WorkspaceSetupSectionProps) {
  const validation = validateFirstUseRows({ subjects: props.subjects, groups: props.groups, templateIds: props.templateIds });
  const workspaceIssue = !props.name.trim()
    ? "请填写工作区名称。"
    : !props.stableKey.trim()
      ? "请填写工作区内部标识。"
      : null;

  function toggleTemplate(templateId: string, selected: boolean) {
    if (!selected) {
      props.setTemplateIds(props.templateIds.filter((id) => id !== templateId));
      return;
    }
    const sourceSubjects = props.subjects.length === 1 && !props.subjects[0]?.name.trim()
      ? []
      : props.subjects;
    const materialized = materializeFirstUseTemplateSelection({ subjects: sourceSubjects, groups: props.groups, templateId });
    props.setSubjects(materialized.subjects);
    props.setGroups(materialized.groups);
    props.setTemplateIds([...new Set([...props.templateIds, templateId])]);
  }

  function addSubject() {
    const stableKey = nextAvailableGeneratedKey("subject", props.subjects.map((subject) => subject.stableKey));
    props.setSubjects([...props.subjects, {
      id: `draft:${stableKey}`,
      stableKey,
      name: "",
      color: subjectColors[props.subjects.length % subjectColors.length] ?? subjectColors[0],
      groupStableKey: null,
    }]);
  }

  function addGroup() {
    const stableKey = nextAvailableGeneratedKey("group", props.groups.map((group) => group.stableKey));
    props.setGroups([...props.groups, { id: `draft:${stableKey}`, stableKey, name: "" }]);
  }

  function changeGroup(id: string, field: "name" | "stableKey", value: string) {
    const current = props.groups.find((group) => group.id === id);
    props.setGroups(props.groups.map((group) => group.id === id ? { ...group, [field]: value } : group));
    if (field === "stableKey" && current) {
      props.setSubjects(props.subjects.map((subject) => subject.groupStableKey === current.stableKey ? { ...subject, groupStableKey: value || null } : subject));
    }
  }

  function removeGroup(group: FirstUseGroupDraft) {
    props.setGroups(props.groups.filter((item) => item.id !== group.id));
    props.setSubjects(props.subjects.map((subject) => subject.groupStableKey === group.stableKey ? { ...subject, groupStableKey: null } : subject));
  }

  if (props.step === "takeover") {
    return (
      <TakeoverStep
        {...props}
        canProceed={props.canProceed && validation.valid && workspaceIssue === null}
        canCreateWithoutTakeover={props.canCreateWithoutTakeover && validation.valid && workspaceIssue === null}
      />
    );
  }

  const ready = props.canProceed && validation.valid && workspaceIssue === null;
  return (
    <SectionCard variant="master" className="space-y-6">
      <SectionHeader title="考试目标与首批科目" description="先搭好考试目标和科目骨架；确认前不会创建工作区或移动历史数据。" />
      <div className="af-content-grid-two grid gap-4">
        <label className="af-content-span-all block text-sm font-medium text-zinc-300">
          工作区名称
          <Input maxLength={120} className="mt-1.5" value={props.name} onChange={(event) => props.setName(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-zinc-300">
          目标考试日
          <Input type="date" className="mt-1.5" value={props.targetExamDate} onChange={(event) => props.setTargetExamDate(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-zinc-300">
          工作区内部标识
          <Input maxLength={80} className="mt-1.5" value={props.stableKey} onChange={(event) => props.setStableKey(event.target.value)} />
        </label>
      </div>
      <TemplateLibrary selectedIds={props.templateIds} onToggle={toggleTemplate} />
      <div className="h-px bg-white/5" />
      <GroupEditor groups={props.groups} onAdd={addGroup} onChange={changeGroup} onRemove={removeGroup} />
      <div className="h-px bg-white/5" />
      <SubjectEditor
        subjects={props.subjects}
        groups={props.groups}
        onAdd={addSubject}
        onChange={(id, patch) => props.setSubjects(props.subjects.map((subject) => subject.id === id ? { ...subject, ...patch } : subject))}
        onRemove={(subject) => props.setSubjects(props.subjects.filter((item) => item.id !== subject.id))}
      />
      {workspaceIssue || !validation.valid ? <Alert tone="warning">{workspaceIssue ?? validation.issue}</Alert> : null}
      <PinnedActionBar
        mode="sticky"
        status={(
          <span className={ready ? "text-xs text-zinc-400" : "text-xs text-amber-300"}>
            {ready
              ? `${validation.configuredSubjectCount} 个科目 · ${validation.configuredGroupCount} 个分组 · 尚未生效`
              : workspaceIssue ?? validation.issue ?? "至少添加一个科目、选择模板或沿用已有科目"}
          </span>
        )}
        right={(
          <div className="flex gap-2">
            <ButtonLink href="/today" variant="ghost" size="md">取消</ButtonLink>
            <Button type="button" variant="primary" size="md" disabled={!ready} onClick={() => props.setStep("takeover")}>
              下一步：检查已有数据
            </Button>
          </div>
        )}
      />
    </SectionCard>
  );
}
