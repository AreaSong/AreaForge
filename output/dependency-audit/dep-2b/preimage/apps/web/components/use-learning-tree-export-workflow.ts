"use client";

import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  downloadLearningTreeExport,
  previewLearningTreeExport,
} from "@/lib/api/learning-tree";
import { isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import {
  beginLearningTreeRequest,
  endLearningTreeRequest,
  type LearningTreeErrorBody,
} from "@/components/learning-tree-import-request";
import type {
  LearningTreeExportPreview,
  LearningTreeScopeView,
} from "@/components/learning-tree-import-workbench-view";

interface LearningTreeExportWorkflowOptions {
  requestInFlightRef: MutableRefObject<boolean>;
  setPending: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  scope: LearningTreeScopeView;
  subjectKey: string;
  rootNodeKey: string;
  persistCurrentDraft: () => void;
  recoverFromNotFound: (body: LearningTreeErrorBody | null) => void;
}

export function useLearningTreeExportWorkflow(options: LearningTreeExportWorkflowOptions) {
  const [exportPreview, setExportPreview] = useState<LearningTreeExportPreview | null>(null);
  const clearExportPreview = useCallback(() => setExportPreview(null), []);

  async function previewExport() {
    if (!beginLearningTreeRequest(options.requestInFlightRef, options.setPending)) return;
    options.setError(null);
    try {
      const response = await previewLearningTreeExport(exportScope(options));
      const body = response.body;
      if (isUnauthorized(response)) {
        options.persistCurrentDraft();
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        options.recoverFromNotFound(body);
        return;
      }
      if (!response.ok || !body?.preview) {
        options.setError(body?.error ?? "导出预览失败，请显式重试。");
        return;
      }
      setExportPreview(body.preview);
    } catch {
      options.setError("网络不可用，导出范围仍保留；恢复网络后请显式重试。");
    } finally {
      endLearningTreeRequest(options.requestInFlightRef, options.setPending);
    }
  }

  async function downloadExport() {
    if (!exportPreview || !beginLearningTreeRequest(options.requestInFlightRef, options.setPending)) return;
    options.setError(null);
    try {
      const response = await downloadLearningTreeExport({
        ...exportScope(options),
        exportToken: exportPreview.exportToken,
      });
      if (isUnauthorized(response)) {
        options.persistCurrentDraft();
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        if (response.status === 404) {
          options.recoverFromNotFound(response.error);
          return;
        }
        clearExportPreview();
        options.setError(response.error?.error ?? "导出授权已失效，请重新预览");
        return;
      }
      if (!response.blob) {
        options.setError("导出响应缺少文件内容，请重新预览");
        return;
      }
      downloadBlob(response.blob, `areaforge-learning-tree-export-${options.scope}.md`);
      clearExportPreview();
    } catch {
      options.setError("网络不可用，导出授权仍保留；恢复网络后请显式重试。");
    } finally {
      endLearningTreeRequest(options.requestInFlightRef, options.setPending);
    }
  }

  return { exportPreview, clearExportPreview, previewExport, downloadExport };
}

function exportScope(options: Pick<LearningTreeExportWorkflowOptions, "scope" | "subjectKey" | "rootNodeKey">) {
  return {
    scope: options.scope,
    subjectKey: options.scope === "global" ? undefined : options.subjectKey,
    rootNodeKey: options.scope === "branch" ? options.rootNodeKey : undefined,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
