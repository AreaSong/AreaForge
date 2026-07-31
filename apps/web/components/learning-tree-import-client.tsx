"use client";

import { Check, ChevronLeft, ChevronRight, Download, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createLearningTreeImportSelectionSnapshot,
  restoreLearningTreeImportSelections,
  type LearningTreeImportSelection,
  type LearningTreeImportSelectionSnapshot,
} from "@areaforge/core";
import { bindAiLearningTreeDraftMarkdown } from "@/lib/client/ai-learning-tree-draft";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { LearningTreeImportHistory } from "@/components/learning-tree-import-history";
import type {
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/study/learning-tree-service";

type Scope = "global" | "subject" | "branch";
type Selection = LearningTreeImportSelection;
const importDiffPageSize = 100;
const learningTreeImportsWorkbench = "/knowledge/imports";

interface LearningTreeConfirmPayload {
  markdown: string;
  previewToken: string;
  previewOperationId: string;
  idempotencyKey: string;
  selections: Array<{ stableKey: string; choice: Selection["choice"]; mappedTargetId?: string }>;
}

interface LearningTreeConfirmSnapshot {
  payload: LearningTreeConfirmPayload;
  baseline: {
    workspaceId: string;
    rootRevision: number;
    sourceSha256: string;
    canonicalPlanHash: string;
    diffSnapshotHash: string;
  };
}

interface LearningTreeErrorBody {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
}

interface LearningTreeConfirmConflict {
  submission: LearningTreeConfirmSnapshot;
  latest: unknown;
  conflictFields: string[];
  workbench: string;
}

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subjectKey, setSubjectKey] = useState(props.exportOptions.subjects[0]?.stableKey ?? "");
  const [rootNodeKey, setRootNodeKey] = useState("");
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [aiDraftLoaded, setAiDraftLoaded] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [diffPage, setDiffPage] = useState(0);
  const [savedSelectionSnapshot, setSavedSelectionSnapshot] =
    useState<LearningTreeImportSelectionSnapshot | null>(null);
  const [confirmSnapshot, setConfirmSnapshot] = useState<LearningTreeConfirmSnapshot | null>(null);
  const [conflict, setConflict] = useState<LearningTreeConfirmConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const requestInFlightRef = useRef(false);

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
          value?: {
            markdown?: string;
            scope?: Scope;
            subjectKey?: string;
            rootNodeKey?: string;
            selectionSnapshot?: LearningTreeImportSelectionSnapshot;
          };
        };
        if ((envelope.version !== 1 && envelope.version !== 2) || envelope.userId !== props.userId || typeof envelope.updatedAt !== "number" || Date.now() - envelope.updatedAt > 24 * 60 * 60 * 1000) {
          window.localStorage.removeItem(key);
          setDraftLoaded(true);
          return;
        }
        if (typeof envelope.value?.markdown === "string" && envelope.value.markdown.trim()) setMarkdown(envelope.value.markdown);
        if (["global", "subject", "branch"].includes(envelope.value?.scope ?? "")) setScope(envelope.value?.scope as Scope);
        if (typeof envelope.value?.subjectKey === "string") setSubjectKey(envelope.value.subjectKey);
        if (typeof envelope.value?.rootNodeKey === "string") setRootNodeKey(envelope.value.rootNodeKey);
        if (isSelectionSnapshot(envelope.value?.selectionSnapshot)) {
          setSavedSelectionSnapshot(envelope.value.selectionSnapshot);
        }
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
      persistImportDraft(props.userId, {
        markdown,
        scope,
        subjectKey,
        rootNodeKey,
        selectionSnapshot: preview
          ? createLearningTreeImportSelectionSnapshot({
              sourceSha256: preview.sourceSha256,
              canonicalPlanHash: preview.canonicalPlanHash,
              selections,
            })
          : savedSelectionSnapshot,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftLoaded, markdown, preview, props.userId, rootNodeKey, savedSelectionSnapshot, scope, selections, subjectKey]);

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

  function beginRequest(): boolean {
    if (requestInFlightRef.current) return false;
    requestInFlightRef.current = true;
    setPending(true);
    return true;
  }

  function endRequest() {
    requestInFlightRef.current = false;
    setPending(false);
  }

  function persistCurrentDraft(markdownOverride = markdown) {
    persistImportDraft(props.userId, {
      markdown: markdownOverride,
      scope,
      subjectKey,
      rootNodeKey,
      selectionSnapshot: preview
        ? createLearningTreeImportSelectionSnapshot({
            sourceSha256: preview.sourceSha256,
            canonicalPlanHash: preview.canonicalPlanHash,
            selections,
          })
        : savedSelectionSnapshot,
    });
  }

  function invalidateConfirmCommand() {
    setConfirmSnapshot(null);
    setConflict(null);
    setConflictOpen(false);
  }

  function recoverFromNotFound(body: LearningTreeErrorBody | null) {
    persistCurrentDraft();
    setError("导入目标已不存在或不可访问，Markdown 与映射仍保留；正在返回导入工作台。");
    router.replace(safeLearningTreeWorkbench(body?.workbench));
  }

  function prepareConflictRepreview() {
    setConflict(null);
    setConflictOpen(false);
    setConfirmSnapshot(null);
    setPreview(null);
    setError("Markdown 与映射已保留。请显式重新预览、检查最新差异，再次点击确认导入。");
  }

  function updateScope(next: Scope) {
    if (requestInFlightRef.current) return;
    setScope(next);
    setPreview(null);
    setExportPreview(null);
    invalidateConfirmCommand();
    if (next === "global") setRootNodeKey("");
  }

  async function loadFile(file: File | undefined) {
    if (requestInFlightRef.current) return;
    setError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) return setError("请选择 .md 文件");
    if (file.size > 2 * 1024 * 1024) return setError("Markdown 文件不能超过 2 MiB");
    setMarkdown(await file.text());
    setAiDraftLoaded(false);
    setPreview(null);
    invalidateConfirmCommand();
  }

  async function runPreview() {
    if (!markdown.trim()) return;
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
    if (!beginRequest()) return;
    setError(null);
    const previousSelectionSnapshot = preview
      ? createLearningTreeImportSelectionSnapshot({
          sourceSha256: preview.sourceSha256,
          canonicalPlanHash: preview.canonicalPlanHash,
          selections,
        })
      : savedSelectionSnapshot;
    persistCurrentDraft(importMarkdown);
    try {
      const response = await fetch("/api/learning-tree/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: importMarkdown, scope }),
      });
      const body = (await response.json().catch(() => null)) as
        (LearningTreeErrorBody & { preview?: LearningTreePreviewDto }) | null;
      if (response.status === 401) {
        setError("登录已过期，Markdown 与映射已保留；重新登录后请显式预览。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        recoverFromNotFound(body);
        return;
      }
      if (!response.ok || !body?.preview) {
        setError(body?.error ?? "学习树预览失败，Markdown 草稿已保留");
        return;
      }
      const nextSelections = restoreLearningTreeImportSelections({
        sourceSha256: body.preview.sourceSha256,
        canonicalPlanHash: body.preview.canonicalPlanHash,
        items: body.preview.items,
        snapshot: previousSelectionSnapshot,
      });
      setSelections(nextSelections);
      setSavedSelectionSnapshot(createLearningTreeImportSelectionSnapshot({
        sourceSha256: body.preview.sourceSha256,
        canonicalPlanHash: body.preview.canonicalPlanHash,
        selections: nextSelections,
      }));
      setConfirmSnapshot(null);
      setConflict(null);
      setConflictOpen(false);
      setDiffPage(0);
      setPreview(body.preview);
    } catch {
      setError("网络不可用，Markdown 草稿已保留；恢复网络后请显式重试。");
    } finally {
      endRequest();
    }
  }

  const diffPageCount = Math.max(1, Math.ceil((preview?.items.length ?? 0) / importDiffPageSize));
  const visibleDiffItems = preview?.items.slice(
    diffPage * importDiffPageSize,
    (diffPage + 1) * importDiffPageSize,
  ) ?? [];

  async function confirmImport() {
    if (!preview || unresolved || conflict) return;
    if (!beginRequest()) return;
    setError(null);
    persistCurrentDraft();
    const submission = confirmSnapshot ?? createLearningTreeConfirmSnapshot(
      props.userId,
      preview,
      selections,
    );
    if (!confirmSnapshot) setConfirmSnapshot(submission);
    try {
      const response = await fetch("/api/learning-tree/imports/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission.payload),
      });
      const body = (await response.json().catch(() => null)) as
        (LearningTreeErrorBody & { result?: { batchId: string } }) | null;
      if (response.status === 401) {
        setError("登录已过期，Markdown 与映射已保留；重新登录后请显式预览并确认。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        recoverFromNotFound(body);
        return;
      }
      if (response.status === 409) {
        setConflict({
          submission,
          latest: body?.latest ?? { state: "CONFLICT" },
          conflictFields: body?.conflictFields?.length ? body.conflictFields : ["confirmState"],
          workbench: safeLearningTreeWorkbench(body?.workbench),
        });
        setConflictOpen(true);
        setError("导入状态已变化，Markdown 与映射仍保留；处理差异并重新预览后才能再次确认。");
        return;
      }
      if (!response.ok || !body?.result) {
        setError(body?.error ?? "确认导入失败；当前提交快照已保留，请显式重试或重新预览。");
        return;
      }
      completeIdempotentCommand(learningTreeConfirmCommandScope(props.userId));
      window.localStorage.removeItem(aiLearningTreeDraftKey(props.userId));
      window.localStorage.removeItem(learningTreeImportDraftKey(props.userId));
      setConfirmSnapshot(null);
      setConflict(null);
      router.push(`/knowledge/imports/${body.result.batchId}`);
      router.refresh();
    } catch {
      setError("网络不可用，Markdown 与映射仍保留；恢复网络后请显式重试。");
    } finally {
      endRequest();
    }
  }

  function exportUrl() {
    const params = new URLSearchParams({ scope });
    if (scope !== "global") params.set("subjectKey", subjectKey);
    if (scope === "branch") params.set("rootNodeKey", rootNodeKey);
    params.set("preview", "1");
    return `/api/learning-tree/export?${params.toString()}`;
  }

  async function previewExport() {
    if (!beginRequest()) return;
    setError(null);
    try {
      const response = await fetch(exportUrl());
      const body = (await response.json().catch(() => null)) as
        (LearningTreeErrorBody & { preview?: ExportPreview }) | null;
      if (response.status === 401) {
        persistCurrentDraft();
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        recoverFromNotFound(body);
        return;
      }
      if (!response.ok || !body?.preview) {
        setError(body?.error ?? "导出预览失败，请显式重试。");
        return;
      }
      setExportPreview(body.preview);
    } catch {
      setError("网络不可用，导出范围仍保留；恢复网络后请显式重试。");
    } finally {
      endRequest();
    }
  }

  async function downloadExport() {
    if (!exportPreview || !beginRequest()) return;
    setError(null);
    try {
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
      if (response.status === 401) {
        persistCurrentDraft();
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as LearningTreeErrorBody | null;
        if (response.status === 404) {
          recoverFromNotFound(body);
          return;
        }
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
      setExportPreview(null);
    } catch {
      setError("网络不可用，导出授权仍保留；恢复网络后请显式重试。");
    } finally {
      endRequest();
    }
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
        <ScopeControls scope={scope} disabled={pending} onChange={updateScope} />
        {scope !== "global" ? (
          <select disabled={pending} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm disabled:opacity-50 sm:max-w-md" value={subjectKey} onChange={(event) => { setSubjectKey(event.target.value); setRootNodeKey(""); setExportPreview(null); }}>
            {props.exportOptions.subjects.map((subject) => <option key={subject.id} value={subject.stableKey}>{subject.name}</option>)}
          </select>
        ) : null}
        {scope === "branch" ? (
          <select disabled={pending} className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm disabled:opacity-50 sm:max-w-md" value={rootNodeKey} onChange={(event) => { setRootNodeKey(event.target.value); setExportPreview(null); }}>
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
        <ScopeControls scope={scope} disabled={pending} onChange={updateScope} />
        {aiDraftLoaded && scope !== "global" ? (
          <label className="block space-y-1 text-sm text-zinc-400">
            <span>AI 草稿所属科目</span>
            <select disabled={pending} aria-label="AI 草稿所属科目" className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm disabled:opacity-50 sm:max-w-md" value={subjectKey} onChange={(event) => { setSubjectKey(event.target.value); setRootNodeKey(""); setPreview(null); invalidateConfirmCommand(); }}>
              {props.exportOptions.subjects.map((subject) => <option key={subject.id} value={subject.stableKey}>{subject.name}</option>)}
            </select>
          </label>
        ) : null}
        {aiDraftLoaded && scope === "branch" ? (
          <label className="block space-y-1 text-sm text-zinc-400">
            <span>AI 草稿所属分支</span>
            <select disabled={pending} aria-label="AI 草稿所属分支" className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm disabled:opacity-50 sm:max-w-md" value={rootNodeKey} onChange={(event) => { setRootNodeKey(event.target.value); setPreview(null); invalidateConfirmCommand(); }}>
              <option value="">选择分支根节点</option>
              {selectedSubject?.nodes.map((node) => <option key={node.stableKey} value={node.stableKey}>{node.title}</option>)}
            </select>
          </label>
        ) : null}
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200">
          <Upload size={16} aria-hidden />选择 Markdown
          <input disabled={pending} className="sr-only" type="file" accept=".md,text/markdown,text/plain" onChange={(event) => void loadFile(event.target.files?.[0])} />
        </label>
        <textarea disabled={pending} aria-label="学习树 Markdown" className="min-h-64 w-full rounded-md border border-white/10 bg-[#101419] p-3 font-mono text-sm text-zinc-200 disabled:opacity-60" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setPreview(null); invalidateConfirmCommand(); }} placeholder="粘贴 AREAFORGE_LEARNING_TREE_V1 Markdown" />
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
                      onClick={() => persistImportDraft(props.userId, {
                        markdown,
                        scope,
                        subjectKey,
                        rootNodeKey,
                        selectionSnapshot: preview
                          ? createLearningTreeImportSelectionSnapshot({
                              sourceSha256: preview.sourceSha256,
                              canonicalPlanHash: preview.canonicalPlanHash,
                              selections,
                            })
                          : savedSelectionSnapshot,
                      })}
                    >
                      创建“{milestoneKey}”并返回
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
              <span>差异 {preview.items.length} 项 · 第 {diffPage + 1}/{diffPageCount} 页</span>
              <div className="flex gap-1">
                <button type="button" aria-label="上一页差异" title="上一页" disabled={diffPage === 0} onClick={() => setDiffPage((page) => Math.max(0, page - 1))} className="grid size-9 place-items-center rounded-md border border-white/10 disabled:opacity-40"><ChevronLeft size={16} aria-hidden /></button>
                <button type="button" aria-label="下一页差异" title="下一页" disabled={diffPage + 1 >= diffPageCount} onClick={() => setDiffPage((page) => Math.min(diffPageCount - 1, page + 1))} className="grid size-9 place-items-center rounded-md border border-white/10 disabled:opacity-40"><ChevronRight size={16} aria-hidden /></button>
              </div>
            </div>
            <ul className="space-y-2">
              {visibleDiffItems.map((item) => {
                const selection = selections[item.stableKey] ?? { choice: "apply" as const };
                const fixedSkip = item.diffType === "UNCHANGED" || item.diffType === "SKIP";
                return (
                  <li key={`${item.objectType}:${item.stableKey}`} className="grid gap-2 rounded-md border border-white/10 p-3 text-sm md:grid-cols-[8rem_1fr_9rem]">
                    <div><span className="font-medium text-teal-300">{item.diffType}</span><p className="text-xs text-zinc-500">{item.objectType} · L{item.sourceLine ?? "?"}</p></div>
                    <div><p className="text-zinc-100">{item.title}</p><p className="break-all text-xs text-zinc-500">{item.stableKey}{item.reason ? ` · ${item.reason}` : ""}</p></div>
                    <div className="space-y-2">
                      <select aria-label={`${item.title}处理方式`} disabled={fixedSkip || pending || Boolean(conflict)} className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={fixedSkip ? "skip" : selection.choice} onChange={(event) => { setConfirmSnapshot(null); setSelections((current) => ({ ...current, [item.stableKey]: { ...selection, choice: event.target.value as Selection["choice"] } })); }}>{fixedSkip ? null : <option value="apply">应用</option>}<option value="skip">跳过</option></select>
                      {item.diffType === "CONFLICT" && selection.choice === "apply" ? <select disabled={pending || Boolean(conflict)} aria-label={`${item.title}映射目标`} className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 disabled:opacity-60" value={selection.mappedTargetId ?? ""} onChange={(event) => { setConfirmSnapshot(null); setSelections((current) => ({ ...current, [item.stableKey]: { ...selection, mappedTargetId: event.target.value || undefined } })); }}><option value="">选择目标</option>{item.candidateMatches.map((candidate) => <option key={candidate.entityId ?? candidate.title} value={candidate.entityId}>{candidate.title}</option>)}</select> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending || unresolved || Boolean(conflict)} onClick={() => void confirmImport()} className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-500 px-5 text-sm font-medium text-black disabled:opacity-50"><Check size={16} aria-hidden />确认原子导入</button>
              <button type="button" disabled={pending} onClick={() => void runPreview()} className="h-11 rounded-md border border-white/10 px-4 text-sm">重新预览</button>
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
        {conflict && !conflictOpen ? <button type="button" className="text-sm text-amber-200 underline underline-offset-4" onClick={() => setConflictOpen(true)}>处理导入冲突</button> : null}
      </section>

      <LearningTreeImportHistory title="导入历史" imports={props.imports} archived={false} />
      {props.archivedImports.length ? (
        <details className="border-t border-white/10 pt-6">
          <summary className="cursor-pointer text-sm text-zinc-300">已归档历史（{props.archivedImports.length}）</summary>
          <LearningTreeImportHistory title="已归档批次" imports={props.archivedImports} archived />
        </details>
      ) : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="学习树导入状态已变化"
        description="第一次提交快照、本地 Markdown 与映射均已保留。系统不会采用服务端值或自动重放，请查看差异后重新预览。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? learningTreeConflictComparisons(conflict, preview, selections) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={() => setConflictOpen(false)}
        onManualMerge={prepareConflictRepreview}
        adoptLabel="暂不处理，保留本地草稿"
        mergeLabel="保留本地内容并重新预览"
      />
    </div>
  );
}

function aiLearningTreeDraftKey(userId: string): string {
  return `areaforge.ai-draft.learning-tree.${userId}`;
}

function learningTreeImportDraftKey(userId: string): string {
  return `areaforge.learning-tree-import.${userId}`;
}

function persistImportDraft(userId: string, value: {
  markdown: string;
  scope: Scope;
  subjectKey: string;
  rootNodeKey: string;
  selectionSnapshot: LearningTreeImportSelectionSnapshot | null;
}): void {
  try {
    window.localStorage.setItem(learningTreeImportDraftKey(userId), JSON.stringify({
      version: 2,
      userId,
      updatedAt: Date.now(),
      value,
    }));
  } catch {
    // The in-memory editor remains usable when browser storage is unavailable or full.
  }
}

function isSelectionSnapshot(value: unknown): value is LearningTreeImportSelectionSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.sourceFingerprint !== "string" || !snapshot.selections || typeof snapshot.selections !== "object") {
    return false;
  }
  return Object.values(snapshot.selections).every((selection) => {
    if (!selection || typeof selection !== "object") return false;
    const row = selection as Record<string, unknown>;
    return (row.choice === "apply" || row.choice === "skip") &&
      (row.mappedTargetId === undefined || typeof row.mappedTargetId === "string");
  });
}

function missingMilestoneKeys(preview: LearningTreePreviewDto): string[] {
  return [...new Set(preview.items.flatMap((item) => {
    if (!item.blocking || !item.reason?.startsWith("milestone_missing:")) return [];
    return [item.reason.slice("milestone_missing:".length)];
  }))];
}

function createLearningTreeConfirmSnapshot(
  userId: string,
  preview: LearningTreePreviewDto,
  selections: Record<string, Selection>,
): LearningTreeConfirmSnapshot {
  const selectionRows = preview.items.map((item) => {
    const selection = selections[item.stableKey] ?? {
      choice: item.diffType === "UNCHANGED" || item.diffType === "SKIP" ? "skip" as const : "apply" as const,
    };
    return {
      stableKey: item.stableKey,
      choice: selection.choice,
      ...(selection.mappedTargetId ? { mappedTargetId: selection.mappedTargetId } : {}),
    };
  });
  const commandScope = learningTreeConfirmCommandScope(userId);
  const idempotencyKey = getOrCreateIdempotencyKey(commandScope, "learning-tree-confirm", {
    previewOperationId: preview.operationId,
    workspaceId: preview.workspaceId,
    rootRevision: preview.rootRevision,
    sourceSha256: preview.sourceSha256,
    canonicalPlanHash: preview.canonicalPlanHash,
    diffSnapshotHash: preview.diffSnapshotHash,
    selections: selectionRows,
  });
  return {
    payload: {
      markdown: preview.canonicalMarkdown,
      previewToken: preview.previewToken,
      previewOperationId: preview.operationId,
      idempotencyKey,
      selections: selectionRows,
    },
    baseline: {
      workspaceId: preview.workspaceId,
      rootRevision: preview.rootRevision,
      sourceSha256: preview.sourceSha256,
      canonicalPlanHash: preview.canonicalPlanHash,
      diffSnapshotHash: preview.diffSnapshotHash,
    },
  };
}

function learningTreeConflictComparisons(
  conflict: LearningTreeConfirmConflict,
  preview: LearningTreePreviewDto | null,
  selections: Record<string, Selection>,
) {
  const latest = asRecord(conflict.latest);
  const baseline = conflict.submission.baseline;
  return [
    {
      field: "state",
      label: "导入状态",
      baseline: "READY_TO_CONFIRM",
      local: preview ? "READY_TO_CONFIRM" : "NEEDS_PREVIEW",
      server: latest.state,
    },
    {
      field: "workspaceId",
      label: "考试工作区",
      baseline: baseline.workspaceId,
      local: preview?.workspaceId ?? baseline.workspaceId,
      server: latest.workspaceId,
    },
    {
      field: "rootRevision",
      label: "学习树根 revision",
      baseline: baseline.rootRevision,
      local: preview?.rootRevision ?? baseline.rootRevision,
      server: latest.rootRevision ?? latest.revision,
    },
    {
      field: "diffSnapshotHash",
      label: "差异快照",
      baseline: baseline.diffSnapshotHash,
      local: preview?.diffSnapshotHash ?? baseline.diffSnapshotHash,
      server: latest.diffSnapshotHash,
    },
    {
      field: "sourceSha256",
      label: "Markdown 源摘要",
      baseline: baseline.sourceSha256,
      local: preview?.sourceSha256 ?? baseline.sourceSha256,
      server: latest.sourceSha256,
    },
    {
      field: "canonicalPlanHash",
      label: "规范化计划摘要",
      baseline: baseline.canonicalPlanHash,
      local: preview?.canonicalPlanHash ?? baseline.canonicalPlanHash,
      server: latest.canonicalPlanHash,
    },
    {
      field: "selections",
      label: "映射与跳过选择",
      baseline: summarizeSelections(conflict.submission.payload.selections),
      local: summarizeSelections(Object.entries(selections).map(([stableKey, selection]) => ({
        stableKey,
        ...selection,
      }))),
      server: latest.blockingStableKeys ?? latest.missingMilestoneKeys ?? latest.selections,
    },
  ];
}

function summarizeSelections(
  selections: Array<{ choice: Selection["choice"]; mappedTargetId?: string }>,
): { total: number; apply: number; skip: number; mapped: number } {
  return {
    total: selections.length,
    apply: selections.filter((selection) => selection.choice === "apply").length,
    skip: selections.filter((selection) => selection.choice === "skip").length,
    mapped: selections.filter((selection) => Boolean(selection.mappedTargetId)).length,
  };
}

function learningTreeConfirmCommandScope(userId: string): string {
  return `learning-tree-confirm:${userId}`;
}

function safeLearningTreeWorkbench(value: string | undefined): string {
  return value === learningTreeImportsWorkbench ? value : learningTreeImportsWorkbench;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function ScopeControls({ scope, disabled, onChange }: { scope: Scope; disabled: boolean; onChange: (scope: Scope) => void }) {
  return <div className="inline-flex rounded-md border border-white/10 p-1" role="group" aria-label="学习树作用域">{(["global", "subject", "branch"] as const).map((value) => <button type="button" key={value} disabled={disabled} aria-pressed={scope === value} onClick={() => onChange(value)} className={`h-8 rounded px-3 text-sm disabled:opacity-50 ${scope === value ? "bg-white/10 text-white" : "text-zinc-400"}`}>{scopeLabel(value)}</button>)}</div>;
}

function scopeLabel(scope: Scope) { return scope === "global" ? "全局" : scope === "subject" ? "单科" : "分支"; }

type ExportPreview = { scope: Scope; objectCount: number; cardBodyCount: number; planTitleCount: number; externalHosts: string[]; bytes: number; sourceSha256: string; exportToken: string; exportExpiresAt: string };
