"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createLearningTreeImportSelectionSnapshot,
  restoreLearningTreeImportSelections,
  type LearningTreeImportSelection,
  type LearningTreeImportSelectionSnapshot,
} from "@areaforge/core";
import { bindAiLearningTreeDraftMarkdown } from "@/lib/client/ai-learning-tree-draft";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import {
  LearningTreeImportWorkbenchView,
  type LearningTreeExportPreview as ExportPreview,
  type LearningTreeScopeView as Scope,
  type LearningTreeWorkbenchView as WorkbenchView,
} from "@/components/learning-tree-import-workbench-view";
import {
  aiLearningTreeDraftKey,
  createLearningTreeConfirmSnapshot,
  isLearningTreeSelectionSnapshot,
  learningTreeConfirmCommandScope,
  learningTreeConflictComparisons,
  learningTreeImportDraftKey,
  learningTreeImportsWorkbench,
  persistLearningTreeImportDraft,
  safeLearningTreeWorkbench,
  type LearningTreeConfirmConflict,
  type LearningTreeConfirmSnapshot,
} from "@/components/learning-tree-import-workbench-support";
import { completeIdempotentCommand } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type {
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/study/learning-tree-service";

type Selection = LearningTreeImportSelection;
const importDiffPageSize = 100;

interface LearningTreeErrorBody {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
}


export function LearningTreeImportClient(props: {
  userId: string;
  imports: LearningTreeImportBatchSummaryDto[];
  archivedImports: LearningTreeImportBatchSummaryDto[];
  exportOptions: LearningTreeExportOptionsDto;
  initialView: WorkbenchView;
  aiDraftPanel: ReactNode;
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
  const [view, setView] = useState<WorkbenchView>(props.initialView);
  const [draftRestored, setDraftRestored] = useState(false);
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
          setView("import");
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
        if (typeof envelope.value?.markdown === "string" && envelope.value.markdown.trim()) {
          setMarkdown(envelope.value.markdown);
          setDraftRestored(true);
          setView("import");
        }
        if (["global", "subject", "branch"].includes(envelope.value?.scope ?? "")) setScope(envelope.value?.scope as Scope);
        if (typeof envelope.value?.subjectKey === "string") setSubjectKey(envelope.value.subjectKey);
        if (typeof envelope.value?.rootNodeKey === "string") setRootNodeKey(envelope.value.rootNodeKey);
        if (isLearningTreeSelectionSnapshot(envelope.value?.selectionSnapshot)) {
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
      persistLearningTreeImportDraft(props.userId, {
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
    persistLearningTreeImportDraft(props.userId, {
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

  function changeView(next: WorkbenchView) {
    if (requestInFlightRef.current) return;
    setError(null);
    setConflictOpen(false);
    setView(next);
    router.replace(next === "overview" ? learningTreeImportsWorkbench : `${learningTreeImportsWorkbench}?mode=${next}`);
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
      setDraftRestored(false);
      setAiDraftLoaded(false);
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
    <>
      <LearningTreeImportWorkbenchView
        state={{
          view,
          imports: props.imports,
          archivedImports: props.archivedImports,
          subjects: props.exportOptions.subjects,
          selectedSubject,
          aiDraftPanel: props.aiDraftPanel,
          aiDraftLoaded,
          draftRestored,
          pending,
          scope,
          subjectKey,
          rootNodeKey,
          markdown,
          preview,
          exportPreview,
          selections,
          visibleDiffItems,
          diffPage,
          diffPageCount,
          unresolved,
          hasConflict: Boolean(conflict),
          conflictOpen,
          error,
        }}
        actions={{
          changeView,
          changeScope: updateScope,
          changeSubject: (value) => {
            setSubjectKey(value);
            setRootNodeKey("");
            setExportPreview(null);
            setPreview(null);
            invalidateConfirmCommand();
          },
          changeRootNode: (value) => {
            setRootNodeKey(value);
            setExportPreview(null);
            setPreview(null);
            invalidateConfirmCommand();
          },
          loadFile: (file) => void loadFile(file),
          changeMarkdown: (value) => {
            setMarkdown(value);
            setPreview(null);
            invalidateConfirmCommand();
          },
          previewImport: () => void runPreview(),
          previewExport: () => void previewExport(),
          downloadExport: () => void downloadExport(),
          changeDiffPage: setDiffPage,
          changeSelection: (stableKey, selection) => {
            setConfirmSnapshot(null);
            setSelections((current) => ({ ...current, [stableKey]: selection }));
          },
          confirmImport: () => void confirmImport(),
          openConflict: () => setConflictOpen(true),
          persistBeforeMilestone: () => persistCurrentDraft(),
        }}
      />
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
    </>
  );
}
