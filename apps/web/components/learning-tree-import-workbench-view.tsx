"use client";

import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, FileText, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { LearningTreeImportSelection } from "@areaforge/core";
import { LearningTreeImportHistory } from "@/components/learning-tree-import-history";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import { sanitizeReturnPath } from "@/lib/navigation/batch7";
import type {
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/study/learning-tree-service";

export type LearningTreeScopeView = "global" | "subject" | "branch";
export type LearningTreeWorkbenchView = "overview" | "import" | "export";
export type LearningTreeExportPreview = {
  scope: LearningTreeScopeView;
  objectCount: number;
  cardBodyCount: number;
  planTitleCount: number;
  externalHosts: string[];
  bytes: number;
  sourceSha256: string;
  exportToken: string;
  exportExpiresAt: string;
};

type Selection = LearningTreeImportSelection;

interface WorkbenchState {
  view: LearningTreeWorkbenchView;
  imports: LearningTreeImportBatchSummaryDto[];
  archivedImports: LearningTreeImportBatchSummaryDto[];
  subjects: LearningTreeExportOptionsDto["subjects"];
  selectedSubject?: LearningTreeExportOptionsDto["subjects"][number];
  aiDraftPanel: ReactNode;
  aiDraftLoaded: boolean;
  draftRestored: boolean;
  pending: boolean;
  scope: LearningTreeScopeView;
  subjectKey: string;
  rootNodeKey: string;
  markdown: string;
  preview: LearningTreePreviewDto | null;
  exportPreview: LearningTreeExportPreview | null;
  selections: Record<string, Selection>;
  visibleDiffItems: LearningTreePreviewDto["items"];
  diffPage: number;
  diffPageCount: number;
  unresolved: boolean;
  hasConflict: boolean;
  conflictOpen: boolean;
  error: string | null;
}

interface WorkbenchActions {
  changeView: (view: LearningTreeWorkbenchView) => void;
  changeScope: (scope: LearningTreeScopeView) => void;
  changeSubject: (subjectKey: string) => void;
  changeRootNode: (rootNodeKey: string) => void;
  loadFile: (file: File | undefined) => void;
  changeMarkdown: (markdown: string) => void;
  previewImport: () => void;
  previewExport: () => void;
  downloadExport: () => void;
  changeDiffPage: (page: number) => void;
  changeSelection: (stableKey: string, selection: Selection) => void;
  confirmImport: () => void;
  openConflict: () => void;
  persistBeforeMilestone: () => void;
}

export function LearningTreeImportWorkbenchView({
  state,
  actions,
}: {
  state: WorkbenchState;
  actions: WorkbenchActions;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnPath(`${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
  return (
    <PageFrame variant="dashboard-wide" className="space-y-5">
      {state.view === "overview" ? <ImportOverview state={state} actions={actions} returnTo={returnTo} /> : null}
      {state.view === "import" ? <ImportWorkspace state={state} actions={actions} /> : null}
      {state.view === "export" ? <ExportWorkspace state={state} actions={actions} /> : null}
    </PageFrame>
  );
}

function ImportOverview({ state, actions, returnTo }: { state: WorkbenchState; actions: WorkbenchActions; returnTo: string }) {
  return (
    <>
      <PageHeader
        eyebrow="知识工作台"
        title="学习树导入"
        description={`${state.imports.length} 个当前批次${state.archivedImports.length ? ` · ${state.archivedImports.length} 个已归档` : ""}`}
        action={<Button type="button" variant="primary" onClick={() => actions.changeView("import")}><Plus size={16} aria-hidden />开始导入</Button>}
      />
      <Toolbar label="学习树工具">
        <Button type="button" variant="secondary" onClick={() => actions.changeView("export")}><Download size={16} aria-hidden />导出当前学习树</Button>
        {state.draftRestored || state.aiDraftLoaded ? <Badge tone="warning">存在可恢复草稿</Badge> : null}
      </Toolbar>
      <LearningTreeImportHistory title="导入历史" imports={state.imports} archived={false} returnTo={returnTo} />
      {state.archivedImports.length ? (
        <details className="border-t border-white/10 pt-5">
          <summary className="cursor-pointer text-sm text-zinc-300">已归档历史（{state.archivedImports.length}）</summary>
          <LearningTreeImportHistory title="已归档批次" imports={state.archivedImports} archived returnTo={returnTo} />
        </details>
      ) : null}
    </>
  );
}

function ImportWorkspace({ state, actions }: { state: WorkbenchState; actions: WorkbenchActions }) {
  return (
    <>
      <PageHeader
        eyebrow="学习树工作台"
        title="导入学习树"
        description={state.preview ? `${state.preview.objectCount} 个对象 · ${state.preview.items.length} 项差异` : "Markdown 草稿会在本设备保留 24 小时"}
        back={<Button type="button" variant="ghost" size="sm" onClick={() => actions.changeView("overview")}><ArrowLeft size={16} aria-hidden />返回导入历史</Button>}
        status={<div className="flex flex-wrap gap-2"><Badge tone={state.preview ? "success" : "info"}>{state.preview ? "差异已生成" : "准备内容"}</Badge>{state.hasConflict ? <Badge tone="warning">需要重新预览</Badge> : null}</div>}
      />
      {state.draftRestored || state.aiDraftLoaded ? (
        <Alert tone="warning" title="已恢复未完成的导入">Markdown 与已有映射仍保留；确认前必须重新预览当前学习树差异。</Alert>
      ) : null}
      <details className="border-y border-white/10 py-3">
        <summary className="cursor-pointer text-sm text-zinc-300">使用 AI 生成学习树草稿</summary>
        <div className="mt-3">{state.aiDraftPanel}</div>
      </details>
      <section className="space-y-3">
        <SectionHeader title="准备导入内容" description="可下载标准模板后编辑，也可直接选择或粘贴 Markdown。" />
        <div className="flex flex-wrap gap-2">
          {(["global", "subject", "branch"] as const).map((value) => (
            <a key={value} href={`/api/learning-tree/templates?scope=${value}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200">
              <FileText size={16} aria-hidden />{scopeLabel(value)}模板
            </a>
          ))}
        </div>
      </section>
      <section className="space-y-4 border-t border-white/10 pt-6">
        <SectionHeader title="导入内容" />
        <ScopeControls scope={state.scope} disabled={state.pending} onChange={actions.changeScope} />
        {state.aiDraftLoaded && state.scope !== "global" ? (
          <LabeledSelect label="AI 草稿所属科目" value={state.subjectKey} disabled={state.pending} onChange={actions.changeSubject}>
            {state.subjects.map((subject) => <option key={subject.id} value={subject.stableKey}>{subject.name}</option>)}
          </LabeledSelect>
        ) : null}
        {state.aiDraftLoaded && state.scope === "branch" ? (
          <LabeledSelect label="AI 草稿所属分支" value={state.rootNodeKey} disabled={state.pending} onChange={actions.changeRootNode}>
            <option value="">选择分支根节点</option>
            {state.selectedSubject?.nodes.map((node) => <option key={node.stableKey} value={node.stableKey}>{node.title}</option>)}
          </LabeledSelect>
        ) : null}
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200">
          <Upload size={16} aria-hidden />选择 Markdown
          <input disabled={state.pending} className="sr-only" type="file" accept=".md,text/markdown,text/plain" onChange={(event) => actions.loadFile(event.target.files?.[0])} />
        </label>
        <textarea disabled={state.pending} aria-label="学习树 Markdown" className="min-h-64 w-full rounded-md border border-white/10 bg-[#101419] p-3 font-mono text-sm text-zinc-200 disabled:opacity-60" value={state.markdown} onChange={(event) => actions.changeMarkdown(event.target.value)} placeholder="粘贴 AREAFORGE_LEARNING_TREE_V1 Markdown" />
        {!state.preview ? <Button type="button" size="lg" variant="primary" disabled={state.pending || !state.markdown.trim() || (state.aiDraftLoaded && state.scope !== "global" && !state.subjectKey) || (state.aiDraftLoaded && state.scope === "branch" && !state.rootNodeKey)} onClick={actions.previewImport}>解析并预览</Button> : null}
        {state.preview ? <ImportDiff state={state} actions={actions} /> : null}
        {state.error ? <p role="alert" className="text-sm text-rose-300">{state.error}</p> : null}
        {state.hasConflict && !state.conflictOpen ? <button type="button" className="text-sm text-amber-200 underline underline-offset-4" onClick={actions.openConflict}>处理导入冲突</button> : null}
      </section>
    </>
  );
}

