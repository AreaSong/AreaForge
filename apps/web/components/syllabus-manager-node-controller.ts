"use client";

import type { SyllabusCommandRuntime } from "@/components/syllabus-manager-command-runtime";
import {
  collectClientConflictFields,
  createSyllabusUpdateBaseline,
  findNodeById,
  flattenTree,
  isSyllabusNodeDto,
  isSyllabusUpdateSubmission,
  omitRecordKey,
  syllabusUpdateDraftKey,
} from "@/components/syllabus-manager-support";
import type {
  AddMasteryEvidenceBody,
  AddMasteryRetestBody,
  SyllabusConflict,
  SyllabusUpdateSubmission,
  UpdateNodeBody,
} from "@/components/syllabus-manager-types";
import type { SyllabusWorkbenchController } from "@/components/syllabus-manager-workbench-controller";
import {
  addSyllabusMasteryEvidence,
  addSyllabusMasteryRetest,
  updateSyllabusNode,
} from "@/lib/api/syllabus";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
  SHORT_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import { useEffect, useState } from "react";

export function useSyllabusNodeController({
  workbench,
  runtime,
}: {
  workbench: SyllabusWorkbenchController;
  runtime: SyllabusCommandRuntime;
}) {
  const [conflict, setConflict] = useState<SyllabusConflict | null>(null);
  const [revisionOverrides, setRevisionOverrides] = useState<Record<string, number>>({});
  const [restoredSubmission, setRestoredSubmission] = useState<SyllabusUpdateSubmission | null>(null);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      for (const node of flattenTree(workbench.displayNodes)) {
        const updateDraft = loadPrivateBusinessDraft(
          syllabusUpdateDraftKey(node.id),
          SHORT_PRIVATE_DRAFT_TTL_MS,
          isSyllabusUpdateSubmission,
        );
        if (updateDraft) {
          setRestoredSubmission(updateDraft);
          break;
        }
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [workbench.displayNodes]);

  async function updateNode(id: string, body: UpdateNodeBody): Promise<boolean> {
    runtime.setError(null);
    const baseline = findNodeById(workbench.displayNodes, id);
    if (!baseline) {
      runtime.setError("考纲节点已不在当前树中，请返回考纲工作台刷新");
      return false;
    }
    const submission: SyllabusUpdateSubmission = {
      nodeId: id,
      expectedRevision: revisionOverrides[id] ?? baseline.revision,
      baseline: createSyllabusUpdateBaseline(baseline),
      body: structuredClone(body),
    };
    savePrivateBusinessDraft(syllabusUpdateDraftKey(id), submission);
    runtime.setPendingCommand(`${id}:update`);
    try {
      const response = await updateSyllabusNode(id, {
        ...submission.body,
        expectedRevision: submission.expectedRevision,
      });
      if (!response.ok) {
        const data = response.body;
        if (isUnauthorized(response)) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && data?.workbench === "/knowledge/syllabi") runtime.replace(data.workbench);
        else if (isConflict(response) && isSyllabusNodeDto(data?.latest)) {
          setConflict({
            baseline,
            submission,
            latest: data.latest,
            conflictFields: data.conflictFields ?? ["revision"],
          });
        }
        runtime.setError(data?.error ?? "更新考纲节点失败，首次提交快照已保留");
        return false;
      }
      if (!response.body?.node) {
        runtime.setError("服务端未返回更新后的节点，首次提交快照仍保留");
        return false;
      }
      removePrivateBusinessDraft(syllabusUpdateDraftKey(id));
      setRestoredSubmission((current) => current?.nodeId === id ? null : current);
      setRevisionOverrides((current) => omitRecordKey(current, id));
      runtime.refresh();
      return true;
    } catch {
      runtime.setError("网络中断，节点更新快照已保留，请先确认服务端状态再明确重试");
      return false;
    } finally {
      runtime.setPendingCommand(null);
    }
  }

  function retryRestoredUpdate() {
    if (!restoredSubmission) return;
    const latest = findNodeById(workbench.displayNodes, restoredSubmission.nodeId);
    if (!latest) {
      runtime.setError("草稿对应节点已不存在，请返回考纲工作台处理");
      return;
    }
    if (latest.revision !== restoredSubmission.expectedRevision) {
      setConflict({
        baseline: restoredSubmission.baseline,
        submission: restoredSubmission,
        latest,
        conflictFields: collectClientConflictFields(restoredSubmission.body, latest),
      });
      return;
    }
    void updateNode(restoredSubmission.nodeId, restoredSubmission.body);
  }

  async function addMasteryEvidence(id: string, body: AddMasteryEvidenceBody): Promise<boolean> {
    runtime.setError(null);
    runtime.setPendingCommand(`${id}:evidence`);
    try {
      const response = await addSyllabusMasteryEvidence(id, body);
      if (!response.ok) {
        const data = response.body;
        if (isUnauthorized(response)) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && data?.workbench === "/knowledge/syllabi") runtime.replace(data.workbench);
        runtime.setError(data?.error ?? "新增掌握证据失败，输入草稿已保留");
        return false;
      }
      runtime.refresh();
      return true;
    } catch {
      runtime.setError("网络中断，证据输入已保留，请明确重试");
      return false;
    } finally {
      runtime.setPendingCommand(null);
    }
  }

  async function addMasteryRetest(id: string, body: AddMasteryRetestBody): Promise<boolean> {
    runtime.setError(null);
    const commandScope = `mastery-retest:${id}`;
    runtime.setPendingCommand(`${id}:retest`);
    try {
      const response = await addSyllabusMasteryRetest(id, {
        ...body,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mastery-retest", body),
      });
      if (!response.ok) {
        const data = response.body;
        if (isUnauthorized(response)) redirectToLoginWithCurrentLocation();
        else if (response.status === 404 && data?.workbench === "/knowledge/syllabi") runtime.replace(data.workbench);
        runtime.setError(data?.error ?? "新增复测记录失败，输入草稿与重试标识已保留");
        return false;
      }
      if (!response.body?.node) {
        runtime.setError("服务端未返回复测后的节点，当前输入与重试标识仍保留");
        return false;
      }
      completeIdempotentCommand(commandScope);
      runtime.refresh();
      return true;
    } catch {
      runtime.setError("网络中断，复测输入与同一重试标识已保留，请明确重试");
      return false;
    } finally {
      runtime.setPendingCommand(null);
    }
  }

  function discardRestoredUpdate() {
    if (!restoredSubmission) return;
    removePrivateBusinessDraft(syllabusUpdateDraftKey(restoredSubmission.nodeId));
    setRestoredSubmission(null);
  }

  function adoptConflict() {
    if (!conflict) return;
    removePrivateBusinessDraft(syllabusUpdateDraftKey(conflict.submission.nodeId));
    setRestoredSubmission((current) => current?.nodeId === conflict.submission.nodeId ? null : current);
    setRevisionOverrides((current) => omitRecordKey(current, conflict.submission.nodeId));
    setConflict(null);
    runtime.setError("已采用服务端版本");
    runtime.refresh();
  }

  function mergeConflict() {
    if (!conflict) return;
    setRevisionOverrides((current) => ({
      ...current,
      [conflict.submission.nodeId]: conflict.latest.revision,
    }));
    setConflict(null);
    runtime.setError("已载入服务端最新 revision，本地输入仍保留；检查后请再次点击保存，不会自动重放");
  }

  return {
    state: { conflict, restoredSubmission },
    actions: {
      updateNode,
      retryRestoredUpdate,
      addMasteryEvidence,
      addMasteryRetest,
      discardRestoredUpdate,
      adoptConflict,
      mergeConflict,
    },
  };
}

export type SyllabusNodeController = ReturnType<typeof useSyllabusNodeController>;
