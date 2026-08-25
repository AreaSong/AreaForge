"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  isUploadResolutionLatest,
  loadPendingUploads,
  restoreServerPendingUpload,
  safeResourceWorkbench,
  type PendingUploadDraft,
  type UploadItem,
  type UploadResolutionConflict,
  type UploadResolutionRequest,
} from "@/components/study-resource-workbench-support";
import { buildUploadResolutionRequest } from "@/components/study-resource-workbench-utils";
import {
  createSelectedUploadItems,
  reduceUploadItems,
} from "@/components/study-resource-upload-state";
import type { StudyResourceDraftController } from "@/components/use-study-resource-draft";
import { listStagingUploads, resolveStagedUpload, stageUploads } from "@/lib/api/uploads";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  createExclusiveOperationGate,
  type OperationToken,
} from "@/lib/client/operation-gates";
import {
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { StagingUploadResult } from "@/lib/contracts";

export function useStudyResourceUploadWorkflow(input: {
  draft: StudyResourceDraftController;
  userId: string;
}) {
  const router = useRouter();
  const pendingDraftKey = `areaforge.resource.draft.upload-pending.${input.userId}`;
  const [uploads, dispatchUploads] = useReducer(
    reduceUploadItems,
    pendingDraftKey,
    loadPendingUploads,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateDrawerOpen, setDuplicateDrawerOpen] = useState(false);
  const [resolutionConflict, setResolutionConflict] = useState<UploadResolutionConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [recoveredPending, setRecoveredPending] = useState(
    () => loadPendingUploads(pendingDraftKey).some((item) => item.status === "duplicate"),
  );
  const batchGateRef = useRef(createExclusiveOperationGate());

  useEffect(() => () => {
    batchGateRef.current.invalidate();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listStagingUploads()
      .then((result) => result.ok ? result.body : null)
      .then((body) => {
        if (cancelled || !body?.items?.length) return;
        dispatchUploads({
          type: "merge-pending",
          items: body.items?.map((staging) => restoreServerPendingUpload(staging)) ?? [],
        });
        setRecoveredPending(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const pendingItems = uploads.filter((item): item is UploadItem & {
      staging: StagingUploadResult;
      decision: "reuse" | "copy" | "skip";
    } => item.status === "duplicate" && Boolean(item.staging && item.decision));
    if (pendingItems.length === 0) {
      removePrivateBusinessDraft(pendingDraftKey);
      return;
    }
    const draft: PendingUploadDraft[] = pendingItems.map((item) => ({
      key: item.key,
      fileName: item.originalName,
      staging: {
        attachment: item.staging.attachment,
        duplicates: item.staging.duplicates.map(({ resourceId, stableKey, title }) => ({ resourceId, stableKey, title })),
      },
      decision: item.decision,
      reuseResourceId: item.reuseResourceId,
      submittedSnapshot: item.submittedSnapshot,
    }));
    savePrivateBusinessDraft(pendingDraftKey, draft);
  }, [pendingDraftKey, uploads]);

  useEffect(() => {
    const hasUnresolvedUpload = pending || uploads.some((item) => item.status === "staging" || item.status === "duplicate");
    if (!hasUnresolvedUpload) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "仍有未完成的资料上传或重复处理，离开后可返回恢复。";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pending, uploads]);

  function selectFiles(files: FileList | null) {
    if (batchGateRef.current.isLocked()) return;
    setError(null);
    setRecoveredPending(false);
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length < 1 || selected.length > 5) {
      dispatchUploads({ type: "replace", items: [] });
      setError("每批请选择 1 至 5 个文件");
      return;
    }
    dispatchUploads({ type: "replace", items: createSelectedUploadItems(selected) });
  }

  async function uploadBatch() {
    const batchToken = batchGateRef.current.acquire();
    if (!batchToken) return;
    const selected = uploads.filter((item) => item.status === "ready");
    if (!selected.length) {
      batchGateRef.current.release(batchToken);
      return;
    }
    const metadataSnapshot = currentMetadataSnapshot();
    setPending(true);
    setError(null);
    const selectedKeys = new Set(selected.map((item) => item.key));
    const commandScope = `study-resource:upload-batch:${input.userId}`;
    const idempotencyKey = getOrCreateIdempotencyKey(
      commandScope,
      "resource-upload",
      selected.map((item) => ({
        name: item.file?.name ?? item.originalName,
        size: item.file?.size ?? null,
        type: item.file?.type ?? null,
        lastModified: item.file?.lastModified ?? null,
      })),
    );
    dispatchUploads({ type: "mark-staging", keys: selectedKeys });
    const form = new FormData();
    selected.forEach((item) => {
      if (item.file) form.append("file", item.file);
    });
    try {
      const result = await stageUploads(form, idempotencyKey);
      if (!batchGateRef.current.isActive(batchToken)) return;
      const body = result.body;
      if (isUnauthorized(result)) {
        markSelectedFailed(selectedKeys, "登录已过期，请重新登录后重新选择文件");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok || !body?.items) {
        const message = body?.error ?? "上传失败";
        markSelectedFailed(selectedKeys, message);
        setError(message);
        return;
      }
      completeIdempotentCommand(commandScope);
      const staged = selected.map((item, index): UploadItem => {
        const resultItem = body.items?.find((candidate) => candidate.index === index);
        if (!resultItem?.staging || resultItem.error) {
          return { ...item, status: "failed", error: resultItem?.error ?? "上传失败" };
        }
        if (resultItem.staging.duplicates.length) {
          return {
            ...item,
            status: "duplicate",
            staging: resultItem.staging,
            decision: "reuse",
            reuseResourceId: resultItem.staging.duplicates[0]?.resourceId,
          };
        }
        return { ...item, staging: resultItem.staging, decision: "copy" };
      });
      const prepared = staged.map((item): UploadItem => item.status === "duplicate"
        ? item
        : { ...item, status: "duplicate", submittedSnapshot: buildResolutionRequest(item, metadataSnapshot) });
      dispatchUploads({ type: "merge-updates", items: prepared });
      const autoTargets = prepared.filter((item, index) => staged[index]?.status !== "duplicate");
      const settled = await Promise.all(autoTargets.map((item) => resolveItem(
        item,
        item.submittedSnapshot ?? buildResolutionRequest(item, metadataSnapshot),
        batchToken,
      )));
      if (!batchGateRef.current.isActive(batchToken)) return;
      const firstConflict = settled.find((entry) => entry.conflict)?.conflict;
      if (firstConflict) openResolutionConflict(firstConflict);
      const finalUpdates = reduceUploadItems(prepared, {
        type: "merge-updates",
        items: settled.map((entry) => entry.item),
      });
      dispatchUploads({ type: "merge-updates", items: finalUpdates });
      if (finalUpdates.some((item) => item.status === "done")) router.refresh();
      if (finalUpdates.some((item) => item.status === "duplicate")) {
        input.draft.setCreateOpen(false);
        setDuplicateDrawerOpen(true);
      }
    } catch {
      if (!batchGateRef.current.isActive(batchToken)) return;
      const message = "上传请求失败，请检查网络后重新选择文件";
      markSelectedFailed(selectedKeys, message);
      setError(message);
    } finally {
      if (batchGateRef.current.release(batchToken)) setPending(false);
    }
  }

  async function resolveItem(
    item: UploadItem,
    submitted: UploadResolutionRequest,
    batchToken: OperationToken,
  ): Promise<{ item: UploadItem; conflict?: UploadResolutionConflict }> {
    if (!item.staging || !item.decision) {
      return { item: { ...item, status: "failed", error: "缺少重复处理决策" } };
    }
    try {
      const result = await resolveStagedUpload(submitted);
      if (!batchGateRef.current.isActive(batchToken)) return { item };
      const body = result.body;
      if (isUnauthorized(result)) {
        redirectToLoginWithCurrentLocation();
        return {
          item: {
            ...item,
            status: "duplicate",
            submittedSnapshot: submitted,
            error: "登录已过期，重复处理决策与提交快照已保留",
          },
        };
      }
      if (isConflict(result) && isUploadResolutionLatest(body?.latest)) {
        return {
          item: {
            ...item,
            status: "duplicate",
            submittedSnapshot: submitted,
            error: "服务端已有不同终态，请先处理冲突",
          },
          conflict: {
            itemKey: item.key,
            submitted,
            latest: body.latest,
            conflictFields: body.conflictFields ?? ["decision"],
            workbench: safeResourceWorkbench(body.workbench),
          },
        };
      }
      if (result.status === 404) {
        router.replace(safeResourceWorkbench(body?.workbench));
        return {
          item: {
            ...item,
            status: "duplicate",
            submittedSnapshot: submitted,
            error: "上传对象已不可用，草稿已保留；请从资料工作台重新核对",
          },
        };
      }
      if (!result.ok || (!body?.resource && !body?.skipped)) {
        return {
          item: {
            ...item,
            status: "duplicate",
            submittedSnapshot: submitted,
            error: body?.error ?? "处理失败",
          },
        };
      }
      return {
        item: {
          ...item,
          status: "done",
          submittedSnapshot: undefined,
          error: undefined,
          resultTitle: body.skipped ? "已跳过" : body.resource?.title,
        },
      };
    } catch {
      if (!batchGateRef.current.isActive(batchToken)) return { item };
      return {
        item: {
          ...item,
          status: "duplicate",
          submittedSnapshot: submitted,
          error: "处理结果未知，提交快照已保留；请显式重试",
        },
      };
    }
  }

  async function resolveDuplicates() {
    const targets = uploads.filter((item) => item.status === "duplicate");
    if (!targets.length) return;
    const batchToken = batchGateRef.current.acquire();
    if (!batchToken) return;
    const metadataSnapshot = currentMetadataSnapshot();
    setPending(true);
    try {
      const prepared = targets.map((item) => ({
        ...item,
        submittedSnapshot: buildResolutionRequest(item, metadataSnapshot),
      }));
      dispatchUploads({ type: "merge-updates", items: prepared });
      const settled = await Promise.all(prepared.map((item) => resolveItem(item, item.submittedSnapshot, batchToken)));
      if (!batchGateRef.current.isActive(batchToken)) return;
      const firstConflict = settled.find((entry) => entry.conflict)?.conflict;
      if (firstConflict) openResolutionConflict(firstConflict);
      const resolved = settled.map((entry) => entry.item);
      dispatchUploads({ type: "merge-updates", items: resolved });
      if (resolved.every((item) => item.status !== "duplicate")) setRecoveredPending(false);
      if (resolved.some((item) => item.status === "done")) router.refresh();
      if (resolved.every((item) => item.status !== "duplicate")) setDuplicateDrawerOpen(false);
    } finally {
      if (batchGateRef.current.release(batchToken)) setPending(false);
    }
  }

  function currentMetadataSnapshot() {
    return {
      subjectId: input.draft.subjectId,
      category: input.draft.category,
      tags: input.draft.tags,
    };
  }

  function buildResolutionRequest(
    item: UploadItem,
    metadata = currentMetadataSnapshot(),
  ): UploadResolutionRequest {
    return buildUploadResolutionRequest(item, metadata);
  }

  function markSelectedFailed(keys: Set<string>, message: string) {
    dispatchUploads({ type: "mark-failed", keys, message });
  }

  function openResolutionConflict(conflict: UploadResolutionConflict) {
    setResolutionConflict(conflict);
    setDuplicateDrawerOpen(false);
    setConflictOpen(true);
  }

  function adoptResolvedUpload() {
    if (!resolutionConflict) return;
    const resultTitle = resolutionConflict.latest.decision === "skip"
      ? "已跳过"
      : resolutionConflict.latest.resource?.title ?? "已按服务端终态完成";
    dispatchUploads({
      type: "adopt-resolved",
      itemKey: resolutionConflict.itemKey,
      resultTitle,
    });
    setConflictOpen(false);
    setResolutionConflict(null);
    router.refresh();
  }

  function mergeResolvedUploadBaseline() {
    if (!resolutionConflict) return;
    const serverRequest = resolutionConflict.latest.request;
    dispatchUploads({
      type: "align-resolved-baseline",
      itemKey: resolutionConflict.itemKey,
      decision: resolutionConflict.latest.decision,
      reuseResourceId: resolutionConflict.latest.resourceId ?? undefined,
    });
    if (serverRequest) {
      input.draft.setSubjectId(serverRequest.subjectId ?? "");
      input.draft.setCategory(serverRequest.category);
      input.draft.setTags(serverRequest.tags.join("，"));
    }
    setConflictOpen(false);
    setResolutionConflict(null);
    input.draft.setCreateOpen(false);
    setDuplicateDrawerOpen(true);
  }

  function continuePendingUpload() {
    if (batchGateRef.current.isLocked()) return;
    if (uploads.some((item) => item.status === "duplicate")) {
      input.draft.setCreateOpen(false);
      setDuplicateDrawerOpen(true);
      return;
    }
    input.draft.setCreateOpen(true);
  }

  function updateDecision(itemKey: string, decision: UploadItem["decision"]) {
    if (batchGateRef.current.isLocked()) return;
    dispatchUploads({ type: "update-decision", itemKey, decision });
  }

  function updateReuseResource(itemKey: string, reuseResourceId: string) {
    if (batchGateRef.current.isLocked()) return;
    dispatchUploads({ type: "update-reuse-resource", itemKey, reuseResourceId });
  }

  const conflictItem = resolutionConflict
    ? uploads.find((item) => item.key === resolutionConflict.itemKey)
    : undefined;
  const localConflictRequest = conflictItem?.staging && conflictItem.decision
    ? buildResolutionRequest(conflictItem)
    : resolutionConflict?.submitted;

  return {
    uploads,
    pending,
    locked: pending,
    error,
    recoveredPending,
    duplicateDrawerOpen,
    resolutionConflict,
    conflictOpen,
    localConflictRequest,
    hasDuplicateUpload: uploads.some((item) => item.status === "duplicate"),
    selectFiles,
    uploadBatch: () => void uploadBatch(),
    continuePendingUpload,
    openDuplicates: () => {
      if (batchGateRef.current.isLocked()) return;
      input.draft.setCreateOpen(false);
      setDuplicateDrawerOpen(true);
    },
    closeDuplicates: () => {
      if (!batchGateRef.current.isLocked()) setDuplicateDrawerOpen(false);
    },
    updateDecision,
    updateReuseResource,
    resolveDuplicates: () => void resolveDuplicates(),
    closeConflict: () => setConflictOpen(false),
    adoptResolvedUpload,
    mergeResolvedUploadBaseline,
  };
}

export type StudyResourceUploadController = ReturnType<typeof useStudyResourceUploadWorkflow>;