function ExportWorkspace({ state, actions }: { state: WorkbenchState; actions: WorkbenchActions }) {
  return (
    <>
      <PageHeader
        eyebrow="学习树工作台"
        title="导出当前学习树"
        description="先核对导出范围和敏感内容摘要，再显式确认下载。"
        back={<Button type="button" variant="ghost" size="sm" onClick={() => actions.changeView("overview")}><ArrowLeft size={16} aria-hidden />返回导入历史</Button>}
      />
      <section className="space-y-3 border-t border-white/10 pt-6">
        <SectionHeader title="导出范围" />
        <ScopeControls scope={state.scope} disabled={state.pending} onChange={actions.changeScope} />
        {state.scope !== "global" ? (
          <select aria-label="导出科目" disabled={state.pending} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm disabled:opacity-50 sm:max-w-md" value={state.subjectKey} onChange={(event) => actions.changeSubject(event.target.value)}>
            {state.subjects.map((subject) => <option key={subject.id} value={subject.stableKey}>{subject.name}</option>)}
          </select>
        ) : null}
        {state.scope === "branch" ? (
          <select aria-label="导出分支根节点" disabled={state.pending} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm disabled:opacity-50 sm:max-w-md" value={state.rootNodeKey} onChange={(event) => actions.changeRootNode(event.target.value)}>
            <option value="">选择分支根节点</option>
            {state.selectedSubject?.nodes.map((node) => <option key={node.stableKey} value={node.stableKey}>{node.title}</option>)}
          </select>
        ) : null}
        <Button type="button" disabled={state.pending || (state.scope !== "global" && !state.subjectKey) || (state.scope === "branch" && !state.rootNodeKey)} onClick={actions.previewExport}>预览导出范围</Button>
        {state.exportPreview ? (
          <Alert tone="success" title={`${state.exportPreview.objectCount} 个对象 · ${state.exportPreview.bytes} bytes`} action={<Button type="button" variant="primary" disabled={state.pending} onClick={actions.downloadExport}><Download size={16} aria-hidden />确认并下载</Button>}>
            包含卡片正文 {state.exportPreview.cardBodyCount} 项、计划标题 {state.exportPreview.planTitleCount} 项；外链域名：{state.exportPreview.externalHosts.join("、") || "无"}
          </Alert>
        ) : null}
        {state.error ? <p role="alert" className="text-sm text-rose-300">{state.error}</p> : null}
      </section>
    </>
  );
}

