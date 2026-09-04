"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import { PinnedActionBar } from "@/components/ui/pinned-action-bar";
import type { TakeoverPreviewDto } from "@/lib/contracts";
import { canUseTakeoverPreview } from "@/lib/workspace/first-use";

export function WorkspaceSetupSection(props: {
  step: "goal" | "takeover";
  setStep: (step: "goal" | "takeover") => void;
  name: string;
  setName: (name: string) => void;
  stableKey: string;
  setStableKey: (key: string) => void;
  targetExamDate: string;
  setTargetExamDate: (date: string) => void;
  subjectName: string;
  setSubjectName: (subject: string) => void;
  subjectKey: string;
  setSubjectKey: (key: string) => void;
  include408: boolean;
  setInclude408: (include: boolean) => void;
  takeover: TakeoverPreviewDto | null;
  canProceed: boolean;
  canCreateWithoutTakeover: boolean;
  pending: boolean;
  onComplete: (takeover: boolean) => void;
}) {
  if (props.step === "goal") {
    return (
      <SectionCard variant="master" className="space-y-5">
        <SectionHeader
          title="考试目标与首批科目"
          description="这些信息决定后续任务、知识和复盘的数据归属。公共课、408 和专业课都在这里管理。"
        />
        <div className="af-content-grid-two grid gap-4">
          <label className="af-content-span-all block text-sm font-medium text-zinc-300">
            <span>工作区名称</span>
            <Input className="mt-1.5" value={props.name} onChange={(e) => props.setName(e.target.value)} />
          </label>
          <label className="block text-sm font-medium text-zinc-300">
            <span>目标考试日</span>
            <Input type="date" className="mt-1.5" value={props.targetExamDate} onChange={(e) => props.setTargetExamDate(e.target.value)} />
          </label>
          <label className="block text-sm font-medium text-zinc-300">
            <span>首个科目</span>
            <Input className="mt-1.5" placeholder="例如：数学分析" value={props.subjectName} onChange={(e) => props.setSubjectName(e.target.value)} />
          </label>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-zinc-300">
          <Checkbox className="mt-0.5" checked={props.include408} onChange={(event) => props.setInclude408(event.target.checked)} />
          <span>
            <strong className="block font-medium text-white">同时创建 408 四科</strong>
            <span className="mt-0.5 block text-xs text-zinc-500">数据结构、计算机组成原理、操作系统和计算机网络会自动归入 408 分组。</span>
          </span>
        </label>

        <details className="text-sm text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300 transition-colors">高级选项</summary>
          <div className="af-content-grid-two mt-3 grid gap-3">
            <label className="text-xs text-zinc-400">工作区内部标识<Input className="mt-1" value={props.stableKey} onChange={(event) => props.setStableKey(event.target.value)} /></label>
            <label className="text-xs text-zinc-400">首个科目内部标识<Input className="mt-1" value={props.subjectKey} onChange={(event) => props.setSubjectKey(event.target.value)} /></label>
          </div>
        </details>

        <PinnedActionBar
          mode="sticky"
          status={
            <span className={props.canProceed ? "text-xs text-zinc-400" : "text-xs text-amber-300"}>
              {props.canProceed ? "首次建立未生效" : "至少添加一个科目或选择 408 四科"}
            </span>
          }
          right={
            <div className="flex gap-2">
              <ButtonLink href="/today" variant="ghost" size="md">取消</ButtonLink>
              <Button type="button" variant="primary" size="md" disabled={!props.canProceed} onClick={() => props.setStep("takeover")}>
                下一步：检查已有数据
              </Button>
            </div>
          }
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard variant="master" className="space-y-5">
      <SectionHeader
        title="确认已有数据处理方式"
        description="沿用只会接管预览中允许的科目；归属冲突项不会移动。"
      />
      {props.takeover ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-300">
          <p>可沿用 <strong className="text-teal-300">{props.takeover.eligibleCount}</strong> 个已有科目：{props.takeover.eligibleSubjects.map((s) => s.name).join("、") || "无"}。</p>
          {props.takeover.unresolvedCount > 0 || props.takeover.crossOwnerBlockedCount > 0 ? (
            <p className="text-amber-300">另有 {props.takeover.unresolvedCount} 个待确认，{props.takeover.crossOwnerBlockedCount} 个因归属冲突被阻止，本次不会移动。</p>
          ) : null}
          <p className="text-xs text-zinc-500">选择沿用时，已有科目会直接归入新工作区；只有你在上一步填写或勾选的科目才会新增。</p>
        </div>
      ) : (
        <Alert tone="warning">旧数据预览暂时不可用。刷新后再沿用，或明确选择新建工作区且不移动旧数据。</Alert>
      )}

      <PinnedActionBar
        mode="sticky"
        status={<span className="text-xs text-zinc-400">确认沿用模式</span>}
        right={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="md" disabled={props.pending} onClick={() => props.setStep("goal")}>返回修改</Button>
            <ButtonLink href="/today" variant="ghost" size="md">取消</ButtonLink>
            <Button type="button" variant="secondary" size="md" disabled={props.pending || !props.canCreateWithoutTakeover} onClick={() => void props.onComplete(false)}>全新建立，不沿用</Button>
            <Button type="button" variant="primary" size="md" loading={props.pending} loadingLabel="创建中..." disabled={!canUseTakeoverPreview(props.takeover) || !props.canProceed} onClick={() => void props.onComplete(true)}>
              沿用已有数据并完成
            </Button>
          </div>
        }
      />
    </SectionCard>
  );
}
