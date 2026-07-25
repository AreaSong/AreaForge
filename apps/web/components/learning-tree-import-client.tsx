"use client";

import { Archive, Check, Download, FileText, RotateCcw, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { bindAiLearningTreeDraftMarkdown } from "@/lib/client/ai-learning-tree-draft";
import type {
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/study/learning-tree-service";

type Scope = "global" | "subject" | "branch";
type Selection = { choice: "apply" | "skip"; mappedTargetId?: string };

export function LearningTreeImportClient(props: {
  userId: string;
  imports: LearningTreeImportBatchSummaryDto[];
  archivedImports: LearningTreeImportBatchSummaryDto[];
  exportOptions: LearningTreeExportOptionsDto;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("subject");
  const [markdown, setMarkdown] = useState("");
  const [preview, setPreview] = useState<LearningTreePreviewDto | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subjectKey, setSubjectKey] = useState(props.exportOptions.subjects[0]?.stableKey ?? "");
  const [rootNodeKey, setRootNodeKey] = useState("");
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [aiDraftLoaded, setAiDraftLoaded] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = aiLearningTreeDraftKey(props.userId);
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      try {
        const envelope = JSON.parse(raw) as { version?: number; userId?: string; updatedAt?: number; value?: { markdownDraft?: string; scope?: Scope } };
        if (envelope.version !== 1 || envelope.userId !== props.userId || typeof envelope.updatedAt !== "number" || Date.now() - envelope.updatedAt > 7 * 24 * 60 * 60 * 1000) {
          window.localStorage.removeItem(key);
          return;
        }
        if (typeof envelope.value?.markdownDraft === "string") {
          setMarkdown(envelope.value.markdownDraft);
          setAiDraftLoaded(true);
        }
        if (["global", "subject", "branch"].includes(envelope.value?.scope ?? "")) setScope(envelope.value?.scope as Scope);
      } catch {
        window.localStorage.removeItem(key);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.userId]);

  useEffect(() => {
    const key = learningTreeImportDraftKey(props.userId);
    const timer = window.setTimeout(() => {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setDraftLoaded(true);
        return;
      }
      try {
        const envelope = JSON.parse(raw) as {
          version?: number;
          userId?: string;
          updatedAt?: number;
          value?: { markdown?: string; scope?: Scope; subjectKey?: string; rootNodeKey?: string };
        };
        if (envelope.version !== 1 || envelope.userId !== props.userId || typeof envelope.updatedAt !== "number" || Date.now() - envelope.updatedAt > 24 * 60 * 60 * 1000) {
          window.localStorage.removeItem(key);
          setDraftLoaded(true);
          return;
        }
        if (typeof envelope.value?.markdown === "string" && envelope.value.markdown.trim()) setMarkdown(envelope.value.markdown);
        if (["global", "subject", "branch"].includes(envelope.value?.scope ?? "")) setScope(envelope.value?.scope as Scope);
        if (typeof envelope.value?.subjectKey === "string") setSubjectKey(envelope.value.subjectKey);
        if (typeof envelope.value?.rootNodeKey === "string") setRootNodeKey(envelope.value.rootNodeKey);
      } catch {
        window.localStorage.removeItem(key);
      } finally {
        setDraftLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.userId]);

  useEffect(() => {
    if (!draftLoaded || !markdown.trim()) return;
    const timer = window.setTimeout(() => {
      persistImportDraft(props.userId, { markdown, scope, subjectKey, rootNodeKey });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftLoaded, markdown, props.userId, rootNodeKey, scope, subjectKey]);

  const selectedSubject = props.exportOptions.subjects.find((subject) => subject.stableKey === subjectKey);
  const unresolved = useMemo(() => {
    if (!preview) return true;
    if (preview.errors.length > 0 || !preview.canonicalMarkdown) return true;
    return preview.items.some((item) => {
      if (!item.blocking) return false;
      const selection = selections[item.stableKey];
      if (selection?.choice === "skip") return false;
      return !(item.diffType === "CONFLICT" && selection?.choice === "apply" && selection.mappedTargetId);
    });
  }, [preview, selections]);

  function updateScope(next: Scope) {
    setScope(next);
    setPreview(null);
    setExportPreview(null);
    if (next === "global") setRootNodeKey("");
  }

  async function loadFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) return setError("请选择 .md 文件");
    if (file.size > 2 * 1024 * 1024) return setError("Markdown 文件不能超过 2 MiB");
    setMarkdown(await file.text());
    setAiDraftLoaded(false);
    setPreview(null);
  }

  async function runPreview() {
    if (!markdown.trim() || pending) return;
    let importMarkdown = markdown;
    if (aiDraftLoaded) {
      const bound = bindAiLearningTreeDraftMarkdown({
        markdown,
        scope,
        workspaceKey: props.exportOptions.workspaceKey,
        subjectKey,
        rootNodeKey,
      });
      if (!bound.ok) {
        setError(bound.reason);
        return;
      }
      importMarkdown = bound.markdown;
      setMarkdown(importMarkdown);
    }
    setPending(true);
    setError(null);
    const response = await fetch("/api/learning-tree/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: importMarkdown, scope }),
    });
    const body = (await response.json().catch(() => null)) as { preview?: LearningTreePreviewDto; error?: string } | null;
    setPending(false);
    if (!response.ok || !body?.preview) return setError(body?.error ?? "学习树预览失败");
    const nextSelections: Record<string, Selection> = {};
    for (const item of body.preview.items) {
      nextSelections[item.stableKey] = {
        choice: item.diffType === "UNCHANGED" || item.diffType === "SKIP" ? "skip" : "apply",
      };
    }
    setSelections(nextSelections);
    setIdempotencyKey(crypto.randomUUID());
    setPreview(body.preview);
  }

  async function confirmImport() {
    if (!preview || unresolved || pending) return;
    setPending(true);
    setError(null);
    const response = await fetch("/api/learning-tree/imports/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: preview.canonicalMarkdown,
        previewToken: preview.previewToken,
        previewOperationId: preview.operationId,
        idempotencyKey,
        selections: preview.items.map((item) => ({ stableKey: item.stableKey, ...selections[item.stableKey] })),
      }),
    });
    const body = (await response.json().catch(() => null)) as { result?: { batchId: string }; error?: string } | null;
    setPending(false);
    if (!response.ok || !body?.result) return setError(body?.error ?? "确认导入失败，请重新预览");
    window.localStorage.removeItem(aiLearningTreeDraftKey(props.userId));
    window.localStorage.removeItem(learningTreeImportDraftKey(props.userId));
    router.push(`/knowledge/imports/${body.result.batchId}`);
    router.refresh();
  }

  function exportUrl() {
    const params = new URLSearchParams({ scope });
    if (scope !== "global") params.set("subjectKey", subjectKey);
    if (scope === "branch") params.set("rootNodeKey", rootNodeKey);
    params.set("preview", "1");
    return `/api/learning-tree/export?${params.toString()}`;
  }

  async function previewExport() {
    setPending(true);
    setError(null);
    const response = await fetch(exportUrl());
    const body = (await response.json().catch(() => null)) as { preview?: ExportPreview; error?: string } | null;
    setPending(false);
    if (!response.ok || !body?.preview) return setError(body?.error ?? "导出预览失败");
    setExportPreview(body.preview);
  }

  async function downloadExport() {
    if (!exportPreview || pending) return;
    setPending(true);
    setError(null);
    const response = await fetch("/api/learning-tree/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        subjectKey: scope === "global" ? undefined : subjectKey,
        rootNodeKey: scope === "branch" ? rootNodeKey : undefined,
        exportToken: exportPreview.exportToken,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setPending(false);
      setExportPreview(null);
      setError(body?.error ?? "导出授权已失效，请重新预览");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `areaforge-learning-tree-export-${scope}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setPending(false);
    setExportPreview(null);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="tree-template-heading">
        <h1 id="tree-template-heading" className="text-2xl font-semibold text-white">学习树导入</h1>
        <div className="flex flex-wrap gap-2">
          {(["global", "subject", "branch"] as const).map((value) => (
            <a key={value} href={`/api/learning-tree/templates?scope=${value}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200">
              <FileText size={16} aria-hidden />{scopeLabel(value)}模板
            </a>
          ))}
        </div>
      </section>

      <section className="space-y-3 border-t border-white/10 pt-6" aria-labelledby="tree-export-heading">
        <h2 id="tree-export-heading" className="text-lg font-medium text-white">导出当前学习树</h2>
        <ScopeControls scope={scope} onChange={updateScope} />
        {scope !== "global" ? (
          <select className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm sm:max-w-md" value={subjectKey} onChange={(event) => { setSubjectKey(event.target.value); setRootNodeKey(""); setExportPreview(null); }}>
            {props.exportOptions.subjects.map((subject) => <option key={subject.id} value={subject.stableKey}>{subject.name}</option>)}
          </select>
        ) : null}
        {scope === "branch" ? (
          <select className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm sm:max-w-md" value={rootNodeKey} onChange={(event) => { setRootNodeKey(event.target.value); setExportPreview(null); }}>
            <option value="">选择分支根节点</option>
            {selectedSubject?.nodes.map((node) => <option key={node.stableKey} value={node.stableKey}>{node.title}</option>)}
          </select>
        ) : null}
        <button type="button" disabled={pending || (scope !== "global" && !subjectKey) || (scope === "branch" && !rootNodeKey)} onClick={() => void previewExport()} className="h-10 rounded-md border border-white/10 px-4 text-sm text-zinc-100 disabled:opacity-50">预览导出范围</button>
        {exportPreview ? (
          <div className="space-y-2 rounded-md border border-emerald-400/25 bg-emerald-500/5 p-3 text-sm text-zinc-300">
            <p>{exportPreview.objectCount} 个对象 · {exportPreview.bytes} bytes · SHA-256 {exportPreview.sourceSha256.slice(0, 12)}…</p>
            <p>包含卡片正文 {exportPreview.cardBodyCount} 项、计划标题 {exportPreview.planTitleCount} 项；外链域名：{exportPreview.externalHosts.join("、") || "无"}</p>
            <button type="button" disabled={pending} onClick={() => void downloadExport()} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-4 font-medium text-black disabled:opacity-50"><Download size={16} aria-hidden />确认并下载</button>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 border-t border-white/10 pt-6" aria-labelledby="tree-import-heading">
        <h2 id="tree-import-heading" className="text-lg font-medium text-white">上传或粘贴</h2>
        <ScopeControls scope={scope} onChange={updateScope} />
        {aiDraftLoaded && scope !== "global" ? (
          <label className="block space-y-1 text-sm text-zinc-400">
            <span>AI 草稿所属科目</span>
            <select aria-label="AI 草稿所属科目" className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm sm:max-w-md" value={subjectKey} onChange={(event) => { setSubjectKey(event.target.value); setRootNodeKey(""); setPreview(null); }}>
              {props.exportOptions.subjects.map((subject) => <option key={subject.id} value={subject.stableKey}>{subject.name}</option>)}
            </select>
          </label>
        ) : null}
        {aiDraftLoaded && scope === "branch" ? (
          <label className="block space-y-1 text-sm text-zinc-400">
            <span>AI 草稿所属分支</span>
            <select aria-label="AI 草稿所属分支" className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm sm:max-w-md" value={rootNodeKey} onChange={(event) => { setRootNodeKey(event.target.value); setPreview(null); }}>
              <option value="">选择分支根节点</option>
              {selectedSubject?.nodes.map((node) => <option key={node.stableKey} value={node.stableKey}>{node.title}</option>)}
            </select>
          </label>
        ) : null}
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200">
          <Upload size={16} aria-hidden />选择 Markdown
          <input className="sr-only" type="file" accept=".md,text/markdown,text/plain" onChange={(event) => void loadFile(event.target.files?.[0])} />
        </label>
        <textarea aria-label="学习树 Markdown" className="min-h-64 w-full rounded-md border border-white/10 bg-[#101419] p-3 font-mono text-sm text-zinc-200" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setPreview(null); }} placeholder="粘贴 AREAFORGE_LEARNING_TREE_V1 Markdown" />
        {!preview ? <button type="button" disabled={pending || !markdown.trim() || (aiDraftLoaded && scope !== "global" && !subjectKey) || (aiDraftLoaded && scope === "branch" && !rootNodeKey)} onClick={() => void runPreview()} className="h-11 rounded-md bg-teal-500 px-5 text-sm font-medium text-black disabled:opacity-50">解析并预览</button> : null}

        {preview ? (
          <div className="space-y-4">
            <div role="status" className={`rounded-md border px-3 py-2 text-sm ${unresolved ? "border-amber-400/30 bg-amber-500/10 text-amber-100" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"}`}>
              {unresolved ? "存在未解决错误或冲突，请修正、映射或跳过。" : `校验通过，共 ${preview.objectCount} 个对象，可原子确认。`}
            </div>
            {[...preview.errors, ...preview.warnings].map((issue, index) => <p key={`${issue.code}-${index}`} className="text-sm text-amber-200">{issue.code}{issue.sourceLine ? `（第 ${issue.sourceLine} 行）` : ""}：{issue.message}</p>)}
            {missingMilestoneKeys(preview).length > 0 ? (
              <div className="rounded-md border border-amber-300/25 bg-amber-500/5 p-3 text-sm text-amber-100">
                <p>导入计划引用了当前阶段不存在的里程碑。先创建里程碑，再返回本页重新预览；当前 Markdown 会保留在本设备 24 小时。</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {missingMilestoneKeys(preview).map((milestoneKey) => (
                    <Link
                      key={milestoneKey}
                      href={`/stage/overview?createMilestone=${encodeURIComponent(milestoneKey)}&returnTo=${encodeURIComponent("/knowledge/imports")}`}
                      className="inline-flex h-9 items-center rounded-md border border-amber-200/30 px-3 text-amber-100 hover:bg-amber-300/10"
                      onClick={() => persistImportDraft(props.userId, { markdown, scope, subjectKey, rootNodeKey })}
                    >
                      创建“{milestoneKey}”并返回
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            <ul className="space-y-2">
              {preview.items.map((item) => {
                const selection = selections[item.stableKey] ?? { choice: "apply" as const };
                return (
                  <li key={`${item.objectType}:${item.stableKey}`} className="grid gap-2 rounded-md border border-white/10 p-3 text-sm md:grid-cols-[8rem_1fr_9rem]">
                    <div><span className="font-medium text-teal-300">{item.diffType}</span><p className="text-xs text-zinc-500">{item.objectType} · L{item.sourceLine ?? "?"}</p></div>
                    <div><p className="text-zinc-100">{item.title}</p><p className="break-all text-xs text-zinc-500">{item.stableKey}{item.reason ? ` · ${item.reason}` : ""}</p></div>
                    <div className="space-y-2">
                      <select aria-label={`${item.title}处理方式`} className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={selection.choice} onChange={(event) => setSelections((current) => ({ ...current, [item.stableKey]: { ...selection, choice: event.target.value as Selection["choice"] } }))}><option value="apply">应用</option><option value="skip">跳过</option></select>
                      {item.diffType === "CONFLICT" && selection.choice === "apply" ? <select aria-label={`${item.title}映射目标`} className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={selection.mappedTargetId ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [item.stableKey]: { ...selection, mappedTargetId: event.target.value || undefined } }))}><option value="">选择目标</option>{item.candidateMatches.map((candidate) => <option key={candidate.entityId ?? candidate.title} value={candidate.entityId}>{candidate.title}</option>)}</select> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending || unresolved} onClick={() => void confirmImport()} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-500 px-5 text-sm font-medium text-black disabled:opacity-50"><Check size={16} aria-hidden />确认原子导入</button>
              <button type="button" disabled={pending} onClick={() => void runPreview()} className="h-11 rounded-md border border-white/10 px-4 text-sm">重新预览</button>
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      </section>

      <ImportHistory title="导入历史" imports={props.imports} archived={false} />
      {props.archivedImports.length ? (
        <details className="border-t border-white/10 pt-6">
          <summary className="cursor-pointer text-sm text-zinc-300">已归档历史（{props.archivedImports.length}）</summary>
          <ImportHistory title="已归档批次" imports={props.archivedImports} archived />
        </details>
      ) : null}
    </div>
  );
}

function aiLearningTreeDraftKey(userId: string): string {
  return `areaforge.ai-draft.learning-tree.${userId}`;
}

function learningTreeImportDraftKey(userId: string): string {
  return `areaforge.learning-tree-import.${userId}`;
}

function persistImportDraft(userId: string, value: { markdown: string; scope: Scope; subjectKey: string; rootNodeKey: string }): void {
  window.localStorage.setItem(learningTreeImportDraftKey(userId), JSON.stringify({
    version: 1,
    userId,
    updatedAt: Date.now(),
    value,
  }));
}

function missingMilestoneKeys(preview: LearningTreePreviewDto): string[] {
  return [...new Set(preview.items.flatMap((item) => {
    if (!item.blocking || !item.reason?.startsWith("milestone_missing:")) return [];
    return [item.reason.slice("milestone_missing:".length)];
  }))];
}

export function LearningTreeBatchArchiveButton({ batchId, archived }: { batchId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function update() {
    setPending(true);
    const response = await fetch(`/api/learning-tree/imports/${batchId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: !archived }) });
    setPending(false);
    if (response.ok) router.refresh();
  }
  const Icon = archived ? RotateCcw : Archive;
  return <button type="button" disabled={pending} onClick={() => void update()} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-xs text-zinc-200 disabled:opacity-50"><Icon size={14} aria-hidden />{archived ? "恢复" : "归档"}</button>;
}

function ImportHistory({ title, imports, archived }: { title: string; imports: LearningTreeImportBatchSummaryDto[]; archived: boolean }) {
  return <section className="space-y-3 border-t border-white/10 pt-6"><h2 className="text-lg font-medium text-white">{title}</h2><ul className="divide-y divide-white/10 rounded-md border border-white/10">{imports.length ? imports.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="text-zinc-100">{item.scope} · {item.protocolVersion}</p><p className="text-xs text-zinc-500">{item.itemCount} 项 · {new Date(item.confirmedAt).toLocaleString("zh-CN")}</p></div><div className="flex gap-2"><Link className="h-9 px-2 leading-9 text-teal-300 hover:underline" href={`/knowledge/imports/${item.id}`}>详情</Link><LearningTreeBatchArchiveButton batchId={item.id} archived={archived} /></div></li>) : <li className="px-4 py-8 text-sm text-zinc-500">暂无导入记录。</li>}</ul></section>;
}

function ScopeControls({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void }) {
  return <div className="inline-flex rounded-md border border-white/10 p-1" role="group" aria-label="学习树作用域">{(["global", "subject", "branch"] as const).map((value) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => onChange(value)} className={`h-8 rounded px-3 text-sm ${scope === value ? "bg-white/10 text-white" : "text-zinc-400"}`}>{scopeLabel(value)}</button>)}</div>;
}

function scopeLabel(scope: Scope) { return scope === "global" ? "全局" : scope === "subject" ? "单科" : "分支"; }

type ExportPreview = { scope: Scope; objectCount: number; cardBodyCount: number; planTitleCount: number; externalHosts: string[]; bytes: number; sourceSha256: string; exportToken: string; exportExpiresAt: string };