function ImportDiff({ state, actions }: { state: WorkbenchState; actions: WorkbenchActions }) {
  const preview = state.preview;
  if (!preview) return null;
  return (
    <div className="space-y-4">
      <Alert tone={state.unresolved ? "warning" : "success"}>{state.unresolved ? "存在未解决错误或冲突，请修正、映射或跳过。" : `校验通过，共 ${preview.objectCount} 个对象，可原子确认。`}</Alert>
      {[...preview.errors, ...preview.warnings].map((issue, index) => <p key={`${issue.code}-${index}`} className="text-sm text-amber-200">{issue.code}{issue.sourceLine ? `（第 ${issue.sourceLine} 行）` : ""}：{issue.message}</p>)}
      {missingMilestoneKeys(preview).length ? <MissingMilestones preview={preview} onLeave={actions.persistBeforeMilestone} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <span>差异 {preview.items.length} 项 · 第 {state.diffPage + 1}/{state.diffPageCount} 页</span>
        <div className="flex gap-1">
          <button type="button" aria-label="上一页差异" title="上一页" disabled={state.diffPage === 0} onClick={() => actions.changeDiffPage(Math.max(0, state.diffPage - 1))} className="grid size-9 place-items-center rounded-md border border-white/10 disabled:opacity-40"><ChevronLeft size={16} aria-hidden /></button>
          <button type="button" aria-label="下一页差异" title="下一页" disabled={state.diffPage + 1 >= state.diffPageCount} onClick={() => actions.changeDiffPage(Math.min(state.diffPageCount - 1, state.diffPage + 1))} className="grid size-9 place-items-center rounded-md border border-white/10 disabled:opacity-40"><ChevronRight size={16} aria-hidden /></button>
        </div>
      </div>
      <ul className="space-y-2">
        {state.visibleDiffItems.map((item) => {
          const selection = state.selections[item.stableKey] ?? { choice: "apply" as const };
          const fixedSkip = item.diffType === "UNCHANGED" || item.diffType === "SKIP";
          return (
            <li key={`${item.objectType}:${item.stableKey}`} className="grid gap-2 rounded-md border border-white/10 p-3 text-sm md:grid-cols-[8rem_1fr_9rem]">
              <div><span className="font-medium text-teal-300">{diffTypeLabel(item.diffType)}</span><p className="text-xs text-zinc-500">{objectTypeLabel(item.objectType)} · 第 {item.sourceLine ?? "?"} 行</p></div>
              <div><p className="text-zinc-100">{item.title}</p><p className="break-all text-xs text-zinc-500">{item.stableKey}{item.reason ? ` · ${item.reason}` : ""}</p></div>
              <div className="space-y-2">
                <select aria-label={`${item.title}处理方式`} disabled={fixedSkip || state.pending || state.hasConflict} className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={fixedSkip ? "skip" : selection.choice} onChange={(event) => actions.changeSelection(item.stableKey, { ...selection, choice: event.target.value as Selection["choice"] })}>{fixedSkip ? null : <option value="apply">应用</option>}<option value="skip">跳过</option></select>
                {item.diffType === "CONFLICT" && selection.choice === "apply" ? <select disabled={state.pending || state.hasConflict} aria-label={`${item.title}映射目标`} className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={selection.mappedTargetId ?? ""} onChange={(event) => actions.changeSelection(item.stableKey, { ...selection, mappedTargetId: event.target.value || undefined })}><option value="">选择目标</option>{item.candidateMatches.map((candidate) => <option key={candidate.entityId ?? candidate.title} value={candidate.entityId}>{candidate.title}</option>)}</select> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" variant="primary" disabled={state.pending || state.unresolved || state.hasConflict} onClick={actions.confirmImport}><Check size={16} aria-hidden />确认原子导入</Button>
        <Button type="button" size="lg" disabled={state.pending} onClick={actions.previewImport}>重新预览</Button>
      </div>
    </div>
  );
}

function MissingMilestones({ preview, onLeave }: { preview: LearningTreePreviewDto; onLeave: () => void }) {
  return (
    <Alert tone="warning" title="存在未创建的阶段里程碑">
      <div className="flex flex-wrap gap-2">
        {missingMilestoneKeys(preview).map((key) => <Link key={key} href={`/plan/stages?createMilestone=${encodeURIComponent(key)}&returnTo=${encodeURIComponent("/knowledge/imports?mode=import")}`} className="inline-flex h-9 items-center rounded-md border border-amber-200/30 px-3 text-amber-100 hover:bg-amber-300/10" onClick={onLeave}>创建“{key}”并返回</Link>)}
      </div>
    </Alert>
  );
}

function LabeledSelect(props: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="block space-y-1 text-sm text-zinc-400"><span>{props.label}</span><select disabled={props.disabled} aria-label={props.label} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm disabled:opacity-50 sm:max-w-md" value={props.value} onChange={(event) => props.onChange(event.target.value)}>{props.children}</select></label>;
}

function ScopeControls({ scope, disabled, onChange }: { scope: LearningTreeScopeView; disabled: boolean; onChange: (scope: LearningTreeScopeView) => void }) {
  return <div className="inline-flex rounded-md border border-white/10 p-1" role="group" aria-label="学习树作用域">{(["global", "subject", "branch"] as const).map((value) => <button type="button" key={value} disabled={disabled} aria-pressed={scope === value} onClick={() => onChange(value)} className={`h-8 rounded px-3 text-sm disabled:opacity-50 ${scope === value ? "bg-white/10 text-white" : "text-zinc-400"}`}>{scopeLabel(value)}</button>)}</div>;
}

function missingMilestoneKeys(preview: LearningTreePreviewDto): string[] {
  return [...new Set(preview.items.flatMap((item) => item.blocking && item.reason?.startsWith("milestone_missing:") ? [item.reason.slice("milestone_missing:".length)] : []))];
}

function scopeLabel(scope: LearningTreeScopeView) { return scope === "global" ? "全局" : scope === "subject" ? "单科" : "分支"; }
function objectTypeLabel(value: string) { return ({ group: "科目组", subject: "科目", node: "考纲节点", card: "知识卡片", resource: "资料", plan: "计划" } as Record<string, string>)[value] ?? "对象"; }
function diffTypeLabel(value: string) { return ({ ADD: "新增", UPDATE: "更新", MOVE: "移动", ARCHIVE: "归档", UNCHANGED: "未变化", CONFLICT: "冲突", SKIP: "跳过" } as Record<string, string>)[value] ?? "变更"; }
