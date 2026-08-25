"use client";

import {
  confirmLearningTreeImport,
  previewLearningTreeImport,
} from "@/lib/api/learning-tree";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type LearningTreeScopeView as Scope,
  type LearningTreeWorkbenchView as WorkbenchView,
} from "@/components/learning-tree-import-workbench-view";
import { useLearningTreeExportWorkflow } from "@/components/use-learning-tree-export-workflow";
import {
  aiLearningTreeDraftKey,
  createLearningTreeConfirmSnapshot,
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
import { subscribeAiDraftHandoff } from "@/lib/client/ai-draft-handoff";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { getBrowserStoragePort } from "@/lib/client/storage-port";
import { isDraftAtLeastAsNew } from "@/lib/client/draft-store";
import type {
  LearningTreeExportOptionsDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/contracts";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import {
  restoreAiLearningTreeDraft,
  restoreLearningTreeImportDraft,
  isAiLearningTreeHandoff,
  removeAiLearningTreeDraft,
  removeLearningTreeImportDraft,
} from "@/components/learning-tree-import-drafts";
import {
  beginLearningTreeRequest,
  endLearningTreeRequest,
  learningTreeImportDiffPageSize,
  type LearningTreeErrorBody,
} from "@/components/learning-tree-import-request";

type Selection = LearningTreeImportSelection;


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
  const fileReadGenerationRef = useRef(0);
  const { exportPreview, clearExportPreview, previewExport, downloadExport } =
    useLearningTreeExportWorkflow({
      requestInFlightRef,
      setPending,
      setError,
      scope,
      subjectKey,
      rootNodeKey,
      persistCurrentDraft,
      recoverFromNotFound,
    });

  const applyAiDraft = useCallback((draft: { markdownDraft?: string; scope?: Scope }) => {
    if (typeof draft.markdownDraft !== "string") return;
    fileReadGenerationRef.current += 1;
    setMarkdown(draft.markdownDraft);
    if (draft.scope) setScope(draft.scope);
    setAiDraftLoaded(true);
    setDraftRestored(false);
    setPreview(null);
    clearExportPreview();
    setSelections({});
    setSavedSelectionSnapshot(null);
    setConfirmSnapshot(null);
    setConflict(null);
    setConflictOpen(false);
    setView("import");
  }, [clearExportPreview]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const aiDraft = restoreAiLearningTreeDraft(props.userId);
      const localDraft = restoreLearningTreeImportDraft(props.userId);
      const shouldUseAi = Boolean(
        aiDraft?.markdownDraft?.trim()
        && (!localDraft?.markdown?.trim() || isDraftAtLeastAsNew(aiDraft, localDraft)),
      );

      if (localDraft) {
        if (localDraft.markdown?.trim()) {
          setMarkdown(localDraft.markdown);
          setDraftRestored(true);
          setView("import");
        }
        if (localDraft.scope) setScope(localDraft.scope);
        if (typeof localDraft.subjectKey === "string") setSubjectKey(localDraft.subjectKey);
        if (typeof localDraft.rootNodeKey === "string") setRootNodeKey(localDraft.rootNodeKey);
        if (localDraft.selectionSnapshot) setSavedSelectionSnapshot(localDraft.selectionSnapshot);
      }
      if (shouldUseAi && aiDraft) {
        applyAiDraft(aiDraft);
      } else if (localDraft?.markdown?.trim()) {
        setAiDraftLoaded(false);
        if (aiDraft) removeAiLearningTreeDraft(props.userId);
      }
      setDraftLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applyAiDraft, props.userId]);

  useEffect(() => {
    return subscribeAiDraftHandoff({
      endpoint: "learning-tree",
      userId: props.userId,
      isValue: isAiLearningTreeHandoff,
      onValue: applyAiDraft,
    });
  }, [applyAiDraft, props.userId]);

  useEffect(() => {
    if (!draftLoaded) return;
    if (!markdown.trim()) {
      removeLearningTreeImportDraft(props.userId);
      return;
    }
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
      if (aiDraftLoaded) removeAiLearningTreeDraft(props.userId);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [aiDraftLoaded, draftLoaded, markdown, preview, props.userId, rootNodeKey, savedSelectionSnapshot, scope, selections, subjectKey]);

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
    clearExportPreview();
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
    const generation = fileReadGenerationRef.current + 1;
    fileReadGenerationRef.current = generation;
    setError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) return setError("请选择 .md 文件");
    if (file.size > 2 * 1024 * 1024) return setError("Markdown 文件不能超过 2 MiB");
    const contents = await file.text();
    if (fileReadGenerationRef.current !== generation) return;
    setMarkdown(contents);
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
    if (!beginLearningTreeRequest(requestInFlightRef, setPending)) return;
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
      const response = await previewLearningTreeImport({ markdown: importMarkdown, scope });
      const body = response.body;
      if (isUnauthorized(response)) {
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
      endLearningTreeRequest(requestInFlightRef, setPending);
    }
  }

  const diffPageCount = Math.max(1, Math.ceil((preview?.items.length ?? 0) / learningTreeImportDiffPageSize));
  const visibleDiffItems = preview?.items.slice(
    diffPage * learningTreeImportDiffPageSize,
    (diffPage + 1) * learningTreeImportDiffPageSize,
  ) ?? [];

  async function confirmImport() {
    if (!preview || unresolved || conflict) return;
    if (!beginLearningTreeRequest(requestInFlightRef, setPending)) return;
    setError(null);
    persistCurrentDraft();
    const submission = confirmSnapshot ?? createLearningTreeConfirmSnapshot(
      props.userId,
      preview,
      selections,
    );
    if (!confirmSnapshot) setConfirmSnapshot(submission);
    try {
      const response = await confirmLearningTreeImport(submission.payload);
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，Markdown 与映射已保留；重新登录后请显式预览并确认。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        recoverFromNotFound(body);
        return;
      }
      if (isConflict(response)) {
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
      const storage = getBrowserStoragePort("local");
      storage?.removeItem(aiLearningTreeDraftKey(props.userId));
      storage?.removeItem(learningTreeImportDraftKey(props.userId));
      setConfirmSnapshot(null);
      setConflict(null);
      router.push(`/knowledge/imports/${body.result.batchId}`);
      router.refresh();
    } catch {
      setError("网络不可用，Markdown 与映射仍保留；恢复网络后请显式重试。");
    } finally {
      endLearningTreeRequest(requestInFlightRef, setPending);
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
            clearExportPreview();
            setPreview(null);
            invalidateConfirmCommand();
          },
          changeRootNode: (value) => {
            setRootNodeKey(value);
            clearExportPreview();
            setPreview(null);
            invalidateConfirmCommand();
          },
          loadFile: (file) => void loadFile(file),
          changeMarkdown: (value) => {
            fileReadGenerationRef.current += 1;
            setMarkdown(value);
            setPreview(null);
            if (!value.trim()) {
              setAiDraftLoaded(false);
              setDraftRestored(false);
              setSelections({});
              setSavedSelectionSnapshot(null);
              removeAiLearningTreeDraft(props.userId);
              removeLearningTreeImportDraft(props.userId);
            }
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
